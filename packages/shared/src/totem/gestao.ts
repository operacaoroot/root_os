import { z } from 'zod';

import {
  TOTEM_SELOS,
  TOTEM_TERMO_MAXIMO,
  TotemNutricionalSchema,
  TotemSeloSchema,
  TotemTipoEventoSchema,
  TotemUnidadePrecoSchema,
  type TotemNutriente,
  type TotemSelo,
  type TotemTipoEvento,
  type TotemUnidadePreco,
} from './comum.js';

/*
 * Schemas e tipos do painel do Totem (`/api/totem-gestao`, `/totem-gestao`).
 * Arquivo da frente A (docs/totem/CONTRATO.md, seção 9). Nome exportado começa
 * com `Totem` ou `TOTEM_`: ver o cabeçalho de `comum.ts`. O prefixo `TotemGestao`
 * evita que um `TotemIdSchema` daqui e outro de outra frente colidam na junção.
 */

/** Texto livre que pode ser apagado: `''` vira `null`, ausente continua ausente. */
const textoLivre = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

/** Endereço de imagem: só https, para o totem não carregar conteúdo misto. */
const urlDeImagem = z
  .string()
  .trim()
  .max(500, 'O endereço da imagem é longo demais.')
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v == null || /^https:\/\/\S+$/.test(v), 'O endereço da imagem precisa começar com https://.');

const corHex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Informe a cor no formato #RRGGBB.')
  .transform((v) => v.toUpperCase());

/** Dia no formato do `<input type="date">`; o servidor lê no fuso de São Paulo. */
const diaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.');

export const TotemGestaoIdSchema = z.string().uuid('Identificador inválido.');

/** Página e tamanho de página vindos da query string. */
const paginacao = (padrao: number, maximo: number) => ({
  pagina: z.coerce.number().int().min(1).max(100_000).default(1),
  porPagina: z.coerce.number().int().min(1).max(maximo).default(padrao),
});

// --- Lojas ---

export const TotemGestaoLojaCriarSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(1, 'Informe o código da loja.')
    .max(20, 'O código da loja tem no máximo 20 caracteres.')
    .regex(/^[A-Za-z0-9_-]+$/, 'O código da loja usa só letras, números, hífen e sublinhado.')
    .transform((v) => v.toUpperCase()),
  nome: z.string().trim().min(2, 'Informe o nome da loja.').max(120, 'O nome da loja tem no máximo 120 caracteres.'),
  cidade: textoLivre(80),
  endereco: textoLivre(200),
});
export type TotemGestaoLojaCriar = z.infer<typeof TotemGestaoLojaCriarSchema>;

export const TotemGestaoLojaEditarSchema = TotemGestaoLojaCriarSchema.partial()
  .extend({ ativa: z.boolean().optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar.');
export type TotemGestaoLojaEditar = z.infer<typeof TotemGestaoLojaEditarSchema>;

export const TotemGestaoLojasQuerySchema = z.object({
  situacao: z.enum(['ativas', 'todas']).default('todas'),
});

export interface TotemGestaoLoja {
  id: string;
  codigo: string;
  nome: string;
  cidade: string | null;
  endereco: string | null;
  ativa: boolean;
  exemplo: boolean;
  /** Totens não revogados da loja. */
  totens: number;
  criadoEm: string;
}

// --- Usuários e vínculos com loja ---

export const TotemGestaoVinculoSchema = z.object({ lojaId: TotemGestaoIdSchema });

export interface TotemGestaoUsuario {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  papeis: { chave: string; nome: string }[];
  /** Algum papel dá permissão `totem.*`: sem isso o vínculo com loja não abre nada. */
  acessoAoTotem: boolean;
  /** Algum papel dá `totem.rede`: a pessoa vê todas as lojas sem vínculo. */
  redeInteira: boolean;
  lojaIds: string[];
}

// --- Dispositivos (totens) ---

/** Totem visto há menos que isto conta como ligado no painel. */
export const TOTEM_GESTAO_MINUTOS_ONLINE = 10;

export const TOTEM_GESTAO_ESTADOS_DISPOSITIVO = [
  'online',
  'offline',
  'aguardando_ativacao',
  'codigo_expirado',
  'revogado',
] as const;
export type TotemGestaoEstadoDispositivo = (typeof TOTEM_GESTAO_ESTADOS_DISPOSITIVO)[number];

export const TOTEM_GESTAO_ROTULO_ESTADO: Record<TotemGestaoEstadoDispositivo, string> = {
  online: 'Ligado',
  offline: 'Sem sinal',
  aguardando_ativacao: 'Aguardando ativação',
  codigo_expirado: 'Código vencido',
  revogado: 'Revogado',
};

const nomeDoTotem = z
  .string()
  .trim()
  .min(2, 'Dê um nome ao totem, por exemplo "Entrada".')
  .max(80, 'O nome do totem tem no máximo 80 caracteres.');

export const TotemGestaoDispositivoCriarSchema = z.object({ lojaId: TotemGestaoIdSchema, nome: nomeDoTotem });
export type TotemGestaoDispositivoCriar = z.infer<typeof TotemGestaoDispositivoCriarSchema>;

export const TotemGestaoDispositivoRenomearSchema = z.object({ nome: nomeDoTotem });

export const TotemGestaoDispositivosQuerySchema = z.object({ lojaId: TotemGestaoIdSchema.optional() });

export interface TotemGestaoDispositivo {
  id: string;
  lojaId: string;
  lojaNome: string;
  nome: string;
  estado: TotemGestaoEstadoDispositivo;
  ativadoEm: string | null;
  vistoEm: string | null;
  revogadoEm: string | null;
  /** Só enquanto há código de ativação pendente. */
  ativacaoExpiraEm: string | null;
  versaoApp: string | null;
  catalogoVersao: string | null;
  criadoEm: string;
}

/**
 * Resposta de criar o totem e de gerar código novo. É a ÚNICA vez que o código
 * sai em claro: o banco guarda só o SHA-256.
 */
export interface TotemGestaoCodigoAtivacao {
  dispositivo: TotemGestaoDispositivo;
  codigo: string;
  expiraEm: string;
}

// --- Produtos ---

export const TOTEM_GESTAO_AVISO_PRECO_DESLIGADO =
  'O preço não aparece no totem enquanto a exibição de preço estiver desligada na configuração.';

const produtoBase = z.object({
  codigo: z
    .string()
    .trim()
    .min(1, 'Informe o código do produto.')
    .max(40, 'O código do produto tem no máximo 40 caracteres.'),
  codigoDirector: textoLivre(40),
  nome: z.string().trim().min(2, 'Informe o nome do produto.').max(160, 'O nome tem no máximo 160 caracteres.'),
  categoria: textoLivre(80),
  composicao: textoLivre(2000),
  beneficios: textoLivre(2000),
  alergenicos: textoLivre(1000),
  porcaoG: z.number().positive('A porção precisa ser maior que zero.').max(100_000).nullable().optional(),
  porcaoDescricao: textoLivre(120),
  nutricional: TotemNutricionalSchema.optional(),
  selos: z
    .array(TotemSeloSchema)
    .max(TOTEM_SELOS.length)
    .optional()
    .transform((v) => (v ? [...new Set(v)] : v)),
  validadeDiasPadrao: z
    .number()
    .int('A validade padrão é um número inteiro de dias.')
    .min(1)
    .max(3650)
    .nullable()
    .optional(),
  precoCentavos: z
    .number()
    .int('O preço vai em centavos, sem casas decimais.')
    .min(0, 'O preço não pode ser negativo.')
    .max(100_000_000)
    .nullable()
    .optional(),
  unidadePreco: TotemUnidadePrecoSchema.nullable().optional(),
  imagemUrl: urlDeImagem,
  fonteNutricional: textoLivre(500),
  ativo: z.boolean().optional(),
});

export const TotemGestaoProdutoCriarSchema = produtoBase;
export type TotemGestaoProdutoCriar = z.infer<typeof TotemGestaoProdutoCriarSchema>;

export const TotemGestaoProdutoEditarSchema = produtoBase
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para alterar.');
export type TotemGestaoProdutoEditar = z.infer<typeof TotemGestaoProdutoEditarSchema>;

export const TotemGestaoProdutosQuerySchema = z.object({
  busca: z.string().trim().max(TOTEM_TERMO_MAXIMO).optional(),
  situacao: z.enum(['ativos', 'inativos', 'todos']).default('todos'),
  ...paginacao(25, 100),
});
export type TotemGestaoProdutosQuery = z.infer<typeof TotemGestaoProdutosQuerySchema>;

export interface TotemGestaoProduto {
  id: string;
  codigo: string;
  codigoDirector: string | null;
  nome: string;
  nomeBusca: string;
  categoria: string | null;
  composicao: string | null;
  beneficios: string | null;
  alergenicos: string | null;
  porcaoG: number | null;
  porcaoDescricao: string | null;
  nutricional: TotemNutriente[];
  selos: TotemSelo[];
  validadeDiasPadrao: number | null;
  precoCentavos: number | null;
  unidadePreco: TotemUnidadePreco | null;
  imagemUrl: string | null;
  ativo: boolean;
  exemplo: boolean;
  fonteNutricional: string | null;
  atualizadoEm: string;
}

/** O aviso de preço vai junto de todo produto que o painel devolve. */
export interface TotemGestaoAvisoDePreco {
  precoLigado: boolean;
  /** Preenchido quando `precoLigado` é `false`. */
  avisoPreco: string | null;
}

export interface TotemGestaoProdutosPagina extends TotemGestaoAvisoDePreco {
  itens: TotemGestaoProduto[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface TotemGestaoProdutoResposta extends TotemGestaoAvisoDePreco {
  produto: TotemGestaoProduto;
}

// --- Configuração ---

export const TotemGestaoConfigSchema = z.object({
  nomeExibicao: z.string().trim().min(2, 'Informe o nome que aparece no totem.').max(80),
  corPrimaria: corHex,
  corFundo: corHex,
  logoUrl: urlDeImagem,
  precoLigado: z.boolean(),
  cadastroLigado: z.boolean(),
  tempoOciosoSeg: z
    .number()
    .int()
    .min(15, 'O totem volta ao início depois de pelo menos 15 segundos.')
    .max(600, 'O totem volta ao início depois de no máximo 10 minutos.'),
  controladorNome: z.string().trim().min(2, 'Informe quem é o controlador dos dados.').max(160),
  controladorDocumento: textoLivre(30),
  controladorEndereco: textoLivre(240),
  encarregadoNome: textoLivre(120),
  encarregadoContato: textoLivre(160),
  mensagemBoasVindas: textoLivre(240),
});
export type TotemGestaoConfigEntrada = z.infer<typeof TotemGestaoConfigSchema>;

export interface TotemGestaoConfig {
  /** `false` enquanto ninguém salvou: os campos são os valores padrão. */
  existe: boolean;
  nomeExibicao: string;
  corPrimaria: string;
  corFundo: string;
  logoUrl: string | null;
  precoLigado: boolean;
  cadastroLigado: boolean;
  tempoOciosoSeg: number;
  controladorNome: string;
  controladorDocumento: string | null;
  controladorEndereco: string | null;
  encarregadoNome: string | null;
  encarregadoContato: string | null;
  politicaVersao: string;
  mensagemBoasVindas: string | null;
  atualizadoEm: string | null;
}

// --- Resumo do painel ---

export const TotemGestaoResumoQuerySchema = z.object({ lojaId: TotemGestaoIdSchema.optional() });

export interface TotemGestaoIndicadores {
  totensOnline: number;
  totensOffline: number;
  totensAguardando: number;
  ultimaSincronizacao: string | null;
  buscasHoje: number;
  buscas7Dias: number;
  cadastrosHoje: number;
  produtosSemLote: number;
  lotesVencidos: number;
  lotesAVencer: number;
}

export interface TotemGestaoResumoLoja {
  lojaId: string;
  codigo: string;
  nome: string;
  ativa: boolean;
  indicadores: TotemGestaoIndicadores;
}

export interface TotemGestaoAlertaLote {
  lojaId: string;
  lojaNome: string;
  produtoId: string;
  produtoNome: string;
  loteCodigo: string;
  /** Dia de vencimento, `AAAA-MM-DD`. */
  validadeEm: string;
  /** Lote deduzido de remessa ainda não confirmada pela loja. */
  presumido: boolean;
}

export interface TotemGestaoProdutoSemLote {
  lojaId: string;
  lojaNome: string;
  produtoId: string;
  produtoNome: string;
}

export interface TotemGestaoTermoSemResultado {
  termo: string;
  vezes: number;
}

/** Quantos itens de cada lista detalhada o resumo devolve; os totais contam tudo. */
export const TOTEM_GESTAO_LIMITE_LISTA_RESUMO = 50;

export interface TotemGestaoResumo {
  geradoEm: string;
  redeInteira: boolean;
  lojaFiltrada: string | null;
  /** As lojas que o usuário pode escolher no filtro. */
  lojasDoEscopo: { id: string; codigo: string; nome: string; ativa: boolean }[];
  total: TotemGestaoIndicadores;
  porLoja: TotemGestaoResumoLoja[];
  /** Os 10 termos mais buscados sem resultado nos últimos 7 dias. */
  termosSemResultado: TotemGestaoTermoSemResultado[];
  lotesVencidos: TotemGestaoAlertaLote[];
  lotesAVencer: TotemGestaoAlertaLote[];
  produtosSemLote: TotemGestaoProdutoSemLote[];
}

// --- Eventos ---

export const TotemGestaoEventosQuerySchema = z
  .object({
    lojaId: TotemGestaoIdSchema.optional(),
    tipo: TotemTipoEventoSchema.optional(),
    de: diaIso.optional(),
    ate: diaIso.optional(),
    ...paginacao(50, 200),
  })
  .refine((v) => !v.de || !v.ate || v.de <= v.ate, {
    message: 'A data inicial precisa ser anterior à final.',
    path: ['ate'],
  });
export type TotemGestaoEventosQuery = z.infer<typeof TotemGestaoEventosQuerySchema>;

export const TOTEM_GESTAO_ROTULO_EVENTO: Record<TotemTipoEvento, string> = {
  busca: 'Busca',
  busca_sem_resultado: 'Busca sem resultado',
  ver_produto: 'Ficha aberta',
  cadastro: 'Cadastro',
  sincronizou: 'Sincronização',
  qr_aberto: 'QR da etiqueta aberto',
};

export interface TotemGestaoEvento {
  id: string;
  tipo: string;
  lojaId: string | null;
  lojaNome: string | null;
  dispositivoId: string | null;
  dispositivoNome: string | null;
  produtoId: string | null;
  produtoNome: string | null;
  termo: string | null;
  ocorridoEm: string;
}

export interface TotemGestaoEventosPagina {
  itens: TotemGestaoEvento[];
  total: number;
  pagina: number;
  porPagina: number;
}
