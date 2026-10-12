import {
  TOTEM_BOTAO_PADRAO,
  TotemCampanhaCriarSchema,
  type TotemAcaoCampanha,
  type TotemCampanhaCriar,
  type TotemCampanhaResumo,
  type TotemLojaDoEscopo,
  type TotemProdutoDaCampanha,
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
  acao: TotemAcaoCampanha;
  textoApoio: string;
  /** Vazio usa o texto padrão da ação. */
  textoBotao: string;
  /** Endereço da imagem enviada, ou vazio. */
  imagemUrl: string;
  /** Na ordem em que aparecem no totem. */
  produtos: TotemProdutoDaCampanha[];
  /** Vazio deixa a API decidir. */
  ordem: string;
  /** O benefício e a validade só valem na ação `cadastro`. */
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
    acao: 'cadastro',
    textoApoio: '',
    textoBotao: '',
    imagemUrl: '',
    produtos: [],
    ordem: '',
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
    acao: c.acao,
    textoApoio: c.textoApoio ?? '',
    textoBotao: c.textoBotao ?? '',
    imagemUrl: c.imagemUrl ?? '',
    produtos: [...c.produtos],
    ordem: String(c.ordem),
    tipoBeneficio: c.tipoBeneficio ?? 'percentual',
    valor: numeroNoFormulario(c.valorBeneficio),
    descricao: c.descricaoBeneficio ?? '',
    validadeDias: c.validadeDias == null ? '30' : String(c.validadeDias),
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
  const comCupom = f.acao === 'cadastro';
  const comValor = comCupom && f.tipoBeneficio !== 'brinde';
  const valor = comValor ? numeroDigitado(f.valor) : null;
  if (comValor && f.valor.trim() && valor === null) {
    return { problema: 'Digite o valor do benefício só com números, como 10 ou 15,50.' };
  }
  const ordem = f.ordem.trim() ? Number(f.ordem.trim()) : undefined;
  if (ordem !== undefined && !Number.isInteger(ordem)) {
    return { problema: 'A ordem é um número inteiro, de 0 a 999.' };
  }
  const r = TotemCampanhaCriarSchema.safeParse({
    nome: f.nome,
    chamada: f.chamada,
    acao: f.acao,
    textoApoio: f.textoApoio,
    textoBotao: f.textoBotao,
    imagemUrl: f.imagemUrl || null,
    // A lista só serve à ação `produtos`; trocar a ação limpa o que ficou escolhido.
    produtoIds: f.acao === 'produtos' ? f.produtos.map((p) => p.id) : [],
    ordem,
    tipoBeneficio: comCupom ? f.tipoBeneficio : null,
    valorBeneficio: valor,
    descricaoBeneficio: comCupom ? f.descricao.trim() || null : null,
    validadeDias: !comCupom ? null : f.validadeDias.trim() ? Number(f.validadeDias.trim()) : Number.NaN,
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
  if (issue?.path[0] === 'ordem') return { problema: 'A ordem é um número inteiro, de 0 a 999.' };
  return { problema: issue?.message ?? 'Confira os campos da campanha.' };
}

/** O texto que o botão do banner mostra, ou `null` quando a campanha só divulga. */
export function textoDoBotao(f: Pick<FormularioDaCampanha, 'acao' | 'textoBotao'>): string | null {
  if (f.acao === 'nenhuma') return f.textoBotao.trim() || null;
  return f.textoBotao.trim() || TOTEM_BOTAO_PADRAO[f.acao];
}

/** O que a campanha faz, para a coluna da lista. */
export function textoDaAcao(
  c: Pick<TotemCampanhaResumo, 'acao' | 'beneficio' | 'validadeDias' | 'produtos'>,
): { principal: string; detalhe: string | null } {
  if (c.acao === 'produtos') {
    const n = c.produtos.length;
    return { principal: n === 1 ? 'Mostra 1 produto' : `Mostra ${n} produtos`, detalhe: null };
  }
  if (c.acao === 'nenhuma') return { principal: 'Só divulga', detalhe: null };
  const dias = c.validadeDias ?? 0;
  return {
    principal: c.beneficio ?? 'Cupom no cadastro',
    detalhe: `Cupom vale ${dias} ${dias === 1 ? 'dia' : 'dias'}`,
  };
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
