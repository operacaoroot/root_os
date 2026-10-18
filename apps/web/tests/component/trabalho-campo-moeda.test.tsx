import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * O CAMPO `moeda` NA GAVETA E NA TABELA (ROOT-06a).
 *
 * O valor gravado é o texto canônico `BRL 1500.00`. A gaveta mostra o mesmo
 * valor como se digita em pt-BR (`1.500,00`), com a moeda ao lado, e a tabela
 * mostra `R$ 1.500,00`. Sair do campo sem editar não vai à API; a edição vai
 * no canônico; digitação que não lê (ponto decimal, por exemplo) mostra o erro,
 * volta ao texto de antes e não manda nada; apagar manda `value: null`.
 *
 * Interface com dublê da API: o PATCH aplica a regra de `work.service.ts` (nulo
 * apaga) para a gaveta recarregar o que ficou gravado. Não é serviço real.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
const apiBlob = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
    apiDelete: (...a: unknown[]) => apiDelete(...a),
    apiBlob: (...a: unknown[]) => apiBlob(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Rodrigo', email: 'r@x.com', roles: [], permissions: ['tarefas.ver', 'tarefas.editar'] },
    can: (p: string) => ['tarefas.ver', 'tarefas.editar'].includes(p),
  }),
}));

// eslint-disable-next-line import/first
import TrabalhoPage from '@/app/trabalho/page';

const TAREFA = '7d1c2a10-5b0e-4c55-9f3a-0a1b2c3d4e5f';
const LISTA = '2f6b1e44-8c1d-4f0a-9b7e-3c5d6e7f8a90';
const VALOR = '0b6c1b8e-1d2e-4f3a-8b4c-5d6e7f8a9b11';
const ROTA = `/trabalho/tarefas/${TAREFA}`;
const ROTULO = 'Valor em negocição';

const CAMPOS = [{ id: VALOR, listId: LISTA, name: ROTULO, type: 'moeda', order: 0, options: [] }];

let gravado: string | null = null;

function tarefa() {
  return {
    id: TAREFA, listId: LISTA, title: 'Lead Exemplo',
    statusId: 's-op', statusName: 'oportunidade', statusType: 'open', statusColor: '#87909e',
    priority: 'normal', assignee: null,
    agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null,
    statusDesde: null, minutos: 0, startDate: null, dueDate: null, overdue: false,
    parentId: null, subtasks: 0, comments: 0,
    externalId: '86ak0000y', externalUrl: null, archived: false, order: 0,
    tags: [],
    values: gravado === null ? [] : [{
      fieldId: VALOR, fieldName: ROTULO, type: 'moeda', optionId: null, optionName: null, optionColor: null, value: gravado,
    }],
  };
}

function servir(inicial: string | null) {
  gravado = inicial;
  apiGet.mockImplementation((rota: string) => {
    if (rota === '/trabalho/estrutura') {
      return Promise.resolve({
        folders: [],
        listasSoltas: [{
          id: LISTA, name: 'Gestão de Leads', order: 0, externalId: null, total: 1,
          statuses: [{ id: 's-op', name: 'oportunidade', type: 'open', color: '#87909e', order: 0, total: 1, limite: null }],
          fields: CAMPOS,
        }],
        camposGlobais: [], tags: [], responsaveis: [], agentes: [],
      });
    }
    if (rota.startsWith('/trabalho/tarefas?')) {
      return Promise.resolve({ items: [tarefa()], total: 1, source: { tool: 'trabalho-interno', generatedAt: '2026-10-01T12:00:00.000Z' } });
    }
    if (rota === ROTA) {
      return Promise.resolve({
        ...tarefa(), description: null, listName: 'Gestão de Leads',
        createdAt: '2026-09-30T14:00:00.000Z', updatedAt: '2026-09-30T14:00:00.000Z',
        comentarios: [], atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [],
      });
    }
    if (rota.startsWith('/tenants/onboarding/trilhos')) return Promise.resolve([]);
    return Promise.reject(new Error(`rota fora do dublê: ${rota}`));
  });
  apiPatch.mockImplementation((_rota: string, corpo: { campos?: Record<string, { value?: string | null }> }) => {
    const v = corpo.campos?.[VALOR];
    if (v) gravado = v.value ?? null;
    return Promise.resolve({ ok: true });
  });
}

async function abrirGaveta() {
  window.history.replaceState({}, '', `/trabalho?lista=${LISTA}&tarefa=${TAREFA}`);
  render(<TrabalhoPage />);
  return (await screen.findByLabelText(new RegExp(`^${ROTULO}`))) as HTMLInputElement;
}

const patches = () => apiPatch.mock.calls.map(([rota, corpo]) => ({ rota, corpo }));
const digitarESair = (campo: HTMLInputElement, texto: string) => {
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.blur(campo);
};
const assentar = () => act(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  window.history.replaceState({}, '', '/trabalho');
  vi.clearAllMocks();
  apiPost.mockResolvedValue({ ok: true });
  apiDelete.mockResolvedValue({ ok: true });
});

describe('campo moeda: o que aparece', () => {
  it('a gaveta mostra 1.500,00 com a moeda ao lado, como texto decimal', async () => {
    servir('BRL 1500.00');
    const campo = await abrirGaveta();
    expect(campo.value).toBe('1.500,00');
    expect([campo.type, campo.inputMode]).toEqual(['text', 'decimal']);
    expect(campo.closest('label')?.textContent).toContain('BRL');
  });

  it('a tabela mostra R$ 1.500,00, com espaço sem quebra depois do símbolo', async () => {
    servir('BRL 1500.00');
    window.history.replaceState({}, '', `/trabalho?lista=${LISTA}`);
    render(<TrabalhoPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lista' }));
    expect(await screen.findByRole('cell', { name: 'R$ 1.500,00' })).toBeTruthy();
  });

  it('campo sem valor mostra vazio e propõe BRL', async () => {
    servir(null);
    const campo = await abrirGaveta();
    expect(campo.value).toBe('');
    expect(campo.closest('label')?.textContent).toContain('BRL');
  });
});

describe('campo moeda: o que vai à API', () => {
  it('entrar e sair sem digitar não chama apiPatch', async () => {
    servir('BRL 1500.00');
    const campo = await abrirGaveta();
    await userEvent.click(campo);
    await userEvent.tab();
    expect(patches()).toEqual([]);
  });

  it('digitar 2.000,5 envia o canônico BRL 2000.50, e sair de novo não reenvia', async () => {
    servir('BRL 1500.00');
    const campo = await abrirGaveta();
    digitarESair(campo, '2.000,5');
    expect(patches()).toEqual([{ rota: ROTA, corpo: { campos: { [VALOR]: { value: 'BRL 2000.50' } } } }]);
    expect(campo.value).toBe('2.000,50');
    await assentar();
    expect(campo.defaultValue).toBe('2.000,50');
    fireEvent.blur(campo);
    expect(patches()).toHaveLength(1);
  });

  it('a mesma quantia escrita de outro jeito não é edição', async () => {
    servir('BRL 1500.00');
    const campo = await abrirGaveta();
    digitarESair(campo, '1500');
    expect(patches()).toEqual([]);
    expect(campo.value).toBe('1.500,00');
  });

  it('digitar 2000.50 mostra o erro, volta ao texto de antes e não chama apiPatch', async () => {
    servir('BRL 1500.00');
    const campo = await abrirGaveta();
    digitarESair(campo, '2000.50');
    expect(patches()).toEqual([]);
    expect(campo.value).toBe('1.500,00');
    expect(await screen.findByText(`${ROTULO}: use vírgula para os centavos e ponto só para milhar. Nada foi gravado.`)).toBeTruthy();
  });

  it('apagar o texto envia value null', async () => {
    servir('BRL 1500.00');
    const campo = await abrirGaveta();
    digitarESair(campo, '');
    expect(patches()).toEqual([{ rota: ROTA, corpo: { campos: { [VALOR]: { value: null } } } }]);
    await assentar();
    expect(gravado).toBeNull();
  });

  it('preencher o campo vazio envia o valor em BRL', async () => {
    servir(null);
    const campo = await abrirGaveta();
    digitarESair(campo, '1.234,56');
    expect(patches()).toEqual([{ rota: ROTA, corpo: { campos: { [VALOR]: { value: 'BRL 1234.56' } } } }]);
  });

  it('a moeda do valor gravado é a do valor novo', async () => {
    servir('USD 12.34');
    const campo = await abrirGaveta();
    expect(campo.value).toBe('12,34');
    expect(campo.closest('label')?.textContent).toContain('USD');
    digitarESair(campo, '20');
    expect(patches()).toEqual([{ rota: ROTA, corpo: { campos: { [VALOR]: { value: 'USD 20.00' } } } }]);
  });

  it('valor gravado fora do canônico aparece como está e só sai com edição', async () => {
    servir('R$ 15 mil');
    const campo = await abrirGaveta();
    expect(campo.value).toBe('R$ 15 mil');
    await userEvent.click(campo);
    await userEvent.tab();
    expect(patches()).toEqual([]);
    digitarESair(campo, '15.000,00');
    expect(patches()).toEqual([{ rota: ROTA, corpo: { campos: { [VALOR]: { value: 'BRL 15000.00' } } } }]);
  });
});
