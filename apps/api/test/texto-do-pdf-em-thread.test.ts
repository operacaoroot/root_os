import { deflateSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { ArquivoGrandeDemaisError, lerComTeto } from '../src/google/drive-das-atas';
import { PdfIlegivelError, textoDoPdf } from '../src/google/texto-do-pdf';
import {
  PdfDemorouError,
  PdfGrandeDemaisError,
  rodarEmThread,
  textoDoPdfEmThread,
  threadsVivas,
} from '../src/google/texto-do-pdf-em-thread';

/*
 * PRODUÇÃO 22, M4 · O LEITOR DE PDF FORA DA THREAD E O DOWNLOAD COM TETO.
 *
 * O PDF normal sai igual ao de antes (o mesmo leitor, numa thread). O que
 * demora é encerrado no prazo com frase legível, e a thread não sobra. O que
 * passa do tamanho nem abre thread. O download do Drive para no meio quando
 * passa do teto, em vez de ler tudo antes de recusar.
 */

function pdf(objetos: Array<{ n: number; dict: string; fluxo?: Buffer }>, extraTrailer = ''): Buffer {
  const partes: Array<string | Buffer> = ['%PDF-1.5\n%\xe2\xe3\xcf\xd3\n'];
  for (const o of objetos) {
    if (o.fluxo) partes.push(`${o.n} 0 obj\n${o.dict.replace('@LEN', String(o.fluxo.length))}\nstream\n`, o.fluxo, '\nendstream\nendobj\n');
    else partes.push(`${o.n} 0 obj\n${o.dict}\nendobj\n`);
  }
  partes.push(`trailer\n<< /Root 1 0 R ${extraTrailer}>>\n%%EOF\n`);
  return Buffer.concat(partes.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p)));
}

const ataDeProva = () => {
  const conteudo = deflateSync(Buffer.from('BT /F1 12 Tf 72 712 Td (Ata da reuni\xe3o de opera\xe7\xe3o) Tj 0 -14 Td (Pr\xf3ximo passo) Tj ET', 'latin1'));
  return pdf([
    { n: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { n: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R >> >> >>' },
    { n: 3, dict: '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>' },
    { n: 4, dict: '<< /Length @LEN /Filter /FlateDecode >>', fluxo: conteudo },
    { n: 5, dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
  ]);
};

async function semThreadSobrando(): Promise<void> {
  for (let i = 0; i < 50 && threadsVivas() > 0; i++) await new Promise((r) => setTimeout(r, 20));
  expect(threadsVivas()).toBe(0);
}

describe('o leitor de PDF numa thread', { timeout: 30_000 }, () => {
  afterEach(semThreadSobrando);

  it('o PDF normal sai IGUAL ao leitor síncrono de antes', async () => {
    const arquivo = ataDeProva();
    const esperado = textoDoPdf(arquivo);
    expect(esperado).toBe('Ata da reunião de operação\nPróximo passo');
    await expect(textoDoPdfEmThread(arquivo)).resolves.toBe(esperado);
    await expect(textoDoPdfEmThread(arquivo, 10)).resolves.toBe(textoDoPdf(arquivo, 10));
  });

  it('PDF cifrado e arquivo que não é PDF: o mesmo PdfIlegivelError, com a mesma frase', async () => {
    const cifrado = pdf([{ n: 1, dict: '<< /Type /Catalog >>' }], '/Encrypt 9 0 R ');
    await expect(textoDoPdfEmThread(cifrado)).rejects.toThrow(PdfIlegivelError);
    await expect(textoDoPdfEmThread(cifrado)).rejects.toThrow(/protegido por senha ou cifrado/);
    await expect(textoDoPdfEmThread(Buffer.from('não sou um pdf'))).rejects.toThrow(/não é um PDF/);
  });

  it('acima do teto de bytes: erro legível, e nenhuma thread é aberta', async () => {
    const erro = await textoDoPdfEmThread(ataDeProva(), undefined, { tetoBytes: 100 }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(PdfGrandeDemaisError);
    expect(erro).toBeInstanceOf(PdfIlegivelError);
    expect((erro as Error).message).toMatch(/passa do tamanho/);
    expect(threadsVivas()).toBe(0);
  });

  it('o leitor que estoura o prazo é encerrado: erro legível e a thread não sobra', async () => {
    const inicio = Date.now();
    const erro = await rodarEmThread('for (;;) {}', {}, { prazoMs: 300 }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(PdfDemorouError);
    expect(erro).toBeInstanceOf(PdfIlegivelError);
    expect((erro as Error).message).toBe('o PDF demorou demais para ler');
    // a promessa só volta depois de a thread sair
    expect(threadsVivas()).toBe(0);
    expect(Date.now() - inicio).toBeLessThan(10_000);
  });

  it('o prazo vale também para o leitor de verdade (prazo curto demais = demorou)', async () => {
    await expect(textoDoPdfEmThread(ataDeProva(), undefined, { prazoMs: 1 })).rejects.toThrow('o PDF demorou demais para ler');
    expect(threadsVivas()).toBe(0);
  });

  it('várias leituras ao mesmo tempo terminam todas, e nenhuma thread sobra', async () => {
    const arquivo = ataDeProva();
    const r = await Promise.all(Array.from({ length: 6 }, () => textoDoPdfEmThread(arquivo)));
    expect(new Set(r)).toEqual(new Set(['Ata da reunião de operação\nPróximo passo']));
    expect(threadsVivas()).toBe(0);
  });

  it('erro que não é do PDF dentro da thread volta como erro, e a thread sai', async () => {
    const codigo = "require('node:worker_threads').parentPort.postMessage({ ok: false, nome: 'TypeError', mensagem: 'quebrou' });";
    await expect(rodarEmThread(codigo, {}, { prazoMs: 5_000 })).rejects.toThrow('quebrou');
    expect(threadsVivas()).toBe(0);
  });
});

/** Um corpo que entrega pedaços de 1 MB para sempre, contando quantos foram puxados. */
function corpoSemFim() {
  let puxados = 0;
  let cancelado = false;
  const corpo = new ReadableStream<Uint8Array>({
    pull(c) {
      puxados += 1;
      c.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelado = true;
    },
  });
  return { corpo, puxados: () => puxados, cancelado: () => cancelado };
}

describe('o download do Drive com teto, em pedaços', () => {
  it('passa do teto no meio: aborta ali, sem ler o resto, e cancela o corpo', async () => {
    const c = corpoSemFim();
    const erro = await lerComTeto(c.corpo, 3 * 1024 * 1024).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ArquivoGrandeDemaisError);
    expect(c.puxados()).toBeLessThanOrEqual(6);
    expect(c.cancelado()).toBe(true);
  });

  it('Content-Length declarado acima do teto: recusa sem ler nada', async () => {
    const c = corpoSemFim();
    await expect(lerComTeto(c.corpo, 3 * 1024 * 1024, String(50 * 1024 * 1024))).rejects.toBeInstanceOf(ArquivoGrandeDemaisError);
    expect(c.puxados()).toBeLessThanOrEqual(1);
    expect(c.cancelado()).toBe(true);
  });

  it('dentro do teto: devolve os bytes inteiros', async () => {
    const dados = Buffer.from('conteúdo da ata', 'utf8');
    const corpo = new Response(dados).body;
    const lido = await lerComTeto(corpo, 1024, String(dados.length));
    expect(lido.equals(dados)).toBe(true);
    expect((await lerComTeto(null, 10)).length).toBe(0);
  });
});
