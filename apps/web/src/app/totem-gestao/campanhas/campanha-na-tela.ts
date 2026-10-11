import {
  TotemCampanhaCriarSchema,
  type TotemCampanhaCriar,
  type TotemCampanhaResumo,
  type TotemLojaDoEscopo,
  type TotemTipoBeneficio,
} from '@mktos/shared';

/*
 * A campanha no painel (frente D): o formulário em texto, a conversão para o
 * corpo que a API aceita e os rótulos da lista. Fora de `page.tsx` porque
 * página do App Router só pode exportar o componente.
 *
 * As datas do formulário são dias, sem hora: o início vale da meia-noite e o
 * fim até 23:59:59 no horário de Brasília (UTC−3 fixo desde 2019), o mesmo
 * fuso em que o cupom vence.
 */

export interface FormularioDaCampanha {
  nome: string;
  chamada: string;
  tipoBeneficio: TotemTipoBeneficio;
  valor: string;
  descricao: string;
  validadeDias: string;
  /** AAAA-MM-DD ou vazio. */
  inicio: string;
  /** AAAA-MM-DD ou vazio (sem data de fim). */
  fim: string;
  ativa: boolean;
  lojaIds: string[];
}

export const ROTULO_DO_TIPO: Record<TotemTipoBeneficio, string> = {
  percentual: 'Desconto em percentual',
  valor: 'Desconto em reais',
  brinde: 'Brinde',
};

export function formularioVazio(): FormularioDaCampanha {
  return {
    nome: '',
    chamada: '',
    tipoBeneficio: 'percentual',
    valor: '',
    descricao: '',
    validadeDias: '30',
    inicio: '',
    fim: '',
    ativa: true,
    lojaIds: [],
  };
}

/** O dia, em Brasília, de um instante ISO: "2026-10-11". */
export function diaEmBrasilia(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function numeroNoFormulario(n: number | null): string {
  return n == null ? '' : String(n).replace('.', ',');
}

export function formularioDaCampanha(c: TotemCampanhaResumo): FormularioDaCampanha {
  return {
    nome: c.nome,
    chamada: c.chamada,
    tipoBeneficio: c.tipoBeneficio,
    valor: numeroNoFormulario(c.valorBeneficio),
    descricao: c.descricaoBeneficio ?? '',
    validadeDias: String(c.validadeDias),
    inicio: diaEmBrasilia(c.inicioEm),
    fim: c.fimEm ? diaEmBrasilia(c.fimEm) : '',
    ativa: c.ativa,
    lojaIds: [...c.lojaIds],
  };
}

/** "15", "15,5", "15.50" e "1.234,56" viram número; o resto, `null`. */
export function numeroDigitado(texto: string): number | null {
  const t = texto.replace(/\s/g, '');
  if (!t) return null;
  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null;
  return Number(normalizado);
}

/**
 * O corpo do POST e do PATCH, já conferido com o schema da API. A recusa vem
 * numa frase só, a primeira que o schema der, para a tela mostrar em cima do
 * botão de salvar.
 */
export function corpoDaCampanha(
  f: FormularioDaCampanha,
  podeEscolherTodas: boolean,
): { corpo: TotemCampanhaCriar } | { problema: string } {
  if (f.lojaIds.length === 0 && !podeEscolherTodas) return { problema: 'Escolha pelo menos uma loja.' };
  const valor = f.tipoBeneficio === 'brinde' ? null : numeroDigitado(f.valor);
  if (f.tipoBeneficio !== 'brinde' && f.valor.trim() && valor === null) {
    return { problema: 'Digite o valor do benefício só com números, como 10 ou 15,50.' };
  }
  const validade = Number(f.validadeDias.trim());
  const r = TotemCampanhaCriarSchema.safeParse({
    nome: f.nome,
    chamada: f.chamada,
    tipoBeneficio: f.tipoBeneficio,
    valorBeneficio: valor,
    descricaoBeneficio: f.descricao.trim() || null,
    validadeDias: f.validadeDias.trim() ? validade : Number.NaN,
    inicioEm: f.inicio ? `${f.inicio}T00:00:00-03:00` : undefined,
    fimEm: f.fim ? `${f.fim}T23:59:59-03:00` : null,
    ativa: f.ativa,
    lojaIds: f.lojaIds,
  });
  if (r.success) return { corpo: r.data };
  const issue = r.error.issues[0];
  if (issue?.path[0] === 'validadeDias' && issue.code === 'invalid_type') {
    return { problema: 'Digite em quantos dias o cupom vence, de 1 a 365.' };
  }
  return { problema: issue?.message ?? 'Confira os campos da campanha.' };
}

export type TomDaSituacao = 'good' | 'brand' | 'muted' | 'warn';

/** Em que pé a campanha está agora, com o tom do selo. */
export function situacaoDaCampanha(
  c: Pick<TotemCampanhaResumo, 'ativa' | 'vigente' | 'inicioEm' | 'fimEm'>,
  agora: Date = new Date(),
): { rotulo: string; tom: TomDaSituacao } {
  if (c.vigente) return { rotulo: 'No ar', tom: 'good' };
  if (!c.ativa) return { rotulo: 'Desativada', tom: 'muted' };
  if (new Date(c.inicioEm).getTime() > agora.getTime()) return { rotulo: 'Agendada', tom: 'brand' };
  return { rotulo: 'Encerrada', tom: 'warn' };
}

const dataBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function textoDoPeriodo(c: Pick<TotemCampanhaResumo, 'inicioEm' | 'fimEm'>): string {
  if (!c.fimEm) return `Desde ${dataBR(c.inicioEm)}, sem data de fim`;
  return `De ${dataBR(c.inicioEm)} a ${dataBR(c.fimEm)}`;
}

export function textoDasLojas(lojaIds: string[], lojas: TotemLojaDoEscopo[]): string {
  if (lojaIds.length === 0) return 'Todas as lojas';
  const nomes = lojaIds.map((id) => lojas.find((l) => l.id === id)?.nome ?? 'uma loja fora do seu acesso');
  return nomes.join(', ');
}

/**
 * A API só deixa mexer em campanha cujas lojas estão todas no acesso de quem
 * pede; campanha de todas as lojas é só de quem cuida da rede.
 */
export function podeMexerNaCampanha(lojaIds: string[], lojas: TotemLojaDoEscopo[], cuidaDaRede: boolean): boolean {
  if (cuidaDaRede) return true;
  return lojaIds.length > 0 && lojaIds.every((id) => lojas.some((l) => l.id === id));
}
