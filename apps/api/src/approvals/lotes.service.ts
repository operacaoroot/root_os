import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalState, ItemDoLoteEstado, LoteEstado, type Prisma } from '@prisma/client';
import { diaNoFuso } from '@mktos/shared';
import { AuditService } from '../audit/audit.service';
import { exigirTenant } from '../common/contexto-execucao';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { fusoDaPolitica } from '../policy/limites';
import { mensagemDeErro, validarArgs } from '../gateway/validacao';
import { canonicalHash } from './approvals.service';
import {
  hashDoLote,
  modoDeAprovacao,
  motivoDaRecusaDoItem,
  ordenarItens,
  type ContadorDoItem,
  type ItemParaOHash,
} from './lotes';

/*
 * A APROVAÇÃO DE LOTE COM USO CONTADO (MD7, 24/09/2026).
 *
 * A invariante 4 ganhou a segunda forma: "aprovação é de uso único — ou de uso
 * contado, item a item, quando a capacidade declara lote —, presa ao conteúdo
 * exato e com prazo". Este serviço é a metade de BANCO dela:
 *
 *  - `montar` grava a lista (o lote em `proposta` e um item por saída), com o
 *    hash do conteúdo exato de cada item e o hash da lista inteira;
 *  - `ativar` é o efeito da capacidade `lote` (hoje `pauta.semana.aprovar`,
 *    R4): roda depois de outra pessoa assinar a aprovação comum dela, e só
 *    liga o lote — escrita interna;
 *  - `consumirItem` é o uso contado, e é o coração: UMA instrução, chamada pela
 *    porta no lugar de propor ou consumir token;
 *  - `revogar*` derrubam um item (a peça mudou) ou o lote inteiro.
 *
 * O pedido de assinatura (que passa pela porta) e a inscrição do efeito moram
 * em `assinatura-de-lote.service.ts`: este serviço não conhece a porta, e é
 * isso que deixa a porta depender dele sem ciclo.
 */

/** Um item como quem monta o lote o descreve. */
export interface ItemParaMontar {
  capabilityId: string;
  recursoId: string;
  /** Os argumentos EXATOS que a porta vai receber na hora (sem o `loteItemId`). */
  args: Record<string, unknown>;
  janelaDe: Date;
  janelaAte: Date;
  usoMaximo?: number;
  tetoPorDia?: number | null;
}

export interface LoteMontado {
  loteId: string;
  hashConteudo: string;
  validaAte: string;
  itens: Array<{ id: string; capabilityId: string; recursoId: string; hashItem: string }>;
}

/** O que a porta leva do consumo para o RASTRO (R4: os campos do lote e o contador). */
export interface ConsumoDoItem {
  ok: true;
  itemId: string;
  loteId: string;
  approvalId: string | null;
  hashConteudo: string;
  hashItem: string;
  aprovadoPorId: string | null;
  aprovadoEm: Date | null;
  motivo: string | null;
  estadoAnterior: ContadorDoItem;
  estadoNovo: ContadorDoItem;
}

export type ResultadoDoConsumo = ConsumoDoItem | { ok: false; motivo: string };

/** O lote e os itens, como a fila de aprovação e a tela mostram. */
export interface DetalheDoLote {
  id: string;
  capabilityId: string;
  recursoTipo: string;
  recursoId: string;
  hashConteudo: string;
  estado: LoteEstado;
  validaAte: string;
  approvalId: string | null;
  propostoPorId: string;
  aprovadoPorId: string | null;
  aprovadoEm: string | null;
  motivo: string | null;
  resumo: string;
  itens: Array<{
    id: string;
    capabilityId: string;
    recursoId: string;
    hashItem: string;
    janelaDe: string;
    janelaAte: string;
    usos: number;
    usoMaximo: number;
    tetoPorDia: number | null;
    estado: ItemDoLoteEstado;
    motivoDaRevogacao: string | null;
  }>;
}

const DIA_MS = 86_400_000;

/** O lote como a reação à ativação o recebe (MD8): só o que foi assinado. */
export interface LoteQueAtivou {
  id: string;
  orgId: string;
  capabilityId: string;
  recursoTipo: string;
  recursoId: string;
  aprovadoPorId: string;
  itens: Array<{ id: string; capabilityId: string; recursoId: string; hashItem: string; estado: ItemDoLoteEstado; janelaDe: Date; janelaAte: Date }>;
}

/**
 * O que o DONO do recurso faz quando o lote dele é ativado — a semana (MD8)
 * aprova as peças e leva o episódio a Agendado. Roda na MESMA transação que liga
 * o lote: ou os dois acontecem, ou nenhum. Não escreve em lote nem em item: o
 * item que não pode valer volta em `revogar`, e quem escreve é este serviço.
 */
export type ReacaoAoAtivar = (
  tx: Prisma.TransactionClient,
  lote: LoteQueAtivou,
) => Promise<{ revogar: Array<{ itemId: string; motivo: string }>; resumo?: Record<string, unknown> }>;

/** O item vivo de um recurso: ativo, num lote que ainda vale (montado, na fila ou ativo). */
export interface ItemVivo {
  itemId: string;
  loteId: string;
  estadoDoLote: LoteEstado;
  estadoDoItem: ItemDoLoteEstado;
  janelaDe: Date;
  janelaAte: Date;
  hashItem: string;
}

const LOTES_EM_CURSO: LoteEstado[] = [LoteEstado.proposta, LoteEstado.aguardando, LoteEstado.ativo];

/** A linha que `consumirItem` devolve do `RETURNING`. */
interface LinhaConsumida {
  id: string;
  loteId: string;
  hashItem: string;
  usos: number;
  usoMaximo: number;
  usosNoDia: number;
  diaDoContador: string | null;
  tetoPorDia: number | null;
  hashConteudo: string;
  aprovadoPorId: string | null;
  aprovadoEm: Date | null;
  motivo: string | null;
  approvalId: string | null;
}

@Injectable()
export class LotesService {
  private readonly log = new Logger('Lotes');
  /** Quem reage à ativação, por tipo de recurso do lote. Uma inscrição por tipo. */
  private readonly reacoes = new Map<string, { fn: ReacaoAoAtivar; dono: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  /**
   * O dono de um tipo de recurso se inscreve para reagir à ativação (a pauta
   * inscreve `pauta_episodio`). Por registro, e não por import: `approvals` não
   * conhece a pauta. Reinscrever o mesmo tipo é ERRO, como no registro de
   * efeitos — a segunda inscrição não pode vencer em silêncio.
   */
  aoAtivar(recursoTipo: string, fn: ReacaoAoAtivar, dono: string): void {
    const ja = this.reacoes.get(recursoTipo);
    if (ja) throw new Error(`A ativação de lote de "${recursoTipo}" já tem dono (${ja.dono}); ${dono} não pode se inscrever de novo.`);
    this.reacoes.set(recursoTipo, { fn, dono });
  }

  // ------------------------------------------------------------------ montar

  /**
   * Grava a lista em `proposta`. Nada sai daqui: o lote só vale depois de
   * ativado pelo efeito da capacidade `lote`, que exige a assinatura de outra
   * pessoa na fila.
   *
   * As conferências são as do catálogo, repetidas em execução porque a
   * política é da EMPRESA (pode ter sobrescrita): a capacidade do lote declara
   * `modo: lote`; cada item é de capacidade `sob_lote` que aponta para ela; a
   * lista cabe em `tetoDeItens`; o prazo cabe em `validadeMaximaDias`; cada
   * janela cabe no prazo; e os argumentos passam no `argsSchema` de hoje — um
   * item que a porta recusaria na hora não entra na assinatura.
   */
  async montar(input: {
    orgId: string;
    capabilityId: string;
    recursoTipo: string;
    recursoId: string;
    propostoPorId: string;
    validaAte: Date;
    itens: readonly ItemParaMontar[];
    resumo?: string;
    agora?: Date;
  }): Promise<LoteMontado> {
    const orgId = exigirTenant(input.orgId, 'LotesService.montar');
    const agora = input.agora ?? new Date();
    const capLote = this.policy.resolverCapacidade(orgId, input.capabilityId);
    const modo = modoDeAprovacao(capLote);
    if (!capLote || modo?.modo !== 'lote') {
      throw new BadRequestException(`"${input.capabilityId}" não aprova lote nesta empresa (o catálogo não declara modo lote).`);
    }
    if (!input.itens.length) throw new BadRequestException('O lote precisa de ao menos um item.');
    if (input.itens.length > modo.tetoDeItens) {
      throw new BadRequestException(`O lote aceita até ${modo.tetoDeItens} itens; vieram ${input.itens.length}.`);
    }
    if (input.validaAte.getTime() <= agora.getTime()) throw new BadRequestException('O prazo do lote já passou.');
    if (input.validaAte.getTime() > agora.getTime() + modo.validadeMaximaDias * DIA_MS) {
      throw new BadRequestException(`O lote vale no máximo ${modo.validadeMaximaDias} dias.`);
    }

    const vistos = new Set<string>();
    const itens: Array<ItemParaOHash & { janelaDeData: Date; janelaAteData: Date }> = [];
    for (const i of input.itens) {
      const onde = `${i.capabilityId} (${i.recursoId})`;
      const capItem = this.policy.resolverCapacidade(orgId, i.capabilityId);
      const modoItem = modoDeAprovacao(capItem);
      if (!capItem || modoItem?.modo !== 'sob_lote' || modoItem.lote !== input.capabilityId) {
        throw new BadRequestException(`${onde}: esta capacidade não sai por lote de "${input.capabilityId}".`);
      }
      if (vistos.has(`${i.capabilityId}|${i.recursoId}`)) throw new BadRequestException(`${onde}: item repetido no lote.`);
      vistos.add(`${i.capabilityId}|${i.recursoId}`);
      if (Object.prototype.hasOwnProperty.call(i.args ?? {}, 'loteItemId')) {
        throw new BadRequestException(`${onde}: o loteItemId não faz parte do conteúdo assinado.`);
      }
      const erros = validarArgs((capItem as { argsSchema?: unknown }).argsSchema, i.args ?? {});
      if (erros.length) throw new BadRequestException(`${onde}: ${mensagemDeErro(erros)}`);
      if (!(i.janelaAte.getTime() > i.janelaDe.getTime())) throw new BadRequestException(`${onde}: a janela termina antes de começar.`);
      if (i.janelaAte.getTime() > input.validaAte.getTime()) throw new BadRequestException(`${onde}: a janela passa do prazo do lote.`);
      const usoMaximo = i.usoMaximo ?? 1;
      if (!Number.isInteger(usoMaximo) || usoMaximo < 1) throw new BadRequestException(`${onde}: usoMaximo inválido.`);
      const tetoPorDia = i.tetoPorDia ?? null;
      if (tetoPorDia !== null && (!Number.isInteger(tetoPorDia) || tetoPorDia < 1)) {
        throw new BadRequestException(`${onde}: tetoPorDia inválido.`);
      }
      itens.push({
        capabilityId: i.capabilityId,
        recursoId: i.recursoId,
        hashItem: this.hashDoItem(orgId, i.capabilityId, i.args ?? {}),
        janelaDe: i.janelaDe.toISOString(),
        janelaAte: i.janelaAte.toISOString(),
        usoMaximo,
        tetoPorDia,
        janelaDeData: i.janelaDe,
        janelaAteData: i.janelaAte,
      });
    }

    const validaAte = input.validaAte.toISOString();
    const hashConteudo = hashDoLote({ capabilityId: input.capabilityId, validaAte, itens });
    const ordenados = ordenarItens(itens);

    const lote = await this.prisma.aprovacaoDeLote.create({
      data: {
        orgId,
        capabilityId: input.capabilityId,
        recursoTipo: input.recursoTipo,
        recursoId: input.recursoId,
        hashConteudo,
        validaAte: input.validaAte,
        propostoPorId: input.propostoPorId,
        resumo: (input.resumo ?? `${ordenados.length} item(ns) de ${input.recursoTipo} ${input.recursoId}`).slice(0, 500),
        itens: {
          create: ordenados.map((i) => ({
            orgId,
            capabilityId: i.capabilityId,
            recursoId: i.recursoId,
            hashItem: i.hashItem,
            janelaDe: i.janelaDeData,
            janelaAte: i.janelaAteData,
            usoMaximo: i.usoMaximo,
            tetoPorDia: i.tetoPorDia,
          })),
        },
      },
      select: { id: true, itens: { select: { id: true, capabilityId: true, recursoId: true, hashItem: true } } },
    });

    await this.audit.log({
      orgId,
      actorId: input.propostoPorId,
      action: 'lote.montado',
      entityType: 'aprovacao_de_lote',
      entityId: lote.id,
      after: { capabilityId: input.capabilityId, recurso: `${input.recursoTipo}:${input.recursoId}`, itens: ordenados.length, hashConteudo: hashConteudo.slice(0, 12), validaAte },
    });
    return { loteId: lote.id, hashConteudo, validaAte, itens: lote.itens };
  }

  /** O hash do conteúdo de um item: o mesmo que a porta calcula na hora. */
  hashDoItem(orgId: string, capabilityId: string, args: Record<string, unknown>): string {
    const cap = this.policy.resolverCapacidade(orgId, capabilityId);
    const chaves = (cap as unknown as { hashKeys?: string[] } | null)?.hashKeys ?? [];
    return canonicalHash(capabilityId, args, chaves);
  }

  /** Os argumentos da capacidade `lote` para este lote — o que a pessoa assina. */
  async argsDaAssinatura(orgId: string, loteId: string): Promise<{
    args: { loteId: string; hashConteudo: string; totalDeItens: number; validaAte: string };
    lote: { capabilityId: string; estado: LoteEstado; approvalId: string | null; propostoPorId: string; resumo: string; validaAte: Date };
  }> {
    const lote = await this.prisma.aprovacaoDeLote.findFirst({
      where: { id: loteId, orgId },
      select: {
        id: true, capabilityId: true, estado: true, approvalId: true, propostoPorId: true, resumo: true,
        hashConteudo: true, validaAte: true, _count: { select: { itens: true } },
      },
    });
    if (!lote) throw new NotFoundException('Lote não encontrado.');
    return {
      args: { loteId: lote.id, hashConteudo: lote.hashConteudo, totalDeItens: lote._count.itens, validaAte: lote.validaAte.toISOString() },
      lote,
    };
  }

  /**
   * Marca o lote como `aguardando` a aprovação criada agora. Escrita
   * condicionada ao estado lido: "pedir de novo" troca a aprovação e mantém o
   * hash, sem remontar nada.
   */
  async marcarAguardando(orgId: string, loteId: string, approvalId: string, estadoLido: LoteEstado, approvalLido: string | null): Promise<boolean> {
    const { count } = await this.prisma.aprovacaoDeLote.updateMany({
      where: { id: loteId, orgId, estado: estadoLido, approvalId: approvalLido },
      data: { estado: LoteEstado.aguardando, approvalId },
    });
    return count === 1;
  }

  // ------------------------------------------------------------------ ativar

  /**
   * O EFEITO da capacidade `lote`, disparado pela porta depois de a aprovação
   * R4 ser confirmada por outra pessoa e consumida. Só liga o lote.
   *
   * Confere, antes de escrever, que o que foi assinado é o que está gravado:
   * o `hashConteudo` dos argumentos, o recalculado dos itens de agora, o total
   * e o prazo; que a aprovação é a do pedido em curso (a de um pedido antigo
   * não ativa); e que quem assinou não é quem montou o lote. Qualquer "não"
   * LANÇA, e a porta registra `acao.falhou` com o motivo.
   */
  async ativar(
    args: Record<string, unknown>,
    orgId: string,
    ctx: { approvalId?: string | null; actorId?: string | null },
  ): Promise<{
    loteId: string;
    estadoAnterior: { estado: LoteEstado };
    estadoNovo: { estado: LoteEstado; itens: number; validaAte: string; revogadosNaAtivacao?: number };
  }> {
    exigirTenant(orgId, 'LotesService.ativar');
    const loteId = typeof args.loteId === 'string' ? args.loteId : '';
    const lote = await this.prisma.aprovacaoDeLote.findFirst({
      where: { id: loteId, orgId },
      include: { itens: true },
    });
    if (!lote) throw new NotFoundException('Lote não encontrado: nada foi ativado.');
    if (!ctx.approvalId) {
      throw new ForbiddenException('O lote só é ativado pela aprovação assinada na fila: nada foi ativado.');
    }
    if (lote.approvalId !== ctx.approvalId) {
      throw new ConflictException('Esta aprovação é de um pedido antigo deste lote (houve outro pedido depois): nada foi ativado.');
    }
    if (lote.estado !== LoteEstado.aguardando) {
      throw new ConflictException(`O lote está ${lote.estado}, não aguardando assinatura: nada foi ativado.`);
    }
    if (lote.validaAte.getTime() <= Date.now()) throw new BadRequestException('O prazo do lote passou antes da assinatura: nada foi ativado.');

    const recalculado = hashDoLote({
      capabilityId: lote.capabilityId,
      validaAte: lote.validaAte.toISOString(),
      itens: lote.itens.map((i) => ({
        capabilityId: i.capabilityId,
        recursoId: i.recursoId,
        hashItem: i.hashItem,
        janelaDe: i.janelaDe.toISOString(),
        janelaAte: i.janelaAte.toISOString(),
        usoMaximo: i.usoMaximo,
        tetoPorDia: i.tetoPorDia,
      })),
    });
    const assinado = typeof args.hashConteudo === 'string' ? args.hashConteudo : '';
    if (assinado !== lote.hashConteudo || recalculado !== lote.hashConteudo) {
      throw new ForbiddenException('A lista gravada não é a que foi assinada (o hash difere): nada foi ativado.');
    }
    if (args.totalDeItens !== lote.itens.length || args.validaAte !== lote.validaAte.toISOString()) {
      throw new ForbiddenException('O total de itens ou o prazo não são os que foram assinados: nada foi ativado.');
    }

    const ap = await this.prisma.approval.findFirst({
      where: { id: ctx.approvalId, orgId },
      select: { status: true, aprovadoPorId: true, aprovadoEm: true, motivo: true, propostoPorId: true },
    });
    if (!ap?.aprovadoPorId || (ap.status !== ApprovalState.consumida && ap.status !== ApprovalState.confirmada)) {
      throw new ForbiddenException('A aprovação do lote não está assinada: nada foi ativado.');
    }
    // Invariante 7, do lado do lote: quem montou a lista não a assina, mesmo
    // que o pedido de assinatura tenha saído de outra conta.
    if (ap.aprovadoPorId === lote.propostoPorId || ap.aprovadoPorId === ap.propostoPorId) {
      throw new ForbiddenException('Quem propôs o lote não pode aprová-lo: nada foi ativado.');
    }

    /*
     * Ligar o lote e a reação do dono do recurso (a semana aprova as peças e
     * agenda o episódio, MD8) numa transação só: um lote ativo cujas peças
     * continuassem em rascunho não publicaria nada e diria que publica. O item
     * que a reação não consegue fazer valer (a peça mudou depois de montado)
     * cai aqui mesmo, e o resto segue.
     */
    const aprovadoPorId = ap.aprovadoPorId;
    const reacao = this.reacoes.get(lote.recursoTipo);
    const { revogados, resumo, encerrado } = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.aprovacaoDeLote.updateMany({
        where: { id: lote.id, orgId, estado: LoteEstado.aguardando, approvalId: ctx.approvalId },
        data: { estado: LoteEstado.ativo, aprovadoPorId, aprovadoEm: ap.aprovadoEm ?? new Date(), motivo: ap.motivo },
      });
      if (count !== 1) throw new ConflictException('O lote mudou enquanto era ativado: nada foi ativado.');
      if (!reacao) return { revogados: [] as Array<{ itemId: string; motivo: string }>, resumo: undefined, encerrado: false };
      // Os itens relidos DEPOIS de ligar o lote: o que foi revogado entre a
      // leitura de fora e aqui não chega à reação como ativo.
      const itensAgora = await tx.itemDoLote.findMany({
        where: { loteId: lote.id, orgId },
        select: { id: true, capabilityId: true, recursoId: true, hashItem: true, estado: true, janelaDe: true, janelaAte: true },
      });
      const r = await reacao.fn(tx, {
        id: lote.id,
        orgId,
        capabilityId: lote.capabilityId,
        recursoTipo: lote.recursoTipo,
        recursoId: lote.recursoId,
        aprovadoPorId,
        itens: itensAgora,
      });
      const doLote = new Set(lote.itens.map((i) => i.id));
      const revogar = r.revogar.filter((x) => doLote.has(x.itemId));
      for (const x of revogar) {
        await tx.itemDoLote.updateMany({
          where: { id: x.itemId, loteId: lote.id, orgId, estado: ItemDoLoteEstado.ativo },
          data: { estado: ItemDoLoteEstado.revogado, revogadoEm: new Date(), motivoDaRevogacao: x.motivo.slice(0, 300) },
        });
      }
      const restam = await tx.itemDoLote.count({ where: { loteId: lote.id, orgId, estado: ItemDoLoteEstado.ativo } });
      if (restam === 0) {
        await tx.aprovacaoDeLote.updateMany({ where: { id: lote.id, orgId, estado: LoteEstado.ativo }, data: { estado: LoteEstado.encerrado } });
      }
      return { revogados: revogar, resumo: r.resumo, encerrado: restam === 0 };
    });

    await this.audit.log({
      orgId,
      actorId: aprovadoPorId,
      action: 'lote.ativado',
      entityType: 'aprovacao_de_lote',
      entityId: lote.id,
      after: {
        approvalId: ctx.approvalId,
        itens: lote.itens.length,
        hashConteudo: lote.hashConteudo.slice(0, 12),
        validaAte: lote.validaAte.toISOString(),
        ...(revogados.length ? { revogadosNaAtivacao: revogados.map((x) => ({ itemId: x.itemId, motivo: x.motivo.slice(0, 200) })) } : {}),
        ...(resumo ? { reacao: resumo } : {}),
        ...(encerrado ? { encerrado: true } : {}),
      } as Prisma.InputJsonValue,
    });
    this.log.log(`lote ${lote.id} ativado (${lote.itens.length} itens) por ${ap.aprovadoPorId}`);
    return {
      loteId: lote.id,
      estadoAnterior: { estado: LoteEstado.aguardando },
      estadoNovo: {
        estado: encerrado ? LoteEstado.encerrado : LoteEstado.ativo,
        itens: lote.itens.length,
        validaAte: lote.validaAte.toISOString(),
        ...(revogados.length ? { revogadosNaAtivacao: revogados.length } : {}),
      },
    };
  }

  // ------------------------------------------------------------------ consumir

  /**
   * O USO CONTADO — uma instrução só, e é nela que mora a segurança.
   *
   * Ler e depois escrever deixaria dois pedidos simultâneos lerem `usos = 0` e
   * publicarem os dois. Aqui o `UPDATE ... WHERE` confere tudo na mesma
   * escrita: a empresa, a capacidade e o recurso do item, o lote ativo, da
   * capacidade que o catálogo aponta e dentro do prazo, o item ativo, dentro da
   * janela, com uso sobrando e com o hash do conteúdo de AGORA igual ao
   * assinado; e, quando o item tem teto por dia (a DM do MD11), a virada do
   * dia em São Paulo dentro da mesma escrita (o SQL do item 6 da MC18). Zero
   * linhas é recusa.
   *
   * O relógio é o do processo (`agora`), como o resto da porta: a janela e o
   * prazo são comparados com o mesmo instante que a régua usou para decidir.
   */
  async consumirItem(input: {
    orgId: string;
    loteItemId: string;
    capabilityId: string;
    recursoId: string;
    hashAtual: string;
    loteDaCapacidade: string;
    agora?: Date;
  }): Promise<ResultadoDoConsumo> {
    const orgId = exigirTenant(input.orgId, 'LotesService.consumirItem');
    const agora = input.agora ?? new Date();
    const hoje = diaNoFuso(agora, fusoDaPolitica());

    const linhas = await this.prisma.$queryRaw<LinhaConsumida[]>`
      UPDATE "ItemDoLote" AS i
         SET "usos"          = i."usos" + 1,
             "consumidoEm"   = ${agora},
             "usosNoDia"     = CASE WHEN i."tetoPorDia" IS NULL THEN i."usosNoDia"
                                    WHEN i."diaDoContador" = ${hoje} THEN i."usosNoDia" + 1
                                    ELSE 1 END,
             "diaDoContador" = CASE WHEN i."tetoPorDia" IS NULL THEN i."diaDoContador" ELSE ${hoje} END,
             "estado"        = CASE WHEN i."usos" + 1 >= i."usoMaximo" THEN 'consumido'::"ItemDoLoteEstado"
                                    ELSE i."estado" END
        FROM "AprovacaoDeLote" AS l
       WHERE i."id" = ${input.loteItemId}
         AND i."orgId" = ${orgId}
         AND l."id" = i."loteId"
         AND l."orgId" = ${orgId}
         AND l."capabilityId" = ${input.loteDaCapacidade}
         AND l."estado" = 'ativo'::"LoteEstado"
         AND l."validaAte" > ${agora}
         AND i."capabilityId" = ${input.capabilityId}
         AND i."recursoId" = ${input.recursoId}
         AND i."estado" = 'ativo'::"ItemDoLoteEstado"
         AND ${agora} BETWEEN i."janelaDe" AND i."janelaAte"
         AND i."usos" < i."usoMaximo"
         AND i."hashItem" = ${input.hashAtual}
         AND (i."tetoPorDia" IS NULL OR i."diaDoContador" IS DISTINCT FROM ${hoje} OR i."usosNoDia" < i."tetoPorDia")
      RETURNING i."id", i."loteId", i."hashItem", i."usos", i."usoMaximo", i."usosNoDia", i."diaDoContador", i."tetoPorDia",
                l."hashConteudo", l."aprovadoPorId", l."aprovadoEm", l."motivo", l."approvalId"
    `;

    const r = linhas[0];
    if (!r) {
      const item = await this.prisma.itemDoLote.findFirst({
        where: { id: input.loteItemId, orgId },
        select: {
          capabilityId: true, recursoId: true, estado: true, janelaDe: true, janelaAte: true, usos: true, usoMaximo: true,
          hashItem: true, tetoPorDia: true, usosNoDia: true, diaDoContador: true,
          lote: { select: { estado: true, validaAte: true, capabilityId: true } },
        },
      });
      return { ok: false, motivo: motivoDaRecusaDoItem(item, { ...input, agora, hoje }) };
    }

    /*
     * O uso já foi gasto (o UPDATE acima é autocommit). Encerrar o lote é
     * arrumação: se ela falhar aqui e subisse, a porta registraria recusa e
     * não chamaria o efeito de uma saída assinada que já contou o uso. O lote
     * sem item ativo não autoriza nada de qualquer jeito, e o próximo consumo
     * ou revogação tenta de novo.
     */
    try {
      await this.encerrarSeAcabou(orgId, r.loteId);
    } catch (e) {
      this.log.warn(`[lote] ${r.loteId}: o uso contou, mas encerrar o lote falhou: ${(e as Error).message}`);
    }
    const contador = (usos: number, usosNoDia: number, dia: string | null): ContadorDoItem => ({
      usos,
      usoMaximo: r.usoMaximo,
      ...(r.tetoPorDia !== null ? { dia, usosNoDia } : {}),
    });
    // O contador do dia é o de HOJE nos dois lados: antes deste uso, hoje
    // tinha um a menos (zero, quando este foi o primeiro depois da virada).
    return {
      ok: true,
      itemId: r.id,
      loteId: r.loteId,
      approvalId: r.approvalId,
      hashConteudo: r.hashConteudo,
      hashItem: r.hashItem,
      aprovadoPorId: r.aprovadoPorId,
      aprovadoEm: r.aprovadoEm,
      motivo: r.motivo,
      estadoAnterior: contador(r.usos - 1, Math.max(r.usosNoDia - 1, 0), r.diaDoContador),
      estadoNovo: contador(r.usos, r.usosNoDia, r.diaDoContador),
    };
  }

  /** Lote sem item ativo vira `encerrado`. Escrita condicionada: não pisa em revogado. */
  private async encerrarSeAcabou(orgId: string, loteId: string): Promise<void> {
    const restam = await this.prisma.itemDoLote.count({ where: { loteId, orgId, estado: ItemDoLoteEstado.ativo } });
    if (restam > 0) return;
    await this.prisma.aprovacaoDeLote.updateMany({ where: { id: loteId, orgId, estado: LoteEstado.ativo }, data: { estado: LoteEstado.encerrado } });
  }

  // ------------------------------------------------------------------ revogar

  /**
   * Derruba SÓ os itens ativos daquele recurso, em lotes que ainda valem.
   * É o que a edição de uma peça depois da assinatura chama (MD8): a peça
   * volta a rascunho e o resto da semana segue publicando. O hash no consumo
   * já recusaria o conteúdo novo; revogar deixa isso dito, com o motivo.
   */
  async revogarItensDoRecurso(orgId: string, capabilityId: string, recursoId: string, motivo: string, actorId: string): Promise<number> {
    exigirTenant(orgId, 'LotesService.revogarItensDoRecurso');
    const alvo = {
      orgId,
      capabilityId,
      recursoId,
      estado: ItemDoLoteEstado.ativo,
      lote: { estado: { in: [LoteEstado.proposta, LoteEstado.aguardando, LoteEstado.ativo] } },
    };
    const achados = await this.prisma.itemDoLote.findMany({ where: alvo, select: { id: true, loteId: true } });
    if (!achados.length) return 0;
    // A escrita repete o filtro: o que foi consumido entre a leitura e aqui fica como está.
    const { count } = await this.prisma.itemDoLote.updateMany({
      where: { ...alvo, id: { in: achados.map((i) => i.id) } },
      data: { estado: ItemDoLoteEstado.revogado, revogadoEm: new Date(), motivoDaRevogacao: motivo.slice(0, 300) },
    });
    if (count) {
      await this.audit.log({
        orgId,
        actorId,
        action: 'lote.item_revogado',
        entityType: 'recurso_do_lote',
        entityId: recursoId,
        after: { capabilityId, itens: achados.map((i) => i.id), motivo: motivo.slice(0, 300) },
      });
      // Derrubar o último item ativo encerra o lote, como o último consumo.
      for (const loteId of new Set(achados.map((i) => i.loteId))) {
        await this.encerrarSeAcabou(orgId, loteId);
      }
    }
    return count;
  }

  /**
   * Revoga o lote inteiro. Só diminui o alcance, e por isso não pede
   * assinatura (MD8: "Cancelar a semana" é R1). O que já saiu não volta.
   */
  async revogarLote(
    orgId: string,
    loteId: string,
    motivo: string,
    actorId: string,
    estados: readonly LoteEstado[] = LOTES_EM_CURSO,
  ): Promise<DetalheDoLote> {
    exigirTenant(orgId, 'LotesService.revogarLote');
    const { count } = await this.prisma.aprovacaoDeLote.updateMany({
      where: { id: loteId, orgId, estado: { in: [...estados] } },
      data: { estado: LoteEstado.revogado },
    });
    if (count === 1) {
      await this.prisma.itemDoLote.updateMany({
        where: { loteId, orgId, estado: ItemDoLoteEstado.ativo },
        data: { estado: ItemDoLoteEstado.revogado, revogadoEm: new Date(), motivoDaRevogacao: motivo.slice(0, 300) },
      });
      await this.audit.log({ orgId, actorId, action: 'lote.revogado', entityType: 'aprovacao_de_lote', entityId: loteId, after: { motivo: motivo.slice(0, 300) } });
    }
    return this.detalhe(orgId, loteId);
  }

  /** Grava `vencido` nos lotes da empresa que passaram do prazo (limpeza; a leitura já calcula). */
  async expirarVencidos(orgId: string, agora = new Date()): Promise<number> {
    exigirTenant(orgId, 'LotesService.expirarVencidos');
    const { count } = await this.prisma.aprovacaoDeLote.updateMany({
      where: { orgId, estado: { in: [LoteEstado.proposta, LoteEstado.aguardando, LoteEstado.ativo] }, validaAte: { lte: agora } },
      data: { estado: LoteEstado.vencido },
    });
    return count;
  }

  // ------------------------------------------------------------------ leitura

  /**
   * O item vivo de cada recurso (MD8): ativo, num lote que ainda vale e está
   * montado, na fila ou ativo. Leitura para a tela e para a rotina saber QUAL
   * item mandar à porta — quem decide se ele vale é o consumo, na porta.
   */
  async itensVivos(
    orgId: string,
    capabilityId: string,
    recursoIds: readonly string[],
    agora = new Date(),
    opcoes: { mesmoVencido?: boolean } = {},
  ): Promise<Map<string, ItemVivo>> {
    exigirTenant(orgId, 'LotesService.itensVivos');
    if (!recursoIds.length) return new Map();
    const itens = await this.prisma.itemDoLote.findMany({
      where: {
        orgId,
        capabilityId,
        recursoId: { in: [...recursoIds] },
        estado: ItemDoLoteEstado.ativo,
        // `mesmoVencido`: a rotina precisa achar o item do lote que venceu com ela
        // parada, para dar a peça por perdida em vez de deixá-la aprovada calada.
        lote: { estado: { in: LOTES_EM_CURSO }, ...(opcoes.mesmoVencido ? {} : { validaAte: { gt: agora } }) },
      },
      select: { id: true, recursoId: true, janelaDe: true, janelaAte: true, hashItem: true, estado: true, loteId: true, lote: { select: { estado: true, criadoEm: true } } },
      orderBy: { janelaDe: 'asc' },
    });
    // Um recurso em dois lotes vivos (um ativo e um montado depois dele): vale o ativo, depois o mais novo.
    const peso = (e: LoteEstado) => (e === LoteEstado.ativo ? 2 : e === LoteEstado.aguardando ? 1 : 0);
    const mapa = new Map<string, ItemVivo & { criadoEm: Date }>();
    for (const i of itens) {
      const atual = mapa.get(i.recursoId);
      const melhor =
        !atual || peso(i.lote.estado) > peso(atual.estadoDoLote) || (peso(i.lote.estado) === peso(atual.estadoDoLote) && i.lote.criadoEm > atual.criadoEm);
      if (melhor) {
        mapa.set(i.recursoId, {
          itemId: i.id, loteId: i.loteId, estadoDoLote: i.lote.estado, estadoDoItem: i.estado,
          janelaDe: i.janelaDe, janelaAte: i.janelaAte, hashItem: i.hashItem, criadoEm: i.lote.criadoEm,
        });
      }
    }
    return new Map([...mapa].map(([k, { criadoEm: _c, ...v }]) => [k, v]));
  }

  /** Os lotes em curso de um recurso (o episódio), do mais novo: a aba Semana os mostra. */
  async lotesEmCurso(orgId: string, capabilityId: string, recursoTipo: string, recursoId: string, agora = new Date()) {
    exigirTenant(orgId, 'LotesService.lotesEmCurso');
    const ls = await this.prisma.aprovacaoDeLote.findMany({
      where: { orgId, capabilityId, recursoTipo, recursoId, estado: { in: LOTES_EM_CURSO }, validaAte: { gt: agora } },
      orderBy: { criadoEm: 'desc' },
      select: {
        id: true, estado: true, validaAte: true, hashConteudo: true, approvalId: true, aprovadoEm: true, propostoPorId: true,
        _count: { select: { itens: true } },
        itens: { where: { estado: ItemDoLoteEstado.ativo }, select: { id: true } },
      },
      take: 10,
    });
    return ls.map((l) => ({
      id: l.id,
      estado: l.estado,
      validaAte: l.validaAte,
      hashConteudo: l.hashConteudo,
      approvalId: l.approvalId,
      aprovadoEm: l.aprovadoEm,
      propostoPorId: l.propostoPorId,
      itens: l._count.itens,
      ativos: l.itens.length,
    }));
  }

  async detalhe(orgId: string, loteId: string): Promise<DetalheDoLote> {
    const l = await this.prisma.aprovacaoDeLote.findFirst({
      where: { id: loteId, orgId },
      include: { itens: { orderBy: [{ janelaDe: 'asc' }, { capabilityId: 'asc' }, { recursoId: 'asc' }] } },
    });
    if (!l) throw new NotFoundException('Lote não encontrado.');
    // Como a fila de aprovação: ninguém roda o expirador, então o prazo é
    // conferido aqui, por cálculo. O consumo já recusa lote vencido de qualquer jeito.
    const emCurso: LoteEstado[] = [LoteEstado.proposta, LoteEstado.aguardando, LoteEstado.ativo];
    const estado = emCurso.includes(l.estado) && l.validaAte.getTime() <= Date.now() ? LoteEstado.vencido : l.estado;
    return {
      id: l.id,
      capabilityId: l.capabilityId,
      recursoTipo: l.recursoTipo,
      recursoId: l.recursoId,
      hashConteudo: l.hashConteudo,
      estado,
      validaAte: l.validaAte.toISOString(),
      approvalId: l.approvalId,
      propostoPorId: l.propostoPorId,
      aprovadoPorId: l.aprovadoPorId,
      aprovadoEm: l.aprovadoEm?.toISOString() ?? null,
      motivo: l.motivo,
      resumo: l.resumo,
      itens: l.itens.map((i) => ({
        id: i.id,
        capabilityId: i.capabilityId,
        recursoId: i.recursoId,
        hashItem: i.hashItem,
        janelaDe: i.janelaDe.toISOString(),
        janelaAte: i.janelaAte.toISOString(),
        usos: i.usos,
        usoMaximo: i.usoMaximo,
        tetoPorDia: i.tetoPorDia,
        estado: i.estado,
        motivoDaRevogacao: i.motivoDaRevogacao,
      })),
    };
  }
}
