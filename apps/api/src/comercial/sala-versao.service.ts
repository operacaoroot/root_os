import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  AreaItemRascunhoSchema, SalaRascunhoSchema, ehConteudoDeItem, ehItemDaArea, itemDaArea, itemTemRascunho,
  type AreaItemId, type AreaItemRascunhoInput, type ConteudoDaSalaPublicada, type ConteudoGuardadoDoItemDaArea, type PassoDaSalaPublicada,
  type SalaRascunhoInput, type SalaVersaoPublica, type VersoesDaSala, type VersoesDoItemDaArea,
} from '@mktos/shared';
import { ActorType, ApprovalState, Prisma } from '@prisma/client';

import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { PrismaService } from '../prisma/prisma.service';
import { edicoesPorVersao } from './area-do-cliente-projecao';
import { hashDoConteudo } from './eventos';
import { FioService } from './fio.service';
import { conteudoDaVersao, escritoDoConteudo, hashDaSala } from './sala-versao';

/*
 * O MOTOR DE PUBLICAÇÃO DA SALA (rodada da implantação I3, 18/10/2026).
 *
 * A sala `/s/<token>` passa a ser publicada POR VERSÃO. A bancada monta o
 * rascunho (próximos passos com dono e data, o combinado, quem cuida da conta;
 * as estações e os publicados vêm do fio e do trilho) e PUBLICAR é a
 * capacidade `comercial.sala.publicar` (R3, delta 1.9.0) pela porta: fica
 * retida e uma SEGUNDA pessoa libera em /atendimento, como toda publicação da
 * casa. O efeito relê a versão, confere o hash contra o que a aprovação prende
 * e só então a marca publicada (a anterior vira substituída) e grava
 * `sala.publicada` no fio.
 *
 * O CLIENTE SÓ VÊ A ÚLTIMA PUBLICADA (`publicadaDaSala`, lida pelo
 * `SalaService.estado`). O rascunho e a versão na porta nunca saem.
 *
 * Uma versão aberta por lead (rascunho ou na porta), garantida também no banco
 * (índice único parcial). Editar a versão que está na porta a devolve a
 * rascunho: a aprovação pendente passa a não bater e o efeito recusa.
 *
 * A ÁREA DO CLIENTE (leva A, 30/10/2026): a mesma tabela, a mesma capacidade e
 * a mesma porta publicam agora POR ITEM. `SalaVersao.item` nulo é a versão da
 * sala de sempre (tudo acima continua valendo, palavra por palavra); `item`
 * preenchido é a versão de um dos quinze itens da área (`AREA_ITENS`), com uma
 * versão aberta por (lead, item). O número continua único por lead: a aprovação
 * prende `leadId:vN` e o efeito lê o item da própria versão, então o catálogo
 * da política não muda (os argumentos seguem `leadId`, `versao`, `hash`). O
 * cliente lê a última publicada DE CADA item. Item `derivado` (o OS monta
 * sozinho) não tem rascunho: a tentativa é recusada com o motivo.
 */

export const CAPACIDADE_DA_SALA = 'comercial.sala.publicar';

type P = Record<string, unknown>;
type EstadoAberto = 'rascunho' | 'na_porta';
const ABERTOS: readonly EstadoAberto[] = ['rascunho', 'na_porta'];

function ehRetida(r: unknown): r is { status: 'aguardando_aprovacao'; approvalId: string } {
  return Boolean(r && typeof r === 'object' && (r as P).status === 'aguardando_aprovacao' && typeof (r as P).approvalId === 'string');
}

/** O escrito de um item, lido de volta do conteúdo guardado (sem o id do item). */
export function escritoDoItem(c: unknown): AreaItemRascunhoInput | null {
  if (!ehConteudoDeItem(c)) return null;
  const { item: _item, ...escrito } = c;
  return escrito;
}

@Injectable()
export class SalaVersaoService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly efeitos: EfeitosRegistry,
    private readonly operador: PortaDoOperador,
  ) {}

  onModuleInit(): void {
    this.inscrever();
  }

  /** Separado para a suíte montar à mão. */
  inscrever(): void {
    this.efeitos.registrar({ [CAPACIDADE_DA_SALA]: (args, orgId, ctx) => this.efeitoDePublicar(args, orgId, ctx) }, 'comercial/sala-versao.service');
  }

  /** O conteúdo como sairia agora, a partir do que está gravado (fio, ficha, trilho) e do que a bancada escreveu. */
  private async montar(orgId: string, leadId: string, escrito: SalaRascunhoInput | null, agora: Date): Promise<ConteudoDaSalaPublicada> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const [ficha, eventos] = await Promise.all([
      this.prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { empresa: true, reuniaoEm: true, kickoffEm: true, trilhoId: true, donoId: true, socioDaConta: true } }),
      this.prisma.leadEvent.findMany({
        where: { leadId, orgId, type: { in: ['ata.chegou', 'cliente.ativo', 'proposta.publicada', 'proposta.aceita', 'contrato.gerado', 'contrato.assinado_cliente', 'contrato.assinado_root'] } },
        select: { type: true, occurredAt: true, payload: true },
      }),
    ]);
    const trilho = ficha?.trilhoId
      ? await this.prisma.onboardingTrilho.findFirst({
          where: { id: ficha.trilhoId, orgId },
          select: { kickoffEm: true, proximoPasso: true, proximoPassoDono: true, proximoPassoEm: true, marcos: { where: { tipo: { in: ['memoria.carregada', 'fase.avancou'] } }, select: { tipo: true, em: true, dados: true } } },
        })
      : null;
    const dono = ficha?.donoId ? await this.prisma.user.findFirst({ where: { id: ficha.donoId, orgId }, select: { name: true } }) : null;
    const passoDoTrilho: PassoDaSalaPublicada | null =
      trilho?.proximoPasso && trilho.proximoPassoDono && trilho.proximoPassoEm
        ? { oque: trilho.proximoPasso.slice(0, 140), quando: trilho.proximoPassoEm.toISOString().slice(0, 10), comQuem: trilho.proximoPassoDono.slice(0, 60) }
        : null;
    return conteudoDaVersao({
      agora,
      nomeDoLead: lead.name,
      empresa: ficha?.empresa ?? null,
      eventos,
      reuniaoEm: ficha?.reuniaoEm ?? null,
      kickoffEm: trilho?.kickoffEm ?? ficha?.kickoffEm ?? null,
      temTrilho: !!trilho,
      marcos: trilho?.marcos ?? [],
      dono: dono?.name ?? ficha?.socioDaConta ?? null,
      escrito,
      passoDoTrilho,
    });
  }

  /** A versão aberta (rascunho ou na porta) da sala (`item` nulo) ou de um item. */
  private async aberta(orgId: string, leadId: string, item: string | null = null) {
    return this.prisma.salaVersao.findFirst({ where: { leadId, orgId, item, estado: { in: [...ABERTOS] } } });
  }

  /** O próximo número: único por lead, cobrindo a sala e os itens (a aprovação prende `leadId:vN`). */
  private async proximoNumero(orgId: string, leadId: string): Promise<number> {
    const max = await this.prisma.salaVersao.aggregate({ where: { leadId, orgId }, _max: { numero: true } });
    return (max._max.numero ?? 0) + 1;
  }

  // -------------------------------------------------------------------------
  // A sala inteira (I3): a versão com `item` nulo
  // -------------------------------------------------------------------------

  /** A bancada: o rascunho (ou o que seria o rascunho), a publicada e o histórico. */
  async versoes(orgId: string, leadId: string, agora: Date = new Date()): Promise<VersoesDaSala> {
    const [aberta, publicada, historico, sala] = await Promise.all([
      this.aberta(orgId, leadId),
      this.prisma.salaVersao.findFirst({ where: { leadId, orgId, item: null, estado: 'publicada' }, orderBy: { numero: 'desc' } }),
      this.prisma.salaVersao.findMany({ where: { leadId, orgId, item: null, estado: { in: ['publicada', 'substituida'] } }, orderBy: { numero: 'desc' }, take: 20, select: { numero: true, estado: true, publicadaEm: true, hash: true } }),
      this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId }, select: { id: true } }),
    ]);
    // O rascunho mostra o derivado DE AGORA (estações e publicados andam com o fio) sobre o que a bancada escreveu.
    const escrito = aberta ? escritoDoConteudo(aberta.conteudo as unknown as ConteudoDaSalaPublicada)
      : publicada ? escritoDoConteudo(publicada.conteudo as unknown as ConteudoDaSalaPublicada) : null;
    const conteudo = await this.montar(orgId, leadId, escrito, agora);
    return {
      leadId,
      rascunho: {
        versao: aberta?.numero ?? (await this.proximoNumero(orgId, leadId)),
        estado: aberta ? (aberta.estado as EstadoAberto) : 'novo',
        conteudo,
        hash: hashDaSala(conteudo),
        approvalId: aberta?.approvalId ?? null,
        atualizadoEm: aberta?.atualizadoEm.toISOString() ?? null,
      },
      publicada: publicada
        ? {
            versao: publicada.numero,
            publicadaEm: (publicada.publicadaEm ?? publicada.atualizadoEm).toISOString(),
            conteudo: publicada.conteudo as unknown as ConteudoDaSalaPublicada,
            hash: publicada.hash,
            publicadaPor: publicada.publicadaPor,
          }
        : null,
      historico: historico.map((h) => ({ versao: h.numero, estado: h.estado as 'publicada' | 'substituida', publicadaEm: h.publicadaEm?.toISOString() ?? null, hash: h.hash })),
      temSala: !!sala,
    };
  }

  /** Grava o que a bancada escreveu. Editar a versão na porta a devolve a rascunho (a aprovação pendente deixa de bater). */
  async salvarRascunho(orgId: string, leadId: string, corpo: unknown, quem: { id: string }, agora: Date = new Date()): Promise<VersoesDaSala> {
    const r = SalaRascunhoSchema.safeParse(corpo);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const conteudo = await this.montar(orgId, leadId, r.data, agora);
    await this.gravarAberta(orgId, leadId, null, conteudo as unknown as Prisma.InputJsonValue, hashDaSala(conteudo), quem);
    return this.versoes(orgId, leadId, agora);
  }

  /**
   * A versão aberta (da sala ou do item) recebe o conteúdo e volta a rascunho;
   * sem aberta, nasce uma com o próximo número. Sob o cadeado do lead: a sala e
   * os itens partilham a numeração, e dois cliques não abrem duas versões.
   */
  private async gravarAberta(orgId: string, leadId: string, item: string | null, conteudo: Prisma.InputJsonValue, hash: string, quem: { id: string }): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sala-versao:${leadId}`}))`;
      const aberta = await tx.salaVersao.findFirst({ where: { leadId, orgId, item, estado: { in: [...ABERTOS] } } });
      if (aberta) {
        await tx.salaVersao.update({ where: { id: aberta.id }, data: { conteudo, hash, estado: 'rascunho', approvalId: null } });
        return aberta.numero;
      }
      const max = await tx.salaVersao.aggregate({ where: { leadId, orgId }, _max: { numero: true } });
      const numero = (max._max.numero ?? 0) + 1;
      await tx.salaVersao.create({ data: { orgId, leadId, item, numero, estado: 'rascunho', conteudo, hash, criadoPor: quem.id } });
      return numero;
    });
  }

  /** A aprovação pendente desta versão ainda vale (pendente dentro do prazo, ou confirmada e por executar)? */
  private async aprovacaoViva(orgId: string, approvalId: string): Promise<boolean> {
    const viva = await this.prisma.approval.findFirst({
      where: { id: approvalId, orgId, OR: [{ status: ApprovalState.pendente, expiraEm: { gt: new Date() } }, { status: ApprovalState.confirmada }] },
      select: { id: true },
    });
    return Boolean(viva);
  }

  /** Entrega a versão à porta (R3) e, retida, a marca `na_porta` com o id da aprovação. */
  private async pedirPublicacao(orgId: string, leadId: string, versao: number, hash: string, quem: { id: string }): Promise<string | null> {
    const resposta = await this.operador.executar({
      orgId,
      actorId: quem.id,
      actorType: ActorType.user,
      capabilityId: CAPACIDADE_DA_SALA,
      args: { leadId, versao, hash },
      resource: { type: 'comercial.sala', id: `${leadId}:v${versao}` },
    });
    if (!ehRetida(resposta)) return null;
    await this.prisma.salaVersao.updateMany({ where: { leadId, orgId, numero: versao, estado: 'rascunho', hash }, data: { estado: 'na_porta', approvalId: resposta.approvalId } });
    return resposta.approvalId;
  }

  /**
   * Publicar: recalcula o derivado de agora, congela o conteúdo e o hash na
   * versão aberta (cria a partir da última publicada se não há rascunho) e
   * entrega à porta. R3: volta retida, `na_porta`, com o id da aprovação.
   */
  async publicar(orgId: string, leadId: string, quem: { id: string }, agora: Date = new Date()): Promise<VersoesDaSala & { approvalId: string | null; estado: string }> {
    const sala = await this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId }, select: { id: true } });
    if (!sala) throw new ConflictException('Este lead ainda não tem sala: o link nasce no primeiro contato.');
    const atual = await this.versoes(orgId, leadId, agora);
    /*
     * T7 (rodada do trabalho): a versão na porta só volta "como está" se a
     * aprovação dela ainda VALE. Vencida (ou recusada), ela prendia a sala em
     * `na_porta` para sempre: publicar devolvia o pedido morto. Agora segue
     * adiante, remonta a versão aberta com o derivado de agora e pede de novo.
     */
    if (atual.rascunho.estado === 'na_porta' && atual.rascunho.approvalId && (await this.aprovacaoViva(orgId, atual.rascunho.approvalId))) {
      return { ...atual, approvalId: atual.rascunho.approvalId, estado: 'na_porta' };
    }
    const escrito = escritoDoConteudo(atual.rascunho.conteudo);
    const conteudo = await this.montar(orgId, leadId, escrito, agora);
    if (conteudo.proximosPassos.length === 0) throw new BadRequestException('Escreva ao menos um próximo passo, com dono e data, antes de publicar.');
    const hash = hashDaSala(conteudo);
    if (atual.publicada && atual.publicada.hash === hash) throw new ConflictException(`Nada mudou desde a versão ${atual.publicada.versao}: o cliente já vê isto.`);
    const versao = await this.gravarAberta(orgId, leadId, null, conteudo as unknown as Prisma.InputJsonValue, hash, quem);
    const approvalId = await this.pedirPublicacao(orgId, leadId, versao, hash, quem);
    const depois = await this.versoes(orgId, leadId, agora);
    return { ...depois, approvalId, estado: approvalId ? 'na_porta' : depois.publicada?.versao === versao ? 'publicada' : depois.rascunho.estado };
  }

  // -------------------------------------------------------------------------
  // A área do cliente (leva A): a versão de um item
  // -------------------------------------------------------------------------

  /** O item existe e a Root o escreve (os derivados não têm rascunho). 400 com o motivo. */
  private exigirItemEscrito(item: string): AreaItemId {
    if (!ehItemDaArea(item)) throw new BadRequestException(`"${item}" não é um item da área do cliente.`);
    if (!itemTemRascunho(item)) throw new BadRequestException(`"${itemDaArea(item).titulo}" é montado pelo OS a partir do que já está gravado: não se escreve nem se publica à mão.`);
    return item;
  }

  /** A bancada de UM item: o rascunho (ou o que seria), a publicada e o histórico, com a edição de cada versão. */
  async versoesDoItem(orgId: string, leadId: string, itemPedido: string, agora: Date = new Date()): Promise<VersoesDoItemDaArea> {
    const item = this.exigirItemEscrito(itemPedido);
    const [todas, sala] = await Promise.all([
      this.prisma.salaVersao.findMany({ where: { leadId, orgId, item }, orderBy: { numero: 'asc' } }),
      this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId }, select: { id: true } }),
    ]);
    const edicoes = edicoesPorVersao(todas);
    const edicao = (numero: number) => edicoes.get(numero) ?? 1;
    const aberta = todas.find((v) => (ABERTOS as readonly string[]).includes(v.estado)) ?? null;
    const publicada = [...todas].reverse().find((v) => v.estado === 'publicada') ?? null;
    const historico = [...todas].reverse().filter((v) => v.estado === 'publicada' || v.estado === 'substituida').slice(0, 20);
    void agora;
    return {
      leadId,
      item,
      rascunho: aberta
        ? { versao: aberta.numero, estado: aberta.estado as EstadoAberto, escrito: escritoDoItem(aberta.conteudo), hash: aberta.hash, approvalId: aberta.approvalId, atualizadoEm: aberta.atualizadoEm.toISOString() }
        : { versao: await this.proximoNumero(orgId, leadId), estado: 'novo', escrito: publicada ? escritoDoItem(publicada.conteudo) : null, hash: null, approvalId: null, atualizadoEm: null },
      publicada: publicada
        ? {
            versao: publicada.numero,
            edicao: edicao(publicada.numero),
            publicadaEm: (publicada.publicadaEm ?? publicada.atualizadoEm).toISOString(),
            escrito: escritoDoItem(publicada.conteudo) ?? {},
            hash: publicada.hash,
            publicadaPor: publicada.publicadaPor,
          }
        : null,
      historico: historico.map((h) => ({ versao: h.numero, edicao: edicao(h.numero), estado: h.estado as 'publicada' | 'substituida', publicadaEm: h.publicadaEm?.toISOString() ?? null, hash: h.hash })),
      temSala: !!sala,
    };
  }

  /** Grava o que a bancada escreveu num item. Editar a versão na porta a devolve a rascunho. */
  async salvarRascunhoDoItem(orgId: string, leadId: string, itemPedido: string, corpo: unknown, quem: { id: string }, agora: Date = new Date()): Promise<VersoesDoItemDaArea> {
    const item = this.exigirItemEscrito(itemPedido);
    const r = AreaItemRascunhoSchema.safeParse(corpo);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.') || 'item'}: ${i.message}`).join('; '));
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const conteudo: ConteudoGuardadoDoItemDaArea = { item, ...r.data };
    await this.gravarAberta(orgId, leadId, item, conteudo as unknown as Prisma.InputJsonValue, hashDoConteudo(conteudo), quem);
    return this.versoesDoItem(orgId, leadId, item, agora);
  }

  /**
   * Publicar UM item: congela o escrito na versão aberta do item (ou abre uma
   * a partir da última publicada dele) e entrega à porta, pela MESMA capacidade
   * da sala. R3: volta retida, `na_porta`. Publicar a ata não mexe no
   * cronograma nem na sala: cada item tem a própria versão aberta.
   */
  async publicarItem(orgId: string, leadId: string, itemPedido: string, quem: { id: string }, agora: Date = new Date()): Promise<VersoesDoItemDaArea & { approvalId: string | null; estado: string }> {
    const item = this.exigirItemEscrito(itemPedido);
    const sala = await this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId }, select: { id: true } });
    if (!sala) throw new ConflictException('Este lead ainda não tem sala: o link nasce no primeiro contato.');
    const atual = await this.versoesDoItem(orgId, leadId, item, agora);
    if (atual.rascunho.estado === 'na_porta' && atual.rascunho.approvalId && (await this.aprovacaoViva(orgId, atual.rascunho.approvalId))) {
      return { ...atual, approvalId: atual.rascunho.approvalId, estado: 'na_porta' };
    }
    const escrito = atual.rascunho.escrito;
    if (!escrito) throw new BadRequestException(`Escreva "${itemDaArea(item).titulo}" (ao menos o resumo) antes de publicar.`);
    const conteudo: ConteudoGuardadoDoItemDaArea = { item, ...escrito };
    const hash = hashDoConteudo(conteudo);
    if (atual.publicada && atual.publicada.hash === hash) throw new ConflictException(`Nada mudou desde a ${atual.publicada.edicao}ª edição: o cliente já vê isto.`);
    const versao = await this.gravarAberta(orgId, leadId, item, conteudo as unknown as Prisma.InputJsonValue, hash, quem);
    const approvalId = await this.pedirPublicacao(orgId, leadId, versao, hash, quem);
    const depois = await this.versoesDoItem(orgId, leadId, item, agora);
    return { ...depois, approvalId, estado: approvalId ? 'na_porta' : depois.publicada?.versao === versao ? 'publicada' : depois.rascunho.estado };
  }

  // -------------------------------------------------------------------------
  // A liberação (R3) e o efeito, comuns à sala e aos itens
  // -------------------------------------------------------------------------

  /**
   * O que quem libera lê em /atendimento: a versão inteira, com o hash
   * recalculado agora. `item` diz se é a sala ou um item da área; `anterior` é
   * a publicada do MESMO alvo (a sala, ou aquele item).
   */
  async conteudoParaLiberar(orgId: string, leadId: string, versao: number, hashAssinado: string | null) {
    const v = await this.prisma.salaVersao.findFirst({ where: { leadId, orgId, numero: versao } });
    if (!v) throw new NotFoundException(`A versão ${versao} da sala não existe.`);
    const conteudo = v.conteudo as unknown as ConteudoDaSalaPublicada | ConteudoGuardadoDoItemDaArea;
    const hashDeAgora = hashDoConteudo(conteudo);
    const anterior = await this.prisma.salaVersao.findFirst({ where: { leadId, orgId, item: v.item, estado: 'publicada', numero: { lt: versao } }, orderBy: { numero: 'desc' }, select: { numero: true, conteudo: true } });
    return {
      leadId,
      versao,
      item: (v.item as AreaItemId | null) ?? null,
      titulo: v.item && ehItemDaArea(v.item) ? itemDaArea(v.item).titulo : null,
      estado: v.estado,
      conteudo,
      anterior: anterior ? { versao: anterior.numero, conteudo: anterior.conteudo as unknown as ConteudoDaSalaPublicada | ConteudoGuardadoDoItemDaArea } : null,
      hashGravado: v.hash,
      hashDeAgora,
      hashAssinado,
      confere: hashDeAgora === v.hash && (hashAssinado === null || hashAssinado === hashDeAgora),
    };
  }

  /**
   * O EFEITO de `comercial.sala.publicar`: só a porta chama, depois da
   * liberação. Relê a versão, confere o hash, publica e substitui a anterior
   * DO MESMO ALVO (a sala, ou o item desta versão).
   */
  private async efeitoDePublicar(args: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito): Promise<unknown> {
    const leadId = String(args.leadId ?? '');
    const versao = Number(args.versao);
    const hash = String(args.hash ?? '');
    const v = await this.prisma.salaVersao.findFirst({ where: { leadId, orgId, numero: versao } });
    if (!v) throw new Error('a versão da sala não existe nesta empresa: nada foi publicado');
    if (v.estado === 'publicada') return { leadId, versao, item: v.item, jaPublicada: true };
    if (v.estado !== 'na_porta' && v.estado !== 'rascunho') throw new Error(`a versão ${versao} está ${v.estado}: nada foi publicado`);
    if (v.hash !== hash || hashDoConteudo(v.conteudo) !== v.hash) {
      throw new Error('a sala mudou depois do pedido: nada foi publicado (publique de novo para pedir a liberação desta versão)');
    }
    const em = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sala-versao:${leadId}`}))`;
      const tomada = await tx.salaVersao.updateMany({
        where: { id: v.id, estado: { in: ['na_porta', 'rascunho'] }, hash },
        data: { estado: 'publicada', publicadaEm: em, publicadaPor: ctx.actorId ?? null, approvalId: ctx.approvalId ?? v.approvalId },
      });
      if (tomada.count === 0) throw new Error('a versão mudou durante a publicação: nada foi publicado');
      await tx.salaVersao.updateMany({ where: { leadId, orgId, item: v.item, estado: 'publicada', numero: { not: versao } }, data: { estado: 'substituida' } });
    });
    const ev = await this.fio.registrar(orgId, leadId, 'sala.publicada', `v${versao}`, { versao, hash, item: v.item ?? null, liberadaPor: ctx.actorId ?? null }, { em });
    return { leadId, versao, item: v.item, eventoId: ev.eventoId };
  }
}

/** A última versão publicada DA SALA (item nulo), para o `GET /sala/:token` (roda dentro do `comTenantPublico` da sala). */
export async function publicadaDaSala(prisma: Pick<PrismaService, 'salaVersao'>, orgId: string, leadId: string): Promise<SalaVersaoPublica | null> {
  const v = await prisma.salaVersao.findFirst({ where: { leadId, orgId, item: null, estado: 'publicada' }, orderBy: { numero: 'desc' } });
  if (!v) return null;
  return { versao: v.numero, publicadaEm: (v.publicadaEm ?? v.atualizadoEm).toISOString(), conteudo: v.conteudo as unknown as ConteudoDaSalaPublicada };
}
