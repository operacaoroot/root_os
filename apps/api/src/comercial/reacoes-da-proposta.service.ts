import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PROPOSTA_BLOCOS_DA_SECAO,
  PROPOSTA_SECOES,
  PROPOSTA_TEXTO_MAX,
  SalaPropostaLeituraSchema,
  SalaPropostaReacaoSchema,
  type AnotacaoDoLead,
  type AnotacaoNaProposta,
  type LeituraDaSecao,
  type PropostaSecao,
  type ReacoesDaPropostaDoLead,
  type ReacoesNaPaginaDaProposta,
  type SalaBlocoDaProposta,
} from '@mktos/shared';
import { Prisma } from '@prisma/client';

import { comTenantPublico } from '../common/tenant-publico';
import { varrerSegredos } from '../onboarding/trilho/segredos';
import { PrismaService } from '../prisma/prisma.service';
import { hashDoConteudo, uuidDe } from './eventos';
import { FioService } from './fio.service';
import { chaveDaDuvida } from './sala-projecao';
import { SalaService } from './sala.service';

/*
 * A PROPOSTA MEDE LEITURA E COLHE IDEIAS — rodada da implantação I4 (18/10/2026).
 *
 * A página `/s/<token>/proposta` divide a proposta em três seções e, em cada
 * uma, mede o tempo visível e oferece três reações: "faz sentido", "tenho uma
 * dúvida" e "anotar uma ideia". Tudo grava em `LeadReacao` (filha de Lead) e
 * vira fato no fio pelo `FioService`, com id derivado:
 *
 *   · LEITURA: uma linha por (versão, seção, visita), com os segundos SOMADOS
 *     até `LEITURA_TETO_POR_LINHA`. O id é derivado dessa chave e a soma é um
 *     `INSERT … ON CONFLICT` só: duas batidas simultâneas não perdem segundo e
 *     não criam segunda linha. A PRIMEIRA batida de uma seção numa visita
 *     grava também o `proposta.lida` dos blocos dela pelo caminho da sala
 *     (`SalaService.registrarBlocoLido`): o termômetro e o follow-up de antes
 *     continuam valendo sem saber que a página nova existe.
 *   · FAZ SENTIDO: uma linha por (versão, seção, visita). O segundo clique cai
 *     na mesma linha e no mesmo fato `proposta.reagida`.
 *   · DÚVIDA e IDEIA: uma linha por envio. O id deriva do texto JÁ MASCARADO
 *     na mesma visita e seção: a rede que repete o pedido não duplica, e o
 *     cliente que escreve outra coisa ganha outra linha. A dúvida segue pelo
 *     `proposta.duvida` de sempre (o assistente da proposta a recebe, cercada
 *     em `promptDaDuvida`); a ideia vira `proposta.ideia`.
 *
 * O TEXTO DO CLIENTE É DADO NÃO CONFIÁVEL. Chega aparado e limitado pelo schema
 * (1.000), passa pela varredura de segredos do onboarding (`varrerSegredos`:
 * "a senha é X" vira `[segredo removido]`) ANTES de gravar, e nunca vai a prompt
 * por este serviço. Se um dia uma ideia for a modelo (o resumo do relatório,
 * por exemplo), vai cercada por `blocoExterno` como toda entrada de terceiro, e
 * entra no inventário de cercas do `adversarial.test.ts`. Visita, leitura e
 * reação só GRAVAM: nada aqui dispara efeito fora do banco.
 *
 * Nenhum dado pessoal além do token: a visita é o número `SalaDoCliente.acessos`
 * (o mesmo que o `proposta.lida` já usa), sem IP nem navegador.
 */

/** O teto de segundos de UMA linha de leitura (seção × visita): aba esquecida aberta não vira "leu oito horas". */
export const LEITURA_TETO_POR_LINHA = 3600;

type Resolvida = { salaId: string; leadId: string; orgId: string };
type Linha = {
  id: string;
  versao: number;
  secao: string;
  tipo: string;
  texto: string | null;
  segundos: number | null;
  acesso: number;
  respondidaEm: Date | null;
  tarefaId: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
};

function ehSecao(s: string): s is PropostaSecao {
  return (PROPOSTA_SECOES as readonly string[]).includes(s);
}

/** Corta em pontos de código, não em unidades UTF-16: o CHECK do banco conta `char_length`. */
function ate(texto: string, max: number): string {
  const pontos = Array.from(texto);
  return pontos.length > max ? pontos.slice(0, max).join('') : texto;
}

@Injectable()
export class ReacoesDaPropostaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly sala: SalaService,
  ) {}

  // -------------------------------------------------------------------------
  // As rotas anônimas (a página do cliente)
  // -------------------------------------------------------------------------

  /** O que a página mostra das reações do próprio cliente, na versão vigente. */
  async daPagina(token: string): Promise<ReacoesNaPaginaDaProposta> {
    const r = await this.sala.resolver(token);
    return comTenantPublico(r.orgId, async () => {
      const versao = await this.sala.versaoVigenteDaProposta(r.leadId);
      return this.estadoDaPagina(r, versao);
    });
  }

  /** "faz sentido", "tenho uma dúvida" ou "anotar uma ideia" numa seção. */
  async reagir(token: string, corpo: unknown, agora: Date = new Date()): Promise<ReacoesNaPaginaDaProposta> {
    const input = this.validar(SalaPropostaReacaoSchema, corpo);
    const r = await this.sala.resolver(token, agora);
    return comTenantPublico(r.orgId, async () => {
      const versao = await this.exigirVigente(r.leadId, input.versao);
      const acesso = await this.acessoDeAgora(r.salaId);
      if (input.tipo === 'faz_sentido') {
        const id = uuidDe([r.orgId, 'lead-reacao', r.leadId, 'faz_sentido', String(versao), input.secao, String(acesso)]);
        const criada = await this.prisma.leadReacao.createMany({
          data: [{ id, leadId: r.leadId, versao, secao: input.secao, tipo: 'faz_sentido', acesso, criadoEm: agora }],
          skipDuplicates: true,
        });
        if (criada.count === 1) {
          await this.fio.registrar(r.orgId, r.leadId, 'proposta.reagida', `${versao}:${input.secao}:${acesso}`, { versao, secao: input.secao, reacao: 'faz_sentido', visita: acesso, reacaoId: id }, { em: agora });
        }
        return this.estadoDaPagina(r, versao);
      }

      // Dúvida e ideia: o segredo sai ANTES de qualquer gravação, e o corte final
      // garante o CHECK do banco (a marca pode ser mais longa que o valor mascarado).
      const texto = ate(varrerSegredos(input.texto ?? '').texto.trim(), PROPOSTA_TEXTO_MAX);
      if (!texto) throw new BadRequestException('texto: escreva a sua anotação antes de enviar');
      const id = uuidDe([r.orgId, 'lead-reacao', r.leadId, input.tipo, String(versao), input.secao, String(acesso), hashDoConteudo(texto)]);
      const criada = await this.prisma.leadReacao.createMany({
        data: [{ id, leadId: r.leadId, versao, secao: input.secao, tipo: input.tipo, texto, acesso, criadoEm: agora }],
        skipDuplicates: true,
      });
      if (criada.count === 1) {
        if (input.tipo === 'duvida') {
          // O mesmo fato da dúvida da sala: o assistente da proposta e a fila da mesa a recebem como sempre.
          await this.fio.registrar(r.orgId, r.leadId, 'proposta.duvida', chaveDaDuvida(versao, texto), { versao, pergunta: texto, resposta: null, secao: input.secao }, { em: agora });
        } else {
          await this.fio.registrar(r.orgId, r.leadId, 'proposta.ideia', id, { versao, secao: input.secao, texto, visita: acesso, reacaoId: id }, { em: agora });
        }
      }
      return this.estadoDaPagina(r, versao);
    });
  }

  /**
   * Uma batida de leitura. Soma os segundos na linha da (versão, seção, visita)
   * e, na primeira batida da seção nesta visita, grava o `proposta.lida` dos
   * blocos que a proposta TEM (sem outra opção, o bloco "alternativa" não conta
   * como lido; sem quadro, o de "custos" também não).
   */
  async ler(token: string, corpo: unknown, agora: Date = new Date()): Promise<{ secao: PropostaSecao; segundos: number }> {
    const input = this.validar(SalaPropostaLeituraSchema, corpo);
    const r = await this.sala.resolver(token, agora);
    return comTenantPublico(r.orgId, async () => {
      const versao = await this.exigirVigente(r.leadId, input.versao);
      const acesso = await this.acessoDeAgora(r.salaId);
      const id = uuidDe([r.orgId, 'lead-reacao', r.leadId, 'leitura', String(versao), input.secao, String(acesso)]);
      const segundos = Math.min(input.segundos, LEITURA_TETO_POR_LINHA);
      // `xmax = 0` só na linha recém-inserida: é assim que a primeira batida se reconhece numa instrução só.
      const [linha] = await this.prisma.$queryRaw<{ criada: boolean; segundos: number }[]>(Prisma.sql`
        INSERT INTO "LeadReacao" ("id", "leadId", "versao", "secao", "tipo", "segundos", "acesso", "criadoEm", "atualizadoEm")
        VALUES (${id}, ${r.leadId}, ${versao}, ${input.secao}, 'leitura', ${segundos}, ${acesso}, ${agora}, ${agora})
        ON CONFLICT ("id") DO UPDATE
          SET "segundos" = LEAST(${LEITURA_TETO_POR_LINHA}, "LeadReacao"."segundos" + EXCLUDED."segundos"),
              "atualizadoEm" = EXCLUDED."atualizadoEm"
        RETURNING (xmax = 0) AS "criada", "segundos"
      `);
      if (linha?.criada) {
        for (const bloco of await this.blocosPresentes(r.orgId, r.leadId, input.secao)) {
          await this.sala.registrarBlocoLido(r.orgId, r.leadId, versao, bloco, acesso, input.secao);
        }
      }
      return { secao: input.secao, segundos: Number(linha?.segundos ?? segundos) };
    });
  }

  // -------------------------------------------------------------------------
  // A bancada (rota interna; a lane I5 lê daqui também)
  // -------------------------------------------------------------------------

  /**
   * A leitura e as reações da proposta do lead, na empresa de quem pergunta.
   * Lead de outra empresa é 404 (a consulta já filtra por `orgId`, e o banco
   * filtra de novo pela política de linha).
   */
  async doLead(orgId: string, leadId: string): Promise<ReacoesDaPropostaDoLead> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('lead não encontrado nesta empresa');
    const [sala, publicadas, linhas] = await Promise.all([
      this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId }, select: { acessos: true, ultimoAcessoEm: true } }),
      this.prisma.leadEvent.findMany({ where: { leadId, orgId, type: 'proposta.publicada' }, select: { payload: true }, take: 50 }),
      this.prisma.leadReacao.findMany({ where: { leadId, orgId }, orderBy: { criadoEm: 'asc' }, take: 2000 }),
    ]);
    const versoes = publicadas.map((e) => Number(((e.payload ?? {}) as Record<string, unknown>).versao ?? 0)).filter((v) => v > 0);
    return {
      leadId,
      versaoVigente: versoes.length ? Math.max(...versoes) : null,
      acessosDaSala: sala?.acessos ?? 0,
      ultimoAcessoEm: sala?.ultimoAcessoEm?.toISOString() ?? null,
      ...agregar(linhas as Linha[]),
    };
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  private async estadoDaPagina(r: Resolvida, versao: number): Promise<ReacoesNaPaginaDaProposta> {
    const acesso = await this.acessoDeAgora(r.salaId);
    const linhas = (await this.prisma.leadReacao.findMany({
      where: { leadId: r.leadId, versao, tipo: { in: ['faz_sentido', 'duvida', 'ideia'] } },
      orderBy: { criadoEm: 'asc' },
      take: 500,
    })) as Linha[];
    const anotacoes: AnotacaoNaProposta[] = linhas
      .filter((l) => (l.tipo === 'duvida' || l.tipo === 'ideia') && ehSecao(l.secao) && l.texto)
      .map((l) => ({ id: l.id, secao: l.secao as PropostaSecao, tipo: l.tipo as 'duvida' | 'ideia', texto: l.texto!, em: l.criadoEm.toISOString() }));
    const fazSentido = PROPOSTA_SECOES.filter((s) => linhas.some((l) => l.tipo === 'faz_sentido' && l.secao === s && l.acesso === acesso));
    return {
      versao,
      acesso,
      fazSentido,
      anotacoes,
      contagem: { anotacoes: anotacoes.filter((a) => a.tipo === 'ideia').length, duvidas: anotacoes.filter((a) => a.tipo === 'duvida').length },
    };
  }

  /** A visita de agora: o contador da sala. A página conta a visita ao abrir; a reação só lê o número. */
  private async acessoDeAgora(salaId: string): Promise<number> {
    const sala = await this.prisma.salaDoCliente.findUniqueOrThrow({ where: { id: salaId }, select: { acessos: true } });
    return sala.acessos;
  }

  /** Versão do pedido que não é a vigente = 409 (a proposta mudou com a página aberta). */
  private async exigirVigente(leadId: string, versao: number): Promise<number> {
    const vigente = await this.sala.versaoVigenteDaProposta(leadId);
    if (vigente !== versao) throw new ConflictException(`a proposta mudou: a versão vigente é a ${vigente}. Recarregue a página.`);
    return vigente;
  }

  /** Os blocos da seção que a proposta vigente de fato mostra (a mesma projeção da sala). */
  private async blocosPresentes(orgId: string, leadId: string, secao: PropostaSecao): Promise<SalaBlocoDaProposta[]> {
    const p = (await this.sala.estadoDoLead(orgId, leadId))?.proposta;
    if (!p) return [];
    return PROPOSTA_BLOCOS_DA_SECAO[secao].filter((b) => (b === 'alternativa' ? Boolean(p.alternativa) : b === 'custos' ? Boolean(p.custosDeTerceiros) : true));
  }

  private validar<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } }, corpo: unknown): T {
    const r = schema.safeParse(corpo ?? {});
    if (!r.success) {
      const i = r.error.issues[0];
      throw new BadRequestException(i ? `${i.path.join('.') || 'corpo'}: ${i.message}` : 'pedido inválido');
    }
    return r.data;
  }
}

/** As linhas do banco viram a leitura por seção (todas as versões) e as reações. Parte pura, testável sem banco. */
export function agregar(linhas: readonly Linha[]): Pick<ReacoesDaPropostaDoLead, 'leitura' | 'fazSentido' | 'anotacoes'> {
  const porSecao = new Map<string, LeituraDaSecao & { visitas: Set<number> }>();
  const fazSentido: ReacoesDaPropostaDoLead['fazSentido'] = [];
  const anotacoes: AnotacaoDoLead[] = [];
  for (const l of linhas) {
    if (!ehSecao(l.secao)) continue;
    if (l.tipo === 'leitura') {
      const chave = `${l.versao}:${l.secao}`;
      const atual = porSecao.get(chave) ?? { versao: l.versao, secao: l.secao, acessos: 0, segundos: 0, ultimaEm: l.atualizadoEm.toISOString(), visitas: new Set<number>() };
      atual.visitas.add(l.acesso);
      atual.acessos = atual.visitas.size;
      atual.segundos += l.segundos ?? 0;
      if (l.atualizadoEm.toISOString() > atual.ultimaEm) atual.ultimaEm = l.atualizadoEm.toISOString();
      porSecao.set(chave, atual);
    } else if (l.tipo === 'faz_sentido') {
      fazSentido.push({ versao: l.versao, secao: l.secao, acesso: l.acesso, em: l.criadoEm.toISOString() });
    } else if ((l.tipo === 'duvida' || l.tipo === 'ideia') && l.texto) {
      anotacoes.push({
        id: l.id,
        secao: l.secao,
        tipo: l.tipo,
        texto: l.texto,
        em: l.criadoEm.toISOString(),
        versao: l.versao,
        acesso: l.acesso,
        respondidaEm: l.respondidaEm?.toISOString() ?? null,
        tarefaId: l.tarefaId,
      });
    }
  }
  const leitura = [...porSecao.values()]
    .map(({ visitas: _v, ...resto }) => resto)
    .sort((a, b) => a.versao - b.versao || PROPOSTA_SECOES.indexOf(a.secao) - PROPOSTA_SECOES.indexOf(b.secao));
  return { leitura, fazSentido, anotacoes };
}
