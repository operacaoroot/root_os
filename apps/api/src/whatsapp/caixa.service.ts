import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import { Prisma } from '@prisma/client';
import {
  ArquivarConversaSchema,
  FILTROS_DA_CAIXA,
  LegendaDaMidiaSchema,
  ResponderNaCaixaSchema,
  TETO_DA_MIDIA_BAIXADA,
  fraseDoTetoDaMidia,
  lerFiltroDaCaixa,
  rotuloDoTipoDeMensagem,
  tetoDaMidiaParaEnviar,
  tipoDaMidiaParaEnviar,
  type ConversaAberta,
  type ConversaDaCaixa,
  type FiltroDaCaixa,
  type ListaDaCaixa,
  type ParticipanteDoGrupo,
  type RespostaEnviada,
} from '@mktos/shared';

import { temPapelDeMaquina } from '../approvals/alcada';
import { lerAprovador } from '../auth/aprovador';
import { uuidDe } from '../comercial/eventos';
import {
  MIDIA_DA_CAIXA_PELA_EVOLUTION,
  RESPOSTA_DE_GENTE_PELA_EVOLUTION,
  type MidiaDaCaixaPelaEvolution,
  type RespostaDeGentePelaEvolution,
} from '../gateway/canais/evolution.port';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  abreNoNavegador,
  chaveDaMidiaNoStorage,
  mimeLimpo,
  nomeDoArquivo,
  temArquivo,
} from './midia-da-caixa';
import {
  SELECT_DA_CONVERSA,
  SELECT_DA_MENSAGEM,
  lerMidia,
  projetarConversas,
  projetarMensagens,
} from './projecao';
import { ResumoDoWhatsappService } from './resumo.service';
import { SincronizacaoDoWhatsappService } from './sincronizacao.service';

/*
 * A CAIXA DE WHATSAPP (rodada de produção 4, W2, 22/10/2026).
 *
 * Ler (lista, conversa, marcar como lida) pede `leads.ver`. Arquivar e
 * RESPONDER pedem `whatsapp.conversar` e são de GENTE: o controlador recusa
 * papel de máquina pelo token (`SoGenteNaCaixaGuard`) e este serviço relê no
 * banco (usuário ativo desta empresa, sem papel de máquina, com a permissão
 * agora). Quem perdeu a permissão não responde até o token vencer? Responde
 * não: a releitura vale na hora.
 *
 * RESPONDER NÃO PASSA PELA RÉGUA NEM PELA `PortaDoOperador`: é uma pessoa
 * escrevendo, e a régua é para agente. Layout 26/10: o texto sai como ROOT (o
 * número da empresa), EXATAMENTE como foi digitado: nenhum nome de pessoa entra
 * na mensagem. Quem enviou fica só dentro do OS (`enviadaPorId`, a linha
 * "enviada por" da caixa e a auditoria). O texto sai pela
 * porta `RESPOSTA_DE_GENTE_PELA_EVOLUTION` (o conector nunca é importado aqui),
 * e este é o ÚNICO arquivo que a chama (catraca em `whatsapp-caixa.test.ts`).
 *
 * O que fica gravado de uma resposta: a `WhatsAppMensagem` `deMim` com
 * `enviadaPorId` e o id que a Evolution devolveu (o eco que chegar depois pelo
 * webhook ou pela sincronização cai na mesma linha, pelo índice único), a
 * `ComercialMensagem` quando a conversa é de um lead (o fio do lead segue
 * completo) e a linha de auditoria SEM o texto e SEM o número.
 *
 * Layout 27/10: O ARQUIVO. Abrir o arquivo de uma mensagem pede o mesmo que ler
 * a conversa (`leads.ver`, da mesma empresa): ele vem do storage do OS, ou da
 * Evolution na primeira vez (e fica no storage). Mandar arquivo (foto, vídeo,
 * áudio, documento) é como responder: `whatsapp.conversar`, gente, a mesma
 * assinatura na legenda (o áudio não tem legenda e sai sem nada a mais), a
 * mesma gravação, e o arquivo entra no storage na hora. A porta é
 * `MIDIA_DA_CAIXA_PELA_EVOLUTION`, também só chamada daqui.
 */

/** O arquivo como o multer entrega (`FileInterceptor`, memória). */
export interface ArquivoDaCaixa {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** O arquivo de uma mensagem, pronto para a resposta HTTP. */
export interface ArquivoDaMensagem {
  /** Os bytes (veio da Evolution agora) ou o stream do storage. */
  corpo: Buffer | Readable;
  tamanho: number;
  mime: string;
  nome: string;
  /** Abre no navegador (foto, áudio, vídeo, PDF) em vez de baixar. */
  inline: boolean;
}

const MENSAGEM_NAO_ACHADA = 'Mensagem não encontrada.';
const SEM_ARQUIVO_NO_WHATSAPP = 'O WhatsApp não guarda mais esse arquivo. Peça para mandarem de novo.';

const RECUSA_DE_MAQUINA = 'Responder pelo WhatsApp é de gente: conta de serviço (IA) não conversa pela caixa.';
const NAO_ACHOU = 'Conversa não encontrada.';

const LIMITE_DA_LISTA = 50;
const TETO_DA_LISTA = 200;
const LIMITE_DAS_MENSAGENS = 50;
const TETO_DAS_MENSAGENS = 200;
/** A busca no texto das mensagens só a partir de 3 letras (ILIKE em toda a caixa custa). */
const MINIMO_PARA_BUSCAR_NO_TEXTO = 3;
const TETO_DA_BUSCA = 100;
/** Quantas conversas a busca acha no máximo (a lista e as contagens contam dentro disso; revisão 22C, A4). */
const TETO_DAS_ACHADAS = 2000;

export interface QuemNaCaixa {
  id: string;
  papeis: readonly string[];
  permissoes: readonly string[];
}

export interface ConsultaDaLista {
  filtro?: unknown;
  q?: unknown;
  limite?: unknown;
}

export interface ConsultaDaConversa {
  antesDe?: unknown;
  antesDeId?: unknown;
  limite?: unknown;
}

function inteiro(v: unknown, padrao: number, teto: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n) || n < 1) return padrao;
  return Math.min(teto, Math.floor(n));
}

/**
 * O filtro de cada chip, a MESMA regra do resumo do Dia a dia (lane D), para o
 * cartão e a caixa não discordarem: Equipe = `equipe` verdadeiro, seja qual for
 * o vínculo; Leads, Clientes e Sem vínculo saem só do resto (`equipe` falso).
 * Arquivada só aparece em Arquivadas.
 * Layout 26/10: Comunidade = `comunidade` verdadeiro (e fora da equipe, para as
 * faixas não se sobreporem); Leads, Clientes e Sem vínculo saem também dela.
 */
export function ondeDoFiltro(orgId: string, filtro: FiltroDaCaixa): Prisma.WhatsAppConversaWhereInput {
  const viva = { orgId, arquivadaEm: null };
  switch (filtro) {
    case 'leads':
      return { ...viva, equipe: false, comunidade: false, leadId: { not: null } };
    case 'clientes':
      return { ...viva, equipe: false, comunidade: false, clienteId: { not: null } };
    case 'grupos':
      return { ...viva, grupo: true };
    case 'sem_vinculo':
      return { ...viva, leadId: null, clienteId: null, equipe: false, comunidade: false };
    case 'equipe':
      return { ...viva, equipe: true };
    case 'comunidade':
      return { ...viva, equipe: false, comunidade: true };
    case 'arquivadas':
      return { orgId, arquivadaEm: { not: null } };
    default:
      return viva;
  }
}

/** A busca por nome, número e texto de mensagem. Vazia = sem filtro. */
export function ondeDaBusca(orgId: string, q: unknown): Prisma.WhatsAppConversaWhereInput | null {
  const termo = typeof q === 'string' ? q.trim().slice(0, TETO_DA_BUSCA) : '';
  if (!termo) return null;
  const ou: Prisma.WhatsAppConversaWhereInput[] = [{ nome: { contains: termo, mode: 'insensitive' } }];
  const digitos = termo.replace(/\D/g, '');
  // Número: só quando o termo é "de número" (dígitos, espaço, +, -, parênteses), para "Loja 2" não casar todo JID com 2.
  if (digitos.length >= 3 && /^[\d\s()+-]+$/.test(termo)) ou.push({ chatJid: { contains: digitos } });
  if (termo.length >= MINIMO_PARA_BUSCAR_NO_TEXTO) {
    ou.push({ mensagens: { some: { orgId, texto: { contains: termo, mode: 'insensitive' } } } });
  }
  return { OR: ou };
}

function data(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim() || v.length > 40) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function lerParticipantes(v: Prisma.JsonValue | null): ParticipanteDoGrupo[] {
  if (!Array.isArray(v)) return [];
  const out: ParticipanteDoGrupo[] = [];
  for (const p of v) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const o = p as Record<string, unknown>;
    const numero = typeof o.numero === 'string' && /^\d{6,20}$/.test(o.numero) ? o.numero : null;
    const nome = typeof o.nome === 'string' && o.nome.trim() ? o.nome.trim().slice(0, 120) : null;
    if (!numero && !nome) continue;
    out.push({ numero, nome, admin: o.admin === true });
  }
  return out;
}

@Injectable()
export class CaixaDoWhatsappService {
  private readonly log = new Logger(CaixaDoWhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sincronizacao: SincronizacaoDoWhatsappService,
    @Inject(RESPOSTA_DE_GENTE_PELA_EVOLUTION) private readonly resposta: RespostaDeGentePelaEvolution,
    /** O cartão do Dia a dia e a bolha do menu (W4): ler, arquivar e responder mudam a conta, e o cache de 30 s é esquecido. */
    @Optional() private readonly resumo?: ResumoDoWhatsappService,
    /** Layout 27/10: abrir e mandar arquivo. Sem ela, a caixa segue de texto e o arquivo responde 503. */
    @Optional() @Inject(MIDIA_DA_CAIXA_PELA_EVOLUTION) private readonly midiaPelaEvolution?: MidiaDaCaixaPelaEvolution,
    /** Layout 27/10: onde o arquivo fica depois de aberto ou mandado. Sem as chaves do S3, abre sempre pela Evolution. */
    @Optional() private readonly storage?: StorageService,
  ) {}

  /** O storage que grava agora (configurado), ou `null`. */
  private armazem(): StorageService | null {
    return this.storage && this.storage.configured ? this.storage : null;
  }

  private podeResponder(quem: QuemNaCaixa): boolean {
    return quem.permissoes.includes('whatsapp.conversar') && !temPapelDeMaquina(quem.papeis);
  }

  private podeVincular(quem: QuemNaCaixa): boolean {
    return quem.permissoes.includes('leads.editar');
  }

  /** Gente de verdade, relida no banco: ativa, desta empresa, sem papel de máquina, com `whatsapp.conversar` agora. */
  private async exigirGente(orgId: string, quem: QuemNaCaixa): Promise<void> {
    if (!quem.id || temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem responde precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    await exigirAcessoAtual(this.prisma, orgId, quem.id, ['whatsapp.conversar']);
  }

  private async conversa(orgId: string, id: string) {
    if (typeof id !== 'string' || !id || id.length > 64) throw new NotFoundException(NAO_ACHOU);
    const c = await this.prisma.whatsAppConversa.findFirst({
      where: { id, orgId },
      select: { ...SELECT_DA_CONVERSA, participantesLista: true },
    });
    if (!c) throw new NotFoundException(NAO_ACHOU);
    return c;
  }

  private async projetarUma(orgId: string, id: string): Promise<ConversaDaCaixa> {
    const l = await this.prisma.whatsAppConversa.findFirst({ where: { id, orgId }, select: SELECT_DA_CONVERSA });
    if (!l) throw new NotFoundException(NAO_ACHOU);
    return (await projetarConversas(this.prisma, orgId, [l]))[0];
  }

  // ------------------------------------------------------------------ lista

  async listar(orgId: string, consulta: ConsultaDaLista, quem: QuemNaCaixa): Promise<ListaDaCaixa> {
    try {
      await this.sincronizacao.garantirRotina(orgId);
    } catch (e) {
      // O contrato diz que nunca lança; se lançar, a caixa abre assim mesmo.
      this.log.warn(`garantirRotina falhou: ${(e as Error).name}`);
    }
    const filtro = lerFiltroDaCaixa(consulta.filtro);
    const limite = inteiro(consulta.limite, LIMITE_DA_LISTA, TETO_DA_LISTA);
    const busca = ondeDaBusca(orgId, consulta.q);
    // Revisão 22C (A4): a busca (com o ILIKE no texto das mensagens) roda UMA vez e devolve os ids;
    // a lista e as oito contagens filtram por eles, em vez de refazer a busca em cada uma.
    const achadas = busca
      ? (await this.prisma.whatsAppConversa.findMany({ where: { AND: [{ orgId }, busca] }, select: { id: true }, take: TETO_DAS_ACHADAS })).map((c) => c.id)
      : null;
    const com = (w: Prisma.WhatsAppConversaWhereInput): Prisma.WhatsAppConversaWhereInput => (achadas ? { AND: [w, { id: { in: achadas } }] } : w);

    const [linhas, ...numeros] = await Promise.all([
      this.prisma.whatsAppConversa.findMany({
        where: com(ondeDoFiltro(orgId, filtro)),
        orderBy: [{ ultimaMensagemEm: { sort: 'desc', nulls: 'last' } }, { criadoEm: 'desc' }, { id: 'asc' }],
        take: limite + 1,
        select: SELECT_DA_CONVERSA,
      }),
      ...FILTROS_DA_CAIXA.map((f) => this.prisma.whatsAppConversa.count({ where: com(ondeDoFiltro(orgId, f)) })),
    ]);
    const contagens = Object.fromEntries(FILTROS_DA_CAIXA.map((f, i) => [f, numeros[i]])) as ListaDaCaixa['contagens'];
    const mais = linhas.length > limite;
    const conversas = await projetarConversas(this.prisma, orgId, linhas.slice(0, limite));
    return { conversas, contagens, podeResponder: this.podeResponder(quem), podeVincular: this.podeVincular(quem), mais };
  }

  // --------------------------------------------------------------- conversa

  async abrir(orgId: string, id: string, consulta: ConsultaDaConversa, quem: QuemNaCaixa): Promise<ConversaAberta> {
    const c = await this.conversa(orgId, id);
    const limite = inteiro(consulta.limite, LIMITE_DAS_MENSAGENS, TETO_DAS_MENSAGENS);
    const antesDe = data(consulta.antesDe);
    const antesDeId = typeof consulta.antesDeId === 'string' && /^[0-9a-zA-Z-]{1,64}$/.test(consulta.antesDeId) ? consulta.antesDeId : null;
    // Cursor por (timestamp, id): o WhatsApp carimba em segundos, e duas mensagens no mesmo segundo não podem sumir entre páginas.
    const cursor: Prisma.WhatsAppMensagemWhereInput = antesDe
      ? antesDeId
        ? { OR: [{ timestamp: { lt: antesDe } }, { timestamp: antesDe, id: { lt: antesDeId } }] }
        : { timestamp: { lt: antesDe } }
      : {};
    const linhas = await this.prisma.whatsAppMensagem.findMany({
      where: { orgId, conversaId: c.id, ...cursor },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: limite + 1,
      select: SELECT_DA_MENSAGEM,
    });
    const maisAntigas = linhas.length > limite;
    const pagina = linhas.slice(0, limite).reverse();
    const { participantesLista, ...linha } = c;
    const [conversa] = await projetarConversas(this.prisma, orgId, [linha]);
    return {
      conversa,
      mensagens: await projetarMensagens(this.prisma, orgId, c.id, pagina),
      maisAntigas,
      participantes: c.grupo ? lerParticipantes(participantesLista) : [],
      podeResponder: this.podeResponder(quem),
      podeVincular: this.podeVincular(quem),
    };
  }

  /** Marca como lidas as mensagens de entrada ainda não lidas e zera o contador da conversa. */
  async marcarLida(orgId: string, id: string, quem: { id: string }): Promise<{ lidas: number }> {
    const c = await this.conversa(orgId, id);
    const agora = new Date();
    const r = await this.prisma.$transaction(async (tx) => {
      const m = await tx.whatsAppMensagem.updateMany({
        where: { orgId, conversaId: c.id, deMim: false, lidaEm: null },
        data: { lidaEm: agora, lidaPorId: quem.id },
      });
      if (c.naoLidas !== 0 || m.count) await tx.whatsAppConversa.updateMany({ where: { id: c.id, orgId }, data: { naoLidas: 0 } });
      return m.count;
    });
    this.resumo?.esquecer(orgId);
    return { lidas: r };
  }

  // ---------------------------------------------------------------- arquivar

  async arquivar(orgId: string, id: string, corpo: unknown, quem: QuemNaCaixa): Promise<ConversaDaCaixa> {
    const r = ArquivarConversaSchema.safeParse(corpo);
    if (!r.success) throw new BadRequestException('Diga se a conversa fica arquivada (arquivada: true ou false).');
    await this.exigirGente(orgId, quem);
    const c = await this.conversa(orgId, id);
    const estava = !!c.arquivadaEm;
    if (estava !== r.data.arquivada) {
      await this.prisma.$transaction(async (tx) => {
        const mudou = await tx.whatsAppConversa.updateMany({
          where: { id: c.id, orgId, arquivadaEm: estava ? { not: null } : null },
          data: { arquivadaEm: r.data.arquivada ? new Date() : null },
        });
        if (!mudou.count) return;
        await tx.auditLog.create({
          data: {
            orgId,
            actorId: quem.id,
            action: r.data.arquivada ? 'whatsapp.conversa.arquivada' : 'whatsapp.conversa.desarquivada',
            entityType: 'whatsapp_conversa',
            entityId: c.id,
            before: { arquivada: estava },
            after: { arquivada: r.data.arquivada },
          },
        });
      });
      this.resumo?.esquecer(orgId);
    }
    return this.projetarUma(orgId, c.id);
  }

  // --------------------------------------------------------------- responder

  async responder(orgId: string, id: string, corpo: unknown, quem: QuemNaCaixa): Promise<RespostaEnviada> {
    const r = ResponderNaCaixaSchema.safeParse(corpo);
    if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Escreva a mensagem.');
    const texto = r.data.texto;
    await this.exigirGente(orgId, quem);
    const c = await this.conversa(orgId, id);
    if (c.arquivadaEm) throw new ConflictException('Conversa arquivada: volte-a para a caixa antes de responder.');

    // Layout 26/10 (Lucas): o cliente vê QUEM está falando: o nome de quem enviou, em negrito, na primeira
    // linha (como no WhatsApp de grupo). No OS a mensagem fica só com o texto; quem enviou vai em `enviadaPorId`.
    const [pessoa] = await this.prisma.user.findMany({ where: { id: quem.id, orgId }, select: { name: true }, take: 1 });
    const assinado = pessoa?.name?.trim() ? `*${pessoa.name.trim()}*\n${texto}` : texto;
    let externo: string;
    try {
      externo = (await this.resposta.responderComoPessoa(orgId, c.chatJid, assinado)).id;
    } catch (e) {
      throw this.falhaDoEnvio(e);
    }

    const agora = new Date();
    const gravada = await this.prisma.$transaction(async (tx) => {
      const m = await tx.whatsAppMensagem.upsert({
        where: { orgId_instancia_mensagemExternaId: { orgId, instancia: c.instancia, mensagemExternaId: externo } },
        create: {
          orgId,
          conversaId: c.id,
          instancia: c.instancia,
          chatJid: c.chatJid,
          grupo: c.grupo,
          deMim: true,
          direcao: 'saida',
          tipo: 'conversation',
          texto,
          mensagemExternaId: externo,
          timestamp: agora,
          leadId: c.leadId,
          clienteId: c.clienteId,
          enviadaPorId: quem.id,
          origem: 'caixa',
        },
        // O eco chegou antes da resposta da Evolution: a linha é a mesma, e passa a dizer quem escreveu.
        update: { enviadaPorId: quem.id, origem: 'caixa' },
        select: { id: true, timestamp: true },
      });
      await tx.whatsAppConversa.updateMany({
        where: { id: c.id, orgId, OR: [{ ultimaMensagemEm: null }, { ultimaMensagemEm: { lt: m.timestamp } }] },
        data: { ultimaMensagemEm: m.timestamp },
      });
      if (c.leadId) {
        await tx.comercialMensagem.createMany({
          data: [
            {
              id: uuidDe([orgId, 'comercial-mensagem-caixa', c.instancia, externo]),
              orgId,
              leadId: c.leadId,
              direcao: 'saida',
              provedor: 'evolution',
              destino: c.grupo ? 'grupo' : 'lead',
              texto,
              estado: 'enviada',
              enviadaEm: agora,
              mensagemExternaId: externo,
            },
          ],
          skipDuplicates: true,
        });
      }
      await tx.auditLog.create({
        data: {
          orgId,
          actorId: quem.id,
          action: 'whatsapp.mensagem.enviada_por_pessoa',
          entityType: 'whatsapp_conversa',
          entityId: c.id,
          // Sem o texto e sem o número: só o que prova que houve uma resposta e de que tamanho.
          after: { mensagemId: m.id, tamanho: texto.length, grupo: c.grupo, doLead: !!c.leadId, doCliente: !!c.clienteId },
        },
      });
      return m;
    });
    const linha = await this.prisma.whatsAppMensagem.findFirstOrThrow({ where: { id: gravada.id, orgId }, select: SELECT_DA_MENSAGEM });
    const [mensagem] = await projetarMensagens(this.prisma, orgId, c.id, [linha]);
    this.resumo?.esquecer(orgId);
    return { mensagem };
  }

  // ------------------------------------------------- Layout 27/10: o arquivo

  /**
   * O arquivo de uma mensagem desta empresa: do storage, ou da Evolution na
   * primeira vez (e então guardado no storage). Quem pode ler a conversa
   * (`leads.ver`) pode abrir. Mensagem de outra empresa é 404 igual à inexistente.
   */
  async abrirMidia(orgId: string, mensagemId: string): Promise<ArquivoDaMensagem> {
    if (typeof mensagemId !== 'string' || !/^[0-9a-zA-Z-]{1,64}$/.test(mensagemId)) throw new NotFoundException(MENSAGEM_NAO_ACHADA);
    const m = await this.prisma.whatsAppMensagem.findFirst({
      where: { id: mensagemId, orgId },
      select: { id: true, tipo: true, midia: true, mensagemExternaId: true, chatJid: true, deMim: true, grupo: true, remetenteJid: true, timestamp: true },
    });
    if (!m) throw new NotFoundException(MENSAGEM_NAO_ACHADA);
    if (!temArquivo(m.tipo)) throw new NotFoundException('Esta mensagem não tem arquivo.');
    const meta = lerMidia(m.midia);
    const chave = chaveDaMidiaNoStorage(orgId, m.id);
    const nomeDe = (mime: string | null) => nomeDoArquivo(meta?.nome, m.tipo, mime, m.timestamp);

    const armazem = this.armazem();
    if (armazem) {
      try {
        const g = await armazem.get(chave);
        const mime = mimeLimpo(g.contentType) ?? mimeLimpo(meta?.mime) ?? 'application/octet-stream';
        return { corpo: g.stream, tamanho: g.size, mime, nome: nomeDe(mime), inline: abreNoNavegador(mime) };
      } catch {
        // Ainda não está no storage (ou o storage não respondeu): vai à Evolution.
      }
    }

    if (meta?.tamanho != null && meta.tamanho > TETO_DA_MIDIA_BAIXADA) {
      throw new PayloadTooLargeException('Arquivo acima de 50 MB: abra pelo celular.');
    }
    if (!this.midiaPelaEvolution) throw new ServiceUnavailableException('Abrir arquivo do WhatsApp não está disponível agora.');
    let base64: string;
    let mimeDaEvolution: string | null;
    try {
      const b = await this.midiaPelaEvolution.baixarMidia(
        orgId,
        { id: m.mensagemExternaId, remoteJid: m.chatJid, fromMe: m.deMim, participant: m.grupo && !m.deMim ? m.remetenteJid : null },
        TETO_DA_MIDIA_BAIXADA,
      );
      base64 = b.base64;
      mimeDaEvolution = b.mime;
    } catch (e) {
      throw this.falhaDoDownload(e);
    }
    const corpo = Buffer.from(base64 ?? '', 'base64');
    if (!corpo.length) throw new GoneException(SEM_ARQUIVO_NO_WHATSAPP);
    if (corpo.length > TETO_DA_MIDIA_BAIXADA) throw new PayloadTooLargeException('Arquivo acima de 50 MB: abra pelo celular.');
    const mime = mimeLimpo(meta?.mime) ?? mimeLimpo(mimeDaEvolution) ?? 'application/octet-stream';
    if (armazem) {
      await armazem.put(chave, corpo, mime).catch((e: Error) => this.log.warn(`arquivo da mensagem não ficou no storage: ${e.name}`));
    }
    return { corpo, tamanho: corpo.length, mime, nome: nomeDe(mime), inline: abreNoNavegador(mime) };
  }

  /**
   * Manda um arquivo (foto, vídeo, áudio, documento) pela caixa. As mesmas
   * regras de `responder`: gente com `whatsapp.conversar`, conversa não
   * arquivada, o nome de quem enviou em negrito na legenda (o áudio sai sem
   * nada a mais), a mesma gravação. O arquivo entra no storage na hora, para
   * abrir na caixa sem ir à Evolution.
   */
  async responderComMidia(orgId: string, id: string, arquivo: ArquivoDaCaixa | undefined, legendaCrua: unknown, quem: QuemNaCaixa): Promise<RespostaEnviada> {
    if (!arquivo || !arquivo.buffer?.length) throw new BadRequestException('Escolha o arquivo.');
    const l = LegendaDaMidiaSchema.safeParse(typeof legendaCrua === 'string' ? legendaCrua : undefined);
    if (!l.success) throw new BadRequestException(l.error.issues[0]?.message ?? 'Legenda inválida.');
    const legenda = l.data;
    const mime = mimeLimpo(arquivo.mimetype) ?? 'application/octet-stream';
    const tipo = tipoDaMidiaParaEnviar(mime);
    if (arquivo.buffer.length > tetoDaMidiaParaEnviar(tipo)) throw new PayloadTooLargeException(fraseDoTetoDaMidia(tipo));
    await this.exigirGente(orgId, quem);
    const c = await this.conversa(orgId, id);
    if (c.arquivadaEm) throw new ConflictException('Conversa arquivada: volte-a para a caixa antes de responder.');
    if (!this.midiaPelaEvolution) throw new ServiceUnavailableException('Mandar arquivo pelo WhatsApp não está disponível agora. Nada foi enviado.');

    const agora = new Date();
    const nome = nomeDoArquivo(arquivo.originalname, tipo, mime, agora);
    // A mesma assinatura do texto (layout 26/10): o nome de quem enviou, em negrito, na primeira linha da legenda.
    const [pessoa] = await this.prisma.user.findMany({ where: { id: quem.id, orgId }, select: { name: true }, take: 1 });
    const assinatura = pessoa?.name?.trim() ? `*${pessoa.name.trim()}*` : '';
    const legendaQueSai = tipo === 'audio' ? null : [assinatura, legenda].filter(Boolean).join('\n') || null;
    let externo: string;
    try {
      externo = (
        await this.midiaPelaEvolution.responderMidiaComoPessoa(orgId, c.chatJid, {
          tipo,
          mime,
          base64: arquivo.buffer.toString('base64'),
          nome,
          legenda: legendaQueSai,
        })
      ).id;
    } catch (e) {
      throw this.falhaDoEnvio(e);
    }

    const textoNoOs = tipo === 'audio' ? null : legenda || null;
    const midia = { mime, nome, tamanho: arquivo.buffer.length, segundos: null };
    const gravada = await this.prisma.$transaction(async (tx) => {
      const m = await tx.whatsAppMensagem.upsert({
        where: { orgId_instancia_mensagemExternaId: { orgId, instancia: c.instancia, mensagemExternaId: externo } },
        create: {
          orgId,
          conversaId: c.id,
          instancia: c.instancia,
          chatJid: c.chatJid,
          grupo: c.grupo,
          deMim: true,
          direcao: 'saida',
          tipo,
          texto: textoNoOs,
          midia,
          mensagemExternaId: externo,
          timestamp: agora,
          leadId: c.leadId,
          clienteId: c.clienteId,
          enviadaPorId: quem.id,
          origem: 'caixa',
        },
        // O eco chegou antes: a linha é a mesma, passa a dizer quem enviou, e fica com a legenda sem a assinatura.
        update: { enviadaPorId: quem.id, origem: 'caixa', texto: textoNoOs, midia },
        select: { id: true, timestamp: true },
      });
      await tx.whatsAppConversa.updateMany({
        where: { id: c.id, orgId, OR: [{ ultimaMensagemEm: null }, { ultimaMensagemEm: { lt: m.timestamp } }] },
        data: { ultimaMensagemEm: m.timestamp },
      });
      if (c.leadId) {
        await tx.comercialMensagem.createMany({
          data: [
            {
              id: uuidDe([orgId, 'comercial-mensagem-caixa', c.instancia, externo]),
              orgId,
              leadId: c.leadId,
              direcao: 'saida',
              provedor: 'evolution',
              destino: c.grupo ? 'grupo' : 'lead',
              // O fio do lead é de texto: o arquivo entra como "documento: proposta.pdf", com a legenda embaixo.
              texto: [`${rotuloDoTipoDeMensagem(tipo)}: ${nome}`, textoNoOs].filter(Boolean).join('\n'),
              estado: 'enviada',
              enviadaEm: agora,
              mensagemExternaId: externo,
            },
          ],
          skipDuplicates: true,
        });
      }
      await tx.auditLog.create({
        data: {
          orgId,
          actorId: quem.id,
          action: 'whatsapp.midia.enviada_por_pessoa',
          entityType: 'whatsapp_conversa',
          entityId: c.id,
          // Sem o nome do arquivo, sem a legenda e sem o número: só o tipo e o tamanho.
          after: { mensagemId: m.id, tipo, bytes: arquivo.buffer.length, grupo: c.grupo, doLead: !!c.leadId, doCliente: !!c.clienteId },
        },
      });
      return m;
    });

    const armazem = this.armazem();
    if (armazem) {
      await armazem
        .put(chaveDaMidiaNoStorage(orgId, gravada.id), arquivo.buffer, mime)
        .catch((e: Error) => this.log.warn(`arquivo enviado não ficou no storage (abre pela Evolution): ${e.name}`));
    }
    const linha = await this.prisma.whatsAppMensagem.findFirstOrThrow({ where: { id: gravada.id, orgId }, select: SELECT_DA_MENSAGEM });
    const [mensagem] = await projetarMensagens(this.prisma, orgId, c.id, [linha]);
    this.resumo?.esquecer(orgId);
    return { mensagem };
  }

  /** A frase de quando o arquivo não veio da Evolution. Nunca leva número nem nome de arquivo. */
  private falhaDoDownload(e: unknown): Error {
    const nome = e instanceof Error ? e.name : '';
    const msg = e instanceof Error ? e.message : '';
    this.log.warn(`arquivo da mensagem não veio da Evolution: ${nome || 'erro'}`);
    if (nome === 'EvolutionNaoConfiguradaError') return new ServiceUnavailableException(msg || 'O WhatsApp não está configurado nesta empresa.');
    if (nome === 'CorpoAcimaDoTetoError') return new PayloadTooLargeException('Arquivo acima de 50 MB: abra pelo celular.');
    if (nome === 'EvolutionRespondeuErro') {
      const status = (e as { status?: unknown }).status;
      // A Evolution responde 400 (ou 404) quando não acha a mensagem ou o WhatsApp já apagou a mídia.
      if (status === 400 || status === 404 || status === 410) return new GoneException(SEM_ARQUIVO_NO_WHATSAPP);
      return new BadGatewayException(`A Evolution não entregou o arquivo${typeof status === 'number' ? ` (HTTP ${status})` : ''}. Tente de novo.`);
    }
    if (nome === 'TimeoutError' || nome === 'AbortError') return new BadGatewayException('A Evolution não entregou o arquivo a tempo. Tente de novo.');
    return new ServiceUnavailableException('A Evolution não respondeu. Tente de novo.');
  }

  /** A frase da falha do envio. Nada é gravado como enviado. Nunca leva número nem texto. */
  private falhaDoEnvio(e: unknown): Error {
    const nome = e instanceof Error ? e.name : '';
    const msg = e instanceof Error ? e.message : '';
    this.log.warn(`resposta pela caixa não saiu: ${nome || 'erro'}`);
    if (nome === 'EvolutionNaoConfiguradaError') {
      return new ServiceUnavailableException(`${msg || 'O WhatsApp não está configurado nesta empresa.'} Nada foi enviado.`);
    }
    if (nome === 'EvolutionRespondeuErro') {
      const status = (e as { status?: unknown }).status;
      return new BadGatewayException(`A Evolution recusou o envio${typeof status === 'number' ? ` (HTTP ${status})` : ''}. Nada foi enviado.`);
    }
    if (/não devolveu o id/.test(msg)) {
      return new BadGatewayException('A Evolution não confirmou o envio. Confira no celular antes de repetir.');
    }
    if (/não é uma conversa do WhatsApp/.test(msg)) {
      return new BadRequestException('Esta conversa não tem um destino de WhatsApp válido. Nada foi enviado.');
    }
    // Revisão 22C (A1): estourou o prazo, a Evolution pode ter entregado sem responder a tempo.
    // Dizer "nada foi enviado" levava a pessoa a repetir e o cliente a receber duas vezes.
    if (nome === 'TimeoutError' || nome === 'AbortError') {
      return new BadGatewayException('A Evolution não confirmou o envio a tempo. Confira no celular antes de repetir.');
    }
        return new ServiceUnavailableException('A Evolution não respondeu. Nada foi enviado; tente de novo.');
  }
}
