import { z } from 'zod';

/*
 * ============================================================================
 * ATENDIMENTO POR WHATSAPP — a parte pura (Dia a dia › Conversas, 19/10/2026)
 * ============================================================================
 *
 * Adaptado do inbox do FinOps (`supabase/functions/evolution-webhook`,
 * `src/lib/statusEnvioChat.ts`). Aqui mora só o que não fala com banco nem com
 * rede: ler o corpo que a Evolution manda, a ordem dos estados de envio e os
 * contratos que a API e a tela dividem. Testável sem nada em volta.
 */

// ---------------------------------------------------------------------------
// Estados de envio
// ---------------------------------------------------------------------------

export const STATUS_DE_ENVIO = [
  'aguardando_assinatura',
  'enviando',
  'aceita',
  'entregue',
  'lida',
  'erro',
] as const;
export type StatusDeEnvio = (typeof STATUS_DE_ENVIO)[number];

/**
 * O estado só SOBE. A Evolution manda os avisos fora de ordem (o "entregue"
 * chega depois do "lida" em grupo, o "aceita" do eco chega por último), e um
 * aviso atrasado nunca pode rebaixar o que já se sabe. `erro` fica no chão: se
 * a Evolution disser depois que entregou, entregou.
 */
const ORDEM_DO_ENVIO: Record<StatusDeEnvio, number> = {
  aguardando_assinatura: 0,
  enviando: 0,
  erro: 0,
  aceita: 1,
  entregue: 2,
  lida: 3,
};

export function statusSobe(atual: StatusDeEnvio | null | undefined, novo: StatusDeEnvio): boolean {
  if (!atual) return true;
  return ORDEM_DO_ENVIO[novo] > ORDEM_DO_ENVIO[atual];
}

/**
 * O aviso da Evolution (`messages.update`) traduzido. `SERVER_ACK` quer dizer
 * que o WhatsApp ACEITOU, não que chegou: é por isso que "aceita" e "entregue"
 * são dois estados, e a tela mostra um tique e dois tiques.
 */
export function statusDoAviso(bruto: unknown): StatusDeEnvio | null {
  if (typeof bruto === 'number') {
    if (bruto === 2) return 'aceita';
    if (bruto === 3) return 'entregue';
    if (bruto === 4 || bruto === 5) return 'lida';
    return null;
  }
  if (typeof bruto !== 'string') return null;
  switch (bruto.trim().toUpperCase()) {
    case 'SERVER_ACK':
      return 'aceita';
    case 'DELIVERY_ACK':
      return 'entregue';
    case 'READ':
    case 'PLAYED':
      return 'lida';
    default:
      return null;
  }
}

/** O que a tela escreve ao lado de cada estado. */
export const ROTULO_DO_ENVIO: Record<StatusDeEnvio, string> = {
  aguardando_assinatura: 'esperando assinatura',
  enviando: 'enviando',
  aceita: 'aceita pelo WhatsApp',
  entregue: 'entregue',
  lida: 'lida',
  erro: 'não enviada',
};

/**
 * O aviso "o WhatsApp não está aceitando mensagens" (do FinOps,
 * `statusEnvioChat.ts`): duas falhas nos últimos 15 minutos. Data ausente ou
 * inválida conta como recente — esconder o aviso por causa de um dado ruim é o
 * erro pior.
 */
export const JANELA_DE_FALHA_MIN = 15;
export const FALHAS_PARA_AVISAR = 2;

export function falhasRecentes(
  mensagens: ReadonlyArray<{ statusEnvio?: StatusDeEnvio | null; momento?: string | null }>,
  agora: number = Date.now(),
): number {
  const limite = agora - JANELA_DE_FALHA_MIN * 60_000;
  return mensagens.filter((m) => {
    if (m.statusEnvio !== 'erro') return false;
    const t = m.momento ? Date.parse(m.momento) : NaN;
    return Number.isNaN(t) || t >= limite;
  }).length;
}

export function envioComProblema(
  mensagens: ReadonlyArray<{ statusEnvio?: StatusDeEnvio | null; momento?: string | null }>,
  agora?: number,
): boolean {
  return falhasRecentes(mensagens, agora) >= FALHAS_PARA_AVISAR;
}

// ---------------------------------------------------------------------------
// Leitura do webhook da Evolution
// ---------------------------------------------------------------------------

export type TipoDeMensagem = 'texto' | 'imagem' | 'audio' | 'video' | 'documento' | 'figurinha' | 'outro';

export interface MidiaRecebida {
  mimetype: string | null;
  nome: string | null;
  tamanho: number | null;
  /** Quando a instância manda o arquivo junto (`webhook_base64`). */
  base64: string | null;
}

export interface MensagemRecebida {
  tipo: 'mensagem';
  /** A conversa: o grupo, ou o número na conversa direta. */
  jidConversa: string;
  grupo: boolean;
  /** Só dígitos, quando a conversa é direta e o JID é de telefone. */
  telefone: string | null;
  fromMe: boolean;
  evolutionId: string;
  /** Quem escreveu: em grupo, o participante; na direta, a própria conversa. */
  remetenteJid: string | null;
  remetenteNome: string | null;
  momento: Date;
  tipoMensagem: TipoDeMensagem;
  texto: string | null;
  midia: MidiaRecebida | null;
}

export interface AvisoDeEnvio {
  tipo: 'aviso';
  evolutionId: string;
  status: StatusDeEnvio;
}

export interface MensagemApagada {
  tipo: 'apagada';
  evolutionId: string;
}

export type EventoDeAtendimento = MensagemRecebida | AvisoDeEnvio | MensagemApagada;

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  const o = obj(v);
  // Long do protobuf serializado: { low, high, unsigned }.
  if (o && typeof o.low === 'number') return o.low >>> 0;
  return null;
}

/** JID sem o sufixo de aparelho (`5511…:12@s.whatsapp.net` → `5511…@s.whatsapp.net`). */
export function jidSemAparelho(jid: string): string {
  const s = jid.trim().toLowerCase();
  const arroba = s.indexOf('@');
  if (arroba < 0) return s;
  return `${s.slice(0, arroba).split(':')[0]}${s.slice(arroba)}`;
}

export function ehJidDeGrupo(jid: string): boolean {
  return jid.trim().toLowerCase().endsWith('@g.us');
}

/** Dígitos do telefone de um JID de pessoa; `null` para grupo, `@lid` ou lixo. */
export function telefoneDoJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const s = jidSemAparelho(jid);
  if (!/@(s\.whatsapp\.net|c\.us)$/.test(s) && s.includes('@')) return null;
  const d = s.split('@')[0].replace(/^\+/, '');
  return /^\d{8,15}$/.test(d) ? d : null;
}

/** Conversas que não são atendimento: status, canal de transmissão, newsletter. */
function conversaIgnorada(jid: string): boolean {
  return jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter');
}

const TIPOS_SEM_CONTEUDO = new Set([
  'reactionMessage',
  'protocolMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'pollUpdateMessage',
  'editedMessage',
  'keepInChatMessage',
]);

/** O conteúdo de `data.message`, achatado no que a caixa guarda. */
export function lerConteudo(
  message: unknown,
): { tipoMensagem: TipoDeMensagem; texto: string | null; midia: MidiaRecebida | null } | null {
  let m = obj(message);
  if (!m) return null;
  // Embrulhos que só carregam a mensagem de verdade dentro.
  for (const embrulho of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) {
    const dentro = obj(obj(m[embrulho])?.message);
    if (dentro) m = dentro;
  }
  const chaves = Object.keys(m).filter((k) => !TIPOS_SEM_CONTEUDO.has(k));
  if (chaves.length === 0) return null;

  const conversa = str(m.conversation);
  if (conversa) return { tipoMensagem: 'texto', texto: conversa, midia: null };
  const ext = obj(m.extendedTextMessage);
  if (ext) return { tipoMensagem: 'texto', texto: str(ext.text), midia: null };

  const midia = (chave: string, tipo: TipoDeMensagem) => {
    const x = obj(m![chave]);
    if (!x) return null;
    return {
      tipoMensagem: tipo,
      texto: str(x.caption),
      midia: {
        mimetype: str(x.mimetype),
        nome: str(x.fileName) ?? str(x.title),
        tamanho: num(x.fileLength),
        base64: null,
      },
    };
  };
  const achada =
    midia('imageMessage', 'imagem') ??
    midia('audioMessage', 'audio') ??
    midia('videoMessage', 'video') ??
    midia('ptvMessage', 'video') ??
    midia('documentMessage', 'documento') ??
    midia('stickerMessage', 'figurinha');
  if (achada) return achada;

  // Cartão de contato, localização e lista viram texto — como no FinOps.
  const contato = obj(m.contactMessage);
  if (contato) return { tipoMensagem: 'texto', texto: `[contato] ${str(contato.displayName) ?? ''}`.trim(), midia: null };
  const local = obj(m.locationMessage);
  if (local) {
    const nome = str(local.name) ?? str(local.address);
    return { tipoMensagem: 'texto', texto: `[localização] ${nome ?? `${local.degreesLatitude}, ${local.degreesLongitude}`}`, midia: null };
  }
  const botao = obj(m.buttonsResponseMessage) ?? obj(m.templateButtonReplyMessage) ?? obj(m.listResponseMessage);
  if (botao) {
    return { tipoMensagem: 'texto', texto: str(botao.selectedDisplayText) ?? str(botao.title) ?? '[resposta de botão]', midia: null };
  }
  return { tipoMensagem: 'outro', texto: `[mensagem do tipo ${chaves[0]}]`, midia: null };
}

function momentoDe(v: unknown): Date {
  const n = num(v);
  if (n && n > 0) return new Date(n < 1e12 ? n * 1000 : n);
  return new Date();
}

function lerUpsert(data: Record<string, unknown>, base64DoCorpo: string | null): MensagemRecebida | null {
  const key = obj(data.key);
  const id = str(key?.id);
  const remoto = str(key?.remoteJid);
  if (!key || !id || !remoto) return null;
  const jid = jidSemAparelho(remoto);
  if (conversaIgnorada(jid)) return null;

  const conteudo = lerConteudo(data.message);
  if (!conteudo) return null;

  const grupo = ehJidDeGrupo(jid);
  const fromMe = key.fromMe === true;
  // Em grupo quem escreveu é o participante; na direta, a própria conversa.
  const participante = str(key.participant) ?? str(data.participant);
  const remetenteJid = grupo ? (participante ? jidSemAparelho(participante) : null) : fromMe ? null : jid;
  // O número verdadeiro quando a conversa vem como @lid (`remoteJidAlt`/`senderPn`).
  const alternativo = str(key.remoteJidAlt) ?? str(key.senderPn) ?? str(data.senderPn);
  const telefone = grupo ? null : telefoneDoJid(jid) ?? telefoneDoJid(alternativo);

  const base64 = base64DoCorpo ?? str(obj(data.message)?.base64) ?? str(data.base64);
  return {
    tipo: 'mensagem',
    jidConversa: jid,
    grupo,
    telefone,
    fromMe,
    evolutionId: id,
    remetenteJid,
    remetenteNome: fromMe ? null : str(data.pushName),
    momento: momentoDe(data.messageTimestamp),
    tipoMensagem: conteudo.tipoMensagem,
    texto: conteudo.texto,
    midia: conteudo.midia ? { ...conteudo.midia, base64: base64 ?? null } : null,
  };
}

/**
 * Lê o corpo inteiro do webhook e devolve o que interessa à caixa — ou lista
 * vazia. Nunca lança: o webhook já respondeu e o que não se entende é ignorado.
 *
 * Aceita `data` como objeto ou lista (as versões da Evolution variam) e o nome
 * do evento com ponto ou sublinhado, em qualquer caixa.
 */
export function lerEventoDaEvolution(corpo: unknown): EventoDeAtendimento[] {
  const raiz = obj(corpo);
  const evento = str(raiz?.event)?.toLowerCase().replace(/_/g, '.');
  if (!raiz || !evento) return [];
  const datas = Array.isArray(raiz.data) ? raiz.data : [raiz.data];
  const saida: EventoDeAtendimento[] = [];
  for (const d of datas) {
    const data = obj(d);
    if (!data) continue;
    if (evento === 'messages.upsert') {
      const m = lerUpsert(data, null);
      if (m) saida.push(m);
    } else if (evento === 'messages.update') {
      const id = str(data.keyId) ?? str(data.messageId) ?? str(obj(data.key)?.id);
      const status = statusDoAviso(data.status ?? obj(data.update)?.status);
      if (id && status) saida.push({ tipo: 'aviso', evolutionId: id, status });
    } else if (evento === 'messages.delete') {
      const id = str(obj(data.key)?.id) ?? str(data.id) ?? str(data.keyId);
      if (id) saida.push({ tipo: 'apagada', evolutionId: id });
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Anexos
// ---------------------------------------------------------------------------

/** O teto do FinOps (bucket `inbox`): 50 MB. */
export const TETO_DO_ANEXO_BYTES = 50 * 1024 * 1024;

const TIPOS_DE_ANEXO_ACEITOS = [
  /^image\/(jpeg|png|webp|gif|heic|heif)$/,
  /^audio\/(ogg|mpeg|mp4|aac|amr|wav|webm)$/,
  /^video\/(mp4|3gpp|quicktime|webm)$/,
  /^application\/pdf$/,
  /^application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.oasis\.opendocument\.[a-z.]+)$/,
  /^application\/zip$/,
  /^text\/(plain|csv)$/,
];

/** O tipo do arquivo, limpo do `; codecs=opus`, ou `null` quando não serve. */
export function tipoDeAnexoAceito(mimetype: string | null | undefined): string | null {
  if (!mimetype) return null;
  const limpo = mimetype.split(';')[0].trim().toLowerCase();
  return TIPOS_DE_ANEXO_ACEITOS.some((r) => r.test(limpo)) ? limpo : null;
}

// ---------------------------------------------------------------------------
// Contratos da API
// ---------------------------------------------------------------------------

export const FILTROS_DE_CONVERSA = ['todas', 'minhas', 'sem_responsavel', 'sem_cliente', 'grupos', 'encerradas'] as const;
export type FiltroDeConversa = (typeof FILTROS_DE_CONVERSA)[number];

export const AjusteDoAtendimentoSchema = z.object({ ativo: z.boolean() }).strict();

export const ResponderSchema = z
  .object({
    texto: z.string().trim().min(1).max(4096),
    /** Gerado pela tela. Repetir o mesmo id devolve a mesma resposta. */
    clienteMensagemId: z.string().uuid(),
  })
  .strict();
export type Responder = z.infer<typeof ResponderSchema>;

export const ConversaEditarSchema = z
  .object({
    responsavelId: z.string().uuid().nullable().optional(),
    clienteId: z.string().uuid().nullable().optional(),
    nome: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type ConversaEditar = z.infer<typeof ConversaEditarSchema>;

export const EncerrarSchema = z.object({ versao: z.number().int().min(0) }).strict();

export const VirarTarefaSchema = z
  .object({
    titulo: z.string().trim().min(1).max(300),
    areaId: z.string().uuid(),
    pessoaId: z.string().uuid().nullish(),
    prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    confirmar: z.boolean().optional(),
  })
  .strict();
export type VirarTarefa = z.infer<typeof VirarTarefaSchema>;

export interface ConversaResumo {
  id: string;
  nome: string;
  grupo: boolean;
  telefoneFinal: string | null;
  cliente: { id: string; nome: string } | null;
  responsavel: { id: string; nome: string } | null;
  ultimaMensagemEm: string | null;
  previa: string | null;
  naoLidas: number;
  encerrada: boolean;
  versao: number;
}

export interface MensagemDaConversa {
  id: string;
  direcao: 'entrada' | 'saida';
  tipo: TipoDeMensagem;
  texto: string | null;
  remetenteNome: string | null;
  autor: string | null;
  momento: string;
  statusEnvio: StatusDeEnvio | null;
  erroEnvio: string | null;
  anexo: { situacao: string; tipo: string | null; nome: string | null; tamanho: number | null } | null;
  apagada: boolean;
  tarefaId: string | null;
}
