/**
 * O PAINEL DO CADASTRO (frente D) — campanhas, clientes e o caixa dos cupons.
 *
 * O caixa precisa saber, antes de clicar, se o cupom vale na loja dele; o
 * formulário da campanha precisa recusar com uma frase só o que a API recusaria,
 * e as datas são dias de Brasília.
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { TotemClienteDetalhe, TotemClienteLinha, TotemCupomDetalhe, TotemLojaDoEscopo } from '@mktos/shared';
import {
  CHAVE_LOJA_DO_CAIXA,
  codigoDigitado,
  codigoNaTela,
  dataBR,
  dataHoraBR,
  guardarLoja,
  lerLojaGuardada,
  lojaInicial,
  motivoSemBaixa,
  textoDasLojasValidas,
} from '@/app/totem-gestao/cupons/cupom-na-tela';
import {
  corpoDaCampanha,
  diaEmBrasilia,
  formularioDaCampanha,
  formularioVazio,
  numeroDigitado,
  podeMexerNaCampanha,
  situacaoDaCampanha,
  textoDaAcao,
  textoDasLojas,
  textoDoBotao,
  textoDoPeriodo,
  type FormularioDaCampanha,
} from '@/app/totem-gestao/campanhas/campanha-na-tela';
import { enderecoDaImagem, ladosReduzidos } from '@/components/totem/imagem';
import {
  rotuloDoCanal,
  textoDasFinalidades,
  totalDePaginas,
  trocarLinha,
} from '@/app/totem-gestao/clientes/cliente-na-tela';

const LOJA_A = '11111111-1111-4111-8111-111111111111';
const LOJA_B = '22222222-2222-4222-8222-222222222222';
const LOJA_C = '33333333-3333-4333-8333-333333333333';
const MIDIA = `/api/totem-publico/midia/${LOJA_A}/${'a'.repeat(32)}.webp`;
const PRODUTO_1 = { id: '44444444-4444-4444-8444-444444444444', codigo: '101', nome: 'Granola', imagemUrl: null };
const PRODUTO_2 = { id: '55555555-5555-4555-8555-555555555555', codigo: '102', nome: 'Castanha', imagemUrl: null };

const LOJAS: TotemLojaDoEscopo[] = [
  { id: LOJA_A, codigo: 'centro', nome: 'Centro', ativa: true },
  { id: LOJA_B, codigo: 'bairro', nome: 'Bairro', ativa: true },
  { id: LOJA_C, codigo: 'antiga', nome: 'Antiga', ativa: false },
];

function cupom(extra: Partial<TotemCupomDetalhe> = {}): TotemCupomDetalhe {
  return {
    codigo: 'ABCD2345',
    status: 'emitido',
    campanha: 'Inauguração',
    beneficio: '10% de desconto',
    emitidoEm: '2026-10-11T15:30:00.000Z',
    validoAte: '2026-11-10T02:59:59.000Z',
    usadoEm: null,
    usadoLoja: null,
    chamada: 'Cadastre-se e ganhe 10%',
    detalhe: null,
    lojasValidas: [{ id: LOJA_A, nome: 'Centro' }],
    ...extra,
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe('o cupom na tela do caixa', () => {
  it('mostra datas e horas de Brasília', () => {
    expect(dataBR('2026-10-11T15:30:00.000Z')).toBe('11/10/2026');
    expect(dataHoraBR('2026-10-11T15:30:00.000Z')).toBe('11/10/2026 às 12:30');
    expect(dataBR('2026-11-10T02:59:59.000Z')).toBe('09/11/2026');
  });

  it('separa o código em dois blocos', () => {
    expect(codigoNaTela('ABCD2345')).toBe('ABCD-2345');
    expect(codigoNaTela('ABC')).toBe('ABC');
  });

  it('lê o código como a API: sem hífen, minúsculo vira maiúsculo, O vira 0 e I vira 1', () => {
    expect(codigoDigitado('')).toBeNull();
    expect(codigoDigitado('   ')).toBeNull();
    expect(codigoDigitado('abcd-2345')).toEqual({ codigo: 'ABCD2345' });
    expect(codigoDigitado('ABCO 234I')).toEqual({ codigo: 'ABC02341' });
    expect(codigoDigitado('ABC')).toEqual({ problema: 'O código do cupom tem 8 letras ou números.' });
  });

  it('libera a baixa só de cupom emitido, com a loja escolhida e válida', () => {
    expect(motivoSemBaixa(cupom(), LOJA_A)).toBeNull();
    expect(motivoSemBaixa(cupom({ lojasValidas: 'todas' }), LOJA_B)).toBeNull();
    expect(motivoSemBaixa(cupom(), '')).toBe('Escolha a loja deste caixa para dar baixa.');
    expect(motivoSemBaixa(cupom(), LOJA_B)).toBe('Este cupom não vale nesta loja.');
  });

  it('explica por que o cupom usado, vencido ou cancelado não vale', () => {
    expect(
      motivoSemBaixa(
        cupom({ status: 'usado', usadoEm: '2026-10-12T13:05:00.000Z', usadoLoja: { id: LOJA_A, nome: 'Centro' } }),
        LOJA_A,
      ),
    ).toBe('Este cupom já foi usado em 12/10/2026 às 10:05, na loja Centro.');
    expect(motivoSemBaixa(cupom({ status: 'usado' }), LOJA_A)).toBe('Este cupom já foi usado.');
    expect(motivoSemBaixa(cupom({ status: 'expirado' }), LOJA_A)).toBe(
      'Este cupom venceu em 09/11/2026 e não vale mais.',
    );
    expect(motivoSemBaixa(cupom({ status: 'cancelado' }), LOJA_A)).toBe('Este cupom foi cancelado e não vale mais.');
  });

  it('descreve as lojas onde o cupom vale', () => {
    expect(textoDasLojasValidas('todas')).toBe('Todas as lojas');
    expect(textoDasLojasValidas([])).toBe('Nenhuma loja');
    expect(
      textoDasLojasValidas([
        { id: LOJA_A, nome: 'Centro' },
        { id: LOJA_B, nome: 'Bairro' },
      ]),
    ).toBe('Centro, Bairro');
  });

  it('começa na loja guardada se ela continua ativa, senão na única loja ativa', () => {
    expect(lojaInicial(LOJAS, LOJA_B)).toBe(LOJA_B);
    expect(lojaInicial(LOJAS, LOJA_C)).toBe('');
    expect(lojaInicial(LOJAS, null)).toBe('');
    expect(lojaInicial([LOJAS[0], LOJAS[2]], LOJA_C)).toBe(LOJA_A);
    expect(lojaInicial([], null)).toBe('');
  });

  it('lembra a loja do caixa no navegador e esquece quando ela sai', () => {
    expect(lerLojaGuardada()).toBeNull();
    guardarLoja(LOJA_A);
    expect(window.localStorage.getItem(CHAVE_LOJA_DO_CAIXA)).toBe(LOJA_A);
    expect(lerLojaGuardada()).toBe(LOJA_A);
    guardarLoja('');
    expect(lerLojaGuardada()).toBeNull();
  });
});

describe('o formulário da campanha', () => {
  function preenchido(extra: Partial<FormularioDaCampanha> = {}): FormularioDaCampanha {
    return {
      ...formularioVazio(),
      nome: 'Inauguração',
      chamada: 'Cadastre-se e ganhe 10%',
      valor: '10',
      inicio: '2026-10-11',
      fim: '2026-10-31',
      lojaIds: [LOJA_A],
      ...extra,
    };
  }

  it('lê o número com vírgula ou ponto e recusa o que não é número', () => {
    expect(numeroDigitado('15')).toBe(15);
    expect(numeroDigitado('15,5')).toBe(15.5);
    expect(numeroDigitado('15.50')).toBe(15.5);
    expect(numeroDigitado('1.234,56')).toBe(1234.56);
    expect(numeroDigitado(' 10 ')).toBe(10);
    expect(numeroDigitado('')).toBeNull();
    expect(numeroDigitado('dez')).toBeNull();
    expect(numeroDigitado('-5')).toBeNull();
  });

  it('monta o corpo com o início à meia-noite e o fim às 23:59:59 de Brasília', () => {
    const r = corpoDaCampanha(preenchido(), false);
    expect(r).toEqual({
      corpo: {
        nome: 'Inauguração',
        chamada: 'Cadastre-se e ganhe 10%',
        acao: 'cadastro',
        textoApoio: null,
        textoBotao: null,
        imagemUrl: null,
        produtoIds: [],
        tipoBeneficio: 'percentual',
        valorBeneficio: 10,
        descricaoBeneficio: null,
        validadeDias: 30,
        inicioEm: '2026-10-11T00:00:00-03:00',
        fimEm: '2026-10-31T23:59:59-03:00',
        ativa: true,
        lojaIds: [LOJA_A],
      },
    });
  });

  it('sem data de início e sem fim, deixa a API decidir o início e a campanha não acaba', () => {
    const r = corpoDaCampanha(preenchido({ inicio: '', fim: '' }), false);
    expect('corpo' in r && r.corpo.inicioEm).toBeUndefined();
    expect('corpo' in r && r.corpo.fimEm).toBeNull();
  });

  it('o brinde vai sem valor e com a descrição', () => {
    const r = corpoDaCampanha(preenchido({ tipoBeneficio: 'brinde', valor: '99', descricao: 'Um pote de granola' }), false);
    expect(r).toMatchObject({ corpo: { tipoBeneficio: 'brinde', valorBeneficio: null, descricaoBeneficio: 'Um pote de granola' } });
  });

  it('sem loja, só quem cuida da rede cria campanha para todas', () => {
    expect(corpoDaCampanha(preenchido({ lojaIds: [] }), false)).toEqual({ problema: 'Escolha pelo menos uma loja.' });
    expect(corpoDaCampanha(preenchido({ lojaIds: [] }), true)).toMatchObject({ corpo: { lojaIds: [] } });
  });

  it('recusa com uma frase só o que a API também recusaria', () => {
    expect(corpoDaCampanha(preenchido({ valor: 'dez' }), true)).toEqual({
      problema: 'Digite o valor do benefício só com números, como 10 ou 15,50.',
    });
    expect(corpoDaCampanha(preenchido({ valor: '' }), true)).toEqual({
      problema: 'No desconto em percentual, informe um valor entre 1 e 100.',
    });
    expect(corpoDaCampanha(preenchido({ validadeDias: '' }), true)).toEqual({
      problema: 'Digite em quantos dias o cupom vence, de 1 a 365.',
    });
    expect(corpoDaCampanha(preenchido({ validadeDias: '400' }), true)).toEqual({
      problema: 'O cupom vale no máximo 365 dias.',
    });
    expect(corpoDaCampanha(preenchido({ nome: ' ' }), true)).toEqual({ problema: 'Dê um nome à campanha.' });
    expect(corpoDaCampanha(preenchido({ tipoBeneficio: 'brinde', descricao: '' }), true)).toEqual({
      problema: 'Descreva o brinde.',
    });
    expect(corpoDaCampanha(preenchido({ inicio: '2026-10-31', fim: '2026-10-11' }), true)).toEqual({
      problema: 'O fim da campanha tem de vir depois do início.',
    });
  });

  it('volta a campanha salva para o formulário nos dias de Brasília', () => {
    expect(diaEmBrasilia('2026-10-11T03:00:00.000Z')).toBe('2026-10-11');
    expect(diaEmBrasilia('2026-11-01T02:59:59.000Z')).toBe('2026-10-31');

    const f = formularioDaCampanha({
      id: 'c1',
      nome: 'Inauguração',
      chamada: 'Cadastre-se e ganhe',
      acao: 'cadastro',
      textoApoio: 'Só nesta semana',
      textoBotao: null,
      imagemUrl: MIDIA,
      produtoIds: [],
      produtos: [],
      ordem: 2,
      tipoBeneficio: 'valor',
      valorBeneficio: 15.5,
      descricaoBeneficio: null,
      beneficio: 'R$ 15,50 de desconto',
      validadeDias: 15,
      inicioEm: '2026-10-11T03:00:00.000Z',
      fimEm: null,
      ativa: false,
      vigente: false,
      lojaIds: [LOJA_A],
      cupons: { emitidos: 0, usados: 0 },
    });
    expect(f).toEqual({
      nome: 'Inauguração',
      chamada: 'Cadastre-se e ganhe',
      acao: 'cadastro',
      textoApoio: 'Só nesta semana',
      textoBotao: '',
      imagemUrl: MIDIA,
      produtos: [],
      ordem: '2',
      tipoBeneficio: 'valor',
      valor: '15,5',
      descricao: '',
      validadeDias: '15',
      inicio: '2026-10-11',
      fim: '',
      ativa: false,
      lojaIds: [LOJA_A],
    });
    expect(corpoDaCampanha(f, false)).toMatchObject({
      corpo: { valorBeneficio: 15.5, inicioEm: '2026-10-11T00:00:00-03:00', fimEm: null },
    });
  });

  it('na ação de produtos, manda a lista na ordem escolhida e sem cupom', () => {
    const r = corpoDaCampanha(
      preenchido({ acao: 'produtos', produtos: [PRODUTO_2, PRODUTO_1], valor: '', validadeDias: '' }),
      false,
    );
    expect(r).toMatchObject({
      corpo: {
        acao: 'produtos',
        produtoIds: [PRODUTO_2.id, PRODUTO_1.id],
        tipoBeneficio: null,
        valorBeneficio: null,
        descricaoBeneficio: null,
        validadeDias: null,
      },
    });
    expect(corpoDaCampanha(preenchido({ acao: 'produtos', produtos: [] }), false)).toEqual({
      problema: 'Escolha pelo menos um produto para a campanha mostrar.',
    });
  });

  it('a campanha que só divulga vai sem cupom e sem produtos, mesmo com lista escolhida antes', () => {
    const r = corpoDaCampanha(preenchido({ acao: 'nenhuma', produtos: [PRODUTO_1], descricao: 'sobra' }), false);
    expect(r).toMatchObject({
      corpo: { acao: 'nenhuma', produtoIds: [], tipoBeneficio: null, valorBeneficio: null, descricaoBeneficio: null },
    });
  });

  it('a ordem é opcional e só aceita inteiro de 0 a 999', () => {
    expect(corpoDaCampanha(preenchido({ ordem: '' }), false)).not.toHaveProperty('corpo.ordem', expect.anything());
    expect(corpoDaCampanha(preenchido({ ordem: '5' }), false)).toMatchObject({ corpo: { ordem: 5 } });
    expect(corpoDaCampanha(preenchido({ ordem: '1000' }), false)).toEqual({
      problema: 'A ordem é um número inteiro, de 0 a 999.',
    });
    expect(corpoDaCampanha(preenchido({ ordem: '2,5' }), false)).toEqual({
      problema: 'A ordem é um número inteiro, de 0 a 999.',
    });
  });

  it('a imagem e os textos do banner seguem como digitados', () => {
    const r = corpoDaCampanha(
      preenchido({ imagemUrl: MIDIA, textoApoio: ' Até domingo ', textoBotao: 'Pegar' }),
      false,
    );
    expect(r).toMatchObject({
      corpo: { imagemUrl: MIDIA, textoApoio: 'Até domingo', textoBotao: 'Pegar' },
    });
    expect(corpoDaCampanha(preenchido({ imagemUrl: 'javascript:alert(1)' }), false)).toHaveProperty('problema');
  });

  it('o botão usa o texto padrão da ação e some quando a campanha só divulga', () => {
    expect(textoDoBotao({ acao: 'cadastro', textoBotao: '' })).toBe('Quero meu cupom');
    expect(textoDoBotao({ acao: 'produtos', textoBotao: '  ' })).toBe('Ver produtos');
    expect(textoDoBotao({ acao: 'produtos', textoBotao: 'Ver ofertas' })).toBe('Ver ofertas');
    expect(textoDoBotao({ acao: 'nenhuma', textoBotao: '' })).toBeNull();
  });

  it('descreve o que a campanha faz na lista', () => {
    const base = { beneficio: null, validadeDias: null, produtos: [] };
    expect(textoDaAcao({ ...base, acao: 'cadastro', beneficio: '10% de desconto', validadeDias: 30 })).toEqual({
      principal: '10% de desconto',
      detalhe: 'Cupom vale 30 dias',
    });
    expect(textoDaAcao({ ...base, acao: 'cadastro', beneficio: 'Brinde', validadeDias: 1 })).toEqual({
      principal: 'Brinde',
      detalhe: 'Cupom vale 1 dia',
    });
    expect(textoDaAcao({ ...base, acao: 'produtos', produtos: [PRODUTO_1] })).toEqual({
      principal: 'Mostra 1 produto',
      detalhe: null,
    });
    expect(textoDaAcao({ ...base, acao: 'produtos', produtos: [PRODUTO_1, PRODUTO_2] }).principal).toBe(
      'Mostra 2 produtos',
    );
    expect(textoDaAcao({ ...base, acao: 'nenhuma' })).toEqual({ principal: 'Só divulga', detalhe: null });
  });

  it('mostra em que pé a campanha está', () => {
    const agora = new Date('2026-10-11T15:00:00.000Z');
    const base = { ativa: true, vigente: false, inicioEm: '2026-10-01T03:00:00.000Z', fimEm: null };
    expect(situacaoDaCampanha({ ...base, vigente: true }, agora)).toEqual({ rotulo: 'No ar', tom: 'good' });
    expect(situacaoDaCampanha({ ...base, ativa: false }, agora)).toEqual({ rotulo: 'Desativada', tom: 'muted' });
    expect(situacaoDaCampanha({ ...base, inicioEm: '2026-10-20T03:00:00.000Z' }, agora)).toEqual({
      rotulo: 'Agendada',
      tom: 'brand',
    });
    expect(situacaoDaCampanha({ ...base, fimEm: '2026-10-05T02:59:59.000Z' }, agora)).toEqual({
      rotulo: 'Encerrada',
      tom: 'warn',
    });
  });

  it('descreve o período e as lojas', () => {
    expect(textoDoPeriodo({ inicioEm: '2026-10-11T03:00:00.000Z', fimEm: null })).toBe(
      'Desde 11/10/2026, sem data de fim',
    );
    expect(textoDoPeriodo({ inicioEm: '2026-10-11T03:00:00.000Z', fimEm: '2026-11-01T02:59:59.000Z' })).toBe(
      'De 11/10/2026 a 31/10/2026',
    );
    expect(textoDasLojas([], LOJAS)).toBe('Todas as lojas');
    expect(textoDasLojas([LOJA_A, LOJA_B], LOJAS)).toBe('Centro, Bairro');
    expect(textoDasLojas([LOJA_A, '99999999-9999-4999-8999-999999999999'], LOJAS)).toBe(
      'Centro, uma loja fora do seu acesso',
    );
  });

  it('só deixa mexer na campanha cujas lojas estão todas no acesso', () => {
    const minhas = [LOJAS[0]];
    expect(podeMexerNaCampanha([LOJA_A], minhas, false)).toBe(true);
    expect(podeMexerNaCampanha([LOJA_A, LOJA_B], minhas, false)).toBe(false);
    expect(podeMexerNaCampanha([], minhas, false)).toBe(false);
    expect(podeMexerNaCampanha([], minhas, true)).toBe(true);
    expect(podeMexerNaCampanha([LOJA_B], minhas, true)).toBe(true);
  });
});

describe('o cliente no painel', () => {
  it('dá nome ao canal e às finalidades do consentimento', () => {
    expect(rotuloDoCanal('totem')).toBe('Totem');
    expect(rotuloDoCanal('qr')).toBe('QR da etiqueta');
    expect(rotuloDoCanal('outro')).toBe('outro');
    expect(textoDasFinalidades([])).toBe('Nenhuma');
    expect(textoDasFinalidades(['cupom'])).toBe('Cupom');
    expect(textoDasFinalidades(['cupom', 'campanhas'])).toBe('Cupom e campanhas');
    expect(textoDasFinalidades(['campanhas'])).toBe('Campanhas');
  });

  it('tem sempre pelo menos uma página', () => {
    expect(totalDePaginas(0, 25)).toBe(1);
    expect(totalDePaginas(25, 25)).toBe(1);
    expect(totalDePaginas(26, 25)).toBe(2);
  });

  it('troca só a linha do cliente que mudou na ficha', () => {
    const linha = (id: string): TotemClienteLinha => ({
      id,
      cpfMascarado: '***.982.247-**',
      telefoneMascarado: '(11) *****-4321',
      lojaOrigem: { id: LOJA_A, nome: 'Centro' },
      canalOrigem: 'totem',
      aceitaCampanhas: true,
      anonimizado: false,
      criadoEm: '2026-10-11T15:30:00.000Z',
      totalDeCupons: 1,
    });
    const ficha: TotemClienteDetalhe = {
      ...linha('b'),
      cpfMascarado: '***.***.***-**',
      telefoneMascarado: null,
      aceitaCampanhas: false,
      anonimizado: true,
      nome: null,
      anonimizadoEm: '2026-10-12T10:00:00.000Z',
      consentimentos: [],
      cupons: [],
    };
    const [a, b] = trocarLinha([linha('a'), linha('b')], ficha);
    expect(a).toEqual(linha('a'));
    expect(b).toEqual({
      ...linha('b'),
      cpfMascarado: '***.***.***-**',
      telefoneMascarado: null,
      aceitaCampanhas: false,
      anonimizado: true,
    });
    expect(b).not.toHaveProperty('consentimentos');
  });
});

describe('a imagem antes do envio', () => {
  it('reduz pelo lado maior, sem aumentar foto pequena', () => {
    expect(ladosReduzidos(4000, 3000, 1600)).toEqual({ largura: 1600, altura: 1200 });
    expect(ladosReduzidos(1080, 1920, 1600)).toEqual({ largura: 900, altura: 1600 });
    expect(ladosReduzidos(800, 600, 1600)).toEqual({ largura: 800, altura: 600 });
    expect(ladosReduzidos(10000, 1, 1600)).toEqual({ largura: 1600, altura: 1 });
  });

  it('o endereço da imagem enviada passa pela API; endereço externo fica igual', () => {
    expect(enderecoDaImagem('https://exemplo.com/foto.jpg')).toBe('https://exemplo.com/foto.jpg');
    expect(enderecoDaImagem(MIDIA).endsWith(MIDIA)).toBe(true);
  });
});
