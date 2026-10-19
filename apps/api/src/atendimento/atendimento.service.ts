import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  ApprovalState,
  AtendimentoDirecao,
  AtendimentoStatusEnvio,
  Prisma,
  WorkListaNatureza,
} from '@prisma/client';
import {
  type ConversaEditar,
  type ConversaResumo,
  DOMINIO_DAS_CONTAS_DO_SISTEMA,
  type FiltroDeConversa,
  type MensagemDaConversa,
  type Responder,
  type StatusDeEnvio,
  type TipoDeMensagem,
  type VirarTarefa,
  equipeDasContas,
} from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { EfeitosRegistry } from '../gateway/efeitos.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { WhatsappDoAtendimentoRegistry } from '../gateway/canais/whatsapp-do-atendimento.registry';
import { TarefasDoDiaService } from '../work/tarefas-do-dia.service';
import { ehErroDeChaveRepetida } from './entrada-do-atendimento.service';

export const CAPACIDADE_DE_RESPONDER = 'atendimento.whatsapp.responder';
const POR_PAGINA = 30;
const MENSAGENS_POR_PAGINA = 50;
const STATUS_JA_SAIU: AtendimentoStatusEnvio[] = [
  AtendimentoStatusEnvio.aceita,
  AtendimentoStatusEnvio.entregue,
  AtendimentoStatusEnvio.lida,
];

type Contato = Prisma.AtendimentoContatoGetPayload<{
  include: { cliente: { select: { id: true; title: true } }; responsavel: { select: { id: true; name: true } } };
}>;

/*
 * ============================================================================
 * A CAIXA DE ATENDIMENTO — Dia a dia › Conversas (19/10/2026)
 * ============================================================================
 *
 * Os comportamentos do inbox do FinOps (`useChat`, `chat-send-message`,
 * `encerrar_conversa_chat`, `useVirarTarefa`) adaptados ao ROOT OS:
 *
 *   · RESPONDER É R3 E PASSA PELA PORTA. A resposta é guardada antes (com o id
 *     que a tela gerou: clicar duas vezes devolve a mesma) e proposta como
 *     `atendimento.whatsapp.responder`. A porta a RETÉM até outra pessoa assinar
 *     em Aprovações; o efeito, ao sair, manda pela Evolution para o JID da
 *     conversa — nunca para um número vindo do pedido. Conector `whatsapp`
 *     desligado em Conexões barra a saída.
 *   · ESTADOS SEPARADOS: aceita (a Evolution devolveu id), entregue, lida.
 *   · ENCERRAR COM VERSÃO: quem encerra manda a versão que viu; mensagem do
 *     cliente no meio do caminho reabre e sobe a versão, e o encerramento velho
 *     é recusado com 409 (FinOps: `40001`).
 *   · TAREFA SEM DUPLICAR: a mensagem é a chave de `AtendimentoTarefa`. A tarefa
 *     nasce em Dia a dia › Tarefas, com a regra de igual/parecida de lá e o
 *     cliente da conversa.
 */
@Injectable()
export class AtendimentoService implements OnModuleInit {
  private readonly log = new Logger('Atendimento');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly efeitos: EfeitosRegistry,
    private readonly porta: PortaDoOperador,
    private readonly whatsapp: WhatsappDoAtendimentoRegistry,
    private readonly tarefas: TarefasDoDiaService,
  ) {}

  onModuleInit(): void {
    this.efeitos.registrar(
      { [CAPACIDADE_DE_RESPONDER]: (args, orgId) => this.efeitoResponder(args, orgId) },
      'AtendimentoService',
    );
  }

  // ---------------------------------------------------------------- ajuste

  async estado(orgId: string) {
    const ajuste = await this.prisma.atendimentoAjuste.findUnique({ where: { orgId } });
    return { ativo: ajuste?.ativo ?? false, whatsapp: this.whatsapp.disponivel };
  }

  async ajustar(orgId: string, actorId: string, ativo: boolean) {
    const antes = await this.prisma.atendimentoAjuste.findUnique({ where: { orgId } });
    await this.prisma.atendimentoAjuste.upsert({
      where: { orgId },
      create: { orgId, ativo, alteradoPor: actorId },
      update: { ativo, alteradoPor: actorId },
    });
    await this.audit.log({
      orgId, actorId, action: ativo ? 'atendimento.ligar' : 'atendimento.desligar', entityType: 'atendimento', entityId: orgId,
      before: { ativo: antes?.ativo ?? false }, after: { ativo },
    });
    return this.estado(orgId);
  }

  // ---------------------------------------------------------------- leitura

  private async equipe(orgId: string) {
    const [org, contas] = await Promise.all([
      this.prisma.org.findUnique({ where: { id: orgId }, select: { name: true, slug: true } }),
      this.prisma.user.findMany({
        where: { orgId, isActive: true, NOT: { email: { endsWith: DOMINIO_DAS_CONTAS_DO_SISTEMA } } },
        select: { id: true, name: true, lastLoginAt: true },
      }),
    ]);
    return equipeDasContas(
      contas.map((c) => ({ id: c.id, nome: c.name, ultimoAcesso: c.lastLoginAt?.toISOString() ?? null })),
      { nome: org?.name ?? '', slug: org?.slug ?? '' },
    ).pessoas;
  }

  /** Quem pode ser responsável, os clientes do CRM e as áreas — para os seletores. */
  async apoio(orgId: string) {
    const [pessoas, clientes, areas] = await Promise.all([
      this.equipe(orgId),
      this.prisma.workTask.findMany({
        where: { orgId, archived: false, parentId: null, list: { natureza: WorkListaNatureza.cadastro } },
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
        take: 500,
      }),
      this.prisma.workArea.findMany({ where: { orgId }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
    ]);
    return {
      pessoas: pessoas.map((p) => ({ id: p.id, nome: p.nome })),
      clientes: clientes.map((c) => ({ id: c.id, nome: c.title })),
      areas,
    };
  }

  private nomeDaConversa(c: { nome: string | null; grupo: boolean; telefone: string | null; jid: string }): string {
    if (c.nome) return c.nome;
    if (c.grupo) return `Grupo …${c.jid.split('@')[0].slice(-4)}`;
    return c.telefone ? `+${c.telefone}` : 'Contato sem número';
  }

  private resumo(c: Contato, previa: string | null, naoLidas: number): ConversaResumo {
    return {
      id: c.id,
      nome: this.nomeDaConversa(c),
      grupo: c.grupo,
      telefoneFinal: c.telefone ? c.telefone.slice(-4) : null,
      cliente: c.cliente ? { id: c.cliente.id, nome: c.cliente.title } : null,
      responsavel: c.responsavel ? { id: c.responsavel.id, nome: c.responsavel.name } : null,
      ultimaMensagemEm: c.ultimaMensagemEm?.toISOString() ?? null,
      previa,
      naoLidas,
      encerrada: c.encerradaEm !== null,
      versao: c.versao,
    };
  }

  async conversas(orgId: string, userId: string, filtro: FiltroDeConversa, busca: string | undefined, pagina: number) {
    const where: Prisma.AtendimentoContatoWhereInput = { orgId };
    if (filtro === 'encerradas') where.encerradaEm = { not: null };
    else where.encerradaEm = null;
    if (filtro === 'minhas') where.responsavelId = userId;
    if (filtro === 'sem_responsavel') where.responsavelId = null;
    if (filtro === 'sem_cliente') where.clienteId = null;
    if (filtro === 'grupos') where.grupo = true;
    const termo = busca?.trim();
    if (termo) {
      const digitos = termo.replace(/\D/g, '');
      where.OR = [
        { nome: { contains: termo, mode: 'insensitive' } },
        { cliente: { title: { contains: termo, mode: 'insensitive' } } },
        ...(digitos.length >= 4 ? [{ telefone: { contains: digitos } }] : []),
      ];
    }
    const [total, linhas] = await Promise.all([
      this.prisma.atendimentoContato.count({ where }),
      this.prisma.atendimentoContato.findMany({
        where,
        include: { cliente: { select: { id: true, title: true } }, responsavel: { select: { id: true, name: true } } },
        orderBy: [{ ultimaMensagemEm: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
        skip: pagina * POR_PAGINA,
        take: POR_PAGINA,
      }),
    ]);
    const ids = linhas.map((l) => l.id);
    const [naoLidas, ultimas] = await Promise.all([
      this.prisma.atendimentoMensagem.groupBy({
        by: ['contatoId'],
        where: { orgId, contatoId: { in: ids }, direcao: AtendimentoDirecao.entrada, lidaEm: null, apagadaEm: null },
        _count: { _all: true },
      }),
      Promise.all(
        ids.map((id) =>
          this.prisma.atendimentoMensagem.findFirst({
            where: { orgId, contatoId: id, apagadaEm: null },
            orderBy: { momento: 'desc' },
            select: { contatoId: true, texto: true, tipo: true, direcao: true },
          }),
        ),
      ),
    ]);
    const contagem = new Map(naoLidas.map((n) => [n.contatoId, n._count._all]));
    const previa = new Map(
      ultimas.filter((u): u is NonNullable<typeof u> => u !== null).map((u) => [
        u.contatoId,
        `${u.direcao === AtendimentoDirecao.saida ? 'Você: ' : ''}${u.texto ?? `[${u.tipo}]`}`.slice(0, 140),
      ]),
    );
    const totalNaoLidas = await this.prisma.atendimentoMensagem.count({
      where: { orgId, direcao: AtendimentoDirecao.entrada, lidaEm: null, apagadaEm: null, contato: { encerradaEm: null } },
    });
    return {
      total,
      pagina,
      porPagina: POR_PAGINA,
      totalNaoLidas,
      conversas: linhas.map((l) => this.resumo(l, previa.get(l.id) ?? null, contagem.get(l.id) ?? 0)),
    };
  }

  private async contato(orgId: string, id: string): Promise<Contato> {
    const c = await this.prisma.atendimentoContato.findFirst({
      where: { id, orgId },
      include: { cliente: { select: { id: true, title: true } }, responsavel: { select: { id: true, name: true } } },
    });
    if (!c) throw new NotFoundException('Conversa não encontrada');
    return c;
  }

  async conversa(orgId: string, id: string): Promise<ConversaResumo> {
    const c = await this.contato(orgId, id);
    const naoLidas = await this.prisma.atendimentoMensagem.count({
      where: { orgId, contatoId: id, direcao: AtendimentoDirecao.entrada, lidaEm: null, apagadaEm: null },
    });
    return this.resumo(c, null, naoLidas);
  }

  /**
   * Resposta retida que ninguém assinou não pode ficar "esperando assinatura"
   * para sempre: recusada ou vencida em Aprovações vira erro, com o motivo.
   */
  private async conferirAssinaturas(orgId: string, ids: string[]): Promise<void> {
    const presas = await this.prisma.atendimentoMensagem.findMany({
      where: { orgId, id: { in: ids }, statusEnvio: AtendimentoStatusEnvio.aguardando_assinatura, approvalId: { not: null } },
      select: { id: true, approvalId: true },
    });
    if (presas.length === 0) return;
    const aprovacoes = await this.prisma.approval.findMany({
      where: { orgId, id: { in: presas.map((p) => p.approvalId!) } },
      select: { id: true, status: true, expiraEm: true },
    });
    const agora = new Date();
    for (const p of presas) {
      const a = aprovacoes.find((x) => x.id === p.approvalId);
      const motivo = !a
        ? null
        : a.status === ApprovalState.rejeitada
          ? 'A assinatura foi recusada em Aprovações. Nada foi enviado.'
          : a.status === ApprovalState.expirada || (a.status === ApprovalState.pendente && a.expiraEm < agora)
            ? 'Ninguém assinou a tempo e a aprovação venceu. Nada foi enviado.'
            : null;
      if (motivo) {
        await this.prisma.atendimentoMensagem.updateMany({
          where: { id: p.id, orgId, statusEnvio: AtendimentoStatusEnvio.aguardando_assinatura },
          data: { statusEnvio: AtendimentoStatusEnvio.erro, erroEnvio: motivo },
        });
      }
    }
  }

  async mensagens(orgId: string, contatoId: string, antes: string | undefined) {
    await this.contato(orgId, contatoId);
    const cursor = antes ? new Date(antes) : null;
    if (cursor && Number.isNaN(cursor.getTime())) throw new BadRequestException('Cursor inválido');
    const linhas = await this.prisma.atendimentoMensagem.findMany({
      where: { orgId, contatoId, ...(cursor ? { momento: { lt: cursor } } : {}) },
      // Mensagens do mesmo segundo (comum quando o cliente manda várias seguidas)
      // ficam na ordem em que chegaram, e não na de um id aleatório.
      orderBy: [{ momento: 'desc' }, { criadoEm: 'desc' }, { id: 'desc' }],
      take: MENSAGENS_POR_PAGINA + 1,
      include: { tarefa: { select: { tarefaId: true } } },
    });
    const temMais = linhas.length > MENSAGENS_POR_PAGINA;
    const pagina = linhas.slice(0, MENSAGENS_POR_PAGINA);
    await this.conferirAssinaturas(orgId, pagina.map((l) => l.id));
    const atualizadas = await this.prisma.atendimentoMensagem.findMany({
      where: { orgId, id: { in: pagina.map((l) => l.id) } },
      include: { tarefa: { select: { tarefaId: true } } },
    });
    const autores = new Map(
      (await this.prisma.user.findMany({
        where: { orgId, id: { in: [...new Set(atualizadas.map((l) => l.autorId).filter((x): x is string => !!x))] } },
        select: { id: true, name: true },
      })).map((u) => [u.id, u.name]),
    );
    const mapa: MensagemDaConversa[] = atualizadas
      .sort((a, b) => a.momento.getTime() - b.momento.getTime() || a.criadoEm.getTime() - b.criadoEm.getTime() || a.id.localeCompare(b.id))
      .map((l) => ({
        id: l.id,
        direcao: l.direcao,
        tipo: l.tipo as TipoDeMensagem,
        texto: l.apagadaEm ? null : l.texto,
        remetenteNome: l.remetenteNome,
        autor: l.autorId ? (autores.get(l.autorId) ?? null) : null,
        momento: l.momento.toISOString(),
        statusEnvio: (l.statusEnvio as StatusDeEnvio | null) ?? null,
        erroEnvio: l.erroEnvio,
        anexo: l.anexoSituacao && !l.apagadaEm
          ? { situacao: l.anexoSituacao, tipo: l.anexoTipo, nome: l.anexoNome, tamanho: l.anexoTamanho }
          : null,
        apagada: l.apagadaEm !== null,
        tarefaId: l.tarefa?.tarefaId ?? null,
      }));
    return { mensagens: mapa, temMais, antes: temMais ? pagina[pagina.length - 1].momento.toISOString() : null };
  }

  async buscarMensagens(orgId: string, termo: string) {
    const t = termo.trim();
    if (t.length < 2) return { resultados: [] };
    const linhas = await this.prisma.atendimentoMensagem.findMany({
      where: { orgId, apagadaEm: null, texto: { contains: t, mode: 'insensitive' } },
      orderBy: { momento: 'desc' },
      take: 200,
      include: { contato: { select: { id: true, nome: true, grupo: true, telefone: true, jid: true } } },
    });
    return {
      resultados: linhas.map((l) => ({
        mensagemId: l.id,
        conversaId: l.contato.id,
        conversa: this.nomeDaConversa(l.contato),
        texto: (l.texto ?? '').slice(0, 280),
        momento: l.momento.toISOString(),
      })),
    };
  }

  async marcarLida(orgId: string, contatoId: string) {
    await this.contato(orgId, contatoId);
    const r = await this.prisma.atendimentoMensagem.updateMany({
      where: { orgId, contatoId, direcao: AtendimentoDirecao.entrada, lidaEm: null },
      data: { lidaEm: new Date() },
    });
    return { marcadas: r.count };
  }

  async anexo(orgId: string, mensagemId: string) {
    const m = await this.prisma.atendimentoMensagem.findFirst({
      where: { id: mensagemId, orgId, apagadaEm: null },
      select: { anexoChave: true, anexoSituacao: true, anexoNome: true, anexoTipo: true },
    });
    if (!m?.anexoChave || m.anexoSituacao !== 'guardado') throw new NotFoundException('Anexo não encontrado');
    // A chave é por empresa: conferir o prefixo é a segunda trava, além do filtro acima.
    if (!m.anexoChave.startsWith(`atendimento/${orgId}/`)) throw new NotFoundException('Anexo não encontrado');
    const arquivo = await this.storage.get(m.anexoChave);
    return { ...arquivo, nome: m.anexoNome, tipo: m.anexoTipo ?? arquivo.contentType };
  }

  // ---------------------------------------------------------------- escrita

  private async conferirPessoa(orgId: string, id: string | null | undefined) {
    if (!id) return;
    const u = await this.prisma.user.findFirst({ where: { id, orgId, isActive: true }, select: { id: true } });
    if (!u) throw new BadRequestException('Pessoa não encontrada nesta empresa.');
  }

  private async conferirCliente(orgId: string, id: string | null | undefined) {
    if (!id) return;
    const c = await this.prisma.workTask.findFirst({
      where: { id, orgId, list: { natureza: WorkListaNatureza.cadastro } },
      select: { id: true },
    });
    if (!c) throw new BadRequestException('Cliente não encontrado.');
  }

  async editar(orgId: string, actorId: string, id: string, input: ConversaEditar) {
    const antes = await this.contato(orgId, id);
    await this.conferirPessoa(orgId, input.responsavelId);
    await this.conferirCliente(orgId, input.clienteId);
    await this.prisma.atendimentoContato.updateMany({
      where: { id, orgId },
      data: {
        ...(input.responsavelId !== undefined ? { responsavelId: input.responsavelId } : {}),
        ...(input.clienteId !== undefined ? { clienteId: input.clienteId } : {}),
        ...(input.nome !== undefined ? { nome: input.nome } : {}),
      },
    });
    await this.audit.log({
      orgId, actorId, action: 'atendimento.conversa.editar', entityType: 'atendimento_conversa', entityId: id,
      before: { responsavelId: antes.responsavelId, clienteId: antes.clienteId, nome: antes.nome },
      after: input,
    });
    return this.conversa(orgId, id);
  }

  async encerrar(orgId: string, actorId: string, id: string, versao: number, encerrar: boolean) {
    await this.contato(orgId, id);
    const r = await this.prisma.atendimentoContato.updateMany({
      where: { id, orgId, versao, encerradaEm: encerrar ? null : { not: null } },
      data: encerrar
        ? { encerradaEm: new Date(), encerradaPor: actorId, versao: { increment: 1 } }
        : { encerradaEm: null, encerradaPor: null, versao: { increment: 1 } },
    });
    if (r.count !== 1) {
      throw new ConflictException({
        code: 'conversa_mudou',
        message: 'A conversa mudou enquanto você olhava (chegou mensagem ou alguém já mexeu). Confira e tente de novo.',
      });
    }
    await this.audit.log({
      orgId, actorId, action: encerrar ? 'atendimento.conversa.encerrar' : 'atendimento.conversa.reabrir',
      entityType: 'atendimento_conversa', entityId: id, before: { versao },
    });
    return this.conversa(orgId, id);
  }

  /**
   * Guarda a resposta e a propõe à porta. Devolve a mensagem e, quando a porta
   * retém (o normal, R3), o bilhete da fila.
   */
  async responder(orgId: string, actorId: string, contatoId: string, input: Responder) {
    const contato = await this.contato(orgId, contatoId);
    const ajuste = await this.prisma.atendimentoAjuste.findUnique({ where: { orgId } });
    if (!ajuste?.ativo) throw new BadRequestException('A caixa de atendimento está desligada nesta empresa.');

    let mensagem: { id: string; statusEnvio: AtendimentoStatusEnvio | null; texto: string | null; contatoId: string };
    let deNovo = false;
    try {
      mensagem = await this.prisma.atendimentoMensagem.create({
        data: {
          orgId, contatoId, direcao: AtendimentoDirecao.saida, clienteMensagemId: input.clienteMensagemId,
          tipo: 'texto', texto: input.texto, autorId: actorId,
          statusEnvio: AtendimentoStatusEnvio.aguardando_assinatura, momento: new Date(),
        },
        select: { id: true, statusEnvio: true, texto: true, contatoId: true },
      });
    } catch (e) {
      if (!ehErroDeChaveRepetida(e)) throw e;
      const existente = await this.prisma.atendimentoMensagem.findUnique({
        where: { orgId_clienteMensagemId: { orgId, clienteMensagemId: input.clienteMensagemId } },
        select: { id: true, statusEnvio: true, texto: true, contatoId: true },
      });
      if (!existente || existente.contatoId !== contatoId) throw new ConflictException('Este envio já foi usado em outra conversa.');
      // Mesmo clique de novo: devolve o que já existe. Só o que deu erro é proposto outra vez.
      if (existente.statusEnvio !== AtendimentoStatusEnvio.erro) return { mensagemId: existente.id, repetida: true, retida: null };
      mensagem = existente;
      deNovo = true;
      await this.prisma.atendimentoMensagem.updateMany({
        where: { id: existente.id, orgId, statusEnvio: AtendimentoStatusEnvio.erro },
        data: { statusEnvio: AtendimentoStatusEnvio.aguardando_assinatura, erroEnvio: null, approvalId: null, momento: new Date() },
      });
    }

    // Assume a conversa quem responde primeiro (FinOps, `chat-send-message`).
    if (!contato.responsavelId) {
      await this.prisma.atendimentoContato.updateMany({ where: { id: contatoId, orgId, responsavelId: null }, data: { responsavelId: actorId } });
    }

    const destino = `${this.nomeDaConversa(contato)}${contato.telefone ? ` (final ${contato.telefone.slice(-4)})` : ''}`;
    try {
      const r = await this.porta.executar<unknown>({
        orgId,
        actorId,
        capabilityId: CAPACIDADE_DE_RESPONDER,
        args: { conversaId: contatoId, mensagemId: mensagem.id, destino, texto: mensagem.texto ?? input.texto },
        resource: { type: CAPACIDADE_DE_RESPONDER, id: contato.jid },
      });
      const retida = r && typeof r === 'object' && (r as { status?: string }).status === 'aguardando_aprovacao'
        ? (r as { approvalId: string; mensagem: string; fila: string; expiraEm: string })
        : null;
      if (retida) {
        await this.prisma.atendimentoMensagem.updateMany({ where: { id: mensagem.id, orgId }, data: { approvalId: retida.approvalId } });
      }
      return { mensagemId: mensagem.id, repetida: deNovo, retida };
    } catch (e) {
      await this.prisma.atendimentoMensagem.updateMany({
        where: { id: mensagem.id, orgId, statusEnvio: { notIn: STATUS_JA_SAIU } },
        data: { statusEnvio: AtendimentoStatusEnvio.erro, erroEnvio: (e as Error).message.slice(0, 500) },
      });
      throw e;
    }
  }

  /**
   * O EFEITO de `atendimento.whatsapp.responder`. Só a porta chama — na hora,
   * quando a política deixa, ou depois da assinatura, por `AcoesService`.
   *
   * O destino sai da CONVERSA guardada, e o texto tem de ser o da resposta
   * guardada: a assinatura foi dada sobre estes argumentos, e um texto que não
   * bate é recusado em vez de enviado.
   */
  private async efeitoResponder(args: Record<string, unknown>, orgId: string) {
    const mensagemId = String(args.mensagemId ?? '');
    const conversaId = String(args.conversaId ?? '');
    const texto = String(args.texto ?? '');
    const m = await this.prisma.atendimentoMensagem.findFirst({
      where: { id: mensagemId, orgId, direcao: AtendimentoDirecao.saida },
      include: { contato: { select: { id: true, jid: true } } },
    });
    if (!m || m.contato.id !== conversaId) throw new Error('resposta não encontrada nesta conversa: nada foi enviado');
    if (m.texto !== texto) throw new Error('o texto assinado não é o da resposta guardada: nada foi enviado');
    if (m.statusEnvio && STATUS_JA_SAIU.includes(m.statusEnvio)) {
      return { enviado: true, repetido: true, id: m.evolutionId, mensagemId: m.id };
    }
    const travou = await this.prisma.atendimentoMensagem.updateMany({
      where: { id: m.id, orgId, statusEnvio: { in: [AtendimentoStatusEnvio.aguardando_assinatura, AtendimentoStatusEnvio.erro] } },
      data: { statusEnvio: AtendimentoStatusEnvio.enviando, erroEnvio: null },
    });
    if (travou.count !== 1) throw new Error('esta resposta já está sendo enviada');

    let id: string | null;
    try {
      ({ id } = await this.whatsapp.enviarTexto(m.contato.jid, texto));
    } catch (e) {
      await this.prisma.atendimentoMensagem.updateMany({
        where: { id: m.id, orgId, statusEnvio: AtendimentoStatusEnvio.enviando },
        data: { statusEnvio: AtendimentoStatusEnvio.erro, erroEnvio: (e as Error).message.slice(0, 500) },
      });
      throw e;
    }
    const agora = new Date();
    try {
      await this.prisma.atendimentoMensagem.updateMany({
        where: { id: m.id, orgId, statusEnvio: AtendimentoStatusEnvio.enviando },
        data: { statusEnvio: AtendimentoStatusEnvio.aceita, aceitaEm: agora, momento: agora, ...(id ? { evolutionId: id } : {}) },
      });
    } catch (e) {
      if (!ehErroDeChaveRepetida(e) || !id) throw e;
      // O eco chegou antes e virou linha "pelo celular": ela é esta resposta.
      await this.prisma.atendimentoMensagem.deleteMany({ where: { orgId, evolutionId: id, autorId: null, direcao: AtendimentoDirecao.saida } });
      await this.prisma.atendimentoMensagem.updateMany({
        where: { id: m.id, orgId },
        data: { statusEnvio: AtendimentoStatusEnvio.aceita, aceitaEm: agora, momento: agora, evolutionId: id },
      });
    }
    await this.prisma.atendimentoContato.updateMany({
      where: { id: m.contato.id, orgId, OR: [{ ultimaMensagemEm: null }, { ultimaMensagemEm: { lt: agora } }] },
      data: { ultimaMensagemEm: agora },
    });
    return { enviado: true, id, mensagemId: m.id };
  }

  /**
   * Mensagem → tarefa, sem duplicar. A linha de `AtendimentoTarefa` é REIVINDICADA
   * antes de criar: o segundo clique (ou a segunda aba) bate na chave da
   * mensagem e recebe a tarefa que já existe.
   */
  async virarTarefa(orgId: string, actorId: string, mensagemId: string, input: VirarTarefa) {
    const m = await this.prisma.atendimentoMensagem.findFirst({
      where: { id: mensagemId, orgId },
      include: { contato: { select: { id: true, clienteId: true, nome: true, grupo: true, telefone: true, jid: true } } },
    });
    if (!m) throw new NotFoundException('Mensagem não encontrada');
    try {
      await this.prisma.atendimentoTarefa.create({ data: { mensagemId, orgId, criadoPor: actorId } });
    } catch (e) {
      if (!ehErroDeChaveRepetida(e)) throw e;
      const ja = await this.prisma.atendimentoTarefa.findUnique({ where: { mensagemId } });
      return { criada: false, tarefaId: ja?.tarefaId ?? null, aviso: { tipo: 'ja_existe' as const } };
    }

    let r: Awaited<ReturnType<TarefasDoDiaService['criar']>>;
    try {
      r = await this.tarefas.criar(orgId, actorId, {
        titulo: input.titulo,
        areaId: input.areaId,
        pessoaId: input.pessoaId ?? null,
        prazo: input.prazo ?? null,
        clienteId: m.contato.clienteId,
        confirmar: input.confirmar,
      });
    } catch (e) {
      await this.prisma.atendimentoTarefa.deleteMany({ where: { mensagemId, orgId, tarefaId: null } });
      throw e;
    }

    if (!r.criada && r.aviso.tipo !== 'igual') {
      // Parecida ou não parece tarefa: solta a mensagem para a pessoa confirmar.
      await this.prisma.atendimentoTarefa.deleteMany({ where: { mensagemId, orgId, tarefaId: null } });
      return { criada: false, tarefaId: null, aviso: r.aviso };
    }
    const tarefaId = r.criada ? r.tarefa.id : r.aviso.tipo === 'igual' ? r.aviso.tarefa.id : null;
    await this.prisma.atendimentoTarefa.update({ where: { mensagemId }, data: { tarefaId } });
    if (r.criada) {
      const quem = this.nomeDaConversa(m.contato);
      const trecho = (m.texto ?? `[${m.tipo}]`).slice(0, 1000);
      await this.prisma.workTask.updateMany({
        where: { id: r.tarefa.id, orgId, description: null },
        data: { description: `Da conversa de WhatsApp com ${quem}, em ${m.momento.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}:\n\n> ${trecho}` },
      });
    }
    await this.audit.log({
      orgId, actorId, action: 'atendimento.mensagem.virar_tarefa', entityType: 'atendimento_mensagem', entityId: mensagemId,
      after: { tarefaId, criada: r.criada },
    });
    return { criada: r.criada, tarefaId, aviso: r.criada ? null : r.aviso };
  }
}
