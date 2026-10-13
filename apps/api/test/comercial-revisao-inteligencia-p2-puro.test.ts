import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { COMERCIAL_AUTOMACOES } from '@mktos/shared';

import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { AssistenteService } from '../src/comercial/assistente.service';
import { AUTONOMIA_VIGENTE, TETO_DA_REGUA, podeRodar, tarefasDaAutomacao } from '../src/comercial/autonomia';
import type { ConfigComercialService } from '../src/comercial/config.service';
import type { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { RESPOSTA_DE_SEGURANCA } from '../src/comercial/inteligencia-prompts';
import type { SalaService } from '../src/comercial/sala.service';
import { DiagnosticoService } from '../src/comercial/diagnostico.service';
import type { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { InteligenciaController } from '../src/comercial/inteligencia.controller';
import { hashDaVersao, type VersaoDaProposta } from '../src/comercial/proposta-construtor';
import { PropostaService, type Rascunho } from '../src/comercial/proposta.service';
import { RelatorioDaSemanaService } from '../src/comercial/relatorio-da-semana.service';
import type { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { VigiaService } from '../src/comercial/vigia.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import type { MemoriaService } from '../src/memory/memoria.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * REVISÃO ADVERSARIAL, P2 da inteligência e da sala (lane G, 13/10/2026).
 * Cada caso fica vermelho sem o conserto do item que cita.
 */

function diagnosticoDublê(vigente: { id: string; payload: Record<string, unknown> } | null) {
  const registrados: Array<{ chave: string; payload: Record<string, unknown> }> = [];
  const prisma = {
    leadEvent: {
      findFirst: async () => (vigente ? { id: vigente.id, occurredAt: new Date('2026-10-13T12:00:00Z'), payload: vigente.payload } : null),
    },
  } as unknown as PrismaService;
  const fio = {
    registrar: async (_o: string, _l: string, _t: string, chave: string, payload: Record<string, unknown>) => {
      registrados.push({ chave, payload });
      return { eventoId: `ev-${registrados.length}`, novo: true };
    },
  } as unknown as FioService;
  const svc = new DiagnosticoService(prisma, fio, {} as ReacoesRegistry, {} as LlmProvider);
  return { svc, registrados };
}

describe('revisão E-4/C-8: aprovar o diagnóstico é decisão de mesa sobre a versão lida', () => {
  it('a rota pede aprovacoes.decidir, não leads.editar', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, InteligenciaController.prototype.aprovarDiagnostico) as string[];
    expect(perms).toEqual(['aprovacoes.decidir']);
  });

  it('conta de máquina é recusada com 403 e nada é gravado', async () => {
    const { svc, registrados } = diagnosticoDublê({ id: 'diag-A', payload: { dores: [], aprovadoEm: null } });
    await expect(svc.aprovar('org', 'lead', { id: 'bot', nome: null, papeis: ['ia_acao'] }, 'diag-A')).rejects.toMatchObject({ status: 403 });
    expect(registrados).toHaveLength(0);
  });

  it('o diagnóstico refeito enquanto a pessoa lia: aprovar o lido responde 409 e não aprova o novo', async () => {
    const { svc, registrados } = diagnosticoDublê({ id: 'diag-B', payload: { dores: [], aprovadoEm: null } });
    await expect(svc.aprovar('org', 'lead', { id: 'socia', nome: 'Lidiane', papeis: ['diretor'] }, 'diag-A')).rejects.toMatchObject({ status: 409 });
    expect(registrados).toHaveLength(0);
  });

  it('sem o eventoId lido, 400; com o vigente, aprova e prende o evento', async () => {
    const { svc, registrados } = diagnosticoDublê({ id: 'diag-B', payload: { dores: [], aprovadoEm: null } });
    await expect(svc.aprovar('org', 'lead', { id: 'socia', nome: 'Lidiane', papeis: ['diretor'] }, '')).rejects.toMatchObject({ status: 400 });
    await svc.aprovar('org', 'lead', { id: 'socia', nome: 'Lidiane', papeis: ['diretor'] }, 'diag-B');
    expect(registrados).toEqual([expect.objectContaining({ chave: 'aprovado:diag-B', payload: expect.objectContaining({ aprovaOEvento: 'diag-B', aprovadoPorId: 'socia' }) })]);
  });
});

describe('revisão E-15: o assistente da proposta tem freio na torre', () => {
  it('é automação da torre, com a reação da dúvida, e o teto é A2 (escreve ao cliente)', () => {
    expect(COMERCIAL_AUTOMACOES).toContain('assistente_da_proposta');
    expect(tarefasDaAutomacao('assistente_da_proposta')).toEqual(['inteligencia.duvida']);
    expect(AUTONOMIA_VIGENTE.assistente_da_proposta).toBe('A2');
    expect(TETO_DA_REGUA.assistente_da_proposta).toBe('A2');
    // A guarda do fio não pula a dúvida em A0: quem trata o A0 é o próprio assistente.
    expect(podeRodar({ assistente_da_proposta: 'A0' }, 'inteligencia.duvida')).toEqual({ roda: true });
  });

  it('em A0 o modelo não é chamado: a sala recebe a resposta de segurança e a dúvida vai à decisão aprovacao_de_envio', async () => {
    const respostas: string[] = [];
    const abertas: Array<Record<string, unknown>> = [];
    let chamouOModelo = false;
    const svc = new AssistenteService(
      {} as PrismaService,
      {} as ReacoesRegistry,
      { responderDuvida: async (_o: string, _l: string, _d: unknown, r: string) => void respostas.push(r) } as unknown as SalaService,
      { name: 'stub', model: 'stub', complete: async () => { chamouOModelo = true; return '{}'; } } as unknown as LlmProvider,
      { abrir: async (x: Record<string, unknown>) => { abertas.push(x); return { id: 'dec-1', nova: true }; } } as unknown as DecisoesService,
      {} as DecisoesRegistry,
      { ler: async () => ({ autonomia: { assistente_da_proposta: 'A0' } }) } as unknown as ConfigComercialService,
    );
    const r = await svc.responder('org', 'lead', { versao: 1, pergunta: 'Quantas parcelas?', resposta: null });
    expect(chamouOModelo).toBe(false);
    expect(respostas).toEqual([RESPOSTA_DE_SEGURANCA]);
    expect(abertas).toHaveLength(1);
    expect(abertas[0]).toMatchObject({ tipo: 'aprovacao_de_envio', padrao: 'responder_por_fora' });
    expect(r).toMatchObject({ doModelo: false, levadaAoSocio: true, decisaoId: 'dec-1', nivel: 'A0' });
  });
});

describe('revisão E-11: o relatório guarda o recorte na chave', () => {
  function relator() {
    const notas = new Map<string, { id: string; chave: string; body: string; versao: number; arquivadoEm: null }>();
    let seq = 0;
    const memoria = {
      porChave: async (_o: string, chave: string) => notas.get(chave) ?? null,
      criar: async (_o: string, e: { chave: string; body: string }) => {
        const n = { id: `n${++seq}`, chave: e.chave, body: e.body, versao: 1, arquivadoEm: null as null };
        notas.set(n.chave, n);
        return n;
      },
      alterar: async (_o: string, id: string, e: { body: string }) => {
        const n = [...notas.values()].find((x) => x.id === id)!;
        n.body = e.body;
        n.versao += 1;
        return n;
      },
    } as unknown as MemoriaService;
    const llm = { name: 'stub', model: 'stub', complete: async () => 'A semana teve leitura sem número.' } as unknown as LlmProvider;
    const svc = new RelatorioDaSemanaService({} as PrismaService, memoria, { inscrever: () => undefined } as unknown as RelogioComercialRegistry, llm);
    // Os números do banco não são o assunto aqui: o dublê devolve o recorte pedido.
    svc.numeros = async (_o: string, dias?: unknown, agora: Date = new Date()) =>
      ({
        periodoDias: Number(dias) || 7, leads: 0, fechados: 0, medianaDiasDoOiAoPix: null, acoes: { automaticas: 0, humanas: 0 },
        funil: [], perdasPorMotivo: [], previsao: null, leadsEmPropostaAgora: 0, propostasVencendo: [],
        geradoEm: agora.toISOString(), narrativa: null, origem: 'ao_vivo',
      });
    return { svc, notas };
  }

  it('o de 30 dias gerado na quinta à tarde não impede o de 7 das 18:00, e cada recorte lê o seu', async () => {
    const { svc, notas } = relator();
    await svc.gerar('org', { dias: 30, agora: new Date('2026-10-15T17:00:00-03:00'), origem: 'pessoa' });
    expect(await svc.talvezGerar('org', new Date('2026-10-15T18:00:00-03:00'))).toBe(1);
    expect([...notas.keys()].sort()).toEqual(['comercial.relatorio.semana.2026-10-15.30d', 'comercial.relatorio.semana.2026-10-15.7d']);
    expect(await svc.ler('org', 7, new Date('2026-10-15T19:00:00-03:00'))).toMatchObject({ periodoDias: 7, origem: 'relogio' });
    expect(await svc.ler('org', 30, new Date('2026-10-15T19:00:00-03:00'))).toMatchObject({ periodoDias: 30, origem: 'pessoa' });
    // Gerar de novo o de 30 versiona só a nota do de 30.
    await svc.gerar('org', { dias: 30, agora: new Date('2026-10-15T19:10:00-03:00'), origem: 'pessoa' });
    expect(notas.get('comercial.relatorio.semana.2026-10-15.7d')!.versao).toBe(1);
    expect(notas.get('comercial.relatorio.semana.2026-10-15.30d')!.versao).toBe(2);
  });
});

describe('revisão E-12: premissa que nada confere sai não conferida', () => {
  // Um banco vazio: toda lista vazia, toda contagem zero.
  const prismaVazio = new Proxy({}, {
    get: () => new Proxy({}, { get: (_t, op) => async () => (op === 'count' ? 0 : String(op).startsWith('findMany') || op === 'groupBy' ? [] : null) }),
  }) as unknown as PrismaService;

  function vigia(provedor: string, valoresDeHomologacao: boolean) {
    const config = { ler: async () => ({ autonomia: {}, valoresDeHomologacao, cobrancaSemWebhookDias: null, efeitoRetidoHoras: null }) } as unknown as ConfigComercialService;
    const llm = { name: provedor, model: provedor } as unknown as LlmProvider;
    return new VigiaService(prismaVazio, {} as FioService, {} as DecisoesService, config, {} as RelogioComercialRegistry, {} as MemoriaService, llm);
  }
  const achar = async (v: VigiaService, chave: string) => (await v.conferir('org', new Date('2026-10-13T11:00:00Z'))).find((p) => p.chave === chave)!;

  it('a agenda de homologação fora de homologação não é conferida', async () => {
    expect((await achar(vigia('stub', false), 'agenda_responde')).ok).toBeNull();
    expect((await achar(vigia('stub', true), 'agenda_responde')).ok).toBe(true);
  });

  it('com o stub a chave do modelo não é conferida', async () => {
    expect((await achar(vigia('stub', true), 'chave_do_modelo')).ok).toBeNull();
  });

  it('com a ponte, o vigia lê o /saude: falhas seguidas ou ponte fora do ar quebram a premissa', async () => {
    const v = vigia('ponte', true);
    const pedidos: string[] = [];
    v.lerSaudeDaPonte = async (url) => (pedidos.push(url), { status: 200, corpo: { ok: true, falhasSeguidas: 0 } });
    expect((await achar(v, 'chave_do_modelo')).ok).toBe(true);
    expect(pedidos[0]).toMatch(/\/saude$/);
    v.lerSaudeDaPonte = async () => ({ status: 200, corpo: { ok: true, falhasSeguidas: 3 } });
    expect(await achar(v, 'chave_do_modelo')).toMatchObject({ ok: false, detalhe: expect.stringMatching(/3 falha/) });
    v.lerSaudeDaPonte = async () => { throw new Error('ECONNREFUSED'); };
    expect((await achar(v, 'chave_do_modelo')).ok).toBe(false);
  });
});

describe('revisão E-7: quem libera o R3 lê o que o hash prende', () => {
  const versao = {
    leadId: 'lead', versao: 1, produto: 'operacao', rotulo: 'Operação ROOT', valorCentavos: 1_079_730, parcelas: 3, parcelaCentavos: 359_910,
    ultimaParcelaCentavos: 359_910, formas: ['pix'], descricao: 'd', descontoPct: 10, descontoDecisaoId: 'dec', alternativa: null,
    ouvimos: ['fechamento leva 12 dias'], comoEDiferente: 'frase', quadroDeCustos: null, validaAte: '2026-10-21T21:00:00.000Z', tabelaData: '2026-10-04',
  } as unknown as VersaoDaProposta;
  function svc(conteudo: VersaoDaProposta, hashGravado: string) {
    const s = Object.create(PropostaService.prototype) as PropostaService;
    s.daVersao = async () => ({ versao: 1, estado: 'na_porta', conteudo, hash: hashGravado, laudo: { ok: true, apontamentos: [], notas: [] }, dentroDaTabela: true } as unknown as Rascunho);
    return s;
  }

  it('a rota do cartão pede aprovacoes.decidir', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, InteligenciaController.prototype.conteudoDaProposta)).toEqual(['aprovacoes.decidir']);
  });

  it('devolve o conteúdo inteiro e confere o hash de agora contra o que a aprovação prende', async () => {
    const h = hashDaVersao(versao);
    const ok = await svc(versao, h).conteudoParaLiberar('org', 'lead', 1, h);
    expect(ok).toMatchObject({ confere: true, hashDeAgora: h, conteudo: { descontoPct: 10, ouvimos: ['fechamento leva 12 dias'], comoEDiferente: 'frase' } });
    // A aprovação prende outro hash: não confere.
    expect((await svc(versao, h).conteudoParaLiberar('org', 'lead', 1, 'f'.repeat(64))).confere).toBe(false);
    // O rascunho mudou por baixo do hash gravado: não confere.
    expect((await svc({ ...versao, descontoPct: 30 } as VersaoDaProposta, h).conteudoParaLiberar('org', 'lead', 1, h)).confere).toBe(false);
  });
});
