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

/*
 * A JORNADA DO CLIENTE: três listas do Trabalho, uma por fase, com a mesma
 * ficha. O cliente passa de uma para a outra pela ficha ("passar para…"), que
 * cria o cartão na próxima lista copiando os dados. As listas se reconhecem
 * pela chave (`WorkList.externalId`), não pelo nome, que pode ser trocado.
 */
export const JORNADA_DO_CLIENTE = [
  { chave: 'crm-root-lista', fase: 'Comercial', rota: '/comercial/lead/', proxima: 'crm-root-onboarding' },
  { chave: 'crm-root-onboarding', fase: 'Onboarding', rota: '/clientes/', proxima: 'crm-root-sucesso' },
  { chave: 'crm-root-sucesso', fase: 'Sucesso do cliente', rota: '/clientes/', proxima: null },
] as const;
export type ChaveDaJornada = (typeof JORNADA_DO_CLIENTE)[number]['chave'];
export const faseDaLista = (chave: string | null | undefined) => JORNADA_DO_CLIENTE.find((f) => f.chave === chave) ?? null;

export const PassarNaJornadaSchema = z.object({
  destino: z.enum(JORNADA_DO_CLIENTE.map((f) => f.chave) as [ChaveDaJornada, ...ChaveDaJornada[]]),
});

export interface PassoDaJornada {
  id: string;
  titulo: string;
  chave: string;
  fase: string;
  etapa: string;
  etapaCor: string;
  createdAt: string;
}

export interface JornadaDoCliente {
  /** O nome que liga os cartões: o campo Empresa, ou o começo do título até o "|". */
  cliente: string;
  passos: PassoDaJornada[];
  /** As reuniões de todos os cartões do cliente, da mais recente para a mais antiga. */
  reunioes: (ReuniaoResumo & { taskId: string; fase: string })[];
}

/** Um quadro (kanban) de qualquer lista da jornada. */
export interface QuadroDaLista {
  lista: { id: string; nome: string; chave: string } | null;
  etapas: { id: string; nome: string; cor: string; fechada: boolean; qtd: number; valor: number }[];
  cartoes: {
    id: string;
    titulo: string;
    statusId: string;
    valor: number | null;
    contato: string | null;
    responsavel: string | null;
    /** Primeiro campo de opção que não é o responsável (Produto, Saúde…), para o cartão. */
    selo: string | null;
    seloCor: string | null;
    diasNaEtapa: number | null;
    atualizadoEm: string;
  }[];
}
