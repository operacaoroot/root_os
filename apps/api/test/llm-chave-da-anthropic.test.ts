/**
 * A CHAVE DA ANTHROPIC POR EMPRESA (leva 5, L8, 27/10/2026).
 *
 * O que se cobra, sem banco e sem Nest (o cofre é um dublê em memória):
 *   · a ordem: cofre da empresa → variável de ambiente → nenhuma;
 *   · a memória de 60 s por empresa, esquecida ao gravar e ao remover;
 *   · contexto sem empresa e cofre fora do ar caem na variável, sem guardar;
 *   · gravar recusa chave fora do formato, com frase em português;
 *   · a sonda é uma chamada só, nunca lança, e nunca deixa a chave sair no erro;
 *   · o provider manda o pedido pelo cliente da chave do cofre quando ela existe,
 *     pelo de sempre quando não, e sem nenhuma diz onde pôr a chave;
 *   · o bloco "Modelo por função" lista só função com modelo, pela regra de sempre.
 * Chaves daqui são inventadas e nunca vão à Anthropic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CADASTRO_DE_FUNCOES, funcaoPorId } from '@mktos/shared';
import type { CofreService } from '../src/cofre/cofre.service';
import { EmpresaDivergenteNoCofreError, SegredoIndisponivelError } from '../src/cofre/cofre.service';
import {
  ChaveDaAnthropicService,
  NOME_DA_CHAVE_NO_COFRE,
  finalDaChave,
  motivoParaRecusarChave,
  semChaveNoTexto,
} from '../src/llm/chave-da-anthropic.service';
import { AnthropicProvider } from '../src/llm/anthropic.provider';
import { CONECTOR_ANTHROPIC, MODELOS_PERMITIDOS, modelosPorFuncaoEmVigor } from '../src/llm/modelo-da-chamada';

const EMPRESA = 'org-l8-a';
const OUTRA = 'org-l8-b';
const CHAVE_DO_COFRE = 'sk-ant-api03-chave-inventada-do-cofre-0000000000001234';
const CHAVE_DO_AMBIENTE = 'sk-ant-api03-chave-inventada-do-ambiente-00000000009999';

/** Um cofre de brinquedo: guarda, empresta, revoga e lista, sem banco. Conta as leituras. */
function cofreDeBrinquedo(opcoes: { semContexto?: boolean; quebrado?: boolean } = {}) {
  const linhas = new Map<string, { valor: string; versao: number; revogadoEm: string | null; atualizadoEm: string }>();
  const chave = (orgId: string, conector: string, nome: string) => `${orgId}|${conector}|${nome}`;
  let leituras = 0;
  const cofre = {
    async envolver(e: { orgId: string; conector: string; nome: string }, fn: (c: { usar<T>(f: (s: string) => T | Promise<T>): Promise<T> }) => Promise<unknown>) {
      leituras++;
      if (opcoes.semContexto) throw new EmpresaDivergenteNoCofreError('CofreService.emprestar', e.orgId, null);
      if (opcoes.quebrado) throw new Error('banco fora do ar');
      const l = linhas.get(chave(e.orgId, e.conector, e.nome));
      if (!l || l.revogadoEm) throw new SegredoIndisponivelError(e.conector, e.nome, !!l?.revogadoEm);
      return fn({ usar: async (f) => f(l.valor) });
    },
    async guardar(e: { orgId: string; conector: string; nome: string; valor: string }) {
      const k = chave(e.orgId, e.conector, e.nome);
      const antes = linhas.get(k);
      const versao = (antes?.versao ?? 0) + 1;
      linhas.set(k, { valor: e.valor, versao, revogadoEm: null, atualizadoEm: new Date().toISOString() });
      return { id: k, versao };
    },
    async revogar(e: { orgId: string; conector: string; nome?: string | null }) {
      const k = chave(e.orgId, e.conector, e.nome ?? NOME_DA_CHAVE_NO_COFRE);
      const l = linhas.get(k);
      if (!l || l.revogadoEm) return { revogados: [], jaRevogados: l ? [e.nome ?? ''] : [], preservados: [] };
      l.revogadoEm = new Date().toISOString();
      l.valor = '';
      return { revogados: [e.nome ?? ''], jaRevogados: [], preservados: [] };
    },
    async estado(orgId: string) {
      const items = [...linhas.entries()]
        .filter(([k]) => k.startsWith(`${orgId}|`))
        .map(([k, l]) => {
          const [, conector, nome] = k.split('|');
          return { conector, nome, versao: l.versao, revogadoEm: l.revogadoEm, atualizadoEm: l.atualizadoEm, criadoEm: l.atualizadoEm };
        });
      return { items, total: items.length, source: { tool: 'cofre', generatedAt: new Date().toISOString() } };
    },
    leituras: () => leituras,
    semear(orgId: string, valor: string) {
      linhas.set(chave(orgId, CONECTOR_ANTHROPIC, NOME_DA_CHAVE_NO_COFRE), { valor, versao: 1, revogadoEm: null, atualizadoEm: '2026-10-27T00:00:00.000Z' });
    },
  };
  return cofre;
}

const AMBIENTE = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'ANTHROPIC_EFFORT', 'LLM_MODELOS_POR_FUNCAO', 'LLM_ESFORCOS_POR_FUNCAO'];
const salvas: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const v of AMBIENTE) {
    salvas[v] = process.env[v];
    delete process.env[v];
  }
});
afterEach(() => {
  for (const v of AMBIENTE) {
    if (salvas[v] === undefined) delete process.env[v];
    else process.env[v] = salvas[v];
  }
});

function servico(cofre: ReturnType<typeof cofreDeBrinquedo> | null) {
  return new ChaveDaAnthropicService((cofre as unknown as CofreService) ?? undefined);
}

describe('a chave efetiva: cofre da empresa, senão a variável de ambiente', () => {
  it('sem linha no cofre vale a variável; sem variável nem linha, nenhuma', async () => {
    const svc = servico(cofreDeBrinquedo());
    expect(await svc.chaveEfetiva(EMPRESA)).toBeNull();
    process.env.ANTHROPIC_API_KEY = CHAVE_DO_AMBIENTE;
    expect(await svc.chaveEfetiva(EMPRESA)).toEqual({ chave: CHAVE_DO_AMBIENTE, origem: 'ambiente' });
    // Sem serviço de cofre nenhum (a suíte antiga), só a variável.
    expect(await servico(null).chaveEfetiva(EMPRESA)).toEqual({ chave: CHAVE_DO_AMBIENTE, origem: 'ambiente' });
  });

  it('com linha no cofre, a do cofre vence a variável, e só para AQUELA empresa', async () => {
    process.env.ANTHROPIC_API_KEY = CHAVE_DO_AMBIENTE;
    const cofre = cofreDeBrinquedo();
    cofre.semear(EMPRESA, CHAVE_DO_COFRE);
    const svc = servico(cofre);
    expect(await svc.chaveEfetiva(EMPRESA)).toEqual({ chave: CHAVE_DO_COFRE, origem: 'cofre' });
    expect(await svc.chaveEfetiva(OUTRA)).toEqual({ chave: CHAVE_DO_AMBIENTE, origem: 'ambiente' });
    expect(svc.jaViuCofre).toBe(true);
  });

  it('a memória de 60 s: a segunda chamada não vai ao cofre; esquecer, gravar e remover a derrubam', async () => {
    const cofre = cofreDeBrinquedo();
    cofre.semear(EMPRESA, CHAVE_DO_COFRE);
    const svc = servico(cofre);
    await svc.chaveEfetiva(EMPRESA);
    await svc.chaveEfetiva(EMPRESA);
    expect(cofre.leituras()).toBe(1);
    svc.esquecer(EMPRESA);
    await svc.chaveEfetiva(EMPRESA);
    expect(cofre.leituras()).toBe(2);
    // A resposta NEGATIVA também fica guardada (a empresa sem linha não vai ao banco a cada chamada).
    await svc.chaveEfetiva(OUTRA);
    await svc.chaveEfetiva(OUTRA);
    expect(cofre.leituras()).toBe(3);
    // Gravar esquece: a chave nova vale na hora.
    const nova = 'sk-ant-api03-chave-inventada-nova-000000000000000005678';
    const g = await svc.gravar({ orgId: EMPRESA, chave: nova, actorId: 'u1' });
    expect(g).toEqual({ versao: 2, final: '5678' });
    expect(await svc.chaveEfetiva(EMPRESA)).toEqual({ chave: nova, origem: 'cofre' });
    // Remover esquece e volta à variável (aqui vazia: nenhuma).
    expect(await svc.remover({ orgId: EMPRESA, actorId: 'u1' })).toEqual({ revogada: true });
    expect(await svc.chaveEfetiva(EMPRESA)).toBeNull();
    expect(await svc.remover({ orgId: EMPRESA, actorId: 'u1' })).toEqual({ revogada: false });
  });

  it('contexto sem empresa e cofre fora do ar caem na variável, e NÃO guardam a resposta', async () => {
    process.env.ANTHROPIC_API_KEY = CHAVE_DO_AMBIENTE;
    const semContexto = cofreDeBrinquedo({ semContexto: true });
    semContexto.semear(EMPRESA, CHAVE_DO_COFRE);
    const a = servico(semContexto);
    expect(await a.chaveEfetiva(EMPRESA)).toEqual({ chave: CHAVE_DO_AMBIENTE, origem: 'ambiente' });
    await a.chaveEfetiva(EMPRESA);
    expect(semContexto.leituras(), 'sem empresa não é verdade sobre a empresa: não entra na memória').toBe(2);
    expect(a.jaViuCofre).toBe(false);

    const quebrado = cofreDeBrinquedo({ quebrado: true });
    const b = servico(quebrado);
    expect(await b.chaveEfetiva(EMPRESA)).toEqual({ chave: CHAVE_DO_AMBIENTE, origem: 'ambiente' });
  });

  it('o estado da tela diz de onde vem a chave, quando foi gravada e só os 4 últimos', async () => {
    const cofre = cofreDeBrinquedo();
    const svc = servico(cofre);
    expect(await svc.estado(EMPRESA)).toEqual({ origem: 'nenhuma', gravadaEm: null, versao: null, final: null, ambienteTemChave: false });
    process.env.ANTHROPIC_API_KEY = CHAVE_DO_AMBIENTE;
    expect((await svc.estado(EMPRESA)).origem).toBe('ambiente');
    cofre.semear(EMPRESA, CHAVE_DO_COFRE);
    svc.esquecer(EMPRESA);
    const e = await svc.estado(EMPRESA);
    expect(e).toEqual({ origem: 'cofre', gravadaEm: '2026-10-27T00:00:00.000Z', versao: 1, final: '1234', ambienteTemChave: true });
    expect(JSON.stringify(e)).not.toContain(CHAVE_DO_COFRE);
  });
});

describe('gravar recusa chave fora do formato, com frase em português', () => {
  it.each([
    ['', 'Cole a chave'],
    ['abc', 'começa com "sk-ant-"'],
    ['sk-ant-curta', 'caracteres que uma chave da Anthropic não tem'],
    ['sk-ant-api03 com espaco 0000000000000000000', 'espaço ou quebra de linha'],
    [`sk-ant-${'x'.repeat(400)}`, 'comprida demais'],
  ])('%s', (chave, trecho) => {
    expect(motivoParaRecusarChave(chave)).toContain(trecho);
  });

  it('aceita a chave inteira e a guarda aparada', async () => {
    expect(motivoParaRecusarChave(CHAVE_DO_COFRE)).toBeNull();
    const cofre = cofreDeBrinquedo();
    const svc = servico(cofre);
    await svc.gravar({ orgId: EMPRESA, chave: `  ${CHAVE_DO_COFRE}\n`, actorId: 'u1' });
    expect(await svc.chaveEfetiva(EMPRESA)).toEqual({ chave: CHAVE_DO_COFRE, origem: 'cofre' });
    await expect(svc.gravar({ orgId: EMPRESA, chave: 'nada', actorId: 'u1' })).rejects.toThrow(/sk-ant-/);
  });

  it('o final e a limpeza do texto', () => {
    expect(finalDaChave(CHAVE_DO_COFRE)).toBe('1234');
    expect(semChaveNoTexto(`401 recusou ${CHAVE_DO_COFRE} e ${CHAVE_DO_AMBIENTE}`)).toBe('401 recusou sk-ant-… e sk-ant-…');
  });
});

describe('a sonda: uma chamada só, nunca lança, nunca vaza a chave', () => {
  function comSonda(cofre: ReturnType<typeof cofreDeBrinquedo>, resposta: () => Promise<{ data: Array<{ id: string }> }>) {
    const svc = servico(cofre);
    const chavesUsadas: string[] = [];
    svc.clienteDaSonda = (chave: string) => {
      chavesUsadas.push(chave);
      return { models: { list: () => resposta() } } as unknown as ReturnType<ChaveDaAnthropicService['clienteDaSonda']>;
    };
    return { svc, chavesUsadas };
  }

  it('sem chave nenhuma: não chama e diz onde pôr a chave', async () => {
    const { svc, chavesUsadas } = comSonda(cofreDeBrinquedo(), async () => ({ data: [] }));
    const r = await svc.sondar(EMPRESA);
    expect(r.ok).toBe(false);
    expect(r.origem).toBeNull();
    expect(r.erro).toMatch(/Conexões|variável de ambiente/);
    expect(chavesUsadas).toEqual([]);
  });

  it('com a chave do cofre: responde ok, com a origem, o final e o modelo listado', async () => {
    const cofre = cofreDeBrinquedo();
    cofre.semear(EMPRESA, CHAVE_DO_COFRE);
    const { svc, chavesUsadas } = comSonda(cofre, async () => ({ data: [{ id: 'claude-opus-5-5' }] }));
    const r = await svc.sondar(EMPRESA);
    expect(r).toMatchObject({ ok: true, origem: 'cofre', final: '1234', modelo: 'claude-opus-5-5', erro: null });
    expect(chavesUsadas).toEqual([CHAVE_DO_COFRE]);
  });

  it('a Anthropic recusando (401) vira frase em português, sem a chave', async () => {
    process.env.ANTHROPIC_API_KEY = CHAVE_DO_AMBIENTE;
    const { svc } = comSonda(cofreDeBrinquedo(), async () => {
      throw Object.assign(new Error(`401 invalid x-api-key ${CHAVE_DO_AMBIENTE}`), { status: 401 });
    });
    const r = await svc.sondar(EMPRESA);
    expect(r.ok).toBe(false);
    expect(r.origem).toBe('ambiente');
    expect(r.erro).toContain('401');
    expect(JSON.stringify(r)).not.toContain(CHAVE_DO_AMBIENTE);
  });
});

describe('o provider manda o pedido pela chave certa', () => {
  interface Pedido { model: string; [k: string]: unknown }
  function dublê() {
    const pedidos: Pedido[] = [];
    const create = vi.fn(async (pedido: Pedido) => {
      pedidos.push(pedido);
      return { model: pedido.model, stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 1 } };
    });
    return { pedidos, cliente: { beta: { messages: { create } } } };
  }

  it('com chave no cofre da empresa, o pedido sai pelo cliente daquela chave; sem ela, pelo de sempre', async () => {
    process.env.ANTHROPIC_API_KEY = CHAVE_DO_AMBIENTE;
    const cofre = cofreDeBrinquedo();
    cofre.semear(EMPRESA, CHAVE_DO_COFRE);
    const chaves = servico(cofre);
    const p = new AnthropicProvider(chaves);
    const deSempre = dublê();
    const doCofre = dublê();
    (p as unknown as { client: unknown }).client = deSempre.cliente;
    const chavesDosClientes: string[] = [];
    p.clientePara = (chave: string) => {
      chavesDosClientes.push(chave);
      return doCofre.cliente as unknown as ReturnType<AnthropicProvider['clientePara']>;
    };
    await p.complete({ orgId: EMPRESA, system: 's', user: 'u' });
    expect(doCofre.pedidos).toHaveLength(1);
    expect(deSempre.pedidos).toHaveLength(0);
    expect(chavesDosClientes).toEqual([CHAVE_DO_COFRE]);
    await p.complete({ orgId: OUTRA, system: 's', user: 'u' });
    expect(deSempre.pedidos).toHaveLength(1);
    // Sem empresa na chamada: a variável, como sempre.
    await p.complete({ system: 's', user: 'u' });
    expect(deSempre.pedidos).toHaveLength(2);
  });

  it('sem variável, sem perfil e sem cofre, a frase diz onde pôr a chave (e `configured` é falso)', async () => {
    const p = new AnthropicProvider(servico(cofreDeBrinquedo()));
    expect(p.configured).toBe(false);
    await expect(p.complete({ orgId: EMPRESA, system: 's', user: 'u' })).rejects.toThrow(/Conexões/);
  });

  it('a primeira chave do cofre vista neste processo faz `configured` responder sim mesmo sem variável', async () => {
    const cofre = cofreDeBrinquedo();
    cofre.semear(EMPRESA, CHAVE_DO_COFRE);
    const chaves = servico(cofre);
    const p = new AnthropicProvider(chaves);
    expect(p.configured).toBe(false);
    await chaves.chaveEfetiva(EMPRESA);
    expect(p.configured).toBe(true);
  });
});

describe('o bloco "Modelo por função" do cartão', () => {
  const PADRAO = { modelo: 'claude-opus-5-5', esforco: 'high' as const };

  it('lista só função viva com modelo, pela regra de sempre, dentro da lista permitida', () => {
    const linhas = modelosPorFuncaoEmVigor(PADRAO, {});
    const ids = new Set(linhas.map((l) => l.id));
    for (const f of CADASTRO_DE_FUNCOES) {
      expect(ids.has(f.id), f.id).toBe(!!f.modelo && f.estado !== 'aposentado');
    }
    for (const l of linhas) expect(MODELOS_PERMITIDOS, `${l.id}: ${l.modelo}`).toContain(l.modelo);
    const co11 = linhas.find((l) => l.id === 'CO-11')!;
    expect(co11).toMatchObject({ modelo: funcaoPorId('CO-11')!.modelo, origem: 'cadastro' });
    expect(linhas.some((l) => l.id === 'CO-01'), 'automação sem modelo fica fora').toBe(false);
  });

  it('a lista do compose por cima do cadastro, como na chamada de verdade', () => {
    const linhas = modelosPorFuncaoEmVigor(PADRAO, { LLM_MODELOS_POR_FUNCAO: 'CO-11=claude-sonnet-5-5', LLM_ESFORCOS_POR_FUNCAO: 'CO-11=medium' });
    expect(linhas.find((l) => l.id === 'CO-11')).toMatchObject({ modelo: 'claude-sonnet-5-5', esforco: 'medium', origem: 'variavel' });
    // Valor fora da lista permitida é ignorado, como `escolherModelo` faz.
    const torta = modelosPorFuncaoEmVigor(PADRAO, { LLM_MODELOS_POR_FUNCAO: 'CO-11=gpt-inventado' });
    expect(torta.find((l) => l.id === 'CO-11')).toMatchObject({ modelo: funcaoPorId('CO-11')!.modelo, origem: 'cadastro' });
  });

  it('o serviço usa o padrão do provedor que vale no processo', () => {
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-5-5';
    const svc = servico(null);
    expect(svc.modelosEmVigor().length).toBeGreaterThan(5);
  });
});
