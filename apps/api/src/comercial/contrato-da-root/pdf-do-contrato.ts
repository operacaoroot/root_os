import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { larguraDoTexto, paraWinAnsi, tabelaDeLarguras, type FonteDoPdf } from './fontes-do-pdf';
import { imagemDoPng, type ImagemDoPdf } from './png-do-pdf';

/*
 * O PDF DO CONTRATO DA ROOT (Contratos, F2, 02/11/2026) — puro, sem dependência nova.
 *
 * D2b do roteiro: o PDF que vai à ZapSign sai do TEXTO da minuta, por este gerador, porque a
 * imagem não tem LibreOffice e dependência nova é decisão humana. PDF 1.4, A4, fontes base-14
 * com WinAnsi (Times em vez de Cambria: não dá para embutir sem dependência; Courier em vez
 * de JetBrains Mono).
 *
 * As medidas do corpo são as do molde .docx: margens 3 / 3 / 4 / 3 cm, 12 pt, entrelinha 1,5.
 * As da faixa foram medidas na imagem do timbre do molde (2480 × 272 px sobre 21 × 2,3 cm).
 *
 * LACUNA RESTANTE RECUSA (`PdfComLacunaError`): PDF com lacuna nunca vai para assinatura.
 * DETERMINÍSTICO: nada de data corrente no arquivo. O mesmo texto na mesma versão do zlib dá
 * os mesmos bytes e o mesmo hash.
 */

export interface SignatarioDoPdf {
  nome: string;
  /** O que vai abaixo do nome (documento, papel). CONTRATANTE e CONTRATADA saem em negrito. */
  linhas?: readonly string[];
}

export interface PedidoDePdf {
  /** O texto preenchido: `# ` título, `### ` cláusula, `- (a) ` alínea, `**` negrito. */
  texto: string;
  /** A segunda linha da faixa; sai em caixa alta. */
  tipoDoServico: string;
  /** Os dados da contratada, no rodapé de toda página. */
  rodape: string;
  signatarios: readonly SignatarioDoPdf[];
  /** A proposta aceita em texto: entra como parte final, em página nova. */
  anexoFinal?: string;
}

export interface PdfGerado {
  pdf: Buffer;
  /** sha256 em hexadecimal dos bytes do PDF. */
  hash: string;
  paginas: number;
  avisos: string[];
}

export class PdfComLacunaError extends Error {
  constructor(readonly lacunas: readonly string[]) {
    super(`o PDF do contrato não sai com lacuna: ${lacunas.join('; ')}`);
    this.name = 'PdfComLacunaError';
  }
}

// ------------------------------------------------------------------- medidas ---

const CM = 72 / 2.54;
const PAGINA_L = 595.28;
const PAGINA_A = 841.89;
const MARGEM_ESQ = 3 * CM;
const MARGEM_DIR = PAGINA_L - 3 * CM;
const TOPO = PAGINA_A - 3 * CM;
const BASE = 4 * CM;
const LARGURA = MARGEM_DIR - MARGEM_ESQ;

const CORPO = 12;
const ENTRELINHA = CORPO * 1.5;
const ASCENDENTE = 13.5; // da linha de cima da entrelinha até a linha de base
const DEPOIS_DO_PARAGRAFO = 6;
const RECUO_DA_ALINEA = 1 * CM;
/** Acima disto a linha fica à esquerda: um rio de brancos é pior que a margem direita solta. */
const TW_MAXIMO = 12;
const ESPACO_DO_FIO = 4;

const FAIXA_A = 2.3 * CM;
const PRETO_BASE = '0.027 0.039 0.031';
const LIMAO = '0.608 0.859 0.122';
const MAGENTA = '1 0.122 0.42';
const CIANO = '0.122 1 0.659';
const CINZA_DA_FAIXA = '0.663 0.737 0.678';
const CINZA_DO_RODAPE = '0.365 0.435 0.376';

const ARQUIVO_DO_LOGO = join(__dirname, '..', '..', '..', 'assets', 'ROOT-logo-principal-TRANSPARENTE.png');

let logoEmCache: ImagemDoPdf | null = null;

function logo(): ImagemDoPdf {
  logoEmCache ??= imagemDoPng(readFileSync(ARQUIVO_DO_LOGO));
  return logoEmCache;
}

// -------------------------------------------------------------------- texto ---

interface Pedaco {
  /** Em WinAnsi: cada caractere é um byte. */
  t: string;
  negrito: boolean;
}

interface Linha {
  pedacos: Pedaco[];
  largura: number;
  espacos: number;
}

type Alinhamento = 'justificado' | 'centro' | 'esquerda';

interface Bloco {
  linhas: Linha[];
  alinhamento: Alinhamento;
  recuo: number;
  antes: number;
  depois: number;
  /** Fica na mesma página que o começo do bloco seguinte. */
  juntoDoSeguinte: boolean;
  /** Não se parte entre páginas. */
  inteiro: boolean;
  /** Começa em página nova. */
  paginaNova: boolean;
  /** A linha de assinatura acima do bloco. */
  fio: boolean;
}

const fonteDo = (negrito: boolean): FonteDoPdf => (negrito ? 'Times-Bold' : 'Times-Roman');

/** `**` alterna negrito, `\x` é o caractere x (`campoDoCliente` escapa assim). */
function lerNegrito(markup: string): { t: string; negrito: boolean }[] {
  const saida: { t: string; negrito: boolean }[] = [];
  let atual = '';
  let negrito = false;
  const fechar = () => {
    if (atual) saida.push({ t: atual, negrito });
    atual = '';
  };
  for (let i = 0; i < markup.length; i++) {
    if (markup[i] === '\\' && i + 1 < markup.length && /[\\`*_{}[\]<>#|!~]/.test(markup[i + 1])) {
      atual += markup[++i];
    } else if (markup.startsWith('**', i)) {
      fechar();
      negrito = !negrito;
      i += 1;
    } else {
      atual += markup[i];
    }
  }
  fechar();
  return saida;
}

/** Os pedaços de um parágrafo: "1.1.", "(a)", "CONTRATANTE:", CONTRATANTE e CONTRATADA em negrito, além do `**`. */
function pedacosDoParagrafo(markup: string, avisos: Set<string>, tudoEmNegrito = false): Pedaco[] {
  const inicio = markup.match(/^(?:\d+\.\d+\.|\([a-z]+\)|CONTRAT(?:ANTE|ADA):)(?=\s)/);
  const corpo = inicio ? markup.slice(inicio[0].length) : markup;
  const saida: Pedaco[] = inicio ? [{ t: paraWinAnsi(inicio[0], avisos), negrito: true }] : [];
  for (const parte of lerNegrito(corpo)) {
    if (parte.negrito || tudoEmNegrito) {
      saida.push({ t: paraWinAnsi(parte.t, avisos), negrito: true });
      continue;
    }
    for (const s of parte.t.split(/(\bCONTRAT(?:ANTE|ADA)\b)/)) {
      if (s) saida.push({ t: paraWinAnsi(s, avisos), negrito: /^CONTRAT(?:ANTE|ADA)$/.test(s) });
    }
  }
  return saida;
}

/** Quebra gulosa, com a largura real de cada fonte. Palavra maior que a linha se parte no caractere. */
function quebrarEmLinhas(pedacos: readonly Pedaco[], largura: number): Linha[] {
  type Palavra = { pedacos: Pedaco[]; largura: number };
  const palavras: Palavra[] = [];
  let atual: Palavra = { pedacos: [], largura: 0 };
  const fecharPalavra = () => {
    if (atual.pedacos.length) palavras.push(atual);
    atual = { pedacos: [], largura: 0 };
  };
  const pela = (t: string, negrito: boolean) => larguraDoTexto(t, fonteDo(negrito), CORPO);
  for (const p of pedacos) {
    p.t.split(' ').forEach((trecho, i) => {
      if (i > 0) fecharPalavra();
      for (let resto = trecho; resto; ) {
        let n = resto.length;
        while (n > 1 && atual.largura + pela(resto.slice(0, n), p.negrito) > largura) n--;
        const fatia = resto.slice(0, n);
        // Só parte no caractere o que não cabe nem numa linha inteira.
        if (n < resto.length && atual.pedacos.length) fecharPalavra();
        else {
          atual.pedacos.push({ t: fatia, negrito: p.negrito });
          atual.largura += pela(fatia, p.negrito);
          resto = resto.slice(n);
          if (resto) fecharPalavra();
        }
      }
    });
  }
  fecharPalavra();

  const linhas: Linha[] = [];
  let linha: Linha = { pedacos: [], largura: 0, espacos: 0 };
  const espaco = larguraDoTexto(' ', 'Times-Roman', CORPO);
  const acrescentar = (t: string, negrito: boolean) => {
    const ultimo = linha.pedacos[linha.pedacos.length - 1];
    if (ultimo && ultimo.negrito === negrito) ultimo.t += t;
    else linha.pedacos.push({ t, negrito });
  };
  for (const palavra of palavras) {
    const comEspaco = linha.pedacos.length ? espaco : 0;
    if (linha.pedacos.length && linha.largura + comEspaco + palavra.largura > largura) {
      linhas.push(linha);
      linha = { pedacos: [], largura: 0, espacos: 0 };
    }
    if (linha.pedacos.length) {
      acrescentar(' ', linha.pedacos[linha.pedacos.length - 1].negrito);
      linha.largura += espaco;
      linha.espacos += 1;
    }
    for (const p of palavra.pedacos) acrescentar(p.t, p.negrito);
    linha.largura += palavra.largura;
  }
  if (linha.pedacos.length) linhas.push(linha);
  return linhas;
}

function novoBloco(linhas: Linha[], parcial: Partial<Bloco> = {}): Bloco {
  return { linhas, alinhamento: 'justificado', recuo: 0, antes: 0, depois: DEPOIS_DO_PARAGRAFO, juntoDoSeguinte: false, inteiro: false, paginaNova: false, fio: false, ...parcial };
}

const CLAUSULA = /^\*{0,2}CL[ÁA]USULA\b[^a-z]*\*{0,2}$/;

/** Uma linha do texto vira um bloco. `# ` e a primeira linha toda em caixa alta são o título. */
function blocosDoTexto(texto: string, avisos: Set<string>): Bloco[] {
  const paragrafos = texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return paragrafos.map((p, i) => {
    const titulo = /^#\s/.test(p) || (i === 0 && !/\p{Ll}/u.test(p));
    if (titulo) {
      const t = p.replace(/^#\s+/, '').replace(/\*\*/g, '');
      return novoBloco(quebrarEmLinhas(pedacosDoParagrafo(t, avisos, true), LARGURA), { alinhamento: 'centro', depois: 18, juntoDoSeguinte: true });
    }
    if (/^#{2,6}\s/.test(p) || CLAUSULA.test(p)) {
      const t = p.replace(/^#+\s+/, '').replace(/\*\*/g, '');
      return novoBloco(quebrarEmLinhas(pedacosDoParagrafo(t, avisos, true), LARGURA), { alinhamento: 'centro', antes: 12, juntoDoSeguinte: true });
    }
    const alinea = p.match(/^-\s+(\([a-z]+\)\s.*)$/);
    if (alinea) return novoBloco(quebrarEmLinhas(pedacosDoParagrafo(alinea[1], avisos), LARGURA - RECUO_DA_ALINEA), { recuo: RECUO_DA_ALINEA });
    const item = p.match(/^-\s+(.*)$/);
    if (item) return novoBloco(quebrarEmLinhas(pedacosDoParagrafo(`• ${item[1]}`, avisos), LARGURA - RECUO_DA_ALINEA), { recuo: RECUO_DA_ALINEA });
    const local = /na data da última assinatura/.test(p) && i === paragrafos.length - 1;
    return novoBloco(quebrarEmLinhas(pedacosDoParagrafo(p, avisos), LARGURA), { alinhamento: local ? 'centro' : 'justificado' });
  });
}

function blocoDeAssinatura(s: SignatarioDoPdf, avisos: Set<string>): Bloco {
  const nome = quebrarEmLinhas(pedacosDoParagrafo(s.nome, avisos, true), LARGURA);
  const resto = (s.linhas ?? []).flatMap((l) => quebrarEmLinhas(pedacosDoParagrafo(l, avisos), LARGURA));
  return novoBloco([...nome, ...resto], { alinhamento: 'centro', antes: 40, depois: 0, inteiro: true, fio: true });
}

// ------------------------------------------------------------------ páginas ---

interface LinhaNaPagina {
  linha: Linha;
  x: number;
  y: number;
  tw: number;
}

interface Pagina {
  linhas: LinhaNaPagina[];
  fios: { x1: number; x2: number; y: number }[];
}

function alturaDoBloco(b: Bloco): number {
  return b.linhas.length * ENTRELINHA;
}

/** A página: mantém título com o texto, sem linha viúva ou órfã, e a assinatura junto do fecho. */
function paginar(blocos: readonly Bloco[]): Pagina[] {
  const paginas: Pagina[] = [{ linhas: [], fios: [] }];
  let y = TOPO;
  const novaPagina = () => {
    paginas.push({ linhas: [], fios: [] });
    y = TOPO;
  };
  const noTopo = () => y === TOPO;
  const espacoDe = (b: Bloco) => (noTopo() ? 0 : b.antes);
  const pagina = () => paginas[paginas.length - 1];

  const colocarLinhas = (b: Bloco, linhas: readonly Linha[], ultimaDoBloco: number) => {
    linhas.forEach((linha) => {
      const disponivel = LARGURA - b.recuo;
      const ehUltima = linha === b.linhas[ultimaDoBloco];
      let x = MARGEM_ESQ + b.recuo;
      let tw = 0;
      if (b.alinhamento === 'centro') x = MARGEM_ESQ + (LARGURA - linha.largura) / 2;
      else if (b.alinhamento === 'justificado' && !ehUltima && linha.espacos > 0) {
        const candidato = (disponivel - linha.largura) / linha.espacos;
        if (candidato <= TW_MAXIMO) tw = candidato;
      }
      pagina().linhas.push({ linha, x, y: y - ASCENDENTE, tw });
      y -= ENTRELINHA;
    });
  };

  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i];
    if (b.paginaNova && !noTopo()) novaPagina();

    // O que precisa caber agora: a corrente de blocos "junto do seguinte" mais o começo do último.
    let preciso = espacoDe(b);
    for (let j = i; j < blocos.length; j++) {
      const c = blocos[j];
      if (j > i) preciso += c.antes;
      if (c.juntoDoSeguinte && j + 1 < blocos.length) preciso += alturaDoBloco(c) + c.depois;
      else {
        preciso += c.inteiro ? alturaDoBloco(c) + (c.fio ? ESPACO_DO_FIO : 0) : Math.min(alturaDoBloco(c), 2 * ENTRELINHA);
        break;
      }
    }
    if (y - preciso < BASE && !noTopo()) novaPagina();

    y -= espacoDe(b);
    if (b.fio) {
      const meio = LARGURA / 2;
      pagina().fios.push({ x1: MARGEM_ESQ + meio - 7 * CM, x2: MARGEM_ESQ + meio + 7 * CM, y: y - 2 });
      y -= ESPACO_DO_FIO;
    }
    const ultima = b.linhas.length - 1;
    let colocadas = 0;
    while (colocadas < b.linhas.length) {
      const cabem = Math.floor((y - BASE) / ENTRELINHA + 1e-6);
      const faltam = b.linhas.length - colocadas;
      let agora = Math.min(cabem, faltam);
      // Sem viúva: não deixa uma linha sozinha na página seguinte.
      if (agora < faltam && faltam - agora === 1) agora -= 1;
      // Sem órfã: não deixa uma linha sozinha nesta página.
      if (agora === 1 && faltam > 1) agora = 0;
      if (agora <= 0) {
        if (noTopo()) agora = Math.max(1, Math.min(cabem, faltam));
        else {
          novaPagina();
          continue;
        }
      }
      colocarLinhas(b, b.linhas.slice(colocadas, colocadas + agora), ultima);
      colocadas += agora;
      if (colocadas < b.linhas.length) novaPagina();
    }
    y -= b.depois;
  }
  return paginas;
}

// ----------------------------------------------------------------- conteúdo ---

function num(n: number): string {
  return n.toFixed(3).replace(/\.?0+$/, '') || '0';
}

/** Uma cadeia literal de PDF, só com ASCII: parênteses, barra e bytes altos escapados. */
function cadeia(winAnsi: string): string {
  let saida = '(';
  for (let i = 0; i < winAnsi.length; i++) {
    const c = winAnsi.charCodeAt(i);
    if (c === 0x28 || c === 0x29 || c === 0x5c) saida += `\\${winAnsi[i]}`;
    else if (c < 0x20 || c > 0x7e) saida += `\\${c.toString(8).padStart(3, '0')}`;
    else saida += winAnsi[i];
  }
  return `${saida})`;
}

const NOME_DA_FONTE: Record<FonteDoPdf, string> = { 'Times-Roman': '/F1', 'Times-Bold': '/F2', Courier: '/F3' };

function textoMono(winAnsi: string, x: number, y: number, corpo: number, cor: string, tc = 0): string {
  return `BT ${NOME_DA_FONTE.Courier} ${num(corpo)} Tf ${cor} rg ${num(tc)} Tc 0 Tw ${num(x)} ${num(y)} Td ${cadeia(winAnsi)} Tj 0 Tc ET`;
}

function retangulo(x: number, y: number, l: number, a: number, cor: string): string {
  return `${cor} rg ${num(x)} ${num(y)} ${num(l)} ${num(a)} re f`;
}

/** A faixa do timbre, com as posições medidas na imagem do molde. O logo é o PNG oficial, com o respiro dele. */
function faixa(img: ImagemDoPdf, tipo: string): string[] {
  const baixo = PAGINA_A - FAIXA_A;
  // A letra ocupa do pixel 845 ao 2392 da largura (de 3200): a letra fica na margem do texto.
  const logoL = (84.8 * 3200) / (2392 - 845);
  const logoA = (logoL * img.altura) / img.largura;
  const logoX = MARGEM_ESQ - (845 / 3200) * logoL;
  // O topo de "OPERAÇÃO" (pixel 464 de 1600) fica a 14 pt do topo da folha.
  const logoY = PAGINA_A - 14 + (464 / 1600) * logoA - logoA;
  const prompt = '> instrumento contratual_';
  const corpoDoPrompt = 9;
  const corpoDoTipo = 6;
  const tcDoTipo = Math.min(0.45, Math.max(0, (260 - tipo.length * corpoDoTipo * 0.6) / Math.max(tipo.length, 1)));
  const larguraDoTipo = larguraDoTexto(tipo, 'Courier', corpoDoTipo) + tcDoTipo * tipo.length;
  return [
    'q',
    retangulo(0, baixo, PAGINA_L, FAIXA_A, PRETO_BASE),
    'q',
    `0 ${num(baixo)} ${num(PAGINA_L)} ${num(FAIXA_A)} re W n`,
    `${num(logoL)} 0 0 ${num(logoA)} ${num(logoX)} ${num(logoY)} cm`,
    '/Logo Do',
    'Q',
    retangulo(0, baixo, PAGINA_L, 2.4, LIMAO),
    retangulo(MARGEM_ESQ, baixo + 2.4 + 0.6, 100.9, 0.9, MAGENTA),
    retangulo(MARGEM_ESQ + 103, baixo + 2.4 + 0.6, 31.5, 0.9, CIANO),
    textoMono(prompt, MARGEM_DIR - larguraDoTexto(prompt, 'Courier', corpoDoPrompt), PAGINA_A - 30, corpoDoPrompt, LIMAO),
    textoMono(tipo, MARGEM_DIR - larguraDoTipo, PAGINA_A - 41.4, corpoDoTipo, CINZA_DA_FAIXA, tcDoTipo),
    'Q',
  ];
}

/** O rodapé: fio verde, os dados da contratada e a paginação, em Courier. */
function rodapeDaPagina(rodape: readonly string[], n: number, total: number): string[] {
  const corpo = 7.5;
  const centrado = (t: string, y: number) => textoMono(t, (PAGINA_L - larguraDoTexto(t, 'Courier', corpo)) / 2, y, corpo, CINZA_DO_RODAPE);
  const topo = 68;
  const saida = ['q', retangulo(MARGEM_ESQ, topo, LARGURA, 0.75, LIMAO)];
  let y = topo - 12;
  for (const linha of rodape) {
    saida.push(centrado(linha, y));
    y -= 10;
  }
  saida.push(centrado(`Página ${n} de ${total}`, y), 'Q');
  return saida;
}

function conteudoDaPagina(p: Pagina, n: number, total: number, img: ImagemDoPdf, tipo: string, rodape: readonly string[]): string {
  const ops = [...faixa(img, tipo), '0 g 0 G'];
  for (const { linha, x, y, tw } of p.linhas) {
    const pedacos = linha.pedacos.map((c) => `${NOME_DA_FONTE[fonteDo(c.negrito)]} ${num(CORPO)} Tf ${cadeia(c.t)} Tj`);
    ops.push(`BT ${num(tw)} Tw ${num(x)} ${num(y)} Td ${pedacos.join(' ')} ET`);
  }
  for (const f of p.fios) ops.push(`0.6 w ${num(f.x1)} ${num(f.y)} m ${num(f.x2)} ${num(f.y)} l S`);
  ops.push(...rodapeDaPagina(rodape, n, total));
  return ops.join('\n');
}

/** O rodapé da contratada em linhas de Courier que cabem na largura do texto. */
function linhasDoRodape(winAnsi: string): string[] {
  const porLinha = Math.floor(LARGURA / (7.5 * 0.6));
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of winAnsi.split(/\s+/).filter(Boolean)) {
    if (atual && atual.length + 1 + palavra.length > porLinha) {
      // O separador não fica pendurado no fim da linha.
      linhas.push(atual.replace(/ [\xb7|-]$/, ''));
      atual = '';
    }
    atual = atual ? `${atual} ${palavra}` : palavra.slice(0, porLinha);
  }
  if (atual) linhas.push(atual);
  return linhas;
}

// ------------------------------------------------------------------ arquivo ---

function objetoDeFluxo(dicionario: string, dados: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`<< ${dicionario} /Length ${dados.length} >>\nstream\n`, 'latin1'), dados, Buffer.from('\nendstream', 'latin1')]);
}

function dicionarioDaFonte(fonte: FonteDoPdf): string {
  return `<< /Type /Font /Subtype /Type1 /BaseFont /${fonte} /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths [${tabelaDeLarguras(fonte).join(' ')}] >>`;
}

function montarArquivo(paginas: readonly string[], img: ImagemDoPdf): Buffer {
  // 1 catálogo · 2 páginas · 3 a 5 fontes · 6 logo · 7 máscara · 8 info · a partir de 9: página + conteúdo.
  const primeiraPagina = 9;
  const kids = paginas.map((_, i) => `${primeiraPagina + i * 2} 0 R`).join(' ');
  const recursos = '<< /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> /XObject << /Logo 6 0 R >> >>';
  const corpos: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R /Lang (pt-BR) >>', 'latin1'),
    Buffer.from(`<< /Type /Pages /Count ${paginas.length} /Kids [${kids}] >>`, 'latin1'),
    Buffer.from(dicionarioDaFonte('Times-Roman'), 'latin1'),
    Buffer.from(dicionarioDaFonte('Times-Bold'), 'latin1'),
    Buffer.from(dicionarioDaFonte('Courier'), 'latin1'),
    objetoDeFluxo(`/Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask 7 0 R`, img.rgbZ),
    objetoDeFluxo(`/Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, img.alfaZ),
    Buffer.from('<< /Producer (ROOT OS) >>', 'latin1'),
  ];
  paginas.forEach((conteudo, i) => {
    const numero = primeiraPagina + i * 2;
    corpos.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGINA_L} ${PAGINA_A}] /Resources ${recursos} /Contents ${numero + 1} 0 R >>`, 'latin1'));
    corpos.push(objetoDeFluxo('/Filter /FlateDecode', deflateSync(Buffer.from(conteudo, 'latin1'), { level: 9 })));
  });

  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let posicao = partes[0].length;
  const offsets: number[] = [];
  corpos.forEach((corpo, i) => {
    offsets.push(posicao);
    const pedaco = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), corpo, Buffer.from('\nendobj\n', 'latin1')]);
    partes.push(pedaco);
    posicao += pedaco.length;
  });
  const xref = ['xref', `0 ${corpos.length + 1}`, '0000000000 65535 f ', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `)].join('\n');
  partes.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${corpos.length + 1} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${posicao}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}

// ------------------------------------------------------------------- pedido ---

function lacunasDe(texto: string): string[] {
  const achadas = [...texto.matchAll(/⟦lacuna[^⟧]*⟧?/g)].map((m) => m[0].replace(/^⟦lacuna:?\s*/, '').replace(/⟧$/, '').trim() || 'a decidir');
  const crus = [...texto.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].replace(/^preencher:\s*/, '').trim());
  return [...achadas, ...crus];
}

const semMarcaDeInsercao = (t: string) => String(t ?? '').replace(/⟦inserido: ([^⟧]*)⟧/g, '$1');

/**
 * Gera o PDF do contrato. Recusa com a lista (`PdfComLacunaError`) enquanto houver lacuna no
 * texto, no anexo, nos signatários, no tipo do serviço ou no rodapé.
 */
export function gerarPdfDoContrato(pedido: PedidoDePdf): PdfGerado {
  const texto = semMarcaDeInsercao(pedido.texto);
  const anexo = pedido.anexoFinal === undefined ? '' : semMarcaDeInsercao(pedido.anexoFinal);
  const signatarios = pedido.signatarios ?? [];
  const tudo = [texto, anexo, pedido.tipoDoServico, pedido.rodape, ...signatarios.flatMap((s) => [s.nome, ...(s.linhas ?? [])])].join('\n');
  const lacunas = [...new Set(lacunasDe(tudo))];
  if (lacunas.length) throw new PdfComLacunaError(lacunas);
  if (!texto.trim()) throw new Error('o PDF do contrato precisa de texto');
  if (!signatarios.length) throw new Error('o PDF do contrato precisa de ao menos um signatário');

  const avisos = new Set<string>();
  const blocos = blocosDoTexto(texto, avisos);
  // O fecho não fica separado das assinaturas: página só de assinatura é convite a troca de folha.
  for (const b of blocos.slice(-2)) b.juntoDoSeguinte = true;
  blocos.push(...signatarios.map((s) => blocoDeAssinatura(s, avisos)));
  if (anexo.trim()) {
    const titulo = novoBloco(quebrarEmLinhas(pedacosDoParagrafo('ANEXO: PROPOSTA ACEITA', avisos, true), LARGURA), { alinhamento: 'centro', depois: 18, juntoDoSeguinte: true, paginaNova: true });
    blocos.push(titulo, ...blocosDoTexto(anexo, avisos));
  }

  const tipo = paraWinAnsi(String(pedido.tipoDoServico ?? '').toLocaleUpperCase('pt-BR'), avisos);
  const rodape = linhasDoRodape(paraWinAnsi(pedido.rodape ?? '', avisos));
  const img = logo();
  const paginas = paginar(blocos);
  const conteudos = paginas.map((p, i) => conteudoDaPagina(p, i + 1, paginas.length, img, tipo, rodape));
  const pdf = montarArquivo(conteudos, img);
  return { pdf, hash: createHash('sha256').update(pdf).digest('hex'), paginas: paginas.length, avisos: [...avisos] };
}
