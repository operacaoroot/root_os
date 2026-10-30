import { z } from 'zod';

/*
 * MARKETING NO JEITO DO ROOT ESTÚDIO (26/10/2026). A lógica pura que veio do
 * Estúdio V1 (/srv/root-estudio-v1/src), portada para o OS: Memória (notas,
 * tags, [[ligações]], grafo, arquivo do Obsidian), Triagem de ideias (peso da
 * fonte, recência) e as réguas por formato. A API e a tela leem as mesmas regras.
 */

// ---------- Memória ----------

export const MEMORIA_PASTAS = ['Ideias', 'Links', 'Vídeos', 'Conhecimento', 'Diário'] as const;
export type MemoriaPasta = (typeof MEMORIA_PASTAS)[number];
export const MEMORIA_TIPOS = ['ideia', 'link', 'video', 'nota'] as const;
export type MemoriaTipo = (typeof MEMORIA_TIPOS)[number];
export const MEMORIA_STATUS = ['pronto', 'fila', 'processando', 'erro'] as const;
export type MemoriaStatus = (typeof MEMORIA_STATUS)[number];
export const MEMORIA_VIAS = ['app', 'whatsapp'] as const;
export type MemoriaVia = (typeof MEMORIA_VIAS)[number];

/** Onde as notas viram .md no Drive Root (decisão do Lucas, 26/10): já está no Obsidian dele. */
export const MEMORIA_PASTA_NO_DRIVE = ['40-marca-e-conteudo', 'Memória'] as const;

/*
 * DESTINO DA NOTA (29/10/2026, pedido do Lucas). Tudo que chega (grupo do WhatsApp,
 * caixa da tela, importação) cai na Entrada. Ao abrir a nota, a equipe decide:
 * vira Ideia de conteúdo (card em Marketing › Ideias), vira Referência externa
 * (material de fora para consultar, que NÃO é memória da empresa), ou as duas.
 * Apagar continua sendo o descarte. Os nomes da tela moram aqui.
 */
export const MEMORIA_DESTINOS = ['entrada', 'conteudo', 'referencia', 'conteudo_e_referencia'] as const;
export type MemoriaDestino = (typeof MEMORIA_DESTINOS)[number];
export const NOME_DO_DESTINO: Record<MemoriaDestino, string> = {
  entrada: 'Para decidir',
  conteudo: 'Ideia de conteúdo',
  referencia: 'Referência externa',
  conteudo_e_referencia: 'Conteúdo e referência',
};
export const vaiParaIdeias = (d: string | null | undefined): boolean => d === 'conteudo' || d === 'conteudo_e_referencia';
export const ficaComoReferencia = (d: string | null | undefined): boolean => d === 'referencia' || d === 'conteudo_e_referencia';

/** Do que o material trata. A IA sugere ao ler o link; a equipe confirma ao decidir. */
export const MEMORIA_ASSUNTOS = ['ferramenta', 'produto', 'conteudo', 'negocio'] as const;
export type MemoriaAssunto = (typeof MEMORIA_ASSUNTOS)[number];
export const NOME_DO_ASSUNTO: Record<MemoriaAssunto, string> = { ferramenta: 'Ferramenta', produto: 'Produto', conteudo: 'Conteúdo', negocio: 'Negócio' };
export const assuntoValido = (v: unknown): MemoriaAssunto | null =>
  (MEMORIA_ASSUNTOS as readonly string[]).includes(String(v ?? '').trim().toLowerCase()) ? (String(v).trim().toLowerCase() as MemoriaAssunto) : null;

export const MemoriaDestinoSchema = z.object({
  destino: z.enum(MEMORIA_DESTINOS),
  assunto: z.enum(MEMORIA_ASSUNTOS).nullable().optional(),
});
export type MemoriaDestinoInput = z.infer<typeof MemoriaDestinoSchema>;

/** Parâmetros que só rastreiam quem compartilhou: saem da chave do link. */
const RASTREIO = /^(utm_\w+|igsh|igshid|rpxt|fbclid|gclid|si|exln|dlrf|feature|ref|ref_src|s|t|_r|share_id|is_from_webapp|sender_device)$/i;

/**
 * A chave que diz se dois links são o mesmo material. Post do Instagram vale pelo
 * código (/p/, /reel/, /tv/, com ou sem perfil, www ou barra no fim); TikTok pelo
 * id do vídeo; YouTube pelo id. O resto: site sem www, caminho sem barra no fim e
 * sem os parâmetros de rastreio. Em 27/10 o grupo mandou instagram.com/p/X e a
 * Memória já tinha www.instagram.com/p/X/: virou nota repetida.
 */
export function chaveDoLink(raw: string): string {
  let u: URL;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    return String(raw || '').trim().toLowerCase();
  }
  const h = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const p = u.pathname;
  const ig = /instagram\.com$/.test(h) ? /^\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([\w-]+)/.exec(p) : null;
  if (ig) return `instagram:${ig[1]}`;
  const tt = /tiktok\.com$/.test(h) ? /\/video\/(\d+)/.exec(p) : null;
  if (tt) return `tiktok:${tt[1]}`;
  if (h === 'youtu.be' && p.length > 1) return `youtube:${p.slice(1).split('/')[0]}`;
  if (/youtube\.com$/.test(h)) {
    const v = u.searchParams.get('v') || /^\/(?:shorts|live|embed)\/([\w-]+)/.exec(p)?.[1];
    if (v) return `youtube:${v}`;
  }
  const qs = [...u.searchParams.entries()].filter(([k]) => !RASTREIO.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const busca = qs.length ? `?${qs.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
  return `${h}${p.replace(/\/+$/, '')}${busca}`;
}

/** O pedaço do link que com certeza aparece em qualquer forma dele (para a busca no banco). */
export function nucleoDoLink(raw: string): string {
  const k = chaveDoLink(raw);
  const m = /^(?:instagram|tiktok|youtube):(.+)$/.exec(k);
  return m ? m[1] : k.split('?')[0];
}

/** Texto de uma seção "## Título" do corpo da nota (até a próxima seção). */
export function secaoDoCorpo(corpo: string, titulo: string): string {
  const linhas = String(corpo || '').split(/\r?\n/);
  const i = linhas.findIndex((l) => new RegExp(`^##\\s+${titulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(l.trim()));
  if (i < 0) return '';
  const fim = linhas.findIndex((l, j) => j > i && /^##\s/.test(l.trim()));
  return linhas.slice(i + 1, fim < 0 ? undefined : fim).join('\n').trim();
}

/**
 * O card de Ideias montado só com o que a nota já tem, para quando a IA não responde.
 * A nota de vídeo já traz gancho e "Como adaptar"; a de link traz pontos e "Como usar".
 */
export function cardDaNotaSemIa(n: { titulo: string; resumo: string; corpo: string; tipo: string }): { title: string; summary: string; why: string; how: { format: string; hook: string }; key_points: string[] } {
  const topicosDe = (t: string) => t.split(/\n/).map((l) => /^\s*[-*]\s+(.+)$/.exec(l)?.[1]?.trim() ?? '').filter(Boolean);
  const adaptar = topicosDe(secaoDoCorpo(n.corpo, 'Como adaptar') || secaoDoCorpo(n.corpo, 'Como usar'));
  const pontos = topicosDe(secaoDoCorpo(n.corpo, 'Pontos principais') || secaoDoCorpo(n.corpo, 'Estrutura'));
  return {
    title: n.titulo,
    summary: duasFrases(n.resumo || secaoDoCorpo(n.corpo, 'Resumo') || n.corpo),
    why: adaptar.length ? `Como usar: ${adaptar.slice(0, 2).join(' ')}` : '',
    how: { format: n.tipo === 'video' ? 'Reel' : 'Carrossel', hook: linha(secaoDoCorpo(n.corpo, 'Gancho')).slice(0, 300) },
    key_points: [...pontos, ...adaptar].slice(0, 5),
  };
}

export interface MemoriaNotaBreve {
  id: string;
  titulo: string;
  pasta: MemoriaPasta;
  tipo: MemoriaTipo;
  tags: string[];
  url: string | null;
  autor: string | null;
  resumo: string;
  status: MemoriaStatus;
  erro: string | null;
  via: MemoriaVia;
  noDrive: boolean;
  destino: MemoriaDestino;
  assunto: MemoriaAssunto | null;
  /** Quem mandou: o usuário do OS ou o nome no grupo do WhatsApp. */
  enviadaPor: string | null;
  criadaEm: string;
  atualizadaEm: string;
}

export interface MemoriaNota extends MemoriaNotaBreve {
  corpo: string;
  citadaEm: { id: string; titulo: string }[];
  /** O card em Marketing › Ideias, quando a nota foi mandada para lá. */
  ideia: { id: string; status: TriagemStatus } | null;
  decididaPor: string | null;
  decididaEm: string | null;
}

export interface MemoriaPainel {
  notas: MemoriaNotaBreve[];
  total: number;
  /** Quantas notas em cada destino e, nas referências, em cada assunto. */
  destinos: { destino: MemoriaDestino; n: number }[];
  assuntos: { assunto: MemoriaAssunto; n: number }[];
  pastas: { nome: MemoriaPasta; n: number }[];
  tags: { t: string; n: number }[];
  /** O que a captura pelo grupo e o espelho no Drive precisam para funcionar. */
  ligacoes: { grupo: boolean; drive: boolean; transcricao: boolean; apify: boolean; ia: boolean };
}

export interface MemoriaGrafo {
  nodes: { id: string; label: string; type: MemoriaTipo | 'tag' }[];
  links: { source: string; target: string }[];
}

export const MemoriaCapturaSchema = z.object({ texto: z.string().trim().min(1, 'Escreva ou cole alguma coisa.').max(8_000) });
export const MemoriaNotaCriarSchema = z.object({
  titulo: z.string().trim().min(1, 'Dê um título à nota.').max(120),
  pasta: z.enum(MEMORIA_PASTAS).default('Conhecimento'),
  corpo: z.string().max(200_000).default(''),
});
export const MemoriaNotaSalvarSchema = z.object({
  titulo: z.string().trim().min(1, 'O título não pode ficar vazio.').max(120).optional(),
  pasta: z.enum(MEMORIA_PASTAS).optional(),
  corpo: z.string().max(200_000).optional(),
  tags: z.array(z.string()).max(12).optional(),
});
export type MemoriaNotaSalvarInput = z.infer<typeof MemoriaNotaSalvarSchema>;

export const primeiraUrl = (texto: string): string =>
  (/https?:\/\/[^\s<>"']+/i.exec(String(texto || ''))?.[0] || '').replace(/[).,;!?]+$/, '');

/** 'instagram' | 'tiktok' | 'youtube' para vídeo curto ou vídeo; null para link comum. */
export function tipoDeVideo(raw: string): 'instagram' | 'tiktok' | 'youtube' | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const h = u.hostname.replace(/^www\.|^m\./, '');
  const p = u.pathname;
  if (/(^|\.)instagram\.com$/.test(h) && /^\/(?:[\w.]+\/)?(reel|reels|p|tv)\/[\w-]+/.test(p)) return 'instagram';
  if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
  if (h === 'youtu.be' || (/(^|\.)youtube\.com$/.test(h) && (/^\/shorts\//.test(p) || (p === '/watch' && !!u.searchParams.get('v'))))) return 'youtube';
  return null;
}

export const tagsDoTexto = (texto: string): string[] =>
  [...new Set((String(texto || '').match(/(^|\s)#([\p{L}\p{N}_-]{2,40})/gu) || []).map((t) => t.trim().slice(1).toLowerCase()).filter((t) => !/^\d+$/.test(t)))].slice(0, 12);

export const limparTags = (arr: unknown): string[] =>
  [...new Set((Array.isArray(arr) ? arr : String(arr || '').split(/[,\s]+/)).map((t) => String(t).replace(/^#/, '').trim().toLowerCase()).filter((t) => /^[\p{L}\p{N}_-]{2,40}$/u.test(t)))].slice(0, 12);

/** O Estúdio não deixa a IA usar travessão: vira vírgula. */
export const semTravessao = (s: unknown): string => String(s ?? '').replace(/\s*[—–]\s*/g, ', ').trim();

/** O título de uma ideia escrita à mão: a primeira linha, sem #tags, até 80 caracteres. */
export function tituloDaIdeia(texto: string): string {
  const primeira = texto.split(/\n/)[0].replace(/#[\p{L}\p{N}_-]+/gu, '').trim();
  return (primeira.length > 80 ? primeira.slice(0, 77).replace(/\s+\S*$/, '') + '…' : primeira) || 'Ideia';
}

const linha = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const itens = (a: unknown) => (Array.isArray(a) ? a.map(linha).filter(Boolean) : []);
const secao = (titulo: string, texto: unknown) => (linha(texto) ? `## ${titulo}\n${String(texto).trim()}\n` : '');
const topicos = (titulo: string, arr: unknown) => (itens(arr).length ? `## ${titulo}\n${itens(arr).map((x) => `- ${x}`).join('\n')}\n` : '');

export interface AnaliseDeVideo {
  title?: string;
  summary?: string;
  hook?: string;
  structure?: string[];
  format?: string;
  cta?: string;
  why_works?: string;
  adapt?: string[];
  tags?: string[];
  subject?: string;
}
export interface AnaliseDeLink {
  title?: string;
  summary?: string;
  key_points?: string[];
  adapt?: string[];
  tags?: string[];
  subject?: string;
}

/** Corpo da nota de vídeo destrinchado (lente de marketing), igual ao do Estúdio. */
export function corpoDoVideo(p: { url: string; autor?: string | null; analise: AnaliseDeVideo; transcricao?: string; legenda?: string; marca?: string; semTranscricao?: boolean }): string {
  const a = p.analise;
  return [
    `> Fonte: ${p.url}${p.autor ? ` · @${String(p.autor).replace(/^@/, '')}` : ''}${p.semTranscricao ? ' · sem transcrição' : ''}`, '',
    secao('Resumo', a.summary),
    secao('Gancho', a.hook),
    topicos('Estrutura', a.structure),
    secao('Formato', a.format),
    secao('CTA', a.cta),
    secao('Por que funciona', a.why_works),
    topicos(`Como adaptar${p.marca ? ` para ${p.marca}` : ''}`, a.adapt),
    p.legenda ? secao('Legenda original', p.legenda) : '',
    p.transcricao ? secao('Transcrição', p.transcricao) : '',
  ].filter((x) => x !== '').join('\n').trim() + '\n';
}

/** Corpo da nota de link (matéria, artigo, página). */
export function corpoDoLink(p: { url: string; autor?: string | null; analise: AnaliseDeLink; descricao?: string; marca?: string }): string {
  const a = p.analise;
  return [
    `> Fonte: ${p.url}${p.autor ? ` · ${p.autor}` : ''}`, '',
    secao('Resumo', a.summary || p.descricao),
    topicos('Pontos principais', a.key_points),
    topicos(`Como usar${p.marca ? ` para ${p.marca}` : ''}`, a.adapt),
  ].filter((x) => x !== '').join('\n').trim() + '\n';
}

const yaml = (v: unknown) => JSON.stringify(String(v ?? ''));
/** Nome de arquivo seguro para o Drive e o Obsidian (sem acento quebrado, sem barra). */
export const nomeDeArquivo = (s: string): string =>
  (String(s || 'nota').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'nota');

/** O .md do Obsidian: YAML no topo, título e corpo. */
export function arquivoDaNota(n: { titulo: string; tipo: string; pasta: string; tags: string[]; url?: string | null; autor?: string | null; via: string; criadaEm: string; atualizadaEm: string; corpo: string; id: string; destino?: string | null; assunto?: string | null }): string {
  const fm = [
    '---',
    `titulo: ${yaml(n.titulo)}`,
    `tipo: ${n.tipo}`,
    `pasta: ${n.pasta}`,
    n.destino ? `destino: ${n.destino}` : '',
    n.assunto ? `assunto: ${n.assunto}` : '',
    `tags: [${(n.tags || []).map(yaml).join(', ')}]`,
    n.url ? `url: ${yaml(n.url)}` : '',
    n.autor ? `autor: ${yaml(n.autor)}` : '',
    `via: ${n.via}`,
    `criado_em: ${n.criadaEm}`,
    `atualizado_em: ${n.atualizadaEm}`,
    `root_os_id: ${n.id}`,
    '---',
  ].filter(Boolean).join('\n');
  return `${fm}\n\n# ${n.titulo}\n\n${String(n.corpo || '').trim()}\n`;
}

/** Grafo: notas, tags (um nó por tag), nota→tag, nota→nota por [[título]] e por mesmo autor ou site. */
export function grafoDasNotas(notas: { id: string; titulo: string; tipo: MemoriaTipo; tags: string[]; url: string | null; autor: string | null; corpo: string }[]): MemoriaGrafo {
  const nodes: MemoriaGrafo['nodes'] = notas.map((n) => ({ id: n.id, label: n.titulo, type: n.tipo }));
  const links: MemoriaGrafo['links'] = [];
  const vistos = new Set<string>();
  const ligar = (a: string, b: string) => {
    if (a === b) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!vistos.has(k)) {
      vistos.add(k);
      links.push({ source: a, target: b });
    }
  };
  const tags = new Set<string>();
  for (const n of notas) for (const t of n.tags || []) {
    tags.add(t);
    ligar(n.id, `tag:${t}`);
  }
  for (const t of tags) nodes.push({ id: `tag:${t}`, label: `#${t}`, type: 'tag' });
  const porTitulo = new Map(notas.map((n) => [n.titulo.trim().toLowerCase(), n.id]));
  for (const n of notas) for (const m of String(n.corpo || '').matchAll(/\[\[([^\]|#]+)/g)) {
    const alvo = porTitulo.get(m[1].trim().toLowerCase());
    if (alvo) ligar(n.id, alvo);
  }
  const grupos = new Map<string, string>();
  for (const n of notas) {
    let host = '';
    try {
      host = n.url ? new URL(n.url).hostname.replace(/^www\./, '') : '';
    } catch {
      host = '';
    }
    const chave = n.autor ? `a:${n.autor.toLowerCase()}` : n.tipo === 'link' && host ? `h:${host}` : '';
    if (!chave) continue;
    const primeiro = grupos.get(chave);
    if (primeiro) ligar(primeiro, n.id);
    else grupos.set(chave, n.id);
  }
  return { nodes, links };
}

// ---------- Triagem de ideias (um card por vez) ----------

export const TRIAGEM_STATUS = ['nova', 'aprovada', 'recusada', 'descartada_ia'] as const;
export type TriagemStatus = (typeof TRIAGEM_STATUS)[number];
export const MOTIVOS_RAPIDOS = ['Fora do tema', 'Já vi isso', 'Fonte fraca'] as const;

export interface TriagemCard {
  id: string;
  titulo: string;
  resumo: string;
  porque: string;
  como: { formato: string; gancho: string; clipe: string | null; pontos: string[] };
  formatoSugerido: string;
  url: string | null;
  imagemUrl: string | null;
  score: number;
  status: TriagemStatus;
  fonte: { id: string | null; nome: string; peso: number } | null;
  publicadoEm: string | null;
  postId: string | null;
  /** salvo = veio da Memória (você guardou); fonte = o robô coletou. */
  origem: 'fonte' | 'salvo';
  motivo: string | null;
  comentario: string | null;
  decididaEm: string | null;
  /** A IA escreveu o card. false = nasceu do resumo da nota, com a IA fora do ar (falta ler). */
  lida: boolean;
}

export interface TriagemBase {
  cards: TriagemCard[];
  contagem: { fonte: number; salvo: number };
}

export interface TriagemPainel {
  cards: TriagemCard[];
  contagem: Record<TriagemStatus, number>;
  /** Capturas ainda não lidas pela IA (a matéria-prima). */
  pendentes: number;
  ultima: { id: string; titulo: string; status: TriagemStatus } | null;
  ia: boolean;
  /** Cards para avaliar que a IA ainda não leu (nasceram com ela fora do ar). */
  semLeitura: number;
  /** A IA está lendo agora (montando cards novos ou relendo os que nasceram sem ela). */
  lendo: boolean;
  /** A rotina "IA das ideias" está ligada (o interruptor do fluxo, em Fontes). */
  iaLigada: boolean;
}

/** Uma etapa do fluxo das ideias que roda sozinha: uma rotina do OS, com interruptor. */
export interface FluxoEtapa {
  rotinaId: string | null;
  nome: string;
  cron: string;
  /** "todo dia às 22:00" */
  quando: string;
  ativo: boolean;
  ultimaEm: string | null;
  ultimoStatus: string | null;
  ultimoResumo: string | null;
  proximaEm: string | null;
}

/** Marketing › Ideias de conteúdo › Fontes: de onde as ideias vêm, quantas, quando e quanto custa. */
export interface FluxoDasIdeias {
  coleta: FluxoEtapa | null;
  ia: FluxoEtapa;
  fontes: { ligadas: number; perfis: number; gratis: number; postsPorPerfil: number; itensPorDiaPerfis: number };
  apify: { usadoUsd: number; tetoUsd: number; voltaEm: string | null; custoPorColeta: number | null; diasQueDa: number | null } | null;
  agora: { esperandoIa: number; paraAvaliar: number; semLeitura: number; aprovadasSemana: number; descartadasIa: number };
  iaConfigurada: boolean;
}

const DIAS_DO_CRON = ['todo domingo', 'toda segunda', 'toda terça', 'toda quarta', 'toda quinta', 'toda sexta', 'todo sábado'];
/** O cron em português ("todo dia às 22:00", "toda quinta às 22:00"). Fora do comum, devolve o próprio cron. */
export function quandoDoCron(cron: string): string {
  const [m, h, dia, mes, semana] = cron.trim().split(/\s+/);
  if (!/^\d+$/.test(m ?? '') || !/^\d+$/.test(h ?? '') || dia !== '*' || mes !== '*') return `cron ${cron}`;
  const hora = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  if (semana === '*') return `todo dia às ${hora}`;
  if (semana === '1-5') return `de segunda a sexta às ${hora}`;
  if (/^[0-7]$/.test(semana)) return `${DIAS_DO_CRON[Number(semana) % 7]} às ${hora}`;
  return `cron ${cron}`;
}

/** Ver todas: os cards de um status, sem a ordem de um por vez. */
export interface TriagemTodas {
  cards: TriagemCard[];
  contagem: Record<TriagemStatus, number>;
}

export const TriagemDecisaoSchema = z.object({
  decisao: z.enum(['aprovada', 'recusada']),
  motivo: z.string().trim().max(200).optional(),
  titulo: z.string().trim().max(200).optional(),
  gancho: z.string().trim().max(500).optional(),
  resumo: z.string().trim().max(1000).optional(),
  /** Por que aprovou ou recusou. Vira o "algoritmo": vai para o Obsidian e para as próximas triagens. */
  comentario: z.string().trim().max(2000).optional(),
  formato: z.string().trim().max(40).optional(),
});
export type TriagemDecisaoInput = z.infer<typeof TriagemDecisaoSchema>;
export const TriagemMontarSchema = z.object({ quantas: z.number().int().min(1).max(40).default(12) });
/** Reler com a IA: os cards pedidos ou, sem `ids`, todos os que nasceram sem leitura. */
export const TriagemRelerSchema = z.object({ ids: z.array(z.string().uuid()).max(40).optional() });

const limitar = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Peso da fonte pelas decisões: 2 × (aprovadas+2)/(decididas+4), entre 0,3 e 2. Sem decisões = 1. */
export const pesoDaFonte = (aprovadas: number, recusadas: number): number =>
  Math.round(limitar((2 * (aprovadas + 2)) / (aprovadas + recusadas + 4), 0.3, 2) * 100) / 100;

/** Bônus de recência: até 24 h +15, até 3 dias +8, até 7 dias +3. */
export function bonusDeRecencia(publicadoEm: string | Date | null | undefined, agoraMs = Date.now()): number {
  if (!publicadoEm) return 0;
  const h = (agoraMs - new Date(publicadoEm).getTime()) / 36e5;
  if (Number.isNaN(h)) return 0;
  return h <= 24 ? 15 : h <= 72 ? 8 : h <= 168 ? 3 : 0;
}
export const scoreDaIdeia = (relevancia: number, peso: number, publicadoEm: string | Date | null | undefined, agoraMs = Date.now()) =>
  Math.round((limitar(relevancia, 0, 100) * peso + bonusDeRecencia(publicadoEm, agoraMs)) * 10) / 10;

/** Até 2 frases. */
export function duasFrases(texto: unknown): string {
  const t = linha(texto).slice(0, 600);
  const partes = t.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [t];
  return partes.slice(0, 2).map((x) => x.trim()).join(' ');
}

// ---------- Formatos e réguas ----------

export const FORMATOS_COM_REGUA = ['Carrossel', 'Arte única', 'Reel', 'LinkedIn', 'Comunidade Wpp'] as const;
export type FormatoComRegua = (typeof FORMATOS_COM_REGUA)[number];

/** Comunidade Wpp é texto de WhatsApp: vai do Banco direto para Agendar (sem Design & Gravação). */
export const FORMATOS_SEM_DESIGN: readonly string[] = ['Comunidade Wpp'];
export const COMUNIDADE_SUBTIPOS = ['News semanal', 'Enquete', 'Debate'] as const;
export type ComunidadeSubtipo = (typeof COMUNIDADE_SUBTIPOS)[number];

export const PARAMS_PADRAO: Record<FormatoComRegua, Record<string, string | number>> = {
  Carrossel: { slides_min: 6, slides_max: 10, headline_max_palavras: 12, densidade: 'media', cta: 'salvar e mandar para alguém' },
  'Arte única': { headline_max_palavras: 10, layout: 'título grande e uma linha de apoio' },
  Reel: { duracao_max_s: 60, clipe_abertura_max_s: 15, legenda: 'frase', estrutura: 'clipe primeiro, depois o comentário' },
  LinkedIn: { palavras_min: 120, palavras_max: 280, gancho: 'uma frase de tensão na primeira linha' },
  'Comunidade Wpp': { subtipo: 'News semanal', blocos_max: 6, enquete_pergunta_max: 100, enquete_opcao_max: 25 },
};

export interface ReguaDoFormato {
  formato: FormatoComRegua;
  regras: string;
  params: Record<string, string | number>;
  referencias: { id: string; tipo: 'link' | 'texto'; url?: string; texto?: string; nota?: string }[];
  atualizadaEm: string | null;
}

export const ReguaSalvarSchema = z.object({
  regras: z.string().max(12_000).default(''),
  params: z.record(z.union([z.string().max(300), z.number()])).default({}),
});
export const ReguaReferenciaSchema = z
  .object({ url: z.string().trim().url().max(500).optional(), texto: z.string().trim().max(6_000).optional(), nota: z.string().trim().max(300).optional() })
  .refine((v) => !!v.url || !!v.texto, { message: 'Cole um link ou um texto de referência.' });
export const GerarPostSchema = z.object({ instrucao: z.string().trim().max(2_000).optional() });

/** Enquete do WhatsApp: pergunta de até 100 caracteres e 3 ou 4 opções de até 25. Devolve o problema ou null. */
export function problemaDaEnquete(pergunta: string, opcoes: string[]): string | null {
  if (!pergunta.trim()) return 'A enquete precisa de pergunta.';
  if (pergunta.length > 100) return 'A pergunta da enquete passa de 100 caracteres.';
  const ops = opcoes.map((o) => o.trim()).filter(Boolean);
  if (ops.length < 3 || ops.length > 4) return 'A enquete precisa de 3 ou 4 opções.';
  const longa = ops.find((o) => o.length > 25);
  return longa ? `A opção "${longa}" passa de 25 caracteres.` : null;
}

/**
 * Lê um arquivo da pasta canal-whatsapp/semanas (o agente da comunidade grava ali):
 * AAAA-MM-DD-root-semanal-NN.md e AAAA-MM-DD-enquete-quarta.md. O texto é o primeiro
 * bloco entre ```. Arquivo de outro nome devolve null (não é peça).
 */
export function lerArquivoDaComunidade(nome: string, conteudo: string): { numero: string; data: string; subtipo: ComunidadeSubtipo; titulo: string; texto: string; opcoes: string[]; isca: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})-(root-semanal-(\d+)|enquete-quarta|debate[\w-]*)\.md$/i.exec(nome.trim());
  if (!m) return null;
  const bloco = /```[^\n]*\n([\s\S]*?)```/.exec(conteudo);
  const texto = (bloco ? bloco[1] : conteudo.replace(/^---[\s\S]*?---\s*/, '')).trim();
  if (!texto) return null;
  const subtipo: ComunidadeSubtipo = m[3] ? 'News semanal' : /^enquete/i.test(m[2]) ? 'Enquete' : 'Debate';
  const opcoes = subtipo === 'Enquete'
    ? texto.split(/\r?\n/).map((l) => /^\s*(?:[-*•▸]|\d+[.)]|[a-d][.)])\s+(.+)$/i.exec(l)?.[1]?.trim() ?? '').filter(Boolean).slice(0, 4)
    : [];
  const primeira = texto.split(/\r?\n/).map((l) => l.replace(/[*_~]/g, '').trim()).find(Boolean) ?? '';
  const titulo = subtipo === 'News semanal' ? `Suco de IA ${Number(m[3])}` : `${subtipo}: ${primeira.slice(0, 80)}`;
  // "## Material da isca (vai no CTA da peça)": o 1º bloco entre ``` dessa seção vai para o cta
  // (27/10, pedido do agente da comunidade: a rotina solta a isca quando a news bate N corações).
  const secaoIsca = /^##\s+Material da isca[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(conteudo)?.[1] ?? '';
  // A cerca pode ser ``` ou ~~~. Com ~~~ (o material tem ``` próprio, o monoespaçado do WhatsApp),
  // vale tudo até o ~~~ que fecha, com os ``` de dentro.
  const cerca = /^(```|~~~)[^\n]*\n/m.exec(secaoIsca);
  const resto = cerca ? secaoIsca.slice(cerca.index + cerca[0].length) : '';
  const fim = cerca ? new RegExp(`^${cerca[1]}\\s*$`, 'm').exec(resto) : null;
  const isca = (cerca ? (fim ? resto.slice(0, fim.index) : '') : '').trim();
  return { numero: nome.replace(/\.md$/i, ''), data: m[1], subtipo, titulo, texto, opcoes, isca };
}
