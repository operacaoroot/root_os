/*
 * O ATALHO POR FRASE DO PAINEL DE MARCAR (rodada da Agenda v2, 29/10/2026, lane G3).
 *
 * "Andrade online sexta 15h com Rodrigo 1h" → os campos do painel. Sem IA: um
 * intérprete puro que preenche SÓ o que a frase disse (o resto fica como está
 * no painel). "14h 30 min" = 14:00 por 30 min.
 *
 * COMO LÊ. A frase vira palavras (sem acento, sem caixa, com a grafia original
 * guardada). Cada leitor consome as palavras que entendeu, nesta ordem: data,
 * hora e duração, modalidade, tipo, sócios, cliente. O que sobra depois de
 * "fora" é o motivo do Fora. Palavra que ninguém entendeu é ignorada: a frase
 * nunca inventa campo.
 *
 * HORA OU DURAÇÃO. "15h" é hora; "1h" é duração. A regra: `Nh` é hora quando
 * ainda não há hora e N fica entre 6 e 23 (ou veio depois de "às"); é duração
 * quando já há hora, ou N é menor que 6. "9h30" é 9:30; "1h30" é uma hora e meia.
 * "14h 30 min" é 14:00 por 30 minutos, porque "30 min" tem unidade.
 *
 * DIA DA SEMANA. "sexta" é a próxima sexta DEPOIS de hoje (dita numa sexta, é a
 * da semana que vem): para hoje existe "hoje".
 *
 * PURO: sem relógio (o `hoje` vem de fora), sem rede.
 */
import { normalizarParaAgenda, type ModalidadeDeReuniao } from './agenda.js';
import { SOCIOS_DA_AGENDA, type SocioDaAgenda, type TipoQueSeMarca } from './agenda-v2.js';

export interface ContextoDaFrase {
  /** Hoje, `AAAA-MM-DD`, no fuso da agenda. */
  hoje: string;
  /** Nomes de clientes e leads conhecidos (para reconhecer o cliente na frase). */
  clientes?: readonly string[];
}

export interface CamposDaFrase {
  tipo?: TipoQueSeMarca;
  modalidade?: ModalidadeDeReuniao;
  cliente?: string;
  responsaveis?: SocioDaAgenda[];
  /** `AAAA-MM-DD`. */
  dia?: string;
  /** `HH:MM`. */
  hora?: string;
  duracaoMin?: number;
  motivo?: string;
}

/**
 * Um resultado de `GET /agenda/clientes?q=` (a busca do cliente no painel de
 * marcar): um lead do Funil ou um cliente, com a ficha curta e quantas vezes o
 * nome já esteve na agenda (lido do espelho, `AgendaEvento.leituraCliente`).
 */
export interface ClienteDaBuscaDaAgenda {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  /** A etapa do Funil (`Proposta`), só no lead. */
  etapa: string | null;
  contato: { nome: string | null; email: string | null } | null;
  naAgenda: {
    vezes: number;
    /** O último compromisso que já passou (ISO), ou nulo. */
    ultima: string | null;
    /** Os sócios desse último. */
    com: SocioDaAgenda[];
  };
}

interface Palavra {
  /** Sem acento, minúscula. */
  n: string;
  /** Como veio. */
  o: string;
  usada: boolean;
}

const DIAS_DA_SEMANA: Array<[number, string[]]> = [
  [0, ['domingo', 'dom']],
  [1, ['segunda', 'segunda-feira', 'seg']],
  [2, ['terca', 'terca-feira', 'ter']],
  [3, ['quarta', 'quarta-feira', 'qua']],
  [4, ['quinta', 'quinta-feira', 'qui']],
  [5, ['sexta', 'sexta-feira', 'sex']],
  [6, ['sabado', 'sab']],
];

/** Palavras que nunca identificam um cliente sozinhas. */
const VAZIAS = new Set([
  'com', 'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'para', 'pra', 'por',
  'reuniao', 'cliente', 'online', 'presencial', 'interna', 'call', 'meet', 'hoje', 'amanha', 'dia',
  'ltda', 'me', 'eireli', 'sa', 's/a', 'grupo', 'empresa', 'cia',
  ...SOCIOS_DA_AGENDA.map((s) => normalizarParaAgenda(s)),
]);

const ehChave = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

function diaDaSemana(dia: string): number {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

function dataValida(a: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** Quebra a frase em palavras, separando "15h30min", "1h", "45min" e "16/11" do resto. */
function palavrasDa(frase: string): Palavra[] {
  const texto = String(frase ?? '')
    .replace(/[,;!?()]/g, ' ')
    // "às" e "as" colados a número: "às15h".
    .replace(/(\d)\s*(minutos|minuto|mins|min)\b/gi, '$1 min')
    .replace(/\s+/g, ' ')
    .trim();
  if (!texto) return [];
  return texto
    .split(' ')
    .filter((p) => p && p !== '-' && p !== '–' && p !== '—')
    .map((o) => ({ o, n: normalizarParaAgenda(o).replace(/[.:]+$/, ''), usada: false }));
}

export function interpretarFrase(frase: string, ctx: ContextoDaFrase): CamposDaFrase {
  const hoje = ehChave(ctx?.hoje ?? '') ? ctx.hoje : null;
  const ps = palavrasDa(frase);
  const campos: CamposDaFrase = {};
  if (!ps.length) return campos;

  const usar = (...i: number[]) => i.forEach((k) => { if (ps[k]) ps[k].usada = true; });
  const em = (i: number) => ps[i]?.n ?? '';

  /* --------------------------------------------------------------- o dia */
  if (hoje) {
    for (let i = 0; i < ps.length && !campos.dia; i++) {
      const n = em(i);
      if (n === 'hoje') { campos.dia = hoje; usar(i); continue; }
      if (n === 'amanha') { campos.dia = somarDias(hoje, 1); usar(i); continue; }
      if (n === 'depois' && em(i + 1) === 'de' && em(i + 2) === 'amanha') {
        campos.dia = somarDias(hoje, 2); usar(i, i + 1, i + 2); continue;
      }
      // dd/mm[/aaaa]
      const data = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(n);
      if (data) {
        const d = Number(data[1]);
        const m = Number(data[2]);
        const [ah] = hoje.split('-').map(Number);
        let a = data[3] ? Number(data[3]) : ah;
        if (a < 100) a += 2000;
        let dia = dataValida(a, m, d);
        if (dia && !data[3] && dia < hoje) dia = dataValida(a + 1, m, d);
        if (dia) { campos.dia = dia; usar(i); }
        continue;
      }
      // "dia 12": este mês, ou o próximo se já passou.
      if (n === 'dia' && /^\d{1,2}$/.test(em(i + 1))) {
        const d = Number(em(i + 1));
        const [a, m] = hoje.split('-').map(Number);
        let dia = dataValida(a, m, d);
        if (!dia || dia < hoje) dia = m === 12 ? dataValida(a + 1, 1, d) : dataValida(a, m + 1, d);
        if (dia) { campos.dia = dia; usar(i, i + 1); }
        continue;
      }
      const semana = DIAS_DA_SEMANA.find(([, nomes]) => nomes.includes(n));
      if (semana) {
        const alvo = semana[0];
        let delta = (alvo - diaDaSemana(hoje) + 7) % 7;
        if (delta === 0) delta = 7;
        campos.dia = somarDias(hoje, delta);
        usar(i);
        // "sexta que vem", "próxima sexta", "sexta-feira": as palavras de enfeite também saem.
        if (em(i - 1) === 'proxima' || em(i - 1) === 'proximo') usar(i - 1);
        if (em(i + 1) === 'que' && em(i + 2) === 'vem') usar(i + 1, i + 2);
        if (em(i + 1) === 'feira') usar(i + 1);
      }
    }
  }

  /* ----------------------------------------------- a hora e a duração */
  const porDuracao = (i: number) => ['por', 'durante', 'de'].includes(em(i - 1));
  const porHora = (i: number) => ['as', 'a', 'das', 'partir', 'ate'].includes(em(i - 1));
  const minutosDe = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
  const somarDuracao = (min: number) => { if (campos.duracaoMin === undefined && min >= 5 && min <= 24 * 60) campos.duracaoMin = min; };

  for (let i = 0; i < ps.length; i++) {
    if (ps[i].usada) continue;
    const n = em(i);

    if (n === 'meio-dia' || (n === 'meio' && em(i + 1) === 'dia')) {
      if (!campos.hora) { campos.hora = '12:00'; usar(i); if (n === 'meio') usar(i + 1); }
      continue;
    }
    if (n === 'meia' && em(i + 1) === 'hora') { somarDuracao(30); usar(i, i + 1); continue; }
    if (n === 'hora' && em(i + 1) === 'e' && em(i + 2) === 'meia') { somarDuracao(90); usar(i, i + 1, i + 2); continue; }

    // "30 min", "45 min" (a unidade já foi separada em palavrasDa)
    if (/^\d{1,3}$/.test(n) && em(i + 1) === 'min') {
      somarDuracao(Number(n));
      usar(i, i + 1);
      continue;
    }
    // "2 horas", "1 hora", "1 hora e meia"
    if (/^\d{1,2}$/.test(n) && (em(i + 1) === 'hora' || em(i + 1) === 'horas')) {
      let min = Number(n) * 60;
      usar(i, i + 1);
      if (em(i + 2) === 'e' && em(i + 3) === 'meia') { min += 30; usar(i + 2, i + 3); }
      somarDuracao(min);
      continue;
    }

    // 15h, 9h30, 14:30, 1h30, 9h30min
    const hm = /^(\d{1,2})(?:h|:)(\d{2})?(?:min)?$/.exec(n) ?? /^(\d{1,2})h(\d{2})?$/.exec(n);
    if (hm) {
      const h = Number(hm[1]);
      let m = hm[2] !== undefined ? Number(hm[2]) : 0;
      const doisPontos = n.includes(':');
      const ehHora =
        !campos.hora && !porDuracao(i) && h <= 23 && m < 60 && (doisPontos || porHora(i) || h >= 6);
      if (ehHora) {
        // "14h 30": o número solto logo depois (sem unidade) são os minutos.
        if (hm[2] === undefined && !doisPontos && /^\d{2}$/.test(em(i + 1)) && em(i + 2) !== 'min' && Number(em(i + 1)) < 60) {
          m = Number(em(i + 1));
          usar(i + 1);
        }
        campos.hora = hhmm(h, m);
        usar(i);
        if (porHora(i)) usar(i - 1);
        continue;
      }
      // "das 14h às 15h30": a segunda hora é o fim.
      if (campos.hora && porHora(i) && h <= 23 && m < 60 && campos.duracaoMin === undefined) {
        const fim = h * 60 + m - minutosDe(campos.hora);
        if (fim > 0) { somarDuracao(fim); usar(i - 1, i); }
        continue;
      }
      if (!doisPontos && campos.duracaoMin === undefined) {
        somarDuracao(h * 60 + m);
        usar(i);
        if (porDuracao(i)) usar(i - 1);
      }
      continue;
    }
    // "às 9", "as 15" (número solto depois de "às")
    if (/^\d{1,2}$/.test(n) && porHora(i) && !campos.hora && Number(n) <= 23) {
      campos.hora = hhmm(Number(n), 0);
      usar(i - 1, i);
    }
  }

  /* --------------------------------------------------------- modalidade */
  for (let i = 0; i < ps.length; i++) {
    const n = em(i);
    if (['online', 'on-line', 'remota', 'remoto', 'meet', 'video', 'videochamada'].includes(n)) {
      campos.modalidade ??= 'online';
      usar(i);
    } else if (['presencial', 'presencialmente', 'pessoalmente'].includes(n)) {
      campos.modalidade ??= 'presencial';
      usar(i);
    }
  }

  /* ---------------------------------------------------------- os sócios */
  const socios: SocioDaAgenda[] = [];
  for (let i = 0; i < ps.length; i++) {
    const n = em(i);
    if (n === 'todos' || (n === 'todo' && em(i + 1) === 'mundo')) {
      for (const s of SOCIOS_DA_AGENDA) if (!socios.includes(s)) socios.push(s);
      usar(i);
      if (n === 'todo') usar(i + 1);
      if (em(i - 1) === 'com') usar(i - 1);
      continue;
    }
    const s = SOCIOS_DA_AGENDA.find((x) => normalizarParaAgenda(x) === n);
    if (s) {
      if (!socios.includes(s)) socios.push(s);
      usar(i);
      if (em(i - 1) === 'com') usar(i - 1);
    }
  }
  if (socios.length) campos.responsaveis = socios;

  /* -------------------------------------------------------------- o tipo */
  let indiceDoFora = -1;
  for (let i = 0; i < ps.length; i++) {
    const n = em(i);
    if (n === 'interna' || n === 'interno') { campos.tipo ??= 'interna'; usar(i); }
    else if (['bloqueio', 'bloquear', 'bloqueado', 'fechado', 'fechar'].includes(n)) { campos.tipo ??= 'bloqueio'; usar(i); }
    else if (n === 'pessoal') { campos.tipo ??= 'pessoal'; usar(i); }
    else if (n === 'fora' && indiceDoFora < 0) { campos.tipo ??= 'fora'; indiceDoFora = i; usar(i); }
    else if (n === 'cliente') { usar(i); }
    else if (n === 'reuniao' || n === 'call') { usar(i); }
  }

  /* ----------------------------------------------------------- o cliente */
  const cliente = clienteDaFrase(ps, ctx?.clientes ?? []);
  if (cliente) {
    campos.cliente = cliente.nome;
    usar(...cliente.indices);
    campos.tipo ??= 'cliente';
    if (em(cliente.indices[0] - 1) === 'com') usar(cliente.indices[0] - 1);
  }

  /* -------------------------------------------------- o motivo do Fora */
  if (campos.tipo === 'fora' && indiceDoFora >= 0) {
    const resto = ps
      .slice(indiceDoFora + 1)
      .filter((p) => !p.usada)
      .map((p) => p.o)
      .join(' ')
      .replace(/^(por|para|pra|de)\s+/i, '')
      .trim();
    if (resto) campos.motivo = resto;
  }

  return campos;
}

/**
 * O cliente conhecido que a frase cita: primeiro pelo nome inteiro (o mais
 * longo vence), depois por UMA palavra marcante do nome (3+ letras, fora das
 * vazias) que só um cliente tem. Dois clientes com a mesma palavra: nenhum.
 */
function clienteDaFrase(ps: Palavra[], clientes: readonly string[]): { nome: string; indices: number[] } | null {
  const livres = ps.map((p, i) => ({ ...p, i })).filter((p) => !p.usada);
  if (!livres.length || !clientes.length) return null;
  const nomes = [...new Set(clientes.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  const palavrasDoNome = (c: string) => normalizarParaAgenda(c).split(/[\s/&.,-]+/).filter(Boolean);

  // Nome inteiro, em sequência.
  let melhor: { nome: string; indices: number[] } | null = null;
  for (const c of nomes) {
    const alvo = palavrasDoNome(c);
    if (!alvo.length) continue;
    for (let k = 0; k + alvo.length <= livres.length; k++) {
      const janela = livres.slice(k, k + alvo.length);
      const casa = janela.every((p, j) => p.n === alvo[j] && (j === 0 || p.i === janela[j - 1].i + 1));
      if (casa && (!melhor || alvo.length > melhor.indices.length)) melhor = { nome: c, indices: janela.map((p) => p.i) };
    }
  }
  if (melhor) return melhor;

  // Uma palavra marcante, de um cliente só.
  for (const p of livres) {
    if (p.n.length < 3 || VAZIAS.has(p.n) || /^\d/.test(p.n)) continue;
    const donos = nomes.filter((c) => palavrasDoNome(c).some((w) => w === p.n));
    if (donos.length === 1) return { nome: donos[0], indices: [p.i] };
  }
  return null;
}
