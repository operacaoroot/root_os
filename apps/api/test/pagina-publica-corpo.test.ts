import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buscarLinkDeFora } from '../src/onboarding/trilho/leitura-da-ata.service';
import { buscarPaginaPublica, CorpoAcimaDoTetoError, lerCorpoComTeto, pedirAoIp, TETO_DE_BYTES_DA_PAGINA, type Conectar } from '../src/pauta/pagina-publica';

/*
 * PRODUÇÃO 22, REVISÃO · O CORPO COMPRIMIDO QUE PARA NO MEIO, E A BOMBA GZIP.
 *
 * `pedirAoIp` descomprimia com `res.pipe(createGunzip())`. `pipe` não leva o
 * erro nem o fechamento da resposta ao descompressor: um servidor que manda
 * `Content-Encoding: gzip`, poucos bytes e para fazia o prazo derrubar o socket
 * e o descompressor ficar aberto, e a leitura do corpo nunca resolvia (a
 * captura da pauta com `res.text()`, o link da ata com `lerComTeto`).
 *
 * O servidor de prova escuta em 127.0.0.1; a conferência de destino continua
 * valendo, e a conexão vai ao servidor local pelo `conectar` injetado (o mesmo
 * desenho do `endereco-de-dentro.test.ts`).
 */

const PENDUROU = Symbol('pendurou');

/** A promessa resolve ou rejeita antes de `ms`? Senão, devolve `PENDUROU`. */
async function dentroDe<T>(p: Promise<T>, ms: number): Promise<{ ok: true; valor: T } | { ok: false; erro: unknown } | typeof PENDUROU> {
  let relogio: NodeJS.Timeout | undefined;
  const limite = new Promise<typeof PENDUROU>((ok) => {
    relogio = setTimeout(() => ok(PENDUROU), ms);
  });
  try {
    return await Promise.race([p.then((valor) => ({ ok: true as const, valor }), (erro: unknown) => ({ ok: false as const, erro })), limite]);
  } finally {
    clearTimeout(relogio);
  }
}

describe('o corpo comprimido: para no prazo e para no teto', () => {
  let servidor: Server;
  let porta = 0;
  const abertas = new Set<ServerResponse>();
  const bomba = gzipSync(Buffer.alloc(TETO_DE_BYTES_DA_PAGINA + 1024 * 1024, 0x61));

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      if (req.url?.startsWith('/parcial')) {
        // gzip declarado, o começo do fluxo, e depois silêncio (sem fechar)
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        res.write(gzipSync(Buffer.from('<html>texto que nunca termina</html>')).subarray(0, 12));
        abertas.add(res);
        return;
      }
      if (req.url?.startsWith('/bomba')) {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'content-length': String(bomba.length) });
        res.end(bomba);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(gzipSync(Buffer.from('<html>inteira</html>')));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    porta = (servidor.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const r of abertas) r.destroy();
    servidor.closeAllConnections?.();
    await new Promise<void>((ok) => servidor.close(() => ok()));
  });

  /** Conecta no servidor local, na porta dele, com um prazo curto, seja qual for o IP conferido. */
  const aoServidorLocal =
    (prazoMs: number): Conectar =>
    (u, _ip, init) => {
      const local = new URL(u.toString());
      local.port = String(porta);
      local.protocol = 'http:';
      return pedirAoIp(local, '127.0.0.1', { ...init, signal: AbortSignal.timeout(prazoMs) });
    };

  it('pedirAoIp: o gzip que para no meio rejeita a leitura dentro do prazo, em vez de pendurar', async () => {
    const res = await pedirAoIp(new URL(`http://parcial.exemplo:${porta}/parcial`), '127.0.0.1', { signal: AbortSignal.timeout(300) });
    expect(res.status).toBe(200);
    const r = await dentroDe(lerCorpoComTeto(res), 3_000);
    expect(r).not.toBe(PENDUROU);
    expect(r).toMatchObject({ ok: false });
  });

  it('pedirAoIp: o mesmo vale para quem lê com res.text()', async () => {
    const res = await pedirAoIp(new URL(`http://parcial.exemplo:${porta}/parcial`), '127.0.0.1', { signal: AbortSignal.timeout(300) });
    const r = await dentroDe(res.text(), 3_000);
    expect(r).not.toBe(PENDUROU);
    expect(r).toMatchObject({ ok: false });
  });

  it('captura da pauta: buscar e ler a página que para no meio rejeita dentro do prazo', async () => {
    const resolver = async () => ['8.8.8.8'];
    const leitura = buscarPaginaPublica('http://parcial.exemplo/parcial', {}, { resolver, conectar: aoServidorLocal(300) }).then((res) => lerCorpoComTeto(res));
    const r = await dentroDe(leitura, 3_000);
    expect(r).not.toBe(PENDUROU);
    expect(r).toMatchObject({ ok: false });
  });

  it('link da ata: o gzip que para no meio vira link indisponível dentro do prazo', async () => {
    const resolver = async () => ['8.8.8.8'];
    const r = await dentroDe(buscarLinkDeFora('http://ata.exemplo/parcial', { resolver, conectar: aoServidorLocal(300) }), 3_000);
    expect(r).not.toBe(PENDUROU);
    expect(r).toMatchObject({ ok: false });
    expect(String((r as { erro: Error }).erro.message)).toMatch(/não consegui ler o link/);
  });

  it('a bomba gzip (poucos KB que viram mais de 2 MB) é recusada no teto, contado depois de descomprimir', async () => {
    expect(bomba.length).toBeLessThan(64 * 1024);
    const res = await pedirAoIp(new URL(`http://bomba.exemplo:${porta}/bomba`), '127.0.0.1', { signal: AbortSignal.timeout(5_000) });
    await expect(lerCorpoComTeto(res)).rejects.toBeInstanceOf(CorpoAcimaDoTetoError);
  });

  it('link da ata: a bomba gzip ouve a frase do teto', async () => {
    const resolver = async () => ['8.8.8.8'];
    await expect(buscarLinkDeFora('http://ata.exemplo/bomba', { resolver, conectar: aoServidorLocal(5_000) })).rejects.toThrow(/passa de 2 MB/);
  });

  it('o corpo comprimido inteiro continua sendo lido', async () => {
    const res = await pedirAoIp(new URL(`http://inteira.exemplo:${porta}/`), '127.0.0.1', { signal: AbortSignal.timeout(5_000) });
    expect(await lerCorpoComTeto(res)).toBe('<html>inteira</html>');
  });
});
