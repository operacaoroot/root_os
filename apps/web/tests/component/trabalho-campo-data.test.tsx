import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * AS DATAS DA GAVETA NÃO PODEM APAGAR NEM REESCREVER O QUE ESTÁ GRAVADO (ROOT-12b).
 *
 * O importador do ClickUp grava datas como instante ISO inteiro (`iso()` em
 * `apps/api/prisma/import-clickup-work.normalize.mjs`), e a gaveta grava
 * `AAAA-MM-DD` no campo personalizado e meio-dia local em Início e Prazo.
 * Dois defeitos saíam daí, só por entrar e sair do campo:
 *
 *  A1. o `<input type="date">` do campo personalizado `data` não aceita o
 *      instante, mostrava vazio e mandava `value: null`, que `gravarCampos`
 *      trata como "apagar";
 *  B1. Início e Prazo mostravam o dia certo, mas reenviavam o mesmo dia como
 *      meio-dia local: o instante importado mudava sem ninguém editar.
 *
 * Aqui se cobra, na gaveta de verdade e no corpo do PATCH: sem edição não vai
 * nada, inclusive quando a pessoa altera e volta ao dia gravado; a edição de
 * fato e a limpeza continuam indo à API no formato de antes; texto, número e
 * lista ficam como estavam.
 *
 * O dublê da API aplica a regra de `work.service.ts` (nulo apaga o valor do
 * campo; data nativa vira `new Date(...)`), para a gaveta recarregar o que de
 * fato ficou gravado depois de cada PATCH.
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

/* --------------------------------------------------------------- fixtures -- */

const TAREFA = '7d1c2a10-5b0e-4c55-9f3a-0a1b2c3d4e5f';
const LISTA = '2f6b1e44-8c1d-4f0a-9b7e-3c5d6e7f8a90';
const DATA = '0b6c1b8e-1d2e-4f3a-8b4c-5d6e7f8a9b01';
const TEXTO = '0b6c1b8e-1d2e-4f3a-8b4c-5d6e7f8a9b02';
const NUMERO = '0b6c1b8e-1d2e-4f3a-8b4c-5d6e7f8a9b03';
const FORMATO = '0b6c1b8e-1d2e-4f3a-8b4c-5d6e7f8a9b04';
const REELS = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c61';
const CARROSSEL = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c62';
const ROTA = `/trabalho/tarefas/${TAREFA}`;
const VERSAO = '2026-09-30T14:00:00.000Z';
const versaoSeguinte = (passo: number) => new Date(Date.parse(VERSAO) + passo).toISOString();
let versaoLida = VERSAO;
const IMPORTADO = '2026-10-01T03:00:00.000Z';

const CAMPOS = [
  { id: DATA, listId: LISTA, name: 'Data de publicação', type: 'data', order: 0, options: [] },
  { id: TEXTO, listId: LISTA, name: 'Observação', type: 'texto', order: 1, options: [] },
  { id: NUMERO, listId: LISTA, name: 'Duração (min)', type: 'numero', order: 2, options: [] },
  {
    id: FORMATO, listId: LISTA, name: 'Formato', type: 'drop_down', order: 3,
    options: [
      { id: REELS, name: 'Reels', color: '#ff1f6b', order: 0 },
      { id: CARROSSEL, name: 'Carrossel', color: '#1fffa8', order: 1 },
    ],
  },
];

type Gravado = { optionId: string | null; value: string | null };
type Datas = { startDate: string | null; dueDate: string | null };
type Corpo = Partial<Datas> & { campos?: Record<string, { optionId?: string | null; value?: string | null }> };

let gravados = new Map<string, Gravado>();
let datas: Datas = { startDate: null, dueDate: null };

function valores() {
  return [...gravados].map(([fieldId, v]) => {
    const campo = CAMPOS.find((c) => c.id === fieldId)!;
    const opcao = campo.options.find((o) => o.id === v.optionId);
    return {
      fieldId, fieldName: campo.name, type: campo.type,
      optionId: v.optionId, optionName: opcao?.name ?? null, optionColor: opcao?.color ?? null,
      value: v.value,
    };
  });
}

function tarefa() {
  return {
    id: TAREFA, listId: LISTA, title: 'Episódio 12',
    statusId: 's-prod', statusName: 'Produção', statusType: 'custom', statusColor: '#4194f6',
    priority: 'normal', assignee: null,
    agenteId: null, agenteSlug: null, agenteNome: null, agenteEm: null,
    statusDesde: null, minutos: 0,
    ...datas, overdue: false,
    parentId: null, subtasks: 0, comments: 0,
    externalId: '86ak0000x', externalUrl: null, archived: false, order: 0,
    tags: [], values: valores(),
  };
}

function servir(inicial: Record<string, Partial<Gravado>>, datasIniciais: Partial<Datas> = {}, versaoCrescente = false) {
  versaoLida = VERSAO;
  gravados = new Map(Object.entries(inicial).map(([id, v]) => [id, { optionId: v.optionId ?? null, value: v.value ?? null }]));
  datas = { startDate: null, dueDate: null, ...datasIniciais };
  apiGet.mockImplementation((rota: string) => {
    if (rota === '/trabalho/estrutura') {
      return Promise.resolve({
        folders: [],
        listasSoltas: [{
          id: LISTA, name: 'Produção de conteúdo', order: 0, externalId: null, total: 1,
          statuses: [{ id: 's-prod', name: 'Produção', type: 'custom', color: '#4194f6', order: 0, total: 1, limite: null }],
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
        ...tarefa(),
        description: null, listName: 'Produção de conteúdo',
        createdAt: '2026-09-30T14:00:00.000Z', updatedAt: versaoLida,
        comentarios: [], atividade: [], filhos: [], apontamentos: [], minutosPorEtapa: [],
      });
    }
    if (rota.startsWith('/tenants/onboarding/trilhos')) return Promise.resolve([]);
    return Promise.reject(new Error(`rota fora do dublê: ${rota}`));
  });
  apiPatch.mockImplementation((_rota: string, corpo: Corpo) => {
    for (const k of ['startDate', 'dueDate'] as const) {
      if (corpo[k] !== undefined) datas[k] = corpo[k] ? new Date(corpo[k]!).toISOString() : null;
    }
    for (const [fieldId, v] of Object.entries(corpo.campos ?? {})) {
      if (v.optionId === null || (v.optionId === undefined && (v.value === null || v.value === undefined))) {
        gravados.delete(fieldId);
      } else {
        gravados.set(fieldId, { optionId: v.optionId ?? null, value: v.value ?? null });
      }
    }
    if (versaoCrescente) versaoLida = new Date(Date.parse(versaoLida) + 1).toISOString();
    return Promise.resolve({ ok: true });
  });
}

async function abrirGaveta() {
  window.history.replaceState({}, '', `/trabalho?lista=${LISTA}&tarefa=${TAREFA}`);
  render(<TrabalhoPage />);
  return (await screen.findByLabelText('Data de publicação')) as HTMLInputElement;
}

async function entrarESair(campo: HTMLElement) {
  await userEvent.click(campo);
  await userEvent.tab();
}

const patches = () => apiPatch.mock.calls.map(([rota, corpo]) => ({ rota, corpo }));
const inputDe = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;
// A conversão que Início e Prazo já faziam na edição de fato, no fuso de quem roda.
const meioDiaLocal = (dia: string) => new Date(`${dia}T12:00:00`).toISOString();

// Depois de um PATCH a gaveta e o quadro recarregam; o caso espera isso assentar
// para a próxima interação ver o valor que ficou gravado.
const assentar = () => act(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  window.history.replaceState({}, '', '/trabalho');
  vi.clearAllMocks();
  apiPost.mockResolvedValue({ ok: true });
  apiDelete.mockResolvedValue({ ok: true });
});

/* ------------------------------- A1. campo `data`: sem edição, nada vai -- */

describe('A1, campo data da gaveta: entrar e sair sem editar não envia nada', () => {
  it('data importada como instante ISO', async () => {
    servir({ [DATA]: { value: IMPORTADO } });
    const campo = await abrirGaveta();
    await entrarESair(campo);
    expect(patches()).toEqual([]);
    expect(gravados.get(DATA)).toEqual({ optionId: null, value: IMPORTADO });
  });

  it('mostra o dia do instante importado, o mesmo que Início mostra para o mesmo instante', async () => {
    servir({ [DATA]: { value: IMPORTADO } }, { startDate: IMPORTADO });
    const campo = await abrirGaveta();
    expect(campo.value).toBe('2026-10-01');
    expect(inputDe('Início').value).toBe('2026-10-01');
  });

  it('data gravada pela gaveta, em AAAA-MM-DD', async () => {
    servir({ [DATA]: { value: '2026-10-01' } });
    const campo = await abrirGaveta();
    expect(campo.value).toBe('2026-10-01');
    await entrarESair(campo);
    expect(patches()).toEqual([]);
  });

  it('campo sem valor', async () => {
    servir({});
    const campo = await abrirGaveta();
    expect(campo.value).toBe('');
    await entrarESair(campo);
    expect(patches()).toEqual([]);
  });

  it('valor que o input de data não sabe mostrar continua gravado', async () => {
    servir({ [DATA]: { value: 'a combinar' } });
    const campo = await abrirGaveta();
    expect(campo.value).toBe('');
    await entrarESair(campo);
    expect(patches()).toEqual([]);
    expect(gravados.get(DATA)?.value).toBe('a combinar');
  });
});

/* ---------------------------- A1. campo `data`: a edição de fato continua -- */

describe('A1, campo data da gaveta: a edição de fato continua indo à API', () => {
  it('alterar envia o dia em AAAA-MM-DD, e sair de novo depois de gravar não reenvia', async () => {
    servir({ [DATA]: { value: IMPORTADO } });
    const campo = await abrirGaveta();
    fireEvent.change(campo, { target: { value: '2026-10-15' } });
    fireEvent.blur(campo);
    expect(patches()).toEqual([{ rota: ROTA, corpo: { expectedUpdatedAt: VERSAO, campos: { [DATA]: { value: '2026-10-15' } } } }]);
    await assentar();
    expect(campo.defaultValue).toBe('2026-10-15');
    await entrarESair(campo);
    expect(patches()).toHaveLength(1);
    expect(gravados.get(DATA)?.value).toBe('2026-10-15');
  });

  it('alterar e voltar ao dia gravado antes de sair não envia nada', async () => {
    servir({ [DATA]: { value: IMPORTADO } });
    const campo = await abrirGaveta();
    fireEvent.change(campo, { target: { value: '2026-10-15' } });
    fireEvent.change(campo, { target: { value: '2026-10-01' } });
    fireEvent.blur(campo);
    expect(patches()).toEqual([]);
    expect(gravados.get(DATA)?.value).toBe(IMPORTADO);
  });

  it('limpar de propósito uma data importada envia value null', async () => {
    servir({ [DATA]: { value: IMPORTADO } });
    const campo = await abrirGaveta();
    expect(campo.value).toBe('2026-10-01');
    fireEvent.change(campo, { target: { value: '' } });
    fireEvent.blur(campo);
    expect(patches()).toEqual([{ rota: ROTA, corpo: { expectedUpdatedAt: VERSAO, campos: { [DATA]: { value: null } } } }]);
    await assentar();
    expect(gravados.has(DATA)).toBe(false);
    expect(campo.value).toBe('');
  });

  it('preencher o campo vazio envia o dia', async () => {
    servir({});
    const campo = await abrirGaveta();
    fireEvent.change(campo, { target: { value: '2026-10-20' } });
    fireEvent.blur(campo);
    expect(patches()).toEqual([{ rota: ROTA, corpo: { expectedUpdatedAt: VERSAO, campos: { [DATA]: { value: '2026-10-20' } } } }]);
    await assentar();
    expect(gravados.get(DATA)?.value).toBe('2026-10-20');
  });
});

/* -------------------------------------------- B1. Início e Prazo nativos -- */

describe('B1, Início e Prazo: o instante gravado só muda com edição', () => {
  it('entrar e sair de Início e de Prazo com instante importado não envia nada', async () => {
    servir({}, { startDate: IMPORTADO, dueDate: IMPORTADO });
    await abrirGaveta();
    expect([inputDe('Início').value, inputDe('Prazo').value]).toEqual(['2026-10-01', '2026-10-01']);
    await entrarESair(inputDe('Início'));
    await entrarESair(inputDe('Prazo'));
    expect(patches()).toEqual([]);
    expect(datas).toEqual({ startDate: IMPORTADO, dueDate: IMPORTADO });
  });

  it('entrar e sair de Início vazio não envia nada', async () => {
    servir({});
    await abrirGaveta();
    expect(inputDe('Início').value).toBe('');
    await entrarESair(inputDe('Início'));
    expect(patches()).toEqual([]);
  });

  it('alterar Prazo envia meio-dia local do dia novo, como antes, e sair de novo não reenvia', async () => {
    servir({}, { dueDate: IMPORTADO });
    await abrirGaveta();
    const prazo = inputDe('Prazo');
    fireEvent.change(prazo, { target: { value: '2026-10-15' } });
    fireEvent.blur(prazo);
    expect(patches()).toEqual([{ rota: ROTA, corpo: { expectedUpdatedAt: VERSAO, dueDate: meioDiaLocal('2026-10-15') } }]);
    await assentar();
    expect(prazo.defaultValue).toBe('2026-10-15');
    await entrarESair(prazo);
    expect(patches()).toHaveLength(1);
  });

  it('alterar Prazo e voltar ao dia gravado antes de sair não envia nada', async () => {
    servir({}, { dueDate: IMPORTADO });
    await abrirGaveta();
    const prazo = inputDe('Prazo');
    fireEvent.change(prazo, { target: { value: '2026-10-15' } });
    fireEvent.change(prazo, { target: { value: '2026-10-01' } });
    fireEvent.blur(prazo);
    expect(patches()).toEqual([]);
    expect(datas.dueDate).toBe(IMPORTADO);
  });

  it('limpar Início de propósito envia startDate null', async () => {
    servir({}, { startDate: IMPORTADO });
    await abrirGaveta();
    const inicio = inputDe('Início');
    fireEvent.change(inicio, { target: { value: '' } });
    fireEvent.blur(inicio);
    expect(patches()).toEqual([{ rota: ROTA, corpo: { expectedUpdatedAt: VERSAO, startDate: null } }]);
    await assentar();
    expect(datas.startDate).toBeNull();
  });
});

/* ------------------------------------------------- outros tipos de campo --- */

describe('gaveta: os outros tipos de campo continuam como estavam', () => {
  it('texto aparece inteiro mesmo com cara de data; texto, número e lista gravam como antes', async () => {
    servir({
      [DATA]: { value: IMPORTADO },
      [TEXTO]: { value: IMPORTADO },
      [NUMERO]: { value: '45' },
      [FORMATO]: { optionId: REELS },
    }, {}, true);
    await abrirGaveta();
    const texto = inputDe('Observação');
    const numero = inputDe('Duração (min)');
    const formato = screen.getByLabelText(/^Formato/) as HTMLSelectElement;
    expect([texto.type, texto.value]).toEqual(['text', IMPORTADO]);
    expect([numero.type, numero.value]).toEqual(['number', '45']);
    expect(formato.value).toBe(REELS);

    fireEvent.change(texto, { target: { value: 'Gravar na quinta' } });
    fireEvent.blur(texto);
    expect(numero).toBeDisabled(); expect(formato).toBeDisabled();
    await assentar();
    expect(inputDe('Duração (min)')).not.toBeDisabled();
    fireEvent.change(inputDe('Duração (min)'), { target: { value: '60' } });
    fireEvent.blur(inputDe('Duração (min)'));
    await assentar();
    fireEvent.change(screen.getByLabelText(/^Formato/), { target: { value: CARROSSEL } });

    expect(patches()).toEqual([
      { rota: ROTA, corpo: { expectedUpdatedAt: VERSAO, campos: { [TEXTO]: { value: 'Gravar na quinta' } } } },
      { rota: ROTA, corpo: { expectedUpdatedAt: versaoSeguinte(1), campos: { [NUMERO]: { value: '60' } } } },
      { rota: ROTA, corpo: { expectedUpdatedAt: versaoSeguinte(2), campos: { [FORMATO]: { optionId: CARROSSEL } } } },
    ]);
    await assentar();
    expect(gravados.get(DATA)?.value).toBe(IMPORTADO);
  });
});
