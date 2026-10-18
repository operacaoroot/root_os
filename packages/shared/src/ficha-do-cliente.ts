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
 * A JORNADA DO CLIENTE (18/10/2026): UM CARD POR LEAD/CLIENTE, da primeira
 * conversa ao pós-venda. A lista é uma só ("Gestão de Leads", chave
 * `crm-root-lista`), e a jornada mora nas ETAPAS, agrupadas em três fases.
 * As abas (Painel geral, Leads, Funil de vendas, Clientes, Propostas) são
 * visões do mesmo card: cada uma mostra as etapas da sua fase.
 *
 * Passar o cliente para o onboarding é mover o card para "Negócio fechado";
 * para o sucesso, mover para "Pós-entrega". Nada é copiado.
 */
export const LISTA_DO_CRM = 'crm-root-lista';
export type FaseDoCliente = 'comercial' | 'onboarding' | 'sucesso';
export const NOME_DA_FASE: Record<FaseDoCliente, string> = { comercial: 'Comercial', onboarding: 'Onboarding', sucesso: 'Sucesso do cliente' };

export interface EtapaDaJornada {
  nome: string;
  fase: FaseDoCliente;
  tipo: 'open' | 'custom' | 'closed';
  cor: string;
  /** Saída da jornada: perdido, desqualificado, cancelado, encerrado. */
  saida?: boolean;
}

export const ETAPAS_DA_JORNADA: EtapaDaJornada[] = [
  { nome: 'Validar', fase: 'comercial', tipo: 'open', cor: '#8b8d98' },
  { nome: 'Oportunidade', fase: 'comercial', tipo: 'custom', cor: '#a18072' },
  { nome: 'Marcar reunião', fase: 'comercial', tipo: 'custom', cor: '#0091ff' },
  { nome: 'Reunião agendada', fase: 'comercial', tipo: 'custom', cor: '#30a46c' },
  { nome: 'Followup', fase: 'comercial', tipo: 'custom', cor: '#3e63dd' },
  { nome: 'Negócio fechado', fase: 'onboarding', tipo: 'custom', cor: '#008844' },
  { nome: 'Kickoff', fase: 'onboarding', tipo: 'custom', cor: '#4a7a00' },
  { nome: 'Diagnóstico', fase: 'onboarding', tipo: 'custom', cor: '#4194f6' },
  { nome: 'Implantação', fase: 'onboarding', tipo: 'custom', cor: '#ff7800' },
  { nome: 'Treinamento', fase: 'onboarding', tipo: 'custom', cor: '#a875ff' },
  { nome: 'Pós-entrega', fase: 'sucesso', tipo: 'custom', cor: '#8b8d98' },
  { nome: 'Acompanhamento 30 dias', fase: 'sucesso', tipo: 'custom', cor: '#4194f6' },
  { nome: 'Depoimento e indicação', fase: 'sucesso', tipo: 'custom', cor: '#f9d900' },
  { nome: 'Proposta de continuidade', fase: 'sucesso', tipo: 'custom', cor: '#a875ff' },
  { nome: 'Recorrente', fase: 'sucesso', tipo: 'custom', cor: '#30a46c' },
  { nome: 'Perdido', fase: 'comercial', tipo: 'closed', cor: '#e5484d', saida: true },
  { nome: 'Desqualificado', fase: 'comercial', tipo: 'closed', cor: '#6b6b6b', saida: true },
  { nome: 'Cancelado', fase: 'onboarding', tipo: 'closed', cor: '#6b6b6b', saida: true },
  { nome: 'Encerrado', fase: 'sucesso', tipo: 'closed', cor: '#6b6b6b', saida: true },
];

const semAcentoJ = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/** Fase de uma etapa pelo nome; etapa criada à mão no quadro e desconhecida conta como comercial. */
export function faseDaEtapa(nome: string): FaseDoCliente {
  return ETAPAS_DA_JORNADA.find((e) => semAcentoJ(e.nome) === semAcentoJ(nome))?.fase ?? 'comercial';
}
export function ehSaida(nome: string): boolean {
  return !!ETAPAS_DA_JORNADA.find((e) => semAcentoJ(e.nome) === semAcentoJ(nome))?.saida;
}

/** Campos que só fazem sentido depois da venda: a ficha os agrupa por fase. */
export const CAMPOS_DA_FASE: Record<Exclude<FaseDoCliente, 'comercial'>, string[]> = {
  onboarding: ['Responsável pela implantação', 'Início', 'Entrega prevista'],
  sucesso: ['Saúde', 'Valor recorrente (mês)'],
};
export function faseDoCampo(nome: string): FaseDoCliente {
  const n = semAcentoJ(nome);
  if (CAMPOS_DA_FASE.onboarding.some((c) => semAcentoJ(c) === n)) return 'onboarding';
  if (CAMPOS_DA_FASE.sucesso.some((c) => semAcentoJ(c) === n)) return 'sucesso';
  return 'comercial';
}

/*
 * CONTRATOS DO CLIENTE: um cliente pode fechar mais de uma vez (a Imersão e,
 * depois, a implantação). Cada contrato é um filho do card na lista
 * "Contratos dos clientes", com valor e data de fechamento; o Painel geral
 * soma os contratos por mês. Card sem contrato que passou de "Negócio
 * fechado" conta como um contrato, com o valor da proposta.
 */
export const LISTA_DE_CONTRATOS_DO_CLIENTE = 'crm-root-contratos';

export const NovoContratoSchema = z.object({
  titulo: z.string().trim().min(1).max(300),
  valor: z.number().nonnegative().max(1e10),
  /** AAAA-MM-DD */
  fechadoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type NovoContrato = z.infer<typeof NovoContratoSchema>;

export interface ContratoDoCliente {
  id: string;
  titulo: string;
  valor: number;
  fechadoEm: string;
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
  etapas: { id: string; nome: string; cor: string; fechada: boolean; fase: FaseDoCliente; saida: boolean; qtd: number; valor: number }[];
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
    /** Soma dos contratos do cliente (zero enquanto lead). */
    valorContratos: number;
    /** Tarefas do cliente ainda abertas, e a próxima a vencer. */
    tarefasAbertas: number;
    proximaTarefa: { titulo: string; prazo: string | null; atrasada: boolean } | null;
  }[];
}
