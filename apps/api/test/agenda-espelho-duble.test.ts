import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ErroDoGoogle, origemDoDuble } from '../src/google/dubles-do-google';
import { lerLivreOcupado, listarPaginaDaAgenda, type ChamadorDaAgenda } from '../src/google/agenda-espelho.google';
import { linhaDoEvento } from '../src/agenda/espelho/espelho-do-google';

/*
 * O DUBLÊ DO GOOGLE (homolog/mocks/google) CONTRA OS EFEITOS DE LEITURA DO ESPELHO.
 *
 * Sobe o dublê numa porta local e fala com ele como o `GoogleService.chamarAgenda`
 * fala (Bearer, a mesma regra de caminho, `ErroDoGoogle` fora de 2xx): prova que
 * o dublê que o e2e usa responde ao que o espelho pede — syncToken, páginas,
 * 410, cancelado, insert com Meet e freeBusy — e que a porta de controle guarda
 * o que recebeu. Só loopback; nada sai da máquina.
 */

const PORTA = 40000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORTA}`;
const SERVIDOR = join(__dirname, '..', '..', '..', 'homolog', 'mocks', 'google', 'server.mjs');
const CAMINHO_DO_CALENDAR = /^\/calendar\/v3\/[A-Za-z0-9_@%.\-/?=&:,+]*$/;

const chamador: ChamadorDaAgenda = {
  async chamarAgenda<T>(_org: string, caminho: string, init?: RequestInit): Promise<T> {
    if (!CAMINHO_DO_CALENDAR.test(caminho) || /\.\.|%2e/i.test(caminho)) throw new Error('Caminho fora da API do Calendar.');
    const res = await fetch(`${BASE}${caminho}`, {
      ...init,
      headers: { Authorization: 'Bearer duble', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new ErroDoGoogle(res.status, await res.text(), caminho.split('?')[0]);
    if (res.status === 204) return undefined as T;
    const t = await res.text();
    return (t ? JSON.parse(t) : undefined) as T;
  },
};

const controle = async (caminho: string, corpo?: unknown, metodo = 'POST') => {
  const r = await fetch(`${BASE}/_duble${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  return r.json() as Promise<Record<string, unknown>>;
};

const JANELA = { de: '2026-10-01T00:00:00Z', ate: '2027-04-30T00:00:00Z' };

/** Lê todas as páginas, como o serviço do espelho. */
async function tudo(args: { syncToken?: string; de?: string; ate?: string }) {
  const itens: unknown[] = [];
  let pagina: string | undefined;
  for (;;) {
    const p = await listarPaginaDaAgenda(chamador, 'org', { ...args, pagina });
    if (p.tokenVencido) return { itens, token: null, vencido: true };
    itens.push(...p.itens);
    if (!p.nextPageToken) return { itens, token: p.nextSyncToken, vencido: false };
    pagina = p.nextPageToken;
  }
}

describe('GOOGLE_API_DUBLE_URL só aceita endereço de dentro (B1)', () => {
  const com = (v: string) => origemDoDuble({ GOOGLE_API_DUBLE_URL: v } as NodeJS.ProcessEnv);

  it('loopback e nome sem ponto (o serviço na rede Docker) valem', () => {
    expect(com('')).toBeNull();
    expect(com('http://localhost:4010')).toBe('http://localhost:4010');
    expect(com('http://127.0.0.1:4010/x')).toBe('http://127.0.0.1:4010');
    expect(com('http://[::1]:4010')).toBe('http://[::1]:4010');
    expect(com('http://google-duble:4010')).toBe('http://google-duble:4010');
  });

  it('IPv6 literal que não seja ::1, IPv4 de fora, domínio e outro esquema são recusados', () => {
    for (const v of [
      'http://[2606:4700::1111]',
      'http://[::ffff:808:808]',
      'http://[::ffff:127.0.0.1]',
      'http://[fe80::1]:4010',
      'http://8.8.8.8',
      'http://134744072',
      'https://duble.exemplo.invalid',
      'ftp://localhost',
    ]) {
      expect(() => com(v), v).toThrow(/só aceita loopback/);
    }
  });
});

describe('o dublê do Google responde ao que o espelho pede', () => {
  let proc: ChildProcess;

  beforeAll(async () => {
    proc = spawn(process.execPath, [SERVIDOR], { env: { ...process.env, PORT: String(PORTA) }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${BASE}/_duble/saude`)).ok) return;
      } catch {
        /* subindo */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('o dublê não subiu');
  });

  afterAll(() => {
    proc?.kill();
  });

  it('token e a sonda (userinfo)', async () => {
    const t = await fetch(`${BASE}/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'x' }) });
    expect(await t.json()).toHaveProperty('access_token', expect.stringMatching(/^duble-/));
    const u = await fetch(`${BASE}/oauth2/v2/userinfo`, { headers: { Authorization: 'Bearer x' } });
    expect(await u.json()).toMatchObject({ email: 'operacao.root@exemplo.invalid', verified_email: true });
    expect((await fetch(`${BASE}/oauth2/v2/userinfo`)).status).toBe(401);
    const pedidos = (await controle('/pedidos', undefined, 'GET')).pedidos as Array<{ caminho: string; corpo: unknown }>;
    // O refresh token não fica guardado no dublê.
    expect(pedidos.find((p) => p.caminho === '/token')?.corpo).toEqual({ grant_type: 'refresh_token' });
  });

  it('janela completa, incremental, mexido e cancelado pelo celular, 410 depois de invalidar', async () => {
    await controle('/zerar');
    await controle('/semear', {
      eventos: [1, 2, 3].map((n) => ({
        id: `ev${n}`,
        summary: `Reunião Interna - Pedro`,
        start: { dateTime: `2026-11-0${n}T10:00:00-03:00` },
        end: { dateTime: `2026-11-0${n}T11:00:00-03:00` },
      })),
    });
    const cheia = await tudo(JANELA);
    expect(cheia.itens).toHaveLength(3);
    expect(cheia.token).toMatch(/^sync-\d+$/);

    expect((await tudo({ syncToken: cheia.token! })).itens).toHaveLength(0);

    await controle('/mexer/ev2', { start: { dateTime: '2026-11-02T15:00:00-03:00' }, end: { dateTime: '2026-11-02T16:00:00-03:00' } });
    await controle('/cancelar/ev3');
    const inc = await tudo({ syncToken: cheia.token! });
    expect(inc.itens.map((i) => (i as { id: string }).id)).toEqual(['ev2', 'ev3']);
    expect(linhaDoEvento(inc.itens[1], [])).toEqual({ tipo: 'cancelado', googleId: 'ev3' });
    const ev2 = linhaDoEvento(inc.itens[0], []);
    expect(ev2.tipo === 'linha' && ev2.linha.inicio.toISOString()).toBe('2026-11-02T18:00:00.000Z');

    await controle('/invalidar-sync');
    expect(await listarPaginaDaAgenda(chamador, 'org', { syncToken: inc.token! })).toMatchObject({ tokenVencido: true });
    const refeita = await tudo(JANELA);
    expect(refeita.itens).toHaveLength(3); // showDeleted: o cancelado volta na janela, com o status
  });

  it('insert com id do cliente e Meet; repetido = 409; patch mescla as propriedades privadas; delete marca cancelled', async () => {
    const corpo = {
      id: 'mktos0abc12345',
      summary: 'Reunião Online - Cliente Exemplo - Pedro',
      start: { dateTime: '2026-11-10T10:00:00-03:00' },
      end: { dateTime: '2026-11-10T11:00:00-03:00' },
      attendees: [{ email: 'Cliente@Exemplo.Invalid' }],
      conferenceData: { createRequest: { requestId: 'r1', conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      extendedProperties: { private: { mktos: '1' } },
    };
    const criado = await chamador.chamarAgenda<Record<string, unknown>>('org', '/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
      method: 'POST',
      body: JSON.stringify(corpo),
    });
    expect(criado.hangoutLink).toMatch(/^https:\/\/meet\.exemplo\.invalid\//);
    expect(criado.attendees).toEqual([{ email: 'cliente@exemplo.invalid', responseStatus: 'needsAction' }]);
    await expect(
      chamador.chamarAgenda('org', '/calendar/v3/calendars/primary/events', { method: 'POST', body: JSON.stringify(corpo) }),
    ).rejects.toMatchObject({ status: 409 });

    const mexido = await chamador.chamarAgenda<{ extendedProperties: { private: Record<string, string> }; summary: string }>(
      'org',
      '/calendar/v3/calendars/primary/events/mktos0abc12345?sendUpdates=all',
      { method: 'PATCH', body: JSON.stringify({ extendedProperties: { private: { mktosConfirmado: '1' } } }) },
    );
    expect(mexido.extendedProperties.private).toEqual({ mktos: '1', mktosConfirmado: '1' });
    expect(mexido.summary).toBe(corpo.summary);

    await chamador.chamarAgenda('org', '/calendar/v3/calendars/primary/events/mktos0abc12345?sendUpdates=all', { method: 'DELETE' });
    const lido = await chamador.chamarAgenda<{ status: string }>('org', '/calendar/v3/calendars/primary/events/mktos0abc12345');
    expect(lido.status).toBe('cancelled');

    const pedidos = (await controle('/pedidos', undefined, 'GET')).pedidos as Array<{ metodo: string; caminho: string; sendUpdates: string | null }>;
    expect(pedidos.filter((p) => p.metodo === 'DELETE')).toEqual([expect.objectContaining({ sendUpdates: 'all' })]);
  });

  it('freeBusy: só intervalos; agenda não compartilhada é erro dela', async () => {
    await controle('/livre-ocupado', {
      'um@exemplo.invalid': [{ start: '2026-11-05T13:00:00Z', end: '2026-11-05T14:00:00Z' }],
      'dois@exemplo.invalid': 'naoCompartilhada',
    });
    const r = await lerLivreOcupado(chamador, 'org', { agendas: ['um@exemplo.invalid', 'dois@exemplo.invalid'], de: '2026-11-01T00:00:00Z', ate: '2026-11-30T00:00:00Z' });
    expect(r.intervalos).toEqual([{ agenda: 'um@exemplo.invalid', inicio: '2026-11-05T13:00:00.000Z', fim: '2026-11-05T14:00:00.000Z' }]);
    expect(r.erros.map((e) => e.agenda)).toEqual(['dois@exemplo.invalid']);
  });
});
