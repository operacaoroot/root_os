import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ContextBuilder } from '../src/agents/context-builder.service';
import type { MemoriaService } from '../src/memory/memoria.service';
import { comContexto, comTenantResolvido } from '../src/common/contexto-execucao';

describe('ContextBuilder: fronteira de memória do agente', () => {
  it('sem grant declara consentimento ausente e não tem caminho Obsidian/vault', async () => {
    const buscar = vi.fn(async () => ({
      query: 'segredo',
      modo: 'textual' as const,
      diagnostico: 'sem_consentimento' as const,
      itens: [],
      fonte: { tool: 'memoria' as const, generatedAt: new Date().toISOString() },
    }));
    const builder = new ContextBuilder({ buscarParaAgente: buscar } as unknown as MemoriaService);
    const resultado = await builder.montar(
      '00000000-0000-4000-8000-000000000001',
      'segredo',
      { contextoFixo: [], slug: 'agente' } as never,
    );
    expect(buscar).toHaveBeenCalledOnce();
    expect(resultado.ausencia?.motivo).toBe('sem_consentimento');
    expect(resultado.blocos).toContain('nenhuma fonte/campo desta empresa foi consentida');

    const fonte = readFileSync(join(process.cwd(), 'src/agents/context-builder.service.ts'), 'utf8');
    expect(fonte).not.toContain("from '../obsidian/obsidian.service'");
    expect(fonte).not.toMatch(/this\.obsidian|obsidian\.search/);
  });

  it('não transforma sentinela nem contexto de A em outro tenant', async () => {
    await expect(comTenantResolvido('__plataforma__', async () => true)).rejects.toThrow('sentinela');
    await comContexto({ orgId: 'org-A', correlationId: 'teste' }, async () => {
      await expect(comTenantResolvido('org-B', async () => true)).rejects.toThrow('diverge');
    });
  });
});
