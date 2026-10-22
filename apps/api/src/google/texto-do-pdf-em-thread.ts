import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { PdfIlegivelError } from './texto-do-pdf';

/*
 * O LEITOR DE PDF FORA DA THREAD DA API (Produção 22, M4).
 *
 * `textoDoPdf` é síncrono e roda em JavaScript puro (Flate, ObjStm, ToUnicode).
 * Na thread da API, um PDF construído para demorar (fluxos enormes, objetos que
 * se referenciam, um `inflate` que cresce muito) parava TODO pedido de TODA
 * empresa até terminar. Aqui ele roda num `worker_threads`, com:
 *
 *   · teto de bytes ANTES de abrir a thread (`PdfGrandeDemaisError`);
 *   · tempo máximo: passou do prazo, a thread é ENCERRADA (`terminate`) e quem
 *     chamou recebe `PdfDemorouError`, com frase legível;
 *   · teto de memória da thread (`resourceLimits`): estourou, a thread morre
 *     sozinha e quem chamou recebe `PdfIlegivelError`.
 *
 * Os três erros são `PdfIlegivelError`, então quem já tratava "não deu para ler
 * este PDF" continua tratando, com a frase certa.
 *
 * A THREAD SEMPRE TERMINA. Toda thread aberta entra em `vivas` e só sai no
 * evento `exit`; a promessa só se resolve DEPOIS de a thread ter saído (no
 * caminho normal ela sai sozinha ao fim do script; no prazo, `terminate` espera
 * a saída). A suíte confere `threadsVivas() === 0` depois de cada caso.
 *
 * COMO A THREAD ACHA O LEITOR, compilado ou não. A API roda compilada
 * (`dist/google/texto-do-pdf.js`) e a suíte roda o TypeScript pelo vitest. O
 * código da thread é um texto curto (`eval: true`) que faz `require` do leitor
 * pelo caminho absoluto: o `.js` ao lado deste arquivo quando existe (a API
 * compilada), senão o `.ts` (a suíte), registrando antes o `tsx`, que é
 * dependência de desenvolvimento e só é pedido nesse segundo caso. Nenhuma
 * dependência nova: `worker_threads` vem com o Node.
 */

/** O prazo padrão para ler um PDF. */
export const PRAZO_DO_PDF_MS = 10_000;

/** O teto padrão de bytes do PDF lido (o mesmo do arquivo do Drive). */
export const TETO_DE_BYTES_DO_PDF = 15 * 1024 * 1024;

/** O teto de memória de cada thread de leitura. */
const MEMORIA_DA_THREAD_MB = 256;

export class PdfDemorouError extends PdfIlegivelError {
  constructor() {
    super('o PDF demorou demais para ler');
    this.name = 'PdfDemorouError';
  }
}

export class PdfGrandeDemaisError extends PdfIlegivelError {
  constructor(teto: number) {
    super(`o PDF passa do tamanho que é lido daqui (${Math.round(teto / 1_048_576)} MB)`);
    this.name = 'PdfGrandeDemaisError';
  }
}

const vivas = new Set<Worker>();

/** Quantas threads de leitura estão abertas agora. A suíte confere que volta a zero. */
export function threadsVivas(): number {
  return vivas.size;
}

/** O arquivo do leitor que a thread carrega: o compilado ao lado deste, ou o `.ts` na suíte. */
function arquivoDoLeitor(): string {
  const base = join(__dirname, 'texto-do-pdf');
  return existsSync(`${base}.js`) ? `${base}.js` : `${base}.ts`;
}

const CODIGO_DO_LEITOR = `
const { parentPort, workerData } = require('node:worker_threads');
const arquivo = workerData.arquivo;
if (arquivo.endsWith('.ts')) {
  const { createRequire } = require('node:module');
  const daqui = createRequire(arquivo);
  daqui(daqui.resolve('tsx/cjs/api')).register();
}
const { textoDoPdf } = require(arquivo);
try {
  const texto = textoDoPdf(Buffer.from(workerData.pdf), workerData.max);
  parentPort.postMessage({ ok: true, valor: texto });
} catch (e) {
  parentPort.postMessage({ ok: false, nome: (e && e.name) || 'Error', mensagem: String((e && e.message) || e) });
}
`;

type Resposta = { ok: true; valor: unknown } | { ok: false; nome: string; mensagem: string };

/**
 * Roda um código numa thread com prazo, e só devolve depois de a thread sair.
 * Genérico de propósito: a suíte prova o encerramento com um código que nunca
 * termina. O código responde UMA mensagem `{ ok, valor | nome, mensagem }`.
 */
export function rodarEmThread<T>(
  codigo: string,
  dados: Record<string, unknown>,
  opcoes: { prazoMs: number; transferir?: ArrayBuffer[] },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(codigo, {
        eval: true,
        workerData: dados,
        transferList: opcoes.transferir,
        resourceLimits: { maxOldGenerationSizeMb: MEMORIA_DA_THREAD_MB },
        stdout: false,
        stderr: false,
      });
    } catch (e) {
      reject(e);
      return;
    }
    vivas.add(worker);
    let desfecho: { ok: true; valor: T } | { ok: false; erro: Error } | null = null;
    const relogio = setTimeout(() => {
      if (desfecho) return;
      desfecho = { ok: false, erro: new PdfDemorouError() };
      void worker.terminate();
    }, opcoes.prazoMs);
    worker.once('message', (m: Resposta) => {
      if (desfecho) return;
      if (m.ok) {
        desfecho = { ok: true, valor: m.valor as T };
      } else {
        const erro = m.nome === 'PdfIlegivelError' ? new PdfIlegivelError(m.mensagem) : new Error(m.mensagem);
        desfecho = { ok: false, erro };
      }
    });
    worker.once('error', (e: Error & { code?: string }) => {
      if (desfecho) return;
      desfecho = {
        ok: false,
        erro: e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new PdfIlegivelError('o PDF é pesado demais para ler') : e,
      };
    });
    worker.once('exit', () => {
      clearTimeout(relogio);
      vivas.delete(worker);
      const d = desfecho ?? { ok: false as const, erro: new PdfIlegivelError('a leitura do PDF parou sem resposta') };
      if (d.ok) resolve(d.valor);
      else reject(d.erro);
    });
  });
}

/**
 * O texto de um PDF, lido numa thread com prazo e teto de bytes. Mesmo
 * resultado de `textoDoPdf` (mesmo leitor), mesmos erros, mais os dois novos.
 */
export async function textoDoPdfEmThread(
  pdf: Buffer,
  maxCaracteres = 400_000,
  opcoes: { prazoMs?: number; tetoBytes?: number } = {},
): Promise<string> {
  const teto = opcoes.tetoBytes ?? TETO_DE_BYTES_DO_PDF;
  if (pdf.length > teto) throw new PdfGrandeDemaisError(teto);
  const copia = new Uint8Array(pdf.length);
  copia.set(pdf);
  return rodarEmThread<string>(
    CODIGO_DO_LEITOR,
    { arquivo: arquivoDoLeitor(), pdf: copia.buffer, max: maxCaracteres },
    { prazoMs: opcoes.prazoMs ?? PRAZO_DO_PDF_MS, transferir: [copia.buffer] },
  );
}
