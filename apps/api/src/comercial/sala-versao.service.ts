import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import {
  AreaItemRascunhoSchema, SalaRascunhoSchema, ehConteudoDeItem, ehItemDaArea, itemDaArea, itemTemRascunho,
  type AreaItemId, type AreaItemRascunhoInput, type ConteudoDaSalaPublicada, type ConteudoGuardadoDoItemDaArea, type PassoDaSalaPublicada,
  type SalaRascunhoInput, type SalaVersaoPublica, type VersoesDaSala, type VersoesDoItemDaArea,
} from '@mktos/shared';
import { ActorType, ApprovalState, Prisma } from '@prisma/client';

import { EfeitoComercialEscopoService } from '../clientes-escopo/efeito-comercial-escopo.service';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { PrismaService } from '../prisma/prisma.service';
import { edicoesPorVersao } from './area-do-cliente-projecao';
import { hashDoConteudo } from './eventos';
import { FioService } from './fio.service';
import { exigirVersaoDaPublicacao, origemDaSalaConfere, salaAtivaDaPublicacao } from './sala-publicacao-origem';
import { trilhoDaSala } from './sala-trilho-origem';
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
type PedidoAnterior = { versaoId: string; approvalId: string; args: Record<string, unknown> };
type OrigemDaGravacao =
  | { tipo: 'edicao'; clienteId: string | null }
  | { tipo: 'publicacao'; clienteId: string | null; atualizadoEm: string | null; anterior?: PedidoAnterior };

const exigirRascunhoRevisado = () => new ConflictException('Revise e salve um rascunho antes de pedir a publicação desta sala.');

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
    @Optional() private readonly escopo?: EfeitoComercialEscopoService,
  ) {}

  private exigirEscopo(): EfeitoComercialEscopoService {
    if (!this.escopo) throw new ForbiddenException('Não foi possível conferir a origem da sala.');
    return this.escopo;
  }

  private async clienteParaEditar(orgId: string, leadId: string, pessoaId: string): Promise<string | null> {
    const escopo = this.exigirEscopo();
    const clienteId = await escopo.clienteDoLead(orgId, leadId);
    await escopo.exigirPessoa(orgId, pessoaId, clienteId);
    return clienteId;
  }

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
      this.prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { empresa: true, reuniaoEm: true, kickoffEm: true, trilhoId: true, cardId: true, partnerId: true, donoId: true, socioDaConta: true } }),
      this.prisma.leadEvent.findMany({
        where: { leadId, orgId, type: { in: ['ata.chegou', 'cliente.ativo', 'proposta.publicada', 'proposta.aceita', 'contrato.gerado', 'contrato.assinado_cliente', 'contrato.assinado_root'] } },
        select: { type: true, occurredAt: true, payload: true },
      }),
    ]);
    const trilho = await trilhoDaSala(this.prisma, orgId, leadId, ficha, {
      kickoffEm: true, proximoPasso: true, proximoPassoDono: true, proximoPassoEm: true,
      marcos: { where: { tipo: { in: ['memoria.carregada', 'fase.avancou'] } }, select: { tipo: true, em: true, dados: true } },
    });
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
    const clienteId = await this.clienteParaEditar(orgId, leadId, quem.id);
    const conteudo = await this.montar(orgId, leadId, r.data, agora);
    await this.gravarAberta(orgId, leadId, null, conteudo as unknown as Prisma.InputJsonValue, hashDaSala(conteudo), quem, { tipo: 'edicao', clienteId });
    return this.versoes(orgId, leadId, agora);
  }

  /**
   * A versão aberta (da sala ou do item) recebe o conteúdo e volta a rascunho;
   * sem aberta, nasce uma com o próximo número. Sob o cadeado do lead: a sala e
   * os itens partilham a numeração, e dois cliques não abrem duas versões.
   */
  private async gravarAberta(orgId: string, leadId: string, item: string | null, conteudo: Prisma.InputJsonValue, hash: string, quem: { id: string }, origem: OrigemDaGravacao) {
    const { clienteId } = origem;
    const origemCliente = { versao: 1, clienteId };
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sala-versao:${leadId}`}))`;
      const escopo = this.exigirEscopo();
      if (await escopo.clienteDoLead(orgId, leadId, tx) !== clienteId) {
        throw new ConflictException('O cliente deste lead mudou. Abra a sala novamente.');
      }
      await escopo.exigirPessoa(orgId, quem.id, clienteId);
      const aberta = await tx.salaVersao.findFirst({ where: { leadId, orgId, item, estado: { in: [...ABERTOS] } } });
      if (origem.tipo === 'publicacao') {
        if (aberta && !origemDaSalaConfere(aberta.origemCliente, clienteId)) throw exigirRascunhoRevisado();
        if ((aberta?.atualizadoEm.toISOString() ?? null) !== origem.atualizadoEm) {
          throw new ConflictException('O rascunho mudou durante o pedido. Confira a versão atual.');
        }
        const anterior = origem.anterior;
        if (anterior) {
          if (aberta?.id !== anterior.versaoId || aberta.approvalId !== anterior.approvalId) {
            throw new ConflictException('O pedido anterior não corresponde mais à versão aberta da sala.');
          }
          await escopo.exigir(orgId, anterior.approvalId, CAPACIDADE_DA_SALA, anterior.args, { fase: 'repedido', tx });
        }
      }
      const select = { numero: true, atualizadoEm: true } as const;
      if (aberta) {
        // Uma regravação, mesmo sem alterar o hash, invalida pedidos em trânsito.
        const atualizadoEm = new Date(Math.max(Date.now(), aberta.atualizadoEm.getTime() + 1));
        return tx.salaVersao.update({
          where: { id: aberta.id },
          data: { conteudo, hash, estado: 'rascunho', approvalId: null, atualizadoEm, ...(origem.tipo === 'edicao' ? { origemCliente } : {}) },
          select,
        });
      }
      const max = await tx.salaVersao.aggregate({ where: { leadId, orgId }, _max: { numero: true } });
      const numero = (max._max.numero ?? 0) + 1;
      return tx.salaVersao.create({
        data: { orgId, leadId, item, numero, estado: 'rascunho', conteudo, hash, criadoPor: quem.id, origemCliente }, select,
      });
    });
  }

  /** A aprovação pendente desta versão ainda vale (pendente dentro do prazo, ou confirmada e por executar)? */
  private async aprovacaoViva(orgId: string, leadId: string, versao: number, clienteId: string | null, approvalId: string): Promise<boolean> {
    const viva = await this.prisma.approval.findFirst({
      where: {
        id: approvalId, orgId, capabilityId: CAPACIDADE_DA_SALA, resourceType: 'comercial.sala',
        resourceId: `${leadId}:v${versao}`, propostoPorTipo: ActorType.user,
        status: { in: [ApprovalState.pendente, ApprovalState.confirmada] }, expiraEm: { gt: new Date() },
      },
      select: { toolCallId: true, propostoPorId: true, status: true },
    });
    if (!viva?.toolCallId) return false;
    const chamada = await this.prisma.toolCall.findFirst({
      where: { id: viva.toolCallId, approvalId, orgId, actorId: viva.propostoPorId, actorType: ActorType.user, capabilityId: CAPACIDADE_DA_SALA },
      select: { args: true },
    });
    const args = chamada?.args;
    if (!args || typeof args !== 'object' || Array.isArray(args) || args.leadId !== leadId || args.versao !== versao
      || !Object.hasOwn(args, 'clienteId') || args.clienteId !== clienteId) return false;
    const origem = args.origemCliente;
    if (!origem || typeof origem !== 'object' || Array.isArray(origem) || origem.versao !== 1 || origem.clienteId !== clienteId) return false;
    try {
      const escopo = this.exigirEscopo();
      if (viva.status === ApprovalState.confirmada) {
        await escopo.exigir(orgId, approvalId, CAPACIDADE_DA_SALA, args, { fase: 'confirmada' });
      } else {
        await exigirVersaoDaPublicacao(this.prisma, orgId, approvalId, args);
        await escopo.exigirPessoa(orgId, viva.propostoPorId, clienteId);
      }
      return true;
    } catch (erro) {
      if (erro instanceof ForbiddenException) return false;
      throw erro;
    }
  }

  /** Entrega a versão à porta (R3) e, retida, a marca `na_porta` com o id da aprovação. */
  private async pedirPublicacao(orgId: string, leadId: string, aberta: { numero: number; atualizadoEm: Date }, hash: string, clienteId: string | null, quem: { id: string }): Promise<string> {
    const versao = aberta.numero;
    const resposta = await this.operador.executar({
      orgId,
      actorId: quem.id,
      actorType: ActorType.user,
      capabilityId: CAPACIDADE_DA_SALA,
      args: { leadId, versao, hash, clienteId, origemCliente: { versao: 1, clienteId } },
      resource: { type: 'comercial.sala', id: `${leadId}:v${versao}` },
    });
    if (!ehRetida(resposta)) throw new ConflictException('A publicação não foi encaminhada para aprovação.');
    const tomada = await this.prisma.salaVersao.updateMany({
      where: { leadId, orgId, numero: versao, estado: 'rascunho', approvalId: null, hash, atualizadoEm: aberta.atualizadoEm },
      data: { estado: 'na_porta', approvalId: resposta.approvalId },
    });
    if (tomada.count !== 1) throw new ConflictException('O rascunho foi regravado durante o pedido. Peça a publicação da versão atual.');
    return resposta.approvalId;
  }

  private async exigirOrigemDaPublicada(orgId: string, leadId: string, item: string | null, versao: number, hash: string, clienteId: string | null) {
    const v = await this.prisma.salaVersao.findFirst({
      where: { orgId, leadId, item, numero: versao, hash, estado: 'publicada' },
      select: { approvalId: true },
    });
    if (!v?.approvalId) throw exigirRascunhoRevisado();
    try {
      const args = { leadId, versao, hash, clienteId, origemCliente: { versao: 1, clienteId } };
      await this.exigirEscopo().exigir(orgId, v.approvalId, CAPACIDADE_DA_SALA, args, { fase: 'consumida' });
    } catch (erro) {
      if (erro instanceof ForbiddenException) throw exigirRascunhoRevisado();
      throw erro;
    }
  }

  /**
   * Publicar: recalcula o derivado de agora, congela o conteúdo e o hash na
   * versão aberta (sem rascunho, exige a origem assinada da última publicada) e
   * entrega à porta. R3: volta retida, `na_porta`, com o id da aprovação.
   */
  async publicar(orgId: string, leadId: string, quem: { id: string }, agora: Date = new Date(), anterior?: PedidoAnterior): Promise<VersoesDaSala & { approvalId: string | null; estado: string }> {
    const clienteId = await this.clienteParaEditar(orgId, leadId, quem.id);
    const sala = await salaAtivaDaPublicacao(this.prisma, orgId, leadId, agora);
    if (!sala) throw new ConflictException('Este lead precisa de um link ativo da sala para publicar.');
    const atual = await this.versoes(orgId, leadId, agora);
    /*
     * T7 (rodada do trabalho): a versão na porta só volta "como está" se a
     * aprovação dela ainda VALE. Vencida (ou recusada), ela prendia a sala em
     * `na_porta` para sempre: publicar devolvia o pedido morto. Agora segue
     * adiante, remonta a versão aberta com o derivado de agora e pede de novo.
     */
    if (!anterior && atual.rascunho.estado === 'na_porta' && atual.rascunho.approvalId && (await this.aprovacaoViva(orgId, leadId, atual.rascunho.versao, clienteId, atual.rascunho.approvalId))) {
      return { ...atual, approvalId: atual.rascunho.approvalId, estado: 'na_porta' };
    }
    if (atual.rascunho.estado === 'novo' && atual.publicada) {
      await this.exigirOrigemDaPublicada(orgId, leadId, null, atual.publicada.versao, atual.publicada.hash, clienteId);
    }
    const escrito = escritoDoConteudo(atual.rascunho.conteudo);
    const conteudo = await this.montar(orgId, leadId, escrito, agora);
    if (conteudo.proximosPassos.length === 0) throw new BadRequestException('Escreva ao menos um próximo passo, com dono e data, antes de publicar.');
    const hash = hashDaSala(conteudo);
    if (atual.publicada && atual.publicada.hash === hash) throw new ConflictException(`Nada mudou desde a versão ${atual.publicada.versao}: o cliente já vê isto.`);
    const aberta = await this.gravarAberta(orgId, leadId, null, conteudo as unknown as Prisma.InputJsonValue, hash, quem, {
      tipo: 'publicacao', clienteId, atualizadoEm: atual.rascunho.atualizadoEm, anterior,
    });
    const approvalId = await this.pedirPublicacao(orgId, leadId, aberta, hash, clienteId, quem);
    const depois = await this.versoes(orgId, leadId, agora);
    return { ...depois, approvalId, estado: 'na_porta' };
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
    const clienteId = await this.clienteParaEditar(orgId, leadId, quem.id);
    const conteudo: ConteudoGuardadoDoItemDaArea = { item, ...r.data };
    await this.gravarAberta(orgId, leadId, item, conteudo as unknown as Prisma.InputJsonValue, hashDoConteudo(conteudo), quem, { tipo: 'edicao', clienteId });
    return this.versoesDoItem(orgId, leadId, item, agora);
  }

  /**
   * Publicar UM item: congela o escrito na versão aberta do item (ou abre uma
   * a partir da última publicada dele) e entrega à porta, pela MESMA capacidade
   * da sala. R3: volta retida, `na_porta`. Publicar a ata não mexe no
   * cronograma nem na sala: cada item tem a própria versão aberta.
   */
  async publicarItem(orgId: string, leadId: string, itemPedido: string, quem: { id: string }, agora: Date = new Date(), anterior?: PedidoAnterior): Promise<VersoesDoItemDaArea & { approvalId: string | null; estado: string }> {
    const item = this.exigirItemEscrito(itemPedido);
    const clienteId = await this.clienteParaEditar(orgId, leadId, quem.id);
    const sala = await salaAtivaDaPublicacao(this.prisma, orgId, leadId, agora);
    if (!sala) throw new ConflictException('Este lead precisa de um link ativo da sala para publicar.');
    const atual = await this.versoesDoItem(orgId, leadId, item, agora);
    if (!anterior && atual.rascunho.estado === 'na_porta' && atual.rascunho.approvalId && (await this.aprovacaoViva(orgId, leadId, atual.rascunho.versao, clienteId, atual.rascunho.approvalId))) {
      return { ...atual, approvalId: atual.rascunho.approvalId, estado: 'na_porta' };
    }
    if (atual.rascunho.estado === 'novo' && atual.publicada) {
      await this.exigirOrigemDaPublicada(orgId, leadId, item, atual.publicada.versao, atual.publicada.hash, clienteId);
    }
    const escrito = atual.rascunho.escrito;
    if (!escrito) throw new BadRequestException(`Escreva "${itemDaArea(item).titulo}" (ao menos o resumo) antes de publicar.`);
    const conteudo: ConteudoGuardadoDoItemDaArea = { item, ...escrito };
    const hash = hashDoConteudo(conteudo);
    if (atual.publicada && atual.publicada.hash === hash) throw new ConflictException(`Nada mudou desde a ${atual.publicada.edicao}ª edição: o cliente já vê isto.`);
    const aberta = await this.gravarAberta(orgId, leadId, item, conteudo as unknown as Prisma.InputJsonValue, hash, quem, {
      tipo: 'publicacao', clienteId, atualizadoEm: atual.rascunho.atualizadoEm, anterior,
    });
    const approvalId = await this.pedirPublicacao(orgId, leadId, aberta, hash, clienteId, quem);
    const depois = await this.versoesDoItem(orgId, leadId, item, agora);
    return { ...depois, approvalId, estado: 'na_porta' };
  }

  async repedirPublicacao(orgId: string, approvalId: string, args: Record<string, unknown>, quem: { id: string }, agora = new Date()) {
    const escopo = this.exigirEscopo();
    await escopo.exigir(orgId, approvalId, CAPACIDADE_DA_SALA, args, { fase: 'repedido' });
    const v = await exigirVersaoDaPublicacao(this.prisma, orgId, approvalId, args);
    const anterior = { versaoId: v.id, approvalId, args };
    return v.item === null
      ? this.publicar(orgId, v.leadId, quem, agora, anterior)
      : this.publicarItem(orgId, v.leadId, v.item, quem, agora, anterior);
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
    const { approvalId, actorId, actorType } = ctx;
    if (ctx.orgId !== orgId || !approvalId || !actorId || actorType !== ActorType.user || typeof args.leadId !== 'string') {
      throw new ForbiddenException('Publicar exige uma aprovação individual da sala.');
    }
    const leadId = args.leadId;
    const escopo = this.exigirEscopo();
    const publicado = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sala-versao:${leadId}`}))`;
      const origem = await escopo.exigir(orgId, approvalId, CAPACIDADE_DA_SALA, args, { fase: 'consumida', atorExecucaoId: actorId, tx });
      const v = await exigirVersaoDaPublicacao(tx, orgId, approvalId, args, true);
      if (v.estado === 'publicada') return { versao: v.numero, item: v.item, evento: null };
      const em = new Date();
      const tomada = await tx.salaVersao.updateMany({
        where: { id: v.id, orgId, leadId, item: v.item, estado: 'na_porta', hash: v.hash, approvalId, atualizadoEm: v.atualizadoEm },
        data: { estado: 'publicada', publicadaEm: em, publicadaPor: origem.aprovadorId },
      });
      if (tomada.count !== 1) throw new ConflictException('A versão mudou durante a publicação.');
      await tx.salaVersao.updateMany({
        where: { leadId, orgId, item: v.item, estado: 'publicada', numero: { not: v.numero } },
        data: { estado: 'substituida' },
      });
      const evento = await this.fio.gravarNaTransacao(tx, orgId, leadId, 'sala.publicada', `v${v.numero}`, {
        versao: v.numero, hash: v.hash, item: v.item, liberadaPor: origem.aprovadorId,
      }, em);
      return { versao: v.numero, item: v.item, evento };
    });
    const { versao, item, evento } = publicado;
    if (!evento) return { leadId, versao, item, jaPublicada: true };
    if (evento.novo) await this.fio.reagir(evento.evento);
    return { leadId, versao, item, eventoId: evento.evento.eventoId };
  }
}

/** A última versão publicada DA SALA (item nulo), para o `GET /sala/:token` (roda dentro do `comTenantPublico` da sala). */
export async function publicadaDaSala(prisma: Pick<PrismaService, 'salaVersao'>, orgId: string, leadId: string): Promise<SalaVersaoPublica | null> {
  const v = await prisma.salaVersao.findFirst({ where: { leadId, orgId, item: null, estado: 'publicada' }, orderBy: { numero: 'desc' } });
  if (!v) return null;
  return { versao: v.numero, publicadaEm: (v.publicadaEm ?? v.atualizadoEm).toISOString(), conteudo: v.conteudo as unknown as ConteudoDaSalaPublicada };
}
