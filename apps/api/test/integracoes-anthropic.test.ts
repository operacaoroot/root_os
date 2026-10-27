/**
 * O CONECTOR "CLAUDE (ANTHROPIC)" EM CONEXÕES (leva 5, L8, 27/10/2026).
 *
 * Sem banco e sem Nest: o conector é montado à mão com um dublê de
 * `ChaveDaAnthropicService`. Cobra-se:
 *   · ele está na lista cobrada no arranque e se inscreve no contrato com a
 *     chave `anthropic`, declarando a própria linha do catálogo (RF-X-06);
 *   · a saúde é a sonda: verde só com a Anthropic respondendo; sem chave, "não
 *     configurado"; recusa, "erro" com a frase;
 *   · o cartão (`GET /integrations/cartoes`) traz a linha com a conta ("chave do
 *     cofre ····1234") e quem usa = toda função do cadastro com modelo;
 *   · gravar, testar e remover auditam SEM a chave, só os 4 últimos;
 *   · revogar (Desconectar) tira do cofre e diz que volta a variável.
 */
import { describe, expect, it } from 'vitest';
import { CADASTRO_DE_FUNCOES } from '@mktos/shared';
import type { AuditService } from '../src/audit/audit.service';
import type { ChaveDaAnthropicService, ResultadoDaSonda, EstadoDaChave } from '../src/llm/chave-da-anthropic.service';
import { CONECTOR_ANTHROPIC } from '../src/llm/modelo-da-chamada';
import type { TetoDeCustoIaService } from '../src/llm/teto-diario.service';
import { AnthropicConector } from '../src/integrations/anthropic.conector';
import { CONECTORES_DO_CONTRATO, RegistroDeConectores } from '../src/integrations/conectores.registry';
import type { ConectoresService } from '../src/integrations/conectores.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { quemUsa } from '../src/integrations/usado-por';
import { ConectoresConfiguradosRegistry } from '../src/gateway/conectores-configurados.registry';
import type { PrismaService } from '../src/prisma/prisma.service';

const EMPRESA = 'org-l8-conector';
const PESSOA = 'pessoa-l8';
const CHAVE = 'sk-ant-api03-chave-inventada-que-nunca-sai-000000001234';

function chavesDeBrinquedo(inicial: { origem: 'cofre' | 'ambiente' | 'nenhuma'; sonda?: Partial<ResultadoDaSonda> } = { origem: 'cofre' }) {
  let origem = inicial.origem;
  const esquecidas: string[] = [];
  const estadoDaChave = (): EstadoDaChave =>
    origem === 'cofre'
      ? { origem: 'cofre', gravadaEm: '2026-10-27T01:00:00.000Z', versao: 2, final: '1234', ambienteTemChave: true }
      : { origem, gravadaEm: null, versao: null, final: null, ambienteTemChave: origem === 'ambiente' };
  const svc = {
    get temChaveNoAmbiente() {
      return origem !== 'nenhuma';
    },
    async estado() {
      return estadoDaChave();
    },
    async sondar(): Promise<ResultadoDaSonda> {
      if (origem === 'nenhuma') return { ok: false, origem: null, final: null, modelo: null, latenciaMs: 0, erro: 'Nenhuma chave da Anthropic: grave uma aqui em Conexões.' };
      return { ok: true, origem, final: origem === 'cofre' ? '1234' : '9999', modelo: 'claude-opus-5-5', latenciaMs: 120, erro: null, ...inicial.sonda };
    },
    async gravar(e: { orgId: string; chave: string }) {
      origem = 'cofre';
      return { versao: 3, final: e.chave.slice(-4) };
    },
    async remover() {
      const tinha = origem === 'cofre';
      if (tinha) origem = 'ambiente';
      return { revogada: tinha };
    },
    esquecer(orgId: string) {
      esquecidas.push(orgId);
    },
    modelosEmVigor() {
      return [{ id: 'CO-11', nome: 'Vigia das 08h', area: 'Comercial', tipo: 'agente' as const, estado: 'ativo' as const, modelo: 'claude-haiku-5-5', esforco: 'low' as const, origem: 'cadastro' as const }];
    },
  };
  return { svc: svc as unknown as ChaveDaAnthropicService, esquecidas, origemAtual: () => origem };
}

function montar(inicial?: Parameters<typeof chavesDeBrinquedo>[0]) {
  const contrato = new RegistroDeConectores();
  const auditorias: Array<{ action: string; after: unknown; actorId?: string }> = [];
  const audit = { log: async (e: { action: string; after: unknown; actorId?: string }) => { auditorias.push(e); } } as unknown as AuditService;
  const teto = {
    consumo: async () => ({ dia: '2026-10-27', fusoHorario: 'America/Sao_Paulo', ativo: true, tetoUsd: 20, gastoUsd: 1, gastoEstimadoUsd: 0, reservadoUsd: 0, arrastoUsd: 0, comprometidoUsd: 1, restanteUsd: 19, chamadas: 3, chamadasSemPreco: 0, cortes: 0 }),
  } as unknown as TetoDeCustoIaService;
  const chaves = chavesDeBrinquedo(inicial);
  const conector = new AnthropicConector(chaves.svc, contrato, audit, teto);
  conector.onModuleInit();
  return { conector, contrato, auditorias, chaves };
}

describe('o conector no contrato', () => {
  it('está na lista cobrada no arranque e se inscreve com a chave "anthropic", declarando a própria linha', () => {
    expect(CONECTORES_DO_CONTRATO).toContain(CONECTOR_ANTHROPIC);
    const { contrato } = montar();
    expect(contrato.inscritos).toEqual([CONECTOR_ANTHROPIC]);
    const c = contrato.exigir(CONECTOR_ANTHROPIC);
    expect(c.rotulo).toBe('Claude (Anthropic)');
    expect(c.escopoDaCredencial).toBe('empresa');
    expect(contrato.linhasCobertas().has(CONECTOR_ANTHROPIC)).toBe(true);
    expect(contrato.donoDaLinha(CONECTOR_ANTHROPIC)?.chave).toBe(CONECTOR_ANTHROPIC);
  });

  it('o arranque derruba se ele não se inscrever', () => {
    const reg = new RegistroDeConectores();
    for (const chave of CONECTORES_DO_CONTRATO) {
      if (chave === CONECTOR_ANTHROPIC) continue;
      reg.registrar({ chave, rotulo: chave, escopoDaCredencial: 'processo', autorizar: async () => ({ tipo: 'nao_se_aplica', motivo: '-' }), sincronizar: async () => ({ tipo: 'nao_se_aplica', motivo: '-' }), saude: async () => ({ estado: 'nao_configurado', mensagem: '-', apuracao: 'declaracao', verificadoEm: new Date().toISOString(), latenciaMs: null }), revogar: async () => ({ tipo: 'nao_se_aplica', motivo: '-' }) }, 'x');
    }
    expect(() => reg.onApplicationBootstrap()).toThrowError(/"anthropic" \(AnthropicConector\)/);
  });

  it('a saúde é a sonda: verde com a origem e o final; sem chave, não configurado; recusa, erro', async () => {
    const { conector } = montar({ origem: 'cofre' });
    const verde = await conector.saude({ orgId: EMPRESA });
    expect(verde.estado).toBe('conectado');
    expect(verde.mensagem).toBe('chave do cofre ····1234');
    expect(verde.apuracao).toBe('tentativa');

    const semChave = await montar({ origem: 'nenhuma' }).conector.saude({ orgId: EMPRESA });
    expect(semChave.estado).toBe('nao_configurado');
    expect(semChave.mensagem).toMatch(/Conexões/);

    const recusa = await montar({ origem: 'ambiente', sonda: { ok: false, erro: 'A Anthropic recusou a chave (401): inválida ou revogada.' } }).conector.saude({ orgId: EMPRESA });
    expect(recusa.estado).toBe('erro');
    expect(recusa.mensagem).toContain('401');
    expect(recusa.mensagem).toContain('variável de ambiente');
  });

  it('autorizar não tem OAuth: instrução para a gaveta, ou "pronto" com a chave já no cofre', async () => {
    expect(await montar({ origem: 'ambiente' }).conector.autorizar({ orgId: EMPRESA })).toMatchObject({ tipo: 'manual' });
    expect(await montar({ origem: 'cofre' }).conector.autorizar({ orgId: EMPRESA })).toMatchObject({ tipo: 'pronto' });
    expect(await montar().conector.sincronizar()).toMatchObject({ tipo: 'nao_se_aplica' });
  });

  it('revogar (Desconectar) tira a chave do cofre e diz que volta a variável; sem chave no cofre, não se aplica', async () => {
    const { conector, chaves, auditorias } = montar({ origem: 'cofre' });
    const r = await conector.revogar({ orgId: EMPRESA, actorId: PESSOA, motivo: 'troca de chave' });
    expect(r).toMatchObject({ tipo: 'revogado', segredos: ['api_key'] });
    expect((r as { resumo: string }).resumo).toMatch(/variável de ambiente/);
    expect(chaves.origemAtual()).toBe('ambiente');
    expect(auditorias.map((a) => a.action)).toEqual(['integracao.anthropic.chave_removida']);
    expect(await conector.revogar({ orgId: EMPRESA })).toMatchObject({ tipo: 'nao_se_aplica' });
  });
});

describe('as rotas da gaveta', () => {
  it('estado: a chave sem o valor, os modelos por função, o teto e o caminho da tela do teto', async () => {
    const { conector } = montar({ origem: 'cofre' });
    const e = await conector.estado(EMPRESA);
    expect(e.chave).toEqual({ origem: 'cofre', gravadaEm: '2026-10-27T01:00:00.000Z', versao: 2, final: '1234', ambienteTemChave: true });
    expect(e.modelosPermitidos).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(e.modelosPorFuncao[0]).toMatchObject({ id: 'CO-11', modelo: 'claude-haiku-5-5' });
    expect(e.teto).toMatchObject({ configurado: true, ativo: true, tetoUsd: 20, restanteUsd: 19 });
    expect(e.caminhoDoTeto).toBe('/painel/custo-ia');
    expect(JSON.stringify(e)).not.toContain(CHAVE);
  });

  it('gravar, testar e remover auditam sem a chave (só os 4 últimos) e esquecem a sonda guardada', async () => {
    const { conector, auditorias, contrato } = montar({ origem: 'ambiente' });
    // A sonda guardada no registro (30 s) é esquecida a cada ação; o cache da chave é do próprio serviço.
    const esquecidas: string[] = [];
    const original = contrato.esquecer.bind(contrato);
    contrato.esquecer = (orgId: string, chave?: string) => {
      esquecidas.push(`${orgId}:${chave ?? '*'}`);
      original(orgId, chave);
    };
    const g = await conector.gravarChave(EMPRESA, CHAVE, PESSOA);
    expect(g).toEqual({ ok: true, final: '1234', versao: 3 });
    const t = await conector.testar(EMPRESA, PESSOA);
    expect(t.ok).toBe(true);
    const r = await conector.removerChave(EMPRESA, PESSOA, 'teste');
    expect(r).toEqual({ ok: true, revogada: true, voltaPara: 'ambiente' });
    expect(auditorias.map((a) => a.action)).toEqual([
      'integracao.anthropic.chave_gravada',
      'integracao.anthropic.testada',
      'integracao.anthropic.chave_removida',
    ]);
    expect(JSON.stringify(auditorias)).not.toContain(CHAVE);
    expect(JSON.stringify(auditorias)).toContain('1234');
    expect(esquecidas).toEqual([`${EMPRESA}:anthropic`, `${EMPRESA}:anthropic`, `${EMPRESA}:anthropic`]);
  });
});

describe('o cartão de Conexões', () => {
  it('traz a linha "Claude (Anthropic)" sondada, com a conta e quem usa = toda função com modelo', async () => {
    const { contrato } = montar({ origem: 'cofre' });
    const prisma = {
      integrationAccount: { findMany: async () => [] },
      segredoDeConector: { findMany: async () => [{ conector: CONECTOR_ANTHROPIC }] },
      user: { findFirst: async () => ({ roles: [{ permissions: [{ key: 'dashboard.ver' }, { key: 'admin.usuarios' }] }] }) },
    } as unknown as PrismaService;
    const conectores = { desligados: async () => new Map() } as unknown as ConectoresService;
    const svc = new IntegrationsService(prisma, { log: async () => {} } as unknown as AuditService, conectores, new ConectoresConfiguradosRegistry(), contrato);
    const r = await svc.cartoes(EMPRESA, PESSOA, { prazoDeSondaMs: 500 });
    const claude = r.items.find((i) => i.key === CONECTOR_ANTHROPIC)!;
    expect(claude.nome).toBe('Claude (Anthropic)');
    expect(claude.estado).toBe('conectado');
    expect(claude.conta).toBe('chave do cofre ····1234');
    expect(claude.credencialNoCofre).toBe(true);
    expect(claude.contrato).toMatchObject({ chave: CONECTOR_ANTHROPIC, escopoDaCredencial: 'empresa' });
    expect(claude.paraQueServe.length).toBeGreaterThan(5);
    const esperados = CADASTRO_DE_FUNCOES.filter((f) => f.modelo && f.estado !== 'aposentado').map((f) => f.id);
    expect(claude.usadoPor.map((u) => u.id)).toEqual(esperados);
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });

  it('quemUsa("anthropic") é a função com modelo; as outras linhas não mudam', () => {
    const ids = quemUsa(CONECTOR_ANTHROPIC).map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining(['CO-03', 'CO-11', 'IM-01']));
    expect(ids).not.toContain('CO-01');
    for (const u of quemUsa(CONECTOR_ANTHROPIC)) expect(u.estado).not.toBe('aposentado');
    expect(quemUsa('openai').map((u) => u.id)).toEqual(expect.arrayContaining(['CE-05', 'IM-06']));
  });
});
