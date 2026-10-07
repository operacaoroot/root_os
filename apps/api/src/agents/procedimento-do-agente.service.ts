import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, RiskLevel, SessionStatus } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { exigirAcessoAtual, filtroDeLeitura } from '../memory/acesso-memoria';
import { hashDoCorpo } from '../memory/procedencia';
import { AgenteIdentidadeSchema } from './agents.service';
import { blocoExterno } from './context-builder.service';
import { FormatoDaSopInvalido, validarProcedimento } from './sop';
import { ModeloLocalService, type ResultadoLocal } from './modelo-local.service';

export const REF_PROCEDIMENTO_LOCAL = 'procedimento-local:';
const CONFIGURAR = ['automacoes.executar', 'admin.usuarios'];
const EXECUTAR = ['mcp.ver', 'mcp.executar', 'admin.usuarios', 'obsidian.ver'];
const LER = ['mcp.ver', 'obsidian.ver'];
export const CriarProcedimentoSchema = AgenteIdentidadeSchema.required().extend({
  requestId: z.string().uuid(), modelo: z.string().min(1).max(200).nullable(), procedimento: z.unknown(),
}).strict();
export const ExecutarProcedimentoSchema = z.object({
  requestId: z.string().uuid(), pedido: z.string().trim().min(1).max(2000),
  itemId: z.string().uuid(), versionId: z.string().uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedItemVersion: z.number().int().positive(),
}).strict();

type Pedido = z.infer<typeof ExecutarProcedimentoSchema>;
interface Registro {
  tipo: 'procedimento_local'; fingerprint: string; requestId: string; entrada: Pedido;
  procedimento: { versao: number; proposito: string; passos: string[]; definicaoDePronto: string };
  fonte: { itemId: string; versionId: string; contentHash: string; versao: number; chave: string; sourceType: string; sourceRef: string | null; title: string };
  saida?: ResultadoLocal;
  observado?: Omit<ResultadoLocal, 'texto'>;
  modeloConfigurado: string | null;
}
const fingerprint = (valor: unknown) => createHash('sha256').update(JSON.stringify(valor)).digest('hex');

/** Procedimento de leitura → síntese local → registro. Não executa ferramentas externas. */
@Injectable()
export class ProcedimentoDoAgenteService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly modelo: ModeloLocalService) {}

  async configuracao(orgId: string, pessoaId: string) {
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, CONFIGURAR);
    const [pessoas, estado] = await Promise.all([
      this.prisma.user.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.modelo.estado(),
    ]);
    return { pessoas, modelo: estado, capacidades: ['contexto.memoria.buscar'],
      procedimentoSuportado: 'Ler uma versão de fonte, sintetizar com modelo local e registrar o resultado. Sem ferramentas externas.' };
  }

  async criar(orgId: string, pessoaId: string, entrada: unknown) {
    const input = CriarProcedimentoSchema.parse(entrada);
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
        return { ...existente, repetido: true };
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
      return { ...agente, repetido: false };
    });
  }

  async fontes(orgId: string, pessoaId: string, slug: string) {
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, LER);
    const agente = await this.prisma.agent.findFirst({ where: { orgId, slug }, select: { id: true } });
    if (!agente) throw new NotFoundException('Agente indisponível.');
    const rows = await this.prisma.contextItem.findMany({ where: { orgId, ...filtroDeLeitura(pessoaId), arquivadoEm: null },
      take: 100, orderBy: { title: 'asc' }, select: { id: true, title: true, chave: true, versao: true,
        versoes: { orderBy: { versao: 'desc' }, select: { id: true, title: true, versao: true, contentHash: true, sourceType: true, sourceRef: true } } } });
    const modelo = await this.modelo.estado();
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, LER);
    const atuais = await this.prisma.contextItem.findMany({ where: { orgId, ...filtroDeLeitura(pessoaId), arquivadoEm: null, id: { in: rows.map((r) => r.id) } }, select: { id: true } });
    const ids = new Set(atuais.map((r) => r.id));
    return { items: rows.filter((r) => ids.has(r.id)), modelo };
  }

  private async fonte(db: Pick<Prisma.TransactionClient, 'contextItem' | 'contextItemVersion'>,
    orgId: string, pessoaId: string, pedido: Pedido, anterior?: Registro['fonte'], permitirArquivada = false) {
    const item = await db.contextItem.findFirst({ where: { id: pedido.itemId, orgId, ...filtroDeLeitura(pessoaId), ...(permitirArquivada ? {} : { arquivadoEm: null }) } });
    if (!item) throw new NotFoundException('Fonte indisponível para esta conta.');
    const v = await db.contextItemVersion.findFirst({ where: { id: pedido.versionId, itemId: item.id, orgId } });
    if (!v || v.versao > item.versao || v.contentHash !== pedido.contentHash || hashDoCorpo(v.body) !== v.contentHash) throw new ConflictException('A versão da fonte não corresponde ao pedido.');
    if (anterior) {
      if (v.sourceType !== anterior.sourceType || v.sourceRef !== anterior.sourceRef || item.chave !== anterior.chave || item.sourceType !== anterior.sourceType || item.sourceRef !== anterior.sourceRef) throw new ConflictException('A origem da fonte mudou.');
    } else if (item.versao !== pedido.expectedItemVersion || v.sourceType !== item.sourceType || v.sourceRef !== item.sourceRef) throw new ConflictException('A fonte mudou. Confira a versão antes de iniciar outro pedido.');
    return { item, v };
  }

  async executar(orgId: string, pessoaId: string, slug: string, entrada: unknown) {
    const input = ExecutarProcedimentoSchema.parse(entrada);
    const assinatura = fingerprint({ pessoaId, slug, input });
    const canalRef = `${REF_PROCEDIMENTO_LOCAL}${input.requestId}`;
    const inicio = Date.now();
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`procedimento:${orgId}:${input.requestId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      await exigirAcessoAtual(tx, orgId, pessoaId, EXECUTAR);
      const existente = await tx.session.findFirst({ where: { orgId, canal: 'web', canalRef }, include: { steps: { where: { ordem: 1 } } } });
      if (existente) {
        const registro = existente.steps[0]?.payload as unknown as Registro | null;
        if (!registro || registro.fingerprint !== assinatura || existente.solicitanteId !== pessoaId) throw new ConflictException('Este pedido pertence a outra execução, conteúdo ou pessoa.');
        await this.fonte(tx, orgId, pessoaId, input, registro.fonte, true);
        return { sessionId: existente.id, repetido: true as const };
      }
      const agente = await tx.agent.findFirst({ where: { orgId, slug }, include: { sop: true } });
      if (!agente) throw new NotFoundException('Agente indisponível.');
      const { item, v } = await this.fonte(tx, orgId, pessoaId, input);
      const dono = await tx.user.findFirst({ where: { id: agente.donoId ?? '', orgId, isActive: true }, select: { id: true } });
      const causa = agente.estado !== 'ativo' || !agente.ativo ? `Agente ${agente.estado}. Retome antes de criar outro pedido.`
        : !dono ? 'Responsável indisponível nesta empresa.'
        : !agente.sop ? 'Defina o procedimento antes de iniciar.'
        : !agente.capacidades.includes('contexto.memoria.buscar') || agente.capacidades.some((c) => c !== 'contexto.memoria.buscar')
          ? 'Ferramenta não permitida neste procedimento. Nenhuma ferramenta foi executada.' : null;
      const registro: Registro = { tipo: 'procedimento_local', fingerprint: assinatura, requestId: input.requestId, entrada: input,
        modeloConfigurado: agente.modelo,
        procedimento: { versao: agente.sop?.versao ?? 0, proposito: agente.sop?.proposito ?? '', passos: agente.sop?.passos ?? [], definicaoDePronto: agente.sop?.definicaoDePronto ?? '' },
        fonte: { itemId: item.id, versionId: v.id, contentHash: v.contentHash, versao: v.versao, chave: item.chave, sourceType: v.sourceType, sourceRef: v.sourceRef, title: v.title } };
      const session = await tx.session.create({ data: { orgId, agentId: agente.id, canal: 'web', canalRef,
        solicitanteId: pessoaId, solicitanteRotulo: 'Operador do procedimento local', pedido: 'Procedimento local de síntese de fonte',
        status: causa ? SessionStatus.recusada : SessionStatus.rodando, motivo: causa,
        encerradaEm: causa ? new Date() : null, provider: 'llama.cpp-local', modelo: agente.modelo, custoEstimado: false,
        steps: { create: { orgId, ordem: 1, tipo: 'pedido', gatilhos: [], payload: registro as unknown as Prisma.InputJsonValue } } }, select: { id: true } });
      await this.audit.log({ orgId, actorId: pessoaId, action: 'agent.procedimento.request', entityType: 'session', entityId: session.id,
        metadata: { requestId: input.requestId, agenteId: agente.id, semEfeitosExternos: true } }, tx);
      return { sessionId: session.id, repetido: false as const, registro, modelo: agente.modelo, causa, body: v.body, nome: agente.nome };
    });
    if (claim.repetido || claim.causa) return this.detalhe(orgId, pessoaId, slug, claim.sessionId);
    let saida: ResultadoLocal | undefined;
    let observado: Omit<ResultadoLocal, 'texto'> | undefined;
    let motivo: string | null = null;
    let status: SessionStatus = SessionStatus.respondida;
    try {
      await this.conferirAntesDaChamada(orgId, pessoaId, slug, input, claim.registro);
      const estado = await this.modelo.estado();
      if (!estado.disponivel || !claim.modelo || estado.modelo !== claim.modelo) { status = SessionStatus.recusada; throw new Error(estado.motivo ?? 'O modelo configurado não está disponível. Configure um agente com o modelo local disponível.'); }
      await this.conferirAntesDaChamada(orgId, pessoaId, slug, input, claim.registro);
      const contexto = blocoExterno([{ origem: claim.registro.fonte.chave, titulo: claim.registro.fonte.title,
        conteudo: `${JSON.stringify(claim.registro.fonte)}\n${claim.body}` }]).texto;
      const instrucoes = `Você prepara uma síntese de uma fonte para uma pessoa. Não use ferramentas nem execute ações. Cite a versão da fonte.\nPropósito: ${claim.registro.procedimento.proposito}\nPassos solicitados: ${claim.registro.procedimento.passos.join('\n')}\nResultado esperado: ${claim.registro.procedimento.definicaoDePronto}`;
      saida = await this.modelo.resumir(claim.modelo, instrucoes, `${input.pedido}\n\n${contexto}`);
      observado = { modelo: saida.modelo, tokensIn: saida.tokensIn, tokensOut: saida.tokensOut };
      await this.conferirAntesDaChamada(orgId, pessoaId, slug, input, claim.registro);
    } catch (e) {
      const negado = e instanceof NotFoundException || e instanceof ConflictException || (e as { getStatus?: () => number })?.getStatus?.() === 403 || (e instanceof Error && e.message.startsWith('Agente pausado'));
      if (status === SessionStatus.respondida) status = negado ? SessionStatus.recusada : SessionStatus.falhou;
      const mensagem = e instanceof Error ? e.message : '';
      motivo = /^(Modelo local|Servidor do modelo|O modelo |A chamada do modelo|Ferramenta não permitida|Agente pausado|Acesso insuficiente|Fonte indisponível|A origem da fonte|A versão da fonte)/.test(mensagem) ? mensagem : 'O procedimento foi interrompido. Confira a execução antes de criar outro pedido.';
      saida = undefined;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`procedimento:${orgId}:${input.requestId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      // Serializa o registro com a pausa: uma pausa já confirmada vence; uma
      // pausa concorrente só confirma depois desta gravação atômica.
      await tx.$queryRaw`SELECT "id" FROM "Agent" WHERE "orgId"=${orgId} AND "slug"=${slug} FOR UPDATE`;
      const agente = await tx.agent.findFirst({ where: { orgId, slug }, select: { estado: true, ativo: true } });
      if (saida && (!agente || agente.estado !== 'ativo' || !agente.ativo)) { saida = undefined; status = SessionStatus.recusada; motivo = 'Agente pausado ou encerrado antes de registrar o resultado.'; }
      if (saida) {
        try { await exigirAcessoAtual(tx, orgId, pessoaId, EXECUTAR); await this.fonte(tx, orgId, pessoaId, input, claim.registro.fonte); }
        catch { saida = undefined; status = SessionStatus.recusada; motivo = 'Acesso à fonte revogado antes de registrar o resultado.'; }
      }
      await tx.sessionStep.update({ where: { sessionId_ordem: { sessionId: claim.sessionId, ordem: 1 } },
        data: { payload: { ...claim.registro, ...(saida ? { saida } : {}), ...(observado ? { observado } : {}) } as unknown as Prisma.InputJsonValue } });
      await tx.sessionStep.create({ data: { orgId, sessionId: claim.sessionId, ordem: 2, tipo: observado ? 'modelo' : 'erro',
        gatilhos: [], provider: 'llama.cpp-local', modelo: observado?.modelo ?? claim.modelo,
        tokensIn: observado?.tokensIn, tokensOut: observado?.tokensOut, erro: motivo, custoEstimado: false } });
      await tx.session.update({ where: { id: claim.sessionId }, data: { status, motivo, resposta: saida ? 'Resultado disponível no procedimento local.' : '',
        encerradaEm: new Date(), ultimaAtividadeEm: new Date(), passos: 2, duracaoMs: Date.now() - inicio,
        tokensIn: observado?.tokensIn ?? 0, tokensOut: observado?.tokensOut ?? 0, modelo: observado?.modelo ?? claim.modelo } });
      await tx.agent.updateMany({ where: { orgId, slug }, data: { ultimaExecucaoEm: new Date(), ultimoStatus: status, ...(observado ? { execucoes: { increment: 1 } } : {}), ...(status === SessionStatus.falhou ? { falhas: { increment: 1 } } : {}) } });
      await this.audit.log({ orgId, actorId: pessoaId, action: 'agent.procedimento.result', entityType: 'session', entityId: claim.sessionId,
        metadata: { status, semEfeitosExternos: true } }, tx);
    });
    return this.detalhe(orgId, pessoaId, slug, claim.sessionId);
  }

  private async conferirAntesDaChamada(orgId: string, pessoaId: string, slug: string, input: Pedido, registro: Registro) {
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, EXECUTAR);
    const agente = await this.prisma.agent.findFirst({ where: { orgId, slug, estado: 'ativo', ativo: true }, select: { id: true } });
    if (!agente) throw new Error('Agente pausado ou encerrado. Nenhum novo efeito foi produzido.');
    await this.fonte(this.prisma, orgId, pessoaId, input, registro.fonte);
  }

  async detalhe(orgId: string, pessoaId: string, slug: string, sessionId: string) {
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, LER);
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, orgId, solicitanteId: pessoaId,
      canalRef: { startsWith: REF_PROCEDIMENTO_LOCAL }, agent: { slug } }, include: { steps: { where: { ordem: 1 } } } });
    if (!session) throw new NotFoundException('Execução indisponível.');
    const registro = session.steps[0]?.payload as unknown as Registro;
    if (registro?.tipo !== 'procedimento_local') throw new NotFoundException('Execução indisponível.');
    await this.fonte(this.prisma, orgId, pessoaId, registro.entrada, registro.fonte, true);
    await exigirAcessoAtual(this.prisma, orgId, pessoaId, LER);
    return { id: session.id, requestId: registro.requestId, status: session.status, motivo: session.motivo,
      pessoaId, pedido: registro.entrada.pedido, procedimento: registro.procedimento,
      fonte: registro.fonte, resposta: registro.saida?.texto ?? null,
      modeloConfigurado: registro.modeloConfigurado, modeloUsado: registro.observado?.modelo ?? null, provider: 'llama.cpp-local',
      consumo: { tokensIn: registro.observado?.tokensIn ?? null, tokensOut: registro.observado?.tokensOut ?? null,
        origem: registro.observado ? 'resposta_do_servidor_local' : 'nenhuma_chamada_concluida', custoExternoUsd: 0, custoMaquinaMedido: false },
      criadaEm: session.criadaEm.toISOString(), encerradaEm: session.encerradaEm?.toISOString() ?? null };
  }
}
