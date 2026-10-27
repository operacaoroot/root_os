import { describe, expect, it } from 'vitest';
import {
  MAQUINA_ESTEIRA,
  MaquinaEtapaSchema,
  MaquinaPostSalvarSchema,
  PROXIMO_PASSO,
  datasLivres,
  etapaPrecisaDeData,
  metaDoMes,
} from '@mktos/shared';

describe('Máquina de Conteúdo da empresa: regras da esteira', () => {
  it('a esteira segue a Máquina dos clientes, e o próximo passo anda uma coluna', () => {
    expect(MAQUINA_ESTEIRA).toEqual(['ideia', 'producao', 'a_agendar', 'agendado', 'publicado']);
    for (let i = 0; i < MAQUINA_ESTEIRA.length - 1; i++) {
      expect(PROXIMO_PASSO[MAQUINA_ESTEIRA[i]]?.para).toBe(MAQUINA_ESTEIRA[i + 1]);
    }
    expect(PROXIMO_PASSO.publicado).toBeUndefined();
  });

  it('agendado e postado exigem data; as outras etapas não', () => {
    expect(etapaPrecisaDeData('agendado')).toBe(true);
    expect(etapaPrecisaDeData('publicado')).toBe(true);
    expect(etapaPrecisaDeData('a_agendar')).toBe(false);
    expect(MaquinaEtapaSchema.safeParse({ etapa: 'agendado' }).success).toBe(false);
    expect(MaquinaEtapaSchema.safeParse({ etapa: 'agendado', data: '2026-10-21' }).success).toBe(true);
    expect(MaquinaEtapaSchema.safeParse({ etapa: 'producao' }).success).toBe(true);
  });

  it('post sem título não passa; o resto tem padrão', () => {
    expect(MaquinaPostSalvarSchema.safeParse({ titulo: ' ' }).success).toBe(false);
    const ok = MaquinaPostSalvarSchema.parse({ titulo: 'Post' });
    expect(ok).toMatchObject({ formato: 'Reel', tipoCard: 'video', prioridade: 'media', slides: [], fontes: [] });
  });

  it('datas livres caem nos dias da cadência e pulam dia já ocupado', () => {
    // 2026-10-19 é segunda; cadência terça (2) e quinta (4).
    const livres = datasLivres([{ etapa: 'agendado', data: '2026-10-20' }], [2, 4], '2026-10-19', 3);
    expect(livres).toEqual(['2026-10-22', '2026-10-27', '2026-10-29']);
  });

  it('a meta do mês conta os dias da cadência no mês', () => {
    // Outubro de 2026: 4 terças (6, 13, 20, 27) e 5 quintas (1, 8, 15, 22, 29).
    expect(metaDoMes([2, 4], '2026-10')).toBe(9);
    expect(metaDoMes([], '2026-10')).toBe(0);
  });
});
