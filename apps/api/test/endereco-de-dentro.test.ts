import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { enderecoDeDentro } from '../src/pauta/endereco-de-dentro';
import { buscarPaginaPublica, pedirAoIp, type Conectar } from '../src/pauta/pagina-publica';
import { buscarLinkDeFora } from '../src/onboarding/trilho/leitura-da-ata.service';
import { enderecosPermitidos } from '../src/pauta/evolution.service';

/*
 * PRODUÇÃO 22, M4 · ENDEREÇO DE DENTRO NUM LUGAR SÓ, E O REBINDING FECHADO.
 *
 * Duas partes. A tabela das faixas (pura). E a prova de que a conexão vai ao IP
 * que foi conferido: um resolver que muda de resposta (público na primeira
 * pergunta, 127.0.0.1 na segunda) nunca leva a conexão para dentro, nos DOIS
 * lugares que buscam link de fora (a captura da pauta e o link da ata), em todo
 * salto de redirecionamento.
 */

describe('enderecoDeDentro: a tabela das faixas', () => {
  const deDentro = [
    // IPv4
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.254', '127.0.0.1', '127.8.8.8',
    '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.0.2.10', '192.88.99.1', '192.168.1.10',
    '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.250', '240.0.0.1',
    '255.255.255.255',
    // IPv6 simples
    '::', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'fec0::1',
    'feff::1', 'ff02::1', 'ff00::', '100::1', '2001::1', '2001:0:4136:e378::1', '2001:1ff::1', '2001:db8::1',
    '64:ff9b:1::1',
    // IPv6 com IPv4 embutido de dentro
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe',
    '::127.0.0.1', '::10.1.2.3', '::0.0.0.2', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::', '2002:a00:1::1', '2002:c0a8:0101::1', '[::1]',
    // IPv4 traduzido (SIIT) de dentro
    '::ffff:0:127.0.0.1', '::ffff:0:7f00:1', '::ffff:0:10.0.0.1', '::ffff:0:169.254.169.254', '0:0:0:0:ffff:0:a9fe:a9fe',
    // não é IP: falha fechada
    '', 'localhost', 'exemplo.com', '1.2.3', '256.1.1.1', '::g', '1::2::3',
  ];
  const deFora = [
    '8.8.8.8', '93.184.216.34', '172.32.0.1', '172.15.255.255', '100.63.255.255', '100.128.0.1', '192.0.1.1',
    '192.169.0.1', '198.20.0.1', '203.0.114.1', '223.255.255.255', '1.1.1.1',
    '2606:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001::200e', '2001:200::1',
    '::ffff:8.8.8.8', '::ffff:808:808', '::8.8.8.8', '64:ff9b::808:808', '64:ff9b::8.8.8.8', '2002:808:808::1',
    '::ffff:0:8.8.8.8', '::ffff:0:808:808',
  ];

  it.each(deDentro)('%s é de dentro', (ip) => {
    expect(enderecoDeDentro(ip)).toBe(true);
  });

  it.each(deFora)('%s é de fora', (ip) => {
    expect(enderecoDeDentro(ip)).toBe(false);
  });
});

/** Um resolver que muda de resposta a cada pergunta: público, depois loopback. */
function resolverQueMuda(publico: string) {
  const perguntas: string[] = [];
  const resolver = async (host: string) => {
    perguntas.push(host);
    return perguntas.length === 1 ? [publico] : ['127.0.0.1'];
  };
  return { resolver, perguntas };
}

describe('rebinding: a conexão vai ao IP conferido', () => {
  let servidor: Server;
  let porta = 0;
  const hosts: string[] = [];

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      hosts.push(String(req.headers.host ?? ''));
      res.setHeader('content-type', 'text/plain');
      res.end('chegou');
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    porta = (servidor.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  });

  it('pedirAoIp conecta no IP recebido sem consultar o DNS, e o Host continua sendo o nome', async () => {
    // `.invalid` nunca resolve: se o Node consultasse o DNS, o pedido falharia.
    const res = await pedirAoIp(new URL(`http://nao-resolve.invalid:${porta}/x`), '127.0.0.1', {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('chegou');
    expect(hosts.at(-1)).toBe(`nao-resolve.invalid:${porta}`);
  });

  it('pedirAoIp recusa um IP que não é IP', async () => {
    await expect(pedirAoIp(new URL('http://exemplo.com/'), 'exemplo.com', {})).rejects.toThrow(/não é um IP/);
  });

  it('captura da pauta: o resolver que muda de resposta nunca leva a conexão a 127.0.0.1', async () => {
    const { resolver, perguntas } = resolverQueMuda('8.8.8.8');
    const conexoes: Array<{ url: string; ip: string }> = [];
    const conectar: Conectar = async (u, ip) => {
      conexoes.push({ url: u.toString(), ip });
      return new Response('ok', { status: 200 });
    };
    const r = await buscarPaginaPublica('https://troca.exemplo/a', {}, { resolver, conectar });
    expect(await r.text()).toBe('ok');
    // uma pergunta ao DNS por salto, e a conexão no IP dessa pergunta
    expect(perguntas).toEqual(['troca.exemplo']);
    expect(conexoes).toEqual([{ url: 'https://troca.exemplo/a', ip: '8.8.8.8' }]);
  });

  it('captura da pauta: em todo salto a conexão vai ao IP do próprio salto, e o salto que resolve para dentro para', async () => {
    const respostas: Record<string, string[]> = { 'um.exemplo': ['8.8.8.8'], 'dois.exemplo': ['1.1.1.1'], 'tres.exemplo': ['127.0.0.1'] };
    const resolver = async (h: string) => respostas[h];
    const conexoes: Array<{ url: string; ip: string }> = [];
    const conectar: Conectar = async (u, ip) => {
      conexoes.push({ url: u.toString(), ip });
      if (u.hostname === 'um.exemplo') return new Response(null, { status: 302, headers: { location: 'https://dois.exemplo/b' } });
      return new Response(null, { status: 302, headers: { location: 'https://tres.exemplo/c' } });
    };
    await expect(buscarPaginaPublica('https://um.exemplo/a', {}, { resolver, conectar })).rejects.toThrow(/endereço interno/);
    expect(conexoes).toEqual([
      { url: 'https://um.exemplo/a', ip: '8.8.8.8' },
      { url: 'https://dois.exemplo/b', ip: '1.1.1.1' },
    ]);
  });

  it('captura da pauta, de ponta a ponta: a conexão real vai ao IP conferido, não a uma segunda resolução', async () => {
    // O resolver responde 127.0.0.1 só na SEGUNDA pergunta. A primeira, a da
    // conferência, devolve um IP de fora. Se houvesse segunda resolução na
    // conexão, ela iria ao servidor local e o texto "chegou" voltaria.
    const { resolver, perguntas } = resolverQueMuda('192.0.1.1');
    const conexoes: string[] = [];
    const conectar: Conectar = async (u, ip, init) => {
      conexoes.push(ip);
      return pedirAoIp(u, ip, { ...init, signal: AbortSignal.timeout(300) });
    };
    const antes = hosts.length;
    await expect(buscarPaginaPublica(`http://troca.exemplo:${porta}/a`, {}, { resolver, conectar })).rejects.toThrow();
    expect(perguntas).toHaveLength(1);
    expect(conexoes).toEqual(['192.0.1.1']);
    expect(hosts.length).toBe(antes);
  });

  it('link da ata: o resolver que muda de resposta nunca leva a conexão a 127.0.0.1, em nenhum salto', async () => {
    const perguntas: string[] = [];
    const resolver = async (host: string) => {
      perguntas.push(host);
      // a primeira pergunta de cada nome é pública; qualquer segunda seria loopback
      return perguntas.filter((p) => p === host).length === 1 ? (host === 'ata.exemplo' ? ['8.8.8.8'] : ['1.1.1.1']) : ['127.0.0.1'];
    };
    const conexoes: Array<{ url: string; ip: string }> = [];
    const conectar: Conectar = async (u, ip) => {
      conexoes.push({ url: u.toString(), ip });
      if (u.hostname === 'ata.exemplo') return new Response(null, { status: 301, headers: { location: 'https://outra.exemplo/t' } });
      return new Response('transcrição', { status: 200, headers: { 'content-type': 'text/plain' } });
    };
    const r = await buscarLinkDeFora('https://ata.exemplo/x', { resolver, conectar });
    expect(r.corpo).toBe('transcrição');
    expect(perguntas).toEqual(['ata.exemplo', 'outra.exemplo']);
    expect(conexoes).toEqual([
      { url: 'https://ata.exemplo/x', ip: '8.8.8.8' },
      { url: 'https://outra.exemplo/t', ip: '1.1.1.1' },
    ]);
    expect(conexoes.every((c) => !enderecoDeDentro(c.ip))).toBe(true);
  });

  it('link da ata: o redirecionamento para NAT64, 6to4 ou mapeado de dentro é recusado antes de conectar', async () => {
    for (const interno of ['64:ff9b::7f00:1', '2002:7f00:1::', '::ffff:7f00:1', 'fec0::1']) {
      const resolver = async (host: string) => (host === 'ata.exemplo' ? ['8.8.8.8'] : [interno]);
      const conexoes: string[] = [];
      const conectar: Conectar = async (u, ip) => {
        conexoes.push(ip);
        return new Response(null, { status: 302, headers: { location: 'https://de-dentro.exemplo/' } });
      };
      await expect(buscarLinkDeFora('https://ata.exemplo/x', { resolver, conectar })).rejects.toThrow(/dentro da casa/);
      expect(conexoes).toEqual(['8.8.8.8']);
    }
  });
});

describe('a regra da Evolution usa o mesmo helper para quem não é a casa', () => {
  it('NAT64 e 6to4 de dentro são recusados para empresa de fora', () => {
    expect(enderecosPermitidos(['64:ff9b::a00:1'], false)).toBe(false);
    expect(enderecosPermitidos(['2002:a00:1::1'], false)).toBe(false);
    expect(enderecosPermitidos(['8.8.8.8'], false)).toBe(true);
    // a casa continua alcançando a rede privada (o root_evolution), nunca loopback
    expect(enderecosPermitidos(['10.0.0.5'], true)).toBe(true);
    expect(enderecosPermitidos(['127.0.0.1'], true)).toBe(false);
  });
});
