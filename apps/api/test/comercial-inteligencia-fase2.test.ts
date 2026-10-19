/**
 * A INTELIGÊNCIA DO COCKPIT, FASE 2, CONTRA O BANCO (lane E, 13/10/2026).
 *
 * Os serviços de verdade, montados à mão, no banco descartável. A memória é um
 * dublê em memória (como na suíte do relatório do mês da pauta) e o modelo é
 * um dublê que INVENTA número. O que se prova:
 *   · A0 segura: a reação e a tarefa do relógio da automação não rodam e o
 *     pulo fica escrito; A2 roda como antes; o PUT da config muda o nível e
 *     recusa nível torto;
 *   · o vigia acha a premissa quebrada de propósito (status renomeado, a prova
 *     de pronto da onda 5), grava `vigia.premissa`, abre `excecao_do_vigia` uma
 *     vez por dia e passa só a partir das 08:00 de São Paulo;
 *   · o relatório conta no banco; a frase do modelo com número sai e o número
 *     do sistema fica; o gerado é guardado e relido;
 *   · a torre lê o nível, a última vez, o acerto, a premissa do vigia e o custo
 *     do stub (zero e desconhecido);
 *   · a ficha e o funil mostram a próxima ação projetada e a saúde nula.
 */
import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ComercialController } from '../src/comercial/comercial.controller';
import { AutonomiaService } from '../src/comercial/autonomia.service';
import { ConfigComercialService } from '../src/comercial/config.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { ReacoesDaEspinha } from '../src/comercial/reacoes-da-espinha';
import { RelogioDaEspinha } from '../src/comercial/relogio-da-espinha';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { RelatorioDaSemanaService } from '../src/comercial/relatorio-da-semana.service';
import { TorreService } from '../src/comercial/torre.service';
import { VigiaService } from '../src/comercial/vigia.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import type { MemoriaService } from '../src/memory/memoria.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { exigirBancoDescartavel } from './banco-de-teste';

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, eventos, fichas, decisões e config do comercial)');

const MARCA = `e2${Date.now().toString(36).slice(-6)}`;
const SUFIXO = Date.now().toString().slice(-8);
const DIA = 86_400_000;

/** A memória em memória: porChave, criar, alterar, restaurar (o que as notas do comercial usam). */
function memoriaDeTeste() {
  const notas = new Map<string, { id: string; chave: string; body: string; versao: number; arquivadoEm: null }>();
  let seq = 0;
  const m = {
    notas,
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
    restaurar: async (_o: string, id: string) => [...notas.values()].find((x) => x.id === id)!,
  };
  return m;
}

// Com a suíte inteira rodando junto (o mesmo banco), o vigia passa de 5 s: o prazo de cada caso é 30 s.
describe.skipIf(!URL)('a inteligência do cockpit, fase 2, contra o banco', { timeout: 30_000 }, () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const p = prisma as unknown as PrismaService;
  let ORG = '';
  let socia = { id: '', name: '' };
  let fio: FioService;
  let fichas: FichaService;
  let config: ConfigComercialService;
  let relogio: RelogioDaEspinha;
  let tarefas: RelogioComercialRegistry;
  let reacoes: ReacoesRegistry;
  let vigia: VigiaService;
  let relatorios: RelatorioDaSemanaService;
  let torre: TorreService;
  let controller: ComercialController;
  const memoria = memoriaDeTeste();
  const chamadasDoModelo: string[] = [];
  const m1Rodou: string[] = [];
  let fupRodou = 0;

  // O modelo que INVENTA número: a primeira frase é falsa de propósito.
  const llm = {
    name: 'stub',
    model: 'stub',
    complete: async (i: { user: string }) => {
      chamadasDoModelo.push(i.user);
      return 'Foram 47 leads na semana, um recorde. A conversa virou proposta onde havia base. Para a mesa: o prazo do follow-up vira regra da casa?';
    },
  } as unknown as LlmProvider;

  const entrar = (tel: string, texto = 'Quero saber do fechamento') => fichas.entrarPeloWhats(ORG, { telefone: tel, texto, canal: 'conteudo', mensagemId: `m-${tel}` });

  beforeAll(async () => {
    const org = await prisma.org.create({ data: { name: `Fase2 ${MARCA}`, slug: `fase2-${MARCA}` } });
    ORG = org.id;
    const papel = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin Master' } });
    socia = await prisma.user.create({ data: { orgId: ORG, name: 'Sócia', email: `socia.${MARCA}@root.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } }, select: { id: true, name: true } });

    reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    config = new ConfigComercialService(p);
    const aoDecidir = new DecisoesRegistry();
    const decisoes = new DecisoesService(p, fio, config, aoDecidir);
    fichas = new FichaService(p, fio, config);
    tarefas = new RelogioComercialRegistry();
    relogio = new RelogioDaEspinha(p, new ExecutoresDeRotinaRegistry(), tarefas, decisoes, fio, config, fichas);
    relogio.inscrever();
    new ReacoesDaEspinha(p, fio, reacoes, fichas, decisoes, aoDecidir, relogio).inscrever();
    // Dublês das automações das outras lanes, com os MESMOS nomes de inscrição.
    reacoes.inscrever('lead.chegou', 'whats.m1', async (ev) => {
      m1Rodou.push(ev.leadId);
      return { preparada: true };
    });
    tarefas.inscrever('whats.fup', async () => {
      fupRodou++;
      return 1;
    });
    new AutonomiaService(config, reacoes, tarefas).instalar();
    const mem = memoria as unknown as MemoriaService;
    vigia = new VigiaService(p, fio, decisoes, config, tarefas, mem, llm);
    vigia.inscrever();
    relatorios = new RelatorioDaSemanaService(p, mem, tarefas, llm);
    relatorios.inscrever();
    torre = new TorreService(p, config, vigia, undefined, llm, relatorios);
    controller = new ComercialController(fichas, decisoes, config, relogio, undefined as never, undefined as never); // P5 e I4: o mover e as reações não são exercidos aqui
  });

  afterAll(async () => {
    if (ORG) {
      const leads = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
      await prisma.comercialReacao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.leadEvent.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.lead.deleteMany({ where: { orgId: ORG } });
      await prisma.rotina.deleteMany({ where: { orgId: ORG } });
      await prisma.conectorDesligado.deleteMany({ where: { orgId: ORG } });
      await prisma.comercialConfig.deleteMany({ where: { orgId: ORG } });
      await prisma.user.deleteMany({ where: { orgId: ORG } });
      await prisma.role.deleteMany({ where: { orgId: ORG } });
      await prisma.org.deleteMany({ where: { id: ORG } });
    }
    await prisma.$disconnect();
  });

  const user = () => ({ orgId: ORG, sub: 'x', name: 'Sócia' }) as never;

  it('o PUT da config muda o nível de autonomia e recusa nível torto; sem nível vale o vigente', async () => {
    const antes = await controller.config(user());
    expect(antes.autonomia).toEqual({});
    await expect(controller.salvarConfig(user(), { autonomia: { qualificador: 'A9' } })).rejects.toBeInstanceOf(BadRequestException);
    const depois = await controller.salvarConfig(user(), { autonomia: { qualificador: 'A0', fupeiro: 'A0' } });
    expect(depois.autonomia).toEqual({ qualificador: 'A0', fupeiro: 'A0' });
  });

  it('A0 segura a reação (M1) e a tarefa do relógio (follow-up), e o pulo fica escrito', async () => {
    const a = await entrar(`+55329${SUFIXO}`);
    expect(m1Rodou).not.toContain(a.leadId);
    const linha = await prisma.comercialReacao.findFirst({ where: { leadId: a.leadId, reacao: 'whats.m1' } });
    expect(linha?.estado).toBe('ok');
    expect(linha?.resultado).toMatchObject({ pulada: true, automacao: 'qualificador', nivel: 'A0' });
    // A espinha (fora da tabela) rodou: a ficha existe e o lead foi pontuado.
    expect(await prisma.leadEvent.count({ where: { leadId: a.leadId, type: 'lead.pontuado' } })).toBe(1);

    const r = await relogio.passagem(ORG, new Date());
    expect(fupRodou).toBe(0);
    expect(r.resumo).toContain('whats.fup (fupeiro em A0)');
    // O primeiro pulo do dia fica no histórico da rotina; os seguintes, não (a passagem é de minuto em minuto).
    expect(r.status).toBe('ok');
    const r2 = await relogio.passagem(ORG, new Date());
    expect(r2.status).toBe('pulada');
  });

  it('A1 ou acima roda como hoje (a porta continua decidindo o toque)', async () => {
    await config.gravar(ORG, { autonomia: { qualificador: 'A3', fupeiro: 'A2' } });
    const b = await entrar(`+55319${SUFIXO}`);
    expect(m1Rodou).toContain(b.leadId);
    await relogio.passagem(ORG, new Date());
    expect(fupRodou).toBe(1);
  });

  it('a ficha e o funil mostram a próxima ação projetada e a saúde nula', async () => {
    const lead = (await prisma.lead.findFirst({ where: { orgId: ORG, phone: { endsWith: SUFIXO } }, select: { id: true } }))!;
    const f = await fichas.projecao(ORG, lead.id);
    expect(f.saude).toBeNull();
    expect(f.proximaAcao).toMatchObject({ tipo: 'formulario' });
    const funil = await fichas.funil(ORG);
    const cartoes = funil.colunas.flatMap((c) => c.cartoes);
    expect(cartoes.length).toBeGreaterThan(0);
    for (const c of cartoes) {
      expect(c.proximaAcao).not.toBeNull();
      expect(c.saude).toBeNull();
    }
  });

  it('o sócio da conta volta com o id da pessoa quando a ata foi subida por alguém da empresa', async () => {
    const lead = (await prisma.lead.findFirst({ where: { orgId: ORG, phone: { startsWith: '55329' } }, select: { id: true } }))!;
    await fichas.registrarAta(ORG, lead.id, { texto: 'Ata da conversa. '.repeat(20), fonte: 'texto' }, { id: socia.id, nome: socia.name });
    const f = await fichas.projecao(ORG, lead.id);
    expect(f.socioDaConta).toEqual({ id: socia.id, nome: 'Sócia' });
    expect(f.fio.find((l) => l.type === 'ata.chegou')!.resumo).toMatch(/^ata recebida · \d+ caracteres · texto$/);
  });

  it('o vigia acha o status renomeado de propósito, grava o fato e abre a exceção uma vez por dia', async () => {
    const lead = (await prisma.lead.findFirst({ where: { orgId: ORG, phone: { startsWith: '55329' } }, select: { id: true } }))!;
    // A falha simulada da prova de pronto da onda 5: o status muda por fora da etapa.
    const statusCerto = (await prisma.lead.findFirst({ where: { id: lead.id }, select: { status: true } }))!.status;
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'ganho' } });

    const agora = new Date();
    const p1 = await vigia.passar(ORG, agora);
    const versaoDaNota = memoria.notas.get('comercial.vigia')!.versao;
    const quebrada = p1.premissas.find((x) => x.chave === 'status_segue_etapa')!;
    expect(quebrada.ok).toBe(false);
    expect(quebrada.leads).toEqual([lead.id]);
    expect(p1.quebradas).toBeGreaterThanOrEqual(1);
    expect(p1.conferidas).toBeGreaterThan(p1.quebradas);
    // O que o mapa não dá fica não conferido, nunca verde inventado.
    expect(p1.premissas.find((x) => x.chave === 'webhook_asaas')!.ok).toBeNull();
    expect(p1.premissas.find((x) => x.chave === 'zapsign_responde')!.ok).toBeNull();

    expect(await prisma.leadEvent.count({ where: { leadId: lead.id, type: 'vigia.premissa' } })).toBe(1);
    const decisoes = await prisma.comercialDecisao.findMany({ where: { leadId: lead.id, tipo: 'excecao_do_vigia' } });
    expect(decisoes).toHaveLength(1);
    expect(decisoes[0].padrao).toBe('ciente');

    const p2 = await vigia.passar(ORG, agora);
    expect(p2.decisoesAbertas).toBe(0);
    expect(await prisma.comercialDecisao.count({ where: { leadId: lead.id, tipo: 'excecao_do_vigia' } })).toBe(1);
    // Cada passagem é uma versão nova da mesma nota.
    expect(memoria.notas.get('comercial.vigia')!.versao).toBe(versaoDaNota + 1);

    // O status volta: a premissa volta a valer.
    await prisma.lead.update({ where: { id: lead.id }, data: { status: statusCerto } });
    const p3 = await vigia.conferir(ORG, agora);
    expect(p3.find((x) => x.chave === 'status_segue_etapa')!.ok).toBe(true);
  });

  it('com o número do vigia na config, a parcela sem webhook quebra a premissa do cobrador', async () => {
    const lead = (await prisma.lead.findFirst({ where: { orgId: ORG, phone: { startsWith: '55319' } }, select: { id: true } }))!;
    await config.gravar(ORG, { cobrancaSemWebhookDias: 2 });
    await prisma.comercialCobranca.create({
      data: { leadId: lead.id, provedor: 'asaas', externoId: `pay_${MARCA}`, parcela: 1, parcelas: 3, valorCentavos: 399_900, forma: 'pix', vence: new Date(Date.now() - 5 * DIA) },
    });
    const ps = await vigia.conferir(ORG, new Date());
    const cob = ps.find((x) => x.chave === 'webhook_asaas')!;
    expect(cob.ok).toBe(false);
    expect(cob.leads).toEqual([lead.id]);
    await prisma.comercialCobranca.deleteMany({ where: { externoId: `pay_${MARCA}` } });
    await config.gravar(ORG, { cobrancaSemWebhookDias: null });
  });

  it('a premissa do assinador é a sonda de Conexões: erro quebra, conector desligado não é sondado', async () => {
    const pedidos: { chave: string; desligadoPorque?: string | null }[] = [];
    let estado: 'conectado' | 'erro' = 'erro';
    const registro = {
      sondar: async (e: { orgId: string; chave: string; desligadoPorque?: string | null }) => {
        pedidos.push(e);
        if (e.desligadoPorque) return { estado: 'nao_verificado', mensagem: `${e.desligadoPorque} Nada foi chamado.`, apuracao: 'nao_verificado', verificadoEm: new Date().toISOString(), latenciaMs: null };
        return { estado, mensagem: estado === 'erro' ? 'HTTP 402: plano de API não contratado' : null, apuracao: 'tentativa', verificadoEm: new Date().toISOString(), latenciaMs: 12 };
      },
    };
    const comSonda = new VigiaService(p, fio, new DecisoesService(p, fio, config, new DecisoesRegistry()), config, new RelogioComercialRegistry(), memoria as unknown as MemoriaService, llm, registro as never);
    const zap = async () => (await comSonda.conferir(ORG, new Date())).find((x) => x.chave === 'zapsign_responde')!;
    expect(await zap()).toMatchObject({ ok: false, automacao: 'assinador' });
    expect((await zap()).detalhe).toContain('402');
    estado = 'conectado';
    expect((await zap()).ok).toBe(true);
    expect(pedidos.every((x) => x.chave === 'zapsign')).toBe(true);
    await prisma.conectorDesligado.create({ data: { orgId: ORG, conector: 'zapsign', motivo: 'teste do vigia' } });
    const desligada = await zap();
    expect(desligada.ok).toBeNull();
    expect(pedidos.at(-1)!.desligadoPorque).toContain('teste do vigia');
    await prisma.conectorDesligado.deleteMany({ where: { orgId: ORG } });
  });

  it('o vigia do relógio só passa a partir das 08:00 de São Paulo e uma vez por dia', async () => {
    memoria.notas.delete('comercial.vigia');
    expect(await vigia.talvezPassar(ORG, new Date('2026-10-14T07:59:00-03:00'))).toBe(0);
    expect(await vigia.talvezPassar(ORG, new Date('2026-10-14T08:00:00-03:00'))).toBe(1);
    expect(await vigia.talvezPassar(ORG, new Date('2026-10-14T08:01:00-03:00'))).toBe(0);
    // Vigia em A0: a passagem do relógio não o chama.
    await config.gravar(ORG, { autonomia: { qualificador: 'A3', fupeiro: 'A2', vigia: 'A0' } });
    const r = await relogio.passagem(ORG, new Date('2026-10-15T09:00:00-03:00'));
    expect(r.resumo).toContain('inteligencia.vigia (vigia em A0)');
    await config.gravar(ORG, { autonomia: { qualificador: 'A3', fupeiro: 'A2' } });
  });

  it('o relatório conta no banco; a frase do modelo com número sai e o número do sistema fica', async () => {
    const lead = (await prisma.lead.findFirst({ where: { orgId: ORG, phone: { startsWith: '55319' } }, select: { id: true, enteredAt: true } }))!;
    const em = new Date(lead.enteredAt.getTime() + 2 * DIA);
    await fio.registrar(ORG, lead.id, 'pix.pago', 'p1', { provedor: 'asaas', externoId: 'x', parcela: 1, valorCentavos: 399_900, pagoEm: em.toISOString() }, { em, semReacoes: true });
    await fio.registrar(ORG, lead.id, 'cliente.ativo', 'fech', { chave: `fech-${lead.id}-v1` }, { em, semReacoes: true });
    const agora = new Date(lead.enteredAt.getTime() + 3 * DIA);

    const r = await relatorios.gerar(ORG, { dias: 7, agora, origem: 'pessoa' });
    expect(r.leads).toBe(2);
    expect(r.fechados).toBe(1);
    expect(r.medianaDiasDoOiAoPix).toBe(2);
    expect(r.funil[0]).toEqual({ etapa: 'novo_lead', n: 2 });
    expect(r.previsao).toBeNull();
    expect(r.previsaoPendente).toContain('[a decidir]');
    expect(r.acoes.automaticas).toBeGreaterThan(0);
    // O modelo escreveu "47 leads": a frase saiu, o número do sistema é 2, e o aviso diz o que saiu.
    expect(r.narrativa).not.toMatch(/\d/);
    expect(r.narrativa).toContain('A conversa virou proposta onde havia base.');
    expect(r.narrativaAvisos?.[0]).toContain('47');
    expect(chamadasDoModelo.at(-1)).toContain('leads que entraram: 2');

    // Guardado e relido: o GET devolve o gerado (com a narrativa), não uma conta nova.
    const lido = await relatorios.ler(ORG, 7, agora);
    expect(lido.narrativa).toBe(r.narrativa);
    expect(lido.origem).toBe('pessoa');
    // Outro recorte não tem relatório gerado: números ao vivo, sem narrativa.
    const aoVivo = await relatorios.ler(ORG, 30, agora);
    expect(aoVivo).toMatchObject({ origem: 'ao_vivo', narrativa: null, periodoDias: 30, propostasVencendo: [] });

    // C10, "propostas vencendo": a validade dentro do mesmo recorte, à frente.
    const antes = (await prisma.comercialFicha.findFirst({ where: { leadId: lead.id }, select: { etapa: true } }))!;
    await prisma.comercialFicha.updateMany({ where: { leadId: lead.id }, data: { etapa: 'follow_up', validade: new Date(agora.getTime() + 2 * DIA) } });
    const comVencendo = await relatorios.numeros(ORG, 7, agora);
    expect(comVencendo.propostasVencendo).toHaveLength(1);
    expect(comVencendo.propostasVencendo![0].leadId).toBe(lead.id);
    expect(comVencendo.leadsEmPropostaAgora).toBe(1);
    expect((await relatorios.numeros(ORG, 1, agora)).propostasVencendo).toEqual([]);
    await prisma.comercialFicha.updateMany({ where: { leadId: lead.id }, data: { etapa: antes.etapa, validade: null } });
  });

  it('o relator do relógio gera na quinta a partir das 18:00 de São Paulo, uma vez', async () => {
    expect(await relatorios.talvezGerar(ORG, new Date('2026-10-14T19:00:00-03:00'))).toBe(0); // quarta
    expect(await relatorios.talvezGerar(ORG, new Date('2026-10-15T17:59:00-03:00'))).toBe(0);
    expect(await relatorios.talvezGerar(ORG, new Date('2026-10-15T18:00:00-03:00'))).toBe(1);
    expect(await relatorios.talvezGerar(ORG, new Date('2026-10-15T18:30:00-03:00'))).toBe(0);
    expect(memoria.notas.has('comercial.relatorio.semana.2026-10-15.7d')).toBe(true);
  });

  it('a torre lê o nível, a última vez, o acerto, a premissa do vigia e o custo do stub', async () => {
    // Depois da quinta 18:00 do relator (a torre olha os relatórios dos últimos 8 dias).
    const t = await torre.torre(ORG, new Date('2026-10-16T20:00:00-03:00'));
    expect(t.automacoes.map((a) => a.chave)).toHaveLength(12); // E-15: o assistente da proposta entrou na torre
    const q = t.automacoes.find((a) => a.chave === 'qualificador')!;
    expect(q).toMatchObject({ autonomia: 'A3', autonomiaGravada: true, autonomiaVigente: 'A3', premissa: 'formulário grava no lead' });
    // A M1 rodou uma vez (o lead B) e foi pulada uma vez (A0, fora do acerto).
    expect(q.acerto30Dias).toBe(1);
    expect(q.passagens30Dias).toBe(1);
    expect(q.ultimaVezEm).not.toBeNull();
    const f = t.automacoes.find((a) => a.chave === 'fechador')!;
    expect(f).toMatchObject({ autonomia: 'A2', autonomiaGravada: false, acerto30Dias: null });
    expect(t.automacoes.find((a) => a.chave === 'relator')!.ultimaVezEm).not.toBeNull();
    expect(t.vigia.ultimaPassagemEm).not.toBeNull();
    expect(t.vigia.premissasConferidas).toBeGreaterThan(0);
    expect(t).toMatchObject({ custoDeIaHojeCentavos: 0, custoDesconhecido: true, provedorDeIa: 'stub' });
    // Sem um mês de história, nenhuma sugestão de subir; o teto da régua vem junto.
    expect(t.automacoes.every((a) => a.proximoDegrau === null)).toBe(true);
    expect(f.tetoDaRegua).toBe('A2');
  });
});
