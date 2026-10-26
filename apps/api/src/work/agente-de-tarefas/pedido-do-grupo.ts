import { z } from 'zod';
import type { TarefaDoDia } from '@mktos/shared';

import { chaveDeIdentidadeWhatsapp } from '../../gateway/canais/identidade-de-canal';
import { EVENTO_ACEITO } from '../../gateway/canais/resposta-de-canal';

/*
 * O AGENTE DE TAREFAS (TR-12) — a parte que não fala com banco nem com modelo.
 *
 * O grupo da equipe é conversa, e "tarefa" aparece nela o tempo todo. Por isso
 * o agente só olha a mensagem que MARCA o número comercial com @ (pedido do
 * Lucas, 26/10/2026). O resto do texto é o pedido:
 *
 *   @Root tarefa pro Pedro: revisar contrato da Custeio até sexta
 *   @Root tarefas atrasadas
 *   @Root minhas tarefas
 *   @Root tarefa concluída: revisar contrato da Custeio
 *   @Root confirmar             (cria a parecida que ele segurou)
 *
 * O WhatsApp marca pelo telefone ou pelo código interno do grupo (`@lid`);
 * `AGENTE_TAREFAS_MENCOES` traz os dois. Sem marcação, nada, e sem custo.
 */

export interface PedidoDoGrupo {
  /** O texto sem a marcação. Vazio = ajuda. */
  texto: string;
  /** Telefone de quem escreveu, só dígitos, ou `null` quando o WhatsApp não mostrou. */
  telefone: string | null;
  /** O nome que aparece no WhatsApp (pushName), só para a resposta e o registro. */
  nome: string | null;
  mensagemId: string | null;
  /** Só "tarefas" depois da marcação: pedido de lista. */
  plural: boolean;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function textoDigitado(message: Record<string, unknown> | null): string | null {
  if (!message) return null;
  if (typeof message.conversation === 'string') return message.conversation;
  const ext = objeto(message.extendedTextMessage);
  return typeof ext?.text === 'string' ? ext.text : null;
}

/** O telefone de quem escreveu no grupo: `participant`, ou o número real ao lado de um `@lid`. */
function telefoneDoParticipante(key: Record<string, unknown>): string | null {
  for (const campo of ['participant', 'participantAlt', 'participantPn', 'senderPn'] as const) {
    const chave = chaveDeIdentidadeWhatsapp(key[campo]);
    if (chave) return chave;
  }
  return null;
}

/** A parte antes do @ de um JID (`5532…@s.whatsapp.net`, `6361…@lid`) ou o número cru. */
function idDoJid(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const id = v.trim().toLowerCase().split('@')[0].split(':')[0];
  return /^\d{5,30}$/.test(id) ? id : null;
}

/** Quem a mensagem marcou: o `mentionedJid` da mensagem ou o do corpo do webhook. */
function marcados(data: Record<string, unknown> | null): string[] {
  const listas = [
    objeto(objeto(objeto(data?.message)?.extendedTextMessage)?.contextInfo)?.mentionedJid,
    objeto(data?.contextInfo)?.mentionedJid,
  ];
  return listas.flatMap((l) => (Array.isArray(l) ? l : [])).map(idDoJid).filter((x): x is string => !!x);
}

/** `AGENTE_TAREFAS_MENCOES` ("5532936180013,63617827360770") em ids. */
export function idsDoAgente(lista: string | undefined): string[] {
  return (lista ?? '').split(/[,\s]+/).map(idDoJid).filter((x): x is string => !!x);
}

/**
 * A mensagem nova do grupo `jid` que marca o agente, ou `null`: outro evento,
 * outro grupo, eco da própria instância (a resposta do agente) ou mensagem que
 * não marcou nenhum dos `ids`.
 */
export function lerPedidoDoGrupo(evento: unknown, jid: string, ids: string[]): PedidoDoGrupo | null {
  if (ids.length === 0) return null;
  const raiz = objeto(evento);
  if (typeof raiz?.event !== 'string' || raiz.event.trim().toLowerCase() !== EVENTO_ACEITO) return null;
  const data = objeto(raiz.data);
  const key = objeto(data?.key);
  if (!key || key.fromMe === true) return null;
  if (typeof key.remoteJid !== 'string' || key.remoteJid.trim().toLowerCase() !== jid.trim().toLowerCase()) return null;
  if (!marcados(data).some((m) => ids.includes(m))) return null;
  const bruto = textoDigitado(objeto(data?.message)) ?? '';
  // Tira só as marcações do agente; as de outras pessoas ("@Pedro") ficam, são parte do pedido.
  const texto = ids.reduce((t, id) => t.split(`@${id}`).join(' '), bruto).replace(/\s+/g, ' ').trim().slice(0, 1000);
  return {
    texto,
    telefone: telefoneDoParticipante(key),
    nome: typeof data?.pushName === 'string' && data.pushName.trim() ? data.pushName.trim() : null,
    mensagemId: typeof key.id === 'string' ? key.id : null,
    plural: /^\/?tarefas[.!]?$/i.test(texto),
  };
}

/**
 * O mesmo celular brasileiro escrito de dois jeitos? O WhatsApp manda
 * `553291486277` (sem o 9 da frente, em contas antigas) e o cadastro pode ter
 * `(32) 99148-6277`. Compara DDD + os 8 últimos dígitos; fora do Brasil, os 10
 * últimos.
 */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = (a ?? '').replace(/\D/g, '');
  const db = (b ?? '').replace(/\D/g, '');
  if (da.length < 8 || db.length < 8) return false;
  const nacional = (d: string) => (d.startsWith('55') && d.length >= 12 ? d.slice(2) : d);
  const na = nacional(da);
  const nb = nacional(db);
  const chave = (d: string) => (d.length >= 10 && d.length <= 11 ? d.slice(0, 2) + d.slice(-8) : d.slice(-10));
  return chave(na) === chave(nb);
}

// ---------------------------------------------------------------- o comando

/** O que o modelo devolve. Tudo opcional menos a ação: a conferência é daqui. */
export const ComandoSchema = z.object({
  acao: z.enum(['criar', 'listar', 'concluir', 'alterar', 'ajuda']),
  titulo: z.string().trim().max(300).nullish(),
  /** Nome da pessoa como está na equipe; "eu" vira quem pediu. */
  pessoa: z.string().trim().max(80).nullish(),
  area: z.string().trim().max(60).nullish(),
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  /** Para concluir/alterar: o número da tarefa na lista que o modelo recebeu. */
  tarefa: z.number().int().positive().nullish(),
  /** Para listar. */
  filtro: z.enum(['todas', 'atrasadas', 'hoje', 'semana']).nullish(),
});
export type Comando = z.infer<typeof ComandoSchema>;

/** O JSON do modelo, mesmo cercado de texto ou de crase. `null` quando não dá para ler. */
export function lerComando(saida: string): Comando | null {
  const m = /\{[\s\S]*\}/.exec(saida);
  if (!m) return null;
  try {
    const r = ComandoSchema.safeParse(JSON.parse(m[0]));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export interface ContextoDoModelo {
  hoje: string;
  diaDaSemana: string;
  quemPediu: string;
  pessoas: string[];
  areas: string[];
  /** As abertas, na ordem em que o modelo pode citá-las (1 = primeira). */
  abertas: Pick<TarefaDoDia, 'titulo' | 'prazo' | 'pessoa'>[];
}

export const MAXIMO_DE_ABERTAS_NO_CONTEXTO = 150;

export function promptDoSistema(c: ContextoDoModelo): string {
  const abertas = c.abertas
    .slice(0, MAXIMO_DE_ABERTAS_NO_CONTEXTO)
    .map((t, i) => `${i + 1}. ${t.titulo}${t.pessoa ? ` — ${t.pessoa.nome}` : ''}${t.prazo ? ` — prazo ${t.prazo}` : ''}`)
    .join('\n');
  return [
    'Você transforma um pedido de tarefa, escrito no WhatsApp da equipe da ROOT, num comando JSON.',
    'Responda SÓ o JSON, sem texto em volta.',
    '',
    'Formato: {"acao": "criar"|"listar"|"concluir"|"alterar"|"ajuda", "titulo": string, "pessoa": string, "area": string, "prazo": "AAAA-MM-DD", "tarefa": número, "filtro": "todas"|"atrasadas"|"hoje"|"semana"}',
    'Use só os campos que o pedido traz. Nunca invente pessoa, área ou prazo.',
    '',
    '- criar: "titulo" curto e no infinitivo (ex.: "Revisar contrato da Custeio"), sem a pessoa e sem o prazo dentro dele.',
    '- listar: "pessoa" quando o pedido cita alguém ("minhas" = quem pediu); "filtro" quando cita atraso, hoje ou semana.',
    '- concluir e alterar: "tarefa" é o número da tarefa na lista abaixo. Se nenhuma bate com segurança, não mande "tarefa".',
    '- alterar: mande só o que muda ("prazo" e/ou "pessoa").',
    '- ajuda: quando o pedido não é nenhum dos outros.',
    '',
    `Hoje é ${c.diaDaSemana}, ${c.hoje} (horário de Brasília). "Sexta" é a próxima sexta; "amanhã" é o dia seguinte.`,
    `Quem pediu: ${c.quemPediu}.`,
    `Pessoas da equipe: ${c.pessoas.join(', ') || 'nenhuma'}.`,
    `Áreas: ${c.areas.join(', ') || 'nenhuma'}.`,
    '',
    'Tarefas abertas:',
    abertas || '(nenhuma)',
  ].join('\n');
}

// ---------------------------------------------------------------- a resposta

/** Nome sem acento e minúsculo, para casar "joao" com "João". */
export function nomeComparavel(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** A pessoa da equipe pelo nome que o modelo devolveu: exato, depois primeiro nome. */
export function acharPorNome<T extends { nome: string }>(lista: T[], nome: string | null | undefined): T | null {
  if (!nome) return null;
  const alvo = nomeComparavel(nome);
  if (!alvo) return null;
  return (
    lista.find((p) => nomeComparavel(p.nome) === alvo) ??
    lista.find((p) => nomeComparavel(p.nome).split(/\s+/)[0] === alvo.split(/\s+/)[0]) ??
    null
  );
}

export function diaCurto(dia: string | null): string {
  if (!dia) return 'sem prazo';
  const [, m, d] = dia.split('-');
  return `${d}/${m}`;
}

export function linhaDaTarefa(t: Pick<TarefaDoDia, 'titulo' | 'prazo' | 'pessoa' | 'situacao'>): string {
  const atraso = t.situacao === 'atrasada' ? ' ⚠️' : '';
  return `• ${t.titulo} — ${t.pessoa?.nome ?? 'sem responsável'} — ${diaCurto(t.prazo)}${atraso}`;
}

export const AJUDA = [
  'Sou o agente de tarefas. Me marque com @ e diga o que precisa:',
  '• @Root tarefa pro Pedro: revisar contrato da Custeio até sexta',
  '• @Root tarefas atrasadas  /  tarefas do Rodrigo  /  minhas tarefas',
  '• @Root tarefa concluída: revisar contrato da Custeio',
  '• @Root muda o prazo de revisar contrato para dia 30',
].join('\n');

export const LIMITE_DA_LISTA = 15;
