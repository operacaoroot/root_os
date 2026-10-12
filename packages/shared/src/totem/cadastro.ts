import { z } from 'zod';

import {
  TOTEM_PRODUTOS_POR_CAMPANHA,
  TotemAcaoCampanhaSchema,
  TotemTipoBeneficioSchema,
  TotemUrlDeImagemSchema,
  type TotemAcaoCampanha,
  type TotemStatusCupom,
  type TotemTipoBeneficio,
} from './comum.js';
import type { TotemPolitica } from './politica.js';

/*
 * Schemas e tipos do cadastro do cliente, das campanhas e dos cupons
 * (`/api/totem-cadastro`, `/api/totem-campanhas`). Arquivo da frente D
 * (docs/totem/CONTRATO.md, seção 9). Nome exportado começa com `Totem` ou
 * `TOTEM_`: ver o cabeçalho de `comum.ts`.
 *
 * A validação de CPF e celular mora aqui, e não na API, porque o teclado do
 * totem e o formulário do celular avisam o erro antes de enviar com a mesma
 * regra que a API aplica na chegada.
 */

// --- CPF ---

export function totemSoDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

/** Onze dígitos, não todos iguais, com os dois dígitos verificadores certos. */
export function totemCpfValido(texto: string): boolean {
  const d = totemSoDigitos(texto);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const verificador = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i += 1) soma += Number(d[i]) * (n + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return verificador(9) === Number(d[9]) && verificador(10) === Number(d[10]);
}

/** `***.456.789-**`: os seis dígitos do meio, que sozinhos não identificam ninguém. */
export function totemMascararCpf(cpf: string): string {
  const d = totemSoDigitos(cpf);
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

export const TOTEM_CPF_ANONIMIZADO = '***.***.***-**';

// --- Celular ---

/** DDDs em uso no Brasil (Anatel). Um DDD inexistente é quase sempre erro de digitação. */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47,
  48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87,
  88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Celular brasileiro em E.164 (`+55DD9NNNNNNNN`) ou `null`. Aceita o número
 * com ou sem o 55 do país e com o zero de longa distância na frente do DDD.
 */
export function totemNormalizarCelular(texto: string): string | null {
  let d = totemSoDigitos(texto);
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  else if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 11) return null;
  if (!DDDS.has(Number(d.slice(0, 2))) || d[2] !== '9') return null;
  return `+55${d}`;
}

/** `(11) 9****-4321`. Celular apagado (cliente anonimizado) vira `null`. */
export function totemMascararCelular(e164: string): string | null {
  const d = totemSoDigitos(e164);
  if (d.length !== 13) return null;
  return `(${d.slice(2, 4)}) ${d[4]}****-${d.slice(9)}`;
}

// --- Cadastro (rota pública) ---

export const TOTEM_MENSAGEM_CPF_INVALIDO = 'Confira o CPF: os números digitados não formam um CPF válido.';
export const TOTEM_MENSAGEM_CELULAR_INVALIDO = 'Confira o celular: digite o DDD e os 9 números, começando pelo 9.';
export const TOTEM_MENSAGEM_ACEITE = 'Para receber o cupom, marque que leu e aceita a política de privacidade.';

const cpfSchema = z
  .string({ required_error: TOTEM_MENSAGEM_CPF_INVALIDO })
  .max(20, TOTEM_MENSAGEM_CPF_INVALIDO)
  .refine(totemCpfValido, TOTEM_MENSAGEM_CPF_INVALIDO)
  .transform(totemSoDigitos);

export const TotemCadastroCorpoSchema = z.object({
  cpf: cpfSchema,
  telefone: z
    .string({ required_error: TOTEM_MENSAGEM_CELULAR_INVALIDO })
    .max(25, TOTEM_MENSAGEM_CELULAR_INVALIDO)
    .transform((valor, ctx) => {
      const e164 = totemNormalizarCelular(valor);
      if (!e164) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: TOTEM_MENSAGEM_CELULAR_INVALIDO });
        return z.NEVER;
      }
      return e164;
    }),
  nome: z
    .string()
    .trim()
    .max(80, 'O nome pode ter até 80 letras.')
    .nullish()
    .transform((v) => (v ? v : null)),
  aceitePolitica: z.literal(true, { errorMap: () => ({ message: TOTEM_MENSAGEM_ACEITE }) }),
  aceitaCampanhas: z.boolean().default(false),
  politicaVersao: z.string().trim().min(1).max(20),
});
export type TotemCadastroCorpo = z.infer<typeof TotemCadastroCorpoSchema>;

/** O cupom como a tela do cadastro o mostra. Nada do cliente volta junto. */
export interface TotemCupomEmitido {
  codigo: string;
  /** ISO. A tela mostra em DD/MM/AAAA. */
  validoAte: string;
  chamada: string;
  beneficio: string;
  detalhe: string | null;
}

/**
 * Por que o cadastro voltou sem cupom: nenhuma campanha valendo na loja, ou o
 * cupom desta campanha já foi usado, venceu ou foi cancelado (é um por cliente
 * por campanha). `consulte_atendente` é o CPF já cadastrado com outro celular:
 * nada é gravado e a resposta não diz em que pé está o cupom do titular.
 */
export const TOTEM_MOTIVOS_SEM_CUPOM = [
  'sem_campanha',
  'cupom_usado',
  'cupom_vencido',
  'cupom_cancelado',
  'consulte_atendente',
] as const;
export type TotemMotivoSemCupom = (typeof TOTEM_MOTIVOS_SEM_CUPOM)[number];

export interface TotemCadastroResposta {
  cupom: TotemCupomEmitido | null;
  motivoSemCupom: TotemMotivoSemCupom | null;
}

/** `GET /api/totem-cadastro/politica`: o texto preenchido e se o cadastro está aberto. */
export interface TotemPoliticaResposta extends TotemPolitica {
  cadastroLigado: boolean;
}

// --- Benefício e validade ---

export interface TotemBeneficio {
  tipoBeneficio: string;
  valorBeneficio: number | null;
  descricaoBeneficio: string | null;
}

const numeroBR = (n: number, casas: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: 2 });

/** "10% de desconto", "R$ 15,00 de desconto" ou a descrição do brinde. */
export function totemTextoDoBeneficio(b: TotemBeneficio): string {
  if (b.tipoBeneficio === 'percentual' && b.valorBeneficio != null) return `${numeroBR(b.valorBeneficio, 0)}% de desconto`;
  if (b.tipoBeneficio === 'valor' && b.valorBeneficio != null) return `R$ ${numeroBR(b.valorBeneficio, 2)} de desconto`;
  return b.descricaoBeneficio?.trim() || 'Brinde';
}

/** A linha de detalhe do benefício; no brinde a descrição já é o benefício. */
export function totemDetalheDoBeneficio(b: TotemBeneficio): string | null {
  if (b.tipoBeneficio === 'brinde') return null;
  return b.descricaoBeneficio?.trim() || null;
}

/**
 * O cupom vale até o fim do dia (horário de Brasília, UTC−3 fixo desde 2019)
 * em que se completam `validadeDias` dias da emissão: quem recebe o cupom num
 * sábado à noite com 7 dias de prazo usa até o sábado seguinte, o dia inteiro.
 */
export function totemValidoAte(emitidoEm: Date, validadeDias: number): Date {
  const brasilia = new Date(emitidoEm.getTime() - 3 * 3_600_000);
  const fimDoDia = Date.UTC(
    brasilia.getUTCFullYear(),
    brasilia.getUTCMonth(),
    brasilia.getUTCDate() + validadeDias,
    23,
    59,
    59,
    999,
  );
  return new Date(fimDoDia + 3 * 3_600_000);
}

/** `emitido` com o prazo passado é `expirado`, mesmo que o banco ainda não diga. */
export function totemStatusEfetivoDoCupom(
  status: string,
  validoAte: Date | string,
  agora: Date = new Date(),
): TotemStatusCupom {
  const prazo = typeof validoAte === 'string' ? new Date(validoAte) : validoAte;
  if (status === 'emitido' && prazo.getTime() < agora.getTime()) return 'expirado';
  return status as TotemStatusCupom;
}

export const TOTEM_ROTULO_DO_STATUS_CUPOM: Record<TotemStatusCupom, string> = {
  emitido: 'Válido',
  usado: 'Já usado',
  expirado: 'Vencido',
  cancelado: 'Cancelado',
};

// --- Campanhas (painel) ---

const dataHora = z.string().datetime({ offset: true, message: 'Data inválida.' });

const textoOpcional = (max: number, mensagem: string) =>
  z
    .string()
    .trim()
    .max(max, mensagem)
    .nullish()
    .transform((v) => (v === '' ? null : v));

/*
 * A campanha é um banner da tela inicial do totem. A ação diz o que o botão faz:
 * `cadastro` abre o cadastro e emite cupom (só ela tem benefício e validade),
 * `produtos` abre a lista escolhida e `nenhuma` só divulga.
 */
const TotemCampanhaCampos = z.object({
  nome: z.string().trim().min(2, 'Dê um nome à campanha.').max(80, 'O nome pode ter até 80 letras.'),
  chamada: z
    .string()
    .trim()
    .min(2, 'Escreva a chamada que o cliente vê no totem.')
    .max(140, 'A chamada pode ter até 140 letras.'),
  acao: TotemAcaoCampanhaSchema.default('cadastro'),
  textoApoio: textoOpcional(240, 'O texto de apoio pode ter até 240 letras.'),
  textoBotao: textoOpcional(30, 'O texto do botão pode ter até 30 letras.'),
  imagemUrl: TotemUrlDeImagemSchema,
  produtoIds: z
    .array(z.string().uuid('Produto inválido.'))
    .max(TOTEM_PRODUTOS_POR_CAMPANHA, `Escolha no máximo ${TOTEM_PRODUTOS_POR_CAMPANHA} produtos.`)
    .optional()
    .transform((v) => (v ? [...new Set(v)] : v)),
  /** Menor aparece primeiro no carrossel. */
  ordem: z.number().int('A ordem é um número inteiro.').min(0).max(999).optional(),
  tipoBeneficio: TotemTipoBeneficioSchema.nullish(),
  valorBeneficio: z.number().positive('O valor do benefício tem de ser maior que zero.').max(100_000).nullish(),
  descricaoBeneficio: z.string().trim().max(200, 'A descrição pode ter até 200 letras.').nullish(),
  validadeDias: z
    .number()
    .int('A validade é um número inteiro de dias.')
    .min(1, 'O cupom vale pelo menos 1 dia.')
    .max(365, 'O cupom vale no máximo 365 dias.')
    .nullish(),
  inicioEm: dataHora.optional(),
  fimEm: dataHora.nullish(),
  ativa: z.boolean().optional(),
  /** Vazio quer dizer todas as lojas. */
  lojaIds: z.array(z.string().uuid('Loja inválida.')).max(500).optional(),
});

/**
 * A regra que liga os campos entre si: a de cadastro tem benefício e validade
 * (percentual entre 0 e 100, valor maior que zero, brinde com descrição), a de
 * produtos tem pelo menos um produto, e o fim vem depois do início. Fica fora
 * do schema porque a edição é parcial e a API confere a campanha já mesclada.
 */
export function totemProblemaDaCampanha(c: {
  acao?: string | null;
  tipoBeneficio?: string | null;
  valorBeneficio?: number | null;
  descricaoBeneficio?: string | null;
  validadeDias?: number | null;
  produtoIds?: readonly string[] | null;
  inicioEm?: string | Date | null;
  fimEm?: string | Date | null;
}): string | null {
  const acao = c.acao ?? 'cadastro';
  if (acao === 'cadastro') {
    const problema = problemaDoBeneficio(c);
    if (problema) return problema;
  }
  if (acao === 'produtos' && !c.produtoIds?.length) return 'Escolha pelo menos um produto para a campanha mostrar.';
  if (c.inicioEm && c.fimEm && new Date(c.fimEm).getTime() <= new Date(c.inicioEm).getTime()) {
    return 'O fim da campanha tem de vir depois do início.';
  }
  return null;
}

function problemaDoBeneficio(c: {
  tipoBeneficio?: string | null;
  valorBeneficio?: number | null;
  descricaoBeneficio?: string | null;
  validadeDias?: number | null;
}): string | null {
  if (!c.tipoBeneficio) return 'Na campanha de cadastro, escolha o benefício do cupom.';
  if (c.validadeDias == null) return 'Na campanha de cadastro, informe por quantos dias o cupom vale.';
  if (c.tipoBeneficio === 'percentual' && (c.valorBeneficio == null || c.valorBeneficio > 100)) {
    return 'No desconto em percentual, informe um valor entre 1 e 100.';
  }
  if (c.tipoBeneficio === 'valor' && c.valorBeneficio == null) return 'No desconto em reais, informe o valor.';
  if (c.tipoBeneficio === 'brinde' && !c.descricaoBeneficio?.trim()) return 'Descreva o brinde.';
  return null;
}

export const TotemCampanhaCriarSchema = TotemCampanhaCampos.superRefine((c, ctx) => {
  const problema = totemProblemaDaCampanha(c);
  if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problema });
});
export type TotemCampanhaCriar = z.infer<typeof TotemCampanhaCriarSchema>;

export const TotemCampanhaEditarSchema = TotemCampanhaCampos.partial();
export type TotemCampanhaEditar = z.infer<typeof TotemCampanhaEditarSchema>;

/** O produto da lista de uma campanha, com o que a tela precisa para mostrá-lo. */
export interface TotemProdutoDaCampanha {
  id: string;
  codigo: string;
  nome: string;
  imagemUrl: string | null;
}

export interface TotemCampanhaResumo {
  id: string;
  nome: string;
  chamada: string;
  acao: TotemAcaoCampanha;
  textoApoio: string | null;
  textoBotao: string | null;
  imagemUrl: string | null;
  produtoIds: string[];
  /** Os mesmos produtos, na ordem escolhida; o que foi apagado do catálogo some daqui. */
  produtos: TotemProdutoDaCampanha[];
  ordem: number;
  tipoBeneficio: TotemTipoBeneficio | null;
  valorBeneficio: number | null;
  descricaoBeneficio: string | null;
  /** Só na ação `cadastro`. */
  beneficio: string | null;
  validadeDias: number | null;
  inicioEm: string;
  fimEm: string | null;
  ativa: boolean;
  /** Ativa e dentro do período agora. */
  vigente: boolean;
  lojaIds: string[];
  cupons: { emitidos: number; usados: number };
}

// --- Clientes (painel) ---

const vazioViraAusente = (v: unknown) => (v === '' || v === null ? undefined : v);

export const TotemClientesFiltroSchema = z.object({
  pagina: z.coerce.number().int().min(1).max(100_000).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(25),
  lojaId: z.preprocess(vazioViraAusente, z.string().uuid('Loja inválida.').optional()),
});
export type TotemClientesFiltro = z.infer<typeof TotemClientesFiltroSchema>;

/** A busca por CPF vai no corpo de um POST: CPF em query string fica no log de acesso. */
export const TotemClienteLocalizarSchema = z.object({ cpf: cpfSchema });

/**
 * O pedido de revogação que chega pelo encarregado. `campanhas` tira só a
 * permissão de mandar oferta; `tudo` revoga o cadastro inteiro, e o cliente é
 * anonimizado, como a política promete.
 */
export const TotemRevogarSchema = z.object({
  alcance: z.enum(['campanhas', 'tudo'], { errorMap: () => ({ message: 'Escolha o que revogar.' }) }),
});
export type TotemRevogar = z.infer<typeof TotemRevogarSchema>;

/** A resposta de "anonimizar quem passou do prazo sem uso". */
export interface TotemAnonimizacaoEmLote {
  anonimizados: number;
  /** ISO. Cadastro sem uso desde antes desta data foi anonimizado. */
  limite: string;
}

export interface TotemLojaRef {
  id: string;
  nome: string;
}

export interface TotemClienteLinha {
  id: string;
  cpfMascarado: string;
  telefoneMascarado: string | null;
  lojaOrigem: TotemLojaRef | null;
  canalOrigem: string;
  aceitaCampanhas: boolean;
  anonimizado: boolean;
  criadoEm: string;
  totalDeCupons: number;
}

export interface TotemClientePagina {
  itens: TotemClienteLinha[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface TotemConsentimentoLinha {
  id: string;
  politicaVersao: string;
  finalidades: string[];
  canal: string;
  loja: TotemLojaRef | null;
  aceitoEm: string;
  revogadoEm: string | null;
}

export interface TotemCupomLinha {
  codigo: string;
  status: TotemStatusCupom;
  campanha: string;
  beneficio: string;
  emitidoEm: string;
  validoAte: string;
  usadoEm: string | null;
  usadoLoja: TotemLojaRef | null;
}

export interface TotemClienteDetalhe extends TotemClienteLinha {
  nome: string | null;
  anonimizadoEm: string | null;
  consentimentos: TotemConsentimentoLinha[];
  cupons: TotemCupomLinha[];
}

// --- Cupons (caixa) ---

export const TotemCupomBaixaSchema = z.object({
  lojaId: z.string({ required_error: 'Escolha a loja do caixa.' }).uuid('Escolha a loja do caixa.'),
});
export type TotemCupomBaixa = z.infer<typeof TotemCupomBaixaSchema>;

export interface TotemCupomDetalhe extends TotemCupomLinha {
  chamada: string;
  detalhe: string | null;
  /** `todas` ou as lojas onde o cupom pode ser usado. */
  lojasValidas: 'todas' | TotemLojaRef[];
}

export interface TotemLojaDoEscopo {
  id: string;
  codigo: string;
  nome: string;
  ativa: boolean;
}

/** Meses sem uso depois dos quais o cadastro é anonimizado (política, seção "Por quanto tempo"). */
export const TOTEM_MESES_ATE_ANONIMIZAR = 24;

/** O `:id` de cliente e de campanha nas rotas do painel. */
export const TotemCadastroIdSchema = z.string().uuid('Não encontramos este registro.');
