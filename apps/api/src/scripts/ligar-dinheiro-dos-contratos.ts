/*
 * ============================================================================
 * O DINHEIRO DOS CONTRATOS QUE JÁ FECHARAM (etapa 4, 03/11/2026)
 * ============================================================================
 *
 *   node dist/scripts/ligar-dinheiro-dos-contratos.js --org <apelido|id> [--ensaio] [--detalhe <arquivo fora do git>]
 *   node dist/scripts/ligar-dinheiro-dos-contratos.js --org <apelido|id> --aplicar
 *   node dist/scripts/ligar-dinheiro-dos-contratos.js --org <apelido|id> --desfazer
 *   (o ensaio e o aplicar aceitam --assumir-importados --pessoa <userId>, ver abaixo)
 *
 * Padrão `--ensaio`: só lê. Para cada cliente ativo (fato `cliente.ativo`) diz o
 * que o fechamento de hoje faria com o dinheiro dele (`dinheiro-do-contrato.ts`):
 * o registro do contrato e o estado, o contrato do Financeiro a ligar, o acordo a
 * adotar (ou "criar"), as parcelas a criar, adotar ou ligar à cobrança, e os
 * motivos de AMBÍGUO. O console mostra ids curtos e contagens; `--detalhe` grava a
 * mesma tabela COM O NOME de cada cliente, num arquivo fora de repositório git.
 *
 * `--aplicar` faz tudo o que não é ambíguo numa transação só, sob o cadeado do
 * contrato de cada lead, e anota cada mudança no diário `_diario_dinheiro_20261103`
 * (tabela, linha, coluna, antes, depois). No fim imprime o SQL que desfaz; o
 * `--desfazer` roda esse mesmo desfazer a partir do diário. Ambíguo fica de fora
 * (o dono decide à mão) e cliente importado do CRM antigo também (não há registro).
 *
 * `--assumir-importados --pessoa <userId>` (opt-in): o cliente importado sem registro ganha o registro
 * pelo caminho do módulo de contratos (`importado-assumido.ts`, o mesmo de `ContratosService.assumirImportado`):
 * a linha, o fato `contrato.registrado` (ato `importado_assumido`) e a auditoria, em nome da pessoa
 * (gente de verdade relida no banco; conta de serviço ou IA é recusada, como na tela). No ensaio,
 * mostra o registro que nasceria (estado, valor, vigência, origem) e o plano do dinheiro sobre ele,
 * simulado em memória. No `--aplicar`, só assume quem vai ser ligado sem ambiguidade; a linha e o fato
 * nascidos aqui vão ao diário, e o `--desfazer` apaga só esses (a auditoria fica: é o rastro).
 * As parcelas do importado vêm das cobranças ou, sem elas, da versão mais nova das parcelas lançadas
 * à mão (`contrato.parcelas_lancadas`). Sem nenhuma das duas (decisão do dono, 03/11), o dinheiro já
 * mora no Financeiro e o backfill SÓ LIGA, sem criar parcela: o acordo que já existe (os mesmos degraus,
 * sem o "criar"; mais de um é ambíguo) e o contrato do Financeiro do cliente, se for o único ativo e o
 * acordo tiver parcelas (o contrato ligado sai do fluxo; sem parcelas, o dinheiro sumiria). Nenhuma reação escuta `contrato.registrado` (catraca na suíte):
 * o script não perde nada por não rodar `fio.reagir`.
 *
 * NUNCA reescreve o que uma pessoa digitou: só as colunas de ligação
 * (`comercialContratoId` do acordo e do contrato do Financeiro, o `partnerId` do
 * registro do contrato e o vazio do acordo, o `asaasPaymentId` vazio da parcela) e
 * as linhas novas (acordo e parcelas). Contrato do Financeiro que já gerou previsto
 * é ambíguo: ligá-lo esconderia o que ele gerou ou contaria duas vezes.
 *
 * A sequência na produção: `--ensaio --detalhe /tmp/dinheiro-ensaio.md` → o dono
 * confere → `--aplicar` → `--ensaio` de novo, que tem de dar "nada a fazer" fora os
 * ambíguos. Roda COMPILADO, com a conexão dona (`DATABASE_URL`), como `vincular-conversas.ts`.
 *
 * Códigos de saída: 0 ok; 1 falhou.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ActorType, PrismaClient } from '@prisma/client';
import { TABELA_DE_PRECO } from '@mktos/shared';

import { comContexto } from '../common/contexto-execucao';
import { estadoDoImportado } from '../comercial/contrato-importado';
import { contratosImportados } from '../comercial/contrato-vivo.service';
import {
  exigirGenteNoContrato, gravarImportadoAssumido, lerImportadoParaAssumir, registroDoImportado,
  type PessoaNoContrato, type RegistroDoImportado,
} from '../comercial/contratos/importado-assumido';
import {
  aplicarDinheiro, cadeadoDoContrato, doMesmoCliente, planejarDinheiro, resumoDoPlano,
  type AnotacaoDoDinheiro, type EntradaDoDinheiro, type ParcelaDoDinheiro, type PlanoDoDinheiro,
} from '../comercial/dinheiro-do-contrato';
import { hojeEmSP, venceComoData } from '../comercial/dinheiro.service';
import { aceiteDaDeclaracao, parcelasDoContratoFora } from '../comercial/fechado-fora';
import { FioService, ReacoesRegistry } from '../comercial/fio.service';
import { dentroDeGit } from '../comercial/importador-crm/detalhe';
import { materializarParcelas } from '../finance/parcelas.service';
import type { PrismaService } from '../prisma/prisma.service';
import { comTenantNaSessao } from '../prisma/sessao-de-banco';

export const DIARIO = '_diario_dinheiro_20261103';

type Banco = PrismaClient;
type P = Record<string, unknown>;

export interface LinhaDoDinheiro {
  leadId: string;
  cliente: string;
  partnerId: string | null;
  /** O contrato do Financeiro que o fechamento escreveu (o da ficha ou do `cliente.ativo`). */
  contractId: string | null;
  contractJaLigado: boolean;
  entrada: EntradaDoDinheiro | null;
  plano: PlanoDoDinheiro | null;
  /** Fora do backfill (importado, sem cliente, sem parcelas): o motivo. */
  fora: string | null;
  /** Ambíguo além do plano (o contrato do Financeiro). Junto com `plano.ambiguo`. */
  ambiguo: string[];
  /** Só ligar: a parte que fica de fora sem barrar o resto (o contrato do Financeiro solto ou ambíguo). */
  avisos: string[];
  /** `--assumir-importados`: o registro que `assumirImportado` criaria (ainda não existe). */
  assumir: RegistroDoImportado | null;
}

const curto = (id: string | null | undefined) => (id ? id.slice(0, 8) : '-');

type BancoDoPlano = Parameters<typeof planejarDinheiro>[0];

/**
 * O banco do planejador com o registro que `assumirImportado` criaria, só em memória: a busca pelo
 * registro do lead devolve também ele, se casar com o filtro. O resto é o banco de verdade, só lido.
 */
export function comRegistroSimulado(db: BancoDoPlano, r: RegistroDoImportado): BancoDoPlano {
  const linha = { id: r.id, estado: r.data.estado, partnerId: r.data.partnerId };
  const casa = (w: P = {}) => {
    const estado = w.estado as string | { in?: string[] } | undefined;
    return (w.id === undefined || w.id === r.id) && (w.leadId === undefined || w.leadId === r.data.leadId) && (w.tipo === undefined || w.tipo === 'contrato')
      && (estado === undefined || (typeof estado === 'string' ? estado === r.data.estado : !!estado.in?.includes(r.data.estado)));
  };
  const comercialContrato = {
    findMany: async (a: { where?: P }) => {
      const reais = (await db.comercialContrato.findMany(a as never)) as Array<{ id: string }>;
      return reais.some((x) => x.id === r.id) || !casa(a.where) ? reais : [...reais, linha];
    },
  };
  return { comercialContrato, acordoComercial: db.acordoComercial, acordoParcela: db.acordoParcela, partner: db.partner } as unknown as BancoDoPlano;
}

export interface OpcoesDoPlano {
  /** `--assumir-importados`: o importado sem registro entra com o registro que nasceria. */
  assumirImportados?: boolean;
}

/** Só lê: o plano de cada cliente ativo da empresa. */
export async function planejarBackfill(db: Banco, orgId: string, hoje: string = hojeEmSP(), opcoes: OpcoesDoPlano = {}): Promise<LinhaDoDinheiro[]> {
  const ativos = await db.leadEvent.findMany({ where: { type: 'cliente.ativo', lead: { orgId } }, orderBy: { occurredAt: 'asc' }, select: { leadId: true, payload: true, occurredAt: true } });
  const primeiro = new Map<string, (typeof ativos)[number]>();
  for (const a of ativos) if (!primeiro.has(a.leadId)) primeiro.set(a.leadId, a);
  const linhas: LinhaDoDinheiro[] = [];
  for (const [leadId, ativo] of primeiro) {
    const p = (ativo.payload ?? {}) as P;
    const ficha = await db.comercialFicha.findFirst({ where: { leadId, orgId }, select: { partnerId: true, contractId: true, produto: true, empresa: true, valorCentavos: true, valorNegociadoCentavos: true } });
    const partnerId = (typeof p.partnerId === 'string' && p.partnerId) || ficha?.partnerId || null;
    const contractId = (typeof p.contractId === 'string' && p.contractId) || ficha?.contractId || null;
    const parceiro = partnerId ? await db.partner.findFirst({ where: { id: partnerId, orgId }, select: { razaoSocial: true } }) : null;
    const linha: LinhaDoDinheiro = { leadId, cliente: parceiro?.razaoSocial ?? ficha?.empresa ?? '', partnerId, contractId, contractJaLigado: false, entrada: null, plano: null, fora: null, ambiguo: [], avisos: [], assumir: null };
    linhas.push(linha);
    // Importado do CRM antigo: com registro (alguém já agiu nele na tela) segue o caminho de todos;
    // sem registro, só com `--assumir-importados`, e o plano corre sobre o registro que nasceria.
    let doImportado: RegistroDoImportado | null = null;
    let produtoDoImportado = '';
    let valorDoRegistro: number | null = null;
    if (p.importado === true) {
      const assumido = await db.comercialContrato.findFirst({ where: { orgId, leadId, origemImportada: { not: null } }, select: { id: true, valorCentavos: true } });
      if (!assumido && !opcoes.assumirImportados) { linha.fora = 'importado do CRM antigo (sem registro do contrato; --assumir-importados o cria)'; continue; }
      const baseDoImportado = await lerImportadoParaAssumir(db, orgId, leadId);
      if (!baseDoImportado) { linha.fora = 'importado do CRM antigo sem o fato contrato.importado (nada de onde nascer o registro)'; continue; }
      doImportado = registroDoImportado(orgId, leadId, baseDoImportado);
      produtoDoImportado = contratosImportados(baseDoImportado.fatos)[0]?.produtoRotulo ?? '';
      if (!assumido) {
        if (doImportado.data.estado !== 'ativo') { linha.fora = `importado do CRM antigo já ${doImportado.data.estado} (o registro nasceria sem dinheiro a ligar)`; continue; }
        linha.assumir = doImportado;
      }
      valorDoRegistro = assumido ? assumido.valorCentavos : doImportado.data.valorCentavos;
    }
    if (!partnerId || !parceiro) { linha.fora = 'sem cliente no fechamento'; continue; }

    const cobrancas = await db.comercialCobranca.findMany({ where: { leadId, orgId }, orderBy: { parcela: 'asc' } });
    let parcelas: ParcelaDoDinheiro[] = cobrancas.map((c) => ({ numero: c.parcela, valorCentavos: c.valorCentavos, vence: c.vence, pagaEm: c.pagaEm, asaasPaymentId: c.externoId }));
    let valorCentavos = cobrancas.reduce((s, c) => s + c.valorCentavos, 0);
    let produto = ficha?.produto ?? '';
    if (!parcelas.length) {
      // Quem fechou fora sem cobrança: as parcelas do valor declarado, a mesma conta do fechamento.
      const d = await db.leadEvent.findFirst({ where: { leadId, type: 'aceite.declarado', lead: { orgId } }, orderBy: { occurredAt: 'desc' }, select: { payload: true, occurredAt: true } });
      const a = d ? aceiteDaDeclaracao(d.payload, d.occurredAt) : null;
      if (a?.fora && !a.fora.criarCobranca) {
        const f = parcelasDoContratoFora(a.valorCentavos, a.parcelas, a.fora.primeiroVencimento, hoje);
        parcelas = f.vencimentos.map((v, i) => ({ numero: i + 1, valorCentavos: i === f.vencimentos.length - 1 ? f.ultimaParcelaCentavos : f.parcelaCentavos, vence: venceComoData(v), pagaEm: null, asaasPaymentId: null }));
        valorCentavos = a.valorCentavos;
        produto = a.produto;
      }
    }
    if (!parcelas.length && doImportado) {
      // O importado sem cobrança: a versão mais nova das parcelas lançadas à mão (a mesma leitura da tela).
      const fatos = await db.leadEvent.findMany({ where: { orgId, leadId, type: 'contrato.parcelas_lancadas' }, select: { type: true, payload: true, occurredAt: true } });
      const lancadas = doImportado.origens.map((o) => estadoDoImportado(o, fatos, hoje).parcelasManuais).filter((m) => !!m?.linhas.length);
      if (lancadas.length > 1) {
        linha.ambiguo.push(`${lancadas.length} contratos importados com parcelas lançadas: o registro é um só e os números das parcelas se repetiriam`);
        continue;
      }
      if (lancadas.length === 1) {
        parcelas = lancadas[0]!.linhas.map((l) => ({ numero: l.n, valorCentavos: l.valorCentavos, vence: venceComoData(l.vence), pagaEm: l.pagaEm ? venceComoData(l.pagaEm) : null, asaasPaymentId: null }));
        valorCentavos = lancadas[0]!.somaCentavos;
      }
    }
    if (doImportado && !produto) produto = produtoDoImportado;
    if (!parcelas.length && !doImportado) { linha.fora = 'sem cobrança nem parcelas declaradas'; continue; }
    // O importado sem cobrança nem parcelas lançadas: o dinheiro já mora no Financeiro, só liga (nada nasce).
    const soLigar = !parcelas.length;
    linha.entrada = {
      orgId, leadId, partnerId, cliente: parceiro.razaoSocial, produto: TABELA_DE_PRECO[produto as keyof typeof TABELA_DE_PRECO]?.rotulo ?? produto,
      valorCentavos: valorDoRegistro ?? ficha?.valorNegociadoCentavos ?? ficha?.valorCentavos ?? valorCentavos, fechadoEm: ativo.occurredAt, parcelas,
      ...(soLigar ? { soLigar: true } : {}),
    };
    linha.plano = await planejarDinheiro(linha.assumir ? comRegistroSimulado(db, linha.assumir) : db, linha.entrada);
    if (soLigar) {
      const pl = linha.plano;
      if (!pl.acordo && !pl.ambiguo.length && !pl.semRegistro) linha.fora = 'importado sem cobrança, sem parcelas lançadas e sem acordo pagante do cliente no Financeiro (nada a ligar)';
      else if (pl.acordo && !pl.ambiguo.length) await contratoDoFinanceiroDoCliente(db, orgId, linha);
      continue;
    }

    if (contractId) {
      const c = await db.contract.findFirst({ where: { id: contractId, orgId }, select: { id: true, comercialContratoId: true } });
      if (!c) {
        linha.contractId = null;
      } else {
        linha.contractJaLigado = !!c.comercialContratoId;
        if (c.comercialContratoId && c.comercialContratoId !== linha.plano.contrato?.id) linha.ambiguo.push('o contrato do Financeiro já aponta outro registro');
        const previstos = await db.financeTransaction.count({ where: { orgId, contractId, status: 'previsto' } });
        if (previstos) linha.ambiguo.push(`o contrato do Financeiro já gerou ${previstos} lançamento(s) previsto(s)`);
      }
    }
  }
  return linhas;
}

/**
 * Só ligar: o contrato do Financeiro (a receber, ativo) do cliente, do principal ou de um repetido vai ao
 * registro se for o único e o acordo tiver parcelas: o contrato ligado sai do fluxo, da Análise e dos
 * previstos, e o dinheiro passa a vir das parcelas do acordo. Fora disso fica solto, com o motivo nos avisos.
 */
async function contratoDoFinanceiroDoCliente(db: Banco, orgId: string, l: LinhaDoDinheiro): Promise<void> {
  const pl = l.plano!;
  const { ids } = await doMesmoCliente(db, orgId, l.partnerId!);
  const ativos = await db.contract.findMany({ where: { orgId, tipo: 'entrada', status: 'ativo', partnerId: { in: ids } }, select: { id: true, comercialContratoId: true } });
  const doRegistro = ativos.find((c) => c.comercialContratoId === pl.contrato!.id);
  if (doRegistro) {
    l.contractId = doRegistro.id;
    l.contractJaLigado = true;
    return;
  }
  if (!ativos.length) return;
  if (ativos.length > 1) {
    l.avisos.push(`AMBÍGUO no contrato do Financeiro: o cliente tem ${ativos.length} ativos (${ativos.map((c) => curto(c.id)).join(', ')}), nenhum é ligado`);
    return;
  }
  const c = ativos[0]!;
  if (c.comercialContratoId) return void l.avisos.push(`contrato do Financeiro ${curto(c.id)} fica solto: já aponta outro registro`);
  if (!pl.existentes) return void l.avisos.push(`contrato do Financeiro ${curto(c.id)} fica solto: o acordo não tem parcelas`);
  const previstos = await db.financeTransaction.count({ where: { orgId, contractId: c.id, status: 'previsto' } });
  if (previstos) return void l.avisos.push(`contrato do Financeiro ${curto(c.id)} fica solto: já gerou ${previstos} lançamento(s) previsto(s)`);
  l.contractId = c.id;
}

/** Entra no `--aplicar`: tem plano com contrato e acordo, e nada ambíguo. */
export function aplicavel(l: LinhaDoDinheiro): boolean {
  return !l.fora && !!l.plano?.contrato && !!l.plano.acordo && !l.plano.ambiguo.length && !l.ambiguo.length;
}

/** Há o que escrever (a segunda passagem do ensaio depois do `--aplicar` dá zero). */
export function temTrabalho(l: LinhaDoDinheiro): boolean {
  if (!aplicavel(l)) return false;
  const pl = l.plano!;
  return pl.acordo!.acao !== 'ligado' || pl.criar.length > 0 || pl.vestir.length > 0 || pl.contrato!.partnerId !== l.partnerId || (!!l.contractId && !l.contractJaLigado);
}

function situacao(l: LinhaDoDinheiro): string {
  if (l.fora) return `fora: ${l.fora}`;
  const motivos = [...(l.plano?.ambiguo ?? []), ...l.ambiguo];
  if (motivos.length) return `AMBÍGUO: ${motivos.join('; ')}`;
  if (l.plano?.semRegistro) return `sem registro: ${l.plano.semRegistro}`;
  return `${temTrabalho(l) ? 'aplicar' : 'nada a fazer'}${l.avisos.length ? ` (${l.avisos.join('; ')})` : ''}`;
}

const reais = (c: number | null) => (c === null ? 'sem valor' : `R$ ${(c / 100).toFixed(2).replace('.', ',')}`);

/** O registro que `assumirImportado` criaria: estado, valor, vigência e origem. */
export function fraseDoAssumir(r: RegistroDoImportado): string {
  const mais = r.origens.length > 1 ? ` (+${r.origens.length - 1} origem(ns) somada(s))` : '';
  return `assumir o importado: registro ${curto(r.id)} ${r.data.estado}, ${reais(r.data.valorCentavos)}, sem vigência (o importado não traz), origem ${r.data.origemImportada}${mais}`;
}

const celula = (s: string) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/** A tabela do ensaio. Sem `comNome`, só ids curtos (é o que vai ao console). */
export function tabelaDoEnsaio(linhas: readonly LinhaDoDinheiro[], comNome = false): string {
  const cab = ['lead', ...(comNome ? ['cliente'] : []), 'registro (estado)', 'contrato do Financeiro', 'acordo', 'parcelas', 'situação'];
  const rows = linhas.map((l) => {
    const pl = l.plano;
    const registro = pl?.contrato ? `${l.assumir ? 'assumir ' : ''}${curto(pl.contrato.id)} (${pl.contrato.estado})` : l.assumir ? `assumir ${curto(l.assumir.id)} (${l.assumir.data.estado})` : '-';
    const financeiro = l.contractId ? `${curto(l.contractId)}${l.contractJaLigado ? ' (já ligado)' : ' → ligar'}` : '-';
    const acordo = pl?.acordo ? `${pl.acordo.acao === 'criar' ? 'criar' : `${pl.acordo.acao} ${curto(pl.acordo.id)}`}` : pl?.candidatos.length ? `? ${pl.candidatos.map(curto).join(', ')}` : '-';
    const parcelas = pl?.acordo && l.entrada?.soLigar ? `existentes: ${pl.existentes}` : pl?.acordo ? `criar ${pl.criar.length} · adotar ${pl.adotar.length} · ligar cobrança ${pl.vestir.length}` : '-';
    return [curto(l.leadId), ...(comNome ? [celula(l.cliente)] : []), registro, financeiro, acordo, parcelas, celula(situacao(l))];
  });
  const linha = (c: string[]) => `| ${c.join(' | ')} |`;
  const resumo = {
    clientes: linhas.length,
    aplicar: linhas.filter(temTrabalho).length,
    ambiguos: linhas.filter((l) => !l.fora && ((l.plano?.ambiguo.length ?? 0) > 0 || l.ambiguo.length > 0)).length,
    fora: linhas.filter((l) => !!l.fora || !!l.plano?.semRegistro).length,
  };
  return [
    linha(cab),
    linha(cab.map(() => '---')),
    ...rows.map(linha),
    '',
    `${resumo.clientes} cliente(s) ativo(s) · ${resumo.aplicar} a aplicar · ${resumo.ambiguos} ambíguo(s) (ficam de fora) · ${resumo.fora} fora do backfill.`,
  ].join('\n');
}

const literal = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

/**
 * O SQL que desfaz o diário, do último passo para o primeiro. O previsto `parc_<id>` da parcela apagada
 * sai na próxima passagem do Financeiro (`materializarParcelas`); o `--desfazer` já o tira.
 */
export function sqlDoDesfazer(anotacoes: readonly AnotacaoDoDinheiro[], orgId: string): string {
  const linhas = [...anotacoes].reverse().map((a) =>
    a.coluna === '*'
      ? `DELETE FROM "${a.tabela}" WHERE "id" = ${literal(a.linha)};`
      : `UPDATE "${a.tabela}" SET "${a.coluna}" = ${literal(a.antes)} WHERE "id" = ${literal(a.linha)} AND "${a.coluna}" IS NOT DISTINCT FROM ${literal(a.depois)};`,
  );
  return ['BEGIN;', ...linhas, `DELETE FROM "${DIARIO}" WHERE "orgId" = ${literal(orgId)};`, 'COMMIT;'].join('\n');
}

const CRIAR_DIARIO = `CREATE TABLE IF NOT EXISTS "${DIARIO}" (
  "seq" SERIAL PRIMARY KEY, "orgId" TEXT NOT NULL, "em" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "tabela" TEXT NOT NULL, "linha" TEXT NOT NULL, "coluna" TEXT NOT NULL, "antes" TEXT, "depois" TEXT
)`;

export interface OpcoesDoAplicar {
  /** `--assumir-importados --pessoa`: quem assume os importados (já conferida por `exigirGenteNoContrato`). */
  assumirComo?: PessoaNoContrato;
  agora?: Date;
}

/** Uma transação só: o que não é ambíguo, sob o cadeado de cada lead, anotado no diário. */
export async function aplicarBackfill(db: Banco, orgId: string, hoje: string = hojeEmSP(), opcoes: OpcoesDoAplicar = {}): Promise<{ aplicados: number; assumidos: number; anotacoes: AnotacaoDoDinheiro[] }> {
  const anotacoes: AnotacaoDoDinheiro[] = [];
  let aplicados = 0;
  let assumidos = 0;
  const pessoa = opcoes.assumirComo ?? null;
  const agora = opcoes.agora ?? new Date();
  // Só o `gravarNaTransacao` do fio (não lê o banco do serviço nem roda reação).
  const fio = new FioService(db as unknown as PrismaService, new ReacoesRegistry());
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(CRIAR_DIARIO);
      const anotar = async (a: AnotacaoDoDinheiro) => {
        anotacoes.push(a);
        await tx.$executeRawUnsafe(`INSERT INTO "${DIARIO}" ("orgId", "tabela", "linha", "coluna", "antes", "depois") VALUES ($1, $2, $3, $4, $5, $6)`, orgId, a.tabela, a.linha, a.coluna, a.antes, a.depois);
      };
      // Replaneja dentro da transação: o ensaio pode ter ficado velho.
      for (const l of await planejarBackfill(tx as unknown as Banco, orgId, hoje, { assumirImportados: !!pessoa })) {
        if (!temTrabalho(l)) continue;
        await cadeadoDoContrato(tx, orgId, l.leadId);
        if (l.assumir && pessoa) {
          // O caminho da tela (`assumirImportado`), dentro desta transação; o que nasceu vai ao diário.
          const g = await gravarImportadoAssumido(tx, orgId, l.leadId, l.assumir, pessoa, agora, fio);
          if (g.criado) {
            assumidos++;
            await anotar({ tabela: 'ComercialContrato', linha: l.assumir.id, coluna: '*', antes: null, depois: 'criado' });
          }
          if (g.evento) await anotar({ tabela: 'LeadEvent', linha: g.evento.eventoId, coluna: '*', antes: null, depois: 'criado' });
        }
        const plano = await planejarDinheiro(tx, l.entrada!);
        if (!plano.contrato || !plano.acordo || plano.ambiguo.length) continue;
        const feito = await aplicarDinheiro(tx, l.entrada!, plano, anotar);
        if (l.contractId && !l.contractJaLigado) {
          const r = await tx.contract.updateMany({ where: { id: l.contractId, orgId, comercialContratoId: null }, data: { comercialContratoId: feito.contratoId } });
          if (r.count) await anotar({ tabela: 'Contract', linha: l.contractId, coluna: 'comercialContratoId', antes: null, depois: feito.contratoId });
        }
        aplicados++;
      }
      // As parcelas novas sem cobrança viram o previsto `parc_<id>` (desfazer apaga a parcela e o previsto sai na próxima passagem).
      await materializarParcelas(tx, orgId);
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return { aplicados, assumidos, anotacoes };
}

/** Roda o desfazer do diário desta empresa (a mesma conta de `sqlDoDesfazer`). */
export async function desfazerBackfill(db: Banco, orgId: string): Promise<number> {
  return db.$transaction(
    async (tx) => {
      const existe = await tx.$queryRawUnsafe<Array<{ ok: boolean }>>(`SELECT to_regclass('public."${DIARIO}"') IS NOT NULL AS ok`);
      if (!existe[0]?.ok) return 0;
      const linhas = await tx.$queryRawUnsafe<AnotacaoDoDinheiro[]>(`SELECT "tabela", "linha", "coluna", "antes", "depois" FROM "${DIARIO}" WHERE "orgId" = $1 ORDER BY "seq" DESC`, orgId);
      for (const a of linhas) {
        if (a.coluna === '*') await tx.$executeRawUnsafe(`DELETE FROM "${a.tabela}" WHERE "id" = $1`, a.linha);
        else await tx.$executeRawUnsafe(`UPDATE "${a.tabela}" SET "${a.coluna}" = $1 WHERE "id" = $2 AND "${a.coluna}" IS NOT DISTINCT FROM $3`, a.antes, a.linha, a.depois);
      }
      await tx.$executeRawUnsafe(`DELETE FROM "${DIARIO}" WHERE "orgId" = $1`, orgId);
      await materializarParcelas(tx, orgId);
      return linhas.length;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modos = ['--ensaio', '--aplicar', '--desfazer'].filter((m) => args.includes(m));
  if (modos.length > 1) throw new Error('escolha um: --ensaio (padrão), --aplicar ou --desfazer.');
  const modo = modos[0] ?? '--ensaio';
  const org = opcao(args, 'org');
  const detalhe = opcao(args, 'detalhe');
  const assumirImportados = args.includes('--assumir-importados');
  const pessoaId = opcao(args, 'pessoa');
  if (!org) throw new Error('falta --org <apelido|id>: o comando nunca escolhe a empresa sozinho.');
  if (assumirImportados && !pessoaId) throw new Error('--assumir-importados pede --pessoa <userId>: o registro nasce em nome de gente de verdade.');
  if (pessoaId && !assumirImportados) throw new Error('--pessoa só vale com --assumir-importados.');
  if (assumirImportados && modo === '--desfazer') throw new Error('--desfazer não assume nada: rode sem --assumir-importados.');
  if (detalhe && dentroDeGit(detalhe)) throw new Error('o arquivo de --detalhe tem nome de cliente: grave fora de repositório git.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL vazia. Nunca passe a URL na linha de comando.');

  const base = new PrismaClient();
  const prisma = comTenantNaSessao(base, { modo: 'observar', avisar: () => undefined });
  try {
    const empresa = await prisma.org.findFirst({ where: { OR: [{ id: org }, { slug: org }] }, select: { id: true } });
    if (!empresa) throw new Error('a empresa de --org não existe neste banco.');
    const orgId = empresa.id;
    await comContexto({ orgId, actorType: ActorType.system, actorId: null, correlationId: `terminal-ligar-dinheiro-${orgId}-${Date.now()}`, origem: 'script' }, async () => {
      // A mesma régua da tela: ativa, desta empresa, sem papel de máquina (RECUSA_DE_MAQUINA) e com `leads.editar`.
      const pessoa = pessoaId ? await exigirGenteNoContrato(prisma as unknown as PrismaService, orgId, { id: pessoaId, nome: null, papeis: [] }) : null;
      if (modo === '--desfazer') {
        const n = await desfazerBackfill(prisma, orgId);
        console.log(n ? `${n} passo(s) do diário desfeito(s). O diário desta empresa foi esvaziado.` : 'Diário vazio: nada a desfazer.');
        return;
      }
      if (modo === '--aplicar') {
        const r = await aplicarBackfill(prisma, orgId, hojeEmSP(), { assumirComo: pessoa ?? undefined });
        console.log(`${r.aplicados} cliente(s) ligado(s)${pessoa ? `, ${r.assumidos} importado(s) assumido(s)` : ''}, ${r.anotacoes.length} mudança(s) no diário "${DIARIO}".`);
        console.log('\nPara desfazer (ou rode --desfazer):\n');
        console.log(sqlDoDesfazer(r.anotacoes, orgId));
        return;
      }
      const linhas = await planejarBackfill(prisma, orgId, hojeEmSP(), { assumirImportados });
      if (detalhe) {
        mkdirSync(path.dirname(path.resolve(detalhe)), { recursive: true });
        writeFileSync(detalhe, [`# Dinheiro dos contratos · ensaio · ${new Date().toISOString()}`, '', 'Fora do git: tem nome de cliente.', '', tabelaDoEnsaio(linhas, true), ''].join('\n'), { encoding: 'utf8', mode: 0o600 });
      }
      console.log(tabelaDoEnsaio(linhas));
      for (const l of linhas.filter(aplicavel)) console.log(`  ${curto(l.leadId)}: ${l.assumir ? `${fraseDoAssumir(l.assumir)}; depois, ` : ''}${resumoDoPlano(l.plano!)}`);
      for (const l of linhas.filter((x) => x.assumir && !aplicavel(x))) console.log(`  ${curto(l.leadId)}: não assume (${situacao(l)}): o registro só nasce para quem é ligado sem ambiguidade.`);
      console.log(`\nNada foi escrito. Depois de conferir, rode com --aplicar${assumirImportados ? ` --assumir-importados --pessoa ${pessoaId}` : ''}.`);
    });
  } finally {
    await base.$disconnect();
  }
}

// Só quando o arquivo compilado é executado: a suíte importa as funções sem disparar a linha de comando.
if (/ligar-dinheiro-dos-contratos\.js$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error('\nfalhou:', (e as Error).message);
    process.exit(1);
  });
}
