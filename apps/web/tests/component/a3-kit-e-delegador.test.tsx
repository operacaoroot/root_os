import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DelegacaoDaTarefa, KitEPastaDoCard } from '@mktos/shared';

/*
 * O KIT NO CARD DA IMPLANTAÇÃO (IM-07) E O DELEGADOR NO POP-UP DA TAREFA (TR-09),
 * rodada dos agentes, 21/10/2026.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a), apiPost: (...a: unknown[]) => apiPost(...a) };
});
let PODE = true;
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => PODE }) }));

// eslint-disable-next-line import/first
import { KitDaImplantacao } from '@/components/trabalho/KitDaImplantacao';
// eslint-disable-next-line import/first
import { DelegadorDaTarefa } from '@/components/trabalho/DelegadorDaTarefa';

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  PODE = true;
});

describe('IM-07 · o kit no card', () => {
  const semKit: KitEPastaDoCard = { etapaDoCard: 'Kit montado', kit: null, avisoSemKit: true, cliente: { partnerId: 'p1', pastaUrl: 'https://drive.exemplo/pasta', pastaErro: null } };

  it('em "Kit montado" sem kit: aviso, botão "Montar kit" e o link da pasta do cliente', async () => {
    apiGet.mockResolvedValue(semKit);
    render(<KitDaImplantacao trilhoId="t1" token="tok" />);
    expect(await screen.findByTestId('kit-aviso')).toHaveTextContent('nada trava');
    expect(screen.getByTestId('kit-montar')).toHaveTextContent('Montar kit');
    expect(screen.getByRole('link', { name: 'Abrir pasta do cliente' }).getAttribute('href')).toBe('https://drive.exemplo/pasta');
    expect(apiGet).toHaveBeenCalledWith('/tenants/onboarding/trilhos/t1/kit', 'tok');
  });

  it('montar chama a rota do kit e mostra o estado da cópia; o aviso some', async () => {
    apiGet.mockResolvedValue(semKit);
    apiPost.mockResolvedValue({
      montadoEm: '2026-10-21T12:00:00.000Z', montadoPor: 'Rodrigo', arquivo: 'kit-padaria.md',
      secoes: [{ titulo: 'Objetivos', itens: 2 }], avisos: [], copia: { estado: 'aguardando_aprovacao', motivo: null },
    });
    render(<KitDaImplantacao trilhoId="t1" token="tok" />);
    fireEvent.click(await screen.findByTestId('kit-montar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/tenants/onboarding/trilhos/t1/kit', {}, 'tok'));
    expect(await screen.findByTestId('kit-estado')).toHaveTextContent('kit-padaria.md');
    expect(screen.getByTestId('kit-estado')).toHaveTextContent('esperando aprovação');
    expect(screen.queryByTestId('kit-aviso')).toBeNull();
    expect(screen.getByTestId('kit-montar')).toHaveTextContent('Montar de novo');
  });

  it('sem tarefas.editar não há botão', async () => {
    PODE = false;
    apiGet.mockResolvedValue({ ...semKit, avisoSemKit: false });
    render(<KitDaImplantacao trilhoId="t1" token="tok" />);
    await screen.findByTestId('kit-pasta');
    expect(screen.queryByTestId('kit-montar')).toBeNull();
  });
});

describe('TR-09 · o delegador no pop-up', () => {
  const com: DelegacaoDaTarefa = {
    atribuidaAAgente: true,
    agente: 'Arquivista do cliente',
    sugestoes: [
      { id: 's1', taskId: 'tk', titulo: 'Ligar para o cliente', descricao: '', donoTipo: 'pessoa', donoUsuarioId: 'u1', donoNome: 'Ana', donoFuncao: null, prazo: '2026-10-30', porque: 'é a dona', estado: 'rascunho', subtarefaId: null, decididaEm: null },
    ],
  };

  it('tarefa que não está com agente: o delegador não aparece', async () => {
    apiGet.mockResolvedValue({ atribuidaAAgente: false, agente: null, sugestoes: [] });
    const { container } = render(<DelegadorDaTarefa taskId="tk" />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="delegador"]')).toBeNull();
  });

  it('a sugestão espera gente: aceitar chama a rota e avisa o pop-up; nada é aceito sozinho', async () => {
    apiGet.mockResolvedValue(com);
    apiPost.mockResolvedValue({});
    const criou = vi.fn();
    render(<DelegadorDaTarefa taskId="tk" aoCriarSubtarefa={criou} />);
    expect(await screen.findByTestId('delegacao-s1')).toHaveTextContent('Pessoa: Ana · prazo 30/10/2026');
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('delegacao-aceitar-s1'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/delegacoes/s1/aceitar', {}, 'tok'));
    await waitFor(() => expect(criou).toHaveBeenCalled());
  });

  it('propor chama o delegador da tarefa', async () => {
    apiGet.mockResolvedValue({ ...com, sugestoes: [] });
    apiPost.mockResolvedValue(com);
    render(<DelegadorDaTarefa taskId="tk" />);
    fireEvent.click(await screen.findByTestId('delegador-propor'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trabalho/tarefas/tk/delegacao/propor', {}, 'tok'));
  });
});
