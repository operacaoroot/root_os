/**
 * AS REGRAS PEQUENAS DO QUIOSQUE: para onde ele deixa navegar, como escreve
 * data e preço, que cor de texto vai sobre a cor escolhida no painel e o
 * gesto escondido da manutenção.
 */
import { describe, expect, it } from 'vitest';

import { ErroDaApi } from '@/lib/api';
import {
  dataDoCalendario,
  ehCorEscura,
  ehLinkDaPrivacidade,
  linkPermitido,
  temaDoQuiosque,
  textoDaPorcao,
  textoDoPreco,
  TOTEM_CORES_DA_MARCA,
} from '@/components/totem/quiosque/formato';
import { contarToquesNoCanto } from '@/components/totem/quiosque/guardas';
import { mensagemDaFalhaDeAtivacao } from '@/components/totem/quiosque/TelaDeAtivacao';

const ORIGEM = 'https://sragranel.operacaoroot.com';

describe('linkPermitido', () => {
  it('deixa navegar só dentro de /totem', () => {
    for (const href of ['/totem', '/totem/', '/totem/quiosque', '/totem/privacidade', `${ORIGEM}/totem/privacidade`]) {
      expect(linkPermitido(href, ORIGEM), href).toBe(true);
    }
  });

  it('bloqueia o painel, outra origem e esquema estranho', () => {
    for (const href of [
      '/totem-gestao',
      '/totem-gestao/aparelhos',
      '/entrar',
      '/',
      '/p/ABC123',
      'https://exemplo.com/totem',
      '//exemplo.com/totem',
      'javascript:alert(1)',
      'mailto:loja@exemplo.com',
    ]) {
      expect(linkPermitido(href, ORIGEM), href).toBe(false);
    }
  });

  it('reconhece o link da política de privacidade', () => {
    expect(ehLinkDaPrivacidade('/totem/privacidade', ORIGEM)).toBe(true);
    expect(ehLinkDaPrivacidade('/totem/privacidade?de=cadastro', ORIGEM)).toBe(true);
    expect(ehLinkDaPrivacidade('/privacidade', ORIGEM)).toBe(false);
    expect(ehLinkDaPrivacidade('https://exemplo.com/totem/privacidade', ORIGEM)).toBe(false);
  });
});

describe('formatos', () => {
  it('data de validade sai pelo dia gravado, sem voltar um dia no fuso do Brasil', () => {
    expect(dataDoCalendario('2026-10-11T00:00:00.000Z')).toBe('11/10/2026');
    expect(dataDoCalendario('2027-01-01T00:00:00.000Z')).toBe('01/01/2027');
  });

  it('preço em reais com a unidade por extenso', () => {
    const semEspacoFixo = (s: string) => s.replace(/\u00a0/g, ' ');
    expect(semEspacoFixo(textoDoPreco(8990, 'kg'))).toBe('R$ 89,90 o quilo');
    expect(semEspacoFixo(textoDoPreco(450, '100g'))).toBe('R$ 4,50 a cada 100 g');
    expect(semEspacoFixo(textoDoPreco(123456, 'un'))).toBe('R$ 1.234,56 a unidade');
  });

  it('porção mantém os gramas quando tem descrição caseira', () => {
    expect(textoDaPorcao(30, '1/2 fatia média')).toBe('Porção de 30 g (1/2 fatia média)');
    expect(textoDaPorcao(12.5, null)).toBe('Porção de 12,5 g');
    expect(textoDaPorcao(40, '   ')).toBe('Porção de 40 g');
    expect(textoDaPorcao(null, '1 colher de sopa')).toBe('Porção: 1 colher de sopa');
    expect(textoDaPorcao(null, null)).toBeNull();
  });
});

describe('temaDoQuiosque', () => {
  it('sem configuração, usa as cores da marca', () => {
    const tema = temaDoQuiosque(null);
    expect(tema['--q-primaria']).toBe(TOTEM_CORES_DA_MARCA.primaria);
    expect(tema['--q-fundo']).toBe(TOTEM_CORES_DA_MARCA.fundo);
    expect(tema['--q-sobre-primaria']).toBe(TOTEM_CORES_DA_MARCA.claro);
    expect(tema['--q-sobre-fundo']).toBe(TOTEM_CORES_DA_MARCA.tinta);
  });

  it('a cor do painel vence, e a tinta por cima acompanha a luminância', () => {
    const tema = temaDoQuiosque({ corPrimaria: '#F2D16B', corFundo: '#1E2A16' });
    expect(tema['--q-primaria']).toBe('#F2D16B');
    expect(tema['--q-sobre-primaria']).toBe(TOTEM_CORES_DA_MARCA.tinta);
    expect(tema['--q-fundo']).toBe('#1E2A16');
    expect(tema['--q-sobre-fundo']).toBe(TOTEM_CORES_DA_MARCA.claro);
  });

  it('ehCorEscura separa o verde da marca do creme', () => {
    expect(ehCorEscura('#28371D')).toBe(true);
    expect(ehCorEscura('#F5F3EC')).toBe(false);
  });
});

describe('gesto da manutenção', () => {
  it('abre com 5 toques em até 3 segundos', () => {
    let toques: number[] = [];
    let abriu = false;
    for (const t of [0, 400, 800, 1200, 1600]) {
      const r = contarToquesNoCanto(toques, t);
      toques = r.toques;
      abriu = r.abrir;
    }
    expect(abriu).toBe(true);
    expect(toques).toEqual([]);
  });

  it('toques espaçados não abrem', () => {
    let toques: number[] = [];
    let abriu = false;
    for (const t of [0, 1000, 2000, 3500, 4500, 6800]) {
      const r = contarToquesNoCanto(toques, t);
      toques = r.toques;
      abriu ||= r.abrir;
    }
    expect(abriu).toBe(false);
  });
});

describe('mensagemDaFalhaDeAtivacao', () => {
  it('diz o que fazer em cada caso', () => {
    expect(mensagemDaFalhaDeAtivacao(new ErroDaApi('x', 0, 'sem_rede'))).toMatch(/Sem conexão/);
    expect(mensagemDaFalhaDeAtivacao(new ErroDaApi('x', 404))).toMatch(/Código inválido ou vencido/);
    expect(mensagemDaFalhaDeAtivacao(new ErroDaApi('x', 429))).toMatch(/Muitas tentativas/);
    expect(mensagemDaFalhaDeAtivacao(new ErroDaApi('x', 500))).toMatch(/Não foi possível ativar/);
  });
});
