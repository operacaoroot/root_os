import { z } from 'zod';
import type { TarefaDoDia } from '@mktos/shared';

import { chaveDeIdentidadeWhatsapp } from '../../gateway/canais/identidade-de-canal';
import { EVENTO_ACEITO } from '../../gateway/canais/resposta-de-canal';

/*
 * O AGENTE DE TAREFAS (TR-12) — a parte que não fala com banco nem com modelo.
 *
 * O grupo da equipe é conversa. O agente só olha a mensagem que COMEÇA com
 * "tarefa" ou "tarefas" (com ou sem barra, maiúscula ou acento tanto faz):
 *
 *   tarefa pro Pedro: revisar contrato da Custeio até sexta
 *   tarefas atrasadas
 *   tarefas do Rodrigo
 *   tarefa concluída: revisar contrato da Custeio
 *   minhas tarefas
 *   tarefa confirmar            (cria a parecida que ele segurou)
 *
 * O resto do grupo passa direto, sem custo de modelo.
 */

export const GATILHO = /^\s*\/?\s*(minhas\s+)?tarefas?\b[\s:,.\-–]*/i;

export interface PedidoDoGrupo {
  /** O que vem depois de "tarefa". Pode ser vazio ("tarefas" sozinho = ajuda). */
  texto: string;
  /** Telefone de quem escreveu, só dígitos, ou `null` quando o WhatsApp não mostrou. */
  telefone: string | null;
  /** O nome que aparece no WhatsApp (pushName), só para a resposta e o registro. */
  nome: string | null;
  mensagemId: string | null;
  /** "tarefas" no plural e nada depois: pedido de lista. */
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

/**
 * A mensagem nova do grupo `jid` que é um pedido ao agente, ou `null`: outro
 * evento, outro grupo, eco da própria instância (a resposta do agente) ou texto
 * que não começa com o gatilho.
 */
export function lerPedidoDoGrupo(evento: unknown, jid: string): PedidoDoGrupo | null {
  const raiz = objeto(evento);
  if (typeof raiz?.event !== 'string' || raiz.event.trim().toLowerCase() !== EVENTO_ACEITO) return null;
  const data = objeto(raiz.data);
  const key = objeto(data?.key);
  if (!key || key.fromMe === true) return null;
  if (typeof key.remoteJid !== 'string' || key.remoteJid.trim().toLowerCase() !== jid.trim().toLowerCase()) return null;
  const bruto = textoDigitado(objeto(data?.message));
  if (!bruto) return null;
  const m = GATILHO.exec(bruto);
  if (!m) return null;
  const resto = bruto.slice(m[0].length).trim().slice(0, 1000);
  // "minhas tarefas" leva o "minhas" adiante: é o que diz de quem são.
  const texto = m[1] ? `minhas tarefas ${resto}`.trim() : resto;
  return {
    texto,
    telefone: telefoneDoParticipante(key),
    nome: typeof data?.pushName === 'string' && data.pushName.trim() ? data.pushName.trim() : null,
    mensagemId: typeof key.id === 'string' ? key.id : null,
    plural: /tarefas/i.test(m[0]) && resto === '',
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
  'Sou o agente de tarefas. Comece a mensagem com "tarefa":',
  '• tarefa pro Pedro: revisar contrato da Custeio até sexta',
  '• tarefas atrasadas  /  tarefas do Rodrigo  /  minhas tarefas',
  '• tarefa concluída: revisar contrato da Custeio',
  '• tarefa: mudar o prazo de revisar contrato para dia 30',
].join('\n');

export const LIMITE_DA_LISTA = 15;
