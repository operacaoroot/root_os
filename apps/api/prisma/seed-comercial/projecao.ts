import { LEAD_STATUS_DA_ETAPA, ehSaida, type ComercialEtapa } from '@mktos/shared';

import { camposDoEvento } from '../../src/comercial/ficha.service';

/*
 * A PROJEÇÃO DO FIO NA FICHA, para a semente (lane F, 13/10/2026).
 *
 * A ficha de um lead semeado NÃO é digitada: é o resultado de aplicar, em ordem,
 * os eventos do lead com as MESMAS funções da API. `camposDoEvento` (ficha.service)
 * diz que campos cada fato escreve; o `etapa.mudou` move a etapa como o
 * `FichaService.mudarEtapa` faz (`etapaDesde`, `etapaAntesDaSaida`) e o
 * `Lead.status` sai do mapa fixo `LEAD_STATUS_DA_ETAPA`. Pura, sem banco e sem
 * Nest: o script (tsx) e o teste (vitest) a usam do mesmo jeito, e o teste
 * confere a ficha gravada contra esta projeção refeita dos eventos lidos do banco.
 *
 * O que NÃO é projeção e a semente declara à parte (`overlay`): `saude` e a
 * próxima ação (`proximaAcao*`). Nenhum código da API escreve esses campos
 * ainda (achado da lane F registrado em homolog/progresso.md); a semente grava
 * o texto que o mapa mostra na tela 04 e a tela do funil deixa de ficar nula.
 */

export interface EventoLido {
  id: string;
  type: string;
  payload: unknown;
  occurredAt: Date;
}

/** As colunas da `ComercialFicha` que a projeção dos eventos é dona, com o valor de partida. */
export const COLUNAS_PROJETADAS = [
  'etapa',
  'etapaDesde',
  'etapaAntesDaSaida',
  'empresa',
  'cnpj',
  'canal',
  'perfil',
  'pontuacao',
  'sistemaErp',
  'baseDados',
  'donoId',
  'socioDaConta',
  'rota',
  'produto',
  'valorCentavos',
  'parcelas',
  'parcelaCentavos',
  'forma',
  'descontoPct',
  'validade',
  'propostaVersao',
  'propostaHash',
  'quadroDeCustos',
  'reuniaoEm',
  'ataHash',
  'diagnostico',
  'diagnosticoAprovadoEm',
  'cadastro',
  'motivoSaida',
  'motivoDetalhe',
  'voltaEm',
  'parceiro',
  'confirmacaoEnviadaEm',
  'propostaPublicadaEm',
  'propostaLidaPelaPrimeiraVezEm',
  'propostaAceitaEm',
  'cobrancaCriadaEm',
  'contratoAssinadoClienteEm',
  'contratoAssinadoRootEm',
  'pixPagoEm',
  'clienteAtivoEm',
  'kickoffEm',
  'partnerId',
  'contractId',
  'trilhoId',
] as const;
export type ColunaProjetada = (typeof COLUNAS_PROJETADAS)[number];

export interface Projecao {
  /** Todas as colunas de `COLUNAS_PROJETADAS`, as não escritas por nenhum fato em `null` (`propostaVersao` em 0). */
  ficha: Record<ColunaProjetada, unknown>;
  lead: { status: string; score: number | null; ownerId: string | null };
}

function vazia(entrada: Date): Record<ColunaProjetada, unknown> {
  const f = Object.fromEntries(COLUNAS_PROJETADAS.map((c) => [c, null])) as Record<ColunaProjetada, unknown>;
  f.etapa = 'novo_lead';
  f.etapaDesde = entrada;
  f.propostaVersao = 0;
  return f;
}

export function projetarLead(eventos: readonly EventoLido[], entrada: Date): Projecao {
  const ordenados = [...eventos].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  const ficha = vazia(entrada);
  let score: number | null = null;
  let ownerId: string | null = null;

  for (const e of ordenados) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (e.type === 'etapa.mudou') {
      const de = String(p.de) as ComercialEtapa;
      const para = String(p.para) as ComercialEtapa;
      if (ehSaida(para)) ficha.etapaAntesDaSaida = ehSaida(de) ? ficha.etapaAntesDaSaida : de;
      ficha.etapa = para;
      ficha.etapaDesde = e.occurredAt;
      continue;
    }
    if (e.type === 'lead.pontuado' && typeof p.pontuacao === 'number') score = p.pontuacao;
    if (e.type === 'dono.atribuido' && typeof p.donoId === 'string' && p.donoId && ownerId === null) ownerId = p.donoId;
    const campos = camposDoEvento(e.type, e.payload, e.occurredAt, ficha as never);
    if (campos) Object.assign(ficha, campos);
  }

  return { ficha, lead: { status: LEAD_STATUS_DA_ETAPA[ficha.etapa as ComercialEtapa], score, ownerId } };
}

/** Compara o valor gravado com o projetado (data por instante, decimal por número, JSON por conteúdo). */
export function iguais(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const na = comoNumero(a);
  const nb = comoNumero(b);
  if (na !== null && nb !== null) return na === nb;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b));
  return a === b;
}

function comoNumero(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'toNumber' in (v as object)) return Number(v);
  return null;
}

function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])]));
  return v;
}
