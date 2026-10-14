import { z } from 'zod';

// ---------- Painel da operação da Root ----------
// A rodada semanal (`painel-root-semanal`, segundas às 8h) cruza vault, ClickUp,
// WhatsApp e Gmail e escreve `Root/11-operacao/painel-root.md`. O mesmo conteúdo
// sai em JSON e entra aqui por script: a tela só lê. O painel é de quem opera a
// PLATAFORMA — empresa cliente nunca o vê (ver `SessaoDaPlataformaGuard`).
//
// Valor em centavos e texto lado a lado: a conta da tela usa os centavos, e o
// texto preserva a ressalva da fonte ("~R$ 2.970,00", "v5") que um número sozinho
// apagaria.

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const OPERACAO_TAMANHO_MAXIMO_EM_BYTES = 256_000;

const texto = z.string().trim().min(1).max(2_000);
const textoCurto = z.string().trim().min(1).max(300);
const data = z.string().regex(DATA, 'data no formato AAAA-MM-DD');
const lista = <T extends z.ZodTypeAny>(item: T, max = 60) => z.array(item).max(max);

export const OPERACAO_ESTADOS = ['ok', 'atencao', 'erro', 'neutro'] as const;
export type OperacaoEstado = (typeof OPERACAO_ESTADOS)[number];

export const OperacaoDataSchema = data;

export const OperacaoPainelSchema = z
  .object({
    versao: z.literal(1),
    rodadaEm: data,
    proximaEm: data.nullable(),
    notaFonte: textoCurto,
    fontes: lista(textoCurto, 30),
    lacunas: lista(texto, 30),
    mudancas: lista(texto, 60),
    tamanho: lista(
      z.object({
        grupo: textoCurto,
        brutas: z.number().int().min(0),
        acionaveis: z.number().int().min(0),
      }),
      40,
    ),
    dinheiro: z.object({
      fechado: lista(
        z.object({
          cliente: textoCurto,
          valorCentavos: z.number().int().min(0),
          valorTexto: textoCurto,
          fonte: textoCurto,
          recebimento: texto,
          confirmado: z.boolean(),
        }),
      ),
      emAberto: lista(
        z.object({
          cliente: textoCurto,
          valorCentavos: z.number().int().min(0),
          valorTexto: textoCurto,
          situacao: texto,
          estimado: z.boolean(),
        }),
      ),
    }),
    ondas: lista(
      z.object({
        numero: z.number().int().min(0).max(20),
        titulo: textoCurto,
        prazo: data.nullable(),
        itens: lista(
          z.object({
            texto,
            detalhe: texto.nullable(),
            cliente: textoCurto.nullable(),
            prazo: data.nullable(),
            feito: z.boolean(),
          }),
          80,
        ),
      }),
      10,
    ),
    clientes: lista(
      z.object({
        chave: z.string().regex(/^[a-z0-9-]{1,60}$/),
        nome: textoCurto,
        contato: textoCurto,
        valorTexto: textoCurto,
        estado: z.enum(OPERACAO_ESTADOS),
        motivo: texto,
        feito: lista(texto),
        fazer: lista(z.object({ texto, feito: z.boolean() })),
        cobrar: lista(texto),
        decidir: lista(texto),
      }),
      40,
    ),
    leads: lista(
      z.object({
        nome: textoCurto,
        ultimoMovimento: data.nullable(),
        falta: texto,
      }),
    ),
    interno: lista(texto),
    decisoes: lista(z.object({ texto, decidida: z.boolean() }), 20),
    padrao: lista(texto, 20),
  })
  .strict();

export type OperacaoPainelConteudo = z.infer<typeof OperacaoPainelSchema>;

export const OperacaoPainelConsultaSchema = z
  .object({ rodada: data.optional() })
  .strict();

export interface OperacaoPainelResposta {
  /** Nulo quando nenhuma rodada foi importada ainda. */
  rodada: string | null;
  /** Todas as rodadas importadas, da mais recente para a mais antiga. */
  rodadas: string[];
  importadaEm: string | null;
  conteudo: OperacaoPainelConteudo | null;
}
