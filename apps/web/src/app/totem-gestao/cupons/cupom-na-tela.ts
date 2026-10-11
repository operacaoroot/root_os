import {
  TotemCodigoCupomSchema,
  type TotemCupomDetalhe,
  type TotemLojaDoEscopo,
  type TotemStatusCupom,
} from '@mktos/shared';

/*
 * O cupom no painel (frente D): como a tela do caixa e a ficha do cliente
 * mostram datas, código e status, e quando o caixa pode dar baixa. Mora fora
 * de `page.tsx` porque página do App Router só pode exportar o componente.
 */

const FUSO = 'America/Sao_Paulo';

export function dataBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO });
}

export function dataHoraBR(iso: string): string {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  return `${dataBR(iso)} às ${hora}`;
}

/** "ABCD2345" → "ABCD-2345", o mesmo desenho que o cliente vê no totem. */
export function codigoNaTela(codigo: string): string {
  return codigo.length === 8 ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo;
}

export const TOM_DO_STATUS: Record<TotemStatusCupom, 'good' | 'muted' | 'warn' | 'bad'> = {
  emitido: 'good',
  usado: 'muted',
  expirado: 'warn',
  cancelado: 'bad',
};

/**
 * O que o caixa digitou, já no formato da API (sem hífen, O vira 0, I e L
 * viram 1). `null` com o campo vazio; `problema` quando não forma um código.
 */
export function codigoDigitado(texto: string): { codigo: string } | { problema: string } | null {
  if (!texto.trim()) return null;
  const r = TotemCodigoCupomSchema.safeParse(texto);
  if (r.success) return { codigo: r.data };
  return { problema: r.error.issues[0]?.message ?? 'O código do cupom tem 8 letras ou números.' };
}

/**
 * Por que o caixa não pode dar baixa agora, numa frase para mostrar a ele.
 * `null` quando pode. A API confere tudo de novo na baixa; isto só evita o
 * clique que já se sabe recusado.
 */
export function motivoSemBaixa(cupom: TotemCupomDetalhe, lojaId: string): string | null {
  if (cupom.status === 'usado') {
    const quando = cupom.usadoEm ? ` em ${dataHoraBR(cupom.usadoEm)}` : '';
    const onde = cupom.usadoLoja ? `, na loja ${cupom.usadoLoja.nome}` : '';
    return `Este cupom já foi usado${quando}${onde}.`;
  }
  if (cupom.status === 'expirado') return `Este cupom venceu em ${dataBR(cupom.validoAte)} e não vale mais.`;
  if (cupom.status === 'cancelado') return 'Este cupom foi cancelado e não vale mais.';
  if (!lojaId) return 'Escolha a loja deste caixa para dar baixa.';
  if (cupom.lojasValidas !== 'todas' && !cupom.lojasValidas.some((l) => l.id === lojaId)) {
    return 'Este cupom não vale nesta loja.';
  }
  return null;
}

export function textoDasLojasValidas(lojasValidas: TotemCupomDetalhe['lojasValidas']): string {
  if (lojasValidas === 'todas') return 'Todas as lojas';
  if (lojasValidas.length === 0) return 'Nenhuma loja';
  return lojasValidas.map((l) => l.nome).join(', ');
}

/** Onde o navegador do caixa lembra a loja escolhida, para não pedir a cada cupom. */
export const CHAVE_LOJA_DO_CAIXA = 'totem.caixa.loja';

export function lerLojaGuardada(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_LOJA_DO_CAIXA);
  } catch {
    return null;
  }
}

export function guardarLoja(lojaId: string): void {
  try {
    if (lojaId) window.localStorage.setItem(CHAVE_LOJA_DO_CAIXA, lojaId);
    else window.localStorage.removeItem(CHAVE_LOJA_DO_CAIXA);
  } catch {
    // Sem armazenamento (aba anônima, bloqueio do navegador): o caixa escolhe a loja de novo.
  }
}

/** A loja guardada, se ainda estiver ativa no acesso; senão a única loja ativa; senão nenhuma. */
export function lojaInicial(lojas: TotemLojaDoEscopo[], guardada: string | null): string {
  const ativas = lojas.filter((l) => l.ativa);
  if (guardada && ativas.some((l) => l.id === guardada)) return guardada;
  return ativas.length === 1 ? ativas[0].id : '';
}
