/*
 * O GOSTO DA ROOT NO OBSIDIAN (04/11/2026, pedido do Lucas: "não é melhor salvar no Obsidian?
 * Assim ficaria mais completo"). Duas notas no Drive da Root, em
 * 40-marca-e-conteudo/Memória/Algoritmo:
 *
 *   - "Decisões da triagem.md": TODA decisão de Ideias de conteúdo, com ou sem comentário
 *     (antes só as comentadas). É o histórico, regravado pelo OS a cada decisão.
 *   - "Gosto da Root.md": o que a IA lê. Duas partes: "Escrito pela equipe", que o OS nunca
 *     toca, e "Resumo da IA", que o OS reescreve na rotina das 23h a partir de TODAS as
 *     decisões (antes a IA só via os 40 comentários mais recentes).
 *
 * Aqui ficam só as funções puras (texto da nota, separar e juntar as partes, o pedido do
 * resumo); o Drive e a IA estão em `gosto-da-root.service.ts`.
 */

export const PASTA_DO_ALGORITMO = ['40-marca-e-conteudo', 'Memória', 'Algoritmo'] as const;
export const NOME_DAS_DECISOES = 'Decisões da triagem.md';
export const NOME_DO_GOSTO = 'Gosto da Root.md';
export const TITULO_DO_RESUMO = '## Resumo da IA';
/** Quantas decisões entram no pedido do resumo (as mais recentes). */
export const DECISOES_NO_RESUMO = 400;
/** Até quantos caracteres da nota a IA recebe. */
export const TETO_DA_NOTA = 8000;

export interface Decisao {
  titulo: string;
  status: string;
  motivo: string | null;
  comentario: string | null;
  decididaEm: Date | null;
  decididaPor: string | null;
  fonteNome: string | null;
  url: string | null;
  formatoSugerido: string | null;
}

/** A marca que o OS deixa no Resumo da IA: quantas decisões ele leu e a data da última. */
export interface MarcaDoResumo {
  total: number;
  ultima: string | null;
}

const RE_TITULO_DO_RESUMO = /^##[ \t]+Resumo da IA[ \t]*$/m;
const RE_MARCA = /<!--\s*os:\s*(\d+)\s+decis\S*,\s*a última em\s+(\S+?)\.\s/;

/** Data e hora de São Paulo (UTC-3; o Brasil não tem horário de verão desde 2019). */
export function dataDeSaoPaulo(d: Date | null): string {
  if (!d) return '';
  const sp = new Date(d.getTime() - 3 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(sp.getUTCDate())}/${p(sp.getUTCMonth() + 1)}/${sp.getUTCFullYear()} ${p(sp.getUTCHours())}h${p(sp.getUTCMinutes())}`;
}

const umaLinha = (s: string | null | undefined) => String(s ?? '').replace(/\s*\n+\s*/g, ' ').trim();
const ensina = (d: Decisao) => !!(umaLinha(d.comentario) || umaLinha(d.motivo));

/** O arquivo "Decisões da triagem.md" inteiro: todas as decisões, a mais recente primeiro. */
export function arquivoDasDecisoes(decisoes: Decisao[], agora = new Date()): string {
  const aprovadas = decisoes.filter((d) => d.status === 'aprovada').length;
  const semPorque = decisoes.filter((d) => !ensina(d)).length;
  const cabeca = [
    '---',
    'titulo: "Decisões da triagem"',
    'tipo: nota',
    'pasta: Algoritmo',
    'tags: ["algoritmo", "triagem"]',
    `atualizado_em: ${agora.toISOString()}`,
    '---',
    '',
    '# Decisões da triagem',
    '',
    'Tudo o que foi aprovado ou recusado em Marketing › Ideias de conteúdo, do mais recente para o mais antigo. O OS regrava esta nota a cada decisão; o que for editado aqui some. O que a IA lê é a nota [[Gosto da Root]].',
    '',
    `${decisoes.length} ${decisoes.length === 1 ? 'decisão' : 'decisões'}: ${aprovadas} ${aprovadas === 1 ? 'aprovada' : 'aprovadas'} e ${decisoes.length - aprovadas} ${decisoes.length - aprovadas === 1 ? 'recusada' : 'recusadas'}.` +
      (semPorque ? ` ${semPorque} sem comentário nem motivo: essas ensinam pouco à IA.` : ''),
    '',
  ];
  const linhas = decisoes.map((d) =>
    [
      `- **${d.status === 'aprovada' ? 'Aprovou' : 'Recusou'}** · ${dataDeSaoPaulo(d.decididaEm)} · ${umaLinha(d.titulo)}` +
        (d.formatoSugerido ? ` · ${d.formatoSugerido}` : '') +
        (d.decididaPor ? ` · por ${umaLinha(d.decididaPor)}` : ''),
      umaLinha(d.motivo) ? `  - motivo: ${umaLinha(d.motivo)}` : '',
      umaLinha(d.comentario) ? `  - comentário: ${umaLinha(d.comentario)}` : '',
      !ensina(d) ? '  - (sem comentário nem motivo)' : '',
      d.fonteNome || d.url ? `  - fonte: ${[umaLinha(d.fonteNome), d.url ?? ''].filter(Boolean).join(' ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return [...cabeca, ...linhas].join('\n') + '\n';
}

/** A nota "Gosto da Root.md" de partida: a parte da equipe vazia, com o que escrever nela. */
export function modeloDoGosto(): string {
  return [
    '---',
    'titulo: "Gosto da Root"',
    'tipo: nota',
    'pasta: Algoritmo',
    'tags: ["algoritmo", "gosto"]',
    '---',
    '',
    '# Gosto da Root',
    '',
    '<!-- Esta nota é o que a IA leva em conta ao escolher as ideias de conteúdo (todo dia às 23h) e ao escrever o post no botão "Gerar" da Produção. O que está aqui é exatamente o que ela lê. O histórico de decisões fica em [[Decisões da triagem]]. -->',
    '',
    '## Escrito pela equipe',
    '',
    '<!-- Escreva aqui, em tópicos, o que a Root quer e o que não quer no conteúdo. O OS nunca mexe nesta parte, e ela vale mais que o resumo. Exemplo: "- Notícia de modelo novo de IA só serve se der para mostrar o uso na operação de uma PME." -->',
    '',
  ].join('\n');
}

/**
 * Separa a nota em duas: tudo antes do título "## Resumo da IA" é da equipe e volta igual;
 * o resto é do OS. Sem o título, a nota inteira é da equipe (o OS acrescenta o resumo no fim).
 */
export function separarGosto(texto: string): { daEquipe: string; resumo: string | null; marca: MarcaDoResumo | null } {
  const t = texto.replace(/\r\n?/g, '\n');
  const m = RE_TITULO_DO_RESUMO.exec(t);
  if (!m) return { daEquipe: t, resumo: null, marca: null };
  const resumo = t.slice(m.index + m[0].length);
  const mm = RE_MARCA.exec(resumo);
  return {
    daEquipe: t.slice(0, m.index),
    resumo: resumo.replace(/<!--[\s\S]*?-->/g, '').trim(),
    marca: mm ? { total: Number(mm[1]), ultima: mm[2] === 'nenhuma' ? null : mm[2] } : null,
  };
}

/** A nota de volta: a parte da equipe como estava, mais o Resumo da IA novo. */
export function juntarGosto(daEquipe: string, resumo: string, marca: MarcaDoResumo, agora = new Date()): string {
  const equipe = daEquipe.replace(/\s+$/, '');
  return [
    equipe,
    '',
    TITULO_DO_RESUMO,
    '',
    `<!-- os: ${marca.total} decisões, a última em ${marca.ultima ?? 'nenhuma'}. Reescrito em ${agora.toISOString()} a partir de todas as decisões da triagem; o OS reescreve esta parte todo dia às 23h e o que for escrito aqui some. Para ensinar a IA à mão, escreva em "Escrito pela equipe". -->`,
    '',
    resumo.trim(),
    '',
  ].join('\n');
}

/** O resumo precisa ser refeito? Sim se nunca foi feito ou se mudou o total ou a última decisão. */
export function precisaResumir(marca: MarcaDoResumo | null, atual: MarcaDoResumo): boolean {
  if (!marca) return true;
  return marca.total !== atual.total || (marca.ultima ?? null) !== (atual.ultima ?? null);
}

/** A nota do jeito que a IA lê: sem o cabeçalho YAML e sem os comentários <!-- -->, até o teto. */
export function notaParaAIa(texto: string, teto = TETO_DA_NOTA): string {
  const t = texto
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > teto ? `${t.slice(0, teto)}\n(…nota cortada no limite de ${teto} caracteres)` : t;
}

/** A saída da IA pronta para entrar sob "## Resumo da IA": sem cerca de código, títulos no nível 3 ou abaixo. */
export function limparResumo(saida: string): string {
  return saida
    .replace(/\r\n?/g, '\n')
    .replace(/^```[a-z]*\n?/gim, '')
    .replace(/^#{1,2}(?=\s)/gm, '###')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[ \t]*[—–][ \t]*/g, ', ')
    .trim();
}

export const SYSTEM_DO_GOSTO = `Você mantém a nota "Gosto da Root": o resumo do que a equipe da ROOT aprova e recusa como pauta de conteúdo. A IA que escolhe as ideias e a IA que escreve os posts leem esta nota antes de trabalhar.
Você recebe as decisões da triagem (aprovou ou recusou, título, formato, fonte, motivo e o comentário de quem decidiu) e o que a equipe escreveu à mão na nota.
Escreva em português do Brasil, frases curtas, sem travessão e sem jargão de marketing. Use só o que as decisões mostram: não invente gosto. Quando ajudar, cite o comentário de verdade, curto, entre aspas.
Os comentários valem mais que os títulos. Decisão sem comentário nem motivo pesa pouco: use só como indício, junto com outras.
Não repita o que a equipe já escreveu à mão. Se alguma decisão contradiz o que está escrito à mão, aponte em "Pontos em aberto".
Devolva só o Markdown, com estes quatro títulos, nesta ordem:
### O que a Root aprova
### O que a Root recusa
### Formatos e jeitos de fazer
### Pontos em aberto
Em cada um, de 1 a 8 tópicos. Seção sem base nas decisões: escreva "- Ainda sem decisões que mostrem isso.". No máximo 450 palavras no total.`;

/** O pedido do resumo: o que a equipe escreveu e as decisões, da mais recente para a mais antiga. */
export function pedidoDoResumo(decisoes: Decisao[], daEquipe: string): string {
  const escrito = notaParaAIa(daEquipe, 4000);
  const lista = decisoes.slice(0, DECISOES_NO_RESUMO).map((d) =>
    [
      `- ${d.status === 'aprovada' ? 'APROVOU' : 'RECUSOU'}`,
      dataDeSaoPaulo(d.decididaEm).slice(0, 10),
      `"${umaLinha(d.titulo).slice(0, 200)}"`,
      d.formatoSugerido ? `formato: ${d.formatoSugerido}` : '',
      d.fonteNome ? `fonte: ${umaLinha(d.fonteNome).slice(0, 80)}` : '',
      umaLinha(d.motivo) ? `motivo: ${umaLinha(d.motivo).slice(0, 200)}` : '',
      umaLinha(d.comentario) ? `comentário: "${umaLinha(d.comentario).slice(0, 800)}"` : '(sem comentário)',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  return [
    '## O que a equipe escreveu à mão na nota',
    escrito || '(nada ainda)',
    `## As decisões da triagem (${lista.length}${decisoes.length > lista.length ? ` mais recentes de ${decisoes.length}` : ''}, da mais recente para a mais antiga)`,
    lista.length ? lista.join('\n') : '(nenhuma decisão ainda)',
  ].join('\n\n');
}
