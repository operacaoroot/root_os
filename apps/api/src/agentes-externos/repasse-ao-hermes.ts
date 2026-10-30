import { createHmac } from 'node:crypto';

import { EVENTO_ACEITO } from '../gateway/canais/resposta-de-canal';
import { chaveDeIdentidadeWhatsapp, ehGrupoDeWhatsapp, remetenteDaKey } from '../gateway/canais/identidade-de-canal';

/*
 * ============================================================================
 * O REPASSE AO HERMES — QUAIS MENSAGENS SÃO DA ROOTINHA (A9, 30/10/2026), puro
 * ============================================================================
 *
 * Do webhook da Evolution, a Rootinha só recebe o que é dela:
 *
 *   · CONVERSA DIRETA de pessoa da equipe (o telefone casa com `User.phone` de
 *     um usuário ativo, a regra do agente de tarefas TR-12). Ali ela é a colega
 *     de quem escreveu, e não precisa ser chamada pelo nome;
 *   · em GRUPO, ou em conversa direta com quem NÃO é da equipe (cliente, lead),
 *     só quando a mensagem cita "Rootinha" pelo nome. Fora isso, o que se diz no
 *     grupo não é com ela, e mandar para fora seria vazar conversa à toa.
 *
 * E NUNCA: eco do próprio número, evento que não é mensagem nova, mensagem sem
 * texto, e resposta de decisão do canal de aprovação ("APROVAR ROOT-…") — essa
 * é do canal, e a Rootinha responder em cima confundiria quem decide.
 *
 * O que vai junto: quem escreveu (a pessoa da equipe, quando há) e se o texto é
 * de TERCEIRO (`deFora`). O Hermes devolve essa marca na rota de execução, e o
 * OS confere de novo pela mensagem gravada — a marca só sobe.
 */

export const CABECALHO_DA_ASSINATURA = 'x-rootos-assinatura';
export const CABECALHO_DO_INSTANTE = 'x-rootos-instante';
/** Curto de propósito: o repasse corre ao lado do webhook, e o Hermes fora do ar não pode segurar nada. */
export const PRAZO_DO_REPASSE_MS = 3_000;
/** O segredo da assinatura precisa de tamanho de segredo (a mesma régua do canal de aprovação). */
export const TAMANHO_MINIMO_DO_SEGREDO = 32;

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** O texto digitado: `conversation`, `extendedTextMessage.text` ou a legenda de mídia. */
export function textoDaMensagem(message: Record<string, unknown> | null): string | null {
  if (!message) return null;
  if (typeof message.conversation === 'string') return message.conversation;
  for (const campo of ['extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage'] as const) {
    const m = objeto(message[campo]);
    const t = m?.text ?? m?.caption;
    if (typeof t === 'string') return t;
  }
  return null;
}

/** "Rootinha" como palavra, sem diferença de caixa nem acento (`@rootinha`, `ROOTINHA,`). */
export function citaRootinha(texto: string, nome = 'Rootinha'): boolean {
  const limpar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return new RegExp(`(^|[^a-z0-9])${limpar(nome)}([^a-z0-9]|$)`).test(limpar(texto));
}

/** A resposta de decisão do canal de aprovação — é do canal, não da Rootinha. */
export function ehDecisaoDoCanal(texto: string): boolean {
  return /^\s*(APROVAR|RECUSAR)\b/i.test(texto);
}

export interface MensagemLida {
  mensagemId: string;
  chatJid: string;
  grupo: boolean;
  /** Os dígitos de quem escreveu (o participante, no grupo), quando dá para saber. */
  remetente: string | null;
  nome: string | null;
  texto: string;
  timestamp: number | null;
}

/** A mensagem nova de um `messages.upsert`, ou `null` (outro evento, eco, sem texto, sem id). */
export function lerMensagem(evento: unknown): MensagemLida | null {
  const raiz = objeto(evento);
  if (typeof raiz?.event !== 'string' || raiz.event.trim().toLowerCase() !== EVENTO_ACEITO) return null;
  const data = objeto(raiz.data);
  const key = objeto(data?.key);
  if (!key || key.fromMe === true) return null;
  const chatJid = typeof key.remoteJid === 'string' ? key.remoteJid.trim().toLowerCase() : '';
  const mensagemId = typeof key.id === 'string' ? key.id : '';
  if (!chatJid || !mensagemId) return null;
  const texto = textoDaMensagem(objeto(data?.message))?.trim() ?? '';
  if (!texto) return null;
  const grupo = ehGrupoDeWhatsapp(chatJid);
  let remetente: string | null = null;
  if (grupo) {
    for (const campo of ['participant', 'participantAlt', 'participantPn', 'senderPn'] as const) {
      remetente = chaveDeIdentidadeWhatsapp(key[campo]);
      if (remetente) break;
    }
  } else {
    const r = remetenteDaKey(key);
    remetente = r && 'chave' in r ? r.chave : null;
  }
  const ts = Number(data?.messageTimestamp);
  return {
    mensagemId,
    chatJid,
    grupo,
    remetente,
    nome: typeof data?.pushName === 'string' ? data.pushName : null,
    texto,
    timestamp: Number.isFinite(ts) && ts > 0 ? ts : null,
  };
}

export interface PessoaDaEquipe {
  id: string;
  nome: string;
}

export type DecisaoDoRepasse =
  | { repassar: false; motivo: string }
  | { repassar: true; motivo: 'direta-da-equipe' | 'citou-rootinha'; deFora: boolean; pessoa: PessoaDaEquipe | null };

/**
 * A regra inteira, pura. `pessoa` é quem escreveu, já casado pelo telefone
 * (quem chama faz a consulta), ou `null` quando não é da equipe.
 */
export function decidirRepasse(m: MensagemLida, pessoa: PessoaDaEquipe | null, nome = 'Rootinha'): DecisaoDoRepasse {
  if (ehDecisaoDoCanal(m.texto)) return { repassar: false, motivo: 'decisão do canal de aprovação' };
  if (!m.grupo && pessoa) return { repassar: true, motivo: 'direta-da-equipe', deFora: false, pessoa };
  if (citaRootinha(m.texto, nome)) return { repassar: true, motivo: 'citou-rootinha', deFora: !pessoa, pessoa };
  return { repassar: false, motivo: m.grupo ? 'grupo sem citar a Rootinha' : 'conversa de fora sem citar a Rootinha' };
}

/** O que o Hermes recebe. A instância e o corpo cru da Evolution ficam de fora. */
export function corpoDoRepasse(orgId: string, m: MensagemLida, d: Extract<DecisaoDoRepasse, { repassar: true }>) {
  return {
    tipo: 'rootos.whatsapp.mensagem',
    orgId,
    mensagemId: m.mensagemId,
    conversa: m.chatJid,
    grupo: m.grupo,
    remetente: m.remetente,
    nome: m.nome,
    texto: m.texto,
    timestamp: m.timestamp,
    motivo: d.motivo,
    deFora: d.deFora,
    pessoa: d.pessoa,
    // Como responder: a capacidade que fala na MESMA conversa, citando esta mensagem.
    responderCom: { capacidade: 'whatsapp.conversa.responder', mensagemId: m.mensagemId },
  };
}

/**
 * A assinatura: HMAC-SHA256 de `<instante>.<corpo>`, em hex. O instante entra
 * para o Hermes recusar repetição velha (ele confere a janela); o corpo é o
 * texto EXATO enviado.
 */
export function assinar(segredo: string, instante: string, corpo: string): string {
  return createHmac('sha256', segredo).update(`${instante}.${corpo}`).digest('hex');
}

/** As duas variáveis: as duas, ou nenhuma. Metade configurado é desligado, com o motivo. */
export function configuracaoDoRepasse(env: Readonly<Record<string, string | undefined>>):
  | { ligado: true; url: string; segredo: string }
  | { ligado: false; motivo: string } {
  const url = (env.ROOTINHA_WEBHOOK_URL ?? '').trim();
  const segredo = (env.ROOTINHA_WEBHOOK_SEGREDO ?? '').trim();
  if (!url && !segredo) return { ligado: false, motivo: 'ROOTINHA_WEBHOOK_URL e ROOTINHA_WEBHOOK_SEGREDO vazios' };
  if (!url || !segredo) return { ligado: false, motivo: 'só uma das duas variáveis da Rootinha está definida: o repasse fica desligado' };
  if (segredo.length < TAMANHO_MINIMO_DO_SEGREDO) {
    return { ligado: false, motivo: `ROOTINHA_WEBHOOK_SEGREDO precisa de ${TAMANHO_MINIMO_DO_SEGREDO}+ caracteres: o repasse fica desligado` };
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ligado: false, motivo: 'ROOTINHA_WEBHOOK_URL não é URL: o repasse fica desligado' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ligado: false, motivo: 'ROOTINHA_WEBHOOK_URL precisa ser http(s)' };
  if (u.username || u.password) return { ligado: false, motivo: 'ROOTINHA_WEBHOOK_URL não leva usuário e senha' };
  return { ligado: true, url: u.toString(), segredo };
}
