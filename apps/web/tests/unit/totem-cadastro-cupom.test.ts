/**
 * O CADASTRO DO CUPOM E A POLÍTICA (frente D) — as regras puras do
 * formulário, a frase de cada falha e de onde vem o texto da política.
 *
 * No quiosque não pode haver campo de nome nem caixa marcada de antemão; a
 * política tem de aparecer mesmo sem rede, e sem credencial nenhuma chamada sai.
 */
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  TOTEM_MENSAGEM_ACEITE,
  TOTEM_MENSAGEM_CELULAR_INVALIDO,
  TOTEM_MENSAGEM_CPF_INVALIDO,
  TOTEM_POLITICA_A_CONFIRMAR,
  TOTEM_POLITICA_VERSAO,
} from '@mktos/shared';
import { ErroDaApi } from '@/lib/api';
import {
  CadastroCupom,
  conferirCadastro,
  dataDoCupom,
  digitosDoCelular,
  formatarCelularDigitando,
  formatarCodigoDoCupom,
  formatarCpfDigitando,
  mensagemDoErroDoCadastro,
} from '@/components/totem/CadastroCupom';
import { buscarPolitica, credencialDaPagina } from '@/app/totem/privacidade/buscar-politica';

const CPF_VALIDO = '52998224725';
const CELULAR_VALIDO = '11987654321';
const TOKEN = 'a'.repeat(43);
const ETIQUETA = 'ABCDEFGH12';

function respostaJson(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('formatação enquanto a pessoa digita', () => {
  it('monta o CPF aos poucos e para nos 11 números', () => {
    expect(formatarCpfDigitando('')).toBe('');
    expect(formatarCpfDigitando('529')).toBe('529');
    expect(formatarCpfDigitando('5299')).toBe('529.9');
    expect(formatarCpfDigitando('5299822')).toBe('529.982.2');
    expect(formatarCpfDigitando('5299822472')).toBe('529.982.247-2');
    expect(formatarCpfDigitando('529.982.247-25999')).toBe('529.982.247-25');
  });

  it('tira o +55 e o zero da frente do celular colado', () => {
    expect(digitosDoCelular('+55 (11) 98765-4321')).toBe(CELULAR_VALIDO);
    expect(digitosDoCelular('011987654321')).toBe(CELULAR_VALIDO);
    expect(digitosDoCelular('11 98765-4321')).toBe(CELULAR_VALIDO);
    expect(digitosDoCelular('119876543219999')).toBe(CELULAR_VALIDO);
  });

  it('monta o celular com DDD entre parênteses e hífen', () => {
    expect(formatarCelularDigitando('')).toBe('');
    expect(formatarCelularDigitando('1')).toBe('(1');
    expect(formatarCelularDigitando('11')).toBe('(11');
    expect(formatarCelularDigitando('11987')).toBe('(11) 987');
    expect(formatarCelularDigitando('1198765')).toBe('(11) 98765');
    expect(formatarCelularDigitando(CELULAR_VALIDO)).toBe('(11) 98765-4321');
  });

  it('separa o código do cupom em dois blocos de quatro', () => {
    expect(formatarCodigoDoCupom('ABCD2345')).toBe('ABCD-2345');
    expect(formatarCodigoDoCupom('ABC')).toBe('ABC');
  });

  it('mostra a validade no dia de Brasília, não no dia UTC', () => {
    expect(dataDoCupom('2026-11-10T02:59:59.000Z')).toBe('09/11/2026');
    expect(dataDoCupom('2026-11-10T03:00:00.000Z')).toBe('10/11/2026');
  });
});

describe('conferirCadastro', () => {
  const ok = { cpf: CPF_VALIDO, telefone: CELULAR_VALIDO, aceitePolitica: true };

  it('aceita CPF válido, celular com DDD e a caixa da política marcada', () => {
    expect(conferirCadastro(ok)).toBeNull();
  });

  it('confere na ordem da tela: CPF, celular e aceite', () => {
    expect(conferirCadastro({ cpf: '', telefone: '', aceitePolitica: false })).toEqual({
      campo: 'cpf',
      mensagem: 'Digite o seu CPF.',
    });
    expect(conferirCadastro({ ...ok, cpf: '11111111111', telefone: '' })).toEqual({
      campo: 'cpf',
      mensagem: TOTEM_MENSAGEM_CPF_INVALIDO,
    });
    expect(conferirCadastro({ ...ok, telefone: '', aceitePolitica: false })).toEqual({
      campo: 'telefone',
      mensagem: 'Digite o número do seu celular, com o DDD.',
    });
    expect(conferirCadastro({ ...ok, telefone: '1187654321' })).toEqual({
      campo: 'telefone',
      mensagem: TOTEM_MENSAGEM_CELULAR_INVALIDO,
    });
    expect(conferirCadastro({ ...ok, aceitePolitica: false })).toEqual({
      campo: 'aceite',
      mensagem: TOTEM_MENSAGEM_ACEITE,
    });
  });
});

describe('mensagemDoErroDoCadastro', () => {
  const semRede = new ErroDaApi('Sem conexão com a internet.', 0, 'sem_rede');

  it('sem rede, o quiosque sugere o QR e o celular pede para conferir a conexão', () => {
    expect(mensagemDoErroDoCadastro(semRede, 'totem')).toMatch(/totem está sem internet.*QR da etiqueta/);
    expect(mensagemDoErroDoCadastro(semRede, 'qr')).toBe('O celular está sem internet. Confira a conexão e tente de novo.');
  });

  it('404 fala da etiqueta no celular e do totem no quiosque', () => {
    const naoAchou = new ErroDaApi('Não encontrado.', 404);
    expect(mensagemDoErroDoCadastro(naoAchou, 'qr')).toMatch(/^Esta etiqueta não serve mais/);
    expect(mensagemDoErroDoCadastro(naoAchou, 'totem')).toMatch(/^O cadastro não está disponível neste totem/);
  });

  it('429 pede para esperar', () => {
    expect(mensagemDoErroDoCadastro(new ErroDaApi('Too Many Requests', 429), 'qr')).toMatch(/Espere alguns minutos/);
  });

  it('400 tira o nome do campo e junta as frases da API', () => {
    const recusa = new ErroDaApi(`cpf: ${TOTEM_MENSAGEM_CPF_INVALIDO} · telefone: ${TOTEM_MENSAGEM_CELULAR_INVALIDO}`, 400);
    expect(mensagemDoErroDoCadastro(recusa, 'totem')).toBe(`${TOTEM_MENSAGEM_CPF_INVALIDO} ${TOTEM_MENSAGEM_CELULAR_INVALIDO}`);
  });

  it('500 vira a frase genérica, e 503 e 403 passam a frase da API', () => {
    expect(mensagemDoErroDoCadastro(new ErroDaApi('Internal server error', 500), 'qr')).toBe(
      'Não foi possível concluir o cadastro. Tente de novo em instantes.',
    );
    expect(mensagemDoErroDoCadastro(new ErroDaApi('O cadastro está fora do ar.', 503), 'qr')).toBe(
      'O cadastro está fora do ar.',
    );
    expect(mensagemDoErroDoCadastro(new ErroDaApi('O cadastro está desligado nesta rede.', 403), 'totem')).toBe(
      'O cadastro está desligado nesta rede.',
    );
  });

  it('erro que não veio da API vira a frase genérica', () => {
    expect(mensagemDoErroDoCadastro(new Error('boom'), 'totem')).toBe(
      'Não foi possível concluir o cadastro. Tente de novo em instantes.',
    );
  });
});

describe('credencialDaPagina', () => {
  it('a etiqueta da URL vale mais que o token guardado e chega normalizada', () => {
    expect(credencialDaPagina('abcde-fgh12', TOKEN)).toEqual({ etiqueta: ETIQUETA });
  });

  it('sem etiqueta válida, usa o token guardado', () => {
    expect(credencialDaPagina('xyz', TOKEN)).toEqual({ token: TOKEN });
    expect(credencialDaPagina(null, TOKEN)).toEqual({ token: TOKEN });
  });

  it('sem nenhuma das duas no formato, não há credencial', () => {
    expect(credencialDaPagina(null, null)).toBeNull();
    expect(credencialDaPagina('', 'curto')).toBeNull();
  });
});

describe('buscarPolitica', () => {
  it('sem credencial, monta a política no aparelho e não chama a API', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);

    const r = await buscarPolitica(null);
    expect(r.fonte).toBe('base');
    expect(JSON.stringify(r.politica)).toContain(TOTEM_POLITICA_A_CONFIRMAR);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('com a etiqueta, pede a política preenchida mandando o código no cabeçalho', async () => {
    const politica = { versao: TOTEM_POLITICA_VERSAO, secoes: [], cadastroLigado: true };
    const fetchFalso = vi.fn().mockResolvedValue(respostaJson(200, politica));
    vi.stubGlobal('fetch', fetchFalso);

    const r = await buscarPolitica({ etiqueta: ETIQUETA });
    expect(r).toEqual({ politica, fonte: 'empresa' });
    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/totem-cadastro/politica');
    expect(url).not.toContain(ETIQUETA);
    expect(init.headers).toEqual({ 'x-totem-etiqueta': ETIQUETA });
  });

  it('sem rede ou com recusa, volta para a política montada no aparelho', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(buscarPolitica({ token: TOKEN })).resolves.toMatchObject({ fonte: 'base' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(404, { message: 'Não encontrado.' })));
    await expect(buscarPolitica({ etiqueta: ETIQUETA })).resolves.toMatchObject({ fonte: 'base' });
  });
});

describe('CadastroCupom na tela', () => {
  function montar(origem: 'totem' | 'qr') {
    const aoConcluir = vi.fn();
    const aoCancelar = vi.fn();
    const credencial = origem === 'totem' ? { token: TOKEN } : { etiqueta: ETIQUETA };
    const r = render(createElement(CadastroCupom, { origem, credencial, aoConcluir, aoCancelar }));
    return { ...r, aoConcluir, aoCancelar };
  }

  function caixa(container: HTMLElement, id: string): HTMLInputElement {
    return container.querySelector(`#${id}`) as HTMLInputElement;
  }

  function teclar(numeros: string) {
    for (const n of numeros) fireEvent.click(screen.getByRole('button', { name: n }));
  }

  it('no quiosque, mostra o teclado grande, nenhum campo de texto e as duas caixas desmarcadas', () => {
    const { container } = montar('totem');
    expect(screen.getByRole('group', { name: 'Teclado numérico' })).toBeInTheDocument();
    expect(container.querySelectorAll('input:not([type="checkbox"])')).toHaveLength(0);
    expect(screen.queryByText('Nome (opcional)')).not.toBeInTheDocument();
    expect(caixa(container, 'cadastro-aceite').checked).toBe(false);
    expect(caixa(container, 'cadastro-campanhas').checked).toBe(false);
  });

  it('pelo QR, usa o teclado do celular e pede o nome como opcional', () => {
    const { container } = montar('qr');
    expect(screen.queryByRole('group', { name: 'Teclado numérico' })).not.toBeInTheDocument();
    expect(screen.getByText('Nome (opcional)')).toBeInTheDocument();
    expect(container.querySelector('input[type="tel"]')).not.toBeNull();
    expect(caixa(container, 'cadastro-aceite').checked).toBe(false);
    expect(caixa(container, 'cadastro-campanhas').checked).toBe(false);
  });

  it('não envia sem o aceite e aponta o que falta', () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    montar('totem');

    fireEvent.click(screen.getByRole('button', { name: 'Receber meu cupom' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Digite o seu CPF.');
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('no quiosque, envia sem nome e mostra o código grande com a validade', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      respostaJson(201, {
        cupom: {
          codigo: 'ABCD2345',
          validoAte: '2026-11-10T02:59:59.000Z',
          chamada: 'Cadastre-se e ganhe 10%',
          beneficio: '10% de desconto',
          detalhe: null,
        },
        motivoSemCupom: null,
      }),
    );
    vi.stubGlobal('fetch', fetchFalso);
    const { container } = montar('totem');

    teclar(CPF_VALIDO);
    teclar(CELULAR_VALIDO);
    fireEvent.click(caixa(container, 'cadastro-aceite'));
    fireEvent.click(screen.getByRole('button', { name: 'Receber meu cupom' }));

    await waitFor(() => expect(screen.getByText('ABCD-2345')).toBeInTheDocument());
    expect(screen.getByText('10% de desconto')).toBeInTheDocument();
    expect(screen.getByText('Vale até 09/11/2026.')).toBeInTheDocument();
    expect(screen.getByText('Mostre este código no caixa.')).toBeInTheDocument();

    const [, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'x-totem-token': TOKEN });
    expect(JSON.parse(init.body as string)).toEqual({
      cpf: CPF_VALIDO,
      telefone: CELULAR_VALIDO,
      nome: null,
      aceitePolitica: true,
      aceitaCampanhas: false,
      politicaVersao: TOTEM_POLITICA_VERSAO,
    });
  });
});
