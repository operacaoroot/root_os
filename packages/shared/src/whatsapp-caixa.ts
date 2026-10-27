import { z } from 'zod';

/*
 * ============================================================================
 * O WHATSAPP DA EMPRESA POR DENTRO DO OS (rodada de produção 4, 22/10/2026)
 * ============================================================================
 *
 * O contrato da caixa de WhatsApp (`/whatsapp`), do vínculo com lead e cliente
 * e do cartão do Dia a dia. API e tela leem daqui, para os dois lados falarem
 * a mesma coisa.
 *
 * O que é gravado (W1): toda mensagem que passa pelo número da empresa, 1:1 e
 * grupo, inclusive a que a casa mandou pelo celular, em `WhatsAppMensagem`
 * (filha de `WhatsAppConversa`). Mídia: só metadados, nada baixado.
 *
 * Responder pela caixa (W2) é ato de GENTE, com a permissão `whatsapp.conversar`
 * e auditado. Não passa pela régua (a régua é para agente); as mensagens de
 * agente (M1 a M8, pauta, aprovação) continuam exatamente como são.
 */

// ---------------------------------------------------------------------------
// Filtros da lista
// ---------------------------------------------------------------------------

// Layout 26/10: Comunidade é o quarto tipo de conversa (grupo da comunidade da casa, como o "Operação Root | IA para Negócios"), ao lado de lead, cliente e equipe.
export const FILTROS_DA_CAIXA = ['todas', 'leads', 'clientes', 'grupos', 'sem_vinculo', 'equipe', 'comunidade', 'arquivadas'] as const;
export type FiltroDaCaixa = (typeof FILTROS_DA_CAIXA)[number];

export const ROTULO_DO_FILTRO: Record<FiltroDaCaixa, string> = {
  todas: 'Todas',
  leads: 'Leads',
  clientes: 'Clientes',
  grupos: 'Grupos',
  sem_vinculo: 'Sem vínculo',
  equipe: 'Equipe',
  comunidade: 'Comunidade',
  arquivadas: 'Arquivadas',
};

export function lerFiltroDaCaixa(v: unknown): FiltroDaCaixa {
  return typeof v === 'string' && (FILTROS_DA_CAIXA as readonly string[]).includes(v) ? (v as FiltroDaCaixa) : 'todas';
}

// ---------------------------------------------------------------------------
// Tipos de mensagem
// ---------------------------------------------------------------------------

export const TIPOS_DE_MENSAGEM_DO_WHATSAPP = [
  'conversation',
  'extendedText',
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'reaction',
  'edicao',
  'protocolo',
  'contato',
  'localizacao',
  'enquete',
  'outro',
] as const;
export type TipoDeMensagemDoWhatsapp = (typeof TIPOS_DE_MENSAGEM_DO_WHATSAPP)[number];

/** O nome curto do tipo para a prévia da lista e o balão de mídia. */
export const ROTULO_DO_TIPO: Record<TipoDeMensagemDoWhatsapp, string> = {
  conversation: 'mensagem',
  extendedText: 'mensagem',
  image: 'imagem',
  video: 'vídeo',
  audio: 'áudio',
  document: 'documento',
  sticker: 'figurinha',
  reaction: 'reação',
  edicao: 'mensagem editada',
  protocolo: 'aviso do WhatsApp',
  contato: 'contato',
  localizacao: 'localização',
  enquete: 'enquete',
  outro: 'mensagem',
};

export function rotuloDoTipoDeMensagem(tipo: string): string {
  return ROTULO_DO_TIPO[tipo as TipoDeMensagemDoWhatsapp] ?? 'mensagem';
}

/** Os metadados de mídia guardados (nada é baixado nesta rodada). */
export interface MidiaDaMensagem {
  mime: string | null;
  nome: string | null;
  tamanho: number | null;
  segundos: number | null;
}

// ---------------------------------------------------------------------------
// O que a API devolve
// ---------------------------------------------------------------------------

export type TipoDeVinculo = 'lead' | 'cliente';

export interface VinculoDaConversa {
  tipo: TipoDeVinculo;
  id: string;
  nome: string;
  /** Quem ligou (null = casou sozinho pelo telefone) e quando. */
  vinculadoPor: { id: string; nome: string } | null;
  vinculadoEm: string | null;
}

/** `nome_igual` = o nome do grupo sem o prefixo é igual ao do cliente/lead; `telefone` = o número do 1:1. */
export type ComoFoiSugerido = 'nome_igual' | 'telefone';

export interface SugestaoDeVinculo {
  tipo: TipoDeVinculo;
  id: string;
  nome: string;
  como: ComoFoiSugerido;
}

export interface PreviaDaConversa {
  texto: string | null;
  tipo: string;
  deMim: boolean;
  remetenteNome: string | null;
  timestamp: string;
}

export interface ConversaDaCaixa {
  id: string;
  grupo: boolean;
  /** Assunto do grupo, nome do contato, ou o número formatado quando não há nome. */
  nome: string;
  /** 1:1: o número (só dígitos, com DDI) quando conhecido. Grupo: null. */
  numero: string | null;
  fotoUrl: string | null;
  participantes: number | null;
  equipe: boolean;
  /** Layout 26/10: conversa da comunidade da casa (fora de lead, cliente e equipe; marcada à mão). */
  comunidade: boolean;
  ultimaMensagemEm: string | null;
  previa: PreviaDaConversa | null;
  naoLidas: number;
  vinculo: VinculoDaConversa | null;
  sugestao: SugestaoDeVinculo | null;
  arquivada: boolean;
}

export type ContagensDaCaixa = Record<FiltroDaCaixa, number>;

export interface ListaDaCaixa {
  conversas: ConversaDaCaixa[];
  /** Quantas conversas há em cada filtro (com a busca aplicada). */
  contagens: ContagensDaCaixa;
  /** A pessoa tem `whatsapp.conversar` (responder e arquivar)? */
  podeResponder: boolean;
  /** A pessoa tem `leads.editar` (vincular e desvincular)? */
  podeVincular: boolean;
  /** Mais conversas além do limite pedido. */
  mais: boolean;
}

export interface CitacaoDaMensagem {
  mensagemExternaId: string;
  texto: string | null;
  tipo: string | null;
  remetenteNome: string | null;
  deMim: boolean | null;
}

export interface MensagemDaCaixa {
  id: string;
  mensagemExternaId: string;
  deMim: boolean;
  tipo: string;
  texto: string | null;
  midia: MidiaDaMensagem | null;
  remetenteNome: string | null;
  remetenteNumero: string | null;
  timestamp: string;
  cita: CitacaoDaMensagem | null;
  /** Quem respondeu pela caixa (W2). */
  enviadaPor: { id: string; nome: string } | null;
  lida: boolean;
}

export interface ParticipanteDoGrupo {
  numero: string | null;
  nome: string | null;
  admin: boolean;
}

export interface ConversaAberta {
  conversa: ConversaDaCaixa;
  /** Da mais antiga para a mais nova. */
  mensagens: MensagemDaCaixa[];
  /** Há mensagens mais antigas que estas (paginação por `antesDe`). */
  maisAntigas: boolean;
  participantes: ParticipanteDoGrupo[];
  podeResponder: boolean;
  podeVincular: boolean;
}

/** O resultado de responder pela caixa. */
export interface RespostaEnviada {
  mensagem: MensagemDaCaixa;
}

/** Um candidato da busca de vínculo (lead ou cliente). */
export interface CandidatoDeVinculo {
  tipo: TipoDeVinculo;
  id: string;
  nome: string;
  /** Uma linha de apoio: empresa, etapa, contato. */
  detalhe: string | null;
  /** O nome normalizado é igual ao do grupo (sem o prefixo). */
  igual: boolean;
}

/** As conversas de um lead ou de um cliente (aba WhatsApp do lead, bloco da ficha do cliente). */
export interface WhatsappDoVinculo {
  conversas: ConversaDaCaixa[];
  /** As últimas mensagens da conversa mais recente (até 5), da mais antiga para a mais nova. */
  ultimas: MensagemDaCaixa[];
}

/** O cartão do Dia a dia e a bolha do menu (W4). */
export interface ResumoDoWhatsapp {
  /** Layout 26/10: `comunidade` é uma faixa própria, como `equipe`, e entra no total do mesmo jeito. */
  naoLidas: { leads: number; clientes: number; semVinculo: number; equipe: number; comunidade: number; total: number };
  /** Conversas (não arquivadas, fora da equipe e da comunidade) sem lead nem cliente. */
  conversasSemVinculo: number;
  /**
   * Layout 27/10 (Lucas): quantas CONVERSAS têm mensagem não lida (fora a comunidade). É o número
   * do selo vermelho do Chat e da bolha do menu; contar mensagens de grupo inflava o selo.
   */
  conversasNaoLidas?: number;
  geradoEm: string;
}

// ---------------------------------------------------------------------------
// O que a API recebe
// ---------------------------------------------------------------------------

export const TETO_DA_RESPOSTA_DA_CAIXA = 4000;

export const ResponderNaCaixaSchema = z.object({
  texto: z
    .string()
    .transform((s) => s.replace(/\r\n/g, '\n').trim())
    .pipe(z.string().min(1, 'Escreva a mensagem.').max(TETO_DA_RESPOSTA_DA_CAIXA, `Até ${TETO_DA_RESPOSTA_DA_CAIXA} caracteres.`)),
});
export type ResponderNaCaixa = z.infer<typeof ResponderNaCaixaSchema>;

export const VincularConversaSchema = z.object({
  tipo: z.enum(['lead', 'cliente']),
  id: z.string().min(1).max(64),
});
export type VincularConversa = z.infer<typeof VincularConversaSchema>;

export const ArquivarConversaSchema = z.object({ arquivada: z.boolean() });

/** Layout 26/10: marcar ou tirar da comunidade (`POST /whatsapp/vinculos/:id/comunidade`). */
export const MarcarComunidadeSchema = z.object({ comunidade: z.boolean() }).strict();

// ---------------------------------------------------------------------------
// Regras puras de nome (o casamento de grupo por nome, W3)
// ---------------------------------------------------------------------------

/**
 * O nome normalizado para comparar: sem acento, minúsculo, só letras e números
 * separados por um espaço. "Café  Serra Ltda." → "cafe serra ltda".
 */
export function normalizarNomeDeVinculo(nome: string | null | undefined): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * O que vem depois do prefixo da casa no nome do grupo: `ROOT | <nome>`,
 * `Root | <nome>`, `ROOT - <nome>` (qualquer caixa, espaço livre em volta do
 * separador). Sem o prefixo, `null`.
 */
export function nomeDoGrupoSemPrefixo(assunto: string | null | undefined): string | null {
  const m = /^\s*root\s*[|\-–—:]\s*(.+?)\s*$/i.exec(String(assunto ?? ''));
  return m && m[1].trim() ? m[1].trim() : null;
}

/**
 * Os grupos que são da EQUIPE (sócios e operação), e não de cliente: chip
 * próprio, sem vínculo. Por padrão: "Estratégia e Produto" (com ou sem o
 * prefixo da casa), os grupos da FullBPO e os da "Operação Root" (a comunidade).
 * Também é equipe a conversa marcada à mão (`WhatsAppConversa.equipe`).
 * Layout 26/10: o grupo da comunidade segue caindo em equipe pelo nome; "Marcar como
 * comunidade" o tira dali, e a decisão da pessoa o casamento automático não refaz.
 */
const PADROES_DA_EQUIPE: readonly RegExp[] = [
  /^estrategia e produto$/,
  /^fullbpo\b/,
  /^operacao root\b/,
];

export function ehGrupoDaEquipePeloNome(assunto: string | null | undefined): boolean {
  const cheio = normalizarNomeDeVinculo(assunto);
  const sem = normalizarNomeDeVinculo(nomeDoGrupoSemPrefixo(assunto));
  return PADROES_DA_EQUIPE.some((r) => r.test(cheio) || (sem !== '' && r.test(sem)));
}

/** Iniciais para o avatar sem foto: "Café Serra" → "CS"; número → os 2 últimos dígitos. */
export function iniciaisDaConversa(nome: string): string {
  const limpo = nome.replace(/^\s*root\s*[|\-–—:]\s*/i, '').trim();
  const palavras = limpo.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
  if (!palavras.length) return '?';
  if (/^\+?[\d\s()-]+$/.test(limpo)) return limpo.replace(/\D/g, '').slice(-2) || '?';
  const a = palavras[0].match(/[\p{L}\p{N}]/u)?.[0] ?? '';
  const b = palavras.length > 1 ? palavras[palavras.length - 1].match(/[\p{L}\p{N}]/u)?.[0] ?? '' : '';
  return (a + b).toUpperCase() || '?';
}
