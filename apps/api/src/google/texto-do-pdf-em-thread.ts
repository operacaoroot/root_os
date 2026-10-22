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

/*
 * NO MÁXIMO DUAS THREADS AO MESMO TEMPO (Produção 22, revisão). Sem limite,
 * dez PDFs pedidos juntos abriam dez threads de 256 MB cada, e o processo da
 * API caía por memória antes de qualquer prazo valer. Aqui um semáforo do
 * processo deixa `MAX_THREADS_DE_PDF` rodando; as outras ESPERAM A VEZ, em
 * ordem de chegada.
 *
 * O PRAZO CONTA DE QUANDO A LEITURA COMEÇA A RODAR, não de quando entrou na
 * fila: o prazo mede o trabalho da thread (é ele que encerra o PDF construído
 * para demorar), e contar a espera faria um PDF bom perder a vez por culpa de
 * dois ruins na frente. A espera tem fim porque cada thread na frente tem o
 * seu próprio prazo.
 *
 * A VAGA SEMPRE VOLTA: ela é tomada antes de abrir a thread e devolvida no
 * `finally`, depois de a thread sair, também quando a leitura falha ou a
 * thread nem chega a abrir. Quem estava esperando recebe a vaga direto.
 */
export const MAX_THREADS_DE_PDF = 2;
let ocupadas = 0;
const naFila: Array<() => void> = [];

/** Quantas leituras esperam a vez agora. A suíte confere que volta a zero. */
export function leiturasNaFila(): number {
  return naFila.length;
}

function tomarVaga(): Promise<void> {
  if (ocupadas < MAX_THREADS_DE_PDF) {
    ocupadas++;
    return Promise.resolve();
  }
  return new Promise<void>((ok) => naFila.push(ok));
}

function soltarVaga(): void {
  const proxima = naFila.shift();
  // a vaga passa direto para quem espera; sem ninguém, ela fica livre
  if (proxima) proxima();
  else ocupadas--;
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
 * Espera a vez quando já há `MAX_THREADS_DE_PDF` rodando. Genérico de propósito: a suíte prova o encerramento com um código que nunca
 * termina. O código responde UMA mensagem `{ ok, valor | nome, mensagem }`.
 */
export async function rodarEmThread<T>(
  codigo: string,
  dados: Record<string, unknown>,
  opcoes: { prazoMs: number; transferir?: ArrayBuffer[] },
): Promise<T> {
  await tomarVaga();
  try {
    return await rodarUmaThread<T>(codigo, dados, opcoes);
  } finally {
    soltarVaga();
  }
}

/** Uma thread, com prazo contado de agora; só devolve depois de a thread sair. */
function rodarUmaThread<T>(
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
