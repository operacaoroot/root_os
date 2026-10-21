import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { PdfIlegivelError, textoDoPdf } from '../src/google/texto-do-pdf';

/*
 * O LEITOR DE PDF DO BANCO DE ATAS (produção 21, P7): PDFs montados à mão nos
 * dois formatos que o Word, o Docs e o LibreOffice geram (fonte simples com
 * WinAnsi; fonte composta com ToUnicode, conteúdo comprimido e o dicionário
 * da fonte dentro de um fluxo de objetos), e as recusas.
 */

type Parte = string | Buffer;

/** Monta um PDF com os objetos dados (o leitor não precisa da tabela xref). */
function pdf(objetos: Array<{ n: number; dict: string; fluxo?: Buffer }>, extraTrailer = ''): Buffer {
  const partes: Parte[] = ['%PDF-1.5\n%\xe2\xe3\xcf\xd3\n'];
  for (const o of objetos) {
    if (o.fluxo) {
      partes.push(`${o.n} 0 obj\n${o.dict.replace('@LEN', String(o.fluxo.length))}\nstream\n`, o.fluxo, '\nendstream\nendobj\n');
    } else partes.push(`${o.n} 0 obj\n${o.dict}\nendobj\n`);
  }
  partes.push(`trailer\n<< /Root 1 0 R ${extraTrailer}>>\n%%EOF\n`);
  return Buffer.concat(partes.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p)));
}

describe('o texto de um PDF', () => {
  it('fonte simples (WinAnsi), conteúdo sem filtro, acento e quebra de linha', () => {
    const conteudo = Buffer.from('BT /F1 12 Tf 72 712 Td (Ata da reuni\xe3o de opera\xe7\xe3o) Tj 0 -14 Td (Decis\xe3o: contratar o \\(novo\\) plano) Tj T* [(Pr) 20 (\xf3ximo) -300 (passo)] TJ ET', 'latin1');
    const arquivo = pdf([
      { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
      { n: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R >> >> >>' },
      { n: 3, dict: '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>' },
      { n: 4, dict: '<< /Length @LEN >>', fluxo: conteudo },
      { n: 5, dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
    ]);
    expect(textoDoPdf(arquivo)).toBe('Ata da reunião de operação\nDecisão: contratar o (novo) plano\nPróximo passo');
  });

  it('fonte composta com ToUnicode, conteúdo comprimido e a fonte dentro de um fluxo de objetos', () => {
    // Glifos 0001..0004 = "A","t","a"," " (bfrange) e 0005 = "ç" (bfchar).
    const cmap = Buffer.from(
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n' +
        '1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
        '1 beginbfrange <0001> <0003> [<0041> <0074> <0061>] endbfrange\n' +
        '2 beginbfchar <0004> <0020> <0005> <00E7> endbfchar\n' +
        '1 beginbfrange <0010> <0012> <0078> endbfrange\n' +
        'endcmap CMapName currentdict /CMap defineresource pop end end',
      'latin1',
    );
    const conteudo = deflateSync(Buffer.from('BT /C0 11 Tf 1 0 0 1 72 700 Tm <0001000200030004> Tj [<0005> -300 <000300100011>] TJ 1 0 0 1 72 680 Tm <00120012> Tj ET', 'latin1'));
    const fonteNoFluxo = '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Arial /Encoding /Identity-H /ToUnicode 7 0 R >>';
    const cabecalho = '6 0 ';
    const objStm = deflateSync(Buffer.from(cabecalho + fonteNoFluxo, 'latin1'));
    const arquivo = pdf([
      { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
      { n: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { n: 3, dict: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /C0 6 0 R >> >> /Contents [4 0 R] >>' },
      { n: 4, dict: '<< /Length @LEN /Filter /FlateDecode >>', fluxo: conteudo },
      { n: 7, dict: '<< /Length @LEN >>', fluxo: cmap },
      { n: 8, dict: `<< /Type /ObjStm /N 1 /First ${cabecalho.length} /Length @LEN /Filter /FlateDecode >>`, fluxo: objStm },
    ]);
    expect(textoDoPdf(arquivo)).toBe('Ata ç axy\nzz');
  });

  it('PDF cifrado é recusado, e o que não é PDF também', () => {
    const cifrado = pdf([{ n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' }], '/Encrypt 9 0 R ');
    expect(() => textoDoPdf(cifrado)).toThrow(PdfIlegivelError);
    expect(() => textoDoPdf(Buffer.from('não sou um pdf'))).toThrow(/não é um PDF/);
  });

  it('PDF só com imagem volta sem texto (quem chama diz isso à pessoa)', () => {
    const arquivo = pdf([
      { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
      { n: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { n: 3, dict: '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>' },
      { n: 4, dict: '<< /Length @LEN >>', fluxo: Buffer.from('q 595 0 0 842 0 0 cm /Im0 Do Q', 'latin1') },
    ]);
    expect(textoDoPdf(arquivo)).toBe('');
  });

  it('PDF-bomba: o fluxo que descomprime além do teto é pulado, sem derrubar o processo', () => {
    const bomba = deflateSync(Buffer.alloc(70 * 1024 * 1024, 0x20));
    const arquivo = pdf([
      { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
      { n: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { n: 3, dict: '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>' },
      { n: 4, dict: '<< /Length @LEN /Filter /FlateDecode >>', fluxo: bomba },
    ]);
    expect(textoDoPdf(arquivo)).toBe('');
  });

  it('o teto de caracteres vale', () => {
    const conteudo = Buffer.from(`BT /F1 12 Tf (${'a'.repeat(500)}) Tj ET`, 'latin1');
    const arquivo = pdf([
      { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
      { n: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { n: 3, dict: '<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>' },
      { n: 4, dict: '<< /Length @LEN >>', fluxo: conteudo },
      { n: 5, dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    ]);
    expect(textoDoPdf(arquivo, 100)).toHaveLength(100);
  });
});

/*
 * PDF HOSTIL (revisão adversarial da P7): o leitor roda síncrono na thread da
 * API, então cada caso abaixo travaria o processo inteiro antes do conserto.
 * O relógio é a prova: todos terminam bem abaixo do prazo.
 */
const rapido = <T>(f: () => T, prazoMs: number): T => {
  const t0 = Date.now();
  const r = f();
  expect(Date.now() - t0).toBeLessThan(prazoMs);
  return r;
};

describe('PDF hostil não trava o processo', () => {
  it('cauda de dígitos depois do cabeçalho: a busca de objetos é linear e não acha objeto', () => {
    const arquivo = Buffer.from('%PDF-1.4\n' + '1'.repeat(5_000_000), 'latin1');
    expect(rapido(() => textoDoPdf(arquivo), 2000)).toBe('');
  });

  it('árvore de páginas em ciclo e em diamante: cada nó é visitado uma vez', () => {
    // 2 aponta para si mesmo duas vezes; 10..39 é uma escada em diamante
    // (cada degrau aponta duas vezes para o seguinte), que sem conjunto de
    // visitados daria 2^30 chamadas; 40 é a única página.
    const degraus = Array.from({ length: 30 }, (_, i) => ({
      n: 10 + i,
      dict: `<< /Type /Pages /Kids [${11 + i} 0 R ${11 + i} 0 R] >>`,
    }));
    const arquivo = pdf([
      { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
      { n: 2, dict: '<< /Type /Pages /Kids [2 0 R 2 0 R 10 0 R] /Resources << /Font << /F1 5 0 R >> >> >>' },
      ...degraus,
      { n: 40, dict: '<< /Type /Page /Contents 4 0 R >>' },
      { n: 4, dict: '<< /Length @LEN >>', fluxo: Buffer.from('BT /F1 12 Tf (uma vez) Tj ET', 'latin1') },
      { n: 5, dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    ]);
    expect(rapido(() => textoDoPdf(arquivo), 2000)).toBe('uma vez');
  });

  it('o mesmo fluxo referenciado milhares de vezes descomprime uma vez só e para no teto do documento', () => {
    // 256 KB por cópia × 5000 referências = 1,25 GB se cada uma descomprimisse e entrasse.
    const fluxo = deflateSync(Buffer.from('BT /F1 12 Tf (oi) Tj ET\n' + ' '.repeat(256 * 1024), 'latin1'));
    const arquivo = pdf([
      { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
      { n: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { n: 3, dict: `<< /Type /Page /Resources << /Font << /F1 6 0 R >> >> /Contents [${'5 0 R '.repeat(5000)}] >>` },
      { n: 5, dict: '<< /Length @LEN /Filter /FlateDecode >>', fluxo },
      { n: 6, dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    ]);
    const texto = rapido(() => textoDoPdf(arquivo), 5000);
    expect(texto.startsWith('oi')).toBe(true);
    // Só o que coube no teto de 64 MB de conteúdo: 256 cópias, não 5000.
    expect(texto.split('oi').length - 1).toBeLessThanOrEqual(256);
  });

  it('fluxos distintos que somam mais que o teto: lê os primeiros e devolve o que tem', () => {
    // 12 páginas de 8 MB descomprimidos cada (96 MB) contra o teto de 64 MB do documento.
    const paginas = Array.from({ length: 12 }, (_, i) => i);
    const arquivo = pdf([
      { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
      { n: 2, dict: `<< /Type /Pages /Kids [${paginas.map((i) => `${100 + i} 0 R`).join(' ')}] /Resources << /Font << /F1 6 0 R >> >> >>` },
      ...paginas.map((i) => ({ n: 100 + i, dict: `<< /Type /Page /Contents ${200 + i} 0 R >>` })),
      ...paginas.map((i) => ({
        n: 200 + i,
        dict: '<< /Length @LEN /Filter /FlateDecode >>',
        fluxo: deflateSync(Buffer.from(`BT /F1 12 Tf (p${i}) Tj ET\n` + ' '.repeat(8 * 1024 * 1024), 'latin1')),
      })),
      { n: 6, dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    ]);
    const texto = rapido(() => textoDoPdf(arquivo), 8000);
    expect(texto.startsWith('p0\n\np1')).toBe(true);
    expect(texto).not.toContain('p11');
  });

  it('aninhamento profundo e delimitadores soltos não estouram a pilha', () => {
    const arquivo = pdf([
      { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
      { n: 2, dict: '<< /Type /Pages /Kids [3 0 R 7 0 R] /Resources << /Font << /F1 5 0 R >> >> >>' },
      { n: 3, dict: '<< /Type /Page /Contents 4 0 R >>' },
      { n: 4, dict: '<< /Length @LEN >>', fluxo: Buffer.from('BT /F1 12 Tf ' + '['.repeat(100_000) + ' (nunca) Tj ET', 'latin1') },
      { n: 5, dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
      { n: 7, dict: '<< /Type /Page /Contents 8 0 R >>' },
      { n: 8, dict: '<< /Length @LEN >>', fluxo: Buffer.from(')'.repeat(1_000_000) + ' BT /F1 12 Tf (normal) Tj ET', 'latin1') },
      { n: 9, dict: '<< /Lixo ' + '<<'.repeat(100_000) + ' >>' },
    ]);
    expect(rapido(() => textoDoPdf(arquivo), 3000)).toBe('normal');
  });
});
