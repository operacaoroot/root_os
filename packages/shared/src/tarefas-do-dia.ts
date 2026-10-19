import { z } from 'zod';

/*
 * TAREFAS DE TODAS AS ÁREAS (Dia a dia › Tarefas, 19/10/2026).
 *
 * Uma tabela só de tarefas (WorkTask em listas de natureza `tarefas`), vista de
 * vários lugares: todas juntas no Dia a dia, e cada área com as suas. Ver a
 * mesma tarefa de duas telas não é duplicar; duplicar é existir duas linhas
 * para a mesma coisa. Este arquivo tem as regras que a tela e a API precisam
 * ler IGUAIS para isso não acontecer:
 *
 *   · `tituloNormalizado` + `mesmaTarefa`: o que conta como a MESMA tarefa
 *     (a API recusa criar) e como PARECIDA (a API avisa e pede confirmação).
 *   · `naoPareceTarefa`: título com cara de lead (`Empresa | Pessoa`) ou de post
 *     (`[ROOT-12]`, `Post 40`) — esses têm casa própria (CRM, Máquina de
 *     Conteúdo) e não viram card de tarefa sem alguém confirmar.
 *   · `situacaoDoPrazo`: atrasada, hoje, próximos 7 dias, mais tarde, sem prazo — a
 *     mesma régua para o resumo por pessoa e para os grupos da tela.
 */

/** Áreas que uma empresa recebe na primeira vez que abre as tarefas. Editáveis depois. */
/** Cores na ordem validada para daltonismo (dataviz, paleta de referência, 6 primeiros slots). */
export const AREAS_PADRAO: ReadonlyArray<{ nome: string; cor: string }> = [
  { nome: 'Comercial', cor: '#2a78d6' },
  { nome: 'Marketing', cor: '#eb6834' },
  { nome: 'Financeiro', cor: '#1baf7a' },
  { nome: 'Operação', cor: '#eda100' },
  { nome: 'Administrativo', cor: '#e87ba4' },
];

/**
 * Contas do sistema (admin da instalação, MCP, IA de ação) usam o domínio da
 * seed: não são gente da equipe e não aparecem como responsável.
 */
export const DOMINIO_DAS_CONTAS_DO_SISTEMA = '@marketing-os.local';

/** A caixa de reuniões sem cliente do Granola é um cartão-depósito, não uma tarefa. */
export const CARTOES_QUE_NAO_SAO_TAREFA: readonly string[] = ['granola-sem-cliente'];

const PALAVRAS_VAZIAS = new Set(['para', 'pra', 'com', 'que', 'dos', 'das', 'por', 'uma', 'sem', 'nos', 'nas', 'the', 'and', 'fazer', 'do', 'da', 'de', 'no', 'na', 'em', 'um', 'o', 'a', 'e']);

export function tituloNormalizado(titulo: string): string {
  return titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function palavras(titulo: string): Set<string> {
  return new Set(tituloNormalizado(titulo).split(' ').filter((w) => w.length > 2 && !PALAVRAS_VAZIAS.has(w)));
}

/**
 * `igual`: mesmo título normalizado, ou as mesmas palavras em outra ordem (a
 * API recusa criar outra aberta igual, do
 * mesmo cliente). `parecida`: a maior parte das palavras em comum (avisa).
 * `diferente`: segue.
 */
export function mesmaTarefa(a: string, b: string): 'igual' | 'parecida' | 'diferente' {
  if (tituloNormalizado(a) === tituloNormalizado(b)) return 'igual';
  const pa = palavras(a), pb = palavras(b);
  if (!pa.size || !pb.size) return 'diferente';
  // As mesmas palavras em outra ordem ("Fazer FUP da proposta Juma" × "Proposta Juma — fazer FUP").
  if (pa.size >= 2 && pa.size === pb.size && [...pa].every((w) => pb.has(w))) return 'igual';
  let comuns = 0;
  pa.forEach((w) => { if (pb.has(w)) comuns++; });
  const menor = Math.min(pa.size, pb.size);
  if (comuns / menor >= 0.6 && (comuns >= 2 || menor <= 2)) return 'parecida';
  return 'diferente';
}

/** Nota para escolher a MAIS parecida entre várias (mais palavras em comum primeiro). */
export function notaDeSemelhanca(a: string, b: string): number {
  const pa = palavras(a), pb = palavras(b);
  let comuns = 0;
  pa.forEach((w) => { if (pb.has(w)) comuns++; });
  return comuns + comuns / Math.max(1, Math.min(pa.size, pb.size));
}

const VERBO_DE_ACAO = /\b(fazer|enviar|ligar|marcar|cobrar|revisar|criar|definir|montar|proposta|fup|follow|agendar|confirmar|mandar|ajustar|atualizar|preparar)\b/i;

export function naoPareceTarefa(titulo: string): { tipo: 'post' | 'lead'; casa: string; motivo: string } | null {
  const t = titulo.trim();
  if (/^\[?root-\d+\]?/i.test(t) || /^post\s*\d+/i.test(t)) {
    return { tipo: 'post', casa: 'Marketing › Produção de conteúdo', motivo: 'Parece um post. Posts andam pelas etapas de conteúdo, não viram tarefa.' };
  }
  if (/^[^|—]+\s\|\s[^|]+$/.test(t) && !VERBO_DE_ACAO.test(t)) {
    return { tipo: 'lead', casa: 'Comercial › Leads', motivo: 'Parece um lead ou cliente (empresa | pessoa). Ele mora no Comercial; a tarefa é o que precisa ser feito com ele.' };
  }
  return null;
}

export type SituacaoDoPrazo = 'feita' | 'atrasada' | 'hoje' | 'proximos_7' | 'mais_tarde' | 'sem_prazo';

/**
 * `prazo` e `hoje` em AAAA-MM-DD (dia de Brasília). "proximos_7" vai de amanhã
 * até hoje + 7, janela móvel; "mais_tarde" é o que passa disso. O corte no
 * domingo saiu em 19/10/2026 (o Lucas achou "Até domingo / Depois" aleatórios).
 */
export function situacaoDoPrazo(prazo: string | null, hoje: string, feita: boolean): SituacaoDoPrazo {
  if (feita) return 'feita';
  if (!prazo) return 'sem_prazo';
  if (prazo < hoje) return 'atrasada';
  if (prazo === hoje) return 'hoje';
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return prazo <= d.toISOString().slice(0, 10) ? 'proximos_7' : 'mais_tarde';
}

export const TarefaDoDiaCriarSchema = z.object({
  titulo: z.string().trim().min(1).max(300),
  areaId: z.string().uuid(),
  pessoaId: z.string().uuid().nullish(),
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  clienteId: z.string().uuid().nullish(),
  /** Já viu o aviso de parecida / não parece tarefa e quer criar assim mesmo. */
  confirmar: z.boolean().optional(),
}).strict();
export type TarefaDoDiaCriar = z.infer<typeof TarefaDoDiaCriarSchema>;

export const TarefaDoDiaEditarSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  titulo: z.string().trim().min(1).max(300).optional(),
  areaId: z.string().uuid().nullable().optional(),
  pessoaId: z.string().uuid().nullable().optional(),
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  clienteId: z.string().uuid().nullable().optional(),
}).strict();
export type TarefaDoDiaEditar = z.infer<typeof TarefaDoDiaEditarSchema>;

export const AreaDeTarefaCriarSchema = z.object({
  nome: z.string().trim().min(1).max(60),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).strict();

export interface AreaDeTarefa { id: string; nome: string; cor: string; ordem: number }

export interface TarefaDoDia {
  id: string;
  titulo: string;
  area: { id: string; nome: string; cor: string } | null;
  cliente: { id: string; titulo: string } | null;
  pessoa: { id: string; nome: string } | null;
  /** Responsável que veio só como texto (ClickUp) e ainda não é uma conta. */
  responsavelTexto: string | null;
  prazo: string | null;
  situacao: SituacaoDoPrazo;
  status: { nome: string; cor: string };
  lista: { id: string; nome: string };
  externalUrl: string | null;
  updatedAt: string;
}

export interface ResumoDaPessoa {
  pessoa: { id: string; nome: string } | null;
  atrasadas: number;
  emDia: number;
  semPrazo: number;
  feitasNaSemana: number;
}

export interface PainelDeTarefas {
  hoje: string;
  areas: AreaDeTarefa[];
  pessoas: { id: string; nome: string }[];
  clientes: { id: string; titulo: string }[];
  resumo: ResumoDaPessoa[];
  tarefas: TarefaDoDia[];
}

export type ResultadoDeCriar =
  | { criada: true; tarefa: TarefaDoDia }
  | { criada: false; aviso: { tipo: 'igual' | 'parecida'; tarefa: TarefaDoDia } | { tipo: 'nao_parece_tarefa'; casa: string; motivo: string } };

/**
 * Quem é da EQUIPE, a partir das contas ativas (19/10/2026, dados da produção):
 *   · a mesma pessoa com duas contas (Pedro no gmail e na fullbpo) aparece UMA
 *     vez, na conta que entrou por último; as outras apontam para ela;
 *   · a conta com o nome da empresa (a conta "Root" de uso comum) não é gente
 *     e não vira responsável.
 * `canonica` leva o id de qualquer conta ao id da pessoa que aparece na tela.
 */
export function equipeDasContas(
  contas: { id: string; nome: string; ultimoAcesso: string | null }[],
  empresa: { nome: string; slug: string },
): { pessoas: { id: string; nome: string }[]; canonica: Map<string, string> } {
  const daEmpresa = new Set([tituloNormalizado(empresa.nome), tituloNormalizado(empresa.slug)]);
  const porNome = new Map<string, typeof contas>();
  for (const c of contas) {
    const k = tituloNormalizado(c.nome);
    if (!k || daEmpresa.has(k)) continue;
    porNome.set(k, [...(porNome.get(k) ?? []), c]);
  }
  const pessoas: { id: string; nome: string }[] = [];
  const canonica = new Map<string, string>();
  for (const grupo of porNome.values()) {
    const dona = [...grupo].sort((a, b) => (b.ultimoAcesso ?? '').localeCompare(a.ultimoAcesso ?? ''))[0];
    pessoas.push({ id: dona.id, nome: dona.nome });
    for (const c of grupo) canonica.set(c.id, dona.id);
  }
  pessoas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  return { pessoas, canonica };
}
