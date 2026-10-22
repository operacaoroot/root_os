import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { pipeline, Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { enderecoDeDentro } from './endereco-de-dentro';

/*
 * A BUSCA DA PÁGINA DE UMA CAPTURA, SÓ PARA FORA DA CASA.
 *
 * Processar a captura faz GET do lado do servidor, e o grupo do WhatsApp (MC1)
 * ampliou quem consegue criar captura. O filtro do grupo olha só o nome escrito
 * na mensagem; um host público que responde 302 para o endereço de metadados
 * da VPS, para `mktos_api:4001` ou para o Postgres, ou um nome que resolve para
 * 127.0.0.1, passava — e o começo da resposta ia para a ficha. Aqui cada salto
 * é conferido: o host resolvido não pode ser de dentro (`enderecoDeDentro`), e
 * o redirecionamento é seguido à mão, até `SALTOS`.
 *
 * O REBINDING FECHOU (Produção 22, M4). Antes, o nome era resolvido para a
 * conferência e resolvido DE NOVO pelo `fetch` na hora de conectar: um DNS com
 * TTL zero respondia público na primeira pergunta e 127.0.0.1 na segunda, e a
 * conexão ia para dentro. Agora a conexão vai ao IP que foi conferido:
 * `pedirAoIp` abre o pedido com um `lookup` próprio que devolve só esse IP. O
 * cabeçalho `Host` e o nome do TLS (SNI e a validação do certificado) continuam
 * sendo o nome original, então o servidor de verdade responde como sempre.
 * Sem dependência nova: `node:http`/`node:https`, como `brandbook-coleta.ts`.
 */

const SALTOS = 5;

/** O endereço é de dentro? Nome antigo, mantido para quem já importava daqui. */
export const enderecoInterno = enderecoDeDentro;

export type Resolver = (host: string) => Promise<string[]>;

/** O que `pedirAoIp` aceita do `RequestInit` (o que os chamadores usam). */
export interface PedidoAoIp {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Corpo em texto (o JSON da Evolution). Vai com `Content-Length`. */
  body?: string;
}

/**
 * Quem conecta: recebe a URL e o IP JÁ CONFERIDO, e nunca resolve o nome.
 * A suíte troca para provar que cada salto conecta no IP da sua conferência.
 */
export type Conectar = (url: URL, ip: string, init: PedidoAoIp) => Promise<Response>;

export const resolverDoSistema: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

/** Entre os endereços conferidos, o que vai virar conexão: o primeiro IPv4, senão o primeiro. */
export function ipDaConexao(enderecos: readonly string[]): string {
  return enderecos.find((ip) => isIP(ip) === 4) ?? enderecos[0];
}

const STATUS_SEM_CORPO = new Set([101, 103, 204, 205, 304]);

/**
 * O corpo, descomprimido quando o servidor declarou compressão.
 *
 * `pipeline` e não `pipe` (Produção 22, revisão): `pipe` não leva o erro nem o
 * fechamento da resposta ao descompressor. Um servidor que mandava
 * `Content-Encoding: gzip`, cinquenta bytes e parava fazia o prazo derrubar o
 * socket, mas o descompressor ficava aberto para sempre, e quem lia o corpo
 * (`lerCorpoComTeto`) nunca recebia nem o fim nem o erro. Com `pipeline`, a
 * resposta que morre destrói o descompressor com o erro, e o descompressor que
 * é cancelado (o teto de bytes) destrói a resposta e solta o socket.
 */
function corpoDescomprimido(res: IncomingMessage): Readable {
  const codificacao = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
  const descompressor =
    codificacao === 'gzip' || codificacao === 'x-gzip'
      ? createGunzip()
      : codificacao === 'deflate'
        ? createInflate()
        : codificacao === 'br'
          ? createBrotliDecompress()
          : null;
  if (!descompressor) return res;
  pipeline(res, descompressor, () => undefined);
  return descompressor;
}

/** O teto de bytes (já descomprimidos) de uma página ou de um link de fora: 2 MB. */
export const TETO_DE_BYTES_DA_PAGINA = 2 * 1024 * 1024;

/** O corpo passou do teto. Quem chama traduz para a frase do seu contexto. */
export class CorpoAcimaDoTetoError extends Error {
  constructor(readonly teto: number) {
    super(`o corpo passa de ${Math.round(teto / 1_048_576)} MB`);
    this.name = 'CorpoAcimaDoTetoError';
  }
}

/**
 * Lê o corpo como texto, parando no teto (contado DEPOIS de descomprimir: uma
 * bomba gzip de poucos KB que vira gigabytes para no teto, sem ocupar a
 * memória). Passou do teto, a leitura é cancelada e o socket é solto. O link
 * da ata e a captura da pauta leem por aqui.
 */
export async function lerCorpoComTeto(res: Response, teto = TETO_DE_BYTES_DA_PAGINA): Promise<string> {
  const leitor = res.body?.getReader();
  if (!leitor) return '';
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => undefined);
      throw new CorpoAcimaDoTetoError(teto);
    }
    partes.push(value);
  }
  return Buffer.concat(partes.map((p) => Buffer.from(p))).toString('utf8');
}

/**
 * O pedido HTTP(S) ao IP conferido, devolvido como um `Response` do `fetch`.
 *
 * O `lookup` próprio é o que fecha o rebinding: o Node não consulta o DNS para
 * abrir o socket, usa o IP que recebeu. Redirecionamento nunca é seguido aqui
 * (quem segue é o chamador, conferindo cada salto). Sem `agent`: cada pedido
 * abre o seu socket, e nenhum socket aberto para outro IP é reaproveitado.
 */
export const pedirAoIp: Conectar = (u, ip, init) =>
  new Promise<Response>((resolve, reject) => {
    const familia = isIP(ip);
    if (!familia) {
      reject(new Error('o endereço conferido não é um IP'));
      return;
    }
    const executar = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const metodo = (init.method ?? 'GET').toUpperCase();
    let req: ReturnType<typeof httpRequest>;
    try {
      req = executar(
        u,
        {
          method: metodo,
          agent: false,
          headers: init.body === undefined ? init.headers : { ...init.headers, 'Content-Length': String(Buffer.byteLength(init.body)) },
          signal: init.signal,
          lookup: ((_host: string, opcoes: { all?: boolean } | undefined, cb: (...a: unknown[]) => void) => {
            if (opcoes && typeof opcoes === 'object' && opcoes.all) cb(null, [{ address: ip, family: familia }]);
            else cb(null, ip, familia);
          }) as never,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status > 599) {
            res.destroy();
            reject(new Error(`resposta HTTP fora do intervalo (${status})`));
            return;
          }
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue;
            if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
            else headers.set(k, String(v));
          }
          const semCorpo = STATUS_SEM_CORPO.has(status) || metodo === 'HEAD';
          if (semCorpo) res.resume();
          const corpo = semCorpo ? null : (Readable.toWeb(corpoDescomprimido(res)) as unknown as ReadableStream<Uint8Array>);
          resolve(new Response(corpo, { status, statusText: res.statusMessage ?? '', headers }));
        },
      );
    } catch (e) {
      reject(e);
      return;
    }
    req.on('error', reject);
    if (init.body !== undefined) req.end(init.body);
    else req.end();
  });

/** Confere o destino e devolve o IP em que a conexão vai ser aberta. */
async function conferirDestino(u: URL, resolver: Resolver): Promise<string> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new BadRequestException('O link não é uma página da web (http ou https).');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let enderecos: string[];
  try {
    enderecos = isIP(host) ? [host] : await resolver(host);
  } catch {
    throw new BadRequestException(`Não achei o endereço de ${u.hostname}.`);
  }
  if (!enderecos.length || enderecos.some(enderecoDeDentro)) {
    throw new BadRequestException('O link aponta para um endereço interno — não é buscado.');
  }
  return ipDaConexao(enderecos);
}

/** GET da página pública, conferindo o destino a cada salto e conectando no IP conferido. */
export async function buscarPaginaPublica(
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal },
  deps: { resolver?: Resolver; conectar?: Conectar } = {},
): Promise<Response> {
  const resolver = deps.resolver ?? resolverDoSistema;
  const conectar = deps.conectar ?? pedirAoIp;
  let atual = new URL(url);
  for (let salto = 0; salto <= SALTOS; salto++) {
    const ip = await conferirDestino(atual, resolver);
    const res = await conectar(atual, ip, { headers: init.headers, signal: init.signal });
    const destino = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!destino) return res;
    await res.body?.cancel().catch(() => undefined);
    atual = new URL(destino, atual);
  }
  throw new BadRequestException(`A página redirecionou mais de ${SALTOS} vezes.`);
}
