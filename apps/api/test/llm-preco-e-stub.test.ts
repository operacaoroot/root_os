import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { estimarCustoUsd } from '../src/llm/estimativa';
import { PRECO_BUSCA_NA_WEB_USD, PRECO_USD_MTOK, custoUsd, precoDe } from '../src/llm/preco';
import { StubProvider, StubSemRespostaError, carregarRespostasDoStub, responderPeloStub } from '../src/llm/stub.provider';

/*
 * OS PREÇOS 5.5 E O STUB PELA FUNÇÃO (rodada dos agentes, 21/10/2026, A1).
 */

describe('a tabela de preço dos modelos 5.5', () => {
  it('Opus 5.5 e Sonnet 5.5 pela tabela da Anthropic', () => {
    expect(precoDe('claude-opus-5-5')).toEqual({ entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 });
    expect(precoDe('claude-sonnet-5-5')).toEqual({ entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 });
    // Um milhão de cada lado no Opus 5.5: 4 + 20.
    expect(custoUsd('claude-opus-5-5', { entrada: 1_000_000, saida: 1_000_000 })).toEqual({ custoUsd: 24, custoEstimado: true });
  });

  it('o Opus 5.5 não casa com o Opus 5 por prefixo, e a data no nome casa com a entrada certa', () => {
    expect(precoDe('claude-opus-5-5')).not.toBe(PRECO_USD_MTOK['claude-opus-5']);
    expect(precoDe('claude-opus-5-5-20261001')).toBe(PRECO_USD_MTOK['claude-opus-5-5']);
    expect(precoDe('claude-opus-5')).toBe(PRECO_USD_MTOK['claude-opus-5']);
  });

  it('Haiku 5.5 na faixa de até 100 mil tokens de entrada: 0,10/0,50, cache 0,01/0,125', () => {
    expect(precoDe('claude-haiku-5-5', 100_000)).toMatchObject({ entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheEscrita: 0.125 });
    // 100 mil de entrada (exatamente o corte) e 1000 de saída.
    expect(custoUsd('claude-haiku-5-5', { entrada: 100_000, saida: 1_000 })).toEqual({ custoUsd: 0.0105, custoEstimado: true });
  });

  it('Haiku 5.5 acima de 100 mil tokens: 0,50/2,50, cache 0,05/0,625, contando o cache no tamanho do pedido', () => {
    expect(precoDe('claude-haiku-5-5', 100_001)).toEqual({ entrada: 0.5, saida: 2.5, cacheLeitura: 0.05, cacheEscrita: 0.625 });
    expect(custoUsd('claude-haiku-5-5', { entrada: 200_000, saida: 1_000 })).toEqual({ custoUsd: 0.1025, custoEstimado: true });
    // 60 mil sem cache + 60 mil lidos do cache = pedido de 120 mil: faixa longa nos dois.
    expect(custoUsd('claude-haiku-5-5', { entrada: 60_000, saida: 0, cacheLeitura: 60_000 })).toEqual({
      custoUsd: Number(((60_000 * 0.5 + 60_000 * 0.05) / 1e6).toFixed(6)),
      custoEstimado: true,
    });
  });

  it('a reserva do teto (estimativa) também escolhe a faixa pelo tamanho do pedido', () => {
    const curta = estimarCustoUsd('claude-haiku-5-5', { entrada: { texto: 30_000, estruturado: 0, foraDoAscii: 0 }, tokensSaida: 0 });
    const longa = estimarCustoUsd('claude-haiku-5-5', { entrada: { texto: 600_000, estruturado: 0, foraDoAscii: 0 }, tokensSaida: 0 });
    expect(curta.usd).toBeCloseTo((10_000 * 0.1) / 1e6, 6);
    expect(longa.usd).toBeCloseTo((200_000 * 0.5) / 1e6, 6);
  });

  it('embedding e transcrição têm preço de fonte, e a busca na web custa um centavo', () => {
    expect(precoDe('text-embedding-3-small')).toMatchObject({ entrada: 0.02, saida: 0 });
    expect(custoUsd('text-embedding-3-small', { entrada: 2_000_000, saida: 0 }).custoUsd).toBe(0.04);
    expect(precoDe('gpt-4o-transcribe')).toMatchObject({ entrada: 2.5, saida: 10 });
    expect(PRECO_BUSCA_NA_WEB_USD).toBe(0.01);
  });
});

describe('os 5.5 no OpenRouter (29/10/2026)', () => {
  it('Opus, Sonnet e Haiku 5.5 têm preço com o nome do OpenRouter', () => {
    expect(precoDe('anthropic/claude-opus-5.5')).toEqual({ entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 });
    expect(precoDe('anthropic/claude-sonnet-5.5')).toEqual({ entrada: 2, saida: 10, cacheLeitura: 0.1, cacheEscrita: 2.5 });
    expect(precoDe('anthropic/claude-haiku-5.5', 100_000)).toMatchObject({ entrada: 0.1, saida: 0.5 });
    expect(precoDe('anthropic/claude-haiku-5.5', 100_001)).toEqual({ entrada: 0.5, saida: 2.5, cacheLeitura: 0.05, cacheEscrita: 0.625 });
  });

  it('o Sonnet 4.5 cobra a faixa longa acima de 200 mil tokens', () => {
    expect(precoDe('anthropic/claude-sonnet-4.5', 200_000)).toMatchObject({ entrada: 3, saida: 15 });
    expect(precoDe('anthropic/claude-sonnet-4.5', 200_001)).toEqual({ entrada: 6, saida: 22.5, cacheLeitura: 0.6, cacheEscrita: 7.5 });
  });
});

describe('o stub aceita a função como marca', () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'stub-funcao-'));
  writeFileSync(path.join(pasta, 'CO-11.json'), JSON.stringify({ padrao: 'resumo do vigia' }));
  writeFileSync(path.join(pasta, 'arquivista.json'), JSON.stringify({ funcao: 'TR-05', respostas: [{ quando: ['contrato'], texto: '02-contrato' }], padrao: '_fonte' }));
  writeFileSync(path.join(pasta, 'tarefa.json'), JSON.stringify({ tarefa: 'comercial.x', padrao: 'pela tarefa' }));
  afterAll(() => rmSync(pasta, { recursive: true, force: true }));

  const respostas = carregarRespostasDoStub(pasta);

  it('pelo nome do arquivo (CO-11.json) e pelo campo "funcao"', () => {
    expect(responderPeloStub(respostas, { system: 'sem marca', user: 'x', funcao: 'CO-11' })).toBe('resumo do vigia');
    expect(responderPeloStub(respostas, { system: 'sem marca', user: 'o contrato assinado', funcao: 'TR-05' })).toBe('02-contrato');
    expect(responderPeloStub(respostas, { system: 'sem marca', user: 'outra coisa', funcao: 'tr-05' })).toBe('_fonte');
  });

  it('a tarefa marcada vem primeiro; sem fixture dela, vale a da função', () => {
    expect(responderPeloStub(respostas, { system: '[tarefa:comercial.x]', user: 'x', funcao: 'CO-11' })).toBe('pela tarefa');
    expect(responderPeloStub(respostas, { system: '[tarefa:outra]', user: 'x', funcao: 'CO-11' })).toBe('resumo do vigia');
  });

  it('sem marca nem função, ou com marca sem fixture, continua lançando', () => {
    expect(() => responderPeloStub(respostas, { system: 'nada', user: 'x' })).toThrow(StubSemRespostaError);
    expect(() => responderPeloStub(respostas, { system: 'nada', user: 'x', funcao: 'AG-01' })).toThrow(/AG-01/);
    expect(() => responderPeloStub(respostas, { system: '[tarefa:nenhuma]', user: 'x' })).toThrow(/nenhuma/);
  });

  it('arquivo sem tarefa nem função é recusado na leitura', () => {
    const outra = mkdtempSync(path.join(tmpdir(), 'stub-ruim-'));
    writeFileSync(path.join(outra, 'qualquer.json'), JSON.stringify({ padrao: 'x' }));
    expect(() => carregarRespostasDoStub(outra)).toThrow(/qualquer\.json/);
    rmSync(outra, { recursive: true, force: true });
  });

  it('o provider stub passa a função no complete e no step', async () => {
    const stub = new StubProvider(pasta);
    expect(await stub.complete({ system: 's', user: 'u', funcao: 'CO-11' })).toBe('resumo do vigia');
    const passo = await stub.step({ system: 's', turns: [{ role: 'user', text: 'o contrato' }], funcao: 'TR-05' });
    expect(passo.text).toBe('02-contrato');
  });

  it('as fixtures versionadas do repositório continuam carregando', () => {
    const raiz = path.resolve(__dirname, '../../../homolog/fixtures/stub');
    expect(carregarRespostasDoStub(raiz).size).toBeGreaterThan(0);
  });
});
