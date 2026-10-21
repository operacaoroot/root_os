import politicaRoot from '@mktos/policy/politica-root.json';
import politicaMktos from '@mktos/policy/politica-marketing-os.json';
import { classificar, lerDelta, lerPolitica, resolverPolitica, type DeltaPolitica, type Politica } from '@mktos/policy';
import { describe, expect, it } from 'vitest';

import { CAPACIDADE_DE_DESFAZER, analisarSobrescrita, deltaDoVigiaSozinho } from '../src/agenda/sobrescrita-da-agenda';
import { CAPACIDADE_DE_PADRONIZAR } from '../src/agenda/vigia-da-agenda';

/*
 * "O VIGIA AGE SOZINHO?" — a sobrescrita assinada da política, medida pela
 * MESMA régua da porta (rodada dos agentes, A5).
 *
 * A suíte prende o que docs/AGENDA.md afirma: pelo `classificar` honesto a
 * padronização é R3 e exige aprovação; a sobrescrita que a desce para R2 é
 * RECUSADA pela régua enquanto não existir a capacidade de desfazer; e mesmo em
 * R2 a porta ainda reteria, porque ninguém passa `aprovacaoR2Ligada`. No dia em
 * que as duas peças existirem, estes casos ficam vermelhos e dizem o que mudar
 * no documento.
 */

const BASE: Politica = resolverPolitica(lerPolitica(politicaRoot, 'politica-root.json'), lerDelta(politicaMktos, 'politica-marketing-os.json'));

describe('a padronização da agenda pela escada', () => {
  it('é R3 pelo efeito (escreve fora do OS, reversibilidade manual), sem ferramenta e sem desfazer', () => {
    const cap = BASE.capacidades.find((c) => c.id === CAPACIDADE_DE_PADRONIZAR)!;
    expect(cap.nivel).toBe('R3');
    expect(classificar(cap.efeito)).toBe('R3');
    expect(cap.efeito).toMatchObject({ escreveForaDoOS: true, reversibilidade: 'manual', destruicao: false });
    expect(cap.ferramenta).toBeUndefined();
    expect(cap.desfazer).toBeUndefined();
    // Os argumentos: título e Meet, e nada de horário, convidado ou exclusão.
    expect(Object.keys((cap.argsSchema as { properties: object }).properties).sort()).toEqual(['adicionarMeet', 'eventoId', 'tituloAtual', 'tituloNovo']);
    expect((cap.argsSchema as { additionalProperties: boolean }).additionalProperties).toBe(false);
  });
});

describe('a sobrescrita assinada do vigia', () => {
  const delta = deltaDoVigiaSozinho(BASE, null, '2026-10-21');

  it('declara R2 reversível com o desfazer, sem tocar nas outras capacidades nem no que o efeito faz', () => {
    const c = delta.capacidades.find((x) => x.id === CAPACIDADE_DE_PADRONIZAR)!;
    expect(c).toMatchObject({ nivel: 'R2', desfazer: CAPACIDADE_DE_DESFAZER });
    expect(c.efeito).toMatchObject({ reversibilidade: 'automatica', escreveForaDoOS: true, destruicao: false, exposicaoExterna: false });
    expect(c.argsSchema).toEqual(BASE.capacidades.find((x) => x.id === CAPACIDADE_DE_PADRONIZAR)!.argsSchema);
    expect(delta.capacidades).toHaveLength(1);
  });

  it('preserva o delta que a empresa já tem (a sobrescrita substitui o delta inteiro)', () => {
    const outra = { ...BASE.capacidades.find((x) => x.id === 'email.enviar')!, nivel: 'R4' as const };
    const atual: DeltaPolitica = { versao: '1.2.0', atualizadoEm: '2026-10-01', origem: 'x', descricao: 'y', estende: 'politica-marketing-os.json', capacidades: [outra] };
    const d = deltaDoVigiaSozinho(BASE, atual, '2026-10-21');
    expect(d.capacidades.map((c) => c.id).sort()).toEqual(['agenda.evento.padronizar', 'email.enviar']);
    expect(d.versao).toBe('1.2.0');
  });

  it('HOJE a régua recusa: o desfazer não existe; e mesmo em R2 a porta reteria', () => {
    const a = analisarSobrescrita(BASE, delta);
    expect(a.ageSozinho).toBe(false);
    expect(a.problemas.join(' ')).toMatch(/agenda\.evento\.padronizar \(R2\): desfazer-inexistente/);
    expect(a.decisao.nivel).toBe('R2');
    expect(a.decisao.exigeAprovacao).toBe(true);
    expect(a.porQueNao).toHaveLength(2);
    expect(a.porQueNao[1]).toMatch(/aprovacaoR2Ligada/);
  });

  it('sem sobrescrita nenhuma: R3, exige aprovação', () => {
    const vazio: DeltaPolitica = { versao: '1.0.0', atualizadoEm: '2026-10-21', origem: 'x', descricao: 'y', estende: 'z', capacidades: [] };
    const a = analisarSobrescrita(BASE, vazio);
    expect(a.decisao).toMatchObject({ nivel: 'R3', exigeAprovacao: true });
    expect(a.ageSozinho).toBe(false);
  });
});
