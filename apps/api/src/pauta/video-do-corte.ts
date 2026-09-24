import { createHash, type Hash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { PAUTA_VIDEO_DO_CORTE_MAX_BYTES } from '@mktos/shared';

/*
 * O MP4 DO CORTE QUE SOBE AO STORAGE (MD4).
 *
 * O corte vertical deixa de morar só no Mac: a Graph da Meta baixa o vídeo de
 * uma URL pública, e o Reels pede o `moov` no começo (faststart), até 300 MB.
 * O corpo chega CRU, como stream, e nunca inteiro em memória: um `Transform`
 * conta os bytes, calcula o sha256 e lê as caixas de topo à medida que passam.
 *
 * O que é conferido ANTES de ler um byte (na rota): `Content-Type: video/mp4`,
 * `Content-Length` presente e dentro do teto, e o sha256 declarado pelo Mac —
 * é ele que dá o nome da chave (`corte-<sha>.mp4`) antes de o corpo terminar,
 * sem arquivo temporário para mover nem apagar depois.
 *
 * O que é conferido DURANTE: `ftyp` é a primeira caixa, `moov` vem antes do
 * `mdat`, nenhuma caixa passa do fim declarado, o corpo não passa do
 * `Content-Length`. Lido o `moov`, a duração (`mvhd`) e o tamanho da trilha de
 * vídeo (`tkhd`) vão a quem chamou, que pode abortar ali (corte de outro
 * trecho) sem esperar os outros 290 MB. No FIM: bytes iguais ao declarado e o
 * sha256 igual ao declarado. Qualquer falha é erro do stream, e o storage não
 * conclui o envio (ver `StorageService.putStream`).
 */

/** O `moov` de um corte de 3 min tem centenas de kB; 16 MB é arquivo errado. */
export const TETO_DO_MOOV = 16 * 1024 * 1024;

export class ErroDoEnvio extends Error {
  constructor(
    readonly status: 400 | 411 | 413 | 415,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroDoEnvio';
  }
}

/** O teto do mp4 do corte: `PAUTA_VIDEO_MAX_BYTES`, ou os 300 MB do Reels. */
export function tetoDoVideo(env: Record<string, string | undefined> = process.env): number {
  const bruto = (env.PAUTA_VIDEO_MAX_BYTES ?? '').trim();
  if (!bruto) return PAUTA_VIDEO_DO_CORTE_MAX_BYTES;
  const n = Number(bruto);
  return Number.isSafeInteger(n) && n > 0 ? n : PAUTA_VIDEO_DO_CORTE_MAX_BYTES;
}

export interface CabecalhoDoEnvio {
  bytes: number;
  sha256: string;
}

/** O cabeçalho que diz qual é o sha256 do corpo; o Mac calcula antes de mandar. */
export const CABECALHO_DO_SHA = 'x-conteudo-sha256';

/**
 * Tudo o que se confere sem ler o corpo. Os status seguem o HTTP: 415 tipo
 * errado, 411 sem comprimento (ou com `Transfer-Encoding`, que o dispensa), 413
 * acima do teto, 400 o resto.
 */
export function conferirCabecalhosDoEnvio(
  headers: Record<string, string | string[] | undefined>,
  teto: number,
): CabecalhoDoEnvio {
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? undefined : v);
  const tipo = (um(headers['content-type']) ?? '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'video/mp4') throw new ErroDoEnvio(415, `O corte sobe como video/mp4 (veio ${tipo || 'sem tipo'}).`);
  if (headers['transfer-encoding'] !== undefined) {
    throw new ErroDoEnvio(411, 'Mande o corpo com Content-Length, sem Transfer-Encoding.');
  }
  const comprimento = um(headers['content-length']);
  if (comprimento === undefined || !/^\d{1,15}$/.test(comprimento.trim())) {
    throw new ErroDoEnvio(411, 'Falta o Content-Length do mp4.');
  }
  const bytes = Number(comprimento.trim());
  if (bytes > teto) {
    throw new ErroDoEnvio(413, `O mp4 tem ${Math.round(bytes / 1024 / 1024)} MB; o teto é ${Math.round(teto / 1024 / 1024)} MB.`);
  }
  if (bytes < 16) throw new ErroDoEnvio(400, 'O mp4 está vazio.');
  const sha256 = (um(headers[CABECALHO_DO_SHA]) ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new ErroDoEnvio(400, `Falta o sha256 do arquivo no cabeçalho ${CABECALHO_DO_SHA} (64 hexadecimais).`);
  }
  return { bytes, sha256 };
}

export interface MoovLido {
  duracaoSeg: number | null;
  largura: number | null;
  altura: number | null;
}

interface Caixa {
  tipo: string;
  inicio: number;
  fim: number;
}

/** As caixas filhas dentro de um trecho (o corpo do `moov` ou de um `trak`). */
function caixasEm(b: Buffer, de = 0, ate = b.length): Caixa[] {
  const saida: Caixa[] = [];
  let i = de;
  while (i + 8 <= ate) {
    let tamanho = b.readUInt32BE(i);
    const tipo = b.toString('latin1', i + 4, i + 8);
    let cab = 8;
    if (tamanho === 1) {
      if (i + 16 > ate) break;
      tamanho = Number(b.readBigUInt64BE(i + 8));
      cab = 16;
    } else if (tamanho === 0) tamanho = ate - i;
    if (tamanho < cab || i + tamanho > ate) break;
    saida.push({ tipo, inicio: i + cab, fim: i + tamanho });
    i += tamanho;
  }
  return saida;
}

/** A duração (`mvhd`) e o tamanho da primeira trilha com imagem (`tkhd`). */
export function lerMoov(corpo: Buffer): MoovLido {
  const lido: MoovLido = { duracaoSeg: null, largura: null, altura: null };
  for (const c of caixasEm(corpo)) {
    if (c.tipo === 'mvhd' && c.fim - c.inicio >= (corpo[c.inicio] === 1 ? 32 : 20)) {
      const v = corpo[c.inicio];
      const escala = v === 1 ? corpo.readUInt32BE(c.inicio + 20) : corpo.readUInt32BE(c.inicio + 12);
      const duracao = v === 1 ? Number(corpo.readBigUInt64BE(c.inicio + 24)) : corpo.readUInt32BE(c.inicio + 16);
      if (escala > 0) lido.duracaoSeg = Math.round((duracao / escala) * 1000) / 1000;
    }
    if (c.tipo === 'trak' && lido.largura === null) {
      const tkhd = caixasEm(corpo, c.inicio, c.fim).find((x) => x.tipo === 'tkhd');
      if (!tkhd) continue;
      const v = corpo[tkhd.inicio];
      const onde = tkhd.inicio + (v === 1 ? 88 : 76);
      if (onde + 8 > tkhd.fim) continue;
      const largura = corpo.readUInt32BE(onde) >>> 16;
      const altura = corpo.readUInt32BE(onde + 4) >>> 16;
      if (largura > 0 && altura > 0) {
        lido.largura = largura;
        lido.altura = altura;
      }
    }
  }
  return lido;
}

export interface ResultadoDoMp4 extends MoovLido {
  bytes: number;
  sha256: string;
}

/**
 * Conta, calcula o sha256 e confere as caixas de topo do mp4 que passa. Os
 * bytes seguem adiante sem cópia; só o `moov` é juntado (até `TETO_DO_MOOV`).
 */
export class ConferenciaDoMp4 extends Transform {
  private readonly hash: Hash = createHash('sha256');
  private total = 0;
  private cabecalho = Buffer.alloc(0);
  private restante = 0;
  private ateOFim = false;
  private caixas = 0;
  private coletando: Buffer[] | null = null;
  private viuMoov = false;
  private viuMdat = false;
  private offsetDaCaixa = 0;
  private moov: MoovLido | null = null;
  resultado: ResultadoDoMp4 | null = null;

  constructor(
    private readonly declarado: CabecalhoDoEnvio,
    private readonly aoLerMoov?: (moov: MoovLido) => void,
  ) {
    super();
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, pronto: TransformCallback): void {
    try {
      this.total += chunk.length;
      if (this.total > this.declarado.bytes) {
        throw new ErroDoEnvio(413, 'O corpo passou do Content-Length declarado.');
      }
      this.hash.update(chunk);
      this.caixasDe(chunk);
      pronto(null, chunk);
    } catch (e) {
      pronto(e as Error);
    }
  }

  override _flush(pronto: TransformCallback): void {
    try {
      if (this.total !== this.declarado.bytes) {
        throw new ErroDoEnvio(400, `O corpo terminou com ${this.total} de ${this.declarado.bytes} bytes (um proxy no caminho pode ter cortado).`);
      }
      if ((this.restante > 0 && !this.ateOFim) || this.cabecalho.length > 0) {
        throw new ErroDoEnvio(400, 'O mp4 termina no meio de uma caixa: o arquivo está truncado.');
      }
      if (this.coletando) this.fecharMoov();
      if (!this.viuMoov || !this.viuMdat) throw new ErroDoEnvio(400, 'O arquivo não tem as caixas moov e mdat de um mp4.');
      const sha256 = this.hash.digest('hex');
      if (sha256 !== this.declarado.sha256) {
        throw new ErroDoEnvio(400, 'O sha256 do corpo não bate com o declarado: o arquivo mudou ou chegou corrompido.');
      }
      this.resultado = { bytes: this.total, sha256, ...(this.moov ?? { duracaoSeg: null, largura: null, altura: null }) };
      pronto();
    } catch (e) {
      pronto(e as Error);
    }
  }

  private caixasDe(chunk: Buffer): void {
    let i = 0;
    while (i < chunk.length) {
      if (this.ateOFim) {
        if (this.coletando) this.juntar(chunk.subarray(i));
        return;
      }
      if (this.restante > 0) {
        const n = Math.min(this.restante, chunk.length - i);
        if (this.coletando) this.juntar(chunk.subarray(i, i + n));
        this.restante -= n;
        i += n;
        if (this.restante === 0 && this.coletando) this.fecharMoov();
        continue;
      }
      const n = Math.min(this.cabecalhoPrecisa() - this.cabecalho.length, chunk.length - i);
      this.cabecalho = Buffer.concat([this.cabecalho, chunk.subarray(i, i + n)]);
      i += n;
      // Recalculado depois de juntar: os 8 primeiros bytes podem ter acabado de dizer "tamanho de 64 bits".
      if (this.cabecalho.length < this.cabecalhoPrecisa()) continue;
      this.abrirCaixa();
    }
  }

  /** O cabeçalho da caixa tem 8 bytes, ou 16 quando o tamanho de 32 bits é 1 (o de 64 bits vem depois do tipo). */
  private cabecalhoPrecisa(): number {
    return this.cabecalho.length >= 8 && this.cabecalho.readUInt32BE(0) === 1 ? 16 : 8;
  }

  private abrirCaixa(): void {
    const tamanho32 = this.cabecalho.readUInt32BE(0);
    const tipo = this.cabecalho.toString('latin1', 4, 8);
    const cab = this.cabecalho.length;
    const tamanho = tamanho32 === 1 ? Number(this.cabecalho.readBigUInt64BE(8)) : tamanho32;
    this.cabecalho = Buffer.alloc(0);
    this.caixas++;

    if (this.caixas === 1 && tipo !== 'ftyp') {
      throw new ErroDoEnvio(400, 'O arquivo não é mp4: a primeira caixa não é ftyp.');
    }
    if (tamanho32 !== 0 && (tamanho < cab || !Number.isSafeInteger(tamanho))) {
      throw new ErroDoEnvio(400, `A caixa ${JSON.stringify(tipo)} do mp4 tem tamanho inválido.`);
    }
    const fim = tamanho32 === 0 ? this.declarado.bytes : this.offsetDaCaixa + tamanho;
    if (fim > this.declarado.bytes) throw new ErroDoEnvio(400, `A caixa ${JSON.stringify(tipo)} passa do fim do arquivo declarado.`);

    if (tipo === 'mdat') {
      if (!this.viuMoov) {
        throw new ErroDoEnvio(400, 'O mp4 não tem faststart: o moov vem depois do mdat. Refaça com -movflags +faststart.');
      }
      this.viuMdat = true;
    }
    if (tipo === 'moov') {
      if (this.viuMoov) throw new ErroDoEnvio(400, 'O mp4 tem dois moov.');
      if (fim - this.offsetDaCaixa - cab > TETO_DO_MOOV) throw new ErroDoEnvio(400, 'O moov do mp4 é grande demais para um corte.');
      this.viuMoov = true;
      this.coletando = [];
    }
    this.offsetDaCaixa = fim;
    if (tamanho32 === 0) this.ateOFim = true;
    else {
      this.restante = tamanho - cab;
      if (this.restante === 0 && this.coletando) this.fecharMoov();
    }
  }

  private juntar(parte: Buffer): void {
    this.coletando!.push(parte);
  }

  private fecharMoov(): void {
    const corpo = Buffer.concat(this.coletando ?? []);
    this.coletando = null;
    this.moov = lerMoov(corpo);
    this.aoLerMoov?.(this.moov);
  }
}

/** A chave do mp4 no storage: o id da peça e o sha256 inteiro — reenviar o mesmo arquivo cai na mesma chave. */
export function chaveDoVideoDaPeca(pecaId: string, sha256: string): string {
  return `pauta/pecas/${pecaId}/corte-${sha256}.mp4`;
}
