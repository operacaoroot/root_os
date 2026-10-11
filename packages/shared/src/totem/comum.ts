import { z } from 'zod';

/*
 * O vocabulário comum do módulo Totem (docs/totem/CONTRATO.md). Este arquivo é
 * da base; cada frente tem o seu (`gestao`, `publico`, `lote`, `cadastro`,
 * `politica`). Todos saem pelo `index.ts` com `export *`, então NOME EXPORTADO
 * COMEÇA COM `Totem`, `TOTEM_` ou `totem`: dois arquivos exportando o mesmo
 * nome derrubam o build do pacote na junção das frentes.
 */

// --- Busca ---

/**
 * O texto como a busca do totem compara: minúsculo, sem acento, com pontuação
 * e hífen virando espaço e um espaço só entre as palavras ("Castanha-do-Pará"
 * vira "castanha do para"). É a mesma função que grava
 * `TotemProduto.nomeBusca` na API e que normaliza o que o cliente digita no
 * aparelho; se as duas pontas normalizassem diferente, "pão" não acharia "pao".
 */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// --- Códigos (base32 de Crockford) ---

/** Sem I, L, O e U: nenhuma letra que se confunda com número ao ler ou ditar. */
export const TOTEM_ALFABETO_CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const TOTEM_TAMANHO_CODIGO_ATIVACAO = 8;
export const TOTEM_TAMANHO_CODIGO_ETIQUETA = 10;
export const TOTEM_TAMANHO_CODIGO_CUPOM = 8;

/**
 * Leva o que a pessoa digitou para a forma canônica do código: maiúsculo, sem
 * hífen nem espaço, com O lido como 0 e I/L como 1 (a regra de Crockford). Quem
 * compara código sempre passa por aqui antes de calcular hash ou buscar.
 */
export function totemNormalizarCodigo(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

const crockford = (n: number) => new RegExp(`^[0-9A-HJKMNP-TV-Z]{${n}}$`);

const codigoCrockford = (n: number, rotulo: string) =>
  z
    .string()
    .trim()
    .max(n * 2, `O ${rotulo} tem ${n} caracteres.`)
    .transform(totemNormalizarCodigo)
    .refine((v) => crockford(n).test(v), `O ${rotulo} tem ${n} letras ou números.`);

export const TotemCodigoAtivacaoSchema = codigoCrockford(TOTEM_TAMANHO_CODIGO_ATIVACAO, 'código de ativação');
export const TotemCodigoEtiquetaSchema = codigoCrockford(TOTEM_TAMANHO_CODIGO_ETIQUETA, 'código da etiqueta');
export const TotemCodigoCupomSchema = codigoCrockford(TOTEM_TAMANHO_CODIGO_CUPOM, 'código do cupom');

/** 32 bytes em base64url sem preenchimento: sempre 43 caracteres. */
export const TotemTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Token do totem inválido.');

/** O cabeçalho em que o totem manda o token do aparelho. */
export const TOTEM_CABECALHO_TOKEN = 'x-totem-token';

/**
 * O cabeçalho em que o celular manda o código da etiqueta lida pelo QR, quando
 * é ela a credencial (cadastro aberto por `/p/<codigo>`). Cabeçalho e não query
 * para o código não ficar no log de acesso de cada proxy do caminho.
 */
export const TOTEM_CABECALHO_ETIQUETA = 'x-totem-etiqueta';

// --- Prazos e limites ---

/** Lote a esta distância ou menos do vencimento entra no painel como atenção. */
export const TOTEM_DIAS_ATENCAO_VALIDADE = 15;
export const TOTEM_MINUTOS_VALIDADE_ATIVACAO = 30;
export const TOTEM_MINUTOS_SINCRONIZACAO = 5;
export const TOTEM_TEMPO_OCIOSO_PADRAO_SEG = 60;
export const TOTEM_TERMO_MAXIMO = 80;

/** Limite por origem e por hora de cada rota pública (CONTRATO.md, seção 6). */
export const TOTEM_TETOS_POR_HORA = {
  ativacao: 20,
  cadastro: 30,
  etiqueta: 600,
  catalogo: 1200,
  eventos: 1200,
} as const;
export type TotemTeto = keyof typeof TOTEM_TETOS_POR_HORA;

// --- Selos ---

export const TOTEM_SELOS = [
  'vegano',
  'vegetariano',
  'sem_gluten',
  'sem_lactose',
  'organico',
  'integral',
  'sem_acucar',
  'sem_conservantes',
] as const;
export const TotemSeloSchema = z.enum(TOTEM_SELOS);
export type TotemSelo = z.infer<typeof TotemSeloSchema>;

export const TOTEM_ROTULO_DO_SELO: Record<TotemSelo, string> = {
  vegano: 'Vegano',
  vegetariano: 'Vegetariano',
  sem_gluten: 'Sem glúten',
  sem_lactose: 'Sem lactose',
  organico: 'Orgânico',
  integral: 'Integral',
  sem_acucar: 'Sem açúcar',
  sem_conservantes: 'Sem conservantes',
};

// --- Ficha nutricional ---

export const TotemNutrienteSchema = z.object({
  nutriente: z.string().trim().min(1).max(60),
  quantidade: z.number().nonnegative().finite(),
  unidade: z.enum(['kcal', 'kJ', 'g', 'mg', 'mcg']),
  /** Percentual do valor diário; `null` quando não há referência. */
  vd: z.number().nonnegative().finite().nullable(),
});
export type TotemNutriente = z.infer<typeof TotemNutrienteSchema>;
export const TotemNutricionalSchema = z.array(TotemNutrienteSchema).max(40);

export const TOTEM_UNIDADES_PRECO = ['kg', '100g', 'un'] as const;
export const TotemUnidadePrecoSchema = z.enum(TOTEM_UNIDADES_PRECO);
export type TotemUnidadePreco = z.infer<typeof TotemUnidadePrecoSchema>;

// --- Estados guardados como texto no banco ---

export const TOTEM_ORIGENS_LOTE = ['producao_central', 'manual_loja'] as const;
export const TotemOrigemLoteSchema = z.enum(TOTEM_ORIGENS_LOTE);
export type TotemOrigemLote = z.infer<typeof TotemOrigemLoteSchema>;

export const TOTEM_STATUS_REMESSA = ['enviada', 'recebida', 'cancelada'] as const;
export const TotemStatusRemessaSchema = z.enum(TOTEM_STATUS_REMESSA);
export type TotemStatusRemessa = z.infer<typeof TotemStatusRemessaSchema>;

export const TOTEM_ORIGENS_REPOSICAO = ['remessa', 'manual'] as const;
export const TotemOrigemReposicaoSchema = z.enum(TOTEM_ORIGENS_REPOSICAO);
export type TotemOrigemReposicao = z.infer<typeof TotemOrigemReposicaoSchema>;

export const TOTEM_TIPOS_BENEFICIO = ['percentual', 'valor', 'brinde'] as const;
export const TotemTipoBeneficioSchema = z.enum(TOTEM_TIPOS_BENEFICIO);
export type TotemTipoBeneficio = z.infer<typeof TotemTipoBeneficioSchema>;

export const TOTEM_CANAIS = ['totem', 'qr'] as const;
export const TotemCanalSchema = z.enum(TOTEM_CANAIS);
export type TotemCanal = z.infer<typeof TotemCanalSchema>;

export const TOTEM_FINALIDADES = ['cupom', 'campanhas'] as const;
export const TotemFinalidadeSchema = z.enum(TOTEM_FINALIDADES);
export type TotemFinalidade = z.infer<typeof TotemFinalidadeSchema>;

export const TOTEM_STATUS_CUPOM = ['emitido', 'usado', 'expirado', 'cancelado'] as const;
export const TotemStatusCupomSchema = z.enum(TOTEM_STATUS_CUPOM);
export type TotemStatusCupom = z.infer<typeof TotemStatusCupomSchema>;

export const TOTEM_TIPOS_EVENTO = [
  'busca',
  'busca_sem_resultado',
  'ver_produto',
  'cadastro',
  'sincronizou',
  'qr_aberto',
] as const;
export const TotemTipoEventoSchema = z.enum(TOTEM_TIPOS_EVENTO);
export type TotemTipoEvento = z.infer<typeof TotemTipoEventoSchema>;

/** Como o totem e o painel classificam a validade de um lote. */
export type TotemSituacaoValidade = 'vencido' | 'atencao' | 'ok';

/**
 * Classifica a validade pela data do dia, sem hora: um lote que vence hoje
 * ainda não venceu. `hoje` é parâmetro para o teste e para o aparelho, que pode
 * estar sem rede e com o relógio dele.
 */
export function totemSituacaoDaValidade(validadeEm: Date | string, hoje: Date = new Date()): TotemSituacaoValidade {
  const validade = typeof validadeEm === 'string' ? new Date(validadeEm) : validadeEm;
  const dia = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dias = Math.round((dia(validade) - dia(hoje)) / 86_400_000);
  if (dias < 0) return 'vencido';
  if (dias <= TOTEM_DIAS_ATENCAO_VALIDADE) return 'atencao';
  return 'ok';
}
