import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { JwtService } from '@nestjs/jwt';
import { ActorType, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { ReauthService } from '../src/auth/reauth.service';
import { comContexto } from '../src/common/contexto-execucao';
import { AssistenteService } from '../src/comercial/assistente.service';
import { ConfigComercialService } from '../src/comercial/config.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { DiagnosticoService } from '../src/comercial/diagnostico.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { RESPOSTA_DE_SEGURANCA } from '../src/comercial/inteligencia-prompts';
import { hashDaVersao } from '../src/comercial/proposta-construtor';
import { CAPACIDADE_DA_PROPOSTA, PropostaService, quadroDeExemplo } from '../src/comercial/proposta.service';
import { ReacoesDaEspinha } from '../src/comercial/reacoes-da-espinha';
import { RelogioDaEspinha } from '../src/comercial/relogio-da-espinha';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { chaveDaDuvida } from '../src/comercial/sala-projecao';
import { SalaService } from '../src/comercial/sala.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { ConectoresService } from '../src/integrations/conectores.service';
import { StubProvider } from '../src/llm/stub.provider';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A INTELIGÊNCIA DO COCKPIT CONTRA O BANCO E A RÉGUA DE VERDADE (lane E, 13/10/2026).
 *
 * O caminho demonstrável, com o provedor `stub` e a política do banco
 * (`db:seed:politica`): a ata da Alicerce vira diagnóstico; o sócio aprova; a
 * proposta da tabela vai à porta e fica RETIDA em R3; outra pessoa libera e o
 * efeito grava `proposta.publicada`; a dúvida é respondida a partir da
 * proposta; o pedido de 8% vira decisão e o desconto aprovado gera a v2 com as
 * parcelas fechando, de novo pela porta; "manter o preço" não muda nada;
 * proposta com laudo sujo vai à fila de decisões, nunca à porta; segurar
 * depois do pedido faz o efeito recusar.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lead, eventos, decisões, aprovações e rastro do comercial)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';

const RAIZ = resolve(__dirname, '../../..');
const ATA = readFileSync(join(RAIZ, 'homolog/fixtures/ata-alicerce.md'), 'utf8');
const MARCA = `ie${Date.now().toString(36).slice(-6)}`;
const SUFIXO = Date.now().toString().slice(-8);
const SENHA_DA_SOCIA = 'senha-da-socia-da-lane-e';
type P = Record<string, unknown>;

describe.skipIf(!URL)('a inteligência do cockpit, contra o banco e a régua', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const p = prisma as unknown as PrismaService;
  let ORG = '';
  let socia = { id: '', name: '' };
  let lucas = { id: '', papeis: ['gestor_marketing'] };
  let rodrigo = { id: '', papeis: ['gestor_marketing'] };
  let fio: FioService;
  let fichas: FichaService;
  let decisoes: DecisoesService;
  let config: ConfigComercialService;
  let sala: SalaService;
  let diagnosticos: DiagnosticoService;
  let propostas: PropostaService;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let leadId = '';

  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> => comContexto({ orgId: ORG, correlationId: `intel-${MARCA}`, origem: 'http' }, fn);
  const eventos = (lead: string, type: string) => prisma.leadEvent.findMany({ where: { leadId: lead, type }, orderBy: { occurredAt: 'asc' } });
  /*
   * Libera pela mesma confirmação de /atendimento. O sinal `volume_atipico` da
   * régua compara os pedidos da última hora (pelo `criadoEm` do BANCO, relógio
   * de verdade) com o `agora` desta suíte (relógio parado em 13/10 14h): conforme
   * a hora em que a suíte roda, o mesmo pedido sai R3 ou R4. Quando a régua sobe
   * a R4, quem assina é a titular, com senha e motivo; nada é afrouxado.
   */
  const liberar = async (approvalId: string, quem: { id: string; papeis: string[] }) => {
    const a = await prisma.approval.findUniqueOrThrow({ where: { id: approvalId } });
    const assina = a.alcadaMinima === 'titular' ? { id: socia.id, papeis: ['admin_master'], reauth: { senha: SENHA_DA_SOCIA } } : quem;
    await naEmpresa(() => approvals.confirm(ORG, approvalId, assina, a.exigeReauth ? 'conferi a versão e o desconto aprovado' : undefined));
    return naEmpresa(() => acoes.executarAprovada(ORG, approvalId, assina.id));
  };

  beforeAll(async () => {
    // 14:00 de São Paulo: fora da janela o sinal `fora_da_janela` sobe R3 para R4.
    vi.setSystemTime(new Date('2026-10-13T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';
    const org = await prisma.org.create({ data: { name: `Inteligência ${MARCA}`, slug: `intel-${MARCA}` } });
    ORG = org.id;
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin Master' } });
    const gestor = await prisma.role.create({ data: { orgId: ORG, key: 'gestor_marketing', name: 'Gestor de Marketing' } });
    socia = await prisma.user.create({ data: { orgId: ORG, name: 'Sócia da conta', email: `socia.${MARCA}@root.local`, passwordHash: await bcrypt.hash(SENHA_DA_SOCIA, 4), roles: { connect: { id: admin.id } } }, select: { id: true, name: true } });
    lucas.id = (await prisma.user.create({ data: { orgId: ORG, name: 'Lucas', email: `lucas.${MARCA}@root.local`, passwordHash: 'x', roles: { connect: { id: gestor.id } } } })).id;
    rodrigo.id = (await prisma.user.create({ data: { orgId: ORG, name: 'Rodrigo', email: `rodrigo.${MARCA}@root.local`, passwordHash: 'x', roles: { connect: { id: gestor.id } } } })).id;

    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    approvals = new ApprovalsService(p, audit, new ReauthService(p, new JwtService({ secret: `segredo-${MARCA}` }), audit));
    const log = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    new ConectoresService(p, audit, log, interruptores).onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, log, undefined, interruptores, efeitos);
    acoes = new AcoesService(p, gateway, log, interruptores, policy);
    const porta = new PortaDoOperador(gateway, efeitos);

    const reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    config = new ConfigComercialService(p);
    const aoDecidir = new DecisoesRegistry();
    decisoes = new DecisoesService(p, fio, config, aoDecidir);
    fichas = new FichaService(p, fio, config);
    const relogioComercial = new RelogioComercialRegistry();
    const relogio = new RelogioDaEspinha(p, new ExecutoresDeRotinaRegistry(), relogioComercial, decisoes, fio, config, fichas);
    relogio.inscrever();
    new ReacoesDaEspinha(p, fio, reacoes, fichas, decisoes, aoDecidir, relogio).inscrever();
    sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();

    const llm = new StubProvider(join(RAIZ, 'homolog/fixtures/stub'));
    diagnosticos = new DiagnosticoService(p, fio, reacoes, llm);
    diagnosticos.inscrever();
    propostas = new PropostaService(p, fio, reacoes, decisoes, aoDecidir, config, efeitos, porta, relogioComercial, llm);
    // O quadro "escrito por alguém": o de exemplo vira apontamento (revisão E-3), e tem caso próprio abaixo.
    propostas.fonteDoQuadro = () => ({ mesNormalCentavos: 18_000, piorMesCentavos: 34_000, exemplo: false, origem: 'escrito pelo sócio da conta (suíte)' });
    propostas.inscrever();
    new AssistenteService(p, reacoes, sala, llm).inscrever();

    await config.gravar(ORG, { validadePropostaDias: 8, valoresDeHomologacao: true });
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (ORG) {
      const ids = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
      await prisma.$transaction([
        prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
        prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
        prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
      ]);
      await prisma.comercialMensagem.deleteMany({ where: { leadId: { in: ids } } });
      await prisma.comercialReacao.deleteMany({ where: { leadId: { in: ids } } });
      await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: ids } } });
      await prisma.salaDoCliente.deleteMany({ where: { leadId: { in: ids } } });
      await prisma.comercialFicha.deleteMany({ where: { leadId: { in: ids } } });
      await prisma.leadEvent.deleteMany({ where: { leadId: { in: ids } } });
      await prisma.lead.deleteMany({ where: { orgId: ORG } });
      await prisma.rotina.deleteMany({ where: { orgId: ORG } });
      await prisma.comercialConfig.deleteMany({ where: { orgId: ORG } });
      await prisma.approval.deleteMany({ where: { orgId: ORG } });
      await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
      await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
      await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
      await prisma.user.deleteMany({ where: { orgId: ORG } });
      await prisma.role.deleteMany({ where: { orgId: ORG } });
      await prisma.org.deleteMany({ where: { id: ORG } });
    }
    await prisma.$disconnect();
  });

  /** O relógio está parado (setSystemTime): sem andar, fatos seguidos empatam no mesmo instante. */
  const aos = (hhmm: string) => vi.setSystemTime(new Date(`2026-10-13T${hhmm}:00-03:00`));

  async function novoLeadComAta(telefone: string, empresa: string): Promise<string> {
    const r = await naEmpresa(() => fichas.entrarPeloWhats(ORG, { telefone, texto: 'Vi o vídeo do fechamento. Funciona com Omie?', canal: 'conteudo', mensagemId: `m-${telefone}` }));
    await naEmpresa(() =>
      fio.registrar(ORG, r.leadId, 'form.respondido', `form-${telefone}`, { sistema: 'Omie', baseOrganizada: true, maiorDor: 'fechamento atrasado', equipeFinanceiro: 3, empresa, nome: 'Marina Duarte' }),
    );
    await naEmpresa(() => fichas.registrarAta(ORG, r.leadId, { texto: ATA, fonte: 'granola' }, { id: socia.id, nome: socia.name }));
    return r.leadId;
  }

  it('a ata da Alicerce vira diagnóstico com 4 dores com minuto e a objeção; a transcrição não fica no banco', async () => {
    leadId = await novoLeadComAta(`+55329${SUFIXO}`, 'Construtora Alicerce');
    const [diag] = await eventos(leadId, 'diagnostico.pronto');
    expect(diag, 'o leitor de ata não gravou o diagnóstico').toBeTruthy();
    const d = diag.payload as P;
    expect((d.dores as P[]).map((x) => x.minuto)).toEqual(['04:12', '11:40', '19:05', '27:30']);
    expect(d.objecoes).toEqual(['experiência ruim com consultoria']);
    expect(d).toMatchObject({ produtoSugerido: 'operacao', modelo: 'stub', custoUsd: 0, custoDesconhecido: false, aprovadoEm: null, caiuNoStub: false });

    const todos = await prisma.leadEvent.findMany({ where: { leadId } });
    expect(todos.some((e) => JSON.stringify(e.payload).includes('Exporta extrato, abre planilha'))).toBe(false);
    const reacao = await prisma.comercialReacao.findFirst({ where: { leadId, reacao: 'inteligencia.diagnostico' } });
    expect(reacao?.estado, reacao?.erro ?? '').toBe('ok');

    // Sem a aprovação do sócio, nenhuma proposta é montada.
    expect(await propostas.rascunhos(ORG, leadId)).toEqual([]);
  });

  it('o sócio aprova: a proposta da tabela, com laudo limpo, vai à porta e fica RETIDA em R3', async () => {
    await naEmpresa(() => diagnosticos.aprovar(ORG, leadId, { id: socia.id, nome: socia.name }));
    const ficha = await prisma.comercialFicha.findFirst({ where: { leadId } });
    expect(ficha?.diagnosticoAprovadoEm).toBeTruthy();

    const [v1] = await propostas.rascunhos(ORG, leadId);
    expect(v1, 'a reação não montou a proposta').toBeTruthy();
    expect(v1).toMatchObject({ versao: 1, estado: 'na_porta', dentroDaTabela: true, origem: 'diagnostico' });
    expect(v1.laudo.ok, v1.laudo.apontamentos.join('; ')).toBe(true);
    expect(v1.conteudo).toMatchObject({ produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, parcelaCentavos: 399_900, alternativa: 'imersao', validaAte: '2026-10-21T23:59:59-03:00' });
    expect(v1.conteudo.ouvimos).toHaveLength(4);
    expect(v1.conteudo.comoEDiferente).toMatch(/fica junto até ele rodar sozinho/);
    expect(v1.conteudo.quadroDeCustos).toMatchObject({ mesNormalCentavos: 18_000, piorMesCentavos: 34_000, exemplo: false });
    expect(v1.hash).toBe(hashDaVersao(v1.conteudo));

    const chamada = await prisma.toolCall.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAPACIDADE_DA_PROPOSTA } });
    expect(chamada.status).toBe('aguardando_aprovacao');
    expect(chamada.actorType).toBe(ActorType.system);
    const decisao = await prisma.policyDecision.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAPACIDADE_DA_PROPOSTA } });
    expect(decisao.nivel).toBe('R3');
    expect(await eventos(leadId, 'proposta.publicada')).toHaveLength(0);
  });

  it('outra pessoa libera: o efeito confere o hash e grava proposta.publicada com quadro, validade e laudo', async () => {
    const [v1] = await propostas.rascunhos(ORG, leadId);
    const exec = await liberar(v1.approvalId!, lucas);
    expect(exec.status).toBe('executado');

    const [pub] = await eventos(leadId, 'proposta.publicada');
    expect(pub.payload).toMatchObject({
      versao: 1,
      produto: 'operacao',
      valorCentavos: 1_199_700,
      parcelas: 3,
      parcelaCentavos: 399_900,
      dentroDaTabela: true,
      laudo: { ok: true, apontamentos: [] },
      hash: v1.hash,
      validaAte: '2026-10-21T23:59:59-03:00',
      quadroDeCustos: { mesNormalCentavos: 18_000, piorMesCentavos: 34_000 },
      alternativa: 'imersao',
      liberadaPor: lucas.id,
    });
    expect((await propostas.daVersao(ORG, leadId, 1))?.estado).toBe('publicada');
    const ficha = await prisma.comercialFicha.findFirst({ where: { leadId } });
    expect(ficha).toMatchObject({ propostaVersao: 1, valorCentavos: 1_199_700 });

    const estado = await sala.estadoDoLead(ORG, leadId);
    expect(estado?.proposta).toMatchObject({ versao: 1, recomendada: { produto: 'operacao' }, alternativa: { produto: 'imersao' }, custosDeTerceiros: { mesNormalCentavos: 18_000 } });
  });

  it('a dúvida do cliente é respondida a partir da proposta; o que não tem resposta segura vai ao sócio', async () => {
    const pergunta = 'Como ficam as parcelas?';
    await naEmpresa(() => fio.registrar(ORG, leadId, 'proposta.duvida', chaveDaDuvida(1, pergunta), { versao: 1, pergunta, resposta: null }));
    const outra = 'Vocês garantem o resultado?';
    await naEmpresa(() => fio.registrar(ORG, leadId, 'proposta.duvida', chaveDaDuvida(1, outra), { versao: 1, pergunta: outra, resposta: null }));

    const duvidas = (await sala.estadoDoLead(ORG, leadId))?.proposta?.duvidas ?? [];
    expect(duvidas.find((d) => d.pergunta === pergunta)?.resposta).toBe('A Operação ROOT sai em 3 parcelas de R$ 3.999,00, por pix, boleto ou cartão.');
    expect(duvidas.find((d) => d.pergunta === outra)?.resposta).toBe(RESPOSTA_DE_SEGURANCA);
    const reacao = await prisma.comercialReacao.findMany({ where: { leadId, reacao: 'inteligencia.duvida' } });
    expect(reacao.map((r) => (r.resultado as P).levadaAoSocio).sort()).toEqual([false, true]);
  });

  it('o pedido de 8% vira decisão; aprovar gera a v2 com as parcelas fechando, de novo pela porta (R3)', async () => {
    aos('14:20');
    await naEmpresa(() => fio.registrar(ORG, leadId, 'proposta.ajuste_pedido', `ajuste-1-${MARCA}`, { versao: 1, pedido: 'Consegue 8% de desconto?', descontoPct: 8 }));
    const d = await prisma.comercialDecisao.findFirstOrThrow({ where: { leadId, tipo: 'pedido_de_ajuste' } });
    expect((d.opcoes as P[]).map((o) => o.chave)).toEqual(['desconto:4', 'desconto:8', 'manter']);
    expect(d.padrao).toBe('manter');
    expect(d.contexto).toMatch(/Consegue 8%/);
    expect((await sala.estadoDoLead(ORG, leadId))?.proposta?.ajustePendente).toBe(true);

    aos('14:30');
    await naEmpresa(() => decisoes.responder(ORG, d.id, 'desconto:8', { id: socia.id, nome: socia.name }, 'tela'));
    const v2 = await propostas.daVersao(ORG, leadId, 2);
    expect(v2).toMatchObject({ versao: 2, estado: 'na_porta', origem: 'ajuste', dentroDaTabela: false });
    expect(v2?.laudo.ok, v2?.laudo.apontamentos.join('; ')).toBe(true);
    expect(v2?.conteudo).toMatchObject({ valorCentavos: 1_103_724, parcelas: 3, parcelaCentavos: 367_908, ultimaParcelaCentavos: 367_908, descontoPct: 8, descontoDecisaoId: d.id });
    expect(v2!.conteudo.parcelaCentavos * 2 + v2!.conteudo.ultimaParcelaCentavos).toBe(v2!.conteudo.valorCentavos);

    aos('14:40');
    const exec = await liberar(v2!.approvalId!, rodrigo);
    expect(exec.status).toBe('executado');
    const publicadas = await eventos(leadId, 'proposta.publicada');
    expect(publicadas.map((e) => (e.payload as P).versao)).toEqual([1, 2]);
    expect(publicadas[1].payload).toMatchObject({ versao: 2, valorCentavos: 1_103_724, descontoPct: 8, dentroDaTabela: false, laudo: { ok: true } });
    expect(((publicadas[1].payload as P).notasDoLaudo as string[]).join(' ')).toMatch(/desconto de 8% aprovado/);
    expect((await sala.estadoDoLead(ORG, leadId))?.proposta).toMatchObject({ versao: 2, ajustePendente: false, recomendada: { valorCentavos: 1_103_724, descontoPct: 8 } });
  });

  it('"manter o preço": nada muda e a sala mostra o ajuste respondido', async () => {
    aos('15:00');
    await naEmpresa(() => fio.registrar(ORG, leadId, 'proposta.ajuste_pedido', `ajuste-2-${MARCA}`, { versao: 2, pedido: 'E 10%?', descontoPct: 10 }));
    const d = await prisma.comercialDecisao.findFirstOrThrow({ where: { leadId, tipo: 'pedido_de_ajuste', estado: 'aberta' } });
    expect((await sala.estadoDoLead(ORG, leadId))?.proposta?.ajustePendente).toBe(true);
    aos('15:10');
    await naEmpresa(() => decisoes.responder(ORG, d.id, 'manter', { id: socia.id, nome: socia.name }, 'tela'));
    expect(await propostas.daVersao(ORG, leadId, 3)).toBeNull();
    expect((await sala.estadoDoLead(ORG, leadId))?.proposta).toMatchObject({ versao: 2, ajustePendente: false });
  });

  it('laudo sujo (sem validade) não vai à porta: vira a decisão proposta_fora_da_tabela; segurar depois do pedido faz o efeito recusar', async () => {
    aos('15:30');
    await config.gravar(ORG, { validadePropostaDias: null });
    try {
      const outro = await novoLeadComAta(`+55319${SUFIXO}`, 'Construtora Alicerce Filial');
      const chamadasAntes = await prisma.toolCall.count({ where: { orgId: ORG, capabilityId: CAPACIDADE_DA_PROPOSTA } });
      await naEmpresa(() => diagnosticos.aprovar(ORG, outro, { id: socia.id, nome: socia.name }));
      const [v1] = await propostas.rascunhos(ORG, outro);
      expect(v1).toMatchObject({ versao: 1, estado: 'na_fila', dentroDaTabela: true });
      expect(v1.laudo.apontamentos.join(' ')).toMatch(/validade não escrita/);
      expect(await prisma.toolCall.count({ where: { orgId: ORG, capabilityId: CAPACIDADE_DA_PROPOSTA } })).toBe(chamadasAntes);
      const d = await prisma.comercialDecisao.findFirstOrThrow({ where: { leadId: outro, tipo: 'proposta_fora_da_tabela' } });
      expect(d.padrao).toBe('segurar');

      // "Levar à liberação assim": vai à porta, e o R3 continua valendo.
      await naEmpresa(() => decisoes.responder(ORG, d.id, 'liberar', { id: socia.id, nome: socia.name }, 'tela'));
      const naPorta = await propostas.daVersao(ORG, outro, 1);
      expect(naPorta?.estado).toBe('na_porta');

      // Segurada antes da liberação: a aprovação chega e o efeito recusa.
      await propostas.segurar(ORG, outro);
      await liberar(naPorta!.approvalId!, lucas).catch(() => null);
      expect(await eventos(outro, 'proposta.publicada')).toHaveLength(0);
      expect((await propostas.daVersao(ORG, outro, 1))?.estado).toBe('segurada');
    } finally {
      await config.gravar(ORG, { validadePropostaDias: 8 });
    }
  });
  it('quadro de EXEMPLO (só com a variável): o revisor aponta, uma pessoa leva à liberação, e a sala mostra a marca', async () => {
    aos('15:45');
    const fonte = propostas.fonteDoQuadro;
    const antes = process.env.QUADRO_DE_CUSTOS_EXEMPLO;
    process.env.QUADRO_DE_CUSTOS_EXEMPLO = join(RAIZ, 'homolog/fixtures/quadro-de-custos-exemplo.json');
    propostas.fonteDoQuadro = quadroDeExemplo;
    try {
      const outro = await novoLeadComAta(`+55339${SUFIXO}`, 'Construtora Alicerce Exemplo');
      const chamadasAntes = await prisma.toolCall.count({ where: { orgId: ORG, capabilityId: CAPACIDADE_DA_PROPOSTA } });
      await naEmpresa(() => diagnosticos.aprovar(ORG, outro, { id: socia.id, nome: socia.name }));
      const [v1] = await propostas.rascunhos(ORG, outro);
      expect(v1).toMatchObject({ versao: 1, estado: 'na_fila', dentroDaTabela: true });
      expect(v1.conteudo.quadroDeCustos).toMatchObject({ mesNormalCentavos: 18_000, exemplo: true });
      expect(v1.laudo.apontamentos.join(' ')).toMatch(/VALORES DE EXEMPLO/);
      expect(await prisma.toolCall.count({ where: { orgId: ORG, capabilityId: CAPACIDADE_DA_PROPOSTA } })).toBe(chamadasAntes);

      const d = await prisma.comercialDecisao.findFirstOrThrow({ where: { leadId: outro, tipo: 'proposta_fora_da_tabela' } });
      expect(d.contexto).toMatch(/VALORES DE EXEMPLO/);
      await naEmpresa(() => decisoes.responder(ORG, d.id, 'liberar', { id: socia.id, nome: socia.name }, 'tela'));
      const naPorta = await propostas.daVersao(ORG, outro, 1);
      expect(naPorta?.estado).toBe('na_porta');
      expect((await liberar(naPorta!.approvalId!, lucas)).status).toBe('executado');
      const [pub] = await eventos(outro, 'proposta.publicada');
      expect(pub.payload).toMatchObject({ quadroDeCustos: { mesNormalCentavos: 18_000, exemplo: true }, laudo: { ok: false } });
      expect((await sala.estadoDoLead(ORG, outro))?.proposta?.custosDeTerceiros).toEqual({ mesNormalCentavos: 18_000, piorMesCentavos: 34_000, exemplo: true });
    } finally {
      propostas.fonteDoQuadro = fonte;
      if (antes === undefined) delete process.env.QUADRO_DE_CUSTOS_EXEMPLO;
      else process.env.QUADRO_DE_CUSTOS_EXEMPLO = antes;
    }
  });

  it('silêncio aprova (K08-3) só agenda: a versão espera a hora de SP, o relógio a leva à porta e o R3 continua retendo', async () => {
    aos('16:00');
    await config.gravar(ORG, { silencioAprova: true, horaPublicacaoProposta: 18 });
    try {
      const outro = await novoLeadComAta(`+55219${SUFIXO}`, 'Construtora Alicerce Matriz');
      await naEmpresa(() => diagnosticos.aprovar(ORG, outro, { id: socia.id, nome: socia.name }));
      const [v1] = await propostas.rascunhos(ORG, outro);
      expect(v1).toMatchObject({ versao: 1, estado: 'agendada', publicarEm: '2026-10-13T21:00:00.000Z', approvalId: null });

      aos('17:30');
      expect(await naEmpresa(() => propostas.soltarAgendadas(ORG, new Date()))).toEqual({ levadas: 0 });
      aos('18:01');
      expect(await naEmpresa(() => propostas.soltarAgendadas(ORG, new Date()))).toEqual({ levadas: 1 });
      const depois = await propostas.daVersao(ORG, outro, 1);
      expect(depois?.estado).toBe('na_porta');
      const chamada = await prisma.toolCall.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAPACIDADE_DA_PROPOSTA, approvalId: depois!.approvalId! } });
      expect(chamada.status).toBe('aguardando_aprovacao');
      expect(await eventos(outro, 'proposta.publicada')).toHaveLength(0);
    } finally {
      await config.gravar(ORG, { silencioAprova: false, horaPublicacaoProposta: null });
    }
  });
});
