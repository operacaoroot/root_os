import { exigirNovoUsoSemMovimentoPendente } from '../memory/contexto-movimento-namespace';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ProntidaoAgentesSchema, ProcedimentoLocalPedidoSchema, ProcedimentoLocalPainelSchema, ProcedimentoLocalFontesSchema, ProcedimentoLocalExecucaoSchema, ProcedimentoLocalRecuperacaoSchema,
  type ProntidaoAgentes, type ProcedimentoLocalPedido, type ProcedimentoLocalPainel, type ProcedimentoLocalExecucao } from '@mktos/shared';
import { createHash } from 'node:crypto';
import { Prisma, RiskLevel, SessionStatus } from '@prisma/client';
import { z } from 'zod';
import { AgendaLocalService, type LeitoresAgendaNoTx, type OrigemAgenda, type EscopoAgenda } from './agenda-local.service';
import { AgendaLocalCriarSchema, AgendaLocalEditarSchema, AgendaLocalEstadoSchema, AgendaLocalDispararSchema, type AgendaLocalDisparar, type AgendaLocalRecuperacaoConsulta } from '@mktos/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { exigirAcessoAtual, filtroDeLeitura } from '../memory/acesso-memoria';
import { hashDoCorpo } from '../memory/procedencia';
import { construirFonteAutorizada, reconferirFontesAtuais } from '../memory/fonte-autorizada';
import { AgenteIdentidadeSchema } from './agents.service';
import { FalhaSinteseLocal, promptSinteseLocal, type ObservacaoLocal } from './sintese-local';
import { FormatoDaSopInvalido, validarProcedimento } from './sop';
import { ModeloLocalService, type ResultadoLocal } from './modelo-local.service';

export const REF_PROCEDIMENTO_LOCAL = 'procedimento-local:';
const CONFIGURAR = ['automacoes.executar', 'admin.usuarios'];
const EXECUTAR = ['mcp.ver', 'mcp.executar', 'admin.usuarios', 'obsidian.ver'];
const LER = ['mcp.ver', 'obsidian.ver'];
export const CriarProcedimentoSchema = AgenteIdentidadeSchema.required().extend({
  requestId: z.string().uuid(), modelo: z.string().min(1).max(200).nullable(), procedimento: z.unknown(),
}).strict();
export const ExecutarProcedimentoSchema = ProcedimentoLocalPedidoSchema;
// O leitor V1 mantém exatamente a forma e a ordem usadas pelo fingerprint antigo.
const EntradaHistoricaV1Schema = z.object({
  requestId: z.string().uuid(), pedido: z.string().trim().min(1).max(2000),
  itemId: z.string().uuid(), versionId: z.string().uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedItemVersion: z.number().int().positive(),
}).strict();
type EntradaFonte = z.infer<typeof EntradaHistoricaV1Schema>;
type Pedido = ProcedimentoLocalPedido;
const fim = z.enum(['stop', 'length', 'content_filter', 'tool_calls', 'function_call', 'ausente', 'desconhecido']);
const tokens = z.number().int().nonnegative().nullable();
const RegistroSchema = z.object({
  tipo: z.literal('procedimento_local'), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid(),
  entradaContrato: z.literal(2).optional(), entrada: z.unknown(),
  origemAgenda: z.object({ agendaId: z.string().uuid(), revisionId: z.string().uuid(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), numero: z.number().int().positive().safe() }).strict().optional(),
  procedimento: z.object({ versao: z.number().int().nonnegative(), proposito: z.string(), passos: z.array(z.string()), definicaoDePronto: z.string() }).strict(),
  fonte: z.object({ itemId: z.string().uuid(), versionId: z.string().uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    versao: z.number().int().positive(), chave: z.string(), sourceType: z.string(), sourceRef: z.string().nullable(), title: z.string() }).strict(),
  saida: z.object({ texto: z.string(), modelo: z.string(), tokensIn: tokens, tokensOut: tokens, finishReason: fim.optional() }).strict().optional(),
  observado: z.object({ modelo: z.string().nullable(), tokensIn: tokens, tokensOut: tokens, finishReason: fim.optional() }).strict().optional(),
  modeloConfigurado: z.string().nullable(),
}).strict();
type Registro = Omit<z.infer<typeof RegistroSchema>, 'entrada'> & { entrada: EntradaFonte | Pedido };
const fingerprint = (valor: unknown) => createHash('sha256').update(JSON.stringify(valor)).digest('hex');
function lerRegistro(payload: unknown, pessoaId: string, slug: string, requestId: string) {
  const base = RegistroSchema.safeParse(payload);
  if (!base.success) throw new ConflictException('O pedido não pôde ser conferido.');
  const entrada = base.data.entradaContrato === 2
    ? ProcedimentoLocalPedidoSchema.safeParse(base.data.entrada) : EntradaHistoricaV1Schema.safeParse(base.data.entrada);
  if (!entrada.success || base.data.requestId !== requestId || entrada.data.requestId !== requestId
    || base.data.fingerprint !== fingerprint({ pessoaId, slug, input: entrada.data }))
    throw new ConflictException('O pedido não pôde ser conferido.');
  if (base.data.entradaContrato === 2 && (!('expectedSopVersion' in entrada.data) || base.data.procedimento.versao < 1
    || base.data.procedimento.versao !== entrada.data.expectedSopVersion))
    throw new ConflictException('A versão do procedimento registrada não corresponde ao pedido.');
  const registro: Registro = { ...base.data, entrada: entrada.data };
  const entradaConfirmada = base.data.entradaContrato === 2
    ? { contrato: 2 as const, input: ProcedimentoLocalPedidoSchema.parse(base.data.entrada) }
    : { contrato: 1 as const, input: EntradaHistoricaV1Schema.parse(base.data.entrada) };
  return { registro, entradaConfirmada };
}

/** Procedimento de leitura → síntese local → registro. Não executa ferramentas externas. */
@Injectable()
export class ProcedimentoDoAgenteService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly modelo: ModeloLocalService, private readonly agenda: AgendaLocalService) {}

  async prontidao(orgId: string, pessoaId: string): Promise<ProntidaoAgentes> {
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, ['mcp.ver']);
    const modelo = this.modelo.prontidao();
    let consultaPermitida = false;
    try {
      await exigirAcessoAtual(this.prisma, orgId, pessoaId, ['mcp.ver', 'obsidian.ver']);
      consultaPermitida = true;
    } catch (e) {
      if (!(e instanceof ForbiddenException)) throw e;
      await exigirAcessoAtual(this.prisma, orgId, pessoaId, ['mcp.ver']);
    }
    return ProntidaoAgentesSchema.parse({ escopo: { orgId, userId: pessoaId }, modelo,
      fontes: { consultaPermitida, quantidade: null } });
  }

  async configuracao(orgId: string, pessoaId: string) {
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, CONFIGURAR);
    const [pessoas, estado] = await Promise.all([
      this.prisma.user.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.modelo.estado(),
    ]);
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, CONFIGURAR);
    return { escopo: { orgId, userId: pessoaId }, pessoas, modelo: estado, capacidades: ['contexto.memoria.buscar'],
      procedimentoSuportado: 'Ler uma versão de fonte, sintetizar com modelo local e registrar o resultado. Sem ferramentas externas.' };
  }

  async criar(orgId: string, pessoaId: string, entrada: unknown) {
    const input = CriarProcedimentoSchema.parse(entrada);
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, CONFIGURAR);
    const estado = await this.modelo.estado();
    const slug = `procedimento-${input.requestId}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-create:${orgId}:${input.requestId}`}))`;
      await exigirAcessoAtual(tx, orgId, pessoaId, CONFIGURAR);
      const dono = await tx.user.findFirst({ where: { id: input.donoId, orgId, isActive: true }, select: { id: true } });
      if (!dono) throw new BadRequestException('O responsável deve estar ativo nesta empresa.');
      let sop;
      try { sop = validarProcedimento(input.procedimento, { donoId: dono.id, pilar: input.pilar }); }
      catch (e) { if (e instanceof FormatoDaSopInvalido) throw new BadRequestException(e.message); throw e; }
      const assinatura = fingerprint({ pessoaId, input: { ...input, procedimento: sop } });
      const existente = await tx.agent.findFirst({ where: { orgId, slug }, select: { id: true, slug: true } });
      if (existente) {
        const log = await tx.auditLog.findFirst({ where: { orgId, entityId: existente.id, action: 'agent.procedimento.create' }, select: { metadata: true } });
        if ((log?.metadata as { fingerprint?: string } | null)?.fingerprint !== assinatura) throw new ConflictException('Este pedido já criou um agente com outra configuração ou pessoa.');
        await exigirAcessoAtual(tx, orgId, pessoaId, CONFIGURAR);
        return { ...existente, repetido: true, escopo: { orgId, userId: pessoaId, agentId: existente.id, agentSlug: existente.slug } };
      }
      if (input.modelo && (!estado.disponivel || input.modelo !== estado.modelo)) throw new ConflictException('O modelo escolhido não está disponível. Confira a configuração.');
      const agente = await tx.agent.create({ data: {
        orgId, slug, nome: input.nome, missao: input.missao, pilar: input.pilar, donoId: dono.id,
        iniciais: input.nome.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase(),
        estado: 'planejado', ativo: false, tipo: 'llm', autonomiaAte: RiskLevel.R1,
        capacidades: ['contexto.memoria.buscar'], contextoFixo: [], cron: null,
        modelo: input.modelo, maxPassos: 1, tetoSegundos: 90, tetoCustoUsd: 0,
        sop: { create: { orgId, ...sop, atualizadoPor: pessoaId } },
      }, select: { id: true, slug: true } });
      await this.audit.log({ orgId, actorId: pessoaId, action: 'agent.procedimento.create', entityType: 'agent', entityId: agente.id,
        metadata: { requestId: input.requestId, fingerprint: assinatura, modo: 'sintese_local_sem_ferramentas' } }, tx);
      await exigirAcessoAtual(tx, orgId, pessoaId, CONFIGURAR);
      return { ...agente, repetido: false, escopo: { orgId, userId: pessoaId, agentId: agente.id, agentSlug: agente.slug } };
    });
  }

  async criacaoPorPedido(orgId: string, pessoaId: string, requestId: string) {
    if (!z.string().uuid().safeParse(requestId).success) throw new BadRequestException('Pedido inválido.');
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, CONFIGURAR);
    const slug = `procedimento-${requestId}`;
    const agente = await this.prisma.agent.findFirst({ where: { orgId, slug }, select: { id: true, slug: true } });
    if (!agente) throw new NotFoundException('Pedido indisponível.');
    const logs = await this.prisma.auditLog.findMany({ where: { orgId, actorId: pessoaId, action: 'agent.procedimento.create',
      entityType: 'agent', entityId: agente.id, metadata: { path: ['requestId'], equals: requestId } }, take: 2, select: { id: true } });
    if (!logs.length) throw new NotFoundException('Pedido indisponível.');
    if (logs.length !== 1) throw new ConflictException('O pedido não pôde ser conferido.');
    const atual = await this.prisma.agent.findFirst({ where: { id: agente.id, orgId, slug }, select: { id: true, slug: true } });
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, CONFIGURAR);
    if (!atual) throw new NotFoundException('Pedido indisponível.');
    return { ...atual, repetido: true, escopo: { orgId, userId: pessoaId, agentId: atual.id, agentSlug: atual.slug } };
  }

  private async painelNoTx(db: Prisma.TransactionClient, orgId: string, pessoaId: string, slug: string): Promise<ProcedimentoLocalPainel> {
    await exigirAcessoAtual(db, orgId, pessoaId, LER);
    const agente = await db.agent.findFirst({ where: { orgId, slug }, include: { sop: true } });
    if (!agente) throw new NotFoundException('Agente indisponível.');
    const dono = await db.user.findFirst({ where: { orgId, id: agente.donoId ?? '', isActive: true }, select: { id: true } });
    const pessoa = await db.user.findFirst({ where: { orgId, id: pessoaId, isActive: true },
      select: { roles: { where: { orgId }, select: { permissions: { select: { key: true } } } } } });
    const permissoes = new Set(pessoa?.roles.flatMap((r) => r.permissions.map((p) => p.key)) ?? []);
    if (!pessoa || !LER.every((p) => permissoes.has(p))) throw new ForbiddenException('Acesso insuficiente.');
    const iniciar = EXECUTAR.every((p) => permissoes.has(p));
    const declaracao = this.modelo.prontidao();
    const impedimentosLocais: string[] = [];
    if (!iniciar) impedimentosLocais.push('Acesso insuficiente para iniciar outro pedido.');
    if (agente.estado !== 'ativo' || !agente.ativo) impedimentosLocais.push(`Agente ${agente.estado}. Retome antes de criar outro pedido.`);
    if (!dono) impedimentosLocais.push('Responsável indisponível nesta empresa.');
    if (!agente.sop || agente.sop.orgId !== orgId || agente.sop.agentId !== agente.id || agente.sop.versao < 1) impedimentosLocais.push('Defina o procedimento antes de iniciar.');
    if (!agente.capacidades.includes('contexto.memoria.buscar') || agente.capacidades.some((c) => c !== 'contexto.memoria.buscar')) impedimentosLocais.push('Ferramenta não permitida neste procedimento.');
    if (!agente.modelo || declaracao.estado !== 'declarado_sem_verificacao') impedimentosLocais.push('Modelo local não configurado para este agente.');
    await exigirAcessoAtual(db, orgId, pessoaId, LER);
    return ProcedimentoLocalPainelSchema.parse({ escopo: { orgId, userId: pessoaId, agentId: agente.id, agentSlug: agente.slug },
      autoridade: { ler: true, iniciar, editarSop: CONFIGURAR.every((p) => permissoes.has(p)), verificadaEm: new Date().toISOString() },
      agente: { estado: agente.estado, ativo: agente.ativo, responsavelDisponivel: !!dono },
      procedimento: agente.sop ? { versao: agente.sop.versao, proposito: agente.sop.proposito, passos: agente.sop.passos, definicaoDePronto: agente.sop.definicaoDePronto } : null,
      modelo: { configurado: agente.modelo, declaracao },
      executor: { modo: 'sintese_local_sem_ferramentas', ferramentasExternas: false, agendamento: false, cancelarInferencia: false },
      inicioLocal: { permitido: impedimentosLocais.length === 0, impedimentosLocais, verificacaoModelo: 'somente_apos_pedido' } });
  }

  async painel(orgId: string, pessoaId: string, slug: string) {
    return this.painelNoTx(this.prisma, orgId, pessoaId, slug);
  }

  async fontes(orgId: string, pessoaId: string, slug: string) {
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, LER);
    if (!await this.prisma.agent.findFirst({ where: { orgId, slug }, select: { id: true } })) throw new NotFoundException('Agente indisponível.');
    const rows = await this.prisma.contextItem.findMany({ where: { orgId, ...filtroDeLeitura(pessoaId), arquivadoEm: null },
      take: 100, orderBy: { title: 'asc' }, include: { versoes: { orderBy: { versao: 'desc' } } } });
    const painel = await this.painelNoTx(this.prisma, orgId, pessoaId, slug);
    const final = await reconferirFontesAtuais(this.prisma, orgId, pessoaId, LER, rows.map((r) => r.id), false);
    const porId = new Map(final.fontes.map((r) => [r.id, r]));
    const verificadoEm = new Date();
    const items = rows.filter((r) => porId.has(r.id)).map((r) => {
      const atual = porId.get(r.id)!;
      return { id: r.id, title: atual.title, chave: atual.chave, versao: atual.versao,
        versoes: r.versoes.map((v) => ({ id: v.id, title: v.title, versao: v.versao, contentHash: v.contentHash, sourceType: v.sourceType, sourceRef: v.sourceRef,
          retratoFonte: construirFonteAutorizada({ item: atual, versaoSelecionada: v, incluirCorpo: false, acessoVerificadoEm: verificadoEm,
            novoUsoPermitido: !atual.movimentoPendente && !atual.arquivadoEm && atual.sourceType === v.sourceType && atual.sourceRef === v.sourceRef }) })) };
    });
    return ProcedimentoLocalFontesSchema.parse({ items, painel, escopo: painel.escopo });
  }

  private async sopDoCompromisso(tx: Prisma.TransactionClient, orgId: string, pessoaId: string, slug: string, input: Pedido) {
    // A ordem Agent→agent-sop é a mesma do editor humano. Sop FOR SHARE cobre o writer CAS do roster.
    await tx.$queryRaw`SELECT "id" FROM "Agent" WHERE "orgId"=${orgId} AND "slug"=${slug} FOR UPDATE`;
    const identidade = await tx.agent.findFirst({ where: { orgId, slug }, select: { id: true } });
    if (!identidade) throw new NotFoundException('Agente indisponível.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-sop:${orgId}:${identidade.id}`}))`;
    await tx.$queryRaw`SELECT "id" FROM "Sop" WHERE "orgId"=${orgId} AND "agentId"=${identidade.id} FOR SHARE`;
    const agente = await tx.agent.findFirst({ where: { id: identidade.id, orgId, slug }, include: { sop: true } });
    if (!agente) throw new NotFoundException('Agente indisponível.');
    if (!agente.sop || agente.sop.orgId !== orgId || agente.sop.agentId !== agente.id || agente.sop.versao !== input.expectedSopVersion)
      throw new ConflictException({ code: 'agente_procedimento_sop_alterado', message: 'O procedimento mudou. Confira a versão antes de iniciar ou reenviar o pedido.' });
    if (agente.donoId) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "orgId"=${orgId} AND "id"=${agente.donoId} FOR SHARE`;
    const dono = await tx.user.findFirst({ where: { id: agente.donoId ?? '', orgId, isActive: true }, select: { id: true } });
    await exigirAcessoAtual(tx, orgId, pessoaId, EXECUTAR);
    return { agente, sop: agente.sop, dono };
  }

  private async fonte(db: Pick<Prisma.TransactionClient, 'contextItem' | 'contextItemVersion' | 'user' | '$queryRawUnsafe'>,
    orgId: string, pessoaId: string, pedido: EntradaFonte, anterior?: Registro['fonte'], modo: 'novo_efeito' | 'historico' = 'novo_efeito') {
    const permitirArquivada = modo === 'historico';
    let item = await db.contextItem.findFirst({ where: { id: pedido.itemId, orgId, ...filtroDeLeitura(pessoaId), ...(permitirArquivada ? {} : { arquivadoEm: null }) } });
    if (!item) throw new NotFoundException('Fonte indisponível para esta conta.');
    const v = await db.contextItemVersion.findFirst({ where: { id: pedido.versionId, itemId: item.id, orgId } });
    if (!v || v.versao > item.versao || v.contentHash !== pedido.contentHash || hashDoCorpo(v.body) !== v.contentHash) throw new ConflictException('A versão da fonte não corresponde ao pedido.');
    item = await db.contextItem.findFirst({ where: { id: pedido.itemId, orgId, ...filtroDeLeitura(pessoaId), ...(permitirArquivada ? {} : { arquivadoEm: null }) } });
    if (!item) throw new NotFoundException('Fonte indisponível para esta conta.');
    if (v.versao > item.versao) throw new ConflictException('A versão da fonte não corresponde ao pedido.');
    await exigirAcessoAtual(db, orgId, pessoaId, LER);
    const final = await reconferirFontesAtuais(db, orgId, pessoaId, LER, [item.id], permitirArquivada);
    if (!final.fontes[0]) throw new NotFoundException('Fonte indisponível para esta conta.');
    item = { ...item, ...final.fontes[0] };
    if (modo === 'novo_efeito') await exigirNovoUsoSemMovimentoPendente(db, orgId, item.id);
    if (v.versao > item.versao) throw new ConflictException('A versão da fonte não corresponde ao pedido.');
    if (anterior) {
      if (anterior.itemId !== pedido.itemId || anterior.itemId !== item.id || anterior.versionId !== pedido.versionId || anterior.versionId !== v.id
        || anterior.versao !== v.versao || anterior.contentHash !== pedido.contentHash || anterior.contentHash !== v.contentHash || anterior.title !== v.title)
        throw new ConflictException({ code: 'contexto_fonte_inconsistente', message: 'A versão registrada da fonte não pôde ser conferida.' });
      if (v.sourceType !== anterior.sourceType || v.sourceRef !== anterior.sourceRef) throw new ConflictException('A origem registrada da fonte não pôde ser conferida.');
      if (modo === 'novo_efeito' && item.versao !== pedido.expectedItemVersion) throw new ConflictException('A fonte mudou. Confira a versão antes de iniciar outro pedido.');
      if (modo === 'novo_efeito' && (item.chave !== anterior.chave || item.sourceType !== anterior.sourceType || item.sourceRef !== anterior.sourceRef)) throw new ConflictException('A origem da fonte mudou.');
    } else if (item.versao !== pedido.expectedItemVersion || v.sourceType !== item.sourceType || v.sourceRef !== item.sourceRef) throw new ConflictException('A fonte mudou. Confira a versão antes de iniciar outro pedido.');
    return { item, v };
  }

  private leitoresAgendaNoTx(): LeitoresAgendaNoTx {
    return { painelNoTx: (tx, org, actor, slug) => this.painelNoTx(tx, org, actor, slug),
      detalheNoTx: (tx, org, actor, slug, id) => this.detalheNoTx(tx, org, actor, slug, id),
      fonteNoTx: (tx, org, actor, input, anterior, modo) => this.fonte(tx, org, actor, input, anterior, modo) };
  }
  listarAgendas(orgId: string, actorId: string, slug: string, cursorId?: string) {
    return this.agenda.listar(orgId, actorId, slug, this.leitoresAgendaNoTx(), cursorId);
  }
  obterAgenda(orgId: string, actorId: string, slug: string, agendaId: string) {
    return this.agenda.obter(orgId, actorId, slug, agendaId, this.leitoresAgendaNoTx());
  }
  operacaoLocalPorPedido(orgId: string, actorId: string, slug: string, requestId: string, query: AgendaLocalRecuperacaoConsulta, agendaId?: string) {
    return this.agenda.porOperacao(orgId, actorId, slug, requestId, query.tipoEsperado, agendaId, this.leitoresAgendaNoTx());
  }
  async criarAgenda(orgId: string, actorId: string, slug: string, entrada: unknown) {
    const input = AgendaLocalCriarSchema.parse(entrada);
    await this.agenda.configurar(orgId, actorId, slug, input, this.leitoresAgendaNoTx());
    return this.operacaoLocalPorPedido(orgId, actorId, slug, input.requestId, { tipoEsperado: 'agenda_criar' });
  }
  async editarAgenda(orgId: string, actorId: string, slug: string, agendaId: string, entrada: unknown) {
    const input = AgendaLocalEditarSchema.parse(entrada);
    await this.agenda.configurar(orgId, actorId, slug, input, this.leitoresAgendaNoTx(), agendaId);
    return this.operacaoLocalPorPedido(orgId, actorId, slug, input.requestId, { tipoEsperado: 'agenda_editar' }, agendaId);
  }
  async definirEstadoDaAgenda(orgId: string, actorId: string, slug: string, agendaId: string, entrada: unknown) {
    const input = AgendaLocalEstadoSchema.parse(entrada);
    await this.agenda.definirEstado(orgId, actorId, slug, agendaId, input, this.leitoresAgendaNoTx());
    return this.operacaoLocalPorPedido(orgId, actorId, slug, input.requestId, { tipoEsperado: 'agenda_estado' }, agendaId);
  }
  async executarDeAgenda(orgId: string, actorId: string, slug: string, agendaId: string, entrada: unknown) {
    const input = AgendaLocalDispararSchema.parse(entrada);
    return this.executarLocal(orgId, actorId, slug, undefined, { agendaId, input });
  }
  async executar(orgId: string, pessoaId: string, slug: string, entrada: unknown) {
    return this.executarLocal(orgId, pessoaId, slug, entrada);
  }
  private async conferirVinculoAgendaNoTx(tx: Prisma.TransactionClient, scope: EscopoAgenda, requestId: string, origem: OrigemAgenda, input: Pedido) {
    const look = await this.agenda.lookupNoTx(tx, scope.orgId, requestId);
    const op = this.agenda.conferirCausa(look, scope, requestId, 'agenda_disparar', undefined, origem.agendaId);
    if (!op || op.revisionId !== origem.revisionId) throw new ConflictException('A causa do disparo não pôde ser conferida.');
    const receipt = await this.agenda.recebidoNoTx(tx, op);
    if (receipt.tipo !== 'agenda_disparar' || receipt.snapshotHash !== origem.snapshotHash || receipt.agendaVersion !== origem.numero
      || JSON.stringify(receipt.entradaConfirmada) !== JSON.stringify(input)) throw new ConflictException('O pedido do disparo não pôde ser conferido.');
  }
  private async executarLocal(orgId: string, pessoaId: string, slug: string, entrada: unknown,
    origemPedido?: { agendaId: string; input: AgendaLocalDisparar }) {
    const direto = origemPedido ? null : ExecutarProcedimentoSchema.parse(entrada);
    const requestId = origemPedido?.input.requestId ?? direto?.requestId;
    if (!requestId) throw new BadRequestException('Pedido inválido.');
    const canalRef = `${REF_PROCEDIMENTO_LOCAL}${requestId}`;
    const inicio = Date.now();
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, EXECUTAR);
    const preparo = origemPedido ? await this.agenda.preparar('agenda_disparar') : null;
    const claim = await this.prisma.$transaction(async (tx) => {
      await this.agenda.travarClaimNoTx(tx, orgId, requestId);
      const look = await this.agenda.lookupNoTx(tx, orgId, requestId);
      if (!origemPedido && look.operation) throw new ConflictException('O pedido pertence a outra operação local.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      const identity = await this.agenda.travarAgenteNoTx(tx, orgId, slug);
      const scope = this.agenda.escopo(orgId, pessoaId, identity);
      await this.agenda.travarAutoridadeHumanaNoTx(tx, orgId, pessoaId, 'EXECUTAR');
      let revision: Awaited<ReturnType<AgendaLocalService['revisaoNoTx']>> | undefined;
      let origem: OrigemAgenda | undefined;
      let assinaturaAgenda: string | undefined;
      let op = origemPedido ? this.agenda.conferirCausa(look, scope, requestId, 'agenda_disparar', undefined, origemPedido.agendaId) : null;
      if (origemPedido) {
        const row = op ? await tx.agentLocalAgendaRevision.findFirst({ where: { id: op.revisionId ?? '', orgId, agentId: identity.id, agendaId: origemPedido.agendaId } })
          : await this.agenda.ultimaNoTx(tx, scope, origemPedido.agendaId);
        if (!row) throw new ConflictException('A revisão do disparo não pôde ser conferida.');
        revision = await this.agenda.revisaoNoTx(tx, row);
        origem = { agendaId: revision.agendaId, revisionId: revision.revisionId, snapshotHash: revision.snapshotHash, numero: revision.numero };
      }
      const input = direto ?? ExecutarProcedimentoSchema.parse({ requestId, ...revision?.configuracao.pedido });
      const assinatura = fingerprint({ pessoaId, slug, input });
      if (origemPedido && revision) {
        assinaturaAgenda = await this.agenda.assinaturaNoTx(tx, scope, requestId, 'agenda_disparar',
          { expectedAgendaVersion: origemPedido.input.expectedAgendaVersion, expectedSopVersion: origemPedido.input.expectedSopVersion },
          { agendaId: revision.agendaId, revisionId: revision.revisionId, snapshotHash: revision.snapshotHash, pedidoConfirmado: input });
        op = this.agenda.conferirCausa(look, scope, requestId, 'agenda_disparar', assinaturaAgenda, origemPedido.agendaId);
      }
      const existentes = await tx.session.findMany({ where: { orgId, canal: 'web', canalRef }, take: 2, include: { steps: { where: { ordem: 1 } } } });
      if (existentes.length > 1) throw new ConflictException('O pedido não pôde ser conferido.');
      const existente = existentes[0];
      if (existente) {
        if (existente.solicitanteId !== pessoaId || existente.agentId !== identity.id || origemPedido && (!op || op.sessionId !== existente.id))
          throw new ConflictException('Este pedido pertence a outra execução, conteúdo ou pessoa.');
        const { registro } = lerRegistro(existente.steps[0]?.payload, pessoaId, slug, requestId);
        if (registro.entradaContrato !== 2 || registro.fingerprint !== assinatura) throw new ConflictException('Este pedido pertence a outra execução, conteúdo ou pessoa.');
        await this.fonte(tx, orgId, pessoaId, input, registro.fonte, 'historico');
        if (origem && op) await this.conferirVinculoAgendaNoTx(tx, scope, requestId, origem, input);
        await exigirAcessoAtual(tx, orgId, pessoaId, EXECUTAR);
        return { sessionId: existente.id, repetido: true as const, input, origem, scope };
      }
      if (op) throw new ConflictException('A sessão do disparo não pôde ser conferida.');
      if (origemPedido && revision) {
        await this.agenda.conferirFonteHistoricaDaAgendaNoTx(tx, scope, revision, requestId, this.leitoresAgendaNoTx());
        await this.agenda.conferirDisparoNoTx(tx, scope, revision, origemPedido.input);
        const cfg = revision.configuracao;
        const reais = await this.agenda.conferirConfiguracaoNoTx(tx, scope, identity, { nome: cfg.nome, previstoPara: cfg.previstoPara,
          responsavelId: cfg.responsavelId, modeloConfiguradoEsperado: cfg.modeloConfigurado, pedido: cfg.pedido }, this.leitoresAgendaNoTx());
        const sopAtual = this.agenda.snapshot(scope, revision.agendaId, { nome: cfg.nome, previstoPara: cfg.previstoPara,
          responsavelId: cfg.responsavelId, modeloConfiguradoEsperado: cfg.modeloConfigurado, pedido: cfg.pedido }, reais).procedimento;
        if (await this.agenda.hashNoTx(tx, sopAtual) !== await this.agenda.hashNoTx(tx, cfg.procedimento)) throw new ConflictException('O procedimento consumido pela agenda mudou.');
      }
      const { agente, sop, dono } = await this.sopDoCompromisso(tx, orgId, pessoaId, slug, input);
      const { item, v } = await this.fonte(tx, orgId, pessoaId, input, revision?.configuracao.fonte);
      const causa = agente.estado !== 'ativo' || !agente.ativo ? `Agente ${agente.estado}. Retome antes de criar outro pedido.`
        : !dono ? 'Responsável indisponível nesta empresa.'
        : !agente.capacidades.includes('contexto.memoria.buscar') || agente.capacidades.some((c) => c !== 'contexto.memoria.buscar')
          ? 'Ferramenta não permitida neste procedimento. Nenhuma ferramenta foi executada.' : null;
      if (origemPedido && causa) throw new ConflictException(causa);
      if (revision) await this.agenda.orcamentoDisparoNoTx(tx, scope, revision, input, await this.painelNoTx(tx, orgId, pessoaId, slug), agente);
      const registro: Registro = { tipo: 'procedimento_local', entradaContrato: 2, fingerprint: assinatura, requestId, entrada: input, ...(origem ? { origemAgenda: origem } : {}), modeloConfigurado: agente.modelo,
        procedimento: { versao: sop.versao, proposito: sop.proposito, passos: sop.passos, definicaoDePronto: sop.definicaoDePronto },
        fonte: { itemId: item.id, versionId: v.id, contentHash: v.contentHash, versao: v.versao, chave: item.chave, sourceType: v.sourceType, sourceRef: v.sourceRef, title: v.title } };
      const session = await tx.session.create({ data: { orgId, agentId: agente.id, canal: 'web', canalRef,
        solicitanteId: pessoaId, solicitanteRotulo: 'Operador do procedimento local', pedido: 'Procedimento local de síntese de fonte',
        status: causa ? SessionStatus.recusada : SessionStatus.rodando, motivo: causa, encerradaEm: causa ? new Date() : null,
        provider: 'llama.cpp-local', modelo: agente.modelo, custoEstimado: false,
        steps: { create: { orgId, ordem: 1, tipo: 'pedido', gatilhos: [], payload: registro as unknown as Prisma.InputJsonValue } } }, select: { id: true } });
      await this.audit.log({ orgId, actorId: pessoaId, action: 'agent.procedimento.request', entityType: 'session', entityId: session.id,
        metadata: { requestId, agenteId: agente.id, semEfeitosExternos: true } }, tx);
      if (revision && preparo && assinaturaAgenda) {
        const operation = await this.agenda.registrarDispatchNoTx(tx, scope, revision, input, session.id, assinaturaAgenda, preparo);
        await this.agenda.recuperarNoTx(tx, scope, agente, operation, this.leitoresAgendaNoTx());
        await this.agenda.painelNoTx(tx, scope, agente, await this.agenda.ultimaNoTx(tx, scope, revision.agendaId), this.leitoresAgendaNoTx());
      }
      await exigirAcessoAtual(tx, orgId, pessoaId, EXECUTAR);
      return { sessionId: session.id, repetido: false as const, registro, modelo: agente.modelo, causa, body: v.body, nome: agente.nome, input, origem, scope };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const input = claim.input;
    if (claim.repetido || claim.causa) return origemPedido
      ? this.operacaoLocalPorPedido(orgId, pessoaId, slug, requestId, { tipoEsperado: 'agenda_disparar' }, origemPedido.agendaId)
      : this.detalhe(orgId, pessoaId, slug, claim.sessionId);
    let saida: ResultadoLocal | undefined;
    let observado: ObservacaoLocal | undefined;
    let motivo: string | null = null;
    let status: SessionStatus = SessionStatus.respondida;
    try {
      await this.conferirAntesDaChamada(orgId, pessoaId, slug, input, claim.registro, claim.origem);
      const estado = await this.modelo.estado();
      if (!estado.disponivel || !claim.modelo || estado.modelo !== claim.modelo) { status = SessionStatus.recusada; throw new Error(estado.motivo ?? 'O modelo configurado não está disponível. Configure um agente com o modelo local disponível.'); }
      await this.conferirAntesDaChamada(orgId, pessoaId, slug, input, claim.registro, claim.origem);
      const prompt = promptSinteseLocal({ pedido: input.pedido, body: claim.body, versao: claim.registro.fonte.versao,
        procedimento: claim.registro.procedimento });
      saida = await this.modelo.resumir(claim.modelo, prompt.system, prompt.user);
      observado = { modelo: saida.modelo, tokensIn: saida.tokensIn, tokensOut: saida.tokensOut,
        ...(saida.finishReason === undefined ? {} : { finishReason: saida.finishReason }) };
      await this.conferirAntesDaChamada(orgId, pessoaId, slug, input, claim.registro, claim.origem);
    } catch (e) {
      if (e instanceof FalhaSinteseLocal) observado = e.observado;
      const negado = e instanceof NotFoundException || e instanceof ConflictException || (e as { getStatus?: () => number })?.getStatus?.() === 403 || (e instanceof Error && e.message.startsWith('Agente pausado'));
      if (status === SessionStatus.respondida) status = negado ? SessionStatus.recusada : SessionStatus.falhou;
      const mensagem = e instanceof Error ? e.message : '';
      motivo = /^(Modelo local|Servidor do modelo|O modelo |A chamada do modelo|Ferramenta não permitida|Agente pausado|Acesso insuficiente|Fonte indisponível|A origem da fonte|A versão da fonte)/.test(mensagem) ? mensagem : 'O procedimento foi interrompido. Confira a execução antes de criar outro pedido.';
      saida = undefined;
    }
    await this.prisma.$transaction(async (tx) => {
      await this.agenda.travarClaimNoTx(tx, orgId, input.requestId);
      if (claim.origem) await this.conferirVinculoAgendaNoTx(tx, claim.scope, input.requestId, claim.origem, input);
      else await this.agenda.exigirPedidoDiretoNoTx(tx, orgId, input.requestId);
      const anteriorSession = await tx.session.findFirst({ where: { id: claim.sessionId, orgId, agentId: claim.scope.agentId,
        solicitanteId: pessoaId, canal: 'web', canalRef }, include: { steps: { where: { ordem: 1 } } } });
      if (!anteriorSession || lerRegistro(anteriorSession.steps[0]?.payload, pessoaId, slug, input.requestId).registro.fingerprint !== fingerprint({ pessoaId, slug, input }))
        throw new ConflictException('A observação não corresponde à execução confirmada.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      // Serializa o registro com a pausa: uma pausa já confirmada vence; uma
      // pausa concorrente só confirma depois desta gravação atômica.
      await tx.$queryRaw`SELECT "id" FROM "Agent" WHERE "orgId"=${orgId} AND "slug"=${slug} FOR UPDATE`;
      const agente = await tx.agent.findFirst({ where: { orgId, slug }, select: { estado: true, ativo: true } });
      if (saida && (!agente || agente.estado !== 'ativo' || !agente.ativo)) { saida = undefined; status = SessionStatus.recusada; motivo = 'Agente pausado ou encerrado antes de registrar o resultado.'; }
      if (saida) {
        try {
          const atual = await this.sopDoCompromisso(tx, orgId, pessoaId, slug, input);
          if (claim.origem) await this.agenda.conferirAgendaParaNovoEfeitoNoTx(tx, claim.scope, claim.origem);
          await this.agenda.travarAutoridadeHumanaNoTx(tx, orgId, pessoaId, 'EXECUTAR');
          if (!atual.dono || atual.agente.estado !== 'ativo' || !atual.agente.ativo) throw new ConflictException('Agente pausado ou responsável indisponível.');
          await this.fonte(tx, orgId, pessoaId, input, claim.registro.fonte);
          await exigirAcessoAtual(tx, orgId, pessoaId, EXECUTAR);
        } catch { saida = undefined; status = SessionStatus.recusada; motivo = 'O acesso, a fonte ou o procedimento mudou antes de registrar o resultado.'; }
      }
      RegistroSchema.parse({ ...claim.registro, ...(saida ? { saida } : {}), ...(observado ? { observado } : {}) });
      await tx.sessionStep.update({ where: { sessionId_ordem: { sessionId: claim.sessionId, ordem: 1 } },
        data: { payload: { ...claim.registro, ...(saida ? { saida } : {}), ...(observado ? { observado } : {}) } as unknown as Prisma.InputJsonValue } });
      await tx.sessionStep.create({ data: { orgId, sessionId: claim.sessionId, ordem: 2, tipo: observado ? 'modelo' : 'erro',
        gatilhos: [], provider: 'llama.cpp-local', modelo: observado ? observado.modelo : claim.modelo,
        tokensIn: observado?.tokensIn, tokensOut: observado?.tokensOut, stopReason: observado?.finishReason ?? null, erro: motivo, custoEstimado: false } });
      await tx.session.update({ where: { id: claim.sessionId }, data: { status, motivo, resposta: saida ? 'Resultado disponível no procedimento local.' : '',
        encerradaEm: new Date(), ultimaAtividadeEm: new Date(), passos: 2, duracaoMs: Date.now() - inicio,
        tokensIn: observado?.tokensIn ?? 0, tokensOut: observado?.tokensOut ?? 0, modelo: observado ? observado.modelo : claim.modelo } });
      await tx.agent.updateMany({ where: { orgId, slug }, data: { ultimaExecucaoEm: new Date(), ultimoStatus: status, ...(observado ? { execucoes: { increment: 1 } } : {}), ...(status === SessionStatus.falhou ? { falhas: { increment: 1 } } : {}) } });
      await this.audit.log({ orgId, actorId: pessoaId, action: 'agent.procedimento.result', entityType: 'session', entityId: claim.sessionId,
        metadata: { status, semEfeitosExternos: true } }, tx);
      if (saida) {
        await this.detalheNoTx(tx, orgId, pessoaId, slug, claim.sessionId);
        if (claim.origem) {
          const look = await this.agenda.lookupNoTx(tx, orgId, input.requestId);
          const op = this.agenda.conferirCausa(look, claim.scope, input.requestId, 'agenda_disparar', undefined, claim.origem.agendaId);
          const a = await tx.agent.findFirst({ where: { id: claim.scope.agentId, orgId } });
          if (!op || !a) throw new ConflictException('A causa final do disparo não pôde ser conferida.');
          await this.agenda.recuperarNoTx(tx, claim.scope, a, op, this.leitoresAgendaNoTx());
        }
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return origemPedido ? this.operacaoLocalPorPedido(orgId, pessoaId, slug, requestId, { tipoEsperado: 'agenda_disparar' }, origemPedido.agendaId)
      : this.detalhe(orgId, pessoaId, slug, claim.sessionId);
  }

  private async conferirAntesDaChamada(orgId: string, pessoaId: string, slug: string, input: Pedido, registro: Registro, origem?: OrigemAgenda) {
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, EXECUTAR);
    await this.prisma.$transaction(async (tx) => {
      await this.agenda.travarClaimNoTx(tx, orgId, input.requestId);
      if (!origem) await this.agenda.exigirPedidoDiretoNoTx(tx, orgId, input.requestId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      const { agente, dono, sop } = await this.sopDoCompromisso(tx, orgId, pessoaId, slug, input);
      const scope = this.agenda.escopo(orgId, pessoaId, agente);
      if (origem) {
        await this.conferirVinculoAgendaNoTx(tx, scope, input.requestId, origem, input);
        await this.agenda.conferirAgendaParaNovoEfeitoNoTx(tx, scope, origem);
      }
      await this.agenda.travarAutoridadeHumanaNoTx(tx, orgId, pessoaId, 'EXECUTAR');
      if (agente.estado !== 'ativo' || !agente.ativo || !dono) throw new ConflictException('Agente pausado ou responsável indisponível.');
      if (sop.versao !== registro.procedimento.versao || sop.proposito !== registro.procedimento.proposito
        || JSON.stringify(sop.passos) !== JSON.stringify(registro.procedimento.passos) || sop.definicaoDePronto !== registro.procedimento.definicaoDePronto)
        throw new ConflictException({ code: 'agente_procedimento_sop_alterado', message: 'O procedimento mudou antes do novo efeito.' });
      await this.fonte(tx, orgId, pessoaId, input, registro.fonte);
      await exigirAcessoAtual(tx, orgId, pessoaId, EXECUTAR);
      const atual = await reconferirFontesAtuais(tx, orgId, pessoaId, EXECUTAR, [input.itemId], false, slug);
      if (!atual.agenteDisponivel) throw new ConflictException('Agente pausado ou indisponível.');
      const item = atual.fontes[0];
      if (!item) throw new NotFoundException('Fonte indisponível para esta conta.');
      if (item.chave !== registro.fonte.chave || item.sourceType !== registro.fonte.sourceType || item.sourceRef !== registro.fonte.sourceRef
        || item.versao !== input.expectedItemVersion) throw new ConflictException('A fonte mudou. Confira a versão antes de iniciar outro pedido.');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async porPedido(orgId: string, pessoaId: string, slug: string, requestId: string) {
    if (!z.string().uuid().safeParse(requestId).success) throw new BadRequestException('Pedido inválido.');
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, LER);
    return this.prisma.$transaction(async (tx) => {
      await this.agenda.travarClaimNoTx(tx, orgId, requestId);
      await this.agenda.exigirPedidoDiretoNoTx(tx, orgId, requestId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      await exigirAcessoAtual(tx, orgId, pessoaId, LER);
      const agente = await tx.agent.findFirst({ where: { orgId, slug }, select: { id: true, slug: true } });
      if (!agente) throw new NotFoundException('Agente indisponível.');
      const escopo = { orgId, userId: pessoaId, agentId: agente.id, agentSlug: agente.slug };
      const sessions = await tx.session.findMany({ where: { orgId, canal: 'web', canalRef: `${REF_PROCEDIMENTO_LOCAL}${requestId}` }, take: 2 });
      if (!sessions.length) {
        await exigirAcessoAtual(tx, orgId, pessoaId, LER);
        return ProcedimentoLocalRecuperacaoSchema.parse({ estado: 'ausencia_conferida', escopo, requestId });
      }
      if (sessions.length !== 1 || sessions[0].solicitanteId !== pessoaId || sessions[0].agentId !== agente.id)
        throw new ConflictException('O pedido não pôde ser conferido para esta pessoa e agente.');
      const execucao = await this.detalheNoTx(tx, orgId, pessoaId, slug, sessions[0].id);
      if (execucao.requestId !== requestId) throw new ConflictException('O pedido não pôde ser conferido.');
      await exigirAcessoAtual(tx, orgId, pessoaId, LER);
      return ProcedimentoLocalRecuperacaoSchema.parse({ estado: 'confirmado', escopo, requestId, execucao });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async detalheNoTx(db: Prisma.TransactionClient, orgId: string, pessoaId: string, slug: string, sessionId: string): Promise<ProcedimentoLocalExecucao> {
    await exigirAcessoAtual(db, orgId, pessoaId, LER);
    const session = await db.session.findFirst({ where: { id: sessionId, orgId, solicitanteId: pessoaId,
      canal: 'web', canalRef: { startsWith: REF_PROCEDIMENTO_LOCAL }, agent: { orgId, slug } }, include: { steps: { where: { ordem: 1 } } } });
    if (!session?.canalRef) throw new NotFoundException('Execução indisponível.');
    const requestId = session.canalRef.slice(REF_PROCEDIMENTO_LOCAL.length);
    const { registro, entradaConfirmada } = lerRegistro(session.steps[0]?.payload, pessoaId, slug, requestId);
    if (registro.origemAgenda) {
      if (entradaConfirmada.contrato !== 2) throw new ConflictException('A origem da execução não pôde ser conferida.');
      const agente = await db.agent.findFirst({ where: { id: session.agentId, orgId, slug }, select: { id: true, slug: true } });
      if (!agente) throw new NotFoundException('Execução indisponível.');
      await this.conferirVinculoAgendaNoTx(db, this.agenda.escopo(orgId, pessoaId, agente), requestId, registro.origemAgenda, entradaConfirmada.input);
    } else await this.agenda.exigirPedidoDiretoNoTx(db, orgId, requestId);
    const { item, v } = await this.fonte(db, orgId, pessoaId, registro.entrada, registro.fonte, 'historico');
    const painelAtual = await this.painelNoTx(db, orgId, pessoaId, slug);
    const atual = await reconferirFontesAtuais(db, orgId, pessoaId, LER, [item.id], true);
    const fonteFinal = atual.fontes[0];
    if (!fonteFinal) throw new NotFoundException('Fonte indisponível para esta conta.');
    const retratoFonte = construirFonteAutorizada({ item: fonteFinal, versaoSelecionada: v, incluirCorpo: true, acessoVerificadoEm: new Date(),
      novoUsoPermitido: !fonteFinal.movimentoPendente && !fonteFinal.arquivadoEm && fonteFinal.chave === registro.fonte.chave && fonteFinal.sourceType === v.sourceType && fonteFinal.sourceRef === v.sourceRef, chaveConsumida: registro.fonte.chave });
    return ProcedimentoLocalExecucaoSchema.parse({ escopo: painelAtual.escopo, retratoFonte, painelAtual,
      procedimentoAtual: painelAtual.procedimento, entradaConfirmada, id: session.id, requestId: registro.requestId, status: session.status, motivo: session.motivo,
      pessoaId, pedido: registro.entrada.pedido, procedimento: registro.procedimento,
      fonte: registro.fonte, resposta: registro.saida?.texto ?? null,
      modeloConfigurado: registro.modeloConfigurado, modeloUsado: registro.observado?.modelo ?? null, provider: 'llama.cpp-local',
      consumo: { tokensIn: registro.observado?.tokensIn ?? null, tokensOut: registro.observado?.tokensOut ?? null,
        origem: registro.observado ? 'resposta_do_servidor_local' : 'nenhuma_chamada_concluida', custoExternoUsd: 0, custoMaquinaMedido: false },
      criadaEm: session.criadaEm.toISOString(), encerradaEm: session.encerradaEm?.toISOString() ?? null });
  }

  async detalhe(orgId: string, pessoaId: string, slug: string, sessionId: string) {
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, LER);
    const identity = await this.prisma.session.findFirst({ where: { id: sessionId, orgId, solicitanteId: pessoaId,
      canal: 'web', canalRef: { startsWith: REF_PROCEDIMENTO_LOCAL }, agent: { orgId, slug } }, select: { canalRef: true } });
    if (!identity?.canalRef) throw new NotFoundException('Execução indisponível.');
    const requestId = identity.canalRef.slice(REF_PROCEDIMENTO_LOCAL.length);
    if (!z.string().uuid().safeParse(requestId).success) throw new ConflictException('O pedido não pôde ser conferido.');
    return this.prisma.$transaction(async (tx) => {
      await this.agenda.travarClaimNoTx(tx, orgId, requestId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      await this.agenda.travarAgenteNoTx(tx, orgId, slug, false);
      await this.agenda.travarAutoridadeHumanaNoTx(tx, orgId, pessoaId, 'LER');
      const result = await this.detalheNoTx(tx, orgId, pessoaId, slug, sessionId);
      await exigirAcessoAtual(tx, orgId, pessoaId, LER); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
