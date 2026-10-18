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

/*
 * TAREFAS DO CLIENTE: o que a equipe vai fazer por aquele cliente (ligar,
 * revisar, pedir depoimento). Moram na lista "Tarefas dos clientes" do
 * Trabalho (então aparecem no Quadro interno) e se penduram no cartão do
 * cliente por `parentId`.
 */
export const LISTA_DE_TAREFAS_DO_CLIENTE = 'crm-root-tarefas';

export const NovaTarefaDoClienteSchema = z.object({
  titulo: z.string().trim().min(1).max(300),
  /** AAAA-MM-DD */
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  responsavel: z.string().trim().max(120).nullish(),
});
export type NovaTarefaDoCliente = z.infer<typeof NovaTarefaDoClienteSchema>;

export interface TarefaDoCliente {
  id: string;
  titulo: string;
  feita: boolean;
  prazo: string | null;
  responsavel: string | null;
  atrasada: boolean;
}

/**
 * A rotina de sucesso do cliente depois da entrega (contrato com começo, meio e
 * fim): o mínimo para ele seguir satisfeito, indicar e voltar. Dias a partir de hoje.
 */
export const ROTINA_DE_SUCESSO: { titulo: string; dias: number }[] = [
  { titulo: 'Ligar uma semana depois da entrega: está usando? travou em algo?', dias: 7 },
  { titulo: 'Acompanhamento de 30 dias: resultado, uso e ajustes', dias: 30 },
  { titulo: 'Pesquisa de satisfação (nota de 0 a 10 e o porquê)', dias: 45 },
  { titulo: 'Pedir depoimento ou indicação', dias: 60 },
  { titulo: 'Propor a continuidade (próximo projeto ou manutenção)', dias: 75 },
];

/** Um quadro (kanban) de qualquer lista da jornada. */
export interface QuadroDaLista {
  lista: { id: string; nome: string; chave: string } | null;
  etapas: { id: string; nome: string; cor: string; fechada: boolean; qtd: number; valor: number }[];
  /** Campos de data da lista (Próximo contato, Entrega prevista…): o calendário escolhe por qual mostrar. */
  camposData: { id: string; nome: string }[];
  cartoes: {
    id: string;
    titulo: string;
    statusId: string;
    /** Valor de cada campo de data, `AAAA-MM-DD`, por id do campo. */
    datas: Record<string, string>;
    /** O prazo do cartão (dueDate), `AAAA-MM-DD`. */
    prazo: string | null;
    criadoEm: string;
    valor: number | null;
    contato: string | null;
    responsavel: string | null;
    /** Primeiro campo de opção que não é o responsável (Produto, Saúde…), para o cartão. */
    selo: string | null;
    seloCor: string | null;
    diasNaEtapa: number | null;
    atualizadoEm: string;
    /** Tarefas do cliente ainda abertas, e a próxima a vencer. */
    tarefasAbertas: number;
    proximaTarefa: { titulo: string; prazo: string | null; atrasada: boolean } | null;
  }[];
}
