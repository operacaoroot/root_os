import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  SalaAceiteDadosSchema,
  SalaAceitePagamentoSchema,
  SalaAgendaSchema,
  SalaAjusteSchema,
  SalaDuvidaSchema,
  SalaFormSchema,
  SalaKickoffSchema,
  SalaPropostaLidaSchema,
  type EstadoDaSala,
  type SalaFormInput,
} from '@mktos/shared';
import { Prisma } from '@prisma/client';

import { comTenantPublico, resolverTenantDaSala } from '../common/tenant-publico';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { horarioOferecido, horariosOferecidos } from './agenda-de-homologacao';
import { hashDoConteudo } from './eventos';
import { FioService, ReacoesRegistry } from './fio.service';
import { chaveDaDuvida, projetarSala, type DadosDaSala, type EventoDaSala } from './sala-projecao';
import {
  cifrarTokenDaSala,
  decifrarTokenDaSala,
  gerarTokenDaSala,
  hashDoTokenDaSala,
  linkDaSala,
  salaAtiva,
  segredoDoAmbiente,
  slugDaSala,
  tokenDaSalaBemFormado,
  validadeDaSala,
} from './sala-token';

/*
 * A SALA DO CLIENTE — Lane B (13/10/2026).
 *
 * O mesmo endereço do primeiro contato ao kickoff (`/s/<token>`). A sala nasce
 * na reação a `lead.chegou`; o token vai uma vez para a mensagem M1 e nunca
 * mais aparece em claro: no banco fica o sha256 (para achar a sala) e o token
 * cifrado (para o OS reescrever o MESMO link nas mensagens seguintes).
 *
 * Toda escrita da sala é um FATO no fio do lead, gravado pelo `FioService` com
 * chave de idempotência: o clique duplo, a página recarregada e a rede que
 * repete o pedido caem no mesmo evento. O estado que a página lê é PROJEÇÃO
 * (`sala-projecao.ts`), nunca um campo digitado.
 *
 * A rota é anônima: token inexistente, expirado e revogado respondem o MESMO
 * 404, e a empresa é achada pelo hash sob a sentinela pública
 * (`resolverTenantDaSala`); o resto do pedido roda em `comTenantPublico`.
 *
 * A COBRANÇA E O CONTRATO NÃO SÃO DAQUI. `aceite/pagamento` grava
 * `proposta.aceita` com a versão e o hash da proposta vigente; a lane do
 * dinheiro reage a ele e cria a cobrança e o documento, que a sala só mostra
 * quando existirem.
 */

export const SALA_NAO_ENCONTRADA = 'sala não encontrada';
const ATOR_DA_SALA = 'comercial-sala';
const MAX_BYTES_DO_ARQUIVO = 10 * 1024 * 1024;
const TIPOS_DE_ARQUIVO = new Set([
  'application/pdf',
  'text/csv',
  'text/plain',
  'image/png',
  'image/jpeg',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

interface SalaResolvida {
  salaId: string;
  leadId: string;
  orgId: string;
}

/** O dia civil de São Paulo (AAAA-MM-DD), para "uma visita por dia por estágio". */
function diaSP(agora: Date): string {
  return new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

type P = Record<string, unknown>;

/**
 * B-11 (revisão): quem busca o link para montar a pré-visualização (WhatsApp,
 * Facebook, Telegram, Slack, Discord, LinkedIn, X) ou um robô de busca. A
 * leitura dele não é visita do cliente.
 */
export function ehPreVisualizacao(userAgent: string | null | undefined): boolean {
  const ua = String(userAgent ?? '');
  if (!ua) return false;
  return /whatsapp|facebookexternalhit|facebot|telegrambot|slackbot|slack-imgproxy|discordbot|linkedinbot|twitterbot|skypeuripreview|googlebot|bingbot|\bbot\b|crawler|spider|preview/i.test(ua);
}

@Injectable()
export class SalaService implements OnModuleInit {
  private readonly log = new Logger('ComercialSala');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly reacoes: ReacoesRegistry,
    private readonly moduleRef?: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.reacoes.inscrever('lead.chegou', 'sala.abrir', async (ev) => {
      const r = await this.garantir(ev.orgId, ev.leadId);
      return { salaId: r.salaId, nova: r.nova, comLink: Boolean(r.link) };
    });
  }

  // -------------------------------------------------------------------------
  // API para as outras lanes (o link da sala, a sala do lead)
  // -------------------------------------------------------------------------

  /**
   * A sala do lead, criada se não existir. Idempotente: a segunda chamada
   * devolve a mesma sala e o mesmo link. `link` é `null` só quando não há
   * `ENCRYPTION_KEY` no ambiente E a sala já existia (o token não é guardado
   * em claro em lugar nenhum).
   */
  async garantir(orgId: string, leadId: string, agora: Date = new Date()): Promise<{ salaId: string; link: string | null; nova: boolean }> {
    const existente = await this.prisma.salaDoCliente.findUnique({ where: { leadId } });
    if (existente) return { salaId: existente.id, link: this.linkDe(existente), nova: false };

    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true, ficha: { select: { empresa: true } } } });
    if (!lead) throw new NotFoundException('lead não encontrado nesta empresa');

    const id = randomUUID();
    const { token, hash } = gerarTokenDaSala();
    const segredo = segredoDoAmbiente();
    const validoAte = validadeDaSala(agora);
    const slug = slugDaSala(lead.ficha?.empresa ?? lead.name);
    try {
      await this.prisma.salaDoCliente.create({
        data: {
          id,
          orgId,
          leadId,
          slug,
          tokenHash: hash,
          tokenCifrado: segredo ? cifrarTokenDaSala(token, segredo, id) : null,
          validoAte,
          dados: {},
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const outra = await this.prisma.salaDoCliente.findUnique({ where: { leadId } });
        if (outra) return { salaId: outra.id, link: this.linkDe(outra), nova: false };
      }
      throw e;
    }
    await this.fio.registrar(orgId, leadId, 'sala.aberta', 'sala', { salaId: id, slug, validoAte: validoAte.toISOString() }, { em: agora });
    return { salaId: id, link: linkDaSala(token), nova: true };
  }

  /** O link da sala do lead, ou `null` se não há sala (ou não há como reescrevê-lo). */
  async linkDoLead(orgId: string, leadId: string): Promise<string | null> {
    const sala = await this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId } });
    return sala ? this.linkDe(sala) : null;
  }

  /** Os horários oferecidos ao lead, gravados na sala na primeira vez (agenda de homologação). */
  async garantirHorarios(orgId: string, leadId: string, agora: Date = new Date()): Promise<string[]> {
    const { salaId } = await this.garantir(orgId, leadId, agora);
    const sala = await this.prisma.salaDoCliente.findUniqueOrThrow({ where: { id: salaId } });
    const dados = (sala.dados ?? {}) as DadosDaSala & P;
    const futuros = (dados.horariosOferecidos ?? []).filter((h) => new Date(h).getTime() > agora.getTime());
    if (futuros.length >= 2) return futuros;
    const novos = horariosOferecidos(agora);
    await this.prisma.salaDoCliente.update({
      where: { id: salaId },
      data: { dados: { ...dados, horariosOferecidos: novos, agendaDeHomologacao: true } as Prisma.InputJsonValue },
    });
    return novos;
  }

  /** O link do trilho de onboarding, quando o fechamento o abrir (estação "começo"). */
  async apontarTrilho(orgId: string, leadId: string, linkDoTrilho: string): Promise<void> {
    const sala = await this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId } });
    if (!sala) return;
    const dados = (sala.dados ?? {}) as P;
    await this.prisma.salaDoCliente.update({ where: { id: sala.id }, data: { dados: { ...dados, linkDoTrilho } as Prisma.InputJsonValue } });
  }

  /**
   * A resposta a uma dúvida da proposta (o assistente da lane E, ou gente). O
   * evento `proposta.duvida` é imutável; a resposta mora na sala, pela chave da
   * dúvida, e a projeção a mostra no lugar do "recebemos". Responder de novo
   * troca a resposta.
   */
  async responderDuvida(orgId: string, leadId: string, duvida: { versao: number; pergunta: string }, resposta: string, por: string | null = null): Promise<void> {
    const sala = await this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId } });
    if (!sala) throw new NotFoundException('o lead não tem sala');
    const texto = String(resposta ?? '').trim();
    if (!texto) throw new BadRequestException('resposta vazia');
    const dados = (sala.dados ?? {}) as DadosDaSala & P;
    const respostas = { ...(dados.respostas ?? {}), [chaveDaDuvida(duvida.versao, duvida.pergunta)]: { resposta: texto.slice(0, 2000), em: new Date().toISOString(), por } };
    await this.prisma.salaDoCliente.update({ where: { id: sala.id }, data: { dados: { ...dados, respostas } as Prisma.InputJsonValue } });
  }

  /** As dúvidas da proposta vigente ainda sem resposta (para o assistente da lane E). */
  async duvidasSemResposta(orgId: string, leadId: string): Promise<{ versao: number; pergunta: string; em: string }[]> {
    const estado = await this.estadoDoLead(orgId, leadId);
    const p = estado?.proposta;
    if (!p) return [];
    return (p.duvidas ?? []).filter((d) => !d.resposta).map((d) => ({ versao: p.versao, pergunta: d.pergunta, em: d.em }));
  }

  /** O estado da sala pelo LEAD (rotas internas e simulador). */
  async estadoDoLead(orgId: string, leadId: string, agora: Date = new Date()): Promise<EstadoDaSala | null> {
    const sala = await this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId } });
    if (!sala) return null;
    return this.projetar(sala.id, leadId, agora);
  }

  // -------------------------------------------------------------------------
  // Os fatos, por lead (a sala e o simulador entram pelos mesmos métodos)
  // -------------------------------------------------------------------------

  async responderFormulario(orgId: string, leadId: string, input: SalaFormInput, em: Date = new Date()): Promise<{ eventoId: string; novo: boolean }> {
    const form = SalaFormSchema.parse(input);
    return this.fio.registrar(
      orgId,
      leadId,
      'form.respondido',
      hashDoConteudo(form),
      {
        sistema: form.sistema,
        baseOrganizada: form.baseOrganizada,
        maiorDor: form.maiorDor,
        equipeFinanceiro: form.equipeFinanceiro,
        nome: form.nome ?? null,
        empresa: form.empresa ?? null,
        cnpj: form.cnpj ?? null,
      },
      { em },
    );
  }

  async escolherHorario(orgId: string, leadId: string, horario: string, em: Date = new Date()): Promise<{ eventoId: string; novo: boolean }> {
    const sala = await this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId } });
    const oferecidos = ((sala?.dados ?? {}) as DadosDaSala).horariosOferecidos ?? [];
    if (!horarioOferecido(horario, oferecidos)) throw new BadRequestException('esse horário não está entre os oferecidos');
    if (new Date(horario).getTime() <= em.getTime()) throw new BadRequestException('esse horário já passou');
    const iso = new Date(horario).toISOString();
    const original = oferecidos.find((o) => new Date(o).getTime() === new Date(horario).getTime()) ?? horario;
    return this.fio.registrar(orgId, leadId, 'agenda.escolhida', iso, { horario: original, oferecidos }, { em });
  }

  // -------------------------------------------------------------------------
  // As rotas anônimas
  // -------------------------------------------------------------------------

  /** Token → sala ativa. Inexistente, malformado, expirado e revogado: o MESMO 404. */
  async resolver(token: string, agora: Date = new Date()): Promise<SalaResolvida> {
    if (!tokenDaSalaBemFormado(token)) throw new NotFoundException(SALA_NAO_ENCONTRADA);
    const r = await resolverTenantDaSala(this.prisma as never, hashDoTokenDaSala(token));
    if (!r || !salaAtiva(r, agora)) throw new NotFoundException(SALA_NAO_ENCONTRADA);
    return { salaId: r.salaId, leadId: r.leadId, orgId: r.orgId };
  }

  /**
   * O estado da sala. Conta a visita (`acessos` e `sala.visitada`) só quando
   * quem leu é gente: B-11, a pré-visualização de link (WhatsApp, redes,
   * robôs de busca) lê sem virar visita (`ehPreVisualizacao`).
   */
  async estado(token: string, agora: Date = new Date(), opcoes: { userAgent?: string | null } = {}): Promise<EstadoDaSala> {
    const r = await this.resolver(token, agora);
    if (ehPreVisualizacao(opcoes.userAgent)) {
      return comTenantPublico(r.orgId, () => this.projetar(r.salaId, r.leadId, agora));
    }
    return comTenantPublico(r.orgId, async () => {
      await this.prisma.salaDoCliente.update({ where: { id: r.salaId }, data: { acessos: { increment: 1 }, ultimoAcessoEm: agora } });
      const estado = await this.projetar(r.salaId, r.leadId, agora);
      await this.fio.registrar(r.orgId, r.leadId, 'sala.visitada', `${diaSP(agora)}:${estado.estagio}`, { salaId: r.salaId, estagio: estado.estagio }, { em: agora });
      return estado;
    });
  }

  async form(token: string, corpo: unknown): Promise<EstadoDaSala> {
    const input = this.validar(SalaFormSchema, corpo);
    return this.naSala(token, async (r) => {
      await this.responderFormulario(r.orgId, r.leadId, input);
    });
  }

  async agenda(token: string, corpo: unknown): Promise<EstadoDaSala> {
    const { horario } = this.validar(SalaAgendaSchema, corpo);
    return this.naSala(token, async (r) => {
      const ja = await this.ultimoEvento(r.leadId, 'agenda.escolhida');
      if (ja) {
        const anterior = String(((ja.payload ?? {}) as P).horario ?? '');
        if (new Date(anterior).getTime() === new Date(horario).getTime()) return;
        throw new ConflictException('a conversa já está marcada; para remarcar, responda no WhatsApp');
      }
      await this.escolherHorario(r.orgId, r.leadId, horario);
    });
  }

  async arquivo(token: string, arquivo: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined): Promise<EstadoDaSala> {
    if (!arquivo) throw new BadRequestException('nenhum arquivo enviado (campo "file").');
    if (arquivo.size > MAX_BYTES_DO_ARQUIVO) throw new BadRequestException('arquivo acima de 10 MB.');
    if (!TIPOS_DE_ARQUIVO.has(arquivo.mimetype)) throw new BadRequestException('tipo de arquivo não aceito: mande PDF, planilha, CSV ou imagem.');
    const storage = this.storage();
    if (!storage) throw new ServiceUnavailableException('o envio de arquivo está indisponível agora. Leve o arquivo para a conversa.');
    return this.naSala(token, async (r) => {
      const sha = createHash('sha256').update(arquivo.buffer).digest('hex');
      const nome = arquivo.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'arquivo';
      await storage.put(`comercial/sala/${r.salaId}/${sha}`, arquivo.buffer, arquivo.mimetype);
      await this.fio.registrar(r.orgId, r.leadId, 'arquivo.enviado', sha, { nome, bytes: arquivo.size, tipo: arquivo.mimetype });
    });
  }

  async propostaLida(token: string, corpo: unknown): Promise<EstadoDaSala> {
    const { bloco, versao } = this.validar(SalaPropostaLidaSchema, corpo);
    return this.naSala(token, async (r) => {
      await this.exigirVersaoVigente(r.leadId, versao);
      const sala = await this.prisma.salaDoCliente.findUniqueOrThrow({ where: { id: r.salaId }, select: { acessos: true } });
      await this.fio.registrar(r.orgId, r.leadId, 'proposta.lida', `${versao}:${bloco}:${sala.acessos}`, { versao, bloco, visita: sala.acessos });
    });
  }

  /**
   * A dúvida continua aberta depois do aceite (B-6, escolha registrada): ela não
   * muda preço, parcela nem contrato, só pede uma resposta da mesa.
   */
  async duvida(token: string, corpo: unknown): Promise<EstadoDaSala> {
    const { pergunta } = this.validar(SalaDuvidaSchema, corpo);
    return this.naSala(token, async (r) => {
      const { versao } = await this.propostaVigente(r.leadId);
      await this.fio.registrar(r.orgId, r.leadId, 'proposta.duvida', chaveDaDuvida(versao, pergunta), { versao, pergunta, resposta: null });
    });
  }

  /**
   * O pedido de ajuste. Depois do aceite (B-6/D-4) é 409: a cobrança e o
   * contrato já foram propostos à titular com a versão aceita, e um ajuste ali
   * abriria uma versão nova por cima deles. Mudar algo depois do aceite passa a
   * ser pedido à mesa.
   */
  async ajuste(token: string, corpo: unknown): Promise<EstadoDaSala> {
    const input = this.validar(SalaAjusteSchema, corpo);
    return this.naSala(token, async (r) => {
      const { versao } = await this.propostaVigente(r.leadId);
      if (await this.ultimoEvento(r.leadId, 'proposta.aceita')) {
        throw new ConflictException('a proposta já foi aceita: para mudar alguma condição, fale com a Root no WhatsApp');
      }
      await this.fio.registrar(r.orgId, r.leadId, 'proposta.ajuste_pedido', hashDoConteudo({ versao, ...input }), {
        versao,
        pedido: input.pedido,
        descontoPct: input.descontoPct ?? null,
        decisaoId: null,
      });
    });
  }

  /**
   * Os dados do contratante. Depois do aceite (B-6/D-2) eles estão congelados:
   * a cobrança e o contrato foram propostos à titular com ESTES dados, e trocar
   * o CNPJ pela sala depois disso é 409 (mudar dado do contratante passa a ser
   * pedido à mesa). Reenviar exatamente os mesmos dados não muda nada.
   */
  async aceiteDados(token: string, corpo: unknown): Promise<EstadoDaSala> {
    const input = this.validar(SalaAceiteDadosSchema, corpo);
    return this.naSala(token, async (r) => {
      await this.propostaVigente(r.leadId);
      if (await this.ultimoEvento(r.leadId, 'proposta.aceita')) {
        const atuais = await this.ultimoEvento(r.leadId, 'aceite.dados');
        if (atuais && hashDoConteudo(atuais.payload ?? {}) === hashDoConteudo(input)) return;
        throw new ConflictException('a proposta já foi aceita com os seus dados: para mudar algum dado do contratante, fale com a Root no WhatsApp');
      }
      await this.fio.registrar(r.orgId, r.leadId, 'aceite.dados', hashDoConteudo(input), input);
    });
  }

  /**
   * O aceite: congela a versão e o hash da proposta vigente. Versão que não é a
   * vigente = 409 (a proposta mudou enquanto a página estava aberta). Uma
   * versão é aceita uma vez; a segunda tentativa com outra forma é 409.
   */
  async aceitePagamento(token: string, corpo: unknown): Promise<EstadoDaSala> {
    const input = this.validar(SalaAceitePagamentoSchema, corpo);
    return this.naSala(token, async (r) => {
      const vigente = await this.propostaVigente(r.leadId);
      if (input.versao !== vigente.versao) {
        throw new ConflictException(`a proposta mudou: a versão vigente é a ${vigente.versao}. Recarregue a sala.`);
      }
      const oferta = this.ofertaDaVersao(vigente.payload, input.produto);
      if (!oferta) throw new BadRequestException('esse produto não está nesta proposta');
      if (!oferta.formas.includes(input.forma)) throw new BadRequestException(`essa forma de pagamento não está disponível para ${input.produto}`);
      if (!(await this.ultimoEvento(r.leadId, 'aceite.dados'))) throw new ConflictException('confira os seus dados antes de aceitar');
      const ja = await this.ultimoEvento(r.leadId, 'proposta.aceita', (p) => p.versao === vigente.versao);
      if (ja) {
        const p = (ja.payload ?? {}) as P;
        if (p.produto === input.produto && p.forma === input.forma) return;
        throw new ConflictException('esta versão da proposta já foi aceita com outra escolha');
      }
      await this.fio.registrar(r.orgId, r.leadId, 'proposta.aceita', `v${vigente.versao}`, {
        versao: vigente.versao,
        produto: input.produto,
        valorCentavos: oferta.valorCentavos,
        parcelas: oferta.parcelas,
        forma: input.forma,
        hash: vigente.hash,
      });
    });
  }

  /** Passo 3: o contrato é da lane do dinheiro; a sala só confirma que o aceite existe e mostra o documento quando houver. */
  async aceiteContrato(token: string): Promise<EstadoDaSala> {
    return this.naSala(token, async (r) => {
      if (!(await this.ultimoEvento(r.leadId, 'proposta.aceita'))) throw new ConflictException('aceite a proposta antes do contrato');
    });
  }

  async kickoff(token: string, corpo: unknown): Promise<EstadoDaSala> {
    const { horario } = this.validar(SalaKickoffSchema, corpo);
    return this.naSala(token, async (r) => {
      const estado = await this.projetar(r.salaId, r.leadId, new Date());
      if (estado.estagio !== 'comeco') throw new ConflictException('o horário do kickoff abre quando o começo estiver liberado');
      if (new Date(horario).getTime() <= Date.now()) throw new BadRequestException('esse horário já passou');
      await this.fio.registrar(r.orgId, r.leadId, 'kickoff.marcado', new Date(horario).toISOString(), { horario });
    });
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  private linkDe(sala: { id: string; tokenCifrado: string | null }): string | null {
    const segredo = segredoDoAmbiente();
    if (!segredo || !sala.tokenCifrado) return null;
    const token = decifrarTokenDaSala(sala.tokenCifrado, segredo, sala.id);
    return token ? linkDaSala(token) : null;
  }

  private storage(): StorageService | null {
    try {
      return this.moduleRef?.get(StorageService, { strict: false }) ?? null;
    } catch {
      return null;
    }
  }

  private validar<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } }, corpo: unknown): T {
    const r = schema.safeParse(corpo ?? {});
    if (!r.success) {
      const i = r.error.issues[0];
      throw new BadRequestException(i ? `${i.path.join('.') || 'corpo'}: ${i.message}` : 'pedido inválido');
    }
    return r.data;
  }

  private async naSala(token: string, fn: (r: SalaResolvida) => Promise<void>): Promise<EstadoDaSala> {
    const r = await this.resolver(token);
    return comTenantPublico(r.orgId, async () => {
      await fn(r);
      return this.projetar(r.salaId, r.leadId, new Date());
    });
  }

  private async ultimoEvento(leadId: string, type: string, filtro?: (p: P) => boolean) {
    const eventos = await this.prisma.leadEvent.findMany({ where: { leadId, type }, orderBy: { occurredAt: 'desc' }, take: 50 });
    return eventos.find((e) => !filtro || filtro((e.payload ?? {}) as P)) ?? null;
  }

  private async propostaVigente(leadId: string): Promise<{ versao: number; hash: string; payload: P }> {
    const publicadas = await this.prisma.leadEvent.findMany({ where: { leadId, type: 'proposta.publicada' }, orderBy: { occurredAt: 'desc' }, take: 20 });
    if (!publicadas.length) throw new ConflictException('ainda não há proposta nesta sala');
    const maisNova = publicadas
      .map((e) => (e.payload ?? {}) as P)
      .sort((a, b) => Number(b.versao ?? 0) - Number(a.versao ?? 0))[0];
    return { versao: Number(maisNova.versao ?? 1), hash: String(maisNova.hash ?? ''), payload: maisNova };
  }

  private async exigirVersaoVigente(leadId: string, versao: number): Promise<void> {
    const vigente = await this.propostaVigente(leadId);
    if (vigente.versao !== versao) throw new ConflictException(`a proposta mudou: a versão vigente é a ${vigente.versao}. Recarregue a sala.`);
  }

  private ofertaDaVersao(p: P, produto: string): { valorCentavos: number; parcelas: number; formas: string[] } | null {
    if (p.produto === produto) {
      return { valorCentavos: Number(p.valorCentavos), parcelas: Number(p.parcelas), formas: Array.isArray(p.formas) ? (p.formas as string[]) : [] };
    }
    // A alternativa nomeada pelo evento: preço e formas da tabela (projeção usa a mesma regra).
    const estado = projetarSala({
      slug: '',
      nomeDoLead: '',
      validoAte: new Date(),
      dados: {},
      ficha: null,
      eventos: [{ type: 'proposta.publicada', payload: p, occurredAt: new Date() }],
      cobrancas: [],
      documentos: [],
    });
    const alt = estado.proposta?.alternativa;
    return alt && alt.produto === produto ? { valorCentavos: alt.valorCentavos, parcelas: alt.parcelas, formas: alt.formas } : null;
  }

  private async projetar(salaId: string, leadId: string, agora: Date): Promise<EstadoDaSala> {
    const [sala, lead, ficha, eventos, cobrancas, documentos] = await Promise.all([
      this.prisma.salaDoCliente.findUniqueOrThrow({ where: { id: salaId } }),
      this.prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { name: true } }),
      this.prisma.comercialFicha.findUnique({ where: { leadId } }),
      this.prisma.leadEvent.findMany({ where: { leadId }, orderBy: { occurredAt: 'asc' }, take: 1000, select: { type: true, payload: true, occurredAt: true } }),
      this.prisma.comercialCobranca.findMany({ where: { leadId } }),
      this.prisma.comercialDocumento.findMany({ where: { leadId } }),
    ]);
    return projetarSala({
      slug: sala.slug,
      nomeDoLead: lead.name,
      validoAte: sala.validoAte,
      dados: (sala.dados ?? {}) as DadosDaSala,
      ficha: ficha
        ? {
            etapa: ficha.etapa,
            empresa: ficha.empresa,
            reuniaoEm: ficha.reuniaoEm,
            quadroDeCustos: ficha.quadroDeCustos,
            grupoJid: ficha.grupoJid,
            kickoffEm: ficha.kickoffEm,
            clienteAtivoEm: ficha.clienteAtivoEm,
            trilhoId: ficha.trilhoId,
          }
        : null,
      eventos: eventos as EventoDaSala[],
      cobrancas: cobrancas.map((c) => ({ parcela: c.parcela, estado: c.estado, valorCentavos: c.valorCentavos, linkPagamento: c.linkPagamento, pixCopiaECola: c.pixCopiaECola })),
      documentos: documentos.map((d) => ({
        estado: d.estado,
        linkCliente: d.linkCliente,
        assinadoClienteEm: d.assinadoClienteEm,
        assinadoRootEm: d.assinadoRootEm,
        criadoEm: d.criadoEm,
      })),
      agora,
    });
  }
}

export { ATOR_DA_SALA };
