import { inflateSync } from 'node:zlib';

/*
 * O TEXTO DE UM PDF, SEM DEPENDÊNCIA NOVA (produção 21, P7, 21/10/2026).
 *
 * O banco de atas lê PDF COM TEXTO da pasta do Drive. O Drive não devolve o
 * texto de um PDF (o `export` só serve a Documento Google) e dependência nova
 * é decisão humana, então este leitor é pequeno e de propósito limitado:
 *   · objetos soltos e objetos dentro de `ObjStm` (PDF 1.5+);
 *   · fluxos sem filtro ou com `FlateDecode` (o que Word, Docs e LibreOffice
 *     geram); outro filtro é pulado;
 *   · texto pelos operadores `Tj`, `TJ`, `'` e `"`, com a fonte de `Tf`
 *     traduzida pelo `ToUnicode` (bfchar e bfrange) quando há, e por
 *     WinAnsi (latin-1) quando a fonte é simples e não tem mapa;
 *   · quebra de linha em `T*`, `'`, `"`, `Td`/`TD` com deslocamento vertical,
 *     `Tm` que muda a linha e `ET`.
 * PDF cifrado é recusado; PDF que é só imagem (escaneado) volta sem texto e
 * quem chama diz isso à pessoa. Nada aqui executa o que o PDF manda (não há
 * JavaScript, formulário nem ação): é leitura de bytes.
 */

export class PdfIlegivelError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'PdfIlegivelError';
  }
}

type Valor =
  | { t: 'num'; v: number }
  | { t: 'nome'; v: string }
  | { t: 'str'; v: Buffer }
  | { t: 'arr'; v: Valor[] }
  | { t: 'dict'; v: Map<string, Valor> }
  | { t: 'ref'; n: number }
  | { t: 'bool'; v: boolean }
  | { t: 'nulo' }
  | { t: 'op'; v: string };

interface Objeto {
  valor: Valor;
  fluxo: Buffer | null;
}

/** Tetos contra PDF malformado ou hostil: o que um fluxo descomprime e quantos códigos um mapa guarda. */
const MAX_FLUXO_DESCOMPRIMIDO = 64 * 1024 * 1024;
const MAX_CODIGOS_DO_MAPA = 200_000;

const ESPACO = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/** Um leitor de tokens do PDF sobre um Buffer (sintaxe de objeto e de conteúdo). */
class Leitor {
  pos = 0;
  constructor(private readonly b: Buffer, inicio = 0) {
    this.pos = inicio;
  }

  fim(): boolean {
    return this.pos >= this.b.length;
  }

  private pularEspaco(): void {
    while (this.pos < this.b.length) {
      const c = this.b[this.pos];
      if (ESPACO.has(c)) this.pos++;
      else if (c === 0x25) {
        while (this.pos < this.b.length && this.b[this.pos] !== 0x0a && this.b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  /** O próximo valor (ou operador, na sintaxe de conteúdo). `null` no fim. */
  proximo(): Valor | null {
    this.pularEspaco();
    if (this.fim()) return null;
    const c = this.b[this.pos];
    if (c === 0x2f) return { t: 'nome', v: this.nome() };
    if (c === 0x28) return { t: 'str', v: this.literal() };
    if (c === 0x3c) {
      if (this.b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return this.dicionario();
      }
      return { t: 'str', v: this.hex() };
    }
    if (c === 0x5b) {
      this.pos++;
      const itens: Valor[] = [];
      for (let guarda = 0; guarda < 1_000_000; guarda++) {
        this.pularEspaco();
        if (this.fim()) break;
        if (this.b[this.pos] === 0x5d) {
          this.pos++;
          break;
        }
        const v = this.proximo();
        if (!v) break;
        itens.push(v);
      }
      return { t: 'arr', v: this.juntarRefs(itens) };
    }
    if (c === 0x5d || c === 0x3e || c === 0x7b || c === 0x7d || c === 0x29) {
      this.pos++;
      return this.proximo();
    }
    const inicio = this.pos;
    while (this.pos < this.b.length && !ESPACO.has(this.b[this.pos]) && !DELIM.has(this.b[this.pos])) this.pos++;
    const palavra = this.b.toString('latin1', inicio, this.pos);
    if (!palavra) {
      this.pos++;
      return this.proximo();
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(palavra)) return { t: 'num', v: Number(palavra) };
    if (palavra === 'true' || palavra === 'false') return { t: 'bool', v: palavra === 'true' };
    if (palavra === 'null') return { t: 'nulo' };
    return { t: 'op', v: palavra };
  }

  /** `n g R` dentro de array e dicionário vira referência. */
  private juntarRefs(itens: Valor[]): Valor[] {
    const saida: Valor[] = [];
    for (let i = 0; i < itens.length; i++) {
      const a = itens[i];
      const b = itens[i + 1];
      const c = itens[i + 2];
      if (a.t === 'num' && b?.t === 'num' && c?.t === 'op' && c.v === 'R') {
        saida.push({ t: 'ref', n: a.v });
        i += 2;
      } else saida.push(a);
    }
    return saida;
  }

  private dicionario(): Valor {
    const itens: Valor[] = [];
    for (let guarda = 0; guarda < 1_000_000; guarda++) {
      this.pularEspaco();
      if (this.fim()) break;
      if (this.b[this.pos] === 0x3e && this.b[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      const v = this.proximo();
      if (!v) break;
      itens.push(v);
    }
    const juntos = this.juntarRefs(itens);
    const mapa = new Map<string, Valor>();
    for (let i = 0; i + 1 < juntos.length; i += 2) {
      const k = juntos[i];
      if (k.t === 'nome') mapa.set(k.v, juntos[i + 1]);
      else i--; // chave fora do lugar: realinha
    }
    return { t: 'dict', v: mapa };
  }

  private nome(): string {
    this.pos++;
    const inicio = this.pos;
    while (this.pos < this.b.length && !ESPACO.has(this.b[this.pos]) && !DELIM.has(this.b[this.pos])) this.pos++;
    return this.b.toString('latin1', inicio, this.pos).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }

  private literal(): Buffer {
    this.pos++;
    const out: number[] = [];
    let nivel = 1;
    while (this.pos < this.b.length) {
      const c = this.b[this.pos++];
      if (c === 0x5c) {
        const d = this.b[this.pos++];
        if (d === 0x6e) out.push(0x0a);
        else if (d === 0x72) out.push(0x0d);
        else if (d === 0x74) out.push(0x09);
        else if (d === 0x62) out.push(0x08);
        else if (d === 0x66) out.push(0x0c);
        else if (d === 0x0d) {
          if (this.b[this.pos] === 0x0a) this.pos++;
        } else if (d === 0x0a) {
          // continuação de linha
        } else if (d >= 0x30 && d <= 0x37) {
          let oct = String.fromCharCode(d);
          for (let k = 0; k < 2 && this.b[this.pos] >= 0x30 && this.b[this.pos] <= 0x37; k++) oct += String.fromCharCode(this.b[this.pos++]);
          out.push(parseInt(oct, 8) & 0xff);
        } else if (d !== undefined) out.push(d);
      } else if (c === 0x28) {
        nivel++;
        out.push(c);
      } else if (c === 0x29) {
        nivel--;
        if (nivel === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return Buffer.from(out);
  }

  private hex(): Buffer {
    this.pos++;
    let s = '';
    while (this.pos < this.b.length && this.b[this.pos] !== 0x3e) {
      const ch = String.fromCharCode(this.b[this.pos++]);
      if (/[0-9a-fA-F]/.test(ch)) s += ch;
    }
    this.pos++;
    if (s.length % 2) s += '0';
    return Buffer.from(s, 'hex');
  }
}

const num = (v: Valor | undefined): number | null => (v && v.t === 'num' ? v.v : null);
const nomeDe = (v: Valor | undefined): string | null => (v && v.t === 'nome' ? v.v : null);

/** Desfaz os filtros de um fluxo. Só `FlateDecode` (e nenhum); qualquer outro devolve `null`. */
function decodificar(dict: Map<string, Valor>, cru: Buffer): Buffer | null {
  const filtro = dict.get('Filter');
  const filtros = !filtro ? [] : filtro.t === 'arr' ? filtro.v.map(nomeDe) : [nomeDe(filtro)];
  let dados = cru;
  for (const f of filtros) {
    if (f === 'FlateDecode' || f === 'Fl') {
      try {
        // Teto do que um fluxo pode descomprimir: um PDF-bomba não derruba o processo.
        dados = inflateSync(dados, { maxOutputLength: MAX_FLUXO_DESCOMPRIMIDO });
      } catch {
        return null;
      }
    } else return null;
  }
  return dados;
}

/** Os objetos do arquivo, pelo número (o último vence, como numa atualização incremental). */
function lerObjetos(pdf: Buffer): Map<number, Objeto> {
  const objetos = new Map<number, Objeto>();
  const texto = pdf.toString('latin1');
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const n = Number(m[1]);
    const leitor = new Leitor(pdf, m.index + m[0].length);
    const valor = leitor.proximo();
    if (!valor) continue;
    let fluxo: Buffer | null = null;
    const depois = texto.slice(leitor.pos, leitor.pos + 30);
    const ms = /^\s*stream(\r\n|\n|\r)/.exec(depois);
    if (ms && valor.t === 'dict') {
      const inicio = leitor.pos + ms.index + ms[0].length;
      const tam = num(valor.v.get('Length'));
      let fim = tam !== null && tam >= 0 && inicio + tam <= pdf.length ? inicio + tam : -1;
      if (fim < 0 || !/^\s*endstream/.test(texto.slice(fim, fim + 20))) {
        const achado = texto.indexOf('endstream', inicio);
        fim = achado < 0 ? pdf.length : achado;
        // tira o fim de linha antes de `endstream`
        while (fim > inicio && (pdf[fim - 1] === 0x0a || pdf[fim - 1] === 0x0d)) fim--;
      }
      fluxo = pdf.subarray(inicio, fim);
      re.lastIndex = Math.max(re.lastIndex, fim);
    }
    objetos.set(n, { valor, fluxo });
  }
  // Os objetos guardados dentro de fluxos de objeto (`/Type /ObjStm`).
  for (const [, o] of [...objetos]) {
    if (o.valor.t !== 'dict' || nomeDe(o.valor.v.get('Type')) !== 'ObjStm' || !o.fluxo) continue;
    const dados = decodificar(o.valor.v, o.fluxo);
    const n = num(o.valor.v.get('N'));
    const primeiro = num(o.valor.v.get('First'));
    if (!dados || n === null || primeiro === null) continue;
    const cab = new Leitor(dados);
    const pares: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const a = num(cab.proximo() ?? undefined);
      const b = num(cab.proximo() ?? undefined);
      if (a === null || b === null) break;
      pares.push([a, b]);
    }
    for (const [numero, desloc] of pares) {
      if (objetos.has(numero)) continue;
      const v = new Leitor(dados, primeiro + desloc).proximo();
      if (v) objetos.set(numero, { valor: v, fluxo: null });
    }
  }
  return objetos;
}

/** O mapa de códigos para texto de um `ToUnicode`, e o tamanho do código em bytes. */
function lerCMap(dados: Buffer): { mapa: Map<string, string>; bytes: number } {
  const mapa = new Map<string, string>();
  const l = new Leitor(dados);
  const fila: Valor[] = [];
  let bytes = 0;
  const utf16 = (b: Buffer): string => {
    let s = '';
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    if (b.length % 2) s += String.fromCharCode(b[b.length - 1]);
    return s;
  };
  for (let guarda = 0; guarda < 2_000_000; guarda++) {
    const v = l.proximo();
    if (!v) break;
    if (v.t === 'op') {
      if (v.v === 'begincodespacerange') fila.length = 0;
      else if (v.v === 'endcodespacerange') {
        const primeiro = fila.find((x) => x.t === 'str') as { t: 'str'; v: Buffer } | undefined;
        if (primeiro) bytes = primeiro.v.length;
        fila.length = 0;
      } else if (v.v === 'beginbfchar' || v.v === 'beginbfrange') fila.length = 0;
      else if (v.v === 'endbfchar') {
        for (let i = 0; i + 1 < fila.length; i += 2) {
          const a = fila[i];
          const b = fila[i + 1];
          if (a.t === 'str' && b.t === 'str') mapa.set(a.v.toString('hex'), utf16(b.v));
        }
        fila.length = 0;
      } else if (v.v === 'endbfrange') {
        for (let i = 0; i + 2 < fila.length; i += 3) {
          const a = fila[i];
          const b = fila[i + 1];
          const c = fila[i + 2];
          if (a.t !== 'str' || b.t !== 'str') continue;
          const ini = parseInt(a.v.toString('hex') || '0', 16);
          const fim = parseInt(b.v.toString('hex') || '0', 16);
          const largura = a.v.length;
          for (let k = 0; ini + k <= fim && k < 65536 && mapa.size < MAX_CODIGOS_DO_MAPA; k++) {
            const codigo = (ini + k).toString(16).padStart(largura * 2, '0');
            if (c.t === 'str') {
              const base = Buffer.from(c.v);
              const ultimo = base.length - 1;
              if (ultimo >= 0) base[ultimo] = (base[ultimo] + k) & 0xff;
              mapa.set(codigo, utf16(base));
            } else if (c.t === 'arr' && c.v[k]?.t === 'str') mapa.set(codigo, utf16((c.v[k] as { v: Buffer }).v));
          }
        }
        fila.length = 0;
      }
    } else fila.push(v);
  }
  return { mapa, bytes };
}

interface Fonte {
  mapa: Map<string, string> | null;
  bytes: number;
}

/** WinAnsi: os bytes 0x80–0x9F do cp1252 que o latin-1 não cobre. */
const CP1252: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function textoDaFonte(f: Fonte | null, b: Buffer): string {
  if (f?.mapa && f.mapa.size) {
    const largura = f.bytes || 1;
    let s = '';
    for (let i = 0; i + largura <= b.length; i += largura) {
      const codigo = b.subarray(i, i + largura).toString('hex');
      s += f.mapa.get(codigo) ?? '';
    }
    return s;
  }
  if (f && f.bytes === 2) return ''; // fonte composta sem mapa: os códigos não são letras
  let s = '';
  for (const c of b) s += CP1252[c] ?? String.fromCharCode(c);
  return s;
}

/**
 * O texto de um PDF, na ordem dos fluxos de conteúdo de cada página. Lança
 * `PdfIlegivelError` para PDF cifrado ou que não é PDF; PDF sem texto (imagem)
 * volta com texto vazio.
 */
export function textoDoPdf(pdf: Buffer, maxCaracteres = 400_000): string {
  if (!pdf.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new PdfIlegivelError('o arquivo não é um PDF');
  const bruto = pdf.toString('latin1');
  if (/\/Encrypt\s/.test(bruto)) throw new PdfIlegivelError('o PDF é protegido por senha ou cifrado');
  const objetos = lerObjetos(pdf);
  const resolver = (v: Valor | undefined, guarda = 0): Valor | undefined => {
    if (v?.t === 'ref' && guarda < 20) return resolver(objetos.get(v.n)?.valor, guarda + 1);
    return v;
  };
  const dictDe = (v: Valor | undefined): Map<string, Valor> | null => {
    const r = resolver(v);
    return r?.t === 'dict' ? r.v : null;
  };
  const cacheDeFontes = new Map<number | string, Fonte>();
  const fonteDe = (v: Valor | undefined): Fonte | null => {
    const chave = v?.t === 'ref' ? v.n : null;
    if (chave !== null && cacheDeFontes.has(chave)) return cacheDeFontes.get(chave)!;
    const d = dictDe(v);
    if (!d) return null;
    const composta = nomeDe(d.get('Subtype')) === 'Type0';
    let fonte: Fonte = { mapa: null, bytes: composta ? 2 : 1 };
    const tu = d.get('ToUnicode');
    if (tu?.t === 'ref') {
      const o = objetos.get(tu.n);
      if (o?.fluxo && o.valor.t === 'dict') {
        const dados = decodificar(o.valor.v, o.fluxo);
        if (dados) {
          const cm = lerCMap(dados);
          fonte = { mapa: cm.mapa, bytes: cm.bytes || fonte.bytes };
        }
      }
    }
    if (chave !== null) cacheDeFontes.set(chave, fonte);
    return fonte;
  };

  // As páginas, na ordem da árvore.
  const paginas: Map<string, Valor>[] = [];
  const raiz = [...objetos.values()].find((o) => o.valor.t === 'dict' && nomeDe(o.valor.v.get('Type')) === 'Catalog');
  const visitar = (no: Valor | undefined, herdado: Map<string, Valor> | null, guarda = 0) => {
    const d = dictDe(no);
    if (!d || guarda > 50 || paginas.length > 5000) return;
    const recursos = dictDe(d.get('Resources')) ?? herdado;
    const tipo = nomeDe(d.get('Type'));
    if (tipo === 'Pages' || d.has('Kids')) {
      const filhos = resolver(d.get('Kids'));
      if (filhos?.t === 'arr') for (const f of filhos.v) visitar(f, recursos, guarda + 1);
      return;
    }
    const pagina = new Map(d);
    if (recursos) pagina.set('Resources', { t: 'dict', v: recursos });
    paginas.push(pagina);
  };
  const catalogo = raiz?.valor.t === 'dict' ? raiz.valor.v : null;
  if (catalogo) visitar(catalogo.get('Pages'), null);
  if (!paginas.length) {
    for (const o of objetos.values()) if (o.valor.t === 'dict' && nomeDe(o.valor.v.get('Type')) === 'Page') paginas.push(o.valor.v);
  }

  const partes: string[] = [];
  let total = 0;
  for (const pagina of paginas) {
    if (total >= maxCaracteres) break;
    const recursos = dictDe(pagina.get('Resources'));
    const fontes = dictDe(recursos?.get('Font'));
    const conteudo = resolver(pagina.get('Contents'));
    const refs: Valor[] = conteudo?.t === 'arr' ? conteudo.v : pagina.get('Contents') ? [pagina.get('Contents')!] : [];
    const blocos: Buffer[] = [];
    for (const r of refs) {
      if (r.t !== 'ref') continue;
      const o = objetos.get(r.n);
      if (!o?.fluxo || o.valor.t !== 'dict') continue;
      const dados = decodificar(o.valor.v, o.fluxo);
      if (dados) blocos.push(dados);
    }
    const texto = textoDoConteudo(Buffer.concat(blocos), (nome) => fonteDe(fontes?.get(nome)));
    if (texto.trim()) {
      partes.push(texto.trim());
      total += texto.length;
    }
  }
  const juntado = partes.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return Array.from(juntado).slice(0, maxCaracteres).join('');
}

/** O texto de um fluxo de conteúdo: os operadores de texto, com a fonte da vez. */
function textoDoConteudo(dados: Buffer, fonte: (nome: string) => Fonte | null): string {
  const l = new Leitor(dados);
  const pilha: Valor[] = [];
  let atual: Fonte | null = null;
  let saida = '';
  let ultimoY: number | null = null;
  const quebrar = () => {
    if (saida && !saida.endsWith('\n')) saida += '\n';
  };
  const mostrar = (b: Buffer) => {
    saida += textoDaFonte(atual, b);
  };
  for (let guarda = 0; guarda < 5_000_000; guarda++) {
    const v = l.proximo();
    if (!v) break;
    if (v.t !== 'op') {
      pilha.push(v);
      if (pilha.length > 64) pilha.shift();
      continue;
    }
    const op = v.v;
    const args = pilha.splice(0);
    if (op === 'Tf') {
      const nome = args.find((a) => a.t === 'nome') as { v: string } | undefined;
      atual = nome ? fonte(nome.v) : null;
    } else if (op === 'Tj') {
      const s = args.find((a) => a.t === 'str') as { v: Buffer } | undefined;
      if (s) mostrar(s.v);
    } else if (op === "'" || op === '"') {
      quebrar();
      const s = [...args].reverse().find((a) => a.t === 'str') as { v: Buffer } | undefined;
      if (s) mostrar(s.v);
    } else if (op === 'TJ') {
      const arr = args.find((a) => a.t === 'arr') as { v: Valor[] } | undefined;
      for (const item of arr?.v ?? []) {
        if (item.t === 'str') mostrar(item.v);
        else if (item.t === 'num' && item.v < -180 && !saida.endsWith(' ')) saida += ' ';
      }
    } else if (op === 'T*') quebrar();
    else if (op === 'Td' || op === 'TD') {
      const ty = num(args[1]) ?? 0;
      const tx = num(args[0]) ?? 0;
      if (Math.abs(ty) > 0.5) quebrar();
      else if (tx > 0.5 && saida && !/\s$/.test(saida)) saida += ' ';
    } else if (op === 'Tm') {
      const y = num(args[5]);
      if (y !== null && ultimoY !== null && Math.abs(y - ultimoY) > 0.5) quebrar();
      else if (y !== null && ultimoY !== null && saida && !/\s$/.test(saida)) saida += ' ';
      ultimoY = y;
    } else if (op === 'ET') {
      quebrar();
    } else if (op === 'BT') {
      ultimoY = null;
    }
  }
  return saida;
}
