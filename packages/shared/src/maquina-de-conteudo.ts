import { z } from 'zod';

/*
 * MÁQUINA DE CONTEÚDO DA EMPRESA (Marketing, 19/10/2026).
 *
 * A adaptação, para a própria empresa, da Máquina de Conteúdo que a ROOT usa com
 * clientes (conteudo.operacaoroot.com, "fluxo próprio"). Um post é guardado UMA
 * vez (MarketingPost) e anda por uma esteira só:
 *
 *   Banco de ideias → Design & Gravação → A agendar → Agendado → Postado
 *
 * Sem aprovação de cliente: quem aprova é a própria equipe. Arquivar tira o post
 * da esteira sem apagar (o histórico de que aquilo já foi tentado fica).
 *
 * As regras que a tela e a API precisam ler IGUAIS moram aqui: as etapas, a
 * transição permitida e a régua da cadência que sugere datas livres.
 */

export const MAQUINA_ETAPAS = ['ideia', 'producao', 'a_agendar', 'agendado', 'publicado', 'arquivado'] as const;
export type MaquinaEtapa = (typeof MAQUINA_ETAPAS)[number];

/** As colunas da esteira, na ordem (arquivado fica fora). */
export const MAQUINA_ESTEIRA: readonly MaquinaEtapa[] = ['ideia', 'producao', 'a_agendar', 'agendado', 'publicado'];

export const ROTULO_DA_ETAPA: Record<MaquinaEtapa, string> = {
  ideia: 'Banco de ideias',
  producao: 'Design & Gravação',
  a_agendar: 'A agendar',
  agendado: 'Agendado',
  publicado: 'Postado',
  arquivado: 'Arquivado',
};

/** O botão que leva o post para a próxima etapa, como a Máquina diz. */
export const PROXIMO_PASSO: Partial<Record<MaquinaEtapa, { para: MaquinaEtapa; rotulo: string }>> = {
  ideia: { para: 'producao', rotulo: 'Aprovar → Design & Gravação' },
  producao: { para: 'a_agendar', rotulo: 'Pronto → Agendar' },
  a_agendar: { para: 'agendado', rotulo: 'Escolher data' },
  agendado: { para: 'publicado', rotulo: 'Marcar como postado' },
};

/**
 * Qualquer etapa pode voltar a qualquer outra (o kanban arrasta livre), com duas
 * regras: agendado exige data, e postado exige data (o dia em que foi ao ar).
 */
/**
 * O próximo passo DO POST: Comunidade Wpp é texto de WhatsApp e não passa por
 * Design & Gravação (vai do Banco direto para Agendar).
 */
export function proximoPassoDoPost(p: { etapa: MaquinaEtapa; formato: string }): { para: MaquinaEtapa; rotulo: string } | undefined {
  if (p.etapa === 'ideia' && p.formato === 'Comunidade Wpp') return { para: 'a_agendar', rotulo: 'Aprovar → Agendar' };
  return PROXIMO_PASSO[p.etapa];
}

export function etapaPrecisaDeData(etapa: MaquinaEtapa): boolean {
  return etapa === 'agendado' || etapa === 'publicado';
}

// 26/10/2026: LinkedIn e Comunidade Wpp (texto do grupo de WhatsApp) entram com as réguas do Estúdio.
export const MAQUINA_FORMATOS = ['Reel', 'Carrossel', 'Arte única', 'Foto', 'Story', 'LinkedIn', 'Comunidade Wpp'] as const;
export type MaquinaFormato = (typeof MAQUINA_FORMATOS)[number];
export const MAQUINA_TIPOS_DE_CARD = ['video', 'arte'] as const;
export type MaquinaTipoDeCard = (typeof MAQUINA_TIPOS_DE_CARD)[number];
export const MAQUINA_PRIORIDADES = ['alta', 'media', 'baixa'] as const;
export type MaquinaPrioridade = (typeof MAQUINA_PRIORIDADES)[number];

export const MAQUINA_TIPOS_DE_FONTE = ['ideia', 'tema', 'reuniao', 'perfil', 'web', 'concorrente', 'referencia'] as const;

/** Os números do post publicado, como o Instagram mostra no card (preenchidos à mão ou colados). */
export const MAQUINA_METRICAS = [
  { chave: 'visualizacoes', rotulo: 'Visualizações' },
  { chave: 'alcance', rotulo: 'Contas alcançadas' },
  { chave: 'curtidas', rotulo: 'Curtidas' },
  { chave: 'comentarios', rotulo: 'Comentários' },
  { chave: 'compartilhamentos', rotulo: 'Compartilhamentos' },
  { chave: 'salvamentos', rotulo: 'Salvamentos' },
  { chave: 'visitasPerfil', rotulo: 'Visitas ao perfil' },
  { chave: 'novosSeguidores', rotulo: 'Novos seguidores' },
] as const;
export type MaquinaMetrica = (typeof MAQUINA_METRICAS)[number]['chave'];

export interface MaquinaFonte {
  tipo: string;
  nome: string;
  link?: string;
  detalhe?: string;
}

export interface MaquinaHist {
  em: string;
  de: MaquinaEtapa | null;
  para: MaquinaEtapa;
  por: string;
}

export interface MaquinaComentario {
  autor: string;
  texto: string;
  em: string;
}

export interface MaquinaPost {
  id: string;
  /** O rótulo livre do post (`ROOT-025`, `Ep 3`). Não é a ordem. */
  numero: string;
  ordem: number;
  titulo: string;
  pilar: string;
  formato: string;
  /** Comunidade Wpp: News semanal | Enquete | Debate. Vazio nos outros formatos. */
  subtipo: string;
  tipoCard: MaquinaTipoDeCard;
  prioridade: MaquinaPrioridade;
  headline: string;
  subHeadline: string;
  roteiro: string;
  slides: string[];
  design: string;
  legenda: string;
  cta: string;
  porque: string;
  fontes: MaquinaFonte[];
  recursos: string[];
  etapa: MaquinaEtapa;
  /** AAAA-MM-DD, no fuso de São Paulo. Agendado = quando vai ao ar; postado = quando foi. */
  data: string | null;
  linkPublicado: string;
  metricas: Partial<Record<MaquinaMetrica, number>>;
  hist: MaquinaHist[];
  comentarios: MaquinaComentario[];
  criadoEm: string;
  atualizadoEm: string;
}

export interface MaquinaPainel {
  posts: MaquinaPost[];
  /** Os pilares da marca (Contexto › Marca), para escolher no post. */
  pilares: { chave: string; nome: string; cor: string }[];
  /** Dias da semana (0 = domingo) em que a empresa costuma postar. */
  cadencia: number[];
  /** Meta de posts por mês (cadência × semanas), para o calendário dizer "x de y". */
  metaDoMes: number;
}

const texto = (max: number) => z.string().trim().max(max).default('');
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');

export const MaquinaPostSalvarSchema = z.object({
  numero: texto(40),
  titulo: z.string().trim().min(1, 'O post precisa de título.').max(200),
  pilar: texto(60),
  formato: z.string().trim().min(1).max(40).default('Reel'),
  subtipo: texto(40),
  tipoCard: z.enum(MAQUINA_TIPOS_DE_CARD).default('video'),
  prioridade: z.enum(MAQUINA_PRIORIDADES).default('media'),
  headline: texto(600),
  subHeadline: texto(600),
  roteiro: texto(20_000),
  slides: z.array(z.string().trim().max(2_000)).max(20).default([]),
  design: texto(4_000),
  legenda: texto(6_000),
  // Na Comunidade Wpp o cta é o Material da isca (texto do grupo, pode passar de 600). 27/10.
  cta: texto(4_000),
  porque: texto(2_000),
  fontes: z
    .array(z.object({
      tipo: z.string().trim().min(1).max(30),
      nome: z.string().trim().min(1).max(200),
      link: z.string().trim().max(500).optional(),
      detalhe: z.string().trim().max(600).optional(),
    }))
    .max(15)
    .default([]),
  recursos: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  /** Só na criação: nasce direto no calendário (agendado/postado) quando vem do "+" do dia. */
  etapa: z.enum(MAQUINA_ETAPAS).optional(),
  data: data.nullish(),
});
export type MaquinaPostSalvarInput = z.infer<typeof MaquinaPostSalvarSchema>;

export const MaquinaEtapaSchema = z
  .object({
    etapa: z.enum(MAQUINA_ETAPAS),
    data: data.nullish(),
    linkPublicado: z.string().trim().max(500).optional(),
  })
  .refine((v) => !etapaPrecisaDeData(v.etapa) || !!v.data, { message: 'Escolha a data.', path: ['data'] });
export type MaquinaEtapaInput = z.infer<typeof MaquinaEtapaSchema>;

export const MaquinaDataSchema = z.object({ data: data.nullable() });

export const MaquinaOrdemSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(2_000) });

export const MaquinaComentarioSchema = z.object({ texto: z.string().trim().min(1).max(4_000) });

export const MaquinaMetricasSchema = z.object({
  linkPublicado: z.string().trim().max(500).optional(),
  metricas: z.record(z.enum(MAQUINA_METRICAS.map((m) => m.chave) as [MaquinaMetrica, ...MaquinaMetrica[]]), z.number().int().min(0).max(1e10)),
});

export const MaquinaCadenciaSchema = z.object({ dias: z.array(z.number().int().min(0).max(6)).max(7) });

/** Dias livres (sem post agendado/postado) a partir de `desde`, nos dias da cadência. */
export function datasLivres(posts: Pick<MaquinaPost, 'etapa' | 'data'>[], cadencia: number[], desde: string, quantas = 6): string[] {
  const ocupadas = new Set(posts.filter((p) => p.data && (p.etapa === 'agendado' || p.etapa === 'publicado')).map((p) => p.data));
  const dias = cadencia.length ? cadencia : [2, 4];
  const out: string[] = [];
  const d = new Date(`${desde}T12:00:00Z`);
  for (let i = 0; i < 120 && out.length < quantas; i++) {
    const iso = d.toISOString().slice(0, 10);
    if (dias.includes(d.getUTCDay()) && !ocupadas.has(iso)) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Quantos posts a cadência pede num mês (dias da cadência que caem no mês). */
export function metaDoMes(cadencia: number[], mes: string): number {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, 1, 12));
  let n = 0;
  while (d.getUTCMonth() === m - 1) {
    if (cadencia.includes(d.getUTCDay())) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}
