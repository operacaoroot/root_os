import { describe, expect, it } from 'vitest';
import type { CaixaContador } from '@mktos/shared';

import { textoDoSelo, tituloDoSelo } from '@/components/caixa';

/*
 * ==========================================================================
 * O SELO DA CAIXA NA CASCA DO OS — fatia A7
 * ==========================================================================
 *
 * A fatia pede o contador "e, se o número puder estar desatualizado, ele não
 * mente sobre isso". Esta suíte é a trava dessa frase. O que ela protege:
 *
 *  1. "NÃO SEI" NUNCA É ZERO. Enquanto a medição não chega, e se ela falhar, o
 *     selo NÃO diz 0 — zero é a única leitura que faz a pessoa deixar de abrir a
 *     tela, e seria falso;
 *  2. ZERO NÃO DESENHA SELO. Zero é vitória, e a vitória é dita na tela ("nada
 *     esperando por você"), não num selo com um zero em cima do ícone;
 *  3. TETO VIRA "N+". Bateu no teto da consulta, o total é PISO;
 *  4. A HORA DA MEDIÇÃO ENTRA NA FRASE. Sem ela um `4` afirma "agora há 4"; com
 *     ela ele afirma "às 14:32 havia 4", que é o que de fato se sabe.
 */

function contador(over: Partial<CaixaContador> = {}): CaixaContador {
  return {
    quantos: 4,
    parcial: false,
    aprovacoes: 3,
    tarefas: 1,
    medidoEm: '2026-09-14T17:32:00.000Z',
    ...over,
  };
}

const base = { falhou: false, carregando: false, recarregar: () => {} };

describe('A7: o selo da caixa não mente', () => {
  it('sem medição ainda não desenha nada — e não desenha zero', () => {
    expect(textoDoSelo({ ...base, contador: null, carregando: true })).toBeNull();
  });

  it('medição que FALHOU vira "?", nunca 0', () => {
    const v = { ...base, contador: null, falhou: true };
    expect(textoDoSelo(v)).toBe('?');
    expect(tituloDoSelo(v)).toContain('não é zero');
  });

  it('zero é vitória e não ganha selo', () => {
    expect(textoDoSelo({ ...base, contador: contador({ quantos: 0 }) })).toBeNull();
  });

  it('o número medido aparece', () => {
    expect(textoDoSelo({ ...base, contador: contador() })).toBe('4');
  });

  it('teto batido vira "N+", porque o total é PISO', () => {
    expect(textoDoSelo({ ...base, contador: contador({ parcial: true }) })).toBe('4+');
    expect(tituloDoSelo({ ...base, contador: contador({ parcial: true }) })).toContain('PISO');
  });

  it('a frase carrega a hora da medição e o que o número inclui', () => {
    const frase = tituloDoSelo({ ...base, contador: contador() });
    // Hora local de quem olha, formatada em pt-BR: o que importa é que ELA
    // exista na frase — um selo sem hora promete tempo real que ninguém cumpriu.
    expect(frase).toMatch(/\d{2}:\d{2}/);
    expect(frase).toContain('3 aprovação(ões)');
    expect(frase).toContain('1 tarefa(s)');
    expect(frase).toContain('troca de tela');
  });
});
