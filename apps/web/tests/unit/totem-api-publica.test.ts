/**
 * O CLIENTE PÚBLICO DO TOTEM — o que ele manda e o que a tela consegue
 * reconhecer na volta.
 *
 * A credencial tem de ir em cabeçalho (nunca na URL), sem cookie da sessão do
 * painel, e as duas respostas que mudam a tela do quiosque (sem rede e aparelho
 * revogado) têm de ser reconhecidas pelo contrato, não pela frase.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErroDaApi } from '@/lib/api';
import { ehNaoEncontrado, ehSemRede, ehTotemDesativado, totemApi } from '@/lib/totem/api-publica';

const TOKEN = 'a'.repeat(43);

function respostaJson(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('totemApi', () => {
  it('manda o token no cabeçalho, sem cookie e sem cache', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respostaJson(200, { ok: true }));
    vi.stubGlobal('fetch', fetchFalso);

    await expect(totemApi('/totem-publico/catalogo', { credencial: { token: TOKEN } })).resolves.toEqual({ ok: true });

    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/totem-publico/catalogo');
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ 'x-totem-token': TOKEN });
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
  });

  it('manda o código da etiqueta no cabeçalho próprio e o corpo como JSON em POST', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchFalso);

    await expect(
      totemApi('/totem-cadastro', { credencial: { etiqueta: 'ABCDEFGH12' }, corpo: { aceite: true } }),
    ).resolves.toBeUndefined();

    const [, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'x-totem-etiqueta': 'ABCDEFGH12' });
    expect(init.body).toBe('{"aceite":true}');
  });

  it('falha de rede vira ErroDaApi com status 0 e o código sem_rede', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const erro = await totemApi('/totem-publico/catalogo').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDaApi);
    expect(ehSemRede(erro)).toBe(true);
    expect((erro as ErroDaApi).status).toBe(0);
  });

  it('401 é o aparelho desativado; 404 é o não encontrado', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(respostaJson(401, { statusCode: 401, message: 'Este totem precisa ser ativado de novo.' }))
        .mockResolvedValueOnce(respostaJson(404, { statusCode: 404, message: 'Não encontramos o que você procurou.' })),
    );

    const revogado = await totemApi('/totem-publico/catalogo', { credencial: { token: TOKEN } }).catch((e: unknown) => e);
    expect(ehTotemDesativado(revogado)).toBe(true);
    expect(ehSemRede(revogado)).toBe(false);
    expect((revogado as ErroDaApi).message).toBe('Este totem precisa ser ativado de novo.');

    const sumiu = await totemApi('/totem-etiqueta/ABCDEFGH12').catch((e: unknown) => e);
    expect(ehNaoEncontrado(sumiu)).toBe(true);
    expect(ehTotemDesativado(sumiu)).toBe(false);
  });
});
