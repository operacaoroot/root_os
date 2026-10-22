import type { MidiaDaMensagem, TipoDeMensagemDoWhatsapp } from '@mktos/shared';

import { numeroRealDoLid } from '../gateway/canais/identidade-de-canal';

/*
 * ============================================================================
 * A LEITURA DO QUE A EVOLUTION ENTREGA (produção 22C, W1) — PURO, sem Nest
 * ============================================================================
 *
 * Um lugar só para a regra de "o que é esta mensagem", usado pelo webhook (o
 * `data` de `messages.upsert`) e pela sincronização (cada registro de
 * `chat/findMessages`): os dois têm a MESMA forma na Evolution v2 —
 * `{ key, pushName, messageType, message, contextInfo?, messageTimestamp }`.
 * Ler os dois pela mesma função é o que faz a mesma mensagem cair na mesma
 * linha (idempotência por `mensagemExternaId`) e com o mesmo conteúdo.
 *
 * O QUE ENTRA NA LINHA, E O QUE NUNCA ENTRA:
 *   · o texto (conversa, texto estendido, legenda da mídia, emoji da reação,
 *     texto novo da edição), cortado em `TETO_DO_TEXTO`;
 *   · da mídia, SÓ metadados (tipo MIME, nome do arquivo, tamanho, segundos).
 *     `url`, `mediaKey`, `directPath`, `jpegThumbnail` e o `base64` (quando o
 *     webhook vem com ele) ficam de fora: nada é baixado nesta rodada, e a
 *     chave da mídia abriria o arquivo para quem lesse o banco.
 *
 * A CONVERSA CANÔNICA (o `chatJid`):
 *   · grupo: o próprio `…@g.us`;
 *   · 1:1 com telefone: `<dígitos>@s.whatsapp.net`, sem o sufixo de aparelho
 *     (`:12`) e trocando `@c.us` pela forma de sempre;
 *   · 1:1 no modo `@lid` (Produção 22, M4): com o número real ao lado
 *     (`remoteJidAlt`/`senderPn`), a conversa é a do NÚMERO e o lid vai em
 *     `lidJid` (para achar a mesma conversa quando vier só o lid). Sem o número
 *     real, a conversa fica no `@lid` mesmo, até um dia o número aparecer.
 *
 * `status@broadcast`, qualquer `@broadcast` e canal (`@newsletter`) não são
 * conversa: são ignorados com o motivo.
 */

/** O teto do texto guardado de uma mensagem. */
export const TETO_DO_TEXTO = 8000;

/** O que a gravação precisa de uma mensagem. */
export interface MensagemLida {
  /** A conversa canônica (ver o topo). */
  chatJid: string;
  /** O `@lid` da conversa 1:1 quando veio junto do número real. */
  lidJid: string | null;
  grupo: boolean;
  /** Quem escreveu: no 1:1 de entrada, a própria conversa; no grupo, o participante; `null` no que a casa mandou pelo 1:1. */
  remetenteJid: string | null;
  /** Só dígitos, com DDI: o número real de quem escreveu, quando se sabe. */
  remetenteNumero: string | null;
  /** O nome que a pessoa escolheu no aparelho (pushName). Texto de terceiro: só para mostrar. */
  remetenteNome: string | null;
  deMim: boolean;
  direcao: 'entrada' | 'saida';
  tipo: TipoDeMensagemDoWhatsapp;
  texto: string | null;
  midia: MidiaDaMensagem | null;
  mensagemExternaId: string;
  citaMensagemExternaId: string | null;
  timestamp: Date;
}

export type LeituraDeRegistro = { mensagem: MensagemLida } | { ignorado: string };

/** O estado da instância num `connection.update`. */
export type EstadoDaConexao = 'open' | 'connecting' | 'close' | 'desconhecido';

/** O que um corpo do webhook é. */
export type LeituraDoWebhook =
  | { tipo: 'mensagens'; instancia: string | null; lidas: MensagemLida[]; ignoradas: string[] }
  | { tipo: 'conexao'; instancia: string | null; estado: EstadoDaConexao }
  | { tipo: 'ignorado'; instancia: string | null; motivo: string };

// ---------------------------------------------------------------- auxiliares

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Texto numa linha, sem controle, cortado. Para nome de pessoa, de arquivo, de grupo. */
export function umaLinha(v: unknown, teto = 200): string | null {
  if (typeof v !== 'string') return null;
  const limpo = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return limpo ? limpo.slice(0, teto) : null;
}

/** O texto da mensagem: quebra de linha fica, controle sai, corte no teto. */
function textoDaMensagem(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const limpo = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, '').trim();
  return limpo ? limpo.slice(0, TETO_DO_TEXTO) : null;
}

/** Número de um campo que pode vir como número, texto de dígitos ou `Long` (`{ low, high }`). */
function numero(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d{1,16}$/.test(v.trim())) return Number(v.trim());
  const o = objeto(v);
  if (o && typeof o.low === 'number' && typeof o.high === 'number') {
    const n = o.high * 2 ** 32 + (o.low >>> 0);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** O instante da mensagem: segundos ou milissegundos, número, texto ou `Long`. */
export function instanteDaEvolution(v: unknown, agora: Date = new Date()): Date {
  const n = numero(v);
  if (n === null || n <= 0) return agora;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  // Data fora de qualquer razão (antes do WhatsApp existir, ou um dia no futuro) vira o agora.
  if (Number.isNaN(d.getTime()) || ms < Date.UTC(2009, 0, 1) || ms > agora.getTime() + 86_400_000) return agora;
  return d;
}

const TELEFONE = /^(\d{8,15})(?::\d+)?@(s\.whatsapp\.net|c\.us)$/;
const GRUPO = /^[0-9-]{5,60}@g\.us$/;
const LID = /^[0-9]{5,40}(?::\d+)?@lid$/;

/** Os dígitos de um JID de telefone (`…@s.whatsapp.net`/`…@c.us`, com ou sem aparelho), ou `null`. */
export function digitosDoJid(jid: unknown): string | null {
  if (typeof jid !== 'string') return null;
  const m = TELEFONE.exec(jid.trim().toLowerCase());
  return m ? m[1] : null;
}

/** O `@lid` sem o sufixo de aparelho, ou `null`. */
export function lidCanonico(jid: unknown): string | null {
  if (typeof jid !== 'string') return null;
  const j = jid.trim().toLowerCase();
  if (!LID.test(j)) return null;
  return `${j.split('@')[0].split(':')[0]}@lid`;
}

/** O número real de um campo que pode trazer `<dígitos>@s.whatsapp.net` (participantAlt, participantPn, phoneNumber). */
function numeroDeCampos(o: Record<string, unknown> | null, campos: readonly string[]): string | null {
  if (!o) return null;
  for (const c of campos) {
    const d = digitosDoJid(o[c]);
    if (d) return d;
  }
  return null;
}

/** O JID ignorado (recado, canal) ou `null` se é conversa. */
function motivoDeNaoSerConversa(jid: string): string | null {
  if (jid.endsWith('@broadcast')) return 'status ou lista de transmissão';
  if (jid.endsWith('@newsletter')) return 'canal (newsletter)';
  return null;
}

/**
 * A conversa canônica de uma `key` (ou de um chat) da Evolution, ou o motivo
 * de não haver conversa.
 */
export function conversaDaKey(key: Record<string, unknown> | null): { chatJid: string; lidJid: string | null; grupo: boolean } | { ignorado: string } {
  const remoto = typeof key?.remoteJid === 'string' ? key.remoteJid.trim().toLowerCase() : '';
  if (!remoto) return { ignorado: 'sem conversa' };
  const fora = motivoDeNaoSerConversa(remoto);
  if (fora) return { ignorado: fora };
  if (GRUPO.test(remoto)) return { chatJid: remoto, lidJid: null, grupo: true };
  const digitos = digitosDoJid(remoto);
  if (digitos) {
    // O telefone veio no remoteJid; o lid pode vir ao lado (algumas versões mandam o inverso).
    const lid = lidCanonico(key?.remoteJidAlt) ?? lidCanonico(key?.senderLid);
    return { chatJid: `${digitos}@s.whatsapp.net`, lidJid: lid, grupo: false };
  }
  const lid = lidCanonico(remoto);
  if (lid) {
    const real = numeroRealDoLid(key);
    return real ? { chatJid: `${real}@s.whatsapp.net`, lidJid: lid, grupo: false } : { chatJid: lid, lidJid: null, grupo: false };
  }
  return { ignorado: 'conversa fora do formato' };
}

// -------------------------------------------------------------- o conteúdo

/** As chaves de `message` que não são o conteúdo (vêm ao lado dele). */
const CHAVES_DE_APOIO = new Set(['messageContextInfo', 'senderKeyDistributionMessage', 'base64', 'mediaUrl', 'deviceSentMessage']);

/** Os envelopes que só embrulham outra mensagem. */
const ENVELOPES = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'deviceSentMessage'] as const;

function desembrulhar(message: Record<string, unknown>): Record<string, unknown> {
  let atual = message;
  for (let i = 0; i < 4; i++) {
    const envelope = ENVELOPES.map((e) => objeto(objeto(atual[e])?.message)).find(Boolean);
    if (!envelope) break;
    atual = envelope;
  }
  return atual;
}

function midiaDe(m: Record<string, unknown> | null, comNome = false): MidiaDaMensagem {
  const mime = umaLinha(m?.mimetype, 120);
  const tamanho = numero(m?.fileLength);
  const segundos = numero(m?.seconds);
  return {
    mime: mime ? mime.split(';')[0].trim() || null : null,
    nome: comNome ? umaLinha(m?.fileName, 200) ?? umaLinha(m?.title, 200) : null,
    tamanho: tamanho !== null && tamanho >= 0 ? tamanho : null,
    segundos: segundos !== null && segundos >= 0 ? segundos : null,
  };
}

function stanzaDe(...fontes: Array<Record<string, unknown> | null | undefined>): string | null {
  for (const f of fontes) {
    const ctx = objeto(f?.contextInfo);
    const id = umaLinha(ctx?.stanzaId, 200);
    if (id) return id;
  }
  return null;
}

/** O texto novo de uma edição (`editedMessage` ou `protocolMessage.editedMessage`). */
function textoEditado(m: Record<string, unknown> | null): string | null {
  if (!m) return null;
  const interna = objeto(m.message) ?? m;
  const e = objeto(interna.extendedTextMessage);
  return (
    textoDaMensagem(interna.conversation) ??
    textoDaMensagem(e?.text) ??
    textoDaMensagem(objeto(interna.imageMessage)?.caption) ??
    textoDaMensagem(objeto(interna.videoMessage)?.caption)
  );
}

interface Conteudo {
  tipo: TipoDeMensagemDoWhatsapp;
  texto: string | null;
  midia: MidiaDaMensagem | null;
  cita: string | null;
}

/** O tipo, o texto, a mídia e a citação de uma `message` (já desembrulhada). */
export function conteudoDaMensagem(messageCru: unknown, messageType: unknown, contextoDoRegistro?: unknown): Conteudo {
  const raiz = objeto(messageCru) ?? {};
  const m = desembrulhar(raiz);
  const ctxRegistro = objeto(contextoDoRegistro);
  const citaDoRegistro = umaLinha(ctxRegistro?.stanzaId, 200);
  const chaves = Object.keys(m).filter((k) => !CHAVES_DE_APOIO.has(k));
  const tem = (k: string) => chaves.includes(k);
  const tipoDeclarado = typeof messageType === 'string' ? messageType : '';

  // Edição: `editedMessage` (envelope novo) ou `protocolMessage` com `editedMessage` (tipo 14).
  const editada = objeto(m.editedMessage);
  const protocolo = objeto(m.protocolMessage) ?? objeto(objeto(editada?.message)?.protocolMessage);
  if (editada || tipoDeclarado === 'editedMessage' || objeto(protocolo?.editedMessage)) {
    const novo = textoEditado(objeto(protocolo?.editedMessage)) ?? textoEditado(objeto(editada?.message)) ?? textoEditado(editada);
    const alvo = umaLinha(objeto(protocolo?.key)?.id, 200);
    return { tipo: 'edicao', texto: novo, midia: null, cita: alvo ?? citaDoRegistro };
  }
  if (protocolo || tipoDeclarado === 'protocolMessage') {
    return { tipo: 'protocolo', texto: null, midia: null, cita: umaLinha(objeto(protocolo?.key)?.id, 200) };
  }

  if (tem('conversation') && typeof m.conversation === 'string') {
    return { tipo: 'conversation', texto: textoDaMensagem(m.conversation), midia: null, cita: citaDoRegistro };
  }
  const estendida = objeto(m.extendedTextMessage);
  if (estendida) return { tipo: 'extendedText', texto: textoDaMensagem(estendida.text), midia: null, cita: stanzaDe(estendida) ?? citaDoRegistro };

  const reacao = objeto(m.reactionMessage);
  if (reacao) return { tipo: 'reaction', texto: umaLinha(reacao.text, 32), midia: null, cita: umaLinha(objeto(reacao.key)?.id, 200) };

  const imagem = objeto(m.imageMessage);
  if (imagem) return { tipo: 'image', texto: textoDaMensagem(imagem.caption), midia: midiaDe(imagem), cita: stanzaDe(imagem) ?? citaDoRegistro };
  const video = objeto(m.videoMessage) ?? objeto(m.ptvMessage);
  if (video) return { tipo: 'video', texto: textoDaMensagem(video.caption), midia: midiaDe(video), cita: stanzaDe(video) ?? citaDoRegistro };
  const audio = objeto(m.audioMessage);
  if (audio) return { tipo: 'audio', texto: null, midia: midiaDe(audio), cita: stanzaDe(audio) ?? citaDoRegistro };
  const documento = objeto(m.documentMessage);
  if (documento) return { tipo: 'document', texto: textoDaMensagem(documento.caption), midia: midiaDe(documento, true), cita: stanzaDe(documento) ?? citaDoRegistro };
  const figurinha = objeto(m.stickerMessage);
  if (figurinha) return { tipo: 'sticker', texto: null, midia: midiaDe(figurinha), cita: stanzaDe(figurinha) ?? citaDoRegistro };

  const contato = objeto(m.contactMessage);
  const contatos = objeto(m.contactsArrayMessage);
  if (contato || contatos) {
    const nome = umaLinha(contato?.displayName, 200) ?? umaLinha(contatos?.displayName, 200);
    return { tipo: 'contato', texto: nome, midia: null, cita: stanzaDe(contato, contatos) ?? citaDoRegistro };
  }
  const local = objeto(m.locationMessage) ?? objeto(m.liveLocationMessage);
  if (local) return { tipo: 'localizacao', texto: umaLinha(local.name, 300) ?? umaLinha(local.address, 300), midia: null, cita: citaDoRegistro };
  const enquete = objeto(m.pollCreationMessage) ?? objeto(m.pollCreationMessageV2) ?? objeto(m.pollCreationMessageV3);
  if (enquete) return { tipo: 'enquete', texto: textoDaMensagem(enquete.name), midia: null, cita: citaDoRegistro };
  if (objeto(m.pollUpdateMessage)) return { tipo: 'enquete', texto: null, midia: null, cita: umaLinha(objeto(objeto(m.pollUpdateMessage)?.pollCreationMessageKey)?.id, 200) };

  // Só o que acompanha conteúdo (distribuição de chave de grupo) e nada mais: aviso do WhatsApp.
  if (!chaves.length && Object.keys(m).length) return { tipo: 'protocolo', texto: null, midia: null, cita: null };
  return { tipo: 'outro', texto: null, midia: null, cita: citaDoRegistro };
}

// --------------------------------------------------------------- o registro

/**
 * Um item de mensagem da Evolution v2 (o `data` do webhook ou um registro de
 * `chat/findMessages`) → a linha a gravar, ou o motivo de não gravar.
 */
export function lerRegistroDaEvolution(item: unknown, agora: Date = new Date()): LeituraDeRegistro {
  const r = objeto(item);
  if (!r) return { ignorado: 'sem mensagem' };
  const key = objeto(r.key);
  if (!key) return { ignorado: 'sem key' };
  const id = typeof key.id === 'string' ? key.id.trim() : '';
  if (!id || id.length > 200 || /[\u0000-\u001f\s]/.test(id)) return { ignorado: 'sem id da mensagem' };
  const conversa = conversaDaKey(key);
  if ('ignorado' in conversa) return conversa;
  if (!objeto(r.message)) return { ignorado: 'sem conteúdo' };

  const deMim = key.fromMe === true;
  const nome = umaLinha(r.pushName, 120);
  let remetenteJid: string | null = null;
  let remetenteNumero: string | null = null;
  if (conversa.grupo) {
    const participante = typeof key.participant === 'string' ? key.participant.trim().toLowerCase() : '';
    const digitos = digitosDoJid(participante) ?? numeroDeCampos(key, ['participantAlt', 'participantPn']);
    remetenteNumero = digitos;
    remetenteJid = digitos ? `${digitos}@s.whatsapp.net` : lidCanonico(participante) ?? (participante || null);
  } else if (!deMim) {
    remetenteJid = conversa.chatJid;
    remetenteNumero = digitosDoJid(conversa.chatJid);
  }

  const c = conteudoDaMensagem(r.message, r.messageType, r.contextInfo);
  return {
    mensagem: {
      chatJid: conversa.chatJid,
      lidJid: conversa.lidJid,
      grupo: conversa.grupo,
      remetenteJid: remetenteJid && remetenteJid.length <= 120 ? remetenteJid : null,
      remetenteNumero,
      remetenteNome: nome,
      deMim,
      direcao: deMim ? 'saida' : 'entrada',
      tipo: c.tipo,
      texto: c.texto,
      midia: c.midia,
      mensagemExternaId: id,
      citaMensagemExternaId: c.cita && c.cita !== id ? c.cita : null,
      timestamp: instanteDaEvolution(r.messageTimestamp, agora),
    },
  };
}

/** O nome do evento normalizado: `MESSAGES_UPSERT` e `messages.upsert` são o mesmo. */
export function nomeDoEvento(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase().replace(/_/g, '.') : '';
}

/** Os eventos que trazem mensagem nova (o que a casa mandou pela API também chega como `send.message`). */
const EVENTOS_DE_MENSAGEM = new Set(['messages.upsert', 'send.message']);

/** O corpo inteiro do webhook da Evolution → o que ele é. */
export function lerCorpoDoWebhook(corpo: unknown, agora: Date = new Date()): LeituraDoWebhook {
  const raiz = objeto(corpo);
  const instancia = umaLinha(raiz?.instance, 100);
  if (!raiz) return { tipo: 'ignorado', instancia: null, motivo: 'corpo vazio' };
  const evento = nomeDoEvento(raiz.event);
  if (evento === 'connection.update') {
    const s = texto(objeto(raiz.data)?.state);
    const estado: EstadoDaConexao = s === 'open' || s === 'connecting' || s === 'close' ? s : 'desconhecido';
    return { tipo: 'conexao', instancia, estado };
  }
  if (!EVENTOS_DE_MENSAGEM.has(evento)) return { tipo: 'ignorado', instancia, motivo: `evento ${evento || 'sem nome'}` };
  const itens = Array.isArray(raiz.data) ? raiz.data : [raiz.data];
  const lidas: MensagemLida[] = [];
  const ignoradas: string[] = [];
  for (const item of itens.slice(0, 50)) {
    const l = lerRegistroDaEvolution(item, agora);
    if ('mensagem' in l) lidas.push(l.mensagem);
    else ignoradas.push(l.ignorado);
  }
  return { tipo: 'mensagens', instancia, lidas, ignoradas };
}

// ------------------------------------------------- chats e grupos (sincronização)

/** Uma URL de foto que a tela pode mostrar: só https, com teto. */
export function fotoValida(v: unknown): string | null {
  return typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) && v.length <= 2000 ? v : null;
}

export interface ChatLido {
  chatJid: string;
  lidJid: string | null;
  grupo: boolean;
  /** No 1:1, o nome do contato (pushName/nome); no grupo, `null` (o nome vem de `fetchAllGroups`). */
  nome: string | null;
  fotoUrl: string | null;
  /** O instante da última mensagem que a Evolution conhece, quando ela diz. */
  ultimaEm: Date | null;
}

/** Um item de `chat/findChats` → a conversa, ou `null` (recado, canal, forma desconhecida). */
export function lerChatDaEvolution(item: unknown, agora: Date = new Date()): ChatLido | null {
  const c = objeto(item);
  if (!c) return null;
  const ultima = objeto(c.lastMessage);
  const chaveDaUltima = objeto(ultima?.key);
  const remoteJid = typeof c.remoteJid === 'string' ? c.remoteJid : typeof c.id === 'string' && c.id.includes('@') ? c.id : null;
  if (!remoteJid) return null;
  // O número real de um chat `@lid` pode vir no próprio chat ou na key da última mensagem.
  const conversa = conversaDaKey({
    remoteJid,
    remoteJidAlt: c.remoteJidAlt ?? chaveDaUltima?.remoteJidAlt,
    senderPn: c.senderPn ?? chaveDaUltima?.senderPn,
  });
  if ('ignorado' in conversa) return null;
  const quandoCru = ultima?.messageTimestamp ?? null;
  const atualizado = typeof c.updatedAt === 'string' ? Date.parse(c.updatedAt) : NaN;
  const ultimaEm = quandoCru !== null ? instanteDaEvolution(quandoCru, agora) : Number.isFinite(atualizado) ? new Date(atualizado) : null;
  return {
    ...conversa,
    nome: conversa.grupo ? null : umaLinha(c.name, 120) ?? umaLinha(c.pushName, 120),
    fotoUrl: fotoValida(c.profilePicUrl),
    ultimaEm,
  };
}

export interface ParticipanteLido {
  numero: string | null;
  nome: string | null;
  admin: boolean;
}

export interface GrupoLido {
  chatJid: string;
  nome: string | null;
  fotoUrl: string | null;
  participantes: number | null;
  participantesLista: ParticipanteLido[] | null;
}

/** O teto da lista de participantes guardada (uma comunidade passa de centenas). */
export const TETO_DE_PARTICIPANTES = 1024;

/** Um item de `group/fetchAllGroups?getParticipants=true` → o grupo, ou `null`. */
export function lerGrupoDaEvolution(item: unknown): GrupoLido | null {
  const g = objeto(item);
  const jid = typeof g?.id === 'string' ? g.id.trim().toLowerCase() : '';
  if (!g || !GRUPO.test(jid)) return null;
  const crus = Array.isArray(g.participants) ? g.participants : null;
  const lista = crus
    ? crus.slice(0, TETO_DE_PARTICIPANTES).map((p): ParticipanteLido => {
        const o = objeto(p);
        const numeroDoParticipante = digitosDoJid(o?.id) ?? numeroDeCampos(o, ['phoneNumber', 'jid', 'pn']);
        return {
          numero: numeroDoParticipante,
          nome: umaLinha(o?.name, 120) ?? umaLinha(o?.notify, 120) ?? umaLinha(o?.pushName, 120),
          admin: o?.admin === 'admin' || o?.admin === 'superadmin',
        };
      })
    : null;
  const tamanho = numero(g.size);
  return {
    chatJid: jid,
    nome: umaLinha(g.subject, 200),
    fotoUrl: fotoValida(g.pictureUrl),
    participantes: crus ? crus.length : tamanho !== null && tamanho >= 0 ? tamanho : null,
    participantesLista: lista,
  };
}
