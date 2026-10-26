import {
  FILTROS_DA_CAIXA,
  TETO_DA_RESPOSTA_DA_CAIXA,
  lerFiltroDaCaixa,
  partesNoFuso,
  rotuloDoTipoDeMensagem,
  somarDias,
  type ConversaDaCaixa,
  type FiltroDaCaixa,
  type MensagemDaCaixa,
  type PreviaDaConversa,
} from '@mktos/shared';

/*
 * AS REGRAS PURAS DA CAIXA DE WHATSAPP (produção 22C, W2): hora em São Paulo,
 * prévia da lista, o endereço da tela (filtro, busca e conversa aberta) e as
 * rotas da API. Fora da página porque `page.tsx` do App Router não pode
 * exportar nada além do componente, e porque o Dia a dia (lane D) monta os
 * mesmos links (`/whatsapp?filtro=leads`).
 */

export const FUSO_DA_CAIXA = 'America/Sao_Paulo';

/** O intervalo da releitura leve da lista e da conversa aberta (com a aba visível). */
export const RELEITURA_DA_CAIXA_MS = 15_000;

/** Quantas mensagens cada página da conversa traz. */
export const PAGINA_DA_CONVERSA = 50;

const TIPOS_DE_MIDIA = new Set(['image', 'video', 'audio', 'document', 'sticker']);

export function ehMidia(tipo: string): boolean {
  return TIPOS_DE_MIDIA.has(tipo);
}

function valida(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A hora da lista: hoje (em São Paulo) = "HH:mm"; ontem = "ontem"; antes = "dd/mm". */
export function horaDaLista(iso: string | null | undefined, agora: Date = new Date()): string {
  const d = valida(iso);
  if (!d) return '';
  const p = partesNoFuso(d, FUSO_DA_CAIXA);
  const hoje = partesNoFuso(agora, FUSO_DA_CAIXA).dia;
  if (p.dia === hoje) return p.hora;
  if (p.dia === somarDias(hoje, -1)) return 'ontem';
  const [, m, dd] = p.dia.split('-');
  return `${dd}/${m}`;
}

/** A hora do balão: sempre "HH:mm" em São Paulo. */
export function horaDoBalao(iso: string | null | undefined): string {
  const d = valida(iso);
  return d ? partesNoFuso(d, FUSO_DA_CAIXA).hora : '';
}

/** O dia civil (São Paulo) de um instante, `AAAA-MM-DD`. */
export function diaDoInstante(iso: string): string {
  const d = valida(iso);
  return d ? partesNoFuso(d, FUSO_DA_CAIXA).dia : '';
}

/** O separador de dia do histórico: "Hoje", "Ontem" ou "dd/mm/aaaa". */
export function rotuloDoDia(dia: string, agora: Date = new Date()): string {
  if (!dia) return '';
  const hoje = partesNoFuso(agora, FUSO_DA_CAIXA).dia;
  if (dia === hoje) return 'Hoje';
  if (dia === somarDias(hoje, -1)) return 'Ontem';
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/** O texto de uma mensagem sem texto: "📎 imagem" na mídia, o rótulo do tipo no resto. */
export function textoSemTexto(tipo: string): string {
  const rotulo = rotuloDoTipoDeMensagem(tipo);
  return ehMidia(tipo) ? `📎 ${rotulo}` : rotulo;
}

/**
 * A prévia da última mensagem na lista: "Você: " quando é da casa, o nome de quem
 * escreveu no grupo, e o texto ou "📎 <tipo>". Uma linha só.
 */
export function previaDaLista(previa: PreviaDaConversa | null, grupo: boolean): string {
  if (!previa) return 'Sem mensagens ainda';
  const corpo = previa.texto?.trim() ? previa.texto.replace(/\s+/g, ' ').trim() : textoSemTexto(previa.tipo);
  if (previa.deMim) return `Você: ${corpo}`;
  if (grupo && previa.remetenteNome?.trim()) return `${previa.remetenteNome.trim()}: ${corpo}`;
  return corpo;
}

/** O nome de quem escreveu um balão de grupo (nome, senão o número). */
export function remetenteDoBalao(m: Pick<MensagemDaCaixa, 'remetenteNome' | 'remetenteNumero'>): string {
  return m.remetenteNome?.trim() || (m.remetenteNumero ? `+${m.remetenteNumero}` : 'participante');
}

/** "1,2 MB", "830 KB", "512 B". */
export function tamanhoLegivel(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** "0:42", "12:05". */
export function duracaoLegivel(segundos: number | null | undefined): string {
  if (segundos == null || !Number.isFinite(segundos) || segundos < 0) return '';
  const s = Math.round(segundos);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// O endereço da tela
// ---------------------------------------------------------------------------

export interface EstadoDaCaixa {
  filtro: FiltroDaCaixa;
  q: string;
  conversa: string | null;
}

const ID_DA_CONVERSA = /^[A-Za-z0-9-]{1,64}$/;

/** Lê `?filtro=&q=&conversa=` do endereço. Filtro desconhecido vira Todas. */
export function estadoDoEndereco(search: string): EstadoDaCaixa {
  const p = new URLSearchParams(search);
  const conversa = p.get('conversa');
  return {
    filtro: lerFiltroDaCaixa(p.get('filtro')),
    q: (p.get('q') ?? '').slice(0, 100),
    conversa: conversa && ID_DA_CONVERSA.test(conversa) ? conversa : null,
  };
}

/** O endereço da caixa: `/whatsapp`, `/whatsapp?filtro=leads`, `/whatsapp?filtro=grupos&conversa=<id>`. */
export function enderecoDaCaixa(e: Partial<EstadoDaCaixa> = {}): string {
  const p = new URLSearchParams();
  if (e.filtro && e.filtro !== 'todas') p.set('filtro', e.filtro);
  if (e.q?.trim()) p.set('q', e.q.trim());
  if (e.conversa) p.set('conversa', e.conversa);
  const q = p.toString();
  return q ? `/whatsapp?${q}` : '/whatsapp';
}

/** A rota da lista na API. */
export function rotaDaLista(e: Pick<EstadoDaCaixa, 'filtro' | 'q'>, limite?: number): string {
  const p = new URLSearchParams();
  if (e.filtro !== 'todas') p.set('filtro', e.filtro);
  if (e.q.trim()) p.set('q', e.q.trim());
  if (limite) p.set('limite', String(limite));
  const q = p.toString();
  return q ? `/whatsapp/conversas?${q}` : '/whatsapp/conversas';
}

/** A rota de uma conversa na API, com o cursor das mais antigas quando houver. */
export function rotaDaConversa(id: string, antes?: Pick<MensagemDaCaixa, 'timestamp' | 'id'> | null, limite = PAGINA_DA_CONVERSA): string {
  const p = new URLSearchParams();
  if (antes) {
    p.set('antesDe', antes.timestamp);
    p.set('antesDeId', antes.id);
  }
  p.set('limite', String(limite));
  return `/whatsapp/conversas/${encodeURIComponent(id)}?${p.toString()}`;
}

/** Os chips na ordem da tela: Todas · Leads · Clientes · Grupos · Sem vínculo · Equipe · Comunidade (layout 26/10) e, no fim, Arquivadas. */
export const CHIPS_DA_CAIXA: readonly FiltroDaCaixa[] = FILTROS_DA_CAIXA;

// ---------------------------------------------------------------------------
// A resposta
// ---------------------------------------------------------------------------

/** Por que a caixa de resposta está desligada, ou null quando pode escrever. */
export function razaoParaNaoResponder(conversa: Pick<ConversaDaCaixa, 'arquivada'>, podeResponder: boolean): string | null {
  if (!podeResponder) return 'Responder pede a permissão de conversar no WhatsApp. Peça a quem administra a equipe.';
  if (conversa.arquivada) return 'Conversa arquivada. Volte-a para a caixa para responder.';
  return null;
}

/** O texto pode sair? Nem vazio nem acima do teto. */
export function textoEnviavel(texto: string): boolean {
  const t = texto.replace(/\r\n/g, '\n').trim();
  return t.length > 0 && t.length <= TETO_DA_RESPOSTA_DA_CAIXA;
}

/**
 * Junta a página de mensagens mais antigas com as já na tela, sem repetir
 * (a releitura e a paginação podem trazer a mesma mensagem), em ordem.
 */
export function juntarMensagens(a: MensagemDaCaixa[], b: MensagemDaCaixa[]): MensagemDaCaixa[] {
  const porId = new Map<string, MensagemDaCaixa>();
  for (const m of [...a, ...b]) porId.set(m.id, m);
  return [...porId.values()].sort((x, y) => (x.timestamp === y.timestamp ? (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) : x.timestamp < y.timestamp ? -1 : 1));
}

/**
 * Layout 26/10: o número de quem escreveu no grupo, como o WhatsApp mostra
 * ("+55 61 9862-8541"). Fora do Brasil, só com o "+".
 */
export function numeroDoBalao(numero: string | null | undefined): string | null {
  const n = (numero ?? '').replace(/\D/g, '');
  if (!n) return null;
  if (n.startsWith('55') && (n.length === 12 || n.length === 13)) {
    const resto = n.slice(4);
    return `+55 ${n.slice(2, 4)} ${resto.slice(0, -4)}-${resto.slice(-4)}`;
  }
  return `+${n}`;
}
