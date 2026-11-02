import { describe, expect, it } from 'vitest';

import fluxoDoCliente from '../src/platform/fluxo-do-cliente.json';
import {
  MARCA_DO_MOTIVO,
  PREFIXO_DA_CHAVE,
  motivoDaCarga,
  notasDoFluxo,
  procedenciaDaCarga,
  situacaoDaNota,
  tarefasDoFluxo,
  type FluxoDoCliente,
} from '../src/platform/fluxo-do-cliente-na-memoria';

/*
 * O FLUXO DO CLIENTE NA MEMÓRIA SEM BANCO (P-87, 02/11/2026).
 *
 *  1. o arquivo vira dez notas, com chaves estáveis e na ordem da tela;
 *  2. cada tarefa do fluxo aparece na nota da sua fase, com dono e "feito quando";
 *  3. a nota de desvios tem uma linha por desvio do arquivo;
 *  4. a situação de cada nota diante do arquivo, nos cinco casos;
 *  5. o motivo da carga começa com a marca que a reconhece.
 */

const FLUXO = fluxoDoCliente as FluxoDoCliente;
const notas = notasDoFluxo(FLUXO);

describe('as notas do fluxo', () => {
  it('são dez, com chaves estáveis', () => {
    expect(notas.map((n) => n.chave)).toEqual([
      `${PREFIXO_DA_CHAVE}abertura`,
      ...FLUXO.fases.map((f) => `${PREFIXO_DA_CHAVE}${f.id}`),
      `${PREFIXO_DA_CHAVE}desvios`,
      `${PREFIXO_DA_CHAVE}area-do-cliente`,
    ]);
    expect(notas).toHaveLength(10);
    expect(new Set(notas.map((n) => n.chave)).size).toBe(10);
  });

  it('gerar duas vezes dá o mesmo texto (senão toda leitura acusaria "versão antiga")', () => {
    expect(notasDoFluxo(FLUXO)).toEqual(notas);
  });

  it('cada tarefa de 01 a 56 aparece uma vez, na nota da sua fase, com dono e "feito quando"', () => {
    const tarefas = tarefasDoFluxo(FLUXO);
    expect(tarefas).toHaveLength(FLUXO.total_tarefas);
    expect(tarefas.map((t) => Number(t.numero)).sort((a, b) => a - b)).toEqual(Array.from({ length: 56 }, (_, i) => i + 1));
    const fases = notas.filter((n) => /:fase-\d+$/.test(n.chave));
    for (const t of tarefas) {
      const linha = `**${t.numero} · ${t.titulo}** (${t.responsavel}). Feito quando: ${t.feito_quando}`;
      expect(fases.filter((n) => n.corpo.includes(linha)), `tarefa ${t.numero}`).toHaveLength(1);
    }
  });

  it('a abertura diz as fases e o total', () => {
    const abertura = notas[0];
    expect(abertura.corpo).toContain(`São ${FLUXO.total_tarefas} tarefas em ${FLUXO.fases.length} fases`);
    for (const f of FLUXO.fases) expect(abertura.corpo).toContain(f.nome);
    // A 42 corre em paralelo à 37 e vem antes da 39 no arquivo: a faixa é por número, não pela ordem.
    expect(abertura.corpo).toContain('Fase 5 · Acompanhamento, a cada 15 dias: tarefas 37 a 42');
  });

  it('os desvios têm uma linha por desvio, com a pergunta e a resposta', () => {
    const desvios = notas.find((n) => n.chave === `${PREFIXO_DA_CHAVE}desvios`)!;
    const linhas = desvios.corpo.split('\n').filter((l) => l.startsWith('- '));
    expect(linhas).toHaveLength(FLUXO.desvios.length);
    expect(linhas[0]).toBe('- Assinou e pagou? → não: 03 · Cobrar o fechamento, depois volta a 02 · Mandar o link de fechamento');
  });

  it('a área do cliente tem um item por linha, com a tarefa que o alimenta', () => {
    const area = notas.find((n) => n.chave === `${PREFIXO_DA_CHAVE}area-do-cliente`)!;
    expect(area.corpo.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(FLUXO.area_do_cliente!.length);
    expect(area.corpo).toContain('- Cronograma (tarefa 09 · Definir o cronograma do cliente)');
  });
});

describe('a nota diante do arquivo', () => {
  const gerada = notas[1];
  const igual = { title: gerada.titulo, body: gerada.corpo, arquivadoEm: null };

  it('sem nota na Memória: falta', () => {
    expect(situacaoDaNota(gerada, null)).toBe('falta');
  });
  it('igual ao arquivo: em dia', () => {
    expect(situacaoDaNota(gerada, igual)).toBe('em_dia');
  });
  it('diferente, e a última versão é da carga: versão antiga, o botão regrava', () => {
    expect(situacaoDaNota(gerada, { ...igual, body: 'texto da v5' }, motivoDaCarga(FLUXO))).toBe('desatualizada');
  });
  it('diferente, e a última versão é de outra pessoa: editada, fica como está', () => {
    expect(situacaoDaNota(gerada, { ...igual, body: 'corrigido à mão' }, 'acertei o prazo')).toBe('editada');
    expect(situacaoDaNota(gerada, { ...igual, body: 'corrigido à mão' }, null)).toBe('editada');
  });
  it('arquivada: fica como está, mesmo igual ao arquivo', () => {
    expect(situacaoDaNota(gerada, { ...igual, arquivadoEm: '2026-11-02T20:00:00.000Z' })).toBe('arquivada');
  });
});

describe('o rastro da carga', () => {
  it('o motivo começa com a marca e diz a versão; a procedência diz o arquivo', () => {
    expect(motivoDaCarga(FLUXO).startsWith(MARCA_DO_MOTIVO)).toBe(true);
    expect(motivoDaCarga(FLUXO)).toBe('Fluxo do cliente v6, levado pela tela Contexto › Fluxo do cliente');
    expect(procedenciaDaCarga(FLUXO)).toBe('fluxo-do-cliente.json v6 (2026-10-30)');
  });
});
