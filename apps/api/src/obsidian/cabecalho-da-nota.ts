import { posix } from 'node:path';
import { ContextKind } from '@prisma/client';
import { lerMarcador } from '../memory/documentacao';

/*
 * ============================================================================
 * UMA NOTA DA VAULT, LIDA — corpo, título, tags, links e o CABEÇALHO (C19-05)
 * ============================================================================
 *
 * A leitura do corpo, do título, das tags e dos links é a mesma de antes desta
 * fatia, byte a byte, para arquivo com `\n`: mudar qualquer uma delas mudaria o
 * `contentHash` de nota que não mudou e geraria uma versão por arquivo na volta
 * seguinte ao deploy. Duas coisas mudaram, e as duas são consertos pedidos:
 *
 *  1. CABEÇALHO COM `\r\n` (ou com BOM) PASSA A SER LIDO (E-20.9). A expressão
 *     antiga exigia `\n` e, num arquivo salvo no Windows, o cabeçalho inteiro
 *     ia parar dentro do corpo.
 *  2. O CABEÇALHO DA BASE VIRA CAMPO DA MEMÓRIA: `kind`, `valido_de`,
 *     `valido_ate` e `substitui` (contrato da base, `00-Manual/Contrato de
 *     cabeçalho.md`). `dono`, `origem*` e `situacao` continuam de fora (C19-05).
 *
 * A MARCA DO GERADOR é lida por `lerMarcador`, a MESMA função com que o gerador
 * de documentação reconhece as páginas dele. Duas leituras da marca divergiriam
 * na primeira página estranha, e a divergência aqui é o eco: página gerada
 * voltando à memória como nota (R-7). Quem decide o que fazer com a marca é a
 * pertença (`pertenca-da-vault.ts`), ANTES de alguém olhar o `kind`.
 */

export interface CabecalhoDaNota {
  /** O arquivo começa com um bloco `---` fechado. */
  presente: boolean;
  /** `gerado_por: root-os` — página do gerador de documentação. */
  geradoPeloOs: boolean;
  /** `nota` quando o cabeçalho não diz; `kind` desconhecido também vira `nota`, com aviso. */
  kind: ContextKind;
  validFrom: Date | null;
  validUntil: Date | null;
  /** O valor cru de `substitui`; a resolução para chave é de `resolverSubstitui`. */
  substitui: string | null;
  /** O que foi lido e não serviu: vai ao recibo, nunca derruba a nota. */
  avisos: string[];
}

export interface NotaLida {
  path: string;
  folder: string | null;
  title: string;
  tags: string[];
  content: string;
  links: string[];
  wordCount: number;
  cabecalho: CabecalhoDaNota;
}

/*
 * O bloco de cabeçalho. Para arquivo com `\n` e sem BOM, casa exatamente o que
 * `/^---\n([\s\S]*?)\n---\n?/` casava — a expressão de antes desta fatia.
 */
const BLOCO = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/;

/** Os seis valores de `kind` do contrato da base, sem acento e em minúsculas. */
const KINDS: ReadonlySet<string> = new Set(Object.values(ContextKind));

/** `definição` → `definicao`; `Regra` → `regra`. */
function semAcento(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Tira o comentário YAML (` #` fora de aspas) e as aspas de volta do valor. */
function valorDoCampo(bruto: string): string {
  let v = bruto.trim();
  if ((v.startsWith('"') && v.includes('"', 1)) || (v.startsWith("'") && v.includes("'", 1))) {
    const aspa = v[0];
    return v.slice(1, v.indexOf(aspa, 1)).trim();
  }
  const comentario = v.search(/\s#/);
  if (comentario >= 0) v = v.slice(0, comentario);
  if (v.startsWith('#')) return '';
  return v.trim();
}

/** `2026-09-15` (meia-noite UTC) ou um instante ISO completo. Inválida: `null` e aviso. */
function lerData(valor: string, campo: string, avisos: string[]): Date | null {
  if (!valor) return null;
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (soData) {
    const [a, m, d] = soData.slice(1).map(Number);
    const data = new Date(Date.UTC(a, m - 1, d));
    if (data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d) return data;
  } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(valor)) {
    const data = new Date(valor.replace(' ', 'T'));
    if (!Number.isNaN(data.getTime())) return data;
  }
  avisos.push(`${campo} "${valor}" não é uma data ISO (AAAA-MM-DD); ficou vazio`);
  return null;
}

function lerCabecalho(texto: string, bloco: string | null): CabecalhoDaNota {
  const avisos: string[] = [];
  const base: CabecalhoDaNota = {
    presente: bloco !== null,
    geradoPeloOs: lerMarcador(texto).nosso,
    kind: ContextKind.nota,
    validFrom: null,
    validUntil: null,
    substitui: null,
    avisos,
  };
  if (bloco === null) return base;

  const campos = new Map<string, string>();
  for (const linha of bloco.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(linha);
    if (m) campos.set(m[1].toLowerCase(), valorDoCampo(m[2]));
  }

  const kindBruto = campos.get('kind');
  if (kindBruto) {
    const k = semAcento(kindBruto);
    if (KINDS.has(k)) base.kind = k as ContextKind;
    else avisos.push(`kind "${kindBruto}" não é um dos seis do contrato; a nota entrou como nota`);
  }
  base.validFrom = lerData(campos.get('valido_de') ?? '', 'valido_de', avisos);
  base.validUntil = lerData(campos.get('valido_ate') ?? '', 'valido_ate', avisos);
  const substitui = campos.get('substitui');
  base.substitui = substitui ? substitui : null;
  return base;
}

/**
 * Lê uma nota da vault. `caminho` é o relativo à raiz, já em NFC — é a chave da
 * nota no índice e na memória (C19-02).
 */
export function lerNotaDaVault(caminho: string, raw: string): NotaLida {
  const folderRel = posix.dirname(caminho);

  let body = raw;
  const tags = new Set<string>();
  const fm = BLOCO.exec(raw);
  if (fm) {
    body = raw.slice(fm[0].length);
    const inline = fm[1].match(/^tags:\s*\[([^\]]*)\]/m);
    if (inline) inline[1].split(',').forEach((t) => t.trim() && tags.add(t.trim().replace(/['"]/g, '')));
    const block = fm[1].match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
    if (block) block[1].split('\n').forEach((l) => { const m = l.match(/-\s*(.+)/); if (m) tags.add(m[1].trim()); });
  }
  for (const m of body.matchAll(/(?:^|\s)#([a-z0-9_\-/]{2,})/gi)) tags.add(m[1]);
  const links = [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());
  const h1 = body.match(/^#\s+(.+)$/m);
  const title = (h1?.[1] ?? caminho.replace(/\.md$/i, '').split('/').pop() ?? caminho).trim();

  return {
    path: caminho,
    folder: folderRel === '.' ? null : folderRel,
    title,
    tags: [...tags],
    content: body.trim(),
    links: [...new Set(links)],
    wordCount: body.split(/\s+/).filter(Boolean).length,
    cabecalho: lerCabecalho(raw, fm ? fm[1] : null),
  };
}

/**
 * O caminho que `substitui` aponta, normalizado como a chave (R-8): sem `[[ ]]`,
 * sem apelido (`|…`) nem seção (`#…`), `./` e `../` resolvidos a partir da pasta
 * da nota, `.md` quando falta a extensão, e NFC por último.
 *
 * Valor sem `/` que não é um caminho da raiz é procurado pelo NOME entre os
 * membros da volta, como o Obsidian resolve `[[Nota]]`; dois membros com o
 * mesmo nome não resolvem (aviso), porque escolher um seria apontar ao acaso.
 */
export function resolverSubstitui(
  valor: string,
  caminhoDaNota: string,
  membros: ReadonlySet<string>,
): { caminho: string | null; aviso: string | null } {
  let v = valor.trim();
  const wiki = /^\[\[([\s\S]*)\]\]$/.exec(v);
  if (wiki) v = wiki[1];
  v = v.split('|')[0].split('#')[0].trim().normalize('NFC');
  if (!v) return { caminho: null, aviso: `substitui "${valor}" ficou vazio depois de normalizado` };

  const relativo = v.startsWith('./') || v.startsWith('../');
  let caminho = relativo ? posix.normalize(posix.join(posix.dirname(caminhoDaNota), v)) : posix.normalize(v);
  if (caminho.startsWith('../') || caminho === '..' || caminho.startsWith('/')) {
    return { caminho: null, aviso: `substitui "${valor}" sai da raiz da vault` };
  }
  if (!/\.md$/i.test(caminho)) caminho = `${caminho}.md`;

  if (!relativo && !v.includes('/') && !membros.has(caminho)) {
    const nome = caminho.toLowerCase();
    const achados = [...membros].filter((m) => m.split('/').pop()!.toLowerCase() === nome);
    if (achados.length === 1) caminho = achados[0];
    else if (achados.length > 1) {
      return { caminho: null, aviso: `substitui "${valor}" bate com ${achados.length} notas de mesmo nome` };
    }
  }
  if (caminho === caminhoDaNota) return { caminho: null, aviso: `substitui "${valor}" aponta para a própria nota` };
  return { caminho: caminho.normalize('NFC'), aviso: null };
}
