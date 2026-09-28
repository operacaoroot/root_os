import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/*
 * A BUSCA DA PÁGINA DE UMA CAPTURA, SÓ PARA FORA DA CASA.
 *
 * Processar a captura faz GET do lado do servidor, e o grupo do WhatsApp (MC1)
 * ampliou quem consegue criar captura. O filtro do grupo olha só o nome escrito
 * na mensagem; um host público que responde 302 para o endereço de metadados
 * da VPS, para `mktos_api:4001` ou para o Postgres, ou um nome que resolve para
 * 127.0.0.1, passava — e o começo da resposta ia para a ficha. Aqui cada salto
 * é conferido: o host resolvido não pode ser privado, loopback, link-local nem
 * ULA, e o redirecionamento é seguido à mão, até `SALTOS`.
 *
 * Fica de fora a troca de DNS entre a conferência e a conexão (rebinding): fechar
 * isso pede um agente HTTP com `lookup` próprio, e é outra fatia.
 */

const SALTOS = 5;

function ipv4Privado(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** O endereço é de dentro (privado, loopback, link-local, ULA, multicast, não roteável)? */
export function enderecoInterno(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Privado(ip);
  if (v !== 6) return true;
  const x = ip.toLowerCase();
  const mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(x);
  if (mapeado) return ipv4Privado(mapeado[1]);
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
}

export type Resolver = (host: string) => Promise<string[]>;

const resolverDoSistema: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

async function conferirDestino(u: URL, resolver: Resolver): Promise<void> {
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
  if (!enderecos.length || enderecos.some(enderecoInterno)) {
    throw new BadRequestException('O link aponta para um endereço interno — não é buscado.');
  }
}

/** GET da página pública, conferindo o destino a cada salto de redirecionamento. */
export async function buscarPaginaPublica(
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal },
  deps: { resolver?: Resolver; fetch?: typeof fetch } = {},
): Promise<Response> {
  const resolver = deps.resolver ?? resolverDoSistema;
  const buscar = deps.fetch ?? fetch;
  let atual = new URL(url);
  for (let salto = 0; salto <= SALTOS; salto++) {
    await conferirDestino(atual, resolver);
    const res = await buscar(atual.toString(), { ...init, redirect: 'manual' });
    const destino = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!destino) return res;
    atual = new URL(destino, atual);
  }
  throw new BadRequestException(`A página redirecionou mais de ${SALTOS} vezes.`);
}
