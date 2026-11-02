import { describe, expect, it, vi } from 'vitest';

import { feriadoNacional, feriadosNacionais, pascoa } from '../src/work/agente-de-tarefas/resumo-do-grupo';
import { ResumoDoGrupoService } from '../src/work/agente-de-tarefas/resumo-do-grupo.service';

describe('feriados nacionais', () => {
  it('Páscoa e Sexta-feira da Paixão batem com o calendário oficial', () => {
    expect(pascoa(2025)).toBe('2025-04-20');
    expect(pascoa(2026)).toBe('2026-04-05');
    expect(pascoa(2027)).toBe('2027-03-28');
    expect(pascoa(2028)).toBe('2028-04-16');
    expect(feriadoNacional('2026-04-03')).toBe('Sexta-feira da Paixão');
    expect(feriadoNacional('2027-03-26')).toBe('Sexta-feira da Paixão');
  });

  it('os dez de lei, e Carnaval e Corpus Christi ficam de fora', () => {
    expect(feriadosNacionais(2026).size).toBe(10);
    expect(feriadoNacional('2026-11-02')).toBe('Finados');
    expect(feriadoNacional('2026-11-20')).toBe('Dia da Consciência Negra');
    expect(feriadoNacional('2026-12-25')).toBe('Natal');
    expect(feriadoNacional('2026-02-17')).toBeNull(); // Carnaval 2026
    expect(feriadoNacional('2026-06-04')).toBeNull(); // Corpus Christi 2026
    expect(feriadoNacional('2026-11-03')).toBeNull();
  });
});

describe('resumo do grupo: feriado, tentativas e falha', () => {
  const PAINEL = { hoje: '2026-11-03', areas: [], pessoas: [{ id: 'l', nome: 'Lucas Fernandes' }], clientes: [], resumo: [], tarefas: [] };

  function montar(hoje: string, envio: { falarNoGrupoDoAgente: ReturnType<typeof vi.fn> }) {
    process.env.AGENTE_TAREFAS_JID = '120363407836726219@g.us';
    const prisma = {
      agent: { findFirst: vi.fn().mockResolvedValue({ estado: 'ativo' }) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      whatsAppMensagem: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const tarefas = { painel: vi.fn().mockResolvedValue({ ...PAINEL, hoje }) };
    const s = new ResumoDoGrupoService(prisma as never, tarefas as never, undefined, envio as never);
    s.esperar = vi.fn().mockResolvedValue(undefined);
    return s;
  }

  it('feriado nacional não manda nada', async () => {
    const envio = { falarNoGrupoDoAgente: vi.fn() };
    const r = await montar('2026-11-02', envio).passagem({ orgId: 'o', agora: new Date('2026-11-02T21:00:00Z') });
    expect(r).toMatchObject({ status: 'pulada' });
    expect(envio.falarNoGrupoDoAgente).not.toHaveBeenCalled();
  });

  it('WhatsApp recusando volta a tentar e passa na terceira', async () => {
    const envio = { falarNoGrupoDoAgente: vi.fn().mockRejectedValueOnce(new Error('400')).mockRejectedValueOnce(new Error('400')).mockResolvedValue({ id: 'x' }) };
    const r = await montar('2026-11-03', envio).passagem({ orgId: 'o', agora: new Date('2026-11-03T10:00:00Z') });
    expect(r.status).toBe('ok');
    expect(r.resumo).toContain('3ª tentativa');
    expect(envio.falarNoGrupoDoAgente).toHaveBeenCalledTimes(3);
  });

  it('quatro recusas viram FALHA da rotina (lança), não "ok"', async () => {
    const envio = { falarNoGrupoDoAgente: vi.fn().mockRejectedValue(new Error('Connection Closed')) };
    await expect(montar('2026-11-03', envio).passagem({ orgId: 'o', agora: new Date('2026-11-03T10:00:00Z') })).rejects.toThrow(/4 vezes/);
    expect(envio.falarNoGrupoDoAgente).toHaveBeenCalledTimes(4);
  });
});
