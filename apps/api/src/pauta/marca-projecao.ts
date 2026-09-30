import { createHash } from 'node:crypto';
import {
  PAUTA_SECOES_DA_MARCA,
  PAUTA_TETO_DO_PERFIL_DA_MARCA,
  PAUTA_TETO_DO_TEXTO_DOS_PILARES,
  lerPilaresDoTexto,
  type PautaMarcaDestino,
  type PautaMarcaSecaoUsada,
} from '@mktos/shared';

/** Headings da nota canônica. O texto vem da versão guardada na memória. */
const PARTES_DO_PERFIL = [
  ['O papel da ROOT', PAUTA_SECOES_DA_MARCA[0], 1],
  ['Voz, emoção e liberdade criativa', PAUTA_SECOES_DA_MARCA[1], 1],
  ['A pergunta editorial permanente', PAUTA_SECOES_DA_MARCA[2], 2],
  ['O caráter: nunca luz verde falsa', PAUTA_SECOES_DA_MARCA[3], 1],
  ['Para quem contamos essa história', PAUTA_SECOES_DA_MARCA[4], 1],
  ['Como a narrativa se transforma em uma peça', PAUTA_SECOES_DA_MARCA[5], 2],
] as const;

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

function trechoDaSecao(markdown: string, titulo: string): string | null {
  const linhas = markdown.replace(/\r\n?/g, '\n').split('\n');
  const inicio = linhas.findIndex((l) => /^#{2,4}\s+/.test(l) && l.replace(/^#{2,4}\s+/, '').trim() === titulo);
  if (inicio < 0) return null;
  const corpo: string[] = [];
  for (const l of linhas.slice(inicio + 1)) {
    if (/^#{1,4}\s+/.test(l)) break;
    corpo.push(l);
  }
  return corpo.join('\n').trim();
}

function primeirosParagrafos(corpo: string, quantidade: number): string {
  return corpo.split(/\n\s*\n/).map((bloco) => bloco.trim())
    .filter((bloco) => bloco && !bloco.startsWith('<!--'))
    .slice(0, quantidade)
    .map((bloco) => bloco.split('\n').map((l) => l.replace(/^>\s?/, '').trim()).join(' '))
    .join('\n').trim();
}

export function proporMarcaDaFonte(markdown: string, destino: PautaMarcaDestino): {
  texto: string;
  secoesUsadas: PautaMarcaSecaoUsada[];
  erro: string | null;
} {
  if (destino === 'perfil') {
    const secoesUsadas: PautaMarcaSecaoUsada[] = [];
    const partes: string[] = [];
    for (const [origem, rotulo, paragrafos] of PARTES_DO_PERFIL) {
      const trecho = primeirosParagrafos(trechoDaSecao(markdown, origem) ?? '', paragrafos);
      if (!trecho) return { texto: '', secoesUsadas: [], erro: `A fonte não contém texto na seção “${origem}”.` };
      secoesUsadas.push({ titulo: origem, hash: sha(trecho) });
      partes.push(`## ${rotulo}\n${trecho}`);
    }
    const texto = partes.join('\n\n');
    return {
      texto,
      secoesUsadas,
      erro: texto.length > PAUTA_TETO_DO_PERFIL_DA_MARCA
        ? `A proposta tem ${texto.length} caracteres; o limite é ${PAUTA_TETO_DO_PERFIL_DA_MARCA}. Revise antes de aplicar.`
        : null,
    };
  }

  const tabela = trechoDaSecao(markdown, 'Os territórios de conteúdo');
  if (!tabela) return { texto: '', secoesUsadas: [], erro: 'A fonte não contém a seção “Os territórios de conteúdo”.' };
  const linhas = tabela.split('\n').filter((l) => /^\|/.test(l.trim()));
  const territorios = linhas.slice(2).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((campos) => campos.length >= 2 && campos[0] && campos[1]);
  if (territorios.length !== 5) {
    return { texto: '', secoesUsadas: [], erro: `A fonte contém ${territorios.length} territórios; eram esperados cinco. Revise a fonte.` };
  }
  const texto = territorios.map(([nome, funcao]) => `${nome} | ${funcao}`).join('\n');
  const { pilares, avisos } = lerPilaresDoTexto(texto);
  const erro = texto.length > PAUTA_TETO_DO_TEXTO_DOS_PILARES
    ? `A proposta passa de ${PAUTA_TETO_DO_TEXTO_DOS_PILARES} caracteres.`
    : pilares.length !== 5 || avisos.length
      ? `Os cinco territórios não formam pilares válidos: ${avisos.join(' ')}`
      : null;
  return { texto, secoesUsadas: [{ titulo: 'Os territórios de conteúdo', hash: sha(texto) }], erro };
}

export function referenciaDaProjecao(fonte: {
  id: string;
  chave: string;
  versao: number;
  contentHash: string;
}, secoesUsadas: PautaMarcaSecaoUsada[]): string {
  const referencia = JSON.stringify({
    tipo: 'pauta.marca.projecao.v1',
    id: fonte.id,
    chave: fonte.chave,
    versao: fonte.versao,
    hash: fonte.contentHash,
    secoes: secoesUsadas,
  });
  if (referencia.length > 1_000) throw new Error('A referência da fonte passou de 1.000 caracteres.');
  return referencia;
}

export function lerReferenciaDaProjecao(valor: string | null): {
  id: string;
  chave: string;
  versao: number;
  hash: string;
  secoes: PautaMarcaSecaoUsada[];
} | null {
  try {
    const j = JSON.parse(valor ?? '') as Record<string, unknown>;
    if (j.tipo !== 'pauta.marca.projecao.v1' || typeof j.id !== 'string' ||
        typeof j.chave !== 'string' || typeof j.versao !== 'number' ||
        typeof j.hash !== 'string' || !Array.isArray(j.secoes)) return null;
    return j as { id: string; chave: string; versao: number; hash: string; secoes: PautaMarcaSecaoUsada[] };
  } catch {
    return null;
  }
}
