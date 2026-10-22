import {
  ATRIBUICOES_VAZIAS,
  tituloNormalizado,
  type AtribuicoesDaPessoa,
  type FuncaoDoVault,
  type OrigemDoNomeNoVault,
} from '@mktos/shared';

/*
 * A LEITURA DAS ATRIBUIÇÕES NO VAULT (produção 22B, I6). Parte pura: recebe as
 * notas já lidas pela porta protegida do índice e devolve, por pessoa, o que
 * ela conduz, as funções de que é dona e as de que é substituta.
 *
 * As quatro fontes (ver `packages/shared/src/equipe-atribuicoes.ts`):
 *
 *   1. `20-Governanca/Sócios e papéis.md`  tabela Sócio · Conduz · Funções;
 *   2. `20-Governanca/<Nome>.md`           seção "## Dono das funções";
 *   3. `30-Organizacao/Matriz quem-faz-o-quê.md`  tabela Função · Dono ·
 *      Substituto · Agentes/automações · Estado;
 *   4. `30-Organizacao/Função <sep> <nome>.md`  `dono:` no frontmatter.
 *
 * A leitura é TOLERANTE no formato (link `[[Alvo|Rótulo]]` ou texto, "e", vírgula
 * ou barra entre nomes, travessão, meia-risca ou ponto mediano no nome da ficha)
 * e ESTRITA no casamento: um nome só casa com a pessoa quando é o mesmo nome,
 * ou quando um dos dois é só o primeiro nome do outro. "Os três" e "todos" valem
 * para cada sócio da tabela de sócios.
 */

export interface NotaDoVaultLida {
  caminho: string;
  conteudo: string;
  /** O id da nota na memória (`vault:<caminho>`), para o link do Contexto. */
  notaId: string | null;
}

interface FuncaoLida {
  chave: string;
  nome: string;
  caminho: string | null;
  notaId: string | null;
  estado: string | null;
  agentes: string | null;
  donos: string[] | 'todos';
  substitutos: string[] | 'todos';
}

export interface LeituraDoVault {
  socios: { nome: string; conduz: string | null; funcoes: string[] }[];
  pessoas: { nome: string; caminho: string; notaId: string | null; funcoes: string[] }[];
  funcoes: FuncaoLida[];
  /** Achou alguma das quatro fontes. */
  temGovernanca: boolean;
}

const PASTA_GOVERNANCA = '20 governanca';
const PASTA_ORGANIZACAO = '30 organizacao';

/** As pastas que a Equipe lê (para o filtro da consulta). */
export const PASTAS_DAS_ATRIBUICOES = ['20-Governanca', '30-Organizacao'] as const;

const norm = (s: string) => tituloNormalizado(s.normalize('NFC'));

function partesDoCaminho(caminho: string): { pasta: string; nome: string } {
  const p = caminho.normalize('NFC').replace(/\\/g, '/').split('/');
  const arquivo = p[p.length - 1] ?? '';
  return { pasta: norm(p[p.length - 2] ?? ''), nome: arquivo.replace(/\.md$/i, '') };
}

/** "Função — Comercial", "Função · Comercial", "Função - Comercial" → "Comercial". */
const PREFIXO_DE_FUNCAO = /^fun[cç][aã]o\s*[—–·:-]\s*/i;
export function nomeDaFuncao(texto: string): string {
  return texto.normalize('NFC').trim().replace(PREFIXO_DE_FUNCAO, '').trim();
}
const ehFichaDeFuncao = (nome: string) => PREFIXO_DE_FUNCAO.test(nome.normalize('NFC').trim());
const chaveDaFuncao = (texto: string) => norm(nomeDaFuncao(texto));

/** Os links `[[Alvo]]`, `[[Alvo|Rótulo]]` e `[[Alvo#seção]]` de um trecho. */
export function linksDoTrecho(trecho: string): { alvo: string; rotulo: string }[] {
  const out: { alvo: string; rotulo: string }[] = [];
  for (const m of trecho.matchAll(/\[\[([^\]]+?)\]\]/g)) {
    const [alvoBruto, rotulo] = m[1].replace(/\\\|/g, '|').split('|');
    const alvo = alvoBruto.split('#')[0].split('/').pop()!.replace(/\.md$/i, '').trim();
    if (alvo) out.push({ alvo, rotulo: (rotulo ?? alvo).trim() });
  }
  return out;
}

/** As células de uma linha de tabela, sem partir no `|` de dentro de um link. */
export function celulasDaLinha(linha: string): string[] {
  const t = linha.trim().replace(/^\|/, '').replace(/\|$/, '');
  const celulas: string[] = [];
  let atual = '';
  let dentro = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '[' && t[i + 1] === '[') { dentro++; atual += '[['; i++; continue; }
    if (c === ']' && t[i + 1] === ']') { dentro = Math.max(0, dentro - 1); atual += ']]'; i++; continue; }
    if (c === '\\' && t[i + 1] === '|') { atual += '|'; i++; continue; }
    if (c === '|' && dentro === 0) { celulas.push(atual.trim()); atual = ''; continue; }
    atual += c;
  }
  celulas.push(atual.trim());
  return celulas;
}

/** As tabelas de uma nota: o cabeçalho (normalizado) e as linhas. */
export function tabelasDaNota(conteudo: string): { cabecalho: string[]; linhas: string[][] }[] {
  const tabelas: { cabecalho: string[]; linhas: string[][] }[] = [];
  const linhas = conteudo.split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    if (!linhas[i].trim().startsWith('|') || !/^\s*\|?\s*:?-{2,}/.test(linhas[i + 1] ?? '')) continue;
    const cabecalho = celulasDaLinha(linhas[i]).map(norm);
    const corpo: string[][] = [];
    let j = i + 2;
    for (; j < linhas.length && linhas[j].trim().startsWith('|'); j++) corpo.push(celulasDaLinha(linhas[j]));
    tabelas.push({ cabecalho, linhas: corpo });
    i = j - 1;
  }
  return tabelas;
}

const VAZIO = new Set(['', '—', '–', '-', 'n/a', 'nenhum', 'ninguem', 'a definir']);

/** O texto de uma célula sem a marcação de link. */
export function textoDaCelula(celula: string): string {
  return celula
    .replace(/\[\[([^\]]+?)\]\]/g, (_m, dentro: string) => {
      const [alvo, rotulo] = dentro.replace(/\\\|/g, '|').split('|');
      return (rotulo ?? alvo.split('#')[0].split('/').pop() ?? '').trim();
    })
    .replace(/[*_`]/g, '')
    .trim();
}

/** Os nomes de pessoa de uma célula (`Rodrigo`, `[[Lucas]] e Pedro`, `os três`). */
export function nomesDaCelula(celula: string): string[] | 'todos' {
  const texto = textoDaCelula(celula);
  const n = norm(texto);
  if (/\b(os tres|os 3|todos|todos os socios|os socios)\b/.test(n)) return 'todos';
  return texto
    .split(/\s*(?:,|;|\/|\+|&|\be\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => !VAZIO.has(norm(s)));
}

/** O mesmo nome, ou um dos dois é só o primeiro nome do outro. */
export function mesmoNome(a: string, b: string): boolean {
  const x = norm(a).split(' ').filter(Boolean);
  const y = norm(b).split(' ').filter(Boolean);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  if (x.length === 1) return x[0] === y[0];
  if (y.length === 1) return y[0] === x[0];
  return false;
}

/** O valor de `dono:` no frontmatter (linha ou lista YAML). */
export function donoDoFrontmatter(conteudo: string): string | null {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(conteudo);
  if (!m) return null;
  const linhas = m[1].split(/\r?\n/);
  const i = linhas.findIndex((l) => /^dono\s*:/i.test(l));
  if (i < 0) return null;
  const valor = linhas[i].replace(/^dono\s*:/i, '').trim().replace(/^["']|["']$/g, '');
  // `[[Alice]]` é link; `[Alice, Bruno]` é lista YAML na mesma linha.
  if (valor) return (valor.startsWith('[[') ? valor : valor.replace(/^\[(.*)\]$/, '$1')).replace(/["']/g, '');
  const itens: string[] = [];
  for (let j = i + 1; j < linhas.length && /^\s+-\s*/.test(linhas[j]); j++) {
    itens.push(linhas[j].replace(/^\s+-\s*/, '').trim().replace(/^["']|["']$/g, ''));
  }
  return itens.length ? itens.join(', ') : null;
}

/** Os itens da seção "## Dono das funções" (links; sem link, o texto do item). */
export function funcoesDaSecaoDono(conteudo: string): string[] {
  const linhas = conteudo.split(/\r?\n/);
  const inicio = linhas.findIndex((l) => /^#{1,6}\s/.test(l) && norm(l.replace(/^#+/, '')).startsWith('dono das funcoes'));
  if (inicio < 0) return [];
  const nivel = (/^#+/.exec(linhas[inicio]) ?? ['##'])[0].length;
  const out: string[] = [];
  for (let i = inicio + 1; i < linhas.length; i++) {
    const h = /^(#+)\s/.exec(linhas[i]);
    if (h && h[1].length <= nivel) break;
    const l = linhas[i].trim();
    if (!/^[-*+]\s|^\d+\.\s/.test(l)) continue;
    const links = linksDoTrecho(l);
    if (links.length) out.push(...links.map((k) => (ehFichaDeFuncao(k.alvo) ? k.alvo : k.rotulo)));
    else out.push(textoDaCelula(l.replace(/^[-*+]\s|^\d+\.\s/, '')).split(/\s[—–:]\s/)[0]);
  }
  return out.filter((s) => s.trim());
}

const coluna = (cabecalho: string[], ...prefixos: string[]) =>
  cabecalho.findIndex((c) => prefixos.some((p) => c.startsWith(p) || c.includes(p)));

/** Os nomes de função de uma célula (links ou lista por vírgula). */
function funcoesDaCelula(celula: string): string[] {
  const links = linksDoTrecho(celula);
  if (links.length) return links.map((k) => (ehFichaDeFuncao(k.alvo) ? k.alvo : k.rotulo));
  return textoDaCelula(celula).split(/\s*[,;]\s*/).filter((s) => !VAZIO.has(norm(s)));
}

export function lerVault(notas: readonly NotaDoVaultLida[]): LeituraDoVault {
  const leitura: LeituraDoVault = { socios: [], pessoas: [], funcoes: [], temGovernanca: false };
  const funcoes = new Map<string, FuncaoLida>();
  const funcao = (texto: string): FuncaoLida => {
    const chave = chaveDaFuncao(texto);
    let f = funcoes.get(chave);
    if (!f) {
      f = { chave, nome: nomeDaFuncao(texto), caminho: null, notaId: null, estado: null, agentes: null, donos: [], substitutos: [] };
      funcoes.set(chave, f);
    }
    return f;
  };
  const somar = (atual: string[] | 'todos', novos: string[] | 'todos'): string[] | 'todos' =>
    atual === 'todos' || novos === 'todos' ? 'todos' : [...atual, ...novos.filter((n) => !atual.some((a) => mesmoNome(a, n)))];

  for (const nota of notas) {
    const { pasta, nome } = partesDoCaminho(nota.caminho);
    const n = norm(nome);
    if (pasta === PASTA_GOVERNANCA && n === 'socios e papeis') {
      leitura.temGovernanca = true;
      for (const t of tabelasDaNota(nota.conteudo)) {
        const cSocio = coluna(t.cabecalho, 'socio');
        if (cSocio < 0) continue;
        const cConduz = coluna(t.cabecalho, 'conduz');
        const cFuncoes = coluna(t.cabecalho, 'func');
        for (const l of t.linhas) {
          const socio = textoDaCelula(l[cSocio] ?? '');
          if (!socio || VAZIO.has(norm(socio))) continue;
          const conduz = cConduz >= 0 ? textoDaCelula(l[cConduz] ?? '') : '';
          leitura.socios.push({
            nome: socio,
            conduz: conduz && !VAZIO.has(norm(conduz)) ? conduz : null,
            funcoes: cFuncoes >= 0 ? funcoesDaCelula(l[cFuncoes] ?? '') : [],
          });
        }
      }
      continue;
    }
    if (pasta === PASTA_GOVERNANCA) {
      const lista = funcoesDaSecaoDono(nota.conteudo);
      if (!lista.length && !/^#{1,6}\s+dono das fun/im.test(nota.conteudo.normalize('NFD').replace(/[̀-ͯ]/g, ''))) continue;
      leitura.temGovernanca = true;
      leitura.pessoas.push({ nome, caminho: nota.caminho, notaId: nota.notaId, funcoes: lista });
      continue;
    }
    if (pasta === PASTA_ORGANIZACAO && n.startsWith('matriz quem faz o que')) {
      leitura.temGovernanca = true;
      for (const t of tabelasDaNota(nota.conteudo)) {
        const cFuncao = coluna(t.cabecalho, 'func');
        const cDono = coluna(t.cabecalho, 'dono');
        if (cFuncao < 0 || cDono < 0) continue;
        const cSubst = coluna(t.cabecalho, 'substitut');
        const cAgentes = coluna(t.cabecalho, 'agente', 'automac');
        const cEstado = coluna(t.cabecalho, 'estado');
        for (const l of t.linhas) {
          const celula = l[cFuncao] ?? '';
          const links = linksDoTrecho(celula);
          const nomeF = links.length ? (ehFichaDeFuncao(links[0].alvo) ? links[0].alvo : links[0].rotulo) : textoDaCelula(celula);
          if (!nomeF || VAZIO.has(norm(nomeF))) continue;
          const f = funcao(nomeF);
          f.donos = somar(f.donos, nomesDaCelula(l[cDono] ?? ''));
          if (cSubst >= 0) f.substitutos = somar(f.substitutos, nomesDaCelula(l[cSubst] ?? ''));
          const agentes = cAgentes >= 0 ? textoDaCelula(l[cAgentes] ?? '') : '';
          const estado = cEstado >= 0 ? textoDaCelula(l[cEstado] ?? '') : '';
          if (agentes && !VAZIO.has(norm(agentes))) f.agentes = agentes;
          if (estado && !VAZIO.has(norm(estado))) f.estado = estado;
        }
      }
      continue;
    }
    if (pasta === PASTA_ORGANIZACAO && ehFichaDeFuncao(nome)) {
      leitura.temGovernanca = true;
      const f = funcao(nome);
      f.nome = nomeDaFuncao(nome);
      f.caminho = nota.caminho;
      f.notaId = nota.notaId;
      const dono = donoDoFrontmatter(nota.conteudo);
      if (dono) f.donos = somar(f.donos, nomesDaCelula(dono));
    }
  }
  // As funções que só a tabela de sócios ou a nota da pessoa citam também entram (sem dono da matriz).
  for (const s of leitura.socios) for (const nomeF of s.funcoes) funcao(nomeF);
  for (const p of leitura.pessoas) for (const nomeF of p.funcoes) funcao(nomeF);
  leitura.funcoes = [...funcoes.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return leitura;
}

/** Os nomes de sócio que o vault conhece (tabela de sócios e notas de pessoa). */
export function sociosDoVault(leitura: LeituraDoVault): string[] {
  const out: string[] = [];
  for (const nome of [...leitura.socios.map((s) => s.nome), ...leitura.pessoas.map((p) => p.nome)]) {
    if (!out.some((o) => mesmoNome(o, nome) && norm(o).split(' ').length >= norm(nome).split(' ').length)) {
      const i = out.findIndex((o) => mesmoNome(o, nome));
      if (i >= 0) out.splice(i, 1);
      out.push(nome);
    }
  }
  return out;
}

function paraTela(f: FuncaoLida): FuncaoDoVault {
  return { nome: f.nome, caminho: f.caminho, notaId: f.notaId, estado: f.estado, agentes: f.agentes };
}

/** As atribuições de UMA pessoa, pelo nome dela no vault. */
export function atribuicoesDaPessoa(
  leitura: LeituraDoVault,
  nomeNoVault: string | null,
  origemDoNome: OrigemDoNomeNoVault,
): AtribuicoesDaPessoa {
  if (!nomeNoVault) return { ...ATRIBUICOES_VAZIAS, origemDoNome: 'a_decidir' };
  // "Os três" vale para quem é sócio na tabela (ou, sem tabela, para quem tem nota na Governança).
  const ehSocio = leitura.socios.length
    ? leitura.socios.some((s) => mesmoNome(s.nome, nomeNoVault))
    : leitura.pessoas.some((p) => mesmoNome(p.nome, nomeNoVault));
  const ehEla = (nomes: string[] | 'todos') => (nomes === 'todos' ? ehSocio : nomes.some((n) => mesmoNome(n, nomeNoVault)));
  const socio = leitura.socios.find((s) => mesmoNome(s.nome, nomeNoVault)) ?? null;
  const pessoa = leitura.pessoas.find((p) => mesmoNome(p.nome, nomeNoVault)) ?? null;
  const citadas = new Set([...(socio?.funcoes ?? []), ...(pessoa?.funcoes ?? [])].map(chaveDaFuncao));
  const dona = leitura.funcoes.filter((f) => citadas.has(f.chave) || ehEla(f.donos));
  const substituta = leitura.funcoes.filter((f) => ehEla(f.substitutos) && !dona.includes(f));
  return {
    nomeNoVault,
    origemDoNome,
    conduz: socio?.conduz ?? null,
    dona: dona.map(paraTela),
    substituta: substituta.map(paraTela),
    nota: pessoa ? { caminho: pessoa.caminho, notaId: pessoa.notaId } : null,
  };
}
