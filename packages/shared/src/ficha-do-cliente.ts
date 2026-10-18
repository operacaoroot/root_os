import { z } from 'zod';

/*
 * FICHA DO CLIENTE (18/10/2026). A ficha é um cartão do Trabalho visto como
 * cliente: os campos da lista viram o cadastro, a etapa vira a posição no
 * funil, e as reuniões (transcrição do Granola, link ou texto) moram em
 * `ReuniaoDoCartao`. Como só depende do cartão, a mesma ficha serve ao lead do
 * comercial, ao onboarding e ao sucesso do cliente.
 */

export const FONTES_DA_REUNIAO = ['granola', 'link', 'texto', 'arquivo'] as const;
export type FonteDaReuniao = (typeof FONTES_DA_REUNIAO)[number];

export const NovaReuniaoSchema = z
  .object({
    titulo: z.string().trim().min(1).max(200),
    /** Data da reunião, AAAA-MM-DD ou ISO. */
    em: z.string().min(10).max(40),
    /** `granola` e `link` buscam o texto no link público; `texto` usa o que veio colado. */
    fonte: z.enum(['granola', 'link', 'texto']),
    link: z.string().url().max(2000).nullish(),
    texto: z.string().max(1_500_000).nullish(),
  })
  .refine((r) => (r.fonte === 'texto' ? !!r.texto?.trim() : !!r.link), {
    message: 'Mande o link (Granola ou outro público) ou cole a transcrição.',
  });
export type NovaReuniao = z.infer<typeof NovaReuniaoSchema>;

export interface ReuniaoResumo {
  id: string;
  titulo: string;
  em: string;
  fonte: FonteDaReuniao;
  link: string | null;
  /** Tamanho da transcrição, para a tela dizer "longa" sem baixar tudo. */
  caracteres: number;
  /** O começo da transcrição, para a linha do tempo. */
  trecho: string;
  autorNome: string | null;
  createdAt: string;
}

export interface ReuniaoCompleta extends ReuniaoResumo {
  transcricao: string;
}
