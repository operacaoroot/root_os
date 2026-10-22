import {
  PROCEDENCIA_DO_CONTRATO_IMPORTADO,
  type AnexoDoImportado,
  type ParcelaManual,
  type ParcelasDoImportado,
  type ReguaDoImportado,
} from '@mktos/shared';

/*
 * O CONTRATO IMPORTADO, a parte pura (rodada de produção 2, 22/10/2026, M2).
 *
 * Tudo que a tela mostra do contrato importado é LEITURA do fio do lead: o PDF
 * mais novo (`contrato.anexado` com `procedencia: 'importado'`), a versão mais
 * nova das parcelas (`contrato.parcelas_lancadas`), a régua (`contrato.regua_ligada`)
 * e o último aviso de cada parcela (`parcela.vence` com `contrato`). Sem Nest e
 * sem banco: a suíte mede isto sem subir nada.
 */

/** A chave do fato do anexo: por contrato e pelo conteúdo (o mesmo PDF no mesmo contrato cai no mesmo fato). */
export function chaveDoAnexoImportado(origem: string, sha256: string): string {
  return `importado:${origem}:${sha256}`;
}

/** A chave do fato das parcelas: a versão (duas abas salvando a mesma versão caem no mesmo fato). */
export function chaveDasParcelas(origem: string, versao: number): string {
  return `importado:${origem}:v${versao}`;
}

/** A chave do aviso da régua de uma parcela lançada à mão (a mesma passagem, ou a do dia seguinte, não repete). */
export function chaveDoAvisoImportado(origem: string, n: number, vence: string, aviso: string): string {
  return `importado:${origem}:${n}:${vence}:${aviso}`;
}

export interface FatoDoFio {
  type: string;
  payload: unknown;
  occurredAt: Date;
}

const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** As linhas de um fato de parcelas, conferidas (linha torta fica de fora em vez de virar número inventado). */
export function linhasDoFato(payload: unknown): ParcelaManual[] {
  const linhas = ((payload ?? {}) as { linhas?: unknown }).linhas;
  if (!Array.isArray(linhas)) return [];
  return linhas
    .map((l) => (l ?? {}) as Record<string, unknown>)
    .filter((l) => Number.isInteger(l.n) && Number.isInteger(l.valorCentavos) && typeof l.vence === 'string')
    .map((l) => ({ n: Number(l.n), valorCentavos: Number(l.valorCentavos), vence: String(l.vence), pagaEm: typeof l.pagaEm === 'string' ? l.pagaEm : null }));
}

/** O estado de uma parcela lançada: paga (com o dia), atrasada (venceu antes de hoje) ou pendente. */
export function estadoDaParcelaManual(p: { vence: string; pagaEm: string | null }, hoje: string): 'paga' | 'pendente' | 'atrasada' {
  if (p.pagaEm) return 'paga';
  return p.vence < hoje ? 'atrasada' : 'pendente';
}

export interface EstadoDoImportado {
  anexo: AnexoDoImportado | null;
  anexosAnteriores: number;
  parcelasManuais: ParcelasDoImportado | null;
  regua: ReguaDoImportado;
}

/** O estado de UM contrato importado, lido dos fatos do lead. */
export function estadoDoImportado(origem: string, fatos: readonly FatoDoFio[], hoje: string): EstadoDoImportado {
  const doContrato = (f: FatoDoFio) => (f.payload ?? {}) as Record<string, unknown>;
  const anexos = fatos
    .filter((f) => f.type === 'contrato.anexado' && doContrato(f).procedencia === PROCEDENCIA_DO_CONTRATO_IMPORTADO && doContrato(f).contratoImportado === origem)
    .sort((a, b) => Number(doContrato(a).versao ?? 0) - Number(doContrato(b).versao ?? 0) || a.occurredAt.getTime() - b.occurredAt.getTime());
  const ultimo = anexos[anexos.length - 1];
  const anexo: AnexoDoImportado | null = ultimo
    ? {
      nome: txt(doContrato(ultimo).nome) ?? 'contrato.pdf',
      bytes: Number(doContrato(ultimo).bytes ?? 0),
      sha256: String(doContrato(ultimo).sha256 ?? ''),
      em: ultimo.occurredAt.toISOString(),
      versao: Number(doContrato(ultimo).versao ?? anexos.length) || anexos.length,
      por: txt(doContrato(ultimo).por),
    }
    : null;

  const lancamentos = fatos
    .filter((f) => f.type === 'contrato.parcelas_lancadas' && doContrato(f).origem === origem)
    .sort((a, b) => Number(doContrato(a).versao ?? 0) - Number(doContrato(b).versao ?? 0));
  const lancado = lancamentos[lancamentos.length - 1];
  // O último aviso da régua de cada parcela (o fato mais novo daquela parcela, daquele contrato).
  const avisos = new Map<string, { aviso: string; em: number }>();
  for (const f of fatos) {
    if (f.type !== 'parcela.vence' || doContrato(f).contrato !== origem) continue;
    const k = `${String(doContrato(f).parcela)}:${String(doContrato(f).vence)}`;
    const atual = avisos.get(k);
    if (!atual || atual.em <= f.occurredAt.getTime()) avisos.set(k, { aviso: String(doContrato(f).aviso ?? ''), em: f.occurredAt.getTime() });
  }
  const parcelasManuais: ParcelasDoImportado | null = lancado
    ? (() => {
      const linhas = linhasDoFato(lancado.payload).map((l) => ({
        ...l,
        estado: estadoDaParcelaManual(l, hoje),
        aviso: avisos.get(`${l.n}:${l.vence}`)?.aviso ?? null,
      }));
      return {
        versao: Number(doContrato(lancado).versao ?? lancamentos.length) || lancamentos.length,
        linhas,
        somaCentavos: linhas.reduce((s, l) => s + l.valorCentavos, 0),
        em: lancado.occurredAt.toISOString(),
        por: txt(doContrato(lancado).por),
      };
    })()
    : null;

  const ligou = fatos.find((f) => f.type === 'contrato.regua_ligada' && doContrato(f).origem === origem);
  return {
    anexo,
    anexosAnteriores: Math.max(0, anexos.length - 1),
    parcelasManuais,
    regua: { ligada: !!ligou, em: ligou?.occurredAt.toISOString() ?? null, por: ligou ? txt(doContrato(ligou).por) : null },
  };
}
