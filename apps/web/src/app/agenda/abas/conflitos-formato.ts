import type { CartaoDeConflito, ResultadoDaEscrita, TipoDeConflito } from '@mktos/shared';

/*
 * O TEXTO DA ABA CONFLITOS (agenda v2, 29/10/2026, lane G5). Conta pura, sem
 * React: o rótulo e o tom de cada tipo, o "qua 04/11 · 09:00 · em 6 dias", o
 * título do topo e a mensagem do resultado de uma escrita. Tudo no relógio de
 * São Paulo. A cor sempre vai com a palavra: choque em magenta, atenção em
 * âmbar, OK em ciano.
 */

const FUSO = 'America/Sao_Paulo';

export type TomDoConflito = 'choque' | 'atencao' | 'neutro';

export const ROTULO_DO_TIPO: Record<TipoDeConflito, string> = {
  choque: 'choque',
  padrao: 'fora do padrão',
  sem_meet: 'sem Meet',
  rito: 'rito',
  feriado: 'feriado',
  janela: 'janela',
  fora: 'Fora',
  teto: 'teto',
};

/** O rótulo do filtro (plural e com maiúscula, como no desenho). */
export const FILTRO_DO_TIPO: Record<TipoDeConflito, string> = {
  choque: 'Choque',
  padrao: 'Padrão',
  sem_meet: 'Sem Meet',
  rito: 'Ritos',
  feriado: 'Feriado',
  janela: 'Janela',
  fora: 'Fora',
  teto: 'Teto',
};

export const ORDEM_DOS_TIPOS: readonly TipoDeConflito[] = ['choque', 'padrao', 'sem_meet', 'rito', 'feriado', 'fora', 'teto', 'janela'];

export function tomDoTipo(tipo: TipoDeConflito): TomDoConflito {
  if (tipo === 'choque') return 'choque';
  if (tipo === 'janela') return 'neutro';
  return 'atencao';
}

/** O rótulo do selo do cartão: o rito com gente Fora é "rito sem gente". */
export function rotuloDoCartao(c: Pick<CartaoDeConflito, 'tipo' | 'id'>): string {
  if (c.tipo === 'rito' && c.id.startsWith('rito-sem-gente')) return 'rito sem gente';
  return ROTULO_DO_TIPO[c.tipo];
}

const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'short', day: '2-digit', month: '2-digit' });
const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const chaveDoDia = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

const diaCurto = (d: Date): string => {
  const p = Object.fromEntries(dia.formatToParts(d).map((x) => [x.type, x.value]));
  return `${String(p.weekday ?? '').replace('.', '')} ${p.day}/${p.month}`;
};

const diasEntre = (a: Date, b: Date): number => {
  const k = (d: Date) => Date.parse(`${chaveDoDia.format(d)}T00:00:00Z`);
  return Math.round((k(b) - k(a)) / 86_400_000);
};

/** "qua 04/11 · 09:00 · em 6 dias" (hoje, amanhã, em N dias). */
export function quandoDoCartao(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const n = diasEntre(agora, d);
  const falta = n <= 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`;
  return `${diaCurto(d)} · ${hora.format(d)} · ${falta}`;
}

/** "09:00" de um instante, em São Paulo. */
export function horaDoCartao(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : hora.format(d);
}

/** "qua 04/11" de um instante. */
export function diaDoCartao(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : diaCurto(d);
}

const POR_EXTENSO = ['Nenhuma', 'Uma', 'Duas', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito', 'Nove', 'Dez'];

/** "Seis coisas pedem" / "Uma coisa pede" / "Nada pede". */
export function tituloDosConflitos(n: number): { comeco: string; fim: string } {
  if (n <= 0) return { comeco: 'Nada pede', fim: 'decisão agora.' };
  const numero = n < POR_EXTENSO.length ? POR_EXTENSO[n] : String(n);
  return n === 1 ? { comeco: `${numero} coisa pede`, fim: 'uma decisão de vocês.' } : { comeco: `${numero} coisas pedem`, fim: 'uma decisão de vocês.' };
}

/** "vigia AG-01 passou às 14:15" (ou o dia, se não foi hoje). */
export function textoDoVigia(iso: string | null, agora: Date = new Date()): string {
  if (!iso) return 'vigia AG-01 ainda não passou';
  const d = new Date(iso);
  const n = diasEntre(d, agora);
  return n === 0 ? `vigia AG-01 passou às ${hora.format(d)}` : `vigia AG-01 passou em ${diaCurto(d)} às ${hora.format(d)}`;
}

/** A mensagem que a tela mostra depois de `POST /agenda/escritas`. */
export function mensagemDaEscrita(r: Partial<ResultadoDaEscrita> | null | undefined): { tom: 'ok' | 'fila' | 'recusa'; texto: string } {
  if (r?.status === 'executado') return { tom: 'ok', texto: r.mensagem?.trim() || 'Saiu: gravado no Google e no histórico.' };
  if (r?.status === 'aguardando_aprovacao') {
    const outra = r.precisaDeOutraPessoa ? ' Outra pessoa com alçada confirma em Aprovações.' : '';
    return { tom: 'fila', texto: `Foi para a fila de aprovação.${outra} Nada mudou na agenda ainda.` };
  }
  if (r?.regua && r.regua.cor === 'vermelho') {
    const frases = r.regua.itens.filter((i) => i.nivel === 'bloqueio').map((i) => i.frase);
    return { tom: 'recusa', texto: `A régua deu vermelho: ${frases.join(' ')} Nada foi enviado.` };
  }
  return { tom: 'recusa', texto: r?.mensagem?.trim() || 'Recusado: nada foi enviado.' };
}
