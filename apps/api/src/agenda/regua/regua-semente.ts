import { feriadosDoAno, normalizarParaAgenda, type BloqueioFixo, type SocioDaAgenda, type TipoDeFeriado } from '@mktos/shared';

/*
 * A SEMENTE DAS REGRAS DA AGENDA (agenda v2, 29/10/2026, lane G2).
 *
 * Os valores do desenho `Regras` (`docs/agenda-v2/desenho/Regras.dc.html`) e do
 * roteiro (`docs/comercial/RODADA-AGENDA-V2-20261029.md`, G2). Semeados UMA vez,
 * na primeira leitura da empresa da casa, sem sobrescrever o que alguém já
 * editou (`createMany` com `skipDuplicates` pelas chaves únicas). Fora da casa,
 * nada é semeado.
 *
 * O que NÃO vem daqui, de propósito:
 *   · o e-mail pessoal do Fechado (decisão 3): quem cadastra é o Rodrigo, na tela;
 *     a régua do Rodrigo nasce com "agenda pessoal como Fechado" ligada e sem
 *     e-mail, então nada é lido até ele preencher;
 *   · o e-mail do sócio no OS: vem do usuário da Equipe achado pelo primeiro nome
 *     (exatamente um), senão fica nulo e os Relatórios avisam.
 */

export interface SementeDaPessoa {
  nome: SocioDaAgenda;
  area: string;
  janelaInicio: string;
  janelaFim: string;
  intervaloMin: number;
  trajetoMin: number;
  tetoPorDia: number;
  bloqueiosFixos: BloqueioFixo[];
  fechadoLigado: boolean;
  substituto: SocioDaAgenda;
  ordem: number;
}

export const SEMENTE_DAS_PESSOAS: readonly SementeDaPessoa[] = [
  {
    nome: 'Rodrigo', area: 'onboarding e contrato', janelaInicio: '08:00', janelaFim: '19:00',
    intervaloMin: 15, trajetoMin: 30, tetoPorDia: 5,
    // "qui a partir de 19:00" (desenho Regras).
    bloqueiosFixos: [{ diaDaSemana: 4, inicio: '19:00', fim: null }],
    fechadoLigado: true, substituto: 'Lucas', ordem: 0,
  },
  {
    nome: 'Lucas', area: 'marca e marketing', janelaInicio: '09:00', janelaFim: '18:00',
    intervaloMin: 15, trajetoMin: 30, tetoPorDia: 4, bloqueiosFixos: [], fechadoLigado: false, substituto: 'Rodrigo', ordem: 1,
  },
  {
    nome: 'Pedro', area: 'FinOps', janelaInicio: '08:30', janelaFim: '18:00',
    intervaloMin: 10, trajetoMin: 30, tetoPorDia: 5, bloqueiosFixos: [], fechadoLigado: false, substituto: 'Rodrigo', ordem: 2,
  },
];

export interface SementeDoRito {
  nome: string;
  titulo: string;
  diaDaSemana: number;
  ordinalNoMes: number | null;
  inicio: string | null;
  duracaoMin: number;
  quem: string;
  politica: 'pergunta' | 'bloqueia';
  aDecidir: boolean;
  ordem: number;
}

/**
 * Os ritos da casa. A terça 08:00 só aparece no desenho (Regras e Main): nenhuma
 * ata, fixture ou documento do repositório confirma o horário, então ela nasce
 * `aDecidir` e a tela a marca `[a decidir]` até um sócio salvar o horário.
 */
export const SEMENTE_DOS_RITOS: readonly SementeDoRito[] = [
  {
    nome: 'Reunião Interna - Todos (pauta da semana)', titulo: 'Reunião Interna - Todos', diaDaSemana: 2, ordinalNoMes: null,
    inicio: '08:00', duracaoMin: 60, quem: 'Todos', politica: 'pergunta', aDecidir: true, ordem: 0,
  },
  {
    nome: 'Reunião Interna - Todos (estrutura fixa)', titulo: 'Reunião Interna - Todos', diaDaSemana: 4, ordinalNoMes: null,
    inicio: '19:30', duracaoMin: 90, quem: 'Todos', politica: 'bloqueia', aDecidir: false, ordem: 1,
  },
  {
    nome: 'Sábado da Root', titulo: 'Sábado da Root', diaDaSemana: 6, ordinalNoMes: 1,
    inicio: null, duracaoMin: 1440, quem: 'Todos', politica: 'bloqueia', aDecidir: false, ordem: 2,
  },
];

/** As regras em frase do desenho; a terceira nasce desligada. O motor não as interpreta. */
export const SEMENTE_DOS_TEXTOS: ReadonlyArray<{ frase: string; ligada: boolean; ordem: number }> = [
  { frase: 'Cliente novo só depois das 10h na segunda.', ligada: true, ordem: 0 },
  { frase: 'Kickoff é presencial quando o cliente é de Juiz de Fora.', ligada: true, ordem: 1 },
  { frase: 'Sexta depois das 16h só interna.', ligada: false, ordem: 2 },
];

/** Os anos de feriados nacionais semeados. */
export const ANOS_DOS_FERIADOS = [2026, 2027] as const;

const FACULTATIVOS = new Set(['Carnaval', 'Corpus Christi']);

/** Nacionais ligados (fecham a agenda); Carnaval e Corpus Christi facultativos e desligados. */
export function sementeDosFeriados(anos: readonly number[] = ANOS_DOS_FERIADOS): Array<{ data: string; nome: string; tipo: TipoDeFeriado; ligado: boolean }> {
  return anos.flatMap((ano) =>
    feriadosDoAno(ano).map((f) => {
      const facultativo = FACULTATIVOS.has(f.nome);
      return { data: f.dia, nome: f.nome, tipo: (facultativo ? 'facultativo' : 'nacional') as TipoDeFeriado, ligado: !facultativo };
    }),
  );
}

/**
 * O usuário da Equipe de um sócio: o primeiro nome igual (sem acento, sem caixa),
 * e só quando é UM. Dois "Rodrigo" na Equipe = nenhum: o e-mail fica nulo e
 * alguém escolhe, em vez de o convite ir para a pessoa errada.
 */
export function usuarioDoSocio<T extends { id: string; name: string | null }>(socio: string, usuarios: readonly T[]): T | null {
  const alvo = normalizarParaAgenda(socio);
  const achados = usuarios.filter((u) => normalizarParaAgenda((u.name ?? '').split(/\s+/)[0]) === alvo);
  return achados.length === 1 ? achados[0] : null;
}
