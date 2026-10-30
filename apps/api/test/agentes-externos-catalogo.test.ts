import { describe, expect, it, vi } from 'vitest';

import { CatalogoExternoService } from '../src/agentes-externos/catalogo-externo.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { funcaoPorSlug } from '@mktos/shared';
import { POLITICA } from './porta-dublada';

/*
 * A3 (30/10/2026): o catálogo de onde o MCP do modo catálogo gera as ferramentas,
 * e a definição (missão, procedimento, voz). O lado do MCP (stdio de verdade) é
 * provado em `packages/mcp/test/catalogo.mjs`.
 */

const ORG = 'org-1';

function montar(capacidades: readonly string[], comEfeito: string[], vozNaMemoria: string | null = null) {
  const efeitos = new EfeitosRegistry();
  efeitos.registrar(Object.fromEntries(comEfeito.map((id) => [id, async () => null])), 'teste');
  const prisma = {
    agent: { findFirst: async () => ({ id: 'ag-1', slug: 'rootinha', nome: 'Rootinha', missao: 'operar', estado: 'ativo', autonomiaAte: 'R2', capacidades: [...capacidades] }) },
    sop: { findFirst: async () => ({ proposito: 'p', gatilho: 'g', passos: ['a'], definicaoDePronto: 'd', observacoes: null, versao: 1 }) },
  };
  const politica = { resolverCapacidade: (_o: string, id: string) => POLITICA.capacidades.find((c) => c.id === id) ?? null };
  const memoria = { porChave: vi.fn(async () => (vozNaMemoria ? { body: vozNaMemoria } : null)) };
  return new CatalogoExternoService(prisma as never, politica as never, efeitos, memoria as never);
}

describe('A3: o catálogo do agente externo', () => {
  it('uma ferramenta por capacidade declarada: R0 com GET é leitura, o resto é execução pela rota A2', async () => {
    const c = await montar(['numeros.painel.ler', 'crm.lead.ler', 'operacao.tarefa.criar', 'whatsapp.conversa.responder'], ['operacao.tarefa.criar', 'whatsapp.conversa.responder']).catalogo(ORG, 'rootinha');
    const por = Object.fromEntries(c.ferramentas.map((f) => [f.id, f]));
    expect(por['numeros.painel.ler']).toMatchObject({ caminho: 'leitura', rota: 'GET /dashboard/summary', nivel: 'R0' });
    expect(por['crm.lead.ler']).toMatchObject({ caminho: 'leitura', rota: 'GET /leads/:id' });
    expect(por['operacao.tarefa.criar']).toMatchObject({ caminho: 'execucao', rota: 'POST /agents/rootinha/capacidades/operacao.tarefa.criar/executar', nivel: 'R1' });
    expect(por['operacao.tarefa.criar'].argsSchema).toMatchObject({ required: ['titulo'], additionalProperties: false });
    expect(por['whatsapp.conversa.responder'].nivel).toBe('R3');
  });

  it('escrita declarada sem efeito ligado fica fora do MCP, listada em semEfeito', async () => {
    const c = await montar(['email.rascunhar', 'operacao.tarefa.alterar', 'briefing.ler'], []).catalogo(ORG, 'rootinha');
    expect(c.ferramentas.map((f) => f.id)).toEqual(['briefing.ler']);
    expect(c.semEfeito.sort()).toEqual(['email.rascunhar', 'operacao.tarefa.alterar']);
  });

  it('a declaração inteira da Rootinha vira catálogo sem capacidade desconhecida', async () => {
    const f = funcaoPorSlug('rootinha')!;
    const c = await montar(f.capacidades, []).catalogo(ORG, 'rootinha');
    expect(c.ferramentas.length + c.semEfeito.length).toBe(f.capacidades.length);
  });

  it('a definição traz missão, procedimento e a voz: a da memória vence a de nascimento', async () => {
    const padrao = await montar([], []).definicao(ORG, 'rootinha', 'u-1');
    expect(padrao).toMatchObject({ missao: 'operar', procedimento: { proposito: 'p' }, voz: { fonte: 'cadastro', chave: 'voz.rootinha' } });
    expect(padrao.voz.texto).toBeTruthy();
    const afinada = await montar([], [], 'Fala curto.').definicao(ORG, 'rootinha', 'u-1');
    expect(afinada.voz).toEqual({ fonte: 'memoria', chave: 'voz.rootinha', texto: 'Fala curto.' });
  });
});
