import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EquipeDaEmpresa, FuncaoNaEquipe, PessoaNaEquipe } from '@mktos/shared';

/*
 * A EQUIPE (rodada dos agentes, 21/10/2026, A7) — `/organograma`.
 *
 *  · as três pessoas, e sob cada uma os agentes, rotinas e automações por área;
 *  · o dono se troca no seletor (só para quem pode), e vai à API;
 *  · o WhatsApp de cada pessoa: a tela confere o número antes de mandar, e só
 *    oferece o campo a quem pode cadastrar;
 *  · o que ficou fora da vista é contado, nada some calado.
 */

const apiGet = vi.fn();
const apiPut = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u-r' }, can: () => true }),
}));

// eslint-disable-next-line import/first
import EquipePage from '@/app/organograma/page';

function funcao(over: Partial<FuncaoNaEquipe>): FuncaoNaEquipe {
  return {
    id: 'CO-03',
    slug: 'leitor-de-ata-do-comercial',
    nome: 'Leitor de ata do comercial',
    area: 'Comercial',
    tipo: 'agente',
    estado: 'ativo',
    paraQueServe: '',
    dono: { efetivo: { id: 'u-l', nome: 'Lucas' }, origem: 'padrao', padrao: 'lucas', bancoForaDaEquipe: false },
    guardadoEm: 'equipe',
    ...over,
  };
}

function pessoa(id: string, nome: string, areas: PessoaNaEquipe['areas'], over: Partial<PessoaNaEquipe> = {}): PessoaNaEquipe {
  return {
    id,
    nome,
    papeis: ['diretor'],
    whatsapp: { cadastrado: false, final: null, numero: null },
    podeEditarWhatsapp: true,
    areas,
    fotoUrl: null,
    aniversario: null,
    cargo: null,
    atribuicoes: { nomeNoVault: null, origemDoNome: 'a_decidir', conduz: null, dona: [], substituta: [], nota: null },
    ...over,
  };
}

function equipe(over: Partial<EquipeDaEmpresa> = {}): EquipeDaEmpresa {
  return {
    pessoas: [
      pessoa('u-l', 'Lucas', [
        { area: 'Comercial', funcoes: [funcao({}), funcao({ id: 'CO-07', slug: 'follow-up', nome: 'Follow-up', tipo: 'rotina' })] },
      ]),
      pessoa('u-p', 'Pedro', [
        { area: 'Implantação', funcoes: [funcao({ id: 'IM-01', slug: 'leitor-de-ata', nome: 'Leitor de ata do onboarding', area: 'Implantação', dono: { efetivo: { id: 'u-p', nome: 'Pedro' }, origem: 'banco', padrao: 'pedro', bancoForaDaEquipe: false } })] },
        { area: 'Canais e integrações', funcoes: [funcao({ id: 'CA-02', slug: 'aprovacao-pelo-whatsapp', nome: 'Aprovação pelo WhatsApp', area: 'Canais e integrações', tipo: 'automacao' })] },
      ], { whatsapp: { cadastrado: true, final: '…0001', numero: null }, podeEditarWhatsapp: false }),
      pessoa('u-r', 'Rodrigo', [{ area: 'Agenda', funcoes: [funcao({ id: 'AG-01', slug: 'vigia-da-agenda', nome: 'Vigia da agenda', area: 'Agenda' })] }], {
        papeis: ['admin_master'],
        whatsapp: { cadastrado: true, final: '…8888', numero: '+55 (32) 99999-8888' },
      }),
    ],
    semDono: [],
    foraDaVista: { sistema: 3, teste: 2 },
    podeEditarDono: true,
    totais: { pessoas: 3, agentes: 3, rotinas: 1, automacoes: 1 },
    memoria: { disponivel: false, motivo: 'ausente', frase: 'Memória da Root indisponível: as notas da Governança e da Organização não estão no vault indexado.', socios: [] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue(equipe());
  apiPut.mockResolvedValue({});
});
afterEach(() => cleanup());

describe('a Equipe', () => {
  it('mostra as três pessoas e, sob cada uma, as funções por área', async () => {
    render(<EquipePage />);
    const lucas = await screen.findByRole('region', { name: 'Lucas' });
    expect(screen.getAllByRole('region').filter((r) => ['Lucas', 'Pedro', 'Rodrigo'].includes(r.getAttribute('aria-label') ?? ''))).toHaveLength(3);
    expect(within(lucas).getByText('Comercial')).toBeInTheDocument();
    expect(within(lucas).getByTestId('funcao-follow-up')).toHaveTextContent('rotina');
    const pedro = screen.getByRole('region', { name: 'Pedro' });
    expect(within(pedro).getByText('Implantação')).toBeInTheDocument();
    expect(within(pedro).getByTestId('funcao-aprovacao-pelo-whatsapp')).toHaveTextContent('automação');
    expect(apiGet).toHaveBeenCalledWith('/organograma/equipe', 'tok');
  });

  it('conta o que ficou fora da vista, sem apagar', async () => {
    render(<EquipePage />);
    expect(await screen.findByText(/Fora da vista, sem apagar nada: conta do sistema: 3 · conta de teste: 2/)).toBeInTheDocument();
  });
});

describe('o dono', () => {
  it('trocar no seletor vai à API e recarrega', async () => {
    render(<EquipePage />);
    const sel = await screen.findByLabelText('Dono de Follow-up');
    expect(sel).toHaveValue('');
    await userEvent.selectOptions(sel, 'u-p');
    expect(apiPut).toHaveBeenCalledWith('/organograma/dono/follow-up', { userId: 'u-p' }, 'tok');
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
  });

  it('o dono gravado aparece selecionado; voltar ao padrão manda null', async () => {
    render(<EquipePage />);
    const sel = await screen.findByLabelText('Dono de Leitor de ata do onboarding');
    expect(sel).toHaveValue('u-p');
    await userEvent.selectOptions(sel, '');
    expect(apiPut).toHaveBeenCalledWith('/organograma/dono/leitor-de-ata', { userId: null }, 'tok');
  });

  it('quem não pode editar não vê o seletor', async () => {
    apiGet.mockResolvedValue(equipe({ podeEditarDono: false }));
    render(<EquipePage />);
    await screen.findByRole('region', { name: 'Lucas' });
    expect(screen.queryByLabelText('Dono de Follow-up')).toBeNull();
  });
});

describe('o WhatsApp de cada pessoa', () => {
  it('mostra o número inteiro a quem pode e só o final a quem não pode; campo só para quem pode', async () => {
    render(<EquipePage />);
    const rodrigo = await screen.findByRole('region', { name: 'Rodrigo' });
    expect(within(rodrigo).getByText('+55 (32) 99999-8888')).toBeInTheDocument();
    const pedro = screen.getByRole('region', { name: 'Pedro' });
    expect(within(pedro).getByText('…0001')).toBeInTheDocument();
    expect(within(pedro).queryByLabelText('WhatsApp de Pedro')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Lucas' })).getByText('sem número')).toBeInTheDocument();
  });

  it('número torto não sai da tela; o certo vai à API', async () => {
    render(<EquipePage />);
    const lucas = await screen.findByRole('region', { name: 'Lucas' });
    await userEvent.type(within(lucas).getByLabelText('WhatsApp de Lucas'), '+55 20 99999-0001');
    await userEvent.click(within(lucas).getByRole('button', { name: 'salvar número' }));
    expect(within(lucas).getByRole('alert')).toHaveTextContent('DDD 20');
    expect(apiPut).not.toHaveBeenCalled();

    await userEvent.clear(within(lucas).getByLabelText('WhatsApp de Lucas'));
    await userEvent.type(within(lucas).getByLabelText('WhatsApp de Lucas'), '32 99999-0001');
    await userEvent.click(within(lucas).getByRole('button', { name: 'salvar número' }));
    expect(apiPut).toHaveBeenCalledWith('/organograma/pessoas/u-l/whatsapp', { numero: '32 99999-0001' }, 'tok');
  });

  it('a recusa da API (número de outra pessoa) aparece na tela', async () => {
    apiPut.mockRejectedValue(new Error('Este número já está cadastrado para outra pessoa.'));
    render(<EquipePage />);
    const lucas = await screen.findByRole('region', { name: 'Lucas' });
    await userEvent.type(within(lucas).getByLabelText('WhatsApp de Lucas'), '32 99999-8888');
    await userEvent.click(within(lucas).getByRole('button', { name: 'salvar número' }));
    expect(await within(lucas).findByRole('alert')).toHaveTextContent('outra pessoa');
  });

  it('remover manda null', async () => {
    render(<EquipePage />);
    const rodrigo = await screen.findByRole('region', { name: 'Rodrigo' });
    await userEvent.click(within(rodrigo).getByRole('button', { name: 'remover número' }));
    expect(apiPut).toHaveBeenCalledWith('/organograma/pessoas/u-r/whatsapp', { numero: null }, 'tok');
  });
});

/*
 * Produção 22B (I6): o avatar, o aniversário (só dia e mês) e as atribuições
 * lidas do vault da Root (só leitura), com o link da ficha para o Contexto.
 * Os nomes do vault aqui são os do dublê (Alice, Bruno, Clara).
 */
describe('a Equipe com o perfil e a memória da Root', () => {
  const comVault = () =>
    equipe({
      memoria: { disponivel: true, motivo: null, frase: null, socios: ['Alice', 'Bruno', 'Clara'] },
      pessoas: [
        pessoa('u-l', 'Lucas', [], {
          cargo: 'Sócio comercial',
          aniversario: '03-12',
          atribuicoes: {
            nomeNoVault: 'Alice',
            origemDoNome: 'perfil',
            conduz: 'Comercial e relacionamento',
            dona: [
              { nome: 'Comercial', caminho: '30-Organizacao/Função — Comercial.md', notaId: 'n-com', estado: 'ativo', agentes: 'Qualificador' },
              { nome: 'Governança', caminho: null, notaId: null, estado: null, agentes: null },
            ],
            substituta: [{ nome: 'Produto', caminho: null, notaId: 'n-prod', estado: 'ativo', agentes: null }],
            nota: { caminho: '20-Governanca/Alice.md', notaId: 'n-alice' },
          },
        }),
        pessoa('u-p', 'Pedro', [], {
          atribuicoes: { nomeNoVault: 'Bruno', origemDoNome: 'sugerido', conduz: 'Produto', dona: [], substituta: [], nota: null },
        }),
        pessoa('u-r', 'Rodrigo', [], { papeis: ['admin_master'] }),
      ],
    });

  it('cada pessoa tem o avatar (iniciais sem foto) com o nome acessível, o cargo e o aniversário', async () => {
    apiGet.mockResolvedValue(comVault());
    render(<EquipePage />);
    const lucas = await screen.findByRole('region', { name: 'Lucas' });
    expect(within(lucas).getByRole('img', { name: 'Lucas' })).toHaveTextContent('L');
    expect(within(lucas).getByText(/Sócio comercial/)).toBeInTheDocument();
    expect(within(lucas).getByTestId('aniversario-u-l')).toHaveTextContent('aniversário 12 de março');
  });

  it('o que conduz, as funções de que é dona e as de que é substituta, com o link da ficha no Contexto', async () => {
    apiGet.mockResolvedValue(comVault());
    render(<EquipePage />);
    const lucas = await screen.findByRole('region', { name: 'Lucas' });
    const vault = within(lucas).getByTestId('vault-u-l');
    expect(vault).toHaveTextContent('Conduz Comercial e relacionamento');
    expect(within(vault).getByRole('link', { name: 'Comercial' })).toHaveAttribute('href', '/contexto?nota=n-com');
    expect(within(vault).getByText('Governança')).toBeInTheDocument();
    expect(within(vault).queryByRole('link', { name: 'Governança' })).toBeNull();
    expect(vault).toHaveTextContent('Substituta em');
    expect(within(vault).getByRole('link', { name: 'Produto' })).toHaveAttribute('href', '/contexto?nota=n-prod');
    expect(within(vault).getByRole('link', { name: 'nota' })).toHaveAttribute('href', '/contexto?nota=n-alice');
  });

  it('nome sugerido pelo primeiro nome diz que é sugestão; sem nome fica [a decidir] com o caminho do perfil', async () => {
    apiGet.mockResolvedValue(comVault());
    render(<EquipePage />);
    const pedro = await screen.findByRole('region', { name: 'Pedro' });
    expect(within(pedro).getByTestId('vault-u-p')).toHaveTextContent('sugerido pelo primeiro nome');
    const rodrigo = screen.getByRole('region', { name: 'Rodrigo' });
    expect(within(rodrigo).getByTestId('vault-u-r')).toHaveTextContent('Nome no vault [a decidir]');
    expect(within(rodrigo).getByRole('link', { name: 'preencher no perfil' })).toHaveAttribute('href', '/perfil?pessoa=u-r');
  });

  it('sem o vault: "memória da Root indisponível", e a Equipe segue de pé', async () => {
    render(<EquipePage />);
    expect(await screen.findByTestId('memoria-indisponivel')).toHaveTextContent('Memória da Root indisponível');
    expect(screen.queryByTestId('vault-u-l')).toBeNull();
    expect(screen.getByRole('region', { name: 'Lucas' })).toBeInTheDocument();
  });
});
