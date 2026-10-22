/*
 * O FUNIL VIVO EM LISTA (rodada de produção 3, I5, 22/10/2026).
 *
 * A tabela que o Rodrigo achou "horrível" refeita: larguras que se ajustam e
 * ficam no navegador, ordenação pelo cabeçalho com `aria-sort`, colunas
 * visíveis no painel de Filtros (no endereço e na vista salva), valor em reais
 * e datas de São Paulo, a etapa como chip, o responsável como avatar com o nome
 * no balão, e abaixo de 640 px os cartões empilhados. O quadro não muda.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMERCIAL_ETAPAS, filtrosDoFunilVazios, type CartaoDoFunil, type FunilVivo } from '@mktos/shared';

import { configDaVistaDoFunil, escreverEnderecoDoFunil, lerEnderecoDoFunil } from '@/app/comercial/_funil/filtros-do-funil';
import {
  CHAVE_DAS_LARGURAS,
  COLUNAS_PADRAO,
  LARGURA_MAXIMA,
  alternarColuna,
  ariaSort,
  colunaDa,
  colunasNoEndereco,
  dataCompleta,
  dataCurta,
  dinheiro,
  iniciais,
  larguraDaTabela,
  lerColunas,
  lerLarguras,
  lerOrdem,
  limitarLargura,
  ordenarCartoes,
  proximaOrdem,
} from '@/app/comercial/_funil/lista-do-funil';

let RESPOSTAS: Record<string, unknown> = {};
const gets: string[] = [];

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => true }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/comercial/funil', useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      gets.push(caminho);
      const chave = Object.keys(RESPOSTAS).sort((a, b) => b.length - a.length).find((k) => caminho.startsWith(k));
      return chave ? RESPOSTAS[chave] : [];
    }),
    apiPost: vi.fn(async () => ({})),
  };
});

import FunilPage from '@/app/comercial/funil/page';

const cartao = (leadId: string, nome: string, etapa: CartaoDoFunil['etapa'], extra: Partial<CartaoDoFunil> = {}): CartaoDoFunil => ({
  leadId, nome, empresa: null, etapa, saude: null, proximaAcao: null, precisaDeDecisao: false,
  parado: false, diasNaEtapa: 0, motivoSaida: null, voltaEm: null, perfil: null, produto: null, voltaPara: null, balao: null, ...extra,
});

function funil(cartoes: CartaoDoFunil[]): FunilVivo {
  return {
    colunas: [
      ...COMERCIAL_ETAPAS.map((e) => ({ etapa: e, rotulo: e, cartoes: cartoes.filter((c) => c.etapa === e) })),
      { etapa: 'saidas' as const, rotulo: 'Saídas', cartoes: cartoes.filter((c) => ['desqualificado', 'geladeira', 'perdido', 'parceiro'].includes(c.etapa)) },
    ],
  };
}

const TRES = [
  cartao('a', 'Marina Duarte', 'proposta', { empresa: 'Construtora Alicerce', dono: 'Ana Paula Souza', valorCentavos: 1_250_000, diasNaEtapa: 4, etapaDesde: '2026-10-18T15:00:00.000Z' }),
  cartao('b', 'Bruno Lima', 'qualificacao', { empresa: 'Beta Comércio', valorCentavos: null, diasNaEtapa: 9 }),
  cartao('c', 'Carla Reis', 'novo_lead', { empresa: 'Casa Comum', dono: 'Rui', valorCentavos: 300_000, diasNaEtapa: 1, reuniaoEm: '2026-10-23T17:30:00.000Z' }),
];

function irPara(url: string) {
  window.history.replaceState(null, '', url);
}

/** O jsdom não tem PointerEvent: o movimento vai como MouseEvent com o nome do evento de ponteiro. */
const apertar = (el: HTMLElement, clientX: number) => act(() => void el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX })));
const mover = (clientX: number) => act(() => void window.dispatchEvent(new MouseEvent('pointermove', { clientX })));
const ordemDasLinhas = () => within(screen.getByTestId('funil-lista')).getAllByRole('row').slice(1).map((r) => r.getAttribute('data-testid'));
const cabecalhos = () => within(screen.getByTestId('funil-lista')).getAllByRole('columnheader').map((c) => c.textContent);

beforeEach(() => {
  RESPOSTAS = {};
  gets.length = 0;
  window.localStorage.clear();
  irPara('/comercial/funil');
});
afterEach(() => cleanup());

describe('a lista do funil: as regras puras', () => {
  it('as colunas: o padrão, a empresa sempre, a ordem do catálogo e a chave desconhecida fora', () => {
    expect(lerColunas(null)).toEqual(COLUNAS_PADRAO);
    expect(lerColunas('nada,outra')).toEqual(COLUNAS_PADRAO);
    expect(lerColunas('valor,contato')).toEqual(['empresa', 'contato', 'valor']);
    expect(lerColunas(['reuniao', 'empresa', 'xyz'])).toEqual(['empresa', 'reuniao']);
    expect(colunasNoEndereco(COLUNAS_PADRAO)).toBe('');
    expect(colunasNoEndereco(['empresa', 'valor'])).toBe('empresa,valor');
    expect(alternarColuna(COLUNAS_PADRAO, 'empresa')).toEqual(COLUNAS_PADRAO);
    expect(alternarColuna(['empresa', 'valor'], 'valor')).toEqual(['empresa']);
    expect(alternarColuna(['empresa'], 'perfil')).toEqual(['empresa', 'perfil']);
  });

  it('a ordem: crescente, decrescente e sem ordem; aria-sort acompanha; coluna que não ordena não entra', () => {
    expect(lerOrdem('valor:desc')).toEqual({ chave: 'valor', direcao: 'desc' });
    expect(lerOrdem('pendencias:asc')).toBeNull();
    expect(lerOrdem('valor;drop')).toBeNull();
    let o = proximaOrdem(null, 'valor');
    expect(o).toEqual({ chave: 'valor', direcao: 'asc' });
    expect(ariaSort(o, 'valor')).toBe('ascending');
    expect(ariaSort(o, 'empresa')).toBe('none');
    o = proximaOrdem(o, 'valor');
    expect(ariaSort(o, 'valor')).toBe('descending');
    expect(proximaOrdem(o, 'valor')).toBeNull();
    expect(proximaOrdem(o, 'empresa')).toEqual({ chave: 'empresa', direcao: 'asc' });
  });

  it('ordenar: o vazio fica no fim nas duas direções, a etapa segue o funil, e o empate guarda a ordem da API', () => {
    const ids = (o: Parameters<typeof ordenarCartoes>[1]) => ordenarCartoes(TRES, o).map((c) => c.leadId);
    expect(ids({ chave: 'valor', direcao: 'asc' })).toEqual(['c', 'a', 'b']);
    expect(ids({ chave: 'valor', direcao: 'desc' })).toEqual(['a', 'c', 'b']);
    expect(ids({ chave: 'etapa', direcao: 'asc' })).toEqual(['c', 'b', 'a']);
    expect(ids({ chave: 'empresa', direcao: 'desc' })).toEqual(['a', 'c', 'b']);
    expect(ids({ chave: 'responsavel', direcao: 'asc' })).toEqual(['a', 'c', 'b']);
    expect(ids(null)).toEqual(['a', 'b', 'c']);
    const empate = [cartao('x', 'X', 'proposta', { diasNaEtapa: 2 }), cartao('y', 'Y', 'proposta', { diasNaEtapa: 2 })];
    expect(ordenarCartoes(empate, { chave: 'dias', direcao: 'desc' }).map((c) => c.leadId)).toEqual(['x', 'y']);
  });

  it('as larguras: presas entre o mínimo e o máximo, o guardado torto não derruba, e a tabela soma as visíveis', () => {
    expect(limitarLargura('empresa', 10)).toBe(colunaDa('empresa').minimo);
    expect(limitarLargura('empresa', 5000)).toBe(LARGURA_MAXIMA);
    expect(lerLarguras('{torto')).toEqual({});
    expect(lerLarguras('[1,2]')).toEqual({});
    expect(lerLarguras(JSON.stringify({ empresa: 300, inventada: 50, valor: 'x', contato: 2 }))).toEqual({ empresa: 300, contato: colunaDa('contato').minimo });
    expect(larguraDaTabela({ empresa: 300 }, ['empresa', 'valor'])).toBe(300 + colunaDa('valor').padrao);
  });

  it('o texto das células: reais em pt-BR, data e hora de São Paulo, iniciais do avatar', () => {
    expect(dinheiro(1_250_000)).toMatch(/R\$\s12\.500,00/);
    expect(dinheiro(null)).toBe('');
    // 02:00 em UTC ainda é o dia anterior em São Paulo.
    expect(dataCurta('2026-10-22T02:00:00.000Z', new Date('2026-10-22T12:00:00Z'))).toBe('21/10');
    expect(dataCurta('2025-03-05T15:00:00.000Z', new Date('2026-10-22T12:00:00Z'))).toBe('05/03/2025');
    expect(dataCompleta('2026-10-23T17:30:00.000Z')).toBe('23/10/2026 14:30');
    expect(iniciais('Ana Paula Souza')).toBe('AS');
    expect(iniciais('rui')).toBe('R');
    expect(iniciais('  ')).toBe('');
  });

  it('o endereço e a vista levam as colunas e a ordem; o padrão sai dos dois', () => {
    const f = filtrosDoFunilVazios();
    expect(escreverEnderecoDoFunil('?lead=x', 'lista', f, { colunas: ['empresa', 'valor'], ordem: { chave: 'valor', direcao: 'desc' } })).toBe('?lead=x&visao=lista&colunas=empresa%2Cvalor&ordem=valor%3Adesc');
    expect(escreverEnderecoDoFunil('?colunas=empresa&ordem=valor%3Aasc', 'lista', f, { colunas: COLUNAS_PADRAO, ordem: null })).toBe('?visao=lista');
    // Sem a lista, a função de antes não mexe nas chaves novas.
    expect(escreverEnderecoDoFunil('?colunas=empresa', 'quadro', f)).toBe('?colunas=empresa');
    const e = lerEnderecoDoFunil('?visao=lista&colunas=empresa,valor&ordem=valor:desc');
    expect(e).toMatchObject({ visao: 'lista', colunas: ['empresa', 'valor'], ordem: { chave: 'valor', direcao: 'desc' }, temFiltro: true });
    expect(lerEnderecoDoFunil('?ordem=valor:asc').temFiltro).toBe(true);
    expect(configDaVistaDoFunil('lista', f, { colunas: COLUNAS_PADRAO, ordem: null })).toEqual({ visao: 'lista', filtros: f });
    expect(configDaVistaDoFunil('lista', f, { colunas: ['empresa', 'valor'], ordem: { chave: 'valor', direcao: 'asc' } })).toEqual({ visao: 'lista', filtros: f, colunas: ['empresa', 'valor'], ordem: 'valor:asc' });
  });
});

describe('a lista do funil na tela', () => {
  it('formata: valor em reais, etapa como chip, responsável como avatar com o nome no balão, sem valor dito', async () => {
    RESPOSTAS['/comercial/funil'] = funil(TRES);
    irPara('/comercial/funil?visao=lista');
    render(<FunilPage />);
    const linha = await screen.findByTestId('funil-linha-a');
    expect(linha).toHaveTextContent(/R\$\s12\.500,00/);
    expect(within(linha).getByTitle('E6 · Proposta')).toHaveTextContent('E6 · Proposta');
    const avatar = within(linha).getByRole('img', { name: 'Responsável: Ana Paula Souza' });
    expect(avatar).toHaveTextContent('AS');
    expect(within(avatar).getByRole('tooltip', { hidden: true })).toHaveTextContent('Ana Paula Souza');
    expect(avatar).toHaveAttribute('tabindex', '0');
    expect(within(screen.getByTestId('funil-linha-b')).getByRole('img', { name: 'Sem responsável' })).toBeInTheDocument();
    expect(screen.getByTestId('funil-linha-b')).toHaveTextContent('sem valor');
    // O quadro não aparece; a linha inteira abre o lead.
    expect(screen.queryByTestId('funil-coluna-proposta')).toBeNull();
    expect(within(linha).getByRole('link', { name: 'Construtora Alicerce' })).toHaveAttribute('href', expect.stringContaining('lead=a'));
  });

  it('ordena pelo cabeçalho: aria-sort, a ordem das linhas e o endereço; o terceiro clique volta à ordem da API', async () => {
    RESPOSTAS['/comercial/funil'] = funil(TRES);
    irPara('/comercial/funil?visao=lista');
    render(<FunilPage />);
    await screen.findByTestId('funil-lista');
    const u = userEvent.setup();
    const th = screen.getByTestId('funil-lista-cabecalho-valor');
    expect(th).toHaveAttribute('aria-sort', 'none');
    await u.click(within(th).getByRole('button', { name: /Valor/ }));
    expect(th).toHaveAttribute('aria-sort', 'ascending');
    expect(ordemDasLinhas()).toEqual(['funil-linha-c', 'funil-linha-a', 'funil-linha-b']);
    expect(new URLSearchParams(window.location.search).get('ordem')).toBe('valor:asc');
    await u.click(within(th).getByRole('button', { name: /Valor/ }));
    expect(th).toHaveAttribute('aria-sort', 'descending');
    expect(ordemDasLinhas()).toEqual(['funil-linha-a', 'funil-linha-c', 'funil-linha-b']);
    await u.click(within(th).getByRole('button', { name: /Valor/ }));
    expect(th).toHaveAttribute('aria-sort', 'none');
    // A ordem da API: as colunas do funil, da primeira etapa à última.
    expect(ordemDasLinhas()).toEqual(['funil-linha-c', 'funil-linha-b', 'funil-linha-a']);
    expect(window.location.search).toBe('?visao=lista');
    // Pendências não ordena: nem botão nem aria-sort.
    expect(screen.getByTestId('funil-lista-cabecalho-pendencias')).not.toHaveAttribute('aria-sort');
  });

  it('colunas visíveis no painel de Filtros: só na lista, a empresa fica, vão ao endereço e não contam como filtro', async () => {
    RESPOSTAS['/comercial/funil'] = funil(TRES);
    render(<FunilPage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId('funil-filtros-botao'));
    expect(screen.queryByTestId('funil-colunas')).toBeNull();
    await u.click(screen.getByTestId('funil-filtros-botao'));
    await u.click(screen.getByTestId('funil-visao-lista'));
    await u.click(screen.getByTestId('funil-filtros-botao'));
    const painel = screen.getByTestId('funil-filtros-painel');
    expect(within(painel).getByTestId('funil-colunas-empresa')).toBeDisabled();
    await u.click(within(painel).getByTestId('funil-colunas-contato'));
    await u.click(within(painel).getByTestId('funil-colunas-reuniao'));
    expect(cabecalhos()).toEqual(['Empresa', 'Etapa', 'Responsável', 'Produto', 'Valor', 'Dias na etapa', 'Reunião', 'Próxima ação', 'Pendências']);
    expect(new URLSearchParams(window.location.search).get('colunas')).toBe('empresa,etapa,responsavel,produto,valor,dias,reuniao,proxima,pendencias');
    expect(screen.getByTestId('funil-linha-c')).toHaveTextContent('23/10 14:30');
    expect(screen.queryByTestId('funil-filtros-contagem')).toBeNull();
    await u.click(within(painel).getByTestId('funil-colunas-padrao'));
    expect(cabecalhos()).toEqual(['Empresa', 'Contato', 'Etapa', 'Responsável', 'Produto', 'Valor', 'Dias na etapa', 'Próxima ação', 'Pendências']);
    expect(window.location.search).toBe('?visao=lista');
  });

  it('a vista salva leva as colunas e a ordem: a vista padrão abre a lista como foi guardada', async () => {
    RESPOSTAS['/comercial/funil'] = funil(TRES);
    RESPOSTAS['/trabalho/vistas'] = [{
      id: 'v1', tela: 'funil', nome: 'Por valor', padrao: true,
      config: { visao: 'lista', filtros: filtrosDoFunilVazios(), colunas: ['empresa', 'valor'], ordem: 'valor:desc' },
    }];
    render(<FunilPage />);
    await waitFor(() => expect(cabecalhos()).toEqual(['Empresa', 'Valor']));
    expect(ordemDasLinhas()).toEqual(['funil-linha-a', 'funil-linha-c', 'funil-linha-b']);
    expect(new URLSearchParams(window.location.search).get('ordem')).toBe('valor:desc');
  });

  it('a largura: a guardada no navegador vale, a borda ajusta pelo teclado e pelo arraste, e fica guardada', async () => {
    window.localStorage.setItem(CHAVE_DAS_LARGURAS, JSON.stringify({ empresa: 300 }));
    RESPOSTAS['/comercial/funil'] = funil(TRES);
    irPara('/comercial/funil?visao=lista');
    const { container } = render(<FunilPage />);
    await screen.findByTestId('funil-lista');
    const col = (k: string) => container.querySelector<HTMLElement>(`col[data-coluna="${k}"]`)!;
    await waitFor(() => expect(col('empresa').style.width).toBe('300px'));
    const borda = screen.getByTestId('funil-lista-borda-empresa');
    expect(borda).toHaveAttribute('role', 'separator');
    expect(borda).toHaveAccessibleName('Largura da coluna Empresa');
    borda.focus();
    fireEvent.keyDown(borda, { key: 'ArrowRight' });
    expect(col('empresa').style.width).toBe('316px');
    expect(JSON.parse(window.localStorage.getItem(CHAVE_DAS_LARGURAS)!)).toEqual({ empresa: 316 });

    const valor = screen.getByTestId('funil-lista-borda-valor');
    apertar(valor, 500);
    mover(560);
    fireEvent.pointerUp(window);
    expect(col('valor').style.width).toBe(`${colunaDa('valor').padrao + 60}px`);
    expect(JSON.parse(window.localStorage.getItem(CHAVE_DAS_LARGURAS)!)).toMatchObject({ valor: colunaDa('valor').padrao + 60 });
    // Arrastar para menos do que o mínimo para no mínimo; dois cliques voltam ao padrão.
    apertar(valor, 500);
    mover(0);
    fireEvent.pointerUp(window);
    expect(col('valor').style.width).toBe(`${colunaDa('valor').minimo}px`);
    fireEvent.doubleClick(valor);
    expect(col('valor').style.width).toBe(`${colunaDa('valor').padrao}px`);
  });

  it('a rolagem para o lado é só da tabela, e abaixo de 640 px a lista vira cartões com as mesmas colunas', async () => {
    RESPOSTAS['/comercial/funil'] = funil(TRES);
    irPara('/comercial/funil?visao=lista&ordem=valor:desc');
    render(<FunilPage />);
    const tabela = await screen.findByTestId('funil-lista');
    expect(tabela.className).toContain('overflow-auto');
    expect(tabela.className).toContain('max-w-full');
    expect(tabela.className).toContain('max-[639px]:hidden');
    const pilha = screen.getByTestId('funil-lista-cartoes');
    expect(pilha.className).toContain('min-[640px]:hidden');
    const cartoes = within(pilha).getAllByRole('listitem');
    expect(cartoes.map((c) => c.querySelector('[data-testid^="funil-lista-cartao-"]')?.getAttribute('data-testid'))).toEqual([
      'funil-lista-cartao-a', 'funil-lista-cartao-c', 'funil-lista-cartao-b',
    ]);
    const a = screen.getByTestId('funil-lista-cartao-a');
    expect(within(a).getByRole('link', { name: 'Construtora Alicerce' })).toBeInTheDocument();
    for (const t of ['Contato', 'Marina Duarte', 'Valor', 'Ana Paula Souza', 'E6 · Proposta']) expect(a).toHaveTextContent(t);
  });
});
