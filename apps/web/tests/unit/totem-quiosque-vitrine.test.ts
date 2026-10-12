/**
 * A VITRINE DO QUIOSQUE: alergênico que vale na ficha, produtos de um banner,
 * a volta do carrossel, o fundo de quem não tem foto, a nota do VD e a
 * pré-carga das imagens para o totem mostrar sem rede.
 */
import { describe, expect, it } from 'vitest';

import {
  alergenicosEfetivos,
  destinoDoArrasto,
  fundoDaMarca,
  FUNDOS_DA_MARCA,
  indiceAnterior,
  indiceSeguro,
  inicialDoNome,
  preCarregar,
  produtosDaCampanha,
  proximoIndice,
  temVdNaoEstabelecido,
  urlsDeImagemDoCatalogo,
} from '@/components/totem/quiosque/vitrine';

import { campanhaDeExemplo, catalogoDeExemplo, produtoDeExemplo } from '../totem-quiosque-dados';

const ORG = '3f2a1c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const midia = (n: number, ext = 'jpg') => `/api/totem-publico/midia/${ORG}/${String(n).repeat(32).slice(0, 32)}.${ext}`;

describe('alergenicosEfetivos', () => {
  const padrao = { alergenicosPadrao: 'Pode conter traços de amendoim.' };

  it('usa o aviso do produto quando ele tem um', () => {
    expect(alergenicosEfetivos({ alergenicos: 'Contém castanhas.' }, padrao)).toBe('Contém castanhas.');
  });

  it('cai no aviso padrão da loja quando o produto não tem', () => {
    expect(alergenicosEfetivos({ alergenicos: null }, padrao)).toBe('Pode conter traços de amendoim.');
  });

  it('trata texto em branco como ausente', () => {
    expect(alergenicosEfetivos({ alergenicos: '   ' }, padrao)).toBe('Pode conter traços de amendoim.');
    expect(alergenicosEfetivos({ alergenicos: null }, { alergenicosPadrao: ' ' })).toBeNull();
  });

  it('devolve null sem aviso nenhum', () => {
    expect(alergenicosEfetivos({ alergenicos: null }, { alergenicosPadrao: null })).toBeNull();
  });

  it('tira o rótulo digitado junto, que a ficha já escreve', () => {
    expect(alergenicosEfetivos({ alergenicos: 'Alérgicos: contém amendoim.' }, padrao)).toBe('Contém amendoim.');
    expect(alergenicosEfetivos({ alergenicos: null }, { alergenicosPadrao: 'ALERGÊNICOS:pode conter leite.' })).toBe(
      'Pode conter leite.',
    );
    expect(alergenicosEfetivos({ alergenicos: 'Alérgicos:' }, padrao)).toBe('Pode conter traços de amendoim.');
  });
});

describe('produtosDaCampanha', () => {
  const a = produtoDeExemplo({ nome: 'Aveia' });
  const b = produtoDeExemplo({ nome: 'Granola' });
  const c = produtoDeExemplo({ nome: 'Chia' });

  it('segue a ordem escolhida no painel, não a do catálogo', () => {
    const banner = campanhaDeExemplo({ nome: 'Café da manhã', acao: 'produtos', produtoIds: [c.id, a.id] });
    expect(produtosDaCampanha(banner, [a, b, c]).map((p) => p.nome)).toEqual(['Chia', 'Aveia']);
  });

  it('ignora id que não está no catálogo e id repetido', () => {
    const banner = campanhaDeExemplo({ nome: 'Grãos', produtoIds: ['sumiu', b.id, b.id] });
    expect(produtosDaCampanha(banner, [a, b, c]).map((p) => p.nome)).toEqual(['Granola']);
  });

  it('banner sem produtos devolve lista vazia', () => {
    expect(produtosDaCampanha(campanhaDeExemplo({ nome: 'Vazio' }), [a, b])).toEqual([]);
  });
});

describe('ordem e rotação do carrossel', () => {
  it('avança e volta dando a volta nas pontas', () => {
    expect(proximoIndice(0, 3)).toBe(1);
    expect(proximoIndice(2, 3)).toBe(0);
    expect(indiceAnterior(0, 3)).toBe(2);
    expect(indiceAnterior(2, 3)).toBe(1);
  });

  it('com um banner só ou nenhum fica no zero', () => {
    expect(proximoIndice(0, 1)).toBe(0);
    expect(indiceAnterior(0, 1)).toBe(0);
    expect(proximoIndice(4, 0)).toBe(0);
    expect(indiceAnterior(4, 0)).toBe(0);
  });

  it('a rotação automática percorre todos os banners na ordem', () => {
    const vistos: number[] = [];
    let i = 0;
    for (let passo = 0; passo < 5; passo++) {
      vistos.push(i);
      i = proximoIndice(i, 4);
    }
    expect(vistos).toEqual([0, 1, 2, 3, 0]);
  });

  it('indiceSeguro segura o índice quando a sincronia encolhe a lista', () => {
    expect(indiceSeguro(3, 2)).toBe(1);
    expect(indiceSeguro(1, 5)).toBe(1);
    expect(indiceSeguro(2, 0)).toBe(0);
    expect(indiceSeguro(-1, 3)).toBe(0);
  });

  it('arrasto curto não troca; arrasto longo troca na direção do dedo', () => {
    expect(destinoDoArrasto(1, 3, -100, 1000)).toBe(1);
    expect(destinoDoArrasto(1, 3, -300, 1000)).toBe(2);
    expect(destinoDoArrasto(1, 3, 300, 1000)).toBe(0);
    expect(destinoDoArrasto(0, 3, 300, 1000)).toBe(2);
    expect(destinoDoArrasto(0, 1, -900, 1000)).toBe(0);
  });
});

describe('inicial e fundo de quem não tem foto', () => {
  it('pega a primeira letra ou número, em maiúscula', () => {
    expect(inicialDoNome('castanha-do-pará')).toBe('C');
    expect(inicialDoNome('  "ágar-ágar"')).toBe('Á');
    expect(inicialDoNome('7 grãos')).toBe('7');
    expect(inicialDoNome('***')).toBe('?');
  });

  it('o mesmo nome sempre cai no mesmo fundo da marca', () => {
    expect(fundoDaMarca('Granola')).toBe(fundoDaMarca('Granola'));
    expect(FUNDOS_DA_MARCA).toContain(fundoDaMarca('Granola'));
    const usados = new Set(['Aveia', 'Chia', 'Granola', 'Linhaça', 'Quinoa', 'Uva-passa'].map(fundoDaMarca));
    expect(usados.size).toBeGreaterThan(1);
  });
});

describe('temVdNaoEstabelecido', () => {
  it('marca quando há coluna de VD e algum nutriente sem valor', () => {
    expect(temVdNaoEstabelecido([{ vd: 10 }, { vd: null }])).toBe(true);
  });

  it('não marca sem a coluna de VD nem com todos preenchidos', () => {
    expect(temVdNaoEstabelecido([{ vd: null }, { vd: null }])).toBe(false);
    expect(temVdNaoEstabelecido([{ vd: 5 }, { vd: 0 }])).toBe(false);
    expect(temVdNaoEstabelecido([])).toBe(false);
  });
});

describe('urlsDeImagemDoCatalogo', () => {
  it('junta banners, logo e produtos, sem repetir e só da rota de mídia', () => {
    const catalogo = catalogoDeExemplo({
      campanhas: [
        campanhaDeExemplo({ nome: 'Cupom', imagemUrl: midia(1) }),
        campanhaDeExemplo({ nome: 'Externa', imagemUrl: 'https://exemplo.com/banner.jpg' }),
        campanhaDeExemplo({ nome: 'Sem foto' }),
      ],
      produtos: [
        produtoDeExemplo({ nome: 'Aveia', imagemUrl: midia(2, 'webp') }),
        produtoDeExemplo({ nome: 'Chia', imagemUrl: midia(1) }),
        produtoDeExemplo({ nome: 'Granola', imagemUrl: '/api/totem-publico/midia/../segredo.jpg' }),
      ],
    });
    catalogo.config.logoUrl = midia(3, 'png');
    expect(urlsDeImagemDoCatalogo(catalogo)).toEqual([midia(1), midia(3, 'png'), midia(2, 'webp')]);
  });
});

describe('preCarregar', () => {
  it('baixa cada endereço uma vez, mesmo repetido', async () => {
    const pedidos: string[] = [];
    const n = await preCarregar(['a', 'b', 'a', 'c', 'b'], async (u) => {
      pedidos.push(u);
    });
    expect(n).toBe(3);
    expect(pedidos.sort()).toEqual(['a', 'b', 'c']);
  });

  it('não passa do limite de downloads ao mesmo tempo', async () => {
    let ativos = 0;
    let pico = 0;
    const urls = Array.from({ length: 10 }, (_, i) => `img-${i}`);
    await preCarregar(
      urls,
      async () => {
        ativos++;
        pico = Math.max(pico, ativos);
        await new Promise((r) => setTimeout(r, 5));
        ativos--;
      },
      { concorrencia: 3 },
    );
    expect(pico).toBe(3);
  });

  it('pula as já carregadas e só marca as que vieram', async () => {
    const jaCarregadas = new Set(['a']);
    const pedidos: string[] = [];
    const n = await preCarregar(
      ['a', 'b', 'c'],
      async (u) => {
        pedidos.push(u);
        if (u === 'b') throw new Error('falhou');
      },
      { jaCarregadas },
    );
    expect(pedidos.sort()).toEqual(['b', 'c']);
    expect(n).toBe(1);
    expect([...jaCarregadas].sort()).toEqual(['a', 'c']);
  });

  it('uma falha não interrompe as outras', async () => {
    const pedidos: string[] = [];
    await preCarregar(
      ['a', 'b', 'c', 'd'],
      async (u) => {
        pedidos.push(u);
        if (u === 'a') throw new Error('sem rede');
      },
      { concorrencia: 1 },
    );
    expect(pedidos).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lista vazia resolve sem chamar nada', async () => {
    let chamadas = 0;
    expect(
      await preCarregar([], async () => {
        chamadas++;
      }),
    ).toBe(0);
    expect(chamadas).toBe(0);
  });
});
