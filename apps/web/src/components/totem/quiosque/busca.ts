import { normalizarBusca, TOTEM_ROTULO_DO_SELO, type TotemCatalogoProduto } from '@mktos/shared';

/*
 * A BUSCA DO QUIOSQUE, toda no aparelho e sem rede.
 *
 * O texto passa por `normalizarBusca` dos dois lados (o mesmo que grava
 * `nomeBusca` na API), então acento e maiúscula não contam. Cada palavra
 * digitada precisa casar com alguma palavra do produto: igual, começo de
 * palavra ("cast" acha "castanha") ou com erro pequeno de digitação, medido
 * pela distância de Damerau restrita (troca de duas letras vizinhas conta como
 * um erro só). A tolerância cresce com o tamanho da palavra: palavra curta
 * precisa vir certa, senão "pao" acharia "pão", "pó" e "pá".
 *
 * Quem casa pelo nome vem antes de quem casa só pela categoria ou pelo selo.
 *
 * O catálogo da loja passa de 900 produtos e o totem é um aparelho modesto:
 * a busca roda a cada letra, então a conta de erro usa uma tabela só, guardada
 * entre as chamadas, e a ordem alfabética usa um Collator único.
 */

const ORDEM_ALFABETICA = new Intl.Collator('pt-BR');

const PALAVRAS_VAZIAS = new Set(['a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos']);

export function toleranciaDe(palavra: string): number {
  if (palavra.length <= 3) return 0;
  if (palavra.length <= 7) return 1;
  return 2;
}

/** Distância de edição com transposição de vizinhas; para cedo acima de `teto`. */
export function distanciaDeEdicao(a: string, b: string, teto = Infinity): number {
  if (Math.abs(a.length - b.length) > teto) return teto + 1;
  const linhas: number[][] = [];
  for (let i = 0; i <= a.length; i++) linhas.push([i]);
  for (let j = 1; j <= b.length; j++) linhas[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let menorDaLinha = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(linhas[i - 1]![j]! + 1, linhas[i]![j - 1]! + 1, linhas[i - 1]![j - 1]! + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, linhas[i - 2]![j - 2]! + 1);
      }
      linhas[i]![j] = d;
      if (d < menorDaLinha) menorDaLinha = d;
    }
    if (menorDaLinha > teto) return teto + 1;
  }
  return linhas[a.length]![b.length]!;
}

let tabela = new Int32Array(0);

/**
 * Quanto `termo` se afasta de `palavra`: 0 igual, 1 começo de palavra,
 * 2 em diante com erro de digitação; `null` quando não casa.
 *
 * Vale a menor distância entre o termo e a palavra inteira ou o começo dela
 * (palavra ainda pela metade e com erro), de um tamanho a menos a um a mais
 * que o termo. Todas saem da última linha de uma tabela só: a coluna `n` é a
 * distância até os `n` primeiros caracteres da palavra.
 */
export function casamento(termo: string, palavra: string): number | null {
  if (termo === palavra) return 0;
  if (palavra.startsWith(termo)) return 1;
  const tolerancia = toleranciaDe(termo);
  if (tolerancia === 0) return null;

  const a = termo.length;
  const b = Math.min(palavra.length, a + tolerancia);
  const largura = b + 1;
  if (tabela.length < (a + 1) * largura) tabela = new Int32Array((a + 1) * largura * 2);
  const d = tabela;
  for (let j = 0; j <= b; j++) d[j] = j;
  for (let i = 1; i <= a; i++) {
    const linha = i * largura;
    d[linha] = i;
    let menorDaLinha = i;
    for (let j = 1; j <= b; j++) {
      const custo = termo.charCodeAt(i - 1) === palavra.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(d[linha - largura + j]! + 1, d[linha + j - 1]! + 1, d[linha - largura + j - 1]! + custo);
      if (
        i > 1 &&
        j > 1 &&
        termo.charCodeAt(i - 1) === palavra.charCodeAt(j - 2) &&
        termo.charCodeAt(i - 2) === palavra.charCodeAt(j - 1)
      ) {
        v = Math.min(v, d[linha - 2 * largura + j - 2]! + 1);
      }
      d[linha + j] = v;
      if (v < menorDaLinha) menorDaLinha = v;
    }
    if (menorDaLinha > tolerancia) return null;
  }

  const ultima = a * largura;
  let melhor = palavra.length <= b ? d[ultima + palavra.length]! : Infinity;
  for (let n = Math.max(1, a - 1); n <= a + 1 && n <= b; n++) {
    if (n < palavra.length) melhor = Math.min(melhor, d[ultima + n]!);
  }
  return melhor <= tolerancia ? 2 + melhor : null;
}

export interface ItemDoIndice {
  produto: TotemCatalogoProduto;
  palavrasDoNome: string[];
  outrasPalavras: string[];
}

function palavras(texto: string | null | undefined): string[] {
  return texto ? normalizarBusca(texto).split(' ').filter(Boolean) : [];
}

export function indexarProdutos(produtos: readonly TotemCatalogoProduto[]): ItemDoIndice[] {
  return produtos.map((produto) => {
    const palavrasDoNome = [...new Set([...palavras(produto.nome), ...palavras(produto.nomeBusca)])];
    const outras = new Set([
      ...palavras(produto.categoria),
      ...palavras(produto.codigo),
      ...produto.selos.flatMap((s) => palavras(TOTEM_ROTULO_DO_SELO[s])),
    ]);
    for (const p of palavrasDoNome) outras.delete(p);
    return { produto, palavrasDoNome, outrasPalavras: [...outras] };
  });
}

export function termosDaConsulta(consulta: string): string[] {
  const todos = palavras(consulta);
  const uteis = todos.filter((t) => !PALAVRAS_VAZIAS.has(t));
  return uteis.length ? uteis : todos;
}

function melhorCasamento(termo: string, lista: readonly string[]): number | null {
  let melhor: number | null = null;
  for (const palavra of lista) {
    const c = casamento(termo, palavra);
    if (c !== null && (melhor === null || c < melhor)) melhor = c;
    if (melhor === 0) break;
  }
  return melhor;
}

export function buscarProdutos(indice: readonly ItemDoIndice[], consulta: string): TotemCatalogoProduto[] {
  const termos = termosDaConsulta(consulta);
  if (!termos.length) return [];
  const achados: { produto: TotemCatalogoProduto; pontos: number }[] = [];
  for (const item of indice) {
    let pontos = 0;
    let soPeloNome = true;
    for (const termo of termos) {
      const peloNome = melhorCasamento(termo, item.palavrasDoNome);
      if (peloNome !== null) {
        pontos += peloNome;
        continue;
      }
      const pelasOutras = melhorCasamento(termo, item.outrasPalavras);
      if (pelasOutras === null) {
        pontos = -1;
        break;
      }
      soPeloNome = false;
      pontos += pelasOutras;
    }
    if (pontos < 0) continue;
    achados.push({ produto: item.produto, pontos: pontos + (soPeloNome ? 0 : 100) });
  }
  return achados
    .sort((a, b) => a.pontos - b.pontos || ORDEM_ALFABETICA.compare(a.produto.nome, b.produto.nome))
    .map((a) => a.produto);
}

export function categoriasDoCatalogo(produtos: readonly TotemCatalogoProduto[]): string[] {
  const vistas = new Set<string>();
  for (const p of produtos) if (p.categoria?.trim()) vistas.add(p.categoria.trim());
  return [...vistas].sort(ORDEM_ALFABETICA.compare);
}

export function produtosEmOrdem(produtos: readonly TotemCatalogoProduto[], categoria: string | null): TotemCatalogoProduto[] {
  return produtos
    .filter((p) => !categoria || p.categoria?.trim() === categoria)
    .sort((a, b) => ORDEM_ALFABETICA.compare(a.nome, b.nome));
}
