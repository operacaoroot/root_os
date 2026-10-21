import { PautaEstrategiaHumanoPainelSchema, type PautaEstrategiaHumanoPainel, type PautaEstrategiaSalvarHumanoInput, type PautaEscritaHumanaResultado } from '@mktos/shared';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, ContextKind, ContextSource } from '@prisma/client';
import {
  chaveDaEstrategia,
  mesDaChaveDaEstrategia,
  type PautaEstrategiaPainel,
  type PautaEstrategiaSalvarInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemoriaService, type IdentidadeDaDerivacao, type PlanoInternoDeFontesDaDerivacao, type LeitorFisicoDaDerivacao, type CompromissoDaDerivacao } from '../memory/memoria.service';
import { contextoAtual } from '../common/contexto-execucao';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { SAIDA_DA_GERACAO_LONGA } from './saida-da-geracao';
import { MarcaService } from './marca.service';
import { ConcorrentesService } from './concorrentes.service';
import {
  EstrategiaInvalidaError,
  SYSTEM_ESTRATEGIA,
  avisosDaEstrategia,
  entradaDaEstrategia,
  lerEstrategiaDaIa,
  montarEstrategia,
} from './estrategia-da-pauta';
import { umaPorVez } from './uma-por-vez';

interface MaterialEscolhidoDaEstrategia {
  insumo: Parameters<typeof entradaDaEstrategia>[0]; origemMarca: 'brandbook' | 'legado';
  texto: string; provider: string; model: string; configured: boolean;
}
interface SelecaoDaEstrategia { perfilIds: string[]; pecaIds: string[]; origemMarca: 'brandbook' | 'legado' }

/** O mês anterior a `AAAA-MM`. */
export function mesAnterior(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/** O intervalo [início, fim) de um mês, em UTC. */
export function janelaDoMes(mes: string): { de: Date; ate: Date } {
  const [a, m] = mes.split('-').map(Number);
  return { de: new Date(Date.UTC(a, m - 1, 1)), ate: new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1)) };
}

/*
 * A ESTRATÉGIA DO MÊS (MK4). Um documento por mês, nota da memória
 * (`pauta.estrategia.AAAA-MM`), escrita só pelo `MemoriaService` — caminho da
 * ADR-011, com versão e RASTRO. A IA propõe; a pessoa edita e é dela a última
 * palavra.
 */
@Injectable()
export class EstrategiaService {
  private readonly log = new Logger('EstrategiaService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly memoria: MemoriaService,
    private readonly marcas: MarcaService,
    private readonly concorrentes: ConcorrentesService,
  ) {}

  /** Os meses que já têm documento, do mais novo para o mais velho. */
  private async meses(orgId: string): Promise<string[]> {
    try {
      const { itens } = await this.memoria.listar(orgId, { kind: ContextKind.definicao });
      return itens
        .map((n) => mesDaChaveDaEstrategia(n.chave))
        .filter((m): m is string => Boolean(m))
        .sort()
        .reverse();
    } catch (e) {
      this.log.warn(`meses da estratégia de ${orgId}: ${(e as Error).message}`);
      return [];
    }
  }


  async painelHumano(orgId: string, actorId: string, mes: string): Promise<PautaEstrategiaHumanoPainel> {
    const leitura = { tipo: 'estrategia' as const, mes };
    const r = await this.memoria.lerDestinosHumanos(orgId, actorId, leitura);
    const painel = await this.painel(orgId, mes); const n = r.notas.documento;
    painel.documento = n && !n.arquivadoEm ? n.body : ''; painel.versao = n?.versao ?? null;
    painel.atualizadoEm = n?.atualizadoEm ?? null; painel.origem = n?.sourceType ?? null;
    const final = await this.memoria.reconferirDestinosHumanos(orgId, actorId, leitura, r);
    return PautaEstrategiaHumanoPainelSchema.parse({ contrato: 1, escopo: final.escopo, autoridade: final.autoridade,
      observadoEm: final.observadoEm, mes, painel, destinos: r.destinos });
  }
  async salvarHumano(orgId: string, actorId: string, mes: string, entrada: PautaEstrategiaSalvarHumanoInput): Promise<PautaEscritaHumanaResultado> {
    if (mes !== entrada.mesEsperado) throw new ConflictException('O mês mudou desde a leitura.');
    const corpo = entrada.documento.replace(/\r\n?/g, '\n').trim();
    const r = await this.memoria.gravarPautaHumana(orgId, actorId, { acao: 'salvar_estrategia', mes }, entrada,
      { kind: ContextKind.definicao, title: `Estratégia de ${mes}`, body: corpo, tags: ['pauta', 'estrategia'], sourceType: ContextSource.operador,
        sourceRef: `pauta.estrategia · ${mes}`, motivo: 'estratégia do mês editada à mão' });
    await this.audit.log({ orgId, actorId, action: 'pauta.estrategia_salva', entityType: 'context_item', entityId: r.edicao.itemId,
      after: { mes, versao: r.edicao.versao, caracteres: corpo.length } }); return this.memoria.reconferirResultadoHumanoDoProdutor(orgId, actorId, r);
  }

  async painel(orgId: string, mes: string): Promise<PautaEstrategiaPainel> {
    const [nota, meses, pilares] = await Promise.all([
      this.memoria.porChave(orgId, chaveDaEstrategia(mes)),
      this.meses(orgId),
      this.marcas.pilares(orgId),
    ]);
    const documento = nota && !nota.arquivadoEm ? nota.body : '';
    const avisos = documento ? avisosDaEstrategia(documento) : [];
    if (!pilares.length) {
      avisos.push('Sem pilar cadastrado, a IA não tem o que priorizar: escreva os pilares na tela de Marca.');
    }
    return {
      mes,
      documento,
      versao: nota?.versao ?? null,
      atualizadoEm: nota ? new Date(nota.atualizadoEm).toISOString() : null,
      origem: nota?.sourceType ?? null,
      meses,
      avisos,
      iaConfigurada: this.llm.configured,
    };
  }

  /** A edição à mão. `versao` velha é outra aba mexendo junto (409). */
  async salvar(
    orgId: string,
    actorId: string,
    mes: string,
    entrada: PautaEstrategiaSalvarInput,
  ): Promise<PautaEstrategiaPainel> {
    const documento = entrada.documento.replace(/\r\n?/g, '\n').trim();
    const nota = await this.gravar(orgId, mes, documento, ContextSource.operador, 'estratégia do mês editada à mão (MK4)', entrada.versao);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.estrategia_salva',
      entityType: 'context_item',
      entityId: nota.id,
      after: { mes, versao: nota.versao, caracteres: documento.length },
    });
    return this.painel(orgId, mes);
  }

  gerar(orgId: string, actorId: string, mes: string): Promise<PautaEstrategiaPainel> {
    return umaPorVez(`pauta-estrategia:${orgId}:${mes}`, 'A estratégia deste mês', () =>
      this.gerarAgora(orgId, actorId, mes),
    );
  }

  private async gerarAgora(orgId: string, actorId: string, mes: string): Promise<PautaEstrategiaPainel> {
    const identidade = this.identidadeHumana(orgId, actorId);
    if (!this.llm.configured) throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    const observada = await this.prisma.$transaction(async (tx) => {
      const r = await this.memoria.observarDestinoDaDerivacaoNoTx(tx, orgId, identidade,
        { tipo: 'A4-ESTRATEGIA', mes }, this.planoDaEstrategia(orgId, identidade, mes));
      const existente = await tx.contextItem.findFirst({ where: { orgId, chave: chaveDaEstrategia(mes) }, select: { id: true } });
      return { ...r, criarComTags: !existente };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const m = observada.material;
    this.identidadeHumana(orgId, actorId);
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['obsidian.ver', 'pauta.editar', 'automacoes.executar', 'pauta.ver']);
    this.conferirModeloEscolhido(m);
    const saida = await this.llm.complete({ funcao: 'CT-11', system: SYSTEM_ESTRATEGIA, user: m.texto, orgId, maxTokens: SAIDA_DA_GERACAO_LONGA });
    let documento: string;
    try { documento = montarEstrategia(mes, lerEstrategiaDaIa(saida, m.insumo.pilares)); }
    catch (err) {
      if (err instanceof EstrategiaInvalidaError) { this.log.warn(`estratégia de ${mes} em ${orgId}: ${err.message}`); throw new ServiceUnavailableException(err.message); }
      throw err;
    }
    const compromisso = await this.prisma.$transaction((tx) => this.memoria.aplicarDerivacaoCondicionadaNoTx(tx,
      observada.capsula, { kind: ContextKind.definicao, title: `Estratégia de ${mes}`, body: documento,
        ...(observada.criarComTags ? { tags: ['pauta', 'estrategia'] } : {}), sourceType: ContextSource.promocao,
        sourceRef: `pauta.estrategia · ${mes}`, motivo: 'estratégia do mês proposta pela IA (MK4)' }),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    await this.memoria.concluirEntregaDaDerivacao(compromisso);
    await this.audit.log({ orgId, actorId, action: 'pauta.estrategia_gerada', entityType: 'context_item', entityId: compromisso.aplicada.itemId,
      after: { mes, versao: compromisso.aplicada.versao, versionId: compromisso.aplicada.versionId, contentHash: compromisso.aplicada.contentHash,
        pilares: m.insumo.pilares.length, dossies: m.insumo.dossies.length, publicadoNoMesAnterior: m.insumo.publicado.length,
        provider: m.provider, model: m.model } });
    return this.painelDaEstrategiaConfirmada(orgId, mes, m, compromisso);
  }

  private identidadeHumana(orgId: string, actorId: string): Extract<IdentidadeDaDerivacao, { tipo: 'humano' }> {
    const c = contextoAtual();
    if (!actorId || c?.orgId !== orgId || c.actorType !== 'user' || c.actorId !== actorId || !c.correlationId)
      throw new ForbiddenException('Acesso insuficiente.');
    return { tipo: 'humano', actorId, correlationId: c.correlationId };
  }
  private conferirModeloEscolhido(m: Readonly<MaterialEscolhidoDaEstrategia>) {
    if (!m.configured || this.llm.configured !== m.configured || this.llm.name !== m.provider || this.llm.model !== m.model)
      throw new ConflictException('A configuração da geração mudou. Confira a base antes de gerar novamente.');
  }

  private planoDaEstrategia(orgId: string, identidade: IdentidadeDaDerivacao, mes: string): PlanoInternoDeFontesDaDerivacao<MaterialEscolhidoDaEstrategia, SelecaoDaEstrategia> {
    return {
      observar: async (tx, lerFonte) => {
        const { de, ate } = janelaDoMes(mesAnterior(mes));
        const perfis = await tx.pautaFonte.findMany({ where: { orgId, tipo: 'perfil' }, select: { id: true }, orderBy: { nome: 'asc' } });
        const pecas = await tx.pautaPeca.findMany({ where: { orgId, status: 'publicada', publicadaEm: { gte: de, lt: ate } },
          select: { id: true }, orderBy: { publicadaEm: 'asc' }, take: 60 });
        const ids = { perfilIds: perfis.map((p) => p.id), pecaIds: pecas.map((p) => p.id) };
        const r = await this.relerEstrategiaNoTx(tx, orgId, identidade, mes, ids, lerFonte);
        return { ...r, selecao: { ...ids, origemMarca: r.material.origemMarca } };
      },
      reconferir: (tx, lerFonte, selecao) => this.relerEstrategiaNoTx(tx, orgId, identidade, mes, selecao, lerFonte, selecao.origemMarca),
    };
  }

  private async relerEstrategiaNoTx(tx: Prisma.TransactionClient, orgId: string, identidade: IdentidadeDaDerivacao, mes: string,
    selecao: Readonly<Pick<SelecaoDaEstrategia, 'perfilIds' | 'pecaIds'>>, lerFonte: LeitorFisicoDaDerivacao,
    origemEsperada?: 'brandbook' | 'legado') {
    const marca = await this.marcas.paraGeracaoNoTx(tx, orgId, identidade, lerFonte);
    if (origemEsperada && marca.origem !== origemEsperada) throw new ConflictException('A origem da marca mudou durante a geração.');
    if (!marca.pilares.length) throw new BadRequestException('Sem pilar cadastrado não há o que priorizar: escreva os pilares na tela de Marca antes.');
    const ids = [...selecao.perfilIds];
    if (ids.length) await tx.$queryRaw`SELECT id FROM "PautaFonte" WHERE "orgId"=${orgId} AND tipo='perfil'
      AND id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR SHARE`;
    const fontes = ids.length ? await tx.pautaFonte.findMany({ where: { orgId, tipo: 'perfil', id: { in: ids } } }) : [];
    if (fontes.length !== ids.length) throw new ConflictException('Os perfis escolhidos mudaram durante a geração.');
    const porFonte = new Map(fontes.map((p) => [p.id, p]));
    const perfis = ids.map((id) => { const p = porFonte.get(id); if (!p) throw new ConflictException('Os perfis escolhidos mudaram durante a geração.'); return p; });
    const dossies: MaterialEscolhidoDaEstrategia['insumo']['dossies'] = [];
    for (const perfil of perfis) {
      const n = await lerFonte({ chave: `pauta.concorrente.${perfil.id}` });
      if (n.estado === 'ausente_fisico' || !n.nota.body.trim()) continue;
      dossies.push({ handle: perfil.handle ?? '', ...this.lerInsumoDoDossie(n.nota.body) });
    }
    const pids = [...selecao.pecaIds];
    if (pids.length) await tx.$queryRaw`SELECT id FROM "PautaPeca" WHERE "orgId"=${orgId}
      AND id IN (${Prisma.join([...pids].sort())}) ORDER BY id FOR SHARE`;
    const { de, ate } = janelaDoMes(mesAnterior(mes));
    const rows = pids.length ? await tx.pautaPeca.findMany({ where: { orgId, id: { in: pids }, status: 'publicada', publicadaEm: { gte: de, lt: ate } } }) : [];
    if (rows.length !== pids.length) throw new ConflictException('As peças escolhidas mudaram durante a geração.');
    const porPeca = new Map(rows.map((p) => [p.id, p]));
    const pecas = pids.map((id) => { const p = porPeca.get(id); if (!p) throw new ConflictException('As peças escolhidas mudaram durante a geração.'); return p; });
    const insumo = { mes, marca: marca.bloco, pilares: marca.pilares, dossies,
      publicado: pecas.map((p) => ({ titulo: p.titulo, formato: p.formato, em: p.publicadaEm?.toISOString() ?? null })) };
    return { material: { insumo, origemMarca: marca.origem, texto: entradaDaEstrategia(insumo),
      provider: this.llm.name, model: this.llm.model, configured: this.llm.configured },
      descritores: { marca: marca.descritores, perfis, pecas } };
  }

  private lerInsumoDoDossie(body: string): { oQueRende: string; oQueAproveitar: string[] } {
    let d: unknown;
    try { d = JSON.parse(body); } catch { throw new ConflictException('O dossiê escolhido está inválido.'); }
    if (!d || typeof d !== 'object' || Array.isArray(d) || !('oQueRende' in d) || typeof d.oQueRende !== 'string'
      || !('oQueAproveitar' in d) || !Array.isArray(d.oQueAproveitar)) throw new ConflictException('O dossiê escolhido está inválido.');
    const valores: unknown[] = d.oQueAproveitar;
    const oQueAproveitar = valores.map((v) => { if (typeof v !== 'string') throw new ConflictException('O dossiê escolhido está inválido.'); return v; });
    return { oQueRende: d.oQueRende, oQueAproveitar };
  }

  private async painelDaEstrategiaConfirmada(orgId: string, mes: string, m: Readonly<MaterialEscolhidoDaEstrategia>, compromisso: CompromissoDaDerivacao): Promise<PautaEstrategiaPainel> {
    await this.memoria.concluirEntregaDaDerivacao(compromisso);
    const a = compromisso.aplicada;
    const v = await this.prisma.contextItemVersion.findFirst({ where: { id: a.versionId, orgId, itemId: a.itemId, versao: a.versao } });
    if (!v || v.body !== a.body || v.contentHash !== a.contentHash || v.sourceType !== a.sourceType || v.sourceRef !== a.sourceRef)
      throw new ConflictException('A versão aplicada da estratégia não pôde ser conferida.');
    const meses = await this.meses(orgId); const avisos = avisosDaEstrategia(a.body);
    if (!m.insumo.pilares.length) avisos.push('Sem pilar cadastrado, a IA não tem o que priorizar: escreva os pilares na tela de Marca.');
    await this.memoria.concluirEntregaDaDerivacao(compromisso);
    return { mes, documento: a.body, versao: a.versao, atualizadoEm: v.criadoEm.toISOString(), origem: a.sourceType,
      meses, avisos, iaConfigurada: this.llm.configured };
  }

  /** O que rende em cada perfil observado que já tem dossiê. */
  private async dossies(orgId: string) {
    const perfis = await this.concorrentes.listar(orgId);
    const lidos = await Promise.all(
      perfis.map(async (p) => {
        const d = await this.concorrentes.dossie(orgId, p.id);
        return d ? { handle: p.handle, oQueRende: d.oQueRende, oQueAproveitar: d.oQueAproveitar } : null;
      }),
    );
    return lidos.filter((d): d is NonNullable<typeof d> => Boolean(d));
  }

  private async publicadoNoMes(orgId: string, mes: string) {
    const { de, ate } = janelaDoMes(mes);
    const pecas = await this.prisma.pautaPeca.findMany({
      where: { orgId, status: 'publicada', publicadaEm: { gte: de, lt: ate } },
      select: { titulo: true, formato: true, publicadaEm: true },
      orderBy: { publicadaEm: 'asc' },
      take: 60,
    });
    return pecas.map((p) => ({
      titulo: p.titulo,
      formato: p.formato,
      em: p.publicadaEm ? p.publicadaEm.toISOString() : null,
    }));
  }

  private async gravar(
    orgId: string,
    mes: string,
    documento: string,
    sourceType: ContextSource,
    motivo: string,
    versaoEsperada?: number,
  ) {
    const chave = chaveDaEstrategia(mes);
    const dados = {
      kind: ContextKind.definicao,
      title: `Estratégia de ${mes}`,
      body: documento,
      sourceType,
      sourceRef: `pauta.estrategia · ${mes}`,
      motivo,
    };
    const existente = await this.memoria.porChave(orgId, chave);
    if (!existente) return this.memoria.criar(orgId, { chave, tags: ['pauta', 'estrategia'], ...dados });
    let nota = await this.memoria.alterar(orgId, existente.id, { ...dados, versaoEsperada });
    if (nota.arquivadoEm) nota = await this.memoria.restaurar(orgId, nota.id, 'a estratégia do mês voltou a valer');
    return nota;
  }
}
