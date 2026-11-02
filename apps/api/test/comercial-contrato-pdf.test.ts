import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { larguraDoTexto, paraWinAnsi, tabelaDeLarguras, type FonteDoPdf } from '../src/comercial/contrato-da-root/fontes-do-pdf';
import { moldeDoContrato } from '../src/comercial/contrato-da-root/moldes-do-contrato';
import { PdfComLacunaError, gerarPdfDoContrato, type PedidoDePdf } from '../src/comercial/contrato-da-root/pdf-do-contrato';
import { lerPng } from '../src/comercial/contrato-da-root/png-do-pdf';
import { preencherMolde } from '../src/comercial/contrato-da-root/preencher-molde';
import { textoDoPdf } from '../src/google/texto-do-pdf';

/* O gerador de PDF lido de volta, byte a byte: estrutura, medidas, recusa e o logo. */

const A4 = { l: 595.28, a: 841.89 };
const CM = 72 / 2.54;
const MARGEM_ESQ = 3 * CM;
const MARGEM_DIR = A4.l - 3 * CM;
const TOPO = A4.a - 3 * CM;
const BASE = 4 * CM;

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'contrato-moldes', 'exemplo-implantacao.json'), 'utf8')) as { aceite: Record<string, unknown>; contratada: Record<string, unknown> };

function contratoDeExemplo(): PedidoDePdf {
  const molde = moldeDoContrato('implantacao');
  const r = preencherMolde(molde.texto, { ...fixture.contratada, ...fixture.aceite });
  expect(r.lacunas).toEqual([]);
  return { texto: r.texto, tipoDoServico: molde.tipoDoServico, rodape: 'CONTRATADA DE TESTE LTDA · CNPJ 11.111.111/0001-11 · Cidade Teste/UF', signatarios: r.signatarios };
}

const simples = (texto: string, extra: Partial<PedidoDePdf> = {}): PedidoDePdf => ({ texto, tipoDoServico: 'Serviço de teste', rodape: 'Rodapé de teste', signatarios: [{ nome: 'FULANO' }], ...extra });

/** Os fluxos de conteúdo (das páginas) do PDF, já descomprimidos, na ordem. */
function conteudos(pdf: Buffer): string[] {
  const s = pdf.toString('latin1');
  const saida: string[] = [];
  for (const m of s.matchAll(/<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
    const inicio = (m.index as number) + m[0].length;
    saida.push(inflateSync(pdf.subarray(inicio, inicio + Number(m[1]))).toString('latin1'));
  }
  return saida;
}

function desfazerCadeia(c: string): string {
  return c.replace(/\\(\d{3}|.)/g, (_t, e: string) => (/^\d{3}$/.test(e) ? String.fromCharCode(parseInt(e, 8)) : e));
}

interface LinhaLida {
  x: number;
  y: number;
  tw: number;
  /** Até onde a linha vai, com a largura AFM e o Tw. */
  fim: number;
  texto: string;
}

const FONTES: Record<string, FonteDoPdf> = { F1: 'Times-Roman', F2: 'Times-Bold' };

/** As linhas do corpo (Times 12) de um fluxo de conteúdo. */
function linhasDoCorpo(conteudo: string): LinhaLida[] {
  const linhas: LinhaLida[] = [];
  for (const m of conteudo.matchAll(/^BT ([\d.]+) Tw ([\d.]+) ([\d.]+) Td (.*) ET$/gm)) {
    const tw = Number(m[1]);
    let fim = Number(m[2]);
    let texto = '';
    for (const p of m[4].matchAll(/\/(F[12]) 12 Tf \(((?:\\.|[^\\)])*)\) Tj/g)) {
      const t = desfazerCadeia(p[2]);
      fim += larguraDoTexto(t, FONTES[p[1]], 12) + tw * (t.match(/ /g)?.length ?? 0);
      texto += t;
    }
    linhas.push({ x: Number(m[2]), y: Number(m[3]), tw, fim, texto });
  }
  return linhas;
}

describe('a estrutura do arquivo', () => {
  const { pdf, paginas } = gerarPdfDoContrato(contratoDeExemplo());
  const s = pdf.toString('latin1');

  it('começa com %PDF-1.4 e termina em %%EOF', () => {
    expect(s.startsWith('%PDF-1.4\n')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('o xref aponta o byte exato de cada objeto, e startxref aponta o xref', () => {
    const startxref = Number(s.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
    expect(s.slice(startxref, startxref + 5)).toBe('xref\n');
    const [, n] = s.slice(startxref).match(/^xref\n0 (\d+)\n/) as RegExpMatchArray;
    const entradas = s.slice(startxref).split('\n').slice(2, 2 + Number(n));
    expect(entradas[0]).toBe('0000000000 65535 f ');
    entradas.slice(1).forEach((e, i) => {
      expect(e).toMatch(/^\d{10} 00000 n $/);
      const offset = Number(e.slice(0, 10));
      expect(s.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(s).toContain(`/Size ${n} `);
  });

  it('cada fluxo declara o /Length certo', () => {
    for (const m of s.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
      const fim = (m.index as number) + m[0].length + Number(m[1]);
      expect(s.slice(fim, fim + 10)).toBe('\nendstream');
    }
  });

  it('A4, base-14 com WinAnsi, com as três fontes pedidas e sem data no arquivo', () => {
    expect(s).toContain(`/MediaBox [0 0 ${A4.l} ${A4.a}]`);
    for (const f of ['Times-Roman', 'Times-Bold', 'Courier']) expect(s).toContain(`/BaseFont /${f} /Encoding /WinAnsiEncoding`);
    expect(s).not.toMatch(/CreationDate|ModDate/);
    expect(s.match(/\/Type \/Page /g)).toHaveLength(paginas);
  });

  it('o leitor da casa abre o arquivo e lê o contrato', () => {
    const t = textoDoPdf(pdf).replace(/\s+/g, ' ');
    expect(t).toContain('CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE IMPLANTAÇÃO');
    expect(t).toContain('CLÁUSULA DÉCIMA SEGUNDA: DO FORO');
    expect(t).toContain('R$ 9.000,00 (nove mil reais)');
    expect(t).toContain('instrumento contratual');
    expect(t).toContain(`Página 1 de ${paginas}`);
  });
});

describe('o determinismo', () => {
  it('o mesmo pedido dá os mesmos bytes e o mesmo hash, e o hash é o sha256 do arquivo', () => {
    const a = gerarPdfDoContrato(contratoDeExemplo());
    const b = gerarPdfDoContrato(contratoDeExemplo());
    expect(a.hash).toBe(b.hash);
    expect(a.pdf.equals(b.pdf)).toBe(true);
    expect(a.hash).toBe(createHash('sha256').update(a.pdf).digest('hex'));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uma vírgula muda o hash', () => {
    const p = contratoDeExemplo();
    expect(gerarPdfDoContrato(p).hash).not.toBe(gerarPdfDoContrato({ ...p, texto: p.texto.replace('nove mil reais', 'nove mil, reais') }).hash);
  });
});

describe('os acentos e o WinAnsi', () => {
  it('as larguras são as do AFM', () => {
    expect(tabelaDeLarguras('Times-Roman')[0]).toBe(250);
    expect(larguraDoTexto('a', 'Times-Roman', 1000)).toBe(444);
    expect(larguraDoTexto('a', 'Times-Bold', 1000)).toBe(500);
    expect(larguraDoTexto('\xe1', 'Times-Roman', 1000)).toBe(444);
    expect(larguraDoTexto('W', 'Times-Roman', 1000)).toBe(944);
    expect(larguraDoTexto('W', 'Times-Bold', 1000)).toBe(1000);
    expect(larguraDoTexto('i', 'Courier', 10)).toBe(6);
    expect(tabelaDeLarguras('Times-Bold')).toHaveLength(224);
  });

  it('o português inteiro vira byte de WinAnsi, com aspas curvas e ordinal', () => {
    const avisos = new Set<string>();
    expect(paraWinAnsi('ação é à õ ç Ã º § “x”–•', avisos)).toBe('a\xe7\xe3o \xe9 \xe0 \xf5 \xe7 \xc3 \xba \xa7 \x93x\x94\x96\x95');
    expect(avisos.size).toBe(0);
    // Acento combinante é normalizado antes.
    expect(paraWinAnsi('ã', avisos)).toBe('\xe3');
    expect(avisos.size).toBe(0);
  });

  it('o que não existe vira ? e entra em avisos, nunca quebra', () => {
    const { pdf, avisos } = gerarPdfDoContrato(simples('Seta → e emoji 😀 no meio.'));
    expect(avisos).toHaveLength(2);
    expect(avisos.join()).toContain('U+2192');
    expect(avisos.join()).toContain('U+1F600');
    expect(textoDoPdf(pdf)).toContain('Seta ? e emoji ? no meio.');
  });

  it('os acentos saem certos no conteúdo lido de volta', () => {
    const { pdf } = gerarPdfDoContrato(simples('Prestação de serviços à contratante, nº 12, ação ÇÃO.'));
    const corpo = linhasDoCorpo(conteudos(pdf)[0]);
    expect(corpo[0].texto).toContain('Presta\xe7\xe3o de servi\xe7os \xe0 contratante, n\xba 12, a\xe7\xe3o \xc7\xc3O.');
    expect(textoDoPdf(pdf)).toContain('Prestação de serviços à contratante, nº 12, ação ÇÃO.');
  });

  it('parênteses e barra invertida viram escape, sem quebrar a cadeia', () => {
    const { pdf } = gerarPdfDoContrato(simples('Cláusula (a) com \\ barra e )).'));
    expect(textoDoPdf(pdf)).toContain('(a) com \\ barra e )).');
  });

  it('marca de inserção some e o escape do campo do cliente é desfeito', () => {
    const { pdf } = gerarPdfDoContrato(simples('Valor ⟦inserido: R$ 10,00⟧ de A\\*B.'));
    const t = textoDoPdf(pdf);
    expect(t).toContain('Valor R$ 10,00 de A*B.');
    expect(t).not.toContain('inserido');
  });
});

describe('a justificação e o negrito', () => {
  const { pdf } = gerarPdfDoContrato(contratoDeExemplo());
  const todas = conteudos(pdf).flatMap(linhasDoCorpo);

  it('nenhuma linha passa da margem direita nem começa antes da esquerda', () => {
    expect(todas.length).toBeGreaterThan(200);
    for (const l of todas) {
      expect(l.fim).toBeLessThanOrEqual(MARGEM_DIR + 0.05);
      expect(l.x).toBeGreaterThanOrEqual(MARGEM_ESQ - 0.05);
    }
  });

  it('a linha justificada termina exatamente na margem, e a última do parágrafo fica à esquerda', () => {
    const justificadas = todas.filter((l) => l.tw > 0);
    expect(justificadas.length).toBeGreaterThan(100);
    for (const l of justificadas) expect(Math.abs(l.fim - MARGEM_DIR)).toBeLessThan(0.05);
    const ultima = todas.find((l) => l.texto.startsWith('celebrado') || l.texto.endsWith('assinam este Contrato eletronicamente, em via \xfanica.'));
    expect(ultima?.tw ?? 0).toBe(0);
  });

  it('palavra maior que a linha é partida em vez de estourar a margem', () => {
    const { pdf: p } = gerarPdfDoContrato(simples(`Endereço ${'x'.repeat(300)} fim do parágrafo que continua um pouco.`));
    for (const l of conteudos(p).flatMap(linhasDoCorpo)) expect(l.fim).toBeLessThanOrEqual(MARGEM_DIR + 0.05);
  });

  it('o título e a cláusula saem centralizados e em negrito', () => {
    const [primeira] = conteudos(pdf);
    const titulo = primeira.split('\n').find((l) => l.includes('CONTRATO DE PRESTA')) as string;
    expect(titulo).toContain('/F2 12 Tf');
    expect(titulo).not.toContain('/F1 12 Tf');
    const lida = linhasDoCorpo(primeira).find((l) => l.texto.startsWith('CONTRATO DE PRESTA')) as LinhaLida;
    expect(lida.tw).toBe(0);
    expect(Math.abs(lida.x - MARGEM_ESQ - (MARGEM_DIR - lida.fim))).toBeLessThan(0.05);
    const clausula = primeira.split('\n').find((l) => l.includes('CL\\301USULA PRIMEIRA')) as string;
    expect(clausula).toContain('/F2 12 Tf');
    expect(clausula).not.toContain('/F1 12 Tf');
  });

  it('"1.1." e CONTRATANTE/CONTRATADA em negrito, o resto em redondo, sem ** à vista', () => {
    const [primeira] = conteudos(pdf);
    expect(primeira).toContain('/F2 12 Tf (1.1. ) Tj /F1 12 Tf');
    expect(primeira).toMatch(/\/F2 12 Tf \(CONTRATADA\) Tj/);
    expect(primeira).toMatch(/\/F2 12 Tf \(CONTRATANTE: EMPRESA EXEMPLO LTDA\) Tj/);
    expect(conteudos(pdf).join('\n')).not.toContain('**');
    const { pdf: p } = gerarPdfDoContrato(simples('- (b) **rótulo:** texto.'));
    expect(conteudos(p)[0]).toContain('/F2 12 Tf (\\(b\\) r\\363tulo: ) Tj /F1 12 Tf (texto.) Tj');
  });
});

describe('a paginação', () => {
  const pedido = contratoDeExemplo();
  const { pdf, paginas } = gerarPdfDoContrato(pedido);
  const fluxos = conteudos(pdf);

  it('toda página tem "Página N de M" e o rodapé da contratada em Courier', () => {
    expect(paginas).toBeGreaterThan(5);
    expect(fluxos).toHaveLength(paginas);
    fluxos.forEach((c, i) => {
      expect(c).toMatch(new RegExp(`/F3 7\\.5 Tf .*\\(P\\\\341gina ${i + 1} de ${paginas}\\) Tj`));
      expect(c).toMatch(/\/F3 7\.5 Tf .*CONTRATADA DE TESTE LTDA/);
    });
  });

  it('rodapé longo quebra em linhas que cabem, sem separador pendurado', () => {
    const rodape = 'CONTRATADA DE EXEMPLO LTDA · CNPJ 11.111.111/0001-11 · Juiz de Fora/MG · contato@exemplo.invalid';
    const [c] = conteudos(gerarPdfDoContrato(simples('Texto.', { rodape })).pdf);
    const pedacos = [...c.matchAll(/\/F3 7\.5 Tf [^\n]*?\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => desfazerCadeia(m[1]));
    expect(pedacos).toHaveLength(3);
    expect(pedacos[0].endsWith('Juiz de Fora/MG')).toBe(true);
    expect(pedacos[1]).toBe('contato@exemplo.invalid');
  });

  it('o corpo respeita as margens de cima e de baixo em toda página', () => {
    for (const c of fluxos) {
      for (const l of linhasDoCorpo(c)) {
        expect(l.y).toBeLessThanOrEqual(TOPO);
        expect(l.y).toBeGreaterThanOrEqual(BASE - 0.01);
      }
    }
  });

  it('a entrelinha é 1,5: 18 pt entre linhas do mesmo parágrafo', () => {
    const ys = linhasDoCorpo(fluxos[1]).map((l) => l.y);
    const passos = ys.slice(1).map((y, i) => Number((ys[i] - y).toFixed(2)));
    expect(passos.filter((p) => p === 18).length).toBeGreaterThan(10);
    expect(Math.min(...passos)).toBe(18);
  });

  it('título de cláusula nunca fica sozinho no pé da página', () => {
    for (const c of fluxos) {
      const linhas = linhasDoCorpo(c);
      expect(linhas[linhas.length - 1].texto).not.toMatch(/^CL\xc1USULA /);
    }
  });

  it('texto longo cria páginas sem perder linha, e parágrafo enorme se parte', () => {
    const paragrafo = Array.from({ length: 900 }, (_, i) => `palavra${i}`).join(' ');
    const { pdf: p, paginas: n } = gerarPdfDoContrato(simples(paragrafo));
    expect(n).toBeGreaterThan(1);
    const t = textoDoPdf(p).replace(/\s+/g, ' ');
    for (const i of [0, 450, 899]) expect(t).toContain(`palavra${i}`);
  });

  it('não deixa linha sozinha em cima de uma página (viúva)', () => {
    for (let extras = 0; extras < 45; extras += 3) {
      const antes = Array.from({ length: extras }, (_, i) => `Linha curta ${i}.`).join('\n');
      const paragrafo = Array.from({ length: 300 }, () => 'palavra').join(' ');
      const { pdf: p } = gerarPdfDoContrato(simples(`${antes}\n${paragrafo}\nFim.`));
      const contagem = conteudos(p).map((c) => linhasDoCorpo(c).length);
      for (const n of contagem.slice(0, -1)) expect(n).toBeGreaterThan(1);
    }
  });
});

describe('a recusa com lacuna', () => {
  it('lança com a lista, em qualquer lugar do pedido, e não gera nada', () => {
    const base = simples('Texto ⟦lacuna: valor total⟧ e ⟦lacuna: cidade⟧ e ⟦lacuna: cidade⟧.');
    let erro: unknown;
    try {
      gerarPdfDoContrato(base);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(PdfComLacunaError);
    expect((erro as PdfComLacunaError).lacunas).toEqual(['valor total', 'cidade']);
    expect((erro as Error).message).toContain('valor total; cidade');
    expect(() => gerarPdfDoContrato(simples('ok', { anexoFinal: '⟦lacuna: anexo⟧' }))).toThrow(PdfComLacunaError);
    expect(() => gerarPdfDoContrato(simples('ok', { signatarios: [{ nome: '⟦lacuna: contratada_nome⟧' }] }))).toThrow(PdfComLacunaError);
    expect(() => gerarPdfDoContrato(simples('ok', { signatarios: [{ nome: 'F', linhas: ['⟦lacuna: doc⟧'] }] }))).toThrow(PdfComLacunaError);
    expect(() => gerarPdfDoContrato(simples('ok', { rodape: '⟦lacuna: cnpj⟧' }))).toThrow(PdfComLacunaError);
    expect(() => gerarPdfDoContrato(simples('ok', { tipoDoServico: '⟦lacuna: tipo⟧' }))).toThrow(PdfComLacunaError);
  });

  it('campo cru de molde que sobrou também recusa', () => {
    expect(() => gerarPdfDoContrato(simples('Valor [[valor_total|reais]].'))).toThrow(/valor_total/);
  });

  it('o molde sem preencher é recusado com todos os campos', () => {
    const r = preencherMolde(moldeDoContrato('continuidade').texto, {});
    expect(() => gerarPdfDoContrato({ ...simples(r.texto), signatarios: r.signatarios })).toThrow(/contratante_nome/);
  });

  it('sem texto ou sem signatário não sai', () => {
    expect(() => gerarPdfDoContrato(simples('  \n '))).toThrow(/precisa de texto/);
    expect(() => gerarPdfDoContrato(simples('ok', { signatarios: [] }))).toThrow(/signatário/);
  });
});

describe('o logo embutido de verdade', () => {
  const arquivo = join(__dirname, '..', 'assets', 'ROOT-logo-principal-TRANSPARENTE.png');
  const png = lerPng(readFileSync(arquivo));
  const { pdf } = gerarPdfDoContrato(simples('Texto.'));
  const s = pdf.toString('latin1');

  function fluxoDe(regex: RegExp): Buffer {
    const m = s.match(regex) as RegExpMatchArray;
    const inicio = (m.index as number) + m[0].length;
    return inflateSync(pdf.subarray(inicio, inicio + Number(m[1])));
  }

  it('o parser lê o PNG oficial: 3200 × 1600, RGBA separado', () => {
    expect([png.largura, png.altura]).toEqual([3200, 1600]);
    expect(png.rgb).toHaveLength(3200 * 1600 * 3);
    expect(png.alfa).toHaveLength(3200 * 1600);
    // O canto é transparente; o meio do R (sólido no arquivo) é opaco e verde-limão.
    expect(png.alfa[0]).toBe(0);
    const i = 900 * 3200 + 1000;
    expect(png.alfa[i]).toBe(255);
    expect([...png.rgb.subarray(i * 3, i * 3 + 3)].every((v, c) => Math.abs(v - [0x98, 0xdd, 0x20][c]) < 40)).toBe(true);
  });

  it('a imagem e a máscara estão no PDF, com os bytes do PNG', () => {
    expect(s).toMatch(/\/Subtype \/Image \/Width 3200 \/Height 1600 \/ColorSpace \/DeviceRGB .*\/SMask 7 0 R/);
    const rgb = fluxoDe(/\/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/FlateDecode \/SMask 7 0 R \/Length (\d+) >>\nstream\n/);
    const alfa = fluxoDe(/\/ColorSpace \/DeviceGray \/BitsPerComponent 8 \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/);
    expect(rgb.equals(png.rgb)).toBe(true);
    expect(alfa.equals(png.alfa)).toBe(true);
  });

  it('toda página desenha a faixa: preto da marca, logo, prompt verde, tipo em caixa alta, fios', () => {
    const { pdf: p } = gerarPdfDoContrato(simples(Array.from({ length: 120 }, (_, i) => `Parágrafo ${i}.`).join('\n'), { tipoDoServico: 'Prestação de serviços · Implantação' }));
    const fluxos = conteudos(p);
    expect(fluxos.length).toBeGreaterThan(1);
    for (const c of fluxos) {
      expect(c).toContain(`0.027 0.039 0.031 rg 0 ${(A4.a - 2.3 * CM).toFixed(3).replace(/0+$/, '')} ${A4.l} ${(2.3 * CM).toFixed(3).replace(/0+$/, '')} re f`);
      expect(c).toContain('/Logo Do');
      expect(c).toContain('(> instrumento contratual_) Tj');
      expect(c).toContain('(PRESTA\\307\\303O DE SERVI\\307OS \\267 IMPLANTA\\307\\303O) Tj');
      expect(c).toContain('1 0.122 0.42 rg');
      expect(c).toContain('0.122 1 0.659 rg');
      expect(c).toContain('0.608 0.859 0.122 rg');
    }
  });

  it('PNG que não é RGBA de 8 bits é recusado', () => {
    expect(() => lerPng(Buffer.from('não é png, com bytes suficientes para o teste'))).toThrow(/não é um PNG/);
    const copia = Buffer.from(readFileSync(arquivo));
    copia[8 + 8 + 9] = 2; // color type no IHDR
    expect(() => lerPng(copia)).toThrow(/RGBA/);
  });
});

describe('assinaturas e anexo', () => {
  it('um bloco por signatário com linha e nome em negrito, sem testemunha', () => {
    const p = contratoDeExemplo();
    const { pdf, paginas } = gerarPdfDoContrato(p);
    const ultima = conteudos(pdf)[paginas - 1];
    expect(ultima.match(/ m [\d.]+ [\d.]+ l S/g)).toHaveLength(2);
    expect(ultima).toContain('/F2 12 Tf (CONTRATADA DE TESTE LTDA) Tj');
    expect(ultima).toContain('/F2 12 Tf (EMPRESA EXEMPLO LTDA) Tj');
    expect(ultima).toContain('(FULANO DE TAL) Tj');
    expect(ultima).toContain('(CNPJ 00.000.000/0001-00) Tj');
    expect(textoDoPdf(pdf)).not.toMatch(/testemunha/i);
    // O fecho fica na mesma página das assinaturas.
    expect(ultima).toContain('na data da \\372ltima assinatura');
  });

  it('assinatura conjunta: três blocos, cabendo na página ou não', () => {
    const signatarios = ['A', 'B', 'C'].map((nome) => ({ nome: `SIGNATÁRIO ${nome}`, linhas: ['CONTRATANTE'] }));
    const { pdf, paginas } = gerarPdfDoContrato({ ...contratoDeExemplo(), signatarios });
    const tudo = conteudos(pdf).join('\n');
    expect(tudo.match(/ m [\d.]+ [\d.]+ l S/g)).toHaveLength(3);
    expect(paginas).toBeGreaterThan(1);
  });

  it('o anexo começa em página nova, com o título, depois das assinaturas', () => {
    const p = contratoDeExemplo();
    const sem = gerarPdfDoContrato(p);
    const com = gerarPdfDoContrato({ ...p, anexoFinal: 'Proposta aceita: implantação por R$ 9.000,00.\n\n- entrega um\n- entrega dois' });
    expect(com.paginas).toBe(sem.paginas + 1);
    const fluxos = conteudos(com.pdf);
    const ultima = fluxos[fluxos.length - 1];
    const linhas = linhasDoCorpo(ultima);
    expect(linhas[0].texto).toBe('ANEXO: PROPOSTA ACEITA');
    expect(linhas[0].y).toBeGreaterThan(TOPO - 20);
    expect(linhas.some((l) => l.texto.startsWith('Proposta aceita: implanta\xe7\xe3o'))).toBe(true);
    expect(linhas.some((l) => l.texto === '\x95 entrega um')).toBe(true);
    expect(fluxos[fluxos.length - 2]).toContain('(EMPRESA EXEMPLO LTDA) Tj');
    expect(com.hash).not.toBe(sem.hash);
    expect(ultima).toContain(`de ${com.paginas}) Tj`);
  });
});
