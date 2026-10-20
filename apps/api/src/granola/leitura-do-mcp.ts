import type { ReuniaoDoGranolaListada } from '../work/atas/fonte-do-granola';

/* ==========================================================================
 * A LEITURA DAS RESPOSTAS DO MCP DO GRANOLA (rodada da interface, 20/10/2026)
 * ==========================================================================
 *
 * PURO: recebe o resultado de uma chamada de ferramenta (`structuredContent`
 * e/ou blocos de texto) e devolve o formato do OS. Sem rede, sem banco.
 *
 * O FORMATO DE SAÍDA DAS FERRAMENTAS NÃO É DOCUMENTADO. A página oficial
 * (docs.granola.ai › MCP, lida em 20/10/2026) diz O QUE cada ferramenta traz
 * (`list_meetings`: id, título, data e participantes; `get_meetings`: notas,
 * resumo, participantes e metadados; `get_meeting_transcript`: a transcrição
 * crua, cortada em `max_chars` com `next_offset`), mas não o formato do texto.
 * Por isso a leitura é TOLERANTE e em camadas, e o que ela não reconhece vira
 * erro dito, nunca lista vazia calada:
 *   1. `structuredContent`, quando o servidor manda;
 *   2. texto que é JSON (objeto ou lista);
 *   3. texto em marcação (`<meeting id="…" title="…" date="…">` com os
 *      participantes dentro), a forma que os clientes do MCP do Granola citam.
 * Conferir contra o servidor real é [a decidir] da U5: a prova desta lane é
 * com dublê, e o dublê fala as três formas.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export interface ResultadoDeFerramenta {
  structuredContent?: unknown;
  content?: unknown;
  isError?: boolean;
}

/** Os textos de um resultado de ferramenta. */
export function textosDoResultado(r: ResultadoDeFerramenta): string[] {
  const blocos = Array.isArray(r.content) ? r.content : [];
  return blocos
    .filter((b): b is { type: string; text: string } => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')
    .map((b) => b.text);
}

function jsonOuNulo(texto: string): unknown {
  const t = texto.trim();
  if (!t || !/^[[{]/.test(t)) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function dataIso(v: unknown): string | null {
  const s = str(v) ?? (typeof v === 'number' ? String(v) : null);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function desentidade(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Um participante como texto: "Nome <email>", "Nome" ou "email". */
function participanteComoTexto(p: unknown): string | null {
  if (typeof p === 'string') return p.replace(/\s+/g, ' ').trim() || null;
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const nome = str(o.name) ?? str(o.nome) ?? str(o.display_name) ?? str(o.full_name);
  const email = str(o.email) ?? str(o.mail);
  if (nome && email) return `${nome} <${email}>`;
  return nome ?? email;
}

function participantesDe(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(participanteComoTexto).filter((x): x is string => !!x).slice(0, 60);
  if (typeof v === 'string') {
    return v
      .split(/[\n,;]+/)
      .map((x) => x.replace(/^\s*[-*]\s*/, '').replace(/\s+/g, ' ').trim())
      .filter((x) => x.length >= 2)
      .slice(0, 60);
  }
  return [];
}

function emailsDe(participantes: string[], extra: unknown[] = []): string[] {
  const todos = [...participantes, ...extra.map((x) => (typeof x === 'string' ? x : ''))].join(' ');
  return [...new Set((todos.match(EMAIL) ?? []).map((e) => e.toLowerCase()))];
}

function reuniaoDoObjeto(o: Record<string, unknown>): ReuniaoDoGranolaListada | null {
  const id = str(o.id) ?? str(o.meeting_id) ?? str(o.document_id) ?? str(o.note_id) ?? str(o.uuid);
  if (!id) return null;
  const evento = o.calendar_event && typeof o.calendar_event === 'object' ? (o.calendar_event as Record<string, unknown>) : null;
  const participantes = participantesDe(o.attendees ?? o.participants ?? o.known_participants ?? o.participantes ?? evento?.invitees);
  const dono = participanteComoTexto(o.owner ?? o.creator);
  return {
    id,
    titulo: (str(o.title) ?? str(o.titulo) ?? str(o.name) ?? 'Reunião sem título').slice(0, 200),
    em: dataIso(o.date ?? o.start_time ?? o.started_at ?? o.created_at ?? o.meeting_date ?? evento?.scheduled_start_time),
    participantes,
    emails: emailsDe(participantes, [dono]),
    link: str(o.web_url) ?? str(o.url) ?? str(o.link) ?? null,
  };
}

/** A lista de objetos de reunião dentro de um JSON qualquer. */
function objetosDeReuniao(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  if (!v || typeof v !== 'object') return [];
  const o = v as Record<string, unknown>;
  for (const chave of ['meetings', 'notes', 'documents', 'items', 'results', 'data']) {
    if (Array.isArray(o[chave])) return objetosDeReuniao(o[chave]);
  }
  return reuniaoDoObjeto(o) ? [o] : [];
}

function atributos(s: string): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) saida[m[1].toLowerCase()] = desentidade(m[2]);
  return saida;
}

/** A forma em marcação: `<meeting id=… title=… date=…>…participantes…</meeting>`. */
function reunioesDaMarcacao(texto: string): ReuniaoDoGranolaListada[] {
  const saida: ReuniaoDoGranolaListada[] = [];
  for (const m of texto.matchAll(/<(meeting|document|note)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const at = atributos(m[2]);
    const id = at.id ?? at.meeting_id ?? at.document_id;
    if (!id) continue;
    const dentro = m[3];
    const bloco = /<(known_participants|participants|attendees)>([\s\S]*?)<\/\1>/i.exec(dentro);
    const participantes = participantesDe(bloco ? desentidade(bloco[2]) : (at.attendees ?? at.participants ?? ''));
    saida.push({
      id,
      titulo: (at.title ?? at.titulo ?? 'Reunião sem título').slice(0, 200),
      em: dataIso(at.date ?? at.start_time ?? at.created_at),
      participantes,
      emails: emailsDe(participantes),
      link: at.web_url ?? at.url ?? at.link ?? null,
    });
  }
  return saida;
}

export class FormatoDoGranolaError extends Error {
  constructor(onde: string) {
    super(`O Granola respondeu ${onde} num formato que o OS não sabe ler. Avise quem cuida das integrações.`);
    this.name = 'FormatoDoGranolaError';
  }
}

/**
 * As reuniões de um `list_meetings` (ou `get_meetings`). Lista vazia só quando
 * a resposta DIZ que não há reunião (lista vazia, contagem zero, frase de nada
 * encontrado); formato desconhecido lança.
 */
export function lerReunioes(r: ResultadoDeFerramenta, onde = 'a lista de reuniões'): ReuniaoDoGranolaListada[] {
  const vistas = new Map<string, ReuniaoDoGranolaListada>();
  const juntar = (lista: ReuniaoDoGranolaListada[]) => {
    for (const x of lista) if (!vistas.has(x.id)) vistas.set(x.id, x);
  };
  let reconhecida = false;

  if (r.structuredContent && typeof r.structuredContent === 'object') {
    const objs = objetosDeReuniao(r.structuredContent);
    reconhecida = true;
    juntar(objs.map(reuniaoDoObjeto).filter((x): x is ReuniaoDoGranolaListada => !!x));
  }
  for (const texto of textosDoResultado(r)) {
    const j = jsonOuNulo(texto);
    if (j !== null) {
      reconhecida = true;
      juntar(objetosDeReuniao(j).map(reuniaoDoObjeto).filter((x): x is ReuniaoDoGranolaListada => !!x));
      continue;
    }
    const marcadas = reunioesDaMarcacao(texto);
    if (marcadas.length) {
      reconhecida = true;
      juntar(marcadas);
      continue;
    }
    if (/count\s*=\s*"0"|\bno meetings\b|\bnenhuma reuni|\bnot found\b|<meetings[^>]*\/>/i.test(texto)) reconhecida = true;
  }
  if (!reconhecida) throw new FormatoDoGranolaError(onde);
  return [...vistas.values()].sort((a, b) => (b.em ?? '').localeCompare(a.em ?? ''));
}

export interface PedacoDaTranscricao {
  texto: string;
  /** O deslocamento para pedir o próximo pedaço, quando a resposta veio cortada. */
  proximo: number | null;
}

function falaDoSegmento(s: unknown): string | null {
  if (typeof s === 'string') return s;
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const texto = str(o.text) ?? str(o.texto) ?? str(o.content);
  if (!texto) return null;
  const sp = o.speaker && typeof o.speaker === 'object' ? (o.speaker as Record<string, unknown>) : null;
  const quem = str(o.speaker) ?? str(sp?.name) ?? str(sp?.diarization_label) ?? (sp?.source === 'microphone' ? 'Eu' : sp?.source === 'speaker' ? 'Outro' : null);
  return quem ? `${quem}: ${texto}` : texto;
}

/**
 * Um pedaço da transcrição de `get_meeting_transcript`. Aceita JSON (`transcript`
 * como texto ou lista de falas, `next_offset`) ou texto cru, com a marca do
 * próximo pedaço (`next_offset`) tirada do texto. Nada aqui é logado.
 */
export function lerPedacoDaTranscricao(r: ResultadoDeFerramenta): PedacoDaTranscricao {
  const partes: string[] = [];
  let proximo: number | null = null;
  const anotarProximo = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null;
    if (n !== null && Number.isFinite(n) && n > 0) proximo = n;
  };
  const doObjeto = (o: Record<string, unknown>) => {
    anotarProximo(o.next_offset ?? o.nextOffset);
    const t = o.transcript ?? o.transcricao ?? o.text ?? o.content;
    if (typeof t === 'string') partes.push(t);
    else if (Array.isArray(t)) partes.push(t.map(falaDoSegmento).filter(Boolean).join('\n'));
  };
  if (r.structuredContent && typeof r.structuredContent === 'object' && !Array.isArray(r.structuredContent)) {
    doObjeto(r.structuredContent as Record<string, unknown>);
  }
  if (!partes.length) {
    for (const texto of textosDoResultado(r)) {
      const j = jsonOuNulo(texto);
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        doObjeto(j as Record<string, unknown>);
        continue;
      }
      if (Array.isArray(j)) {
        partes.push(j.map(falaDoSegmento).filter(Boolean).join('\n'));
        continue;
      }
      // Texto cru: a marca do próximo pedaço sai do texto, e a moldura (`<transcript …>`) também.
      let t = texto;
      const marca = /next_offset\s*[:=]\s*"?(\d+)"?/i.exec(t);
      if (marca) anotarProximo(marca[1]);
      t = t.replace(/<\/?transcript\b[^>]*>/gi, '');
      t = t.replace(/^\s*[([]?\s*next_offset\s*[:=]\s*"?\d+"?\s*[)\]]?\s*$/gim, '');
      partes.push(desentidade(t));
    }
  }
  return { texto: partes.join('\n').replace(/\r\n/g, '\n').trim(), proximo };
}
