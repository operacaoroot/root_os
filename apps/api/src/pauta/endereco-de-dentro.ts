import { isIP } from 'node:net';

/*
 * O ENDEREÇO É DE DENTRO? Uma regra, um lugar (Produção 22, M4).
 *
 * Até 22/10/2026 havia duas regras diferentes para a mesma pergunta: a da busca
 * da página de uma captura (`pagina-publica.ts`) e a do link da ata
 * (`onboarding/trilho/leitura-da-ata.service.ts`). A segunda tratava todo
 * `::ffff:` como interno e não conhecia CGNAT nem multicast; a primeira não
 * conhecia NAT64, 6to4 nem o IPv4-compatível. Duas cópias de uma trava é uma
 * trava que um dia diverge, e as duas já tinham divergido.
 *
 * "De dentro" quer dizer: não é um endereço público da internet. Entra aqui
 * tudo o que a API não deve alcançar a pedido de alguém de fora:
 *
 *   IPv4   0/8 ("este host"), 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16
 *          (link-local, metadados da nuvem), 172.16/12, 192.0.0/24, 192.0.2/24,
 *          192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24,
 *          224/4 (multicast) e 240/4 (reservado, inclui o broadcast).
 *   IPv6   `::`, `::1`, fc00::/7 (ULA), fe80::/10 (link-local), fec0::/10
 *          (site-local antigo), ff00::/8 (multicast), 100::/64 (descarte),
 *          2001::/23 (blocos de protocolo da IETF, inclui o Teredo, que embute
 *          um IPv4 ofuscado), 2001:db8::/32 (documentação), 64:ff9b:1::/48
 *          (NAT64 de uso local).
 *   IPv6 que carrega um IPv4 e é julgado pelo IPv4 embutido:
 *          ::ffff:a.b.c.d (mapeado, também na forma hexadecimal ::ffff:7f00:1),
 *          ::a.b.c.d (IPv4-compatível, obsoleto), 64:ff9b::/96 (NAT64) e
 *          2002::/16 (6to4: o IPv4 vem nos bits 16 a 48).
 *
 * Texto que não é endereço IP é "de dentro": falha fechada. Quem chama já
 * resolveu o nome; um valor que não parseia não deve virar conexão.
 *
 * Função pura, sem DNS e sem rede. Quem conecta é `pedirAoIp`, em
 * `pagina-publica.ts`, e conecta ao IP que esta função aprovou.
 */

function ipv4DeDentro(a: number, b: number, c: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** Os quatro octetos de um IPv4 em texto, ou `null`. */
function octetos(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return null;
  return o as [number, number, number, number];
}

/** Os 16 bytes de um IPv6 em texto (com `::` e IPv4 no fim), ou `null`. */
export function bytesDoIpv6(texto: string): number[] | null {
  let s = texto.trim().toLowerCase();
  const zona = s.indexOf('%');
  if (zona >= 0) s = s.slice(0, zona);
  if (!s || isIP(s) !== 6) return null;
  let cauda: number[] = [];
  const ultimo = s.lastIndexOf(':');
  const fim = s.slice(ultimo + 1);
  if (fim.includes('.')) {
    const v4 = octetos(fim);
    if (!v4) return null;
    cauda = v4;
    s = s.slice(0, ultimo + 1) + '0:0';
  }
  const partes = s.split('::');
  if (partes.length > 2) return null;
  const grupos = (p: string) => (p === '' ? [] : p.split(':'));
  const esquerda = grupos(partes[0]);
  const direita = partes.length === 2 ? grupos(partes[1]) : [];
  const faltam = 8 - esquerda.length - direita.length;
  if (partes.length === 1 && faltam !== 0) return null;
  if (faltam < 0) return null;
  const todos = [...esquerda, ...Array(faltam).fill('0'), ...direita];
  if (todos.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of todos) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  if (cauda.length) bytes.splice(12, 4, ...cauda);
  return bytes;
}

const zerados = (b: number[], ate: number) => b.slice(0, ate).every((x) => x === 0);

function ipv6DeDentro(b: number[]): boolean {
  // :: e ::1
  if (zerados(b, 15) && (b[15] === 0 || b[15] === 1)) return true;
  // ::ffff:a.b.c.d (mapeado)
  if (zerados(b, 10) && b[10] === 0xff && b[11] === 0xff) return ipv4DeDentro(b[12], b[13], b[14]);
  // ::a.b.c.d (IPv4-compatível)
  if (zerados(b, 12)) return ipv4DeDentro(b[12], b[13], b[14]);
  // 64:ff9b::/96 (NAT64 bem-conhecido): o IPv4 nos últimos 32 bits
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zerados(b.slice(4), 8)) {
    return ipv4DeDentro(b[12], b[13], b[14]);
  }
  // 64:ff9b:1::/48 (NAT64 de uso local)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b[4] === 0x00 && b[5] === 0x01) return true;
  // 2002::/16 (6to4): o IPv4 nos bits 16 a 48
  if (b[0] === 0x20 && b[1] === 0x02) return ipv4DeDentro(b[2], b[3], b[4]);
  // fc00::/7, fe80::/10, fec0::/10, ff00::/8
  if ((b[0] & 0xfe) === 0xfc) return true;
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true;
  if (b[0] === 0xff) return true;
  // 100::/64 (descarte)
  if (b[0] === 0x01 && b[1] === 0x00 && zerados(b.slice(2), 6)) return true;
  // 2001::/23 (protocolos da IETF, Teredo) e 2001:db8::/32 (documentação)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] <= 0x01) return true;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;
  return false;
}

/** O endereço (IPv4 ou IPv6, em texto) é de dentro? Ver o cabeçalho. */
export function enderecoDeDentro(ip: string): boolean {
  const texto = String(ip ?? '').trim().replace(/^\[|\]$/g, '');
  const v4 = octetos(texto);
  if (v4) return ipv4DeDentro(v4[0], v4[1], v4[2]);
  const v6 = bytesDoIpv6(texto);
  if (v6) return ipv6DeDentro(v6);
  return true;
}
