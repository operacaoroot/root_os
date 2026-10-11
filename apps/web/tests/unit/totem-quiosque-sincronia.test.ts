/**
 * A SINCRONIA E O REGISTRO DO APARELHO.
 *
 * O catálogo só troca o que está guardado quando chega inteiro: 304, resposta
 * truncada e falta de rede deixam o aparelho com o que tinha. O token fica em
 * dois lugares e quem sobrar restaura o outro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOTEM_CABECALHO_TOKEN } from '@mktos/shared';

import { ErroDaApi } from '@/lib/api';
import { ehSemRede, ehTotemDesativado } from '@/lib/totem/api-publica';
import { armazemDoAparelho, armazemNaMemoria } from '@/components/totem/quiosque/armazem';
import { esquecerAparelho, gravarAparelho, lerAparelho, type AparelhoAtivado } from '@/components/totem/quiosque/credencial';
import {
  baixarCatalogo,
  guardarCatalogo,
  lerCatalogoGuardado,
} from '@/components/totem/quiosque/sincronia';
import { mensagemDaFalhaDeSincronia } from '@/components/totem/quiosque/useQuiosque';
import { catalogoDeExemplo } from '../totem-quiosque-dados';

const TOKEN = 'b'.repeat(43);

function resposta(status: number, corpo?: unknown): Response {
  if (corpo === undefined) return new Response(null, { status });
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('baixarCatalogo', () => {
  it('manda o token e a versão guardada em cabeçalho, sem cookie e sem cache', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(resposta(304));
    vi.stubGlobal('fetch', fetchFalso);

    await expect(baixarCatalogo(TOKEN, 'v1', '/api')).resolves.toEqual({ mudou: false });

    const [url, init] = fetchFalso.mock.calls[0]!;
    expect(url).toBe('/api/totem-publico/catalogo');
    expect(url).not.toContain(TOKEN);
    expect(init.headers).toMatchObject({ [TOTEM_CABECALHO_TOKEN]: TOKEN, 'If-None-Match': '"v1"' });
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'omit' });
  });

  it('sem versão guardada não manda If-None-Match e devolve o catálogo novo', async () => {
    const catalogo = catalogoDeExemplo({ versao: 'v2' });
    const fetchFalso = vi.fn().mockResolvedValue(resposta(200, catalogo));
    vi.stubGlobal('fetch', fetchFalso);

    await expect(baixarCatalogo(TOKEN, null, '/api')).resolves.toEqual({ mudou: true, catalogo });
    expect(fetchFalso.mock.calls[0]![1].headers).not.toHaveProperty('If-None-Match');
  });

  it('a mesma versão de volta conta como nada mudou', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta(200, catalogoDeExemplo({ versao: 'v1' }))));
    await expect(baixarCatalogo(TOKEN, 'v1', '/api')).resolves.toEqual({ mudou: false });
  });

  it('recusa catálogo que não passa no schema', async () => {
    const truncado = { ...catalogoDeExemplo(), produtos: [{ id: 'x' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta(200, truncado)));

    const erro = await baixarCatalogo(TOKEN, null, '/api').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDaApi);
    expect((erro as ErroDaApi).codigo).toBe('catalogo_invalido');
  });

  it('reconhece a falta de rede e o aparelho revogado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(ehSemRede(await baixarCatalogo(TOKEN, null, '/api').catch((e: unknown) => e))).toBe(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta(401, { message: 'Este totem precisa ser ativado de novo.' })));
    expect(ehTotemDesativado(await baixarCatalogo(TOKEN, null, '/api').catch((e: unknown) => e))).toBe(true);
  });

  it('traduz cada falha numa frase para a manutenção', () => {
    expect(mensagemDaFalhaDeSincronia(new ErroDaApi('x', 0, 'sem_rede'))).toMatch(/catálogo guardado/);
    expect(mensagemDaFalhaDeSincronia(new ErroDaApi('x', 404))).toMatch(/desativada/);
    expect(mensagemDaFalhaDeSincronia(new ErroDaApi('x', 429))).toMatch(/Muitas sincronizações/);
    expect(mensagemDaFalhaDeSincronia(new Error('x'))).toMatch(/Não foi possível sincronizar/);
  });
});

describe('catálogo guardado', () => {
  it('lê o que foi guardado e descarta o que não passa no schema', async () => {
    const armazem = armazemNaMemoria();
    const catalogo = catalogoDeExemplo();
    await guardarCatalogo(armazem, { catalogo, sincronizadoEm: '2026-10-11T12:00:00.000Z' });
    await expect(lerCatalogoGuardado(armazem)).resolves.toEqual({ catalogo, sincronizadoEm: '2026-10-11T12:00:00.000Z' });

    await armazem.gravar('totem.catalogo', { catalogo: { versao: 'v1' }, sincronizadoEm: 'ontem' });
    await expect(lerCatalogoGuardado(armazem)).resolves.toBeNull();
  });
});

describe('registro do aparelho', () => {
  const aparelho: AparelhoAtivado = {
    token: TOKEN,
    dispositivo: { id: 'aparelho-1', nome: 'Totem da entrada' },
    loja: { id: 'loja-1', nome: 'Loja Centro' },
    ativadoEm: '2026-10-11T12:00:00.000Z',
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('grava nos dois lugares e apaga dos dois', async () => {
    const armazem = armazemNaMemoria();
    await gravarAparelho(armazem, aparelho);
    expect(JSON.parse(localStorage.getItem('totem.aparelho')!)).toEqual(aparelho);
    await expect(armazem.ler('totem.aparelho')).resolves.toEqual(aparelho);

    await esquecerAparelho(armazem);
    expect(localStorage.getItem('totem.aparelho')).toBeNull();
    await expect(lerAparelho(armazem)).resolves.toBeNull();
  });

  it('restaura o localStorage a partir do IndexedDB, e o contrário', async () => {
    const soNoBanco = armazemNaMemoria();
    await soNoBanco.gravar('totem.aparelho', aparelho);
    await expect(lerAparelho(soNoBanco)).resolves.toEqual(aparelho);
    expect(JSON.parse(localStorage.getItem('totem.aparelho')!)).toEqual(aparelho);

    const vazio = armazemNaMemoria();
    await expect(lerAparelho(vazio)).resolves.toEqual(aparelho);
    await expect(vazio.ler('totem.aparelho')).resolves.toEqual(aparelho);
  });

  it('ignora registro com token fora do formato', async () => {
    localStorage.setItem('totem.aparelho', JSON.stringify({ ...aparelho, token: 'curto' }));
    await expect(lerAparelho(armazemNaMemoria())).resolves.toBeNull();
  });

  it('sem IndexedDB, o armazém do aparelho segura na memória', async () => {
    const armazem = armazemDoAparelho(undefined);
    await armazem.gravar('chave', { a: 1 });
    await expect(armazem.ler('chave')).resolves.toEqual({ a: 1 });
    await armazem.apagar('chave');
    await expect(armazem.ler('chave')).resolves.toBeUndefined();
  });
});
