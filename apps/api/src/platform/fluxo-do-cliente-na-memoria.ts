/*
 * ============================================================================
 * O FLUXO DO CLIENTE NA MEMÓRIA — o mesmo arquivo, lido pelos agentes
 * ============================================================================
 *
 * A tela Contexto › Fluxo do cliente lê `fluxo-do-cliente.json`. Os agentes não
 * leem telas: eles buscam na Memória (`contexto.memoria.buscar`). Este arquivo
 * transforma o MESMO JSON em notas da Memória, para o fluxo valer como contexto
 * da operação sem uma segunda fonte (02/11/2026, P-87).
 *
 * DEZ NOTAS, E NÃO UMA. Uma abertura, uma por fase, uma de desvios e uma da área
 * do cliente. A busca acha a fase que responde à pergunta; uma nota única de 12
 * mil caracteres diluiria o vetor e devolveria o fluxo inteiro para qualquer
 * pergunta.
 *
 * NADA AQUI GRAVA. São funções puras: o que cada nota diz e em que situação a
 * nota da Memória está diante do arquivo. Quem grava é `FluxoNaMemoriaService`,
 * e só quando alguém aperta o botão da tela.
 *
 * NOTA EDITADA À MÃO NÃO É REGRAVADA. A carga só reconhece como dela a versão
 * cujo motivo começa com `MARCA_DO_MOTIVO`. Se a última versão da nota tem outro
 * motivo, alguém mexeu nela na Memória, e a nota fica como está até essa pessoa
 * decidir (regra da carga: só cria o que falta, nunca regrava dado em uso).
 */

/* ------------------------------------------------------- o que o JSON tem -- */

export type TarefaDoFluxo = {
  numero: string;
  chave: string;
  responsavel: string;
  titulo: string;
  feito_quando: string;
  notas?: string[];
  em_aberto?: string[];
  em_paralelo?: { trilho: string; tarefas: TarefaDoFluxo[] }[];
};
export type EtapaDoFluxo =
  | { tipo: 'marco'; texto: string }
  | ({ tipo: 'tarefa' } & TarefaDoFluxo)
  | { tipo: 'decisao'; chave: string; pergunta: string; segue_se: string; ramos?: TarefaDoFluxo[]; notas?: string[] };
export type DesvioDoFluxo = {
  de: string;
  resposta: string;
  para?: string;
  depois_volta_a?: string;
  volta_a?: string;
  pula_para?: string;
  depois?: string;
  prazo?: string;
  repete?: boolean;
};
export type FluxoDoCliente = {
  nome: string;
  versao: string;
  data: string;
  fonte: string;
  total_tarefas: number;
  area_do_cliente?: { item: string; origem: string; tarefa: string | null }[];
  fases: { id: string; nome: string; etapas: EtapaDoFluxo[] }[];
  desvios: DesvioDoFluxo[];
};

/* ------------------------------------------------------ o que vira nota -- */

export const PREFIXO_DA_CHAVE = 'fluxo-do-cliente:';
export const ARQUIVO_DO_FLUXO = 'fluxo-do-cliente.json';
/** O começo do motivo de toda versão gravada pela carga. É como ela se reconhece. */
export const MARCA_DO_MOTIVO = 'Fluxo do cliente v';

export interface NotaDoFluxo {
  chave: string;
  titulo: string;
  corpo: string;
  tags: string[];
}

/** Os papéis da tela, na mesma ordem. Responsável "QUEM IMPLANTA · D-1" conta em QUEM IMPLANTA. */
const PAPEIS = ['COMERCIAL', 'FINANCEIRO', 'DONO DA CONTA', 'QUEM IMPLANTA', '2º SÓCIO', 'MARKETING', 'TI DO CLIENTE', 'QUEM RESPONDE'] as const;

const dataBr = (iso: string) => iso.split('-').reverse().join('/');
/** Números em ordem: a tarefa em paralelo (42) vem antes da seguinte da espinha (39) no arquivo. */
const emOrdem = (tarefas: TarefaDoFluxo[]) => tarefas.map((t) => t.numero).sort((a, b) => Number(a) - Number(b));
const faixa = (tarefas: TarefaDoFluxo[]) => {
  const n = emOrdem(tarefas);
  return `${n[0]} a ${n[n.length - 1]}`;
};
const frase = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const trilho = (t: string) => frase(t.toLocaleLowerCase('pt-BR'));

/** Todas as tarefas, inclusive as que correm em paralelo e as que saem de decisão. Mesma regra da tela. */
export function tarefasDoFluxo(fluxo: FluxoDoCliente): TarefaDoFluxo[] {
  return fluxo.fases.flatMap((f) => tarefasDaFase(f.etapas));
}
function tarefasDaFase(etapas: EtapaDoFluxo[]): TarefaDoFluxo[] {
  return etapas.flatMap((e) => {
    if (e.tipo === 'tarefa') return [e, ...(e.em_paralelo ?? []).flatMap((p) => p.tarefas)];
    if (e.tipo === 'decisao') return e.ramos ?? [];
    return [];
  });
}

export function motivoDaCarga(fluxo: FluxoDoCliente): string {
  return `${MARCA_DO_MOTIVO}${fluxo.versao.replace(/^v/i, '')}, levado pela tela Contexto › Fluxo do cliente`;
}
export function procedenciaDaCarga(fluxo: FluxoDoCliente): string {
  return `${ARQUIVO_DO_FLUXO} ${fluxo.versao} (${fluxo.data})`;
}

/** As dez notas, na ordem em que a tela as lista. */
export function notasDoFluxo(fluxo: FluxoDoCliente): NotaDoFluxo[] {
  const todas = tarefasDoFluxo(fluxo);
  const porChave = new Map(todas.map((t) => [t.chave, t]));
  const perguntas = new Map(
    fluxo.fases.flatMap((f) => f.etapas).flatMap((e) => (e.tipo === 'decisao' ? [[e.chave, e.pergunta] as const] : [])),
  );
  const ref = (chave: string) => {
    const t = porChave.get(chave);
    return t ? `${t.numero} · ${t.titulo}` : perguntas.get(chave) ?? chave;
  };
  const linhaDaTarefa = (t: TarefaDoFluxo) => `**${t.numero} · ${t.titulo}** (${t.responsavel}). Feito quando: ${t.feito_quando}`;
  /** "não: 03 · Cobrar o fechamento, depois volta a 02 · Mandar o link de fechamento" — a frase da tela, em texto. */
  const fraseDoDesvio = (d: DesvioDoFluxo) =>
    `${d.resposta}: ` +
    (d.para ? ref(d.para) : '') +
    (d.para && d.depois ? ` e ${ref(d.depois)}` : '') +
    (d.repete ? ', em ciclo' : '') +
    (d.depois_volta_a ? `, depois volta a ${ref(d.depois_volta_a)}` : '') +
    (d.volta_a ? `volta a ${ref(d.volta_a)}` : '') +
    (d.pula_para ? `pula para ${ref(d.pula_para)}` : '') +
    (d.prazo ? ` (${d.prazo})` : '');

  const versao = `${fluxo.versao}, ${dataBr(fluxo.data)}`;
  const tags = ['fluxo-do-cliente', `fluxo-${fluxo.versao}`];
  const intro = `Fluxo do cliente da ROOT (${versao}): o caminho do cliente da proposta aceita até a continuidade ou o fim.`;
  const nFases = fluxo.fases.length;

  const abertura: NotaDoFluxo = {
    chave: `${PREFIXO_DA_CHAVE}abertura`,
    titulo: `Fluxo do cliente da ROOT (${fluxo.versao}): como funciona`,
    tags,
    corpo: [
      `${intro} São ${todas.length} tarefas em ${nFases} fases, cada uma com o responsável e o critério de "feito quando". Fonte: ${fluxo.fonte}.`,
      '',
      '## As fases',
      ...fluxo.fases.map((f, i) => `- Fase ${i + 1} · ${f.nome}: tarefas ${faixa(tarefasDaFase(f.etapas))}`),
      '',
      '## Quem faz o quê',
      ...PAPEIS.flatMap((p) => {
        const dele = emOrdem(todas.filter((t) => t.responsavel.includes(p)));
        return dele.length ? [`- ${p}: ${dele.join(', ')}`] : [];
      }),
      '',
      '## Onde está o resto',
      'Cada fase tem uma nota própria nesta Memória, com as tarefas, as decisões, o que corre em paralelo e o que está em aberto. Os desvios e voltas e a área do cliente (o painel) também têm nota própria. A tela é Contexto › Fluxo do cliente, no ROOT OS.',
    ].join('\n'),
  };

  const fases: NotaDoFluxo[] = fluxo.fases.map((f, i) => {
    const linhas: string[] = [];
    for (const e of f.etapas) {
      if (e.tipo === 'marco') {
        linhas.push(`- **Marco:** ${e.texto}`);
      } else if (e.tipo === 'tarefa') {
        linhas.push(`- ${linhaDaTarefa(e)}`);
        for (const n of e.notas ?? []) linhas.push(`  - Nota: ${n}`);
        for (const a of e.em_aberto ?? []) linhas.push(`  - Em aberto: ${a}`);
        for (const p of e.em_paralelo ?? []) {
          linhas.push(`  - Em paralelo (${trilho(p.trilho)}):`);
          for (const t of p.tarefas) linhas.push(`    - ${linhaDaTarefa(t)}`);
        }
      } else {
        linhas.push(`- **Decisão:** ${e.pergunta} Segue se: ${e.segue_se}.`);
        for (const r of e.ramos ?? []) {
          const d = fluxo.desvios.find((x) => x.de === e.chave && (x.para === r.chave || x.depois === r.chave));
          const volta = d?.depois_volta_a ? ` Depois volta a ${ref(d.depois_volta_a)}.` : '';
          const prazo = d?.prazo ? ` (${d.prazo})` : '';
          linhas.push(`  - Se ${d?.resposta ?? 'não'}${prazo}: ${linhaDaTarefa(r)}.${volta}${d?.repete ? ' Em ciclo.' : ''}`);
        }
        for (const d of fluxo.desvios.filter((x) => x.de === e.chave && !x.para)) linhas.push(`  - Se ${fraseDoDesvio(d)}.`);
        for (const n of e.notas ?? []) linhas.push(`  - Nota: ${n}`);
      }
    }
    return {
      chave: `${PREFIXO_DA_CHAVE}${f.id}`,
      titulo: `Fluxo do cliente · Fase ${i + 1} · ${f.nome}`,
      tags,
      corpo: [
        `Fase ${i + 1} de ${nFases} do ${intro.charAt(0).toLowerCase()}${intro.slice(1)} Tarefas ${faixa(tarefasDaFase(f.etapas))}.`,
        '',
        ...linhas,
      ].join('\n'),
    };
  });

  const desvios: NotaDoFluxo = {
    chave: `${PREFIXO_DA_CHAVE}desvios`,
    titulo: 'Fluxo do cliente · Desvios e voltas',
    tags,
    corpo: [
      `${intro} Os desvios e voltas de cada decisão do fluxo: a pergunta, a resposta e para onde o fluxo vai.`,
      '',
      ...fluxo.desvios.map((d) => `- ${perguntas.get(d.de) ?? d.de} → ${fraseDoDesvio(d)}`),
    ].join('\n'),
  };

  const area = fluxo.area_do_cliente ?? [];
  const areaDoCliente: NotaDoFluxo[] = area.length
    ? [{
        chave: `${PREFIXO_DA_CHAVE}area-do-cliente`,
        titulo: 'Fluxo do cliente · Área do cliente (painel)',
        tags,
        corpo: [
          `${intro} O que precisa estar no painel do cliente (a área do cliente) e a tarefa do fluxo que alimenta cada item.`,
          '',
          ...area.map((a) => {
            const t = a.tarefa ? todas.find((x) => x.numero === a.tarefa) : undefined;
            return `- ${a.item}${t ? ` (tarefa ${t.numero} · ${t.titulo})` : ' (sem tarefa no fluxo)'}`;
          }),
        ].join('\n'),
      }]
    : [];

  return [abertura, ...fases, desvios, ...areaDoCliente];
}

/* ------------------------------------------------ a nota diante do arquivo -- */

export type SituacaoDaNota =
  /** Não existe na Memória: o botão cria. */
  | 'falta'
  /** Igual ao que o arquivo gera: nada a fazer. */
  | 'em_dia'
  /** Gravada pela carga, mas o arquivo mudou: o botão grava a versão nova. */
  | 'desatualizada'
  /** Alguém mexeu nela na Memória: fica como está. */
  | 'editada'
  /** Arquivada na Memória: não volta sozinha. */
  | 'arquivada';

export function situacaoDaNota(
  gerada: NotaDoFluxo,
  atual: { title: string; body: string; arquivadoEm: string | null } | null,
  motivoDaUltimaVersao?: string | null,
): SituacaoDaNota {
  if (!atual) return 'falta';
  if (atual.arquivadoEm) return 'arquivada';
  if (atual.title === gerada.titulo && atual.body === gerada.corpo) return 'em_dia';
  return (motivoDaUltimaVersao ?? '').startsWith(MARCA_DO_MOTIVO) ? 'desatualizada' : 'editada';
}
