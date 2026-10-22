import { z } from 'zod';

/*
 * O WHATSAPP DO COMERCIAL PELA EVOLUTION em Integrações (Rodada de produção 1,
 * 21/10/2026, P8).
 *
 * O cartão "WhatsApp (Evolution)" e a API leem os mesmos tipos. A chave da API
 * da Evolution entra por `EvolutionCredencialSchema` e NUNCA volta: a conexão
 * devolve só se há chave guardada e quando foi trocada. O QR da instância sai
 * só na resposta do pedido de QR, para quem administra a empresa.
 */

/** De onde veio a credencial em uso: o cofre da empresa ou o ambiente da casa. */
export type OrigemDaCredencialEvolution = 'cofre' | 'ambiente' | 'nenhuma';

/** O estado da instância como a Evolution responde (`open`, `connecting`, `close`), ou o que deu errado. */
export type EstadoDaInstanciaEvolution = 'open' | 'connecting' | 'close' | 'desconhecido' | 'erro' | 'nao_configurada' | 'desligada';

/** O estado que o cartão de Integrações mostra. Nunca leva a chave. */
export interface ConexaoDaEvolution {
  origem: OrigemDaCredencialEvolution;
  /** O endereço da Evolution (não é segredo: a tela mostra para conferir). */
  url: string | null;
  instancia: string | null;
  chaveGuardada: boolean;
  chaveRevogadaEm: string | null;
  chaveAtualizadaEm: string | null;
  /** O caminho da entrada (o webhook da instância): a tela soma a origem pública. */
  caminhoDoWebhook: string;
  /** O cabeçalho do segredo do webhook (o do canal de aprovação; o valor nunca vem). */
  cabecalhoDoSegredo: string;
  /** O segredo do webhook está configurado no servidor? Sem ele, nada entra. */
  entradaLigada: boolean;
  /** O provedor do comercial nesta API (`WHATSAPP_PROVEDOR`). */
  provedorDoComercial: string;
  desligado: boolean;
}

/**
 * O segredo do webhook DESTA empresa (Produção 22, M4): a casa usa o segredo do
 * processo; cada outra empresa, o HMAC-SHA256 dele com o id da empresa. Só sai
 * para quem administra a empresa (`admin.usuarios`), sem cache, e nunca vai ao
 * log (a auditoria registra que foi visto, sem o valor).
 */
export interface SegredoDoWebhookDaEvolution {
  /** O canal está configurado no servidor? Sem ele, `segredo` é nulo e nada entra. */
  ligado: boolean;
  segredo: string | null;
  cabecalho: string;
  caminhoDoWebhook: string;
  /** A empresa é a casa (o segredo é o do processo)? */
  daCasa: boolean;
}

/** O estado da instância, sondado agora. */
export interface EstadoDaEvolution {
  estado: EstadoDaInstanciaEvolution;
  /** Frase curta para a tela. Nunca leva a chave nem o corpo cru da Evolution. */
  mensagem: string;
  verificadoEm: string;
}

/** O QR para ligar o número. `base64` já vem como `data:image/png;base64,...` quando a Evolution manda. */
export interface QrDaEvolution {
  estado: EstadoDaInstanciaEvolution;
  base64: string | null;
  codigoDePareamento: string | null;
  mensagem: string;
}

/** O que o cartão manda para guardar no cofre. A chave é opcional quando já existe uma guardada. */
export const EvolutionCredencialSchema = z
  .object({
    url: z.string().trim().min(8).max(300),
    chave: z.string().trim().min(8).max(500).optional(),
    instancia: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9._ -]+$/, 'use letras, números, ponto, hífen, sublinhado ou espaço no nome da instância'),
  })
  .strict();
export type EvolutionCredencialInput = z.infer<typeof EvolutionCredencialSchema>;
