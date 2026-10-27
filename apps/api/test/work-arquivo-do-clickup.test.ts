import { describe, expect, it } from 'vitest';
import {
  LISTAS_DO_ARQUIVO_DO_CLICKUP, NOME_DA_PASTA_DO_ARQUIVO_DO_CLICKUP, ROTAS_ABSORVIDAS, NAV,
  chaveDoNomeDoArquivo, ehDoArquivoDoClickUp as ehDoArquivoNaTela, ehIdDoClickUp, ehNomeDoArquivoDoClickUp,
  ehPastaDoComercial, listasForaDoArquivoDoClickUp, pastasNaArvoreDoTrabalho,
  ACOES_DO_MENU_DA_TAREFA, ROTULO_DA_ACAO_DA_TAREFA, razaoParaNaoFazer,
} from '@mktos/shared';
import {
  ehDoArquivoDoClickUp, idsDasPastasDoArquivoDoClickUp, listaForaDoArquivoDoClickUp, tarefaForaDoArquivoDoClickUp,
} from '../src/work/arquivadas';

/*
 * LEVA 5 (27/10/2026), lane L1 + L3 + L2 (tarefas): as regras SEM banco.
 *
 *  1. L1 · o Arquivo do ClickUp: a marca na pasta desce para as listas e para as
 *     subpastas; o recorte de banco é o mesmo de `doComercial` (lista fora, pasta
 *     fora); a tela tira dos quadros as listas marcadas (os status herdados não
 *     viram coluna); as quatro listas da reunião são reconhecidas pelo nome, sem
 *     diferença de acento e maiúscula; o id do ClickUp é numérico;
 *  2. L3 · a pasta Clientes volta à árvore por `pastasNaArvoreDoTrabalho` (folders +
 *     pastasDoComercial) e `ehPastaDoComercial` a reconhece; a Implantação sai do menu
 *     (oculta) com a rota absorvida por /trabalho;
 *  3. L2 · "Histórico" é a nona ação do menu, só leitura, nunca desabilitada pela
 *     permissão de editar.
 * Contra o Postgres a prova é a do script (`arquivo-do-clickup.js --simular`, contagem
 * de abertas antes e depois) e a e2e da leva; aqui fica o que não precisa de banco.
 */

describe('L1 · o Arquivo do ClickUp, sem banco', () => {
  it('as quatro listas da reunião, pelo nome normalizado; o id do ClickUp é numérico', () => {
    expect(LISTAS_DO_ARQUIVO_DO_CLICKUP).toEqual(['Gestão de Temas', 'Copy', 'Rotina de stories', 'Design & Gravação']);
    expect(NOME_DA_PASTA_DO_ARQUIVO_DO_CLICKUP).toBe('Arquivo do ClickUp');
    expect(chaveDoNomeDoArquivo('  Gestao   de TEMAS ')).toBe('gestao de temas');
    for (const n of ['gestão de temas', 'COPY', 'Rotina de Stories', 'Design & Gravacao']) expect(ehNomeDoArquivoDoClickUp(n), n).toBe(true);
    for (const n of ['Análise', 'Calendário de conteúdo', 'Demandas gerais', '', null]) expect(ehNomeDoArquivoDoClickUp(n), String(n)).toBe(false);
    expect(ehIdDoClickUp('901327640001')).toBe(true);
    expect(ehIdDoClickUp('comercial:tarefas')).toBe(false);
    expect(ehIdDoClickUp('12')).toBe(false);
    expect(ehIdDoClickUp(null)).toBe(false);
  });

  it('o recorte de banco: a lista fora do Arquivo nem tem a marca nem a pasta dela tem', () => {
    expect(listaForaDoArquivoDoClickUp()).toEqual({ arquivoDoClickUp: false, OR: [{ folderId: null }, { folder: { arquivoDoClickUp: false } }] });
    expect(tarefaForaDoArquivoDoClickUp()).toEqual({ list: listaForaDoArquivoDoClickUp() });
  });

  it('a marca da pasta desce para as subpastas e para as listas de dentro', () => {
    const pastas = [
      { id: 'mkt', parentId: null, arquivoDoClickUp: false },
      { id: 'arq', parentId: 'mkt', arquivoDoClickUp: true },
      { id: 'sub', parentId: 'arq', arquivoDoClickUp: false },
      { id: 'adm', parentId: null, arquivoDoClickUp: false },
    ];
    const ids = idsDasPastasDoArquivoDoClickUp(pastas);
    expect([...ids].sort()).toEqual(['arq', 'sub']);
    expect(ehDoArquivoDoClickUp({ arquivoDoClickUp: false, folderId: 'arq' }, ids)).toBe(true);
    expect(ehDoArquivoDoClickUp({ arquivoDoClickUp: false, folderId: 'sub' }, ids)).toBe(true);
    expect(ehDoArquivoDoClickUp({ arquivoDoClickUp: true, folderId: 'mkt' }, ids)).toBe(true);
    expect(ehDoArquivoDoClickUp({ arquivoDoClickUp: false, folderId: 'mkt' }, ids)).toBe(false);
    expect(ehDoArquivoDoClickUp({ arquivoDoClickUp: false, folderId: null }, ids)).toBe(false);
  });

  it('a tela tira dos quadros as listas marcadas: os status herdados não viram coluna vazia', () => {
    const listas = [
      { id: 'a', name: 'Demandas gerais' },
      { id: 'b', name: 'Gestão de Temas', arquivoDoClickUp: true },
      { id: 'c', name: 'Copy', arquivoDoClickUp: true },
      { id: 'd', name: 'Pessoas', arquivoDoClickUp: false },
    ];
    expect(listasForaDoArquivoDoClickUp(listas).map((l) => l.id)).toEqual(['a', 'd']);
    expect(ehDoArquivoNaTela({ arquivoDoClickUp: true })).toBe(true);
    expect(ehDoArquivoNaTela({})).toBe(false);
    expect(ehDoArquivoNaTela(null)).toBe(false);
  });
});

describe('L3 · a pasta Clientes de volta à árvore; a Implantação fora do menu', () => {
  const estrutura = {
    folders: [{ id: 'mkt', lists: [{ id: 'l1' }] }],
    listasSoltas: [{ id: 'solta' }],
    pastasDoComercial: [{ id: 'cli', lists: [{ id: 'onb' }] }],
  };

  it('a árvore desenha as do Trabalho e, no fim, a Clientes; só a árvore pergunta', () => {
    expect(pastasNaArvoreDoTrabalho(estrutura).map((p) => p.id)).toEqual(['mkt', 'cli']);
    expect(ehPastaDoComercial(estrutura, 'cli')).toBe(true);
    expect(ehPastaDoComercial(estrutura, 'mkt')).toBe(false);
    expect(ehPastaDoComercial({ folders: [], listasSoltas: [] }, 'cli')).toBe(false);
  });

  it('o item implantacao fica oculto e a rota /trabalho/implantacao é absorvida por /trabalho', () => {
    const item = NAV.find((n) => n.key === 'implantacao');
    expect(item).toMatchObject({ href: '/trabalho/implantacao', oculto: true, pai: 'trabalho', permission: 'tarefas.ver', modulo: 'trabalho' });
    const absorvida = ROTAS_ABSORVIDAS.find((r) => r.href === '/trabalho/implantacao');
    expect(absorvida?.destino).toBe('/trabalho');
    expect(absorvida?.porque).toMatch(/Onboarding de cliente/);
    // /onboarding continua apontando para o kanban, que segue vivo pelo link.
    expect(ROTAS_ABSORVIDAS.find((r) => r.href === '/onboarding')?.destino).toBe('/trabalho/implantacao');
  });
});

describe('L2 · Histórico no menu da tarefa', () => {
  it('é a nona ação, só leitura, e nunca cai pela permissão de editar nem pela Lixeira', () => {
    expect(ACOES_DO_MENU_DA_TAREFA[ACOES_DO_MENU_DA_TAREFA.length - 1]).toBe('historico');
    expect(ACOES_DO_MENU_DA_TAREFA).toHaveLength(9);
    expect(ROTULO_DA_ACAO_DA_TAREFA.historico).toBe('Histórico');
    const base = { podeEditar: false, ehGente: false, arquivada: true, excluida: true, cardDaImplantacao: true, comAgente: true };
    expect(razaoParaNaoFazer('historico', base)).toBeNull();
    expect(razaoParaNaoFazer('renomear', base)).not.toBeNull();
  });
});
