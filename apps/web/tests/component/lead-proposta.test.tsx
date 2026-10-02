import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeadCondicoesLeitura, LeadPropostaLeitura } from '@mktos/shared';

/*
 * ROOT-49 — o bloco "Proposta e aceite" da tela do lead: o estado, o documento,
 * as condições lidas do card, e os dois registros (proposta e decisão do
 * cliente). Registrar não envia nada ao cliente; a tela diz isso.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
let PERMISSOES: string[] = [];

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'lead-1' }) }));

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: vi.fn(),
    apiPut: vi.fn(),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import LeadDetailPage from '@/app/leads/[id]/page';
// eslint-disable-next-line import/first
import { ErroDaApi } from '@/lib/api';

const HASH = 'a'.repeat(64);
const SHA = 'b'.repeat(64);

const LEAD = {
  id: 'lead-1',
  name: 'Maria Souza',
  email: 'maria@exemplo.com',
  phone: null,
  status: 'novo',
  score: null,
  nextAction: null,
  owner: null,
  origem: { tipo: 'clickup', ref: 'cu-1' },
  avisos: { possivelMesmaPessoa: [] },
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  landingPage: null,
  enteredAt: '2026-10-01T12:00:00.000Z',
  source: null,
  campaign: null,
  events: [],
};

const CONDICOES: LeadCondicoesLeitura = {
  card: { id: 'card-1', titulo: 'Maria Souza — Root' },
  motivo: null,
  hash: HASH,
  propostaVigente: null,
  propostaVigenteResumo: null,
  condicoes: {
    cardId: 'card-1',
    inicio: null,
    vencimento: '2026-12-15T00:00:00.000Z',
    campos: [
      { campoId: 'f-valor', nome: 'Valor em negociação', tipo: 'moeda', valor: 'BRL 1500.00' },
      { campoId: 'f-per', nome: 'Periodicidade', tipo: 'periodicidade', valor: 'Mensal' },
      { campoId: 'f-data', nome: 'Data da reunião', tipo: 'data', valor: '1792022400000' },
    ],
  },
};

const SEM_PROPOSTA: LeadPropostaLeitura = { estado: 'sem_proposta', proposta: null, decisao: null };

const COM_PROPOSTA: LeadPropostaLeitura = {
  estado: 'proposta_registrada',
  decisao: null,
  proposta: {
    eventoId: 'ev-p',
    documento: { tipo: 'link', url: 'https://drive.exemplo/proposta-v1', sha256: SHA, titulo: 'Proposta v1' },
    cardId: 'card-1',
    condicoesHash: HASH,
    registradaEm: '2026-10-02T10:00:00.000Z',
    ator: 'u-eu',
  },
};

function servir(leitura: LeadPropostaLeitura, cond: LeadCondicoesLeitura = CONDICOES) {
  apiGet.mockImplementation(async (path: string) => {
    if (path === '/leads/lead-1') return LEAD;
    if (path === '/leads/lead-1/proposta') return leitura;
    if (path.startsWith('/leads/lead-1/proposta/condicoes')) return cond;
    throw new Error(`GET inesperado: ${path}`);
  });
}

const TUDO = ['leads.ver', 'leads.editar', 'tarefas.ver'];

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  PERMISSOES = TUDO;
});

describe('ROOT-49: Proposta e aceite na tela do lead', () => {
  it('sem proposta: mostra o estado, as condições do card formatadas e o formulário da proposta', async () => {
    servir(SEM_PROPOSTA);
    render(<LeadDetailPage />);
    expect(await screen.findByText('Sem proposta')).toBeInTheDocument();
    expect(await screen.findByText(/Valor em negociação: R\$\s?1\.500,00/)).toBeInTheDocument();
    expect(screen.getByText(/Periodicidade: Mensal/)).toBeInTheDocument();
    expect(screen.getByText(/Vencimento: 15\/12\/2026/)).toBeInTheDocument();
    // Data do card é dia, não instante: 00:00Z não pode virar o dia anterior no Brasil.
    expect(screen.getByText(/Data da reunião: 15\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar proposta' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Registrar aceite/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Registrar não envia nada ao cliente/)).toBeInTheDocument();
  });

  it('sem tarefas.ver a tela nem pede as condições e não oferece nenhum registro', async () => {
    PERMISSOES = ['leads.ver', 'leads.editar'];
    servir(COM_PROPOSTA);
    render(<LeadDetailPage />);
    expect(await screen.findByText('Proposta registrada')).toBeInTheDocument();
    expect(screen.getByText(/não tem acesso às tarefas/)).toBeInTheDocument();
    expect(apiGet.mock.calls.some(([p]) => String(p).includes('/condicoes'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Registrar proposta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar aceite/ })).not.toBeInTheDocument();
  });

  it('sem leads.editar só lê: o estado e as condições aparecem, os formulários não', async () => {
    PERMISSOES = ['leads.ver', 'tarefas.ver'];
    servir(COM_PROPOSTA);
    render(<LeadDetailPage />);
    expect(await screen.findByText('Proposta registrada')).toBeInTheDocument();
    expect(await screen.findByText(/Valor em negociação/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar proposta' })).not.toBeInTheDocument();
  });

  it('registra a proposta com o link, o sha256 e o título; depois recarrega', async () => {
    servir(SEM_PROPOSTA);
    apiPost.mockResolvedValue({ id: 'lead-1', replayed: false });
    render(<LeadDetailPage />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Link do documento'), 'https://drive.exemplo/proposta-v1');
    await user.type(screen.getByLabelText('sha256 do documento'), SHA);
    await user.type(screen.getByLabelText('Título da proposta'), 'Proposta v1');
    await user.click(screen.getByRole('button', { name: 'Registrar proposta' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith(
      '/leads/lead-1/proposta',
      { documento: { tipo: 'link', url: 'https://drive.exemplo/proposta-v1', sha256: SHA, titulo: 'Proposta v1' } },
      'tok',
    );
    expect(await screen.findByText(/Proposta registrada\. Nada foi enviado ao cliente/)).toBeInTheDocument();
  });

  it('registra o aceite com a evidência, o hash e as condições que a tela mostrou', async () => {
    servir(COM_PROPOSTA, { ...CONDICOES, propostaVigente: true });
    apiPost.mockResolvedValue({ id: 'lead-1', replayed: false });
    render(<LeadDetailPage />);
    const user = userEvent.setup();
    const botao = await screen.findByRole('button', { name: 'Registrar aceite' });
    expect(botao).toBeDisabled();
    await user.type(screen.getByLabelText('Link da evidência'), 'https://drive.exemplo/aceite');
    expect(botao).toBeEnabled();
    await user.click(botao);
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [caminho, corpo, token] = apiPost.mock.calls[0];
    expect(caminho).toBe('/leads/lead-1/aceite');
    expect(token).toBe('tok');
    expect(corpo).toMatchObject({
      decisao: 'aceite',
      evidencia: { tipo: 'link', url: 'https://drive.exemplo/aceite' },
      condicoesHash: HASH,
      condicoesVistas: { cardId: 'card-1' },
    });
  });

  it('a evidência por mensagem leva o canal e o texto; a recusa troca o botão', async () => {
    servir(COM_PROPOSTA, { ...CONDICOES, propostaVigente: true });
    apiPost.mockResolvedValue({ id: 'lead-1', replayed: false });
    render(<LeadDetailPage />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Tipo de evidência'), 'mensagem');
    await user.selectOptions(screen.getByLabelText('Decisão'), 'recusa');
    await user.type(screen.getByLabelText('Texto da mensagem'), 'Vamos pensar mais');
    await user.click(screen.getByRole('button', { name: 'Registrar recusa' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(apiPost.mock.calls[0][1]).toMatchObject({ decisao: 'recusa', evidencia: { tipo: 'mensagem', canal: 'whatsapp', texto: 'Vamos pensar mais' } });
  });

  it('card que mudou depois da proposta: avisa e trava o aceite até registrar a proposta de novo', async () => {
    servir(COM_PROPOSTA, { ...CONDICOES, propostaVigente: false });
    render(<LeadDetailPage />);
    expect(await screen.findByText(/O card mudou depois da última proposta/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Link da evidência'), 'https://drive.exemplo/aceite');
    expect(screen.getByRole('button', { name: 'Registrar aceite' })).toBeDisabled();
  });

  it('card que voltou às condições de uma proposta antiga: o aceite abre e a proposta mostrada é a vigente, não a última', async () => {
    const H2 = 'c'.repeat(64);
    const v1 = COM_PROPOSTA.proposta!;
    const v2 = { ...v1, eventoId: 'ev-p2', documento: { ...v1.documento, url: 'https://drive.exemplo/proposta-v2', titulo: 'Proposta v2' }, condicoesHash: H2, registradaEm: '2026-10-03T10:00:00.000Z' };
    // A última registrada (v2) é de outras condições; o card voltou às da v1, que é a que a decisão vai citar.
    servir({ ...COM_PROPOSTA, proposta: v2 }, { ...CONDICOES, propostaVigente: true, propostaVigenteResumo: v1 });
    apiPost.mockResolvedValue({ id: 'lead-1', replayed: false });
    render(<LeadDetailPage />);
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: 'Proposta v1' })).toHaveAttribute('href', 'https://drive.exemplo/proposta-v1');
    expect(screen.queryByRole('link', { name: 'Proposta v2' })).not.toBeInTheDocument();
    expect(screen.queryByText(/O card mudou depois da última proposta/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Link da evidência'), 'https://drive.exemplo/aceite');
    const botao = screen.getByRole('button', { name: 'Registrar aceite' });
    expect(botao).toBeEnabled();
    await user.click(botao);
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost.mock.calls[0][1]).toMatchObject({ decisao: 'aceite', condicoesHash: HASH });
  });

  it('409 (as condições mudaram): mostra a mensagem da API e relê as condições', async () => {
    servir(COM_PROPOSTA, { ...CONDICOES, propostaVigente: true });
    apiPost.mockRejectedValue(new ErroDaApi('As condições do card mudaram desde o que foi visto; releia as condições e registre de novo', 409, 'Conflict'));
    render(<LeadDetailPage />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Link da evidência'), 'https://drive.exemplo/aceite');
    const leiturasAntes = apiGet.mock.calls.filter(([p]) => String(p).includes('/condicoes')).length;
    await user.click(screen.getByRole('button', { name: 'Registrar aceite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/As condições do card mudaram/);
    await waitFor(() => expect(apiGet.mock.calls.filter(([p]) => String(p).includes('/condicoes')).length).toBeGreaterThan(leiturasAntes));
  });

  it('aceite registrado: mostra a decisão e a evidência (sem o texto da mensagem na tela)', async () => {
    servir(
      {
        ...COM_PROPOSTA,
        estado: 'aceite_registrado',
        decisao: {
          eventoId: 'ev-a',
          decisao: 'aceite',
          propostaEventoId: 'ev-p',
          condicoesHash: HASH,
          evidencia: { tipo: 'mensagem', canal: 'whatsapp', texto: 'Aceito, pode seguir' },
          motivo: 'Fechou por telefone',
          registradaEm: '2026-10-02T12:00:00.000Z',
          ator: 'u-eu',
        },
      },
      { ...CONDICOES, propostaVigente: true },
    );
    render(<LeadDetailPage />);
    expect(await screen.findByText('Aceite registrado')).toBeInTheDocument();
    expect(screen.getByText(/Evidência: Mensagem · Fechou por telefone/)).toBeInTheDocument();
    expect(screen.queryByText(/Aceito, pode seguir/)).not.toBeInTheDocument();
    expect(screen.getByText(/Já há uma decisão registrada/)).toBeInTheDocument();
  });

  it('lead sem card ligado: mostra o motivo e deixa escolher o card pelo id para ler as condições', async () => {
    servir(SEM_PROPOSTA, { card: null, motivo: 'Este lead não tem card comercial ligado; informe o card da proposta', condicoes: null, hash: null, propostaVigente: null, propostaVigenteResumo: null });
    render(<LeadDetailPage />);
    expect(await screen.findByText(/não tem card comercial ligado/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Card comercial (id)'), 'card-9');
    await user.click(screen.getByRole('button', { name: 'Ler condições' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/leads/lead-1/proposta/condicoes?cardId=card-9', 'tok'));
  });
});
