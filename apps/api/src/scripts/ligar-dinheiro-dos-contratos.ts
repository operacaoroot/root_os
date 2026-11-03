/*
 * ============================================================================
 * O DINHEIRO DOS CONTRATOS QUE JÁ FECHARAM (etapa 4, 03/11/2026)
 * ============================================================================
 *
 *   node dist/scripts/ligar-dinheiro-dos-contratos.js --org <apelido|id> [--ensaio] [--detalhe <arquivo fora do git>]
 *   node dist/scripts/ligar-dinheiro-dos-contratos.js --org <apelido|id> --aplicar
 *   node dist/scripts/ligar-dinheiro-dos-contratos.js --org <apelido|id> --desfazer
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
import {
  aplicarDinheiro, cadeadoDoContrato, planejarDinheiro, resumoDoPlano,
  type AnotacaoDoDinheiro, type EntradaDoDinheiro, type ParcelaDoDinheiro, type PlanoDoDinheiro,
} from '../comercial/dinheiro-do-contrato';
import { hojeEmSP, venceComoData } from '../comercial/dinheiro.service';
import { aceiteDaDeclaracao, parcelasDoContratoFora } from '../comercial/fechado-fora';
import { dentroDeGit } from '../comercial/importador-crm/detalhe';
import { materializarParcelas } from '../finance/parcelas.service';
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
}

const curto = (id: string | null | undefined) => (id ? id.slice(0, 8) : '-');

/** Só lê: o plano de cada cliente ativo da empresa. */
export async function planejarBackfill(db: Banco, orgId: string, hoje: string = hojeEmSP()): Promise<LinhaDoDinheiro[]> {
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
    const linha: LinhaDoDinheiro = { leadId, cliente: parceiro?.razaoSocial ?? ficha?.empresa ?? '', partnerId, contractId, contractJaLigado: false, entrada: null, plano: null, fora: null, ambiguo: [] };
    linhas.push(linha);
    if (p.importado === true) { linha.fora = 'importado do CRM antigo (sem registro do contrato)'; continue; }
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
    if (!parcelas.length) { linha.fora = 'sem cobrança nem parcelas declaradas'; continue; }
    linha.entrada = {
      orgId, leadId, partnerId, cliente: parceiro.razaoSocial, produto: TABELA_DE_PRECO[produto as keyof typeof TABELA_DE_PRECO]?.rotulo ?? produto,
      valorCentavos: ficha?.valorNegociadoCentavos ?? ficha?.valorCentavos ?? valorCentavos, fechadoEm: ativo.occurredAt, parcelas,
    };
    linha.plano = await planejarDinheiro(db, linha.entrada);

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
  return temTrabalho(l) ? 'aplicar' : 'nada a fazer';
}

const celula = (s: string) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/** A tabela do ensaio. Sem `comNome`, só ids curtos (é o que vai ao console). */
export function tabelaDoEnsaio(linhas: readonly LinhaDoDinheiro[], comNome = false): string {
  const cab = ['lead', ...(comNome ? ['cliente'] : []), 'registro (estado)', 'contrato do Financeiro', 'acordo', 'parcelas', 'situação'];
  const rows = linhas.map((l) => {
    const pl = l.plano;
    const registro = pl?.contrato ? `${curto(pl.contrato.id)} (${pl.contrato.estado})` : '-';
    const financeiro = l.contractId ? `${curto(l.contractId)}${l.contractJaLigado ? ' (já ligado)' : ' → ligar'}` : '-';
    const acordo = pl?.acordo ? `${pl.acordo.acao === 'criar' ? 'criar' : `${pl.acordo.acao} ${curto(pl.acordo.id)}`}` : pl?.candidatos.length ? `? ${pl.candidatos.map(curto).join(', ')}` : '-';
    const parcelas = pl?.acordo ? `criar ${pl.criar.length} · adotar ${pl.adotar.length} · ligar cobrança ${pl.vestir.length}` : '-';
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

/** Uma transação só: o que não é ambíguo, sob o cadeado de cada lead, anotado no diário. */
export async function aplicarBackfill(db: Banco, orgId: string, hoje: string = hojeEmSP()): Promise<{ aplicados: number; anotacoes: AnotacaoDoDinheiro[] }> {
  const anotacoes: AnotacaoDoDinheiro[] = [];
  let aplicados = 0;
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(CRIAR_DIARIO);
      const anotar = async (a: AnotacaoDoDinheiro) => {
        anotacoes.push(a);
        await tx.$executeRawUnsafe(`INSERT INTO "${DIARIO}" ("orgId", "tabela", "linha", "coluna", "antes", "depois") VALUES ($1, $2, $3, $4, $5, $6)`, orgId, a.tabela, a.linha, a.coluna, a.antes, a.depois);
      };
      // Replaneja dentro da transação: o ensaio pode ter ficado velho.
      for (const l of await planejarBackfill(tx as unknown as Banco, orgId, hoje)) {
        if (!temTrabalho(l)) continue;
        await cadeadoDoContrato(tx, orgId, l.leadId);
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
  return { aplicados, anotacoes };
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
  if (!org) throw new Error('falta --org <apelido|id>: o comando nunca escolhe a empresa sozinho.');
  if (detalhe && dentroDeGit(detalhe)) throw new Error('o arquivo de --detalhe tem nome de cliente: grave fora de repositório git.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL vazia. Nunca passe a URL na linha de comando.');

  const base = new PrismaClient();
  const prisma = comTenantNaSessao(base, { modo: 'observar', avisar: () => undefined });
  try {
    const empresa = await prisma.org.findFirst({ where: { OR: [{ id: org }, { slug: org }] }, select: { id: true } });
    if (!empresa) throw new Error('a empresa de --org não existe neste banco.');
    const orgId = empresa.id;
    await comContexto({ orgId, actorType: ActorType.system, actorId: null, correlationId: `terminal-ligar-dinheiro-${orgId}-${Date.now()}`, origem: 'script' }, async () => {
      if (modo === '--desfazer') {
        const n = await desfazerBackfill(prisma, orgId);
        console.log(n ? `${n} passo(s) do diário desfeito(s). O diário desta empresa foi esvaziado.` : 'Diário vazio: nada a desfazer.');
        return;
      }
      if (modo === '--aplicar') {
        const r = await aplicarBackfill(prisma, orgId);
        console.log(`${r.aplicados} cliente(s) ligado(s), ${r.anotacoes.length} mudança(s) no diário "${DIARIO}".`);
        console.log('\nPara desfazer (ou rode --desfazer):\n');
        console.log(sqlDoDesfazer(r.anotacoes, orgId));
        return;
      }
      const linhas = await planejarBackfill(prisma, orgId);
      if (detalhe) {
        mkdirSync(path.dirname(path.resolve(detalhe)), { recursive: true });
        writeFileSync(detalhe, [`# Dinheiro dos contratos · ensaio · ${new Date().toISOString()}`, '', 'Fora do git: tem nome de cliente.', '', tabelaDoEnsaio(linhas, true), ''].join('\n'), { encoding: 'utf8', mode: 0o600 });
      }
      console.log(tabelaDoEnsaio(linhas));
      for (const l of linhas.filter(aplicavel)) console.log(`  ${curto(l.leadId)}: ${resumoDoPlano(l.plano!)}`);
      console.log('\nNada foi escrito. Depois de conferir, rode com --aplicar.');
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
