import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CADASTRO_DE_FUNCOES, funcoesDaSemente, funcoesDoTipo } from '@mktos/shared';

import {
  COMPLEMENTOS_DOS_AGENTES,
  ROSTER_DE_ENTRADA,
  agenteDaFuncao,
  capacidadesDaEmpresa,
} from '../src/agents/roster';
import { paginaDoCadastro } from '../src/agents/roster/documentacao-do-cadastro';

/*
 * OS SEEDS E A DOCUMENTAÇÃO LEEM DO CADASTRO ÚNICO (rodada dos agentes, 21/10/2026, A1).
 * Sem banco: a parte com banco está em `agentes-fundacao-banco.test.ts`.
 */

const API = path.resolve(__dirname, '..');

describe('os seeds leem do cadastro', () => {
  it('toda função semeada tem complemento (iniciais, pilar, autonomia), e nada sobra no complemento', () => {
    const semeadas = new Set(
      (['entrada', 'onboarding', 'tripulacao'] as const).flatMap((s) => funcoesDaSemente(s).map((f) => f.slug)),
    );
    expect(Object.keys(COMPLEMENTOS_DOS_AGENTES).sort()).toEqual([...semeadas].sort());
    for (const slug of semeadas) {
      const f = CADASTRO_DE_FUNCOES.find((x) => x.slug === slug)!;
      const a = agenteDaFuncao(f);
      expect(a.missao).toBe(f.paraQueServe);
      expect(a.tipo).toBe(f.tipo === 'agente' ? 'llm' : 'conector');
      // Agente que decide com modelo precisa de procedimento; rotina não.
      if (f.tipo === 'agente') expect(a.sop, slug).toBeTruthy();
    }
  });

  it('o assistente é UMA definição: a mesma na entrada e na tripulação', () => {
    const naEntrada = funcoesDaSemente('entrada').find((f) => f.slug === 'assistente');
    const naTripulacao = funcoesDaSemente('tripulacao').find((f) => f.slug === 'assistente');
    expect(naEntrada).toBe(naTripulacao);
    expect(agenteDaFuncao(naEntrada!)).toEqual(agenteDaFuncao(naTripulacao!));
    expect(ROSTER_DE_ENTRADA.find((a) => a.slug === 'assistente')?.sop).toEqual(COMPLEMENTOS_DOS_AGENTES.assistente.sop);
  });

  it('o seed da tripulação não tem lista própria: lê funcoesDaSemente("tripulacao")', () => {
    const texto = readFileSync(path.join(API, 'prisma/seed-tripulacao.ts'), 'utf8');
    expect(texto).toMatch(/funcoesDaSemente\(\s*'tripulacao'\s*\)/);
    expect(texto).not.toMatch(/slug:\s*'[a-z0-9-]+'/);
    expect(texto).not.toMatch(/whatsapp\.mensagem\.enviar|financeiro\.pagamento\.baixar/);
  });

  it('a rotina desligada no cadastro nasce pausada; a aposentada, encerrada', () => {
    const clickup = CADASTRO_DE_FUNCOES.find((f) => f.id === 'RO-01')!;
    expect(clickup.estado).toBe('desligado');
    expect(agenteDaFuncao(clickup).estado).toBe('pausado');
  });

  it('o filtro de módulo: sem módulo, só a espinha; o que não tem rota fica', () => {
    expect(capacidadesDaEmpresa(['contexto.memoria.buscar', 'financeiro.resumo.ler', 'crm.lead.buscar'], [])).toEqual([
      'contexto.memoria.buscar',
    ]);
    expect(capacidadesDaEmpresa(['financeiro.resumo.ler', 'crm.lead.buscar'], ['financeiro'])).toEqual(['financeiro.resumo.ler']);
    expect(capacidadesDaEmpresa(['capacidade.que.nao.existe'], [])).toEqual(['capacidade.que.nao.existe']);
  });

  it('o laço do agente passa a função do slug ao provedor', () => {
    const texto = readFileSync(path.join(API, 'src/agents/agent-runtime.service.ts'), 'utf8');
    expect(texto).toMatch(/funcaoPorSlug\(agent\.slug\)\?\.id/);
    expect(texto).toMatch(/funcao: funcaoDoAgente/);
  });
});

describe('a documentação gerada sai do cadastro, em três seções', () => {
  it('Agentes, Rotinas, Automações e integrações, com para que serve, estado, dono, modelo, gatilho e onde', () => {
    const p = paginaDoCadastro({});
    expect(p.nome).toBe('agentes-do-cadastro.md');
    const secoes = [...p.corpo.matchAll(/^## (.+) \((\d+)\)$/gm)].map((m) => [m[1], Number(m[2])]);
    expect(secoes).toEqual([
      ['Agentes', funcoesDoTipo('agente').length],
      ['Rotinas', funcoesDoTipo('rotina').length],
      ['Automações e integrações', funcoesDoTipo('automacao').length],
    ]);
    expect(p.corpo).toContain('### CO-11 · Vigia das 08h');
    expect(p.corpo).toMatch(/Modelo: claude-haiku-5-5 · esforço low · pelo cadastro/);
    expect(p.corpo).toContain('Para que serve:');
    expect(p.corpo).toContain('Dono padrão:');
    expect(p.corpo).toContain('Gatilho:');
    expect(p.corpo).toContain('Onde mexer:');
    expect(p.corpo).toContain('Rotina no histórico: `casa.clickup`');
  });

  it('o modelo mostrado é o efetivo: a variável por função aparece com a origem', () => {
    const p = paginaDoCadastro({ LLM_MODELO_CO_11: 'claude-sonnet-5-5' });
    expect(p.corpo).toMatch(/### CO-11[^#]*Modelo: claude-sonnet-5-5 · esforço low · por variável \(LLM_MODELO_CO_11/);
  });
});
