/*
 * O DUBLÊ DO GOOGLE NA HOMOLOGAÇÃO (agenda v2, 29/10/2026).
 *
 * A prova de ponta a ponta da agenda v2 (`homolog/e2e/agenda-v2.mjs`) roda contra
 * um dublê do Google Calendar (`homolog/mocks/google`), que guarda o que recebeu.
 * `GOOGLE_API_DUBLE_URL` troca a origem das APIs do Google (as do conector, lista
 * em `google.service.ts`) pela do dublê.
 *
 * A trava contra o uso errado: o endereço só vale se for de DENTRO (loopback ou
 * nome sem ponto, o serviço da rede Docker). Um domínio público é recusado no
 * arranque: com ele, o token do Google da empresa sairia para um terceiro. A
 * variável não existe no compose de produção.
 */

export function origemDoDuble(env: NodeJS.ProcessEnv = process.env): string | null {
  const bruto = (env.GOOGLE_API_DUBLE_URL ?? '').trim();
  if (!bruto) return null;
  let u: URL;
  try {
    u = new URL(bruto);
  } catch {
    throw new Error(`GOOGLE_API_DUBLE_URL não é um endereço: "${bruto}".`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // Loopback, ou nome sem ponto e sem dois-pontos (o serviço na rede Docker). Um IPv6 literal
  // que não seja `::1` tem dois-pontos e cai fora (B1): `[2606:4700::1111]` não tem ponto.
  const deDentro = host === 'localhost' || host === '127.0.0.1' || host === '::1' || (!!host && !host.includes('.') && !host.includes(':'));
  if (!deDentro || !/^https?:$/.test(u.protocol)) {
    throw new Error(
      'GOOGLE_API_DUBLE_URL só aceita loopback ou nome sem ponto (o dublê na rede Docker): ' +
        'com um domínio de fora, o token do Google da empresa sairia da casa.',
    );
  }
  return `${u.protocol}//${u.host}`;
}

/** O endereço que vale: o do Google, ou o do dublê quando a homologação o declarou. */
export function urlDoGoogle(url: string, duble: string | null, origens: readonly string[]): string {
  if (!duble) return url;
  for (const o of origens) if (url.startsWith(o)) return duble + url.slice(o.length);
  return url;
}

/** Uma resposta do Google que não foi 2xx, com o status (a sincronia precisa do 410). */
export class ErroDoGoogle extends Error {
  constructor(
    readonly status: number,
    readonly corpo: string,
    caminho: string,
  ) {
    super(`Google ${caminho} → HTTP ${status} ${corpo.slice(0, 160)}`);
    this.name = 'ErroDoGoogle';
  }
}
