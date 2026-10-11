import { PautaRelatorioHumanoPainelSchema, type PautaRelatorioHumanoPainel, type PautaRelatorioSalvarHumanoInput, type PautaEscritaHumanaResultado } from '@mktos/shared';
import { ConflictException, ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, ActorType, ContextKind, ContextSource } from '@prisma/client';
import {
  chaveDaEstrategia,
  chaveDoRelatorio,
  mesDaChaveDoRelatorio,
  type PautaRelatorioPainel,
  type PautaRelatorioSalvarInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService, type IdentidadeDaDerivacao, type PlanoInternoDeFontesDaDerivacao, type LeitorFisicoDaDerivacao, type DescritorFisicoDaFonte, type CompromissoDaDerivacao } from '../memory/memoria.service';
import { contextoAtual } from '../common/contexto-execucao';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import type { ContextoDaRotina } from '../routines/rotina.tipos';
import { isDeepStrictEqual } from 'node:util';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { SAIDA_DA_GERACAO_LONGA } from './saida-da-geracao';
import { janelaDoMes } from './estrategia.service';
import {
  RelatorioInvalidoError,
  SYSTEM_RELATORIO,
  entradaDoRelatorio,
  lerRelatorioDaIa,
  montarRelatorio,
  type DadosDoRelatorio,
  type PecaDoMes,
} from './relatorio-da-pauta';
import { umaPorVez } from './uma-por-vez';

interface MaterialDaGeracaoDoRelatorio {
  modo: 'gerar'; dados: DadosDoRelatorio; texto: string; provider: string; model: string; configured: boolean;
}
interface MaterialDoPuloDoRelatorio { modo: 'pulada'; destino: DescritorFisicoDaFonte; resumo: string }
type MaterialEscolhidoDoRelatorio = MaterialDaGeracaoDoRelatorio | MaterialDoPuloDoRelatorio;
type SelecaoDoRelatorio = { modo: 'gerar'; pecaIds: string[] } | { modo: 'pulada'; destino: DescritorFisicoDaFonte };
export type ResultadoDoRelatorioPorRotina = { status: 'gerado'; painel: PautaRelatorioPainel } | { status: 'pulada'; resumo: string };

/**
 * Por que ainda não há número de desempenho. Sai daqui e não do modelo, e é
 * escrito no relatório em vez de omitido: seção que some esconde a pergunta.
 * A MK5 substitui isto pelo snapshot da conta.
 */
export const SEM_PERFORMANCE =
  'O OS ainda não mede o desempenho da conta: a fatia de performance não entrou e o Instagram não está conectado.';

/** O mês seguinte a `AAAA-MM`. */
export function mesSeguinte(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}

/*
 * O RELATÓRIO DO MÊS (MK6). Nota da memória por mês
 * (`pauta.relatorio.AAAA-MM`), como a estratégia. Número é do sistema,
 * narrativa é da IA.
 */
@Injectable()
export class RelatorioService {
  private readonly log = new Logger('RelatorioService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly memoria: MemoriaService,
  ) {}

  private async meses(orgId: string): Promise<string[]> {
    try {
      const { itens } = await this.memoria.listar(orgId, { kind: ContextKind.definicao });
      return itens
        .map((n) => mesDaChaveDoRelatorio(n.chave))
        .filter((m): m is string => Boolean(m))
        .sort()
        .reverse();
    } catch (e) {
      this.log.warn(`meses do relatório de ${orgId}: ${(e as Error).message}`);
      return [];
    }
  }

  private async pecasDoMes(orgId: string, mes: string): Promise<PecaDoMes[]> {
    const { de, ate } = janelaDoMes(mes);
    const pecas = await this.prisma.pautaPeca.findMany({
      where: { orgId, status: 'publicada', publicadaEm: { gte: de, lt: ate } },
      select: { titulo: true, canal: true, formato: true, publicadaEm: true, urlPublicada: true },
      orderBy: { publicadaEm: 'asc' },
      take: 200,
    });
    return pecas.map((p) => ({
      titulo: p.titulo,
      canal: String(p.canal),
      formato: p.formato,
      publicadaEm: p.publicadaEm ? p.publicadaEm.toISOString() : null,
      urlPublicada: p.urlPublicada,
    }));
  }

  private async documentoDaEstrategia(orgId: string, mes: string): Promise<string> {
    try {
      const n = await this.memoria.porChave(orgId, chaveDaEstrategia(mes));
      return n && !n.arquivadoEm ? n.body : '';
    } catch {
      return '';
    }
  }


  async painelHumano(orgId: string, actorId: string, mes: string): Promise<PautaRelatorioHumanoPainel> {
    const leitura = { tipo: 'relatorio' as const, mes };
    const r = await this.memoria.lerDestinosHumanos(orgId, actorId, leitura);
    const painel = await this.painel(orgId, mes); const n = r.notas.documento;
    painel.documento = n && !n.arquivadoEm ? n.body : ''; painel.versao = n?.versao ?? null;
    painel.atualizadoEm = n?.atualizadoEm ?? null; painel.origem = n?.sourceType ?? null;
    const final = await this.memoria.reconferirDestinosHumanos(orgId, actorId, leitura, r);
    return PautaRelatorioHumanoPainelSchema.parse({ contrato: 1, escopo: final.escopo, autoridade: final.autoridade,
      observadoEm: final.observadoEm, mes, painel, destinos: r.destinos });
  }
  async salvarHumano(orgId: string, actorId: string, mes: string, entrada: PautaRelatorioSalvarHumanoInput): Promise<PautaEscritaHumanaResultado> {
    if (mes !== entrada.mesEsperado) throw new ConflictException('O mês mudou desde a leitura.');
    const corpo = entrada.documento.replace(/\r\n?/g, '\n').trim();
    const r = await this.memoria.gravarPautaHumana(orgId, actorId, { acao: 'salvar_relatorio', mes }, entrada,
      { kind: ContextKind.definicao, title: `Relatório de ${mes}`, body: corpo, tags: ['pauta', 'relatorio'], sourceType: ContextSource.operador,
        sourceRef: `pauta.relatorio · ${mes}`, motivo: 'relatório do mês editado à mão' });
    await this.audit.log({ orgId, actorId, action: 'pauta.relatorio_salvo', entityType: 'context_item', entityId: r.edicao.itemId,
      after: { mes, versao: r.edicao.versao, caracteres: corpo.length } }); return this.memoria.reconferirResultadoHumanoDoProdutor(orgId, actorId, r);
  }

  async painel(orgId: string, mes: string): Promise<PautaRelatorioPainel> {
    const [nota, meses, pecas, estrategia] = await Promise.all([
      this.memoria.porChave(orgId, chaveDoRelatorio(mes)),
      this.meses(orgId),
      this.pecasDoMes(orgId, mes),
      this.documentoDaEstrategia(orgId, mes),
    ]);
    const avisos = [SEM_PERFORMANCE];
    if (!estrategia) avisos.push(`Não há estratégia escrita para ${mes}: o relatório sai sem a seção do que valia.`);
    if (!pecas.length) avisos.push(`Nenhuma peça publicada em ${mes}.`);
    return {
      mes,
      documento: nota && !nota.arquivadoEm ? nota.body : '',
      versao: nota?.versao ?? null,
      atualizadoEm: nota ? new Date(nota.atualizadoEm).toISOString() : null,
      origem: nota?.sourceType ?? null,
      meses,
      publicadas: pecas.length,
      avisos,
      iaConfigurada: this.llm.configured,
    };
  }

  async salvar(
    orgId: string,
    actorId: string,
    mes: string,
    entrada: PautaRelatorioSalvarInput,
  ): Promise<PautaRelatorioPainel> {
    const documento = entrada.documento.replace(/\r\n?/g, '\n').trim();
    const nota = await this.gravar(orgId, mes, documento, ContextSource.operador, 'relatório do mês editado à mão (MK6)', entrada.versao);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.relatorio_salvo',
      entityType: 'context_item',
      entityId: nota.id,
      after: { mes, versao: nota.versao, caracteres: documento.length },
    });
    return this.painel(orgId, mes);
  }

  /** O bool legado não confere a identidade de uma rotina. */
  gerar(orgId: string, actorId: string, mes: string, porRotina = false): Promise<PautaRelatorioPainel> {
    if (porRotina) throw new ForbiddenException('A geração por rotina exige o contexto real do executor.');
    const identidade = this.identidadeHumana(orgId, actorId);
    return umaPorVez(`pauta-relatorio:${orgId}:${mes}`, 'O relatório deste mês', async () => {
      const r = await this.gerarAgora(orgId, identidade, mes);
      if (r.status !== 'gerado') throw new ConflictException('A geração humana não foi confirmada.');
      return r.painel;
    });
  }

  gerarPorRotina(ctx: ContextoDaRotina, mes: string): Promise<ResultadoDoRelatorioPorRotina> {
    const identidade = this.identidadeDaRotina(structuredClone(ctx));
    return umaPorVez(`pauta-relatorio:${ctx.orgId}:${mes}`, 'O relatório deste mês', () => this.gerarAgora(ctx.orgId, identidade, mes));
  }

  private async gerarAgora(orgId: string, identidade: IdentidadeDaDerivacao, mes: string): Promise<ResultadoDoRelatorioPorRotina> {
    this.conferirIdentidade(orgId, identidade);
    const causa = identidade.tipo === 'rotina' ? { tipo: 'A4-RELATORIO-ROTINA' as const, mes } : { tipo: 'A4-RELATORIO-HUMANO' as const, mes };
    const observada = await this.prisma.$transaction(async (tx) => {
      const r = await this.memoria.observarDestinoDaDerivacaoNoTx(tx, orgId, identidade, causa, this.planoDoRelatorio(orgId, identidade, mes));
      const existente = await tx.contextItem.findFirst({ where: { orgId, chave: chaveDoRelatorio(mes) }, select: { id: true } });
      return { ...r, criarComTags: !existente };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const m = observada.material;
    if (m.modo === 'pulada') {
      if (identidade.tipo !== 'rotina') throw new ConflictException('A causa da geração não pôde ser conferida.');
      const relida = await this.prisma.$transaction((tx) => this.memoria.observarDestinoDaDerivacaoNoTx(tx,
        orgId, identidade, causa, this.planoDoPuloDaRotina(orgId, mes, m.destino)),
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      await this.conferirAntesDoIO(orgId, identidade);
      return { status: 'pulada', resumo: relida.material.resumo };
    }
    if (!m.configured) throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${m.provider}".`);
    await this.conferirAntesDoIO(orgId, identidade);
    this.conferirModeloEscolhido(m);
    const saida = await this.llm.complete({ system: SYSTEM_RELATORIO, user: m.texto, orgId, maxTokens: SAIDA_DA_GERACAO_LONGA });
    let documento: string;
    try { documento = montarRelatorio(m.dados, lerRelatorioDaIa(saida)); }
    catch (err) {
      if (err instanceof RelatorioInvalidoError) { this.log.warn(`relatório de ${mes} em ${orgId}: ${err.message}`); throw new ServiceUnavailableException(err.message); }
      throw err;
    }
    const compromisso = await this.prisma.$transaction((tx) => this.memoria.aplicarDerivacaoCondicionadaNoTx(tx,
      observada.capsula, { kind: ContextKind.definicao, title: `Relatório de ${mes}`, body: documento,
        ...(observada.criarComTags ? { tags: ['pauta', 'relatorio'] } : {}), sourceType: ContextSource.promocao,
        sourceRef: `pauta.relatorio · ${mes}`, motivo: 'relatório do mês gerado pela IA (MK6)' }),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    await this.memoria.concluirEntregaDaDerivacao(compromisso);
    const ator = this.conferirIdentidade(orgId, identidade);
    await this.audit.log({ orgId, actorId: ator.actorId ?? undefined, actorType: ator.actorType,
      action: 'pauta.relatorio_gerado', entityType: 'context_item', entityId: compromisso.aplicada.itemId,
      after: { mes, versao: compromisso.aplicada.versao, versionId: compromisso.aplicada.versionId, contentHash: compromisso.aplicada.contentHash,
        publicadas: m.dados.pecas.length, comEstrategia: Boolean(m.dados.estrategia), provider: m.provider, model: m.model,
        ...(identidade.tipo === 'rotina' ? { rotinaId: identidade.ctx.rotinaId, correlationId: identidade.ctx.correlationId } : {}) } });
    return { status: 'gerado', painel: await this.painelDoRelatorioConfirmado(orgId, mes, m, compromisso) };
  }

  private identidadeHumana(orgId: string, actorId: string): Extract<IdentidadeDaDerivacao, { tipo: 'humano' }> {
    const c = contextoAtual();
    if (!actorId || c?.orgId !== orgId || c.actorType !== 'user' || c.actorId !== actorId || !c.correlationId)
      throw new ForbiddenException('Acesso insuficiente.');
    return { tipo: 'humano', actorId, correlationId: c.correlationId };
  }
  private identidadeDaRotina(ctx: ContextoDaRotina): Extract<IdentidadeDaDerivacao, { tipo: 'rotina' }> {
    const c = contextoAtual();
    if (ctx.origem === 'manual' && c?.actorType === ActorType.user && c.actorId) {
      const i: Extract<IdentidadeDaDerivacao, { tipo: 'rotina' }> = { tipo: 'rotina', ctx, ator: { actorType: 'user', actorId: c.actorId } };
      this.conferirIdentidade(ctx.orgId, i); return i;
    }
    if (ctx.origem === 'cron' && c?.actorType === ActorType.system && !c.actorId) {
      const i: Extract<IdentidadeDaDerivacao, { tipo: 'rotina' }> = { tipo: 'rotina', ctx, ator: { actorType: 'system', actorId: null } };
      this.conferirIdentidade(ctx.orgId, i); return i;
    }
    throw new ForbiddenException('A identidade da rotina não pôde ser conferida.');
  }
  private conferirIdentidade(orgId: string, identidade: IdentidadeDaDerivacao) {
    const c = contextoAtual(); const ator = identidade.tipo === 'humano' ? { actorType: 'user' as const, actorId: identidade.actorId } : identidade.ator;
    const correlationId = identidade.tipo === 'humano' ? identidade.correlationId : identidade.ctx.correlationId;
    if (c?.orgId !== orgId || c.actorType !== ator.actorType || (c.actorId ?? null) !== ator.actorId || !correlationId || c.correlationId !== correlationId)
      throw new ForbiddenException('Acesso insuficiente.');
    if (identidade.tipo === 'rotina' && (identidade.ctx.orgId !== orgId
      || identidade.ctx.origem === 'manual' && ator.actorType !== 'user' || identidade.ctx.origem === 'cron' && ator.actorType !== 'system'))
      throw new ForbiddenException('A identidade da rotina não pôde ser conferida.');
    return ator;
  }
  private async conferirAntesDoIO(orgId: string, identidade: IdentidadeDaDerivacao) {
    const ator = this.conferirIdentidade(orgId, identidade);
    if (ator.actorType === 'user') await exigirAcessoAtual(this.prisma, orgId, ator.actorId,
      identidade.tipo === 'humano' ? ['obsidian.ver', 'pauta.editar', 'automacoes.executar'] : ['obsidian.ver', 'automacoes.executar']);
  }
  private conferirModeloEscolhido(m: Readonly<MaterialDaGeracaoDoRelatorio>) {
    if (!m.configured || this.llm.configured !== m.configured || this.llm.name !== m.provider || this.llm.model !== m.model)
      throw new ConflictException('A configuração da geração mudou. Confira a base antes de gerar novamente.');
  }

  private planoDoRelatorio(orgId: string, identidade: IdentidadeDaDerivacao, mes: string): PlanoInternoDeFontesDaDerivacao<MaterialEscolhidoDoRelatorio, SelecaoDoRelatorio> {
    return {
      observar: async (tx, lerFonte) => {
        if (identidade.tipo === 'rotina') {
          // O core já validou a base física, sua ACL e o namespace no mesmo tx.
          const n = await tx.contextItem.findFirst({ where: { orgId, chave: chaveDoRelatorio(mes) }, select: { body: true } });
          if (n?.body.trim()) {
            const destino = await lerFonte({ chave: chaveDoRelatorio(mes) });
            const selecao: SelecaoDoRelatorio = { modo: 'pulada', destino };
            return { ...await this.relerPuloNoTx(mes, selecao, lerFonte), selecao };
          }
        }
        const { de, ate } = janelaDoMes(mes);
        const rows = await tx.pautaPeca.findMany({ where: { orgId, status: 'publicada', publicadaEm: { gte: de, lt: ate } },
          select: { id: true }, orderBy: { publicadaEm: 'asc' }, take: 200 });
        const selecao: SelecaoDoRelatorio = { modo: 'gerar', pecaIds: rows.map((p) => p.id) };
        return { ...await this.relerRelatorioNoTx(tx, orgId, mes, selecao, lerFonte), selecao };
      },
      reconferir: (tx, lerFonte, selecao) => selecao.modo === 'pulada' ? this.relerPuloNoTx(mes, selecao, lerFonte)
        : this.relerRelatorioNoTx(tx, orgId, mes, selecao, lerFonte),
    };
  }
  private planoDoPuloDaRotina(orgId: string, mes: string, destino: DescritorFisicoDaFonte): PlanoInternoDeFontesDaDerivacao<MaterialDoPuloDoRelatorio, { modo: 'pulada'; destino: DescritorFisicoDaFonte }> {
    if (destino.orgId !== orgId || destino.chave !== chaveDoRelatorio(mes)) throw new ConflictException('O relatório escolhido mudou.');
    const selecao = { modo: 'pulada' as const, destino };
    return { observar: async (_tx, lerFonte) => ({ ...await this.relerPuloNoTx(mes, selecao, lerFonte), selecao }),
      reconferir: (_tx, lerFonte, escolhida) => this.relerPuloNoTx(mes, escolhida, lerFonte) };
  }
  private async relerPuloNoTx(mes: string, selecao: Readonly<{ modo: 'pulada'; destino: DescritorFisicoDaFonte }>, lerFonte: LeitorFisicoDaDerivacao) {
    const destino = await lerFonte({ chave: chaveDoRelatorio(mes) });
    if (destino.estado !== 'existente' || !destino.nota.body.trim() || !isDeepStrictEqual(destino, selecao.destino))
      throw new ConflictException('O relatório escolhido mudou. Confira a base antes de continuar.');
    const material: MaterialDoPuloDoRelatorio = { modo: 'pulada', destino, resumo: `${mes} já tem relatório — refazer é pelo botão, para não apagar edição` };
    return { material, descritores: { destino } };
  }
  private async relerRelatorioNoTx(tx: Prisma.TransactionClient, orgId: string, mes: string, selecao: Readonly<{ modo: 'gerar'; pecaIds: string[] }>, lerFonte: LeitorFisicoDaDerivacao) {
    const ids = [...selecao.pecaIds];
    if (ids.length) await tx.$queryRaw`SELECT id FROM "PautaPeca" WHERE "orgId"=${orgId}
      AND id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR SHARE`;
    const { de, ate } = janelaDoMes(mes);
    const rows = ids.length ? await tx.pautaPeca.findMany({ where: { orgId, id: { in: ids }, status: 'publicada', publicadaEm: { gte: de, lt: ate } } }) : [];
    if (rows.length !== ids.length) throw new ConflictException('As peças escolhidas mudaram durante a geração.');
    const porId = new Map(rows.map((p) => [p.id, p]));
    const pecas = ids.map((id) => { const p = porId.get(id); if (!p) throw new ConflictException('As peças escolhidas mudaram durante a geração.'); return p; });
    const e = await lerFonte({ chave: chaveDaEstrategia(mes) });
    const s = await lerFonte({ chave: chaveDaEstrategia(mesSeguinte(mes)) });
    const dados: DadosDoRelatorio = { mes,
      pecas: pecas.map((p) => ({ titulo: p.titulo, canal: String(p.canal), formato: p.formato,
        publicadaEm: p.publicadaEm?.toISOString() ?? null, urlPublicada: p.urlPublicada })),
      estrategia: e.estado === 'existente' ? e.nota.body : '', estrategiaSeguinte: s.estado === 'existente' ? s.nota.body : '',
      motivoSemPerformance: SEM_PERFORMANCE };
    const material: MaterialDaGeracaoDoRelatorio = { modo: 'gerar', dados, texto: entradaDoRelatorio(dados),
      provider: this.llm.name, model: this.llm.model, configured: this.llm.configured };
    return { material, descritores: { pecas, estrategia: e, estrategiaSeguinte: s } };
  }

  private async painelDoRelatorioConfirmado(orgId: string, mes: string, m: Readonly<MaterialDaGeracaoDoRelatorio>, compromisso: CompromissoDaDerivacao): Promise<PautaRelatorioPainel> {
    await this.memoria.concluirEntregaDaDerivacao(compromisso);
    const a = compromisso.aplicada;
    const v = await this.prisma.contextItemVersion.findFirst({ where: { id: a.versionId, orgId, itemId: a.itemId, versao: a.versao } });
    if (!v || v.body !== a.body || v.contentHash !== a.contentHash || v.sourceType !== a.sourceType || v.sourceRef !== a.sourceRef)
      throw new ConflictException('A versão aplicada do relatório não pôde ser conferida.');
    const meses = await this.meses(orgId); const avisos = [SEM_PERFORMANCE];
    if (!m.dados.estrategia) avisos.push(`Não há estratégia escrita para ${mes}: o relatório sai sem a seção do que valia.`);
    if (!m.dados.pecas.length) avisos.push(`Nenhuma peça publicada em ${mes}.`);
    await this.memoria.concluirEntregaDaDerivacao(compromisso);
    return { mes, documento: a.body, versao: a.versao, atualizadoEm: v.criadoEm.toISOString(), origem: a.sourceType,
      meses, publicadas: m.dados.pecas.length, avisos, iaConfigurada: this.llm.configured };
  }

  private async gravar(
    orgId: string,
    mes: string,
    documento: string,
    sourceType: ContextSource,
    motivo: string,
    versaoEsperada?: number,
  ) {
    const chave = chaveDoRelatorio(mes);
    const dados = {
      kind: ContextKind.definicao,
      title: `Relatório de ${mes}`,
      body: documento,
      sourceType,
      sourceRef: `pauta.relatorio · ${mes}`,
      motivo,
    };
    const existente = await this.memoria.porChave(orgId, chave);
    if (!existente) return this.memoria.criar(orgId, { chave, tags: ['pauta', 'relatorio'], ...dados });
    let nota = await this.memoria.alterar(orgId, existente.id, { ...dados, versaoEsperada });
    if (nota.arquivadoEm) nota = await this.memoria.restaurar(orgId, nota.id, 'o relatório do mês voltou a valer');
    return nota;
  }
}
