import { z } from 'zod';

/*
 * O CARTÃO DE CONEXÃO — rodada dos agentes, lane A6 (21/10/2026).
 *
 * Um formato só para TODO conector da tela de Conexões (`GET /integrations/cartoes`).
 * O servidor decide o estado (a sonda do contrato único, com a hora da medição) e
 * quem usa cada conector (o cadastro único de funções); a tela só desenha.
 *
 * O VOCABULÁRIO DO ESTADO é um só, na mesma ordem em toda parte:
 *   Conectado · Não configurado · Erro: <motivo> · Desligado
 * e um quinto, "Não verificado", que só aparece em linha sem sonda (conector que
 * ainda não implementa o contrato): verde sem medição seria mentira (RF-X-02), e
 * "não configurado" também, quando a credencial existe.
 *
 * A CREDENCIAL NUNCA VEM: só o fato de haver uma guardada no cofre desta empresa.
 */

/** "Para que serve", em uma frase, por linha do catálogo. Linha sem frase usa o `requires` do catálogo. */
export const PARA_QUE_SERVE_DO_CONECTOR: Readonly<Record<string, string>> = {
  openai: 'Vetores da memória e da vault e transcrição de áudio. O texto dos agentes sai pela Anthropic.',
  telegram: 'Canal antigo de avisos, aposentado em 11/09/2026.',
  clickup: 'Espelho das tarefas do ClickUp. Desligado desde 21/10/2026: o Trabalho mora no OS.',
  asana: 'Previsto e nunca ligado.',
  zapier: 'Previsto e suspenso.',
  apify: 'Coleta posts, perfis e buscas para a Pauta, com teto de runs por fonte.',
  instagram: 'Bio, métricas, publicação e comentários do Instagram da casa.',
  youtube: 'Envio e agendamento dos episódios no canal do YouTube.',
  gmail: 'Lê e manda e-mail da conta Google da empresa.',
  gcal: 'Lê e marca reuniões na agenda Google da empresa.',
  gdocs: 'Cria e escreve documentos Google da empresa.',
  drive: 'Pasta do cliente, anexos e leitura de atas no Google Drive da empresa.',
  obsidian: 'A vault indexada que vira contexto e memória dos agentes.',
  whatsapp: 'O WhatsApp do processo pela Evolution: aviso de aprovação e grupo de links da Pauta.',
  pluggy: 'Contas e extratos dos bancos pelo Open Finance, para o Financeiro.',
  asaas: 'Cobranças, saldo e extrato da conta Asaas, para o Financeiro e o fechamento do comercial.',
  zapsign: 'Assinatura do contrato do comercial.',
  ofx: 'Importação do extrato bancário em arquivo OFX.',
  granola: 'Reuniões do Granola: a ata na ficha do cliente e as atas do Trabalho.',
  evolution: 'O WhatsApp do comercial: conversa com o lead, grupo do cliente e a entrada das respostas.',
  google: 'Conta Google da empresa (Gmail, Agenda, Docs e Drive).',
  meta: 'Conta Meta da empresa (Instagram).',
};

export const ESTADOS_DO_CARTAO = ['conectado', 'nao_configurado', 'erro', 'desligado', 'nao_verificado'] as const;
export type EstadoDoCartao = (typeof ESTADOS_DO_CARTAO)[number];

export const ROTULO_DO_ESTADO_DO_CARTAO: Readonly<Record<EstadoDoCartao, string>> = {
  conectado: 'Conectado',
  nao_configurado: 'Não configurado',
  erro: 'Erro',
  desligado: 'Desligado',
  nao_verificado: 'Não verificado',
};

/** O texto do selo: "Erro: <motivo>" leva o motivo; os outros são o rótulo. */
export function textoDoEstadoDoCartao(estado: EstadoDoCartao, motivo: string | null | undefined): string {
  if (estado === 'erro') return `Erro: ${(motivo ?? '').trim() || 'motivo não informado pelo conector'}`;
  return ROTULO_DO_ESTADO_DO_CARTAO[estado];
}

export const QuemUsaOConectorSchema = z.object({
  id: z.string(),
  nome: z.string(),
  tipo: z.enum(['agente', 'rotina', 'automacao']),
  estado: z.enum(['ativo', 'desligado', 'so-homologacao', 'aposentado']),
}).strict();
export type QuemUsaOConector = z.infer<typeof QuemUsaOConectorSchema>;

export const CartaoDeConexaoSchema = z.object({
  key: z.string(),
  nome: z.string(),
  paraQueServe: z.string(),
  categoria: z.string(),
  fase: z.number().int(),
  estado: z.enum(ESTADOS_DO_CARTAO),
  /** A frase do conector (o motivo do erro, o "não configurado porque…", a conta medida). */
  motivo: z.string().nullable(),
  medidoEm: z.string().nullable(),
  latenciaMs: z.number().nonnegative().nullable(),
  /** O que a sonda disse da conta ligada, quando conectou (e-mail, @, instância). */
  conta: z.string().nullable(),
  ultimaSincronizacao: z.string().nullable(),
  /** Há credencial desta empresa guardada no cofre (o valor nunca vem). */
  credencialNoCofre: z.boolean(),
  desligado: z.boolean(),
  desligadoEm: z.string().nullable(),
  motivoDesligado: z.string().nullable(),
  textoDoDesligamento: z.string(),
  grupo: z.string().nullable(),
  /** A unidade de credencial do contrato (a chave dos verbos), ou nulo quando a linha não tem conector. */
  contrato: z.object({
    chave: z.string(),
    rotulo: z.string(),
    escopoDaCredencial: z.enum(['empresa', 'processo']),
    linhasIrmas: z.array(z.string()),
  }).strict().nullable(),
  usadoPor: z.array(QuemUsaOConectorSchema),
}).strict();
export type CartaoDeConexao = z.infer<typeof CartaoDeConexaoSchema>;

export const CartoesDeConexaoSchema = z.object({
  autoridadeGerenciar: z.boolean(),
  items: z.array(CartaoDeConexaoSchema),
  geradoEm: z.string(),
}).strict();
export type CartoesDeConexao = z.infer<typeof CartoesDeConexaoSchema>;
