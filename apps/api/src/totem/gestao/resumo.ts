import type { Prisma } from '@prisma/client';
import {
  TOTEM_GESTAO_LIMITE_LISTA_RESUMO,
  normalizarBusca,
  totemSituacaoDaValidade,
  type TotemGestaoAlertaLote,
  type TotemGestaoIndicadores,
  type TotemGestaoProdutoSemLote,
  type TotemGestaoResumo,
  type TotemGestaoResumoLoja,
  type TotemGestaoTermoSemResultado,
} from '@mktos/shared';

import { escopoDeLojas, exigirLojaNoEscopo, type UsuarioDoEscopo } from '../comum/escopo';
import type { TotemLoteVigente } from '../lote/lote-vigente';
import {
  totemGestaoDiaEmSaoPaulo,
  totemGestaoEstadoDoDispositivo,
  totemGestaoHojeParaValidade,
  totemGestaoInicioDoDia,
  totemGestaoSomarDias,
} from './regras';

/*
 * O RESUMO DO PAINEL, em duas metades: `totemGestaoMontarResumo` é a conta
 * (pura, testada sem banco) e `totemGestaoCarregarResumo` só busca o que a conta
 * precisa, sempre dentro do escopo de lojas do usuário. O lote vigente vem de
 * fora, por parâmetro, porque a regra é da frente C (`loteVigentePorProduto`);
 * mapa vazio quer dizer "nenhum produto tem lote", e o resumo continua de pé.
 */

const TERMOS_NO_RESUMO = 10;

export interface TotemGestaoLojaDoResumo {
  id: string;
  codigo: string;
  nome: string;
  ativa: boolean;
}

export interface TotemGestaoEntradaDoResumo {
  agora: Date;
  redeInteira: boolean;
  lojaFiltrada: string | null;
  lojasDoEscopo: TotemGestaoLojaDoResumo[];
  /** As lojas somadas: a filtrada, ou as ativas do escopo. */
  lojas: TotemGestaoLojaDoResumo[];
  dispositivos: {
    lojaId: string;
    ativadoEm: Date | null;
    revogadoEm: Date | null;
    vistoEm: Date | null;
    codigoAtivacaoHash: string | null;
    ativacaoExpiraEm: Date | null;
  }[];
  buscasHoje: { lojaId: string | null; quantidade: number }[];
  buscas7Dias: { lojaId: string | null; quantidade: number }[];
  cadastrosHoje: { lojaId: string | null; quantidade: number }[];
  /** Termos crus como chegaram do aparelho; a conta junta os que normalizam igual. */
  termosSemResultado: { termo: string | null; vezes: number }[];
  /** Os produtos ativos do catálogo, que toda loja deveria ter com lote. */
  produtos: { id: string; nome: string }[];
  lotes: Map<string, Map<string, TotemLoteVigente>>;
}

function indicadoresVazios(): TotemGestaoIndicadores {
  return {
    totensOnline: 0,
    totensOffline: 0,
    totensAguardando: 0,
    ultimaSincronizacao: null,
    buscasHoje: 0,
    buscas7Dias: 0,
    cadastrosHoje: 0,
    produtosSemLote: 0,
    lotesVencidos: 0,
    lotesAVencer: 0,
  };
}

function maisRecente(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function somarPorLoja(linhas: { lojaId: string | null; quantidade: number }[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of linhas) if (l.lojaId) mapa.set(l.lojaId, (mapa.get(l.lojaId) ?? 0) + l.quantidade);
  return mapa;
}

export function totemGestaoTopTermos(
  termos: { termo: string | null; vezes: number }[],
  limite = TERMOS_NO_RESUMO,
): TotemGestaoTermoSemResultado[] {
  const somados = new Map<string, number>();
  for (const t of termos) {
    const termo = normalizarBusca(t.termo ?? '');
    if (termo) somados.set(termo, (somados.get(termo) ?? 0) + t.vezes);
  }
  return [...somados]
    .map(([termo, vezes]) => ({ termo, vezes }))
    .sort((a, b) => b.vezes - a.vezes || a.termo.localeCompare(b.termo, 'pt-BR'))
    .slice(0, limite);
}

export function totemGestaoMontarResumo(e: TotemGestaoEntradaDoResumo): TotemGestaoResumo {
  const hoje = totemGestaoHojeParaValidade(e.agora);
  const buscasHoje = somarPorLoja(e.buscasHoje);
  const buscas7Dias = somarPorLoja(e.buscas7Dias);
  const cadastrosHoje = somarPorLoja(e.cadastrosHoje);

  const lotesVencidos: TotemGestaoAlertaLote[] = [];
  const lotesAVencer: TotemGestaoAlertaLote[] = [];
  const produtosSemLote: TotemGestaoProdutoSemLote[] = [];

  const porLoja: TotemGestaoResumoLoja[] = e.lojas.map((loja) => {
    const ind = indicadoresVazios();
    for (const d of e.dispositivos) {
      if (d.lojaId !== loja.id) continue;
      const estado = totemGestaoEstadoDoDispositivo(d, e.agora);
      if (estado === 'online') ind.totensOnline += 1;
      else if (estado === 'offline') ind.totensOffline += 1;
      else if (estado === 'aguardando_ativacao') ind.totensAguardando += 1;
      if (estado !== 'revogado' && d.vistoEm) {
        ind.ultimaSincronizacao = maisRecente(ind.ultimaSincronizacao, d.vistoEm.toISOString());
      }
    }
    ind.buscasHoje = buscasHoje.get(loja.id) ?? 0;
    ind.buscas7Dias = buscas7Dias.get(loja.id) ?? 0;
    ind.cadastrosHoje = cadastrosHoje.get(loja.id) ?? 0;

    const lotesDaLoja = e.lotes.get(loja.id) ?? new Map<string, TotemLoteVigente>();
    for (const produto of e.produtos) {
      const lote = lotesDaLoja.get(produto.id);
      if (!lote) {
        ind.produtosSemLote += 1;
        produtosSemLote.push({ lojaId: loja.id, lojaNome: loja.nome, produtoId: produto.id, produtoNome: produto.nome });
        continue;
      }
      const situacao = totemSituacaoDaValidade(lote.validadeEm, hoje);
      if (situacao === 'ok') continue;
      const alerta: TotemGestaoAlertaLote = {
        lojaId: loja.id,
        lojaNome: loja.nome,
        produtoId: produto.id,
        produtoNome: produto.nome,
        loteCodigo: lote.codigo,
        validadeEm: lote.validadeEm.toISOString().slice(0, 10),
        presumido: lote.presumido,
      };
      if (situacao === 'vencido') {
        ind.lotesVencidos += 1;
        lotesVencidos.push(alerta);
      } else {
        ind.lotesAVencer += 1;
        lotesAVencer.push(alerta);
      }
    }
    return { lojaId: loja.id, codigo: loja.codigo, nome: loja.nome, ativa: loja.ativa, indicadores: ind };
  });

  const total = porLoja.reduce((soma, { indicadores: i }) => {
    soma.totensOnline += i.totensOnline;
    soma.totensOffline += i.totensOffline;
    soma.totensAguardando += i.totensAguardando;
    soma.ultimaSincronizacao = maisRecente(soma.ultimaSincronizacao, i.ultimaSincronizacao);
    soma.buscasHoje += i.buscasHoje;
    soma.buscas7Dias += i.buscas7Dias;
    soma.cadastrosHoje += i.cadastrosHoje;
    soma.produtosSemLote += i.produtosSemLote;
    soma.lotesVencidos += i.lotesVencidos;
    soma.lotesAVencer += i.lotesAVencer;
    return soma;
  }, indicadoresVazios());

  const porValidade = (a: TotemGestaoAlertaLote, b: TotemGestaoAlertaLote) =>
    a.validadeEm.localeCompare(b.validadeEm) || a.produtoNome.localeCompare(b.produtoNome, 'pt-BR');
  const limite = TOTEM_GESTAO_LIMITE_LISTA_RESUMO;

  return {
    geradoEm: e.agora.toISOString(),
    redeInteira: e.redeInteira,
    lojaFiltrada: e.lojaFiltrada,
    lojasDoEscopo: e.lojasDoEscopo.map(({ id, codigo, nome, ativa }) => ({ id, codigo, nome, ativa })),
    total,
    porLoja,
    termosSemResultado: totemGestaoTopTermos(e.termosSemResultado),
    lotesVencidos: lotesVencidos.sort(porValidade).slice(0, limite),
    lotesAVencer: lotesAVencer.sort(porValidade).slice(0, limite),
    produtosSemLote: produtosSemLote.slice(0, limite),
  };
}

// --- A busca do que a conta precisa ---

export type ClienteDoResumo = Pick<
  Prisma.TransactionClient,
  'totemLoja' | 'totemUsuarioLoja' | 'totemDispositivo' | 'totemEvento' | 'totemCliente' | 'totemProduto'
>;

export type TotemGestaoBuscarLotes = (
  lojaId: string,
  produtoIds: readonly string[],
) => Promise<Map<string, TotemLoteVigente>>;

const TIPOS_DE_BUSCA = ['busca', 'busca_sem_resultado'];

export async function totemGestaoCarregarResumo(
  tx: ClienteDoResumo,
  user: UsuarioDoEscopo,
  lojaId: string | undefined,
  agora: Date,
  buscarLotes: TotemGestaoBuscarLotes,
): Promise<TotemGestaoResumo> {
  const orgId = user.orgId;
  const escopo = await escopoDeLojas(tx, user);
  if (lojaId) await exigirLojaNoEscopo(tx, user, lojaId);

  const lojasDoEscopo = await tx.totemLoja.findMany({
    where: { orgId, ...(escopo === 'todas' ? {} : { id: { in: escopo } }) },
    select: { id: true, codigo: true, nome: true, ativa: true },
    orderBy: [{ ativa: 'desc' }, { nome: 'asc' }],
  });
  const lojas = lojaId ? lojasDoEscopo.filter((l) => l.id === lojaId) : lojasDoEscopo.filter((l) => l.ativa);
  const ids = lojas.map((l) => l.id);

  const vazio: TotemGestaoEntradaDoResumo = {
    agora,
    redeInteira: escopo === 'todas',
    lojaFiltrada: lojaId ?? null,
    lojasDoEscopo,
    lojas,
    dispositivos: [],
    buscasHoje: [],
    buscas7Dias: [],
    cadastrosHoje: [],
    termosSemResultado: [],
    produtos: [],
    lotes: new Map(),
  };
  if (ids.length === 0) return totemGestaoMontarResumo(vazio);

  const inicioHoje = totemGestaoInicioDoDia(totemGestaoDiaEmSaoPaulo(agora));
  const inicio7Dias = totemGestaoSomarDias(inicioHoje, -6);
  const daLoja = { orgId, lojaId: { in: ids } };

  const [dispositivos, buscasHoje, buscas7Dias, cadastros, termos, produtos] = await Promise.all([
    tx.totemDispositivo.findMany({
      where: daLoja,
      select: {
        lojaId: true,
        ativadoEm: true,
        revogadoEm: true,
        vistoEm: true,
        codigoAtivacaoHash: true,
        ativacaoExpiraEm: true,
      },
    }),
    tx.totemEvento.groupBy({
      by: ['lojaId'],
      where: { ...daLoja, tipo: { in: TIPOS_DE_BUSCA }, ocorridoEm: { gte: inicioHoje } },
      _count: { _all: true },
    }),
    tx.totemEvento.groupBy({
      by: ['lojaId'],
      where: { ...daLoja, tipo: { in: TIPOS_DE_BUSCA }, ocorridoEm: { gte: inicio7Dias } },
      _count: { _all: true },
    }),
    tx.totemCliente.groupBy({
      by: ['lojaOrigemId'],
      where: { orgId, lojaOrigemId: { in: ids }, criadoEm: { gte: inicioHoje } },
      _count: { _all: true },
    }),
    tx.totemEvento.groupBy({
      by: ['termo'],
      where: { ...daLoja, tipo: 'busca_sem_resultado', termo: { not: null }, ocorridoEm: { gte: inicio7Dias } },
      _count: { termo: true },
      orderBy: { _count: { termo: 'desc' } },
      take: 200,
    }),
    tx.totemProduto.findMany({
      where: { orgId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    }),
  ]);

  const produtoIds = produtos.map((p) => p.id);
  const lotes = new Map<string, Map<string, TotemLoteVigente>>();
  for (const id of ids) lotes.set(id, produtoIds.length ? await buscarLotes(id, produtoIds) : new Map());

  return totemGestaoMontarResumo({
    ...vazio,
    dispositivos,
    buscasHoje: buscasHoje.map((b) => ({ lojaId: b.lojaId, quantidade: b._count._all })),
    buscas7Dias: buscas7Dias.map((b) => ({ lojaId: b.lojaId, quantidade: b._count._all })),
    cadastrosHoje: cadastros.map((c) => ({ lojaId: c.lojaOrigemId, quantidade: c._count._all })),
    termosSemResultado: termos.map((t) => ({ termo: t.termo, vezes: t._count.termo })),
    produtos,
    lotes,
  });
}
