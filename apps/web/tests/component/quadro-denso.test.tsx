import { describe, expect, it } from 'vitest';
import { ehMeu, haCurto, lerDensidade, lerEscopo, posicaoDoBalao } from '@/lib/quadro-denso';

/*
 * O quadro denso do Trabalho (rodada da implantação I2): as regras puras.
 */
describe('quadro denso: regras', () => {
  it('a densidade lida do armazenamento cai no compacto quando é lixo', () => {
    expect(lerDensidade('cheio')).toBe('cheio');
    expect(lerDensidade('medio')).toBe('medio');
    expect(lerDensidade('gigante')).toBe('compacto');
    expect(lerDensidade(null)).toBe('compacto');
    expect(lerEscopo('meus')).toBe('meus');
    expect(lerEscopo('x')).toBe('todos');
  });

  it('"meus" casa o nome inteiro ou o primeiro nome, sem acento nem caixa', () => {
    expect(ehMeu('Pedro Magnago', 'pedro magnago')).toBe(true);
    expect(ehMeu('Pedro', 'Pedro Magnago')).toBe(true);
    expect(ehMeu('Mesa Root', 'Mesa Root')).toBe(true);
    expect(ehMeu('Pedro Souza', 'Pedro Magnago')).toBe(false);
    expect(ehMeu('Marina', 'Pedro')).toBe(false);
    expect(ehMeu(null, 'Pedro')).toBe(false);
    expect(ehMeu('Joao', 'João Silva')).toBe(true);
  });

  it('o rodapé diz há quanto tempo, curto', () => {
    const agora = new Date('2026-10-18T12:00:00Z');
    expect(haCurto('2026-10-18T11:59:40Z', agora)).toBe('agora');
    expect(haCurto('2026-10-18T11:50:00Z', agora)).toBe('há 10min');
    expect(haCurto('2026-10-18T10:00:00Z', agora)).toBe('há 2h');
    expect(haCurto('2026-10-17T10:00:00Z', agora)).toBe('há 1d');
    expect(haCurto('2026-09-20T10:00:00Z', agora)).toBe('há 4sem');
  });

  it('o balão fica ao lado do cartão que tem espaço e nunca sai da tela', () => {
    const janela = { largura: 1440, altura: 900 };
    const balao = { largura: 288, altura: 180 };
    expect(posicaoDoBalao({ top: 100, left: 300, right: 460, bottom: 164 }, janela, balao)).toEqual({ top: 100, left: 468 });
    // Última coluna: vai para a esquerda.
    expect(posicaoDoBalao({ top: 100, left: 1250, right: 1410, bottom: 164 }, janela, balao)).toEqual({ top: 100, left: 954 });
    // Cartão no pé da tela: sobe até caber.
    expect(posicaoDoBalao({ top: 860, left: 300, right: 460, bottom: 890 }, janela, balao).top).toBe(900 - 8 - 180);
    // Celular (390): sem espaço dos lados, embaixo do cartão e dentro da largura.
    const p = posicaoDoBalao({ top: 200, left: 20, right: 350, bottom: 264 }, { largura: 390, altura: 844 }, { largura: 288, altura: 180 });
    expect(p).toEqual({ top: 272, left: 20 });
  });
});
