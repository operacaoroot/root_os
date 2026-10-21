/**
 * INTEGRAÇÕES NUM PADRÃO SÓ — rodada dos agentes, lane A6 (21/10/2026).
 *
 * Todo conector do catálogo que fala com fora (ou, no OFX, lê arquivo) passa a
 * implementar o contrato único e a estar na lista cobrada no arranque. Os que
 * entraram agora: Asaas, Pluggy, OFX e Apify; a ZapSign já se inscrevia e passou
 * a ser cobrada. Granola, YouTube e as duas Evolution já estavam na lista.
 *
 * O que se cobra de cada um, pela mesma régua da fatia 5.4:
 *   1. se inscreve no registro, com os quatro verbos;
 *   2. sem credencial, a sonda diz "não configurado" SEM sair da casa;
 *   3. com credencial, a sonda é uma tentativa medida e leva um prazo próprio
 *      (o `AbortSignal` do fetch), e nunca é um verde declarado;
 *   4. desligado, o registro nem chama a sonda;
 *   5. pendurado, o registro corta pelo relógio e marca só ele, em paralelo;
 *   6. credencial do processo não oferece revogar (nao_se_aplica).
 *
 * Sem banco e sem Nest: os serviços são construídos à mão e o `fetch` é dublê.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTORS } from '@mktos/shared';
import { CONECTORES_DO_CONTRATO, RegistroDeConectores } from '../src/integrations/conectores.registry';
import { VERBOS_DO_CONTRATO, type ConectorDoContrato } from '../src/integrations/contrato-de-conector';
import { ConectoresConfiguradosRegistry } from '../src/gateway/conectores-configurados.registry';
import { AsaasService } from '../src/finance/asaas.service';
import { PluggyService } from '../src/finance/pluggy.service';
import { OfxConector } from '../src/finance/ofx.conector';
import { ApifyService } from '../src/pauta/apify.service';
import { ZapsignService } from '../src/comercial/conectores/zapsign.service';
import { conectorPendurado, conectorSaudavel } from './conector-ficticio';

const ORG = 'org-a6-padrao';

/** As variáveis que cada conector lê no construtor. */
const AMBIENTE: Record<string, Record<string, string>> = {
  asaas: { ASAAS_API_KEY: '$aact_hmlg_chave-ficticia', ASAAS_BASE_URL: 'https://asaas.exemplo.test/v3' },
  pluggy: { PLUGGY_CLIENT_ID: 'id-ficticio', PLUGGY_CLIENT_SECRET: 'segredo-ficticio', PLUGGY_BASE_URL: 'https://pluggy.exemplo.test' },
  apify: { APIFY_TOKEN: 'token-ficticio' },
  zapsign: { ZAPSIGN_API_TOKEN: 'token-ficticio', ZAPSIGN_BASE_URL: 'https://zapsign.exemplo.test/api/v1' },
};
const TODAS = Object.values(AMBIENTE).flatMap((o) => Object.keys(o));
const guardado = Object.fromEntries(TODAS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of TODAS) {
    if (guardado[k] === undefined) delete process.env[k];
    else process.env[k] = guardado[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function semAmbiente() {
  for (const k of TODAS) delete process.env[k];
}

function comAmbiente(chave: string) {
  semAmbiente();
  Object.assign(process.env, AMBIENTE[chave] ?? {});
}

/** Constrói o serviço DEPOIS de arrumar o ambiente (eles leem no construtor) e o inscreve num registro limpo. */
function montar(chave: string): { reg: RegistroDeConectores; conector: ConectorDoContrato } {
  const reg = new RegistroDeConectores();
  const configurados = new ConectoresConfiguradosRegistry();
  const servico =
    chave === 'asaas' ? new AsaasService(configurados, reg)
    : chave === 'pluggy' ? new PluggyService(configurados, reg)
    : chave === 'ofx' ? new OfxConector(reg)
    : chave === 'apify' ? new ApifyService(reg)
    : new ZapsignService(configurados, reg);
  (servico as { onModuleInit(): void }).onModuleInit();
  return { reg, conector: reg.exigir(chave) };
}

function fetchQueResponde(corpo: unknown = { ok: true }) {
  const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.signal, 'a sonda sai com prazo próprio no fetch').toBeInstanceOf(AbortSignal);
    return new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const NOVOS = ['asaas', 'pluggy', 'ofx', 'apify', 'zapsign'] as const;
const DE_FORA = ['asaas', 'pluggy', 'apify', 'zapsign'] as const;

describe('a lista cobrada no arranque', () => {
  it('traz os que entraram nesta rodada e os que já estavam (Granola, YouTube, as duas Evolution)', () => {
    for (const c of [...NOVOS, 'granola', 'youtube', 'whatsapp', 'evolution']) expect(CONECTORES_DO_CONTRATO, c).toContain(c);
  });

  it('toda linha do catálogo tem dono no contrato, menos as sem implementação e a OpenAI (vetores e áudio)', () => {
    const semDono = new Set(['openai', 'telegram', 'asana', 'zapier']);
    const reg = new RegistroDeConectores();
    for (const chave of CONECTORES_DO_CONTRATO) {
      const linhas = chave === 'google' ? ['gmail', 'gcal', 'gdocs', 'drive'] : chave === 'meta' ? ['instagram'] : undefined;
      reg.registrar({ ...conectorSaudavel(chave), ...(linhas ? { linhasDoCatalogo: linhas } : {}) }, chave);
    }
    const orfas = CONNECTORS.map((c) => c.key).filter((k) => !semDono.has(k) && !reg.donoDaLinha(k));
    expect(orfas).toEqual([]);
  });

  it('o arranque derruba se um dos novos não se inscrever', () => {
    for (const falta of NOVOS) {
      const reg = new RegistroDeConectores();
      for (const chave of CONECTORES_DO_CONTRATO) if (chave !== falta) reg.registrar(conectorSaudavel(chave), 'x');
      expect(() => reg.onApplicationBootstrap(), falta).toThrowError(new RegExp(`"${falta}"`));
    }
  });
});

describe.each(NOVOS)('o conector %s', (chave) => {
  it('se inscreve com os quatro verbos e um rótulo', () => {
    comAmbiente(chave);
    const { conector } = montar(chave);
    expect(conector.chave).toBe(chave);
    expect(conector.rotulo.length).toBeGreaterThan(2);
    for (const v of VERBOS_DO_CONTRATO) expect(typeof conector[v], v).toBe('function');
  });

  it('credencial do processo: revogar não se aplica e diz por quê', async () => {
    comAmbiente(chave);
    const { reg } = montar(chave);
    const r = await reg.revogar(chave, { orgId: ORG, actorId: null });
    expect(r.tipo).toBe('nao_se_aplica');
  });

  it('desligado, o registro nem chama a sonda (sondar seria sair da casa)', async () => {
    comAmbiente(chave);
    const f = fetchQueResponde();
    const { reg, conector } = montar(chave);
    const saude = vi.spyOn(conector, 'saude');
    const r = await reg.sondar({ orgId: ORG, chave, desligadoPorque: `"${chave}" está desligado para esta empresa.` });
    expect(r.estado).toBe('nao_verificado');
    expect(saude).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
});

describe.each(DE_FORA)('o conector de fora %s', (chave) => {
  it('sem credencial: "não configurado", sem nenhuma chamada', async () => {
    semAmbiente();
    const f = fetchQueResponde();
    const { reg } = montar(chave);
    const r = await reg.sondar({ orgId: ORG, chave, semMemoria: true });
    expect(r.estado).toBe('nao_configurado');
    expect(r.latenciaMs).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('com credencial: verde só com tentativa medida, e o fetch leva prazo', async () => {
    comAmbiente(chave);
    const f = fetchQueResponde({ apiKey: 'k', balance: 1, data: [] });
    const { reg } = montar(chave);
    const r = await reg.sondar({ orgId: ORG, chave, semMemoria: true });
    expect(r.estado).toBe('conectado');
    expect(r.apuracao).toBe('tentativa');
    expect(typeof r.latenciaMs).toBe('number');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('o fornecedor recusando vira erro com a mensagem, nunca verde', async () => {
    comAmbiente(chave);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('negado', { status: 401 })));
    const { reg } = montar(chave);
    const r = await reg.sondar({ orgId: ORG, chave, semMemoria: true });
    expect(r.estado).toBe('erro');
    expect(r.mensagem).toMatch(/401/);
  });
});

describe('o OFX', () => {
  it('a sonda é local e de verdade: o leitor da casa lê o extrato de prova', async () => {
    const f = fetchQueResponde();
    const { reg } = montar('ofx');
    const r = await reg.sondar({ orgId: ORG, chave: 'ofx', semMemoria: true });
    expect(r.estado).toBe('conectado');
    expect(r.apuracao).toBe('tentativa');
    expect(f).not.toHaveBeenCalled();
  });

  it('autorizar diz que não há credencial; sincronizar não se aplica', async () => {
    const { reg } = montar('ofx');
    expect((await reg.autorizar('ofx', { orgId: ORG })).tipo).toBe('pronto');
    expect((await reg.sincronizar('ofx', { orgId: ORG })).tipo).toBe('nao_se_aplica');
  });
});

describe('degradação: um conector novo pendurado não segura os outros', () => {
  it('em paralelo, o pendurado vira erro pelo relógio e os outros respondem', async () => {
    comAmbiente('apify');
    fetchQueResponde();
    const { reg } = montar('apify');
    reg.registrar(conectorPendurado('pendurado'), 'teste');
    const comecou = Date.now();
    const r = await reg.sondarVarios([
      { orgId: ORG, chave: 'apify', prazoMs: 200, semMemoria: true },
      { orgId: ORG, chave: 'pendurado', prazoMs: 200, semMemoria: true },
    ]);
    expect(Date.now() - comecou).toBeLessThan(2_000);
    expect(r.get('apify')?.estado).toBe('conectado');
    expect(r.get('pendurado')?.estado).toBe('erro');
  });
});
