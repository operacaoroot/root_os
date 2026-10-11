/**
 * A FILA DE EVENTOS DO QUIOSQUE — o que entra, o que sobe e o que fica.
 *
 * CPF ou telefone digitado na busca não pode nem ficar gravado no aparelho. O
 * que entra sobe em lotes de 200; sem rede, nada se perde; lote que a API
 * recusa por formato (400) é descartado para não travar a fila; e um 401 sobe
 * para quem chamou, que desativa o aparelho.
 */
import { describe, expect, it, vi } from 'vitest';
import { TOTEM_EVENTOS_POR_LOTE, type TotemEventoQuiosque } from '@mktos/shared';

import { ErroDaApi } from '@/lib/api';
import { CODIGO_SEM_REDE, ehTotemDesativado } from '@/lib/totem/api-publica';
import { armazemNaMemoria } from '@/components/totem/quiosque/armazem';
import { criarFila, novoEvento, TOTEM_FILA_MAXIMA } from '@/components/totem/quiosque/fila';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUTO = '00000000-0000-4000-8000-000000000001';

function eventoGuardado(n: number): TotemEventoQuiosque {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    tipo: 'busca',
    produtoId: null,
    termo: `termo ${n}`,
    ocorridoEm: '2026-10-11T12:00:00.000Z',
  };
}

async function filaCom(quantos: number) {
  const armazem = armazemNaMemoria();
  await armazem.gravar(
    'totem.fila',
    Array.from({ length: quantos }, (_, i) => eventoGuardado(i + 1)),
  );
  const fila = criarFila(armazem);
  await fila.carregar();
  return { armazem, fila };
}

describe('novoEvento', () => {
  it('monta o evento com id do aparelho e a hora em ISO', () => {
    const ev = novoEvento('ver_produto', { produtoId: PRODUTO }, new Date('2026-10-11T15:30:00.000Z'));
    expect(ev).toMatchObject({ tipo: 'ver_produto', produtoId: PRODUTO, termo: null, ocorridoEm: '2026-10-11T15:30:00.000Z' });
    expect(ev?.id).toMatch(UUID);
  });

  it('descarta termo com cara de CPF ou telefone, e guarda o resto do evento', () => {
    expect(novoEvento('busca', { termo: '123.456.789-09' })?.termo).toBeNull();
    expect(novoEvento('busca', { termo: '12345678909' })?.termo).toBeNull();
    expect(novoEvento('busca', { termo: '(27) 99876-5432' })?.termo).toBeNull();
    expect(novoEvento('busca_sem_resultado', { termo: '9876-5432' })?.termo).toBeNull();
    expect(novoEvento('busca', { termo: '  castanha   do  pará ' })?.termo).toBe('castanha do pará');
  });

  it('recusa tipo desconhecido, produto que não é UUID e id inválido', () => {
    expect(novoEvento('clicou' as never)).toBeNull();
    expect(novoEvento('ver_produto', { produtoId: 'abc' })).toBeNull();
    expect(novoEvento('busca', { termo: 'granola' }, new Date(), () => 'nao-e-uuid')).toBeNull();
  });
});

describe('criarFila', () => {
  it('registra no aparelho e sobe em lotes de 200', async () => {
    const { armazem, fila } = await filaCom(450);
    const enviar = vi.fn().mockResolvedValue(undefined);

    await expect(fila.descarregar(enviar)).resolves.toBe(450);

    expect(enviar.mock.calls.map(([lote]) => lote.length)).toEqual([TOTEM_EVENTOS_POR_LOTE, TOTEM_EVENTOS_POR_LOTE, 50]);
    expect(fila.tamanho()).toBe(0);
    await expect(armazem.ler('totem.fila')).resolves.toEqual([]);
  });

  it('sem rede, para no primeiro lote e não perde nada', async () => {
    const { armazem, fila } = await filaCom(250);
    const enviar = vi.fn().mockRejectedValue(new ErroDaApi('Sem conexão com a internet.', 0, CODIGO_SEM_REDE));

    await expect(fila.descarregar(enviar)).resolves.toBe(0);

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(fila.tamanho()).toBe(250);
    await expect(armazem.ler<unknown[]>('totem.fila')).resolves.toHaveLength(250);
  });

  it('com teto estourado (429) ou erro da API (500), guarda o lote para depois', async () => {
    for (const status of [429, 500]) {
      const { fila } = await filaCom(10);
      const enviar = vi.fn().mockRejectedValue(new ErroDaApi('falhou', status));
      await fila.descarregar(enviar);
      expect(fila.tamanho()).toBe(10);
    }
  });

  it('descarta o lote que a API recusa por formato (400) e segue com os outros', async () => {
    const { fila } = await filaCom(300);
    const enviar = vi
      .fn()
      .mockRejectedValueOnce(new ErroDaApi('inválido', 400))
      .mockResolvedValueOnce(undefined);

    await expect(fila.descarregar(enviar)).resolves.toBe(100);

    expect(enviar).toHaveBeenCalledTimes(2);
    expect(fila.tamanho()).toBe(0);
  });

  it('um 401 sobe para quem chamou e os eventos ficam', async () => {
    const { fila } = await filaCom(5);
    const enviar = vi.fn().mockRejectedValue(new ErroDaApi('Este totem precisa ser ativado de novo.', 401));

    const erro = await fila.descarregar(enviar).catch((e: unknown) => e);

    expect(ehTotemDesativado(erro)).toBe(true);
    expect(fila.tamanho()).toBe(5);
  });

  it('duas descargas ao mesmo tempo mandam cada lote uma vez só', async () => {
    const { fila } = await filaCom(30);
    const enviar = vi.fn().mockResolvedValue(undefined);

    const [a, b] = await Promise.all([fila.descarregar(enviar), fila.descarregar(enviar)]);

    expect(a).toBe(30);
    expect(b).toBe(30);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it(`guarda no máximo ${TOTEM_FILA_MAXIMA} eventos, perdendo os mais antigos`, async () => {
    const { fila } = await filaCom(TOTEM_FILA_MAXIMA + 10);
    const enviar = vi.fn().mockResolvedValue(undefined);

    expect(fila.tamanho()).toBe(TOTEM_FILA_MAXIMA);
    await fila.descarregar(enviar);
    expect(enviar.mock.calls[0]![0][0].id).toBe(eventoGuardado(11).id);
  });

  it('não duplica evento lido duas vezes e ignora o que estiver estragado no aparelho', async () => {
    const armazem = armazemNaMemoria();
    await armazem.gravar('totem.fila', [eventoGuardado(1), eventoGuardado(1), { id: 'x', tipo: 'busca' }, 'lixo']);
    const fila = criarFila(armazem);

    await fila.carregar();
    await fila.carregar();

    expect(fila.tamanho()).toBe(1);
  });

  it('registrar aplica a mesma limpeza e grava no aparelho', async () => {
    const armazem = armazemNaMemoria();
    const fila = criarFila(armazem);

    await fila.registrar('busca', { termo: '123.456.789-09' });
    await fila.registrar('ver_produto', { produtoId: 'não é uuid' });

    const guardados = await armazem.ler<TotemEventoQuiosque[]>('totem.fila');
    expect(guardados).toHaveLength(1);
    expect(guardados![0]).toMatchObject({ tipo: 'busca', termo: null });
  });

  it('limpar esvazia a fila e o aparelho', async () => {
    const { armazem, fila } = await filaCom(3);
    await fila.limpar();
    expect(fila.tamanho()).toBe(0);
    await expect(armazem.ler('totem.fila')).resolves.toBeUndefined();
  });
});
