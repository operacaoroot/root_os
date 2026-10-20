import { z } from 'zod';

/*
 * O WHATSAPP PELO DIGISAC em Conexões (Interface 20/10, lane U6).
 *
 * O cartão "WhatsApp (DigiSac)" e a API leem os mesmos tipos. O token e o
 * segredo do webhook entram por `DigisacCredencialSchema` e NUNCA voltam: a
 * conexão devolve só se há token guardado, quando foi trocado e se há segredo.
 */

/** Uma conexão (o "serviço") da conta do DigiSac. */
export interface ServicoDoDigisac {
  id: string;
  nome: string;
  /** `whatsapp`, `whatsapp-business`, `telegram`, `email`... como o DigiSac escreve. */
  tipo: string | null;
  arquivado: boolean;
}

/** De onde veio a credencial em uso: o cofre da empresa ou o ambiente da casa. */
export type OrigemDaCredencialDigisac = 'cofre' | 'ambiente' | 'nenhuma';

/** O estado que o cartão de Integrações mostra. Nunca leva o token nem o segredo. */
export interface ConexaoDoDigisac {
  origem: OrigemDaCredencialDigisac;
  /** A conta (só o endereço base, sem caminho). Não é segredo: a tela mostra para conferir. */
  url: string | null;
  servicoId: string | null;
  tokenGuardado: boolean;
  tokenRevogadoEm: string | null;
  tokenAtualizadoEm: string | null;
  /** Há segredo de webhook valendo para esta empresa (do cofre ou do ambiente da casa). */
  segredoDoWebhook: boolean;
  /** O caminho da entrada (a tela soma a origem pública). */
  caminhoDoWebhook: string;
  /** O parâmetro em que o segredo viaja: o formulário de webhook do DigiSac não tem cabeçalho próprio. */
  parametroDoSegredo: string;
  /** O cabeçalho aceito quando há um intermediário que o injeta. */
  cabecalhoDoSegredo: string;
  desligado: boolean;
}

/** O tamanho mínimo do segredo do webhook (o mesmo piso dos segredos do canal de aprovação). */
export const DIGISAC_SEGREDO_MINIMO = 32;

/** O que o cartão manda para guardar no cofre. Token e segredo são opcionais quando já existem. */
export const DigisacCredencialSchema = z
  .object({
    url: z.string().trim().min(8).max(200),
    token: z.string().trim().max(4000).optional(),
    servicoId: z.string().trim().min(1).max(120),
    segredoDoWebhook: z
      .string()
      .trim()
      .min(DIGISAC_SEGREDO_MINIMO, `o segredo do webhook precisa de pelo menos ${DIGISAC_SEGREDO_MINIMO} caracteres`)
      .max(200)
      .optional(),
  })
  .strict();
export type DigisacCredencialInput = z.infer<typeof DigisacCredencialSchema>;
