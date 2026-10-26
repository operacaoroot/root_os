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

/** O que a tela e a API dizem quando a tarefa aberta igual já existe (Dia a dia e "+ tarefa" do Comercial). */
export const TAREFA_IGUAL_JA_EXISTE = 'Essa tarefa já existe.';

/**
 * A tarefa aberta IGUAL à que se quer criar (`mesmaTarefa === 'igual'`), entre as
 * que valem para a comparação (do mesmo cliente no Dia a dia, do mesmo lead no
 * Comercial). Quem chama já filtrou as abertas e o dono; a regra do título é esta.
 */
export function tarefaIgual<T>(abertas: readonly T[], titulo: string, tituloDe: (t: T) => string): T | undefined {
  return abertas.find((t) => mesmaTarefa(tituloDe(t), titulo) === 'igual');
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
  descricao: z.string().max(20000).nullable().optional(),
  /** Troca o status pelo tipo: o primeiro status da lista da tarefa com esse tipo. */
  etapa: z.enum(['aberta', 'andamento', 'concluida']).optional(),
  /** A regra de repetição; null tira a repetição. */
  recorrencia: z.lazy(() => RecorrenciaSchema).nullable().optional(),
  areaId: z.string().uuid().nullable().optional(),
  pessoaId: z.string().uuid().nullable().optional(),
  /** Todos os responsáveis, o primeiro é o principal. Lista vazia = ninguém. */
  pessoasIds: z.array(z.string().uuid()).max(20).optional(),
  prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  clienteId: z.string().uuid().nullable().optional(),
}).strict();
export type TarefaDoDiaEditar = z.infer<typeof TarefaDoDiaEditarSchema>;

/** A nova sequência de um pedaço da tela (uma coluna, a lista, um dia): ids na ordem em que ficam. */
export const TarefasReordenarSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).strict();

/** Cliente novo a partir da tarefa: vira card no CRM (Comercial), na primeira etapa. */
export const ClienteDaTarefaCriarSchema = z.object({ nome: z.string().trim().min(2).max(300) }).strict();

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
  /** Todos os responsáveis (o primeiro é `pessoa`). */
  pessoas: { id: string; nome: string }[];
  /** Responsável que veio só como texto (ClickUp) e ainda não é uma conta. */
  responsavelTexto: string | null;
  prazo: string | null;
  situacao: SituacaoDoPrazo;
  /** `tipo` diz o que o status quer dizer, seja qual for o nome dele na lista. */
  status: { nome: string; cor: string; tipo: EtapaDaTarefa };
  lista: { id: string; nome: string };
  externalUrl: string | null;
  /** A descrição própria da tarefa (escrita aqui, não no ClickUp). */
  descricao: string | null;
  /** A regra de repetição (null = não repete). */
  recorrencia: RecorrenciaDaTarefa | null;
  /** A posição manual (arrastar), a mesma em todas as visões; empate = pelo prazo. */
  ordem: number;
  updatedAt: string;
}

export type EtapaDaTarefa = 'aberta' | 'andamento' | 'concluida';

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
  /** Os cards do CRM: `lead` ainda em negociação (fase comercial), `cliente` já fechou (implantação ou sucesso). */
  clientes: { id: string; titulo: string; fase: 'lead' | 'cliente' }[];
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

/*
 * TAREFAS QUE SE REPETEM (19/10/2026), no molde do ClickUp. A regra mora na
 * tarefa; ao concluí-la nasce a próxima ocorrência, com o prazo seguinte e os
 * mesmos título, área, responsável, cliente, descrição e regra. A concluída
 * fica no histórico. `serieId` liga as ocorrências: uma série nunca tem duas
 * abertas, então concluir de novo, reabrir e concluir não duplica a próxima.
 */
/*
 * Layout 26/10 (P-18): o "Personalizar" do ClickUp. Dois campos opcionais, sem
 * mexer no que já estava gravado (regra sem eles se comporta como antes):
 *   · `intervalo` na semanal e na mensal: a cada N semanas / N meses (sem ele, 1);
 *   · `ate` em qualquer tipo: o último dia da série (AAAA-MM-DD). A próxima
 *     ocorrência que cairia depois dele não nasce.
 * "A cada N dias" continua sendo o tipo `intervalo`.
 */
const ATE_DA_SERIE = { ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() };
export const RecorrenciaSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('diaria'), ...ATE_DA_SERIE }),
  /** dias da semana: 0 = domingo … 6 = sábado (pelo menos um). */
  z.object({ tipo: z.literal('semanal'), dias: z.array(z.number().int().min(0).max(6)).min(1).max(7), intervalo: z.number().int().min(1).max(52).optional(), ...ATE_DA_SERIE }),
  /** dia do mês (1–31); em mês mais curto, o último dia. */
  z.object({ tipo: z.literal('mensal'), dia: z.number().int().min(1).max(31), intervalo: z.number().int().min(1).max(24).optional(), ...ATE_DA_SERIE }),
  z.object({ tipo: z.literal('intervalo'), dias: z.number().int().min(1).max(365), ...ATE_DA_SERIE }),
]);
export type RecorrenciaDaTarefa = z.infer<typeof RecorrenciaSchema>;

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function descreverRecorrencia(r: RecorrenciaDaTarefa): string {
  // Layout 26/10 (P-18): o fim da série vai no final da frase ("…, até 31/12/2026").
  const ate = r.ate ? `, até ${r.ate.slice(8, 10)}/${r.ate.slice(5, 7)}/${r.ate.slice(0, 4)}` : '';
  return `${descreverSemFim(r)}${ate}`;
}

function descreverSemFim(r: RecorrenciaDaTarefa): string {
  if (r.tipo === 'diaria') return 'Todo dia';
  if (r.tipo === 'intervalo') return r.dias === 1 ? 'Todo dia' : `A cada ${r.dias} dias`;
  if (r.tipo === 'mensal') return (r.intervalo ?? 1) > 1 ? `A cada ${r.intervalo} meses, dia ${r.dia}` : `Todo mês, dia ${r.dia}`;
  const d = [...new Set(r.dias)].sort((a, b) => a - b);
  if ((r.intervalo ?? 1) > 1) return `A cada ${r.intervalo} semanas: ${d.map((x) => DIAS[x]).join(', ')}`;
  if (d.length === 7) return 'Todo dia';
  if (d.join() === '1,2,3,4,5') return 'Dias úteis';
  return `Toda semana: ${d.map((x) => DIAS[x]).join(', ')}`;
}

/**
 * Layout 26/10 (P-18): a série terminou? `dia` é o prazo que a próxima teria.
 * Sem `ate`, nunca termina (o comportamento de antes).
 */
export function serieTerminou(r: RecorrenciaDaTarefa, dia: string): boolean {
  return !!r.ate && dia > r.ate;
}

/**
 * O prazo da próxima ocorrência, sempre DEPOIS de `depoisDe` (AAAA-MM-DD). A
 * base é o prazo da que foi concluída (ou hoje, se não tinha prazo, ou se o
 * prazo já tinha passado — a próxima não nasce atrasada).
 */
export function proximaOcorrencia(r: RecorrenciaDaTarefa, prazoAtual: string | null, hoje: string): string {
  const base = prazoAtual && prazoAtual > hoje ? prazoAtual : hoje;
  const soma = (dia: string, n: number) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  if (r.tipo === 'diaria') return soma(base, 1);
  if (r.tipo === 'intervalo') return soma(base, r.dias);
  if (r.tipo === 'semanal' && (r.intervalo ?? 1) > 1) {
    // Layout 26/10 (P-18), a cada N semanas: os dias marcados que ainda faltam na
    // semana da base (domingo a sábado); senão, o primeiro dia marcado N semanas depois.
    const naSemana = new Date(`${base}T12:00:00Z`).getUTCDay();
    const dias = [...new Set(r.dias)].sort((x, y) => x - y);
    const aindaNestaSemana = dias.find((d) => d > naSemana);
    if (aindaNestaSemana !== undefined) return soma(base, aindaNestaSemana - naSemana);
    return soma(base, 7 * (r.intervalo ?? 1) - naSemana + dias[0]);
  }
  if (r.tipo === 'semanal') {
    for (let i = 1; i <= 7; i++) {
      const dia = soma(base, i);
      if (r.dias.includes(new Date(`${dia}T12:00:00Z`).getUTCDay())) return dia;
    }
    return soma(base, 7);
  }
  // mensal: o dia escolhido no mês seguinte ao da base (ou no mesmo mês, se ainda não passou)
  const [a, m] = base.split('-').map(Number);
  const noMes = (ano: number, mes: number) => {
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(r.dia, ultimo)).padStart(2, '0')}`;
  };
  const esteMes = noMes(a, m);
  if (esteMes > base) return esteMes;
  // Layout 26/10 (P-18): a cada N meses (sem `intervalo`, o mês seguinte, como antes).
  const salto = m - 1 + (r.intervalo ?? 1);
  return noMes(a + Math.floor(salto / 12), (salto % 12) + 1);
}
