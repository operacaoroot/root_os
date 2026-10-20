import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import type { JwtUser } from '../src/auth/current-user.decorator';
import { CofreService, EmpresaDivergenteNoCofreError } from '../src/cofre/cofre.service';
import { comContexto } from '../src/common/contexto-execucao';
import {
  DigisacProvider,
  escolhaNumerada,
  lerWebhookDoDigisac,
  respostaDoFormulario,
  textoComBotoes,
  textoComFormulario,
} from '../src/comercial/canais/digisac.provider';
import { ProvedorIndisponivelError, provedorDoAmbiente } from '../src/comercial/canais/whatsapp.port';
import { DigisacEntradaService } from '../src/comercial/digisac-entrada.service';
import { IntegracaoDoDigisacController, WebhookDoDigisacController } from '../src/comercial/digisac.controller';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService } from '../src/comercial/sala.service';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { baseDoDigisac, DigisacService, segredoDigisacConfere } from '../src/gateway/canais/digisac.conector';
import { TransporteDeCanalRegistry } from '../src/gateway/canais/transporte.registry';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { RegistroDeConectores } from '../src/integrations/conectores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';
import { subirDubleDigisac, type DubleDigisac } from './digisac-duble';

/*
 * O WHATSAPP PELO DIGISAC (Interface 20/10, lane U6).
 *
 * Primeiro as partes puras (texto numerado, leitura da resposta, leitura do
 * webhook, endereço da conta, segredo) e uma catraca: só o provedor chama os
 * métodos de envio do DigiSac. Depois, com banco e um DUBLÊ HTTP do DigiSac, a
 * cadeia inteira: guardar a credencial no cofre, listar conexões, sondar, a M1
 * retida pela régua (R3) e entregue como texto numerado só depois da segunda
 * pessoa, o webhook com segredo virando formulário respondido e horário
 * escolhido, as recusas, o grupo, o isolamento entre empresas e a revogação.
 * Nenhum dado do escritório Cardozo & Saggioro: contas, tokens e números são
 * inventados.
 */

const FORM = {
  id: 'qualificacao-v1',
  titulo: 'Quatro perguntas',
  campos: [
    { chave: 'sistema', rotulo: 'Qual sistema vocês usam?', tipo: 'texto' },
    { chave: 'baseOrganizada', rotulo: 'A base de dados está organizada?', tipo: 'sim_nao' },
    { chave: 'maiorDor', rotulo: 'Qual é a maior dor hoje?', tipo: 'texto' },
    { chave: 'equipeFinanceiro', rotulo: 'Quantas pessoas no financeiro?', tipo: 'numero' },
  ],
};
const BOTOES = [
  { chave: '2026-10-14T10:00:00-03:00', rotulo: 'Qua 14/10 · 10h' },
  { chave: '2026-10-14T15:00:00-03:00', rotulo: 'Qua 14/10 · 15h' },
];

describe('DigiSac: as partes puras', () => {
  it('botões viram lista numerada e a resposta numerada vira a chave', () => {
    const t = textoComBotoes('Escolha um horário.', BOTOES);
    expect(t).toBe('Escolha um horário.\n\n1. Qua 14/10 · 10h\n2. Qua 14/10 · 15h\n\nResponda com o número da opção.');
    expect(escolhaNumerada('2', BOTOES)).toBe(BOTOES[1].chave);
    expect(escolhaNumerada(' 1. ', BOTOES)).toBe(BOTOES[0].chave);
    expect(escolhaNumerada('opção 2', BOTOES)).toBe(BOTOES[1].chave);
    expect(escolhaNumerada('3', BOTOES)).toBeNull();
    expect(escolhaNumerada('0', BOTOES)).toBeNull();
    expect(escolhaNumerada('pode ser às 2', BOTOES)).toBeNull();
  });

  it('o formulário vira perguntas numeradas e a resposta completa vira os campos com o tipo certo', () => {
    const t = textoComFormulario('Oi.', FORM);
    expect(t).toContain('1. Qual sistema vocês usam?\n2. A base de dados está organizada? (sim ou não)');
    expect(t).toContain('4. Quantas pessoas no financeiro? (um número)');
    expect(respostaDoFormulario('1. Omie\n2. sim\n3. fechamento leva 9 dias\n4. 3', FORM)).toEqual({
      sistema: 'Omie', baseOrganizada: true, maiorDor: 'fechamento leva 9 dias', equipeFinanceiro: 3,
    });
    expect(respostaDoFormulario('1) Conta Azul 2) não 3) conciliação 4) duas pessoas, 2', FORM)).toEqual({
      sistema: 'Conta Azul', baseOrganizada: false, maiorDor: 'conciliação', equipeFinanceiro: 2,
    });
    // Faltou pergunta, sim/não ilegível ou número ausente: a mensagem segue como texto livre.
    expect(respostaDoFormulario('1. Omie\n2. sim\n3. fechamento', FORM)).toBeNull();
    expect(respostaDoFormulario('1. Omie\n2. talvez\n3. x\n4. 3', FORM)).toBeNull();
    expect(respostaDoFormulario('1. Omie\n2. sim\n3. x\n4. muitas', FORM)).toBeNull();
    expect(respostaDoFormulario('Uso o Omie, sim.', FORM)).toBeNull();
  });

  it('o webhook só deixa passar o texto que o contato mandou', () => {
    const base = { event: 'message.created', data: { id: 'm1', isFromMe: false, type: 'chat', text: ' Oi ', contactId: 'c1', serviceId: 's1' } };
    expect(lerWebhookDoDigisac(base)).toEqual({ mensagem: { mensagemId: 'm1', contatoId: 'c1', servicoId: 's1', texto: 'Oi', numero: null } });
    expect(lerWebhookDoDigisac({ ...base, data: { ...base.data, isFromMe: true } })).toEqual({ ignorado: 'mensagem da própria conta' });
    expect(lerWebhookDoDigisac({ ...base, event: 'message.updated' })).toEqual({ ignorado: 'evento message.updated' });
    expect(lerWebhookDoDigisac({ ...base, data: { ...base.data, type: 'comment' } })).toEqual({ ignorado: 'tipo comment' });
    expect(lerWebhookDoDigisac({ ...base, data: { ...base.data, isFromBot: true } })).toEqual({ ignorado: 'mensagem de robô' });
    expect(lerWebhookDoDigisac({ ...base, data: { ...base.data, text: '' } })).toEqual({ ignorado: 'sem texto' });
    expect(lerWebhookDoDigisac({ ...base, data: { ...base.data, contact: { isGroup: true } } })).toEqual({ ignorado: 'mensagem de grupo' });
    expect(lerWebhookDoDigisac(null)).toEqual({ ignorado: 'evento ausente' });
    const comNumero = lerWebhookDoDigisac({ ...base, data: { ...base.data, contact: { data: { number: '5532911112222' } } } });
    expect(comNumero).toMatchObject({ mensagem: { numero: '5532911112222' } });
    // A entrada síncrona da porta só monta o evento quando o número já veio no corpo.
    const prov = new DigisacProvider(null);
    expect(prov.receber(base)).toBeNull();
    expect(prov.receber({ ...base, data: { ...base.data, contact: { data: { number: '32911112222' } } } })).toEqual({
      telefone: '5532911112222', texto: 'Oi', mensagemId: 'm1', interativo: null,
    });
  });

  it('o endereço da conta: https num domínio do DigiSac, sem caminho; http só para o dublê em loopback', () => {
    expect(baseDoDigisac('https://minhaconta.digisac.me')).toBe('https://minhaconta.digisac.me');
    expect(baseDoDigisac('https://MinhaConta.Digisac.me/api/v1/')).toBe('https://minhaconta.digisac.me');
    expect(baseDoDigisac('https://minhaconta.digisac.chat')).toBe('https://minhaconta.digisac.chat');
    expect(baseDoDigisac('https://minhaconta.digisac.com')).toBe('https://minhaconta.digisac.com');
    expect(baseDoDigisac('http://minhaconta.digisac.me')).toBeNull();
    expect(baseDoDigisac('http://127.0.0.1:4013/api/v1')).toBe('http://127.0.0.1:4013');
    expect(baseDoDigisac('http://localhost:4013')).toBe('http://localhost:4013');
    expect(baseDoDigisac('http://[::1]:4013')).toBe('http://[::1]:4013');
    expect(baseDoDigisac('https://minhaconta.digisac.me/outra')).toBeNull();
    expect(baseDoDigisac('https://u:p@minhaconta.digisac.me')).toBeNull();
    expect(baseDoDigisac('não é url')).toBeNull();
  });

  it('o endereço da conta recusa a rede interna (SSRF): nome de container, IP literal, metadados e domínio parecido', () => {
    for (const url of [
      'http://minio:9000',
      'https://minio:9000',
      'http://digisac-mock:4013',
      'https://10.0.0.5',
      'https://192.168.0.10',
      'https://172.17.0.1:8080',
      'https://169.254.169.254',
      'http://169.254.169.254/latest/meta-data',
      'https://[fd00::1]',
      'https://[::ffff:10.0.0.5]',
      'https://conta.digisac.me.atacante.com',
      'https://digisac.me',
      'https://atacantedigisac.me',
      'https://a.b.digisac.me',
      'https://conta.digisac.me?x=1',
      'ftp://conta.digisac.me',
      'http://0.0.0.0:3000',
    ]) {
      expect(baseDoDigisac(url), url).toBeNull();
    }
  });

  it('o endereço da conta recusado não sai do sistema: a tela recebe a regra, nunca uma resposta do host', async () => {
    const espiao = vi.spyOn(globalThis, 'fetch');
    try {
      const cofre = { envolver: vi.fn(), guardar: vi.fn(), estado: vi.fn() };
      const conector = new DigisacService({} as never, cofre as never);
      for (const url of ['http://minio:9000', 'https://10.0.0.5', 'https://169.254.169.254', 'https://conta.digisac.me.atacante.com']) {
        const erro = await conector.guardarCredencial('org-x', { url, token: 't', servicoId: 's' }, null).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(BadRequestException);
        expect((erro as Error).message).toBe('Endereço da conta inválido: use https://<sua conta>.digisac.me, sem caminho.');
      }
      expect(espiao).not.toHaveBeenCalled();
      expect(cofre.guardar).not.toHaveBeenCalled();
    } finally {
      espiao.mockRestore();
    }
    expect(baseDoDigisac('https://minhaconta.digisac.me/outra')).toBeNull();
    expect(baseDoDigisac('https://u:p@minhaconta.digisac.me')).toBeNull();
    expect(baseDoDigisac('não é url')).toBeNull();
  });

  it('o segredo compara em tempo constante e vazio nunca confere', () => {
    const s = 'a'.repeat(40);
    expect(segredoDigisacConfere(s, s)).toBe(true);
    expect(segredoDigisacConfere(s, `${s}b`)).toBe(false);
    expect(segredoDigisacConfere(s, 'b'.repeat(40))).toBe(false);
    expect(segredoDigisacConfere(null, '')).toBe(false);
    expect(segredoDigisacConfere(s, undefined)).toBe(false);
  });

  it('WHATSAPP_PROVEDOR=digisac escolhe o provedor; sem empresa ou sem conector, nada sai', async () => {
    expect(provedorDoAmbiente('digisac')).toBe('digisac');
    expect(provedorDoAmbiente('DigiSac ')).toBe('digisac');
    expect(new DigisacProvider(null).configured).toBe(false);
    const envio = { enviarParaNumero: vi.fn(), enviarParaContato: vi.fn(), criarGrupo: vi.fn() };
    const prov = new DigisacProvider(envio);
    await expect(prov.enviarTexto('32911112222', 'oi')).rejects.toBeInstanceOf(ProvedorIndisponivelError);
    await expect(comContexto({ orgId: 'org-x', correlationId: 'c' }, () => prov.enviarNoGrupo('sim-grupo@g.us', 'oi'))).rejects.toThrow(/não foi criado pelo DigiSac/);
    expect(envio.enviarParaNumero).not.toHaveBeenCalled();
  });
});

/*
 * A CATRACA DO ENVIO. A porta `ENVIO_PELO_DIGISAC` manda texto a número
 * arbitrário. Só o provedor do comercial a usa (e o provedor só é chamado pelo
 * efeito de `comercial.whatsapp.enviar`, R3). Esta varredura é a prova.
 */
describe('DigiSac: só o provedor manda mensagem', () => {
  const RAIZ = path.resolve(__dirname, '..');
  const fontes: Array<{ arquivo: string; texto: string }> = [];
  const andar = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const c = path.join(dir, e);
      if (statSync(c).isDirectory()) andar(c);
      else if (e.endsWith('.ts')) {
        // Comentário fora: citar a porta num comentário não é usá-la.
        const texto = readFileSync(c, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        fontes.push({ arquivo: path.relative(RAIZ, c).split(path.sep).join('/'), texto });
      }
    }
  };
  andar(path.join(RAIZ, 'src'));

  it('a porta de envio só é injetada onde o provedor nasce', () => {
    const usam = fontes.filter((f) => f.texto.includes('ENVIO_PELO_DIGISAC')).map((f) => f.arquivo).sort();
    expect(usam).toEqual(['src/comercial/whatsapp.service.ts', 'src/gateway/canais/canais.module.ts', 'src/gateway/canais/digisac.port.ts']);
  });

  it('os métodos de envio só são chamados pelo provedor (e o transporte do canal, de dentro da pasta do canal)', () => {
    const chamam = fontes
      .filter((f) => /\.(enviarParaNumero|enviarParaContato)\s*\(/.test(f.texto))
      .map((f) => f.arquivo)
      .sort();
    expect(chamam).toEqual(['src/comercial/canais/digisac.provider.ts', 'src/gateway/canais/digisac.conector.ts']);
  });

  it('ninguém fora da pasta do canal importa o conector', () => {
    const fora = fontes.filter((f) => /from\s+['"][^'"]*digisac\.conector['"]/.test(f.texto) && !f.arquivo.startsWith('src/gateway/')).map((f) => f.arquivo);
    expect(fora).toEqual([]);
  });
});

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresas, cofre, leads, mensagens e aprovações do DigiSac)');
// O cofre exige 32 bytes em base64; a sala aceita qualquer texto. Chave inventada, só de teste.
if (Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64').length !== 32) process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

describe.skipIf(!URL)('DigiSac com banco e dublê HTTP', () => {
  const MARCA = `dg${Date.now().toString(36).slice(-6)}`;
  const ORG_A = `org-dga-${MARCA}`;
  const ORG_B = `org-dgb-${MARCA}`;
  const ORG_C = `org-dgc-${MARCA}`;
  const LUCAS = { id: `lucas-${MARCA}`, papeis: ['gestor_marketing'] };
  const TOKEN_A = `tok-a-${MARCA}-inventado`;
  const TOKEN_B = `tok-b-${MARCA}-inventado`;
  const TOKEN_CASA = `tok-casa-${MARCA}-inventado`;
  const SEG_A = `segredo-a-${MARCA}-0123456789abcdefghij`;
  const SEG_B = `segredo-b-${MARCA}-0123456789abcdefghij`;
  const TELEFONE = '32988880001';
  /*
   * O dia da suíte: dois dias depois do relógio real, às 14h de São Paulo (dentro
   * da janela da política). O sinal de volume atípico conta as chamadas da última
   * hora pelo carimbo do banco; com o dia no futuro, a M1 de uma hora antes não
   * conta para a M2, e a régua fica em R3, como num dia normal.
   */
  const DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + 2 * 86_400_000));

  let prisma: PrismaClient;
  let duble: DubleDigisac;
  let digisac: DigisacService;
  let registro: RegistroDeConectores;
  let conectores: ConectoresService;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let whats: WhatsappComercialService;
  let integ: IntegracaoDoDigisacController;
  let webhook: WebhookDoDigisacController;
  let entrada: DigisacEntradaService;
  let casaId = '';
  let leadId = '';
  const provedorAntes = process.env.WHATSAPP_PROVEDOR;

  const em = <T>(orgId: string, fn: () => Promise<T>): Promise<T> => comContexto({ orgId, correlationId: `dg-${MARCA}`, origem: 'http' }, fn);
  const user = (orgId: string): JwtUser => ({ sub: LUCAS.id, orgId, email: 'l@x.y', name: 'Lucas', roles: [], permissions: [] });
  const doTipo = (metodo: string, prefixo: string) => duble.pedidos.filter((p) => p.metodo === metodo && p.caminho.startsWith(prefixo));
  const entregar = async (orgId: string, corpo: unknown, segredo: string | undefined, porCabecalho = false) => {
    const r = await webhook.receber(orgId, porCabecalho ? segredo : undefined, porCabecalho ? undefined : segredo, corpo);
    await webhook.trabalhoEmCurso;
    return r;
  };
  const mensagemDoLead = (id: string, texto: string, extra: Record<string, unknown> = {}) => ({
    event: 'message.created',
    webhookId: 'wh-1',
    data: { id, isFromMe: false, type: 'chat', text: texto, contactId: 'ct-lead', serviceId: 'svc-a', ...extra },
  });
  const confirmarEEnviar = async (template: string) => {
    const m = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template } });
    expect(m.estado, m.erro ?? '').toBe('na_fila');
    await em(ORG_A, () => approvals.confirm(ORG_A, m.approvalId!, LUCAS));
    const exec = await em(ORG_A, () => acoes.executarAprovada(ORG_A, m.approvalId!, LUCAS.id));
    expect(exec.status).toBe('executado');
    return prisma.comercialMensagem.findUniqueOrThrow({ where: { id: m.id } });
  };

  beforeAll(async () => {
    vi.setSystemTime(new Date(`${DIA}T14:00:00-03:00`));
    process.env.GATEWAY_MODO = 'impor';
    process.env.WHATSAPP_PROVEDOR = 'digisac';
    duble = await subirDubleDigisac({
      [TOKEN_A]: { servicos: [{ id: 'svc-a', name: 'WhatsApp Root', type: 'whatsapp', archivedAt: null }, { id: 'svc-velho', name: 'Antigo', type: 'whatsapp', archivedAt: '2026-01-01T00:00:00Z' }], contatos: { 'ct-lead': { number: '5532988880001', serviceId: 'svc-a' } } },
      [TOKEN_B]: { servicos: [{ id: 'svc-b', name: 'WhatsApp B', type: 'whatsapp', archivedAt: null }], contatos: {} },
      [TOKEN_CASA]: { servicos: [{ id: 'svc-casa', name: 'Casa', type: 'whatsapp', archivedAt: null }], contatos: {} },
    });

    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    for (const [id, nome] of [[ORG_A, 'A'], [ORG_B, 'B'], [ORG_C, 'C']]) {
      await prisma.org.create({ data: { id, name: `DigiSac ${nome} ${MARCA}`, slug: `dg-${nome.toLowerCase()}-${MARCA}` } });
    }
    const casa = await prisma.org.upsert({ where: { slug: 'root' }, create: { name: 'Root (teste)', slug: 'root' }, update: {}, select: { id: true } });
    casaId = casa.id;
    const papel = await prisma.role.create({ data: { orgId: ORG_A, key: 'gestor_marketing', name: 'Gestor de Marketing' }, select: { id: true } });
    await prisma.user.create({ data: { id: LUCAS.id, orgId: ORG_A, email: `${LUCAS.id}@dg.teste`, name: 'Lucas', passwordHash: 'sem-senha-util', roles: { connect: { id: papel.id } } } });

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    approvals = new ApprovalsService(p, audit);
    const eventos = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    conectores = new ConectoresService(p, audit, eventos, interruptores);
    conectores.onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, efeitos);
    acoes = new AcoesService(p, gateway, eventos, interruptores, policy);
    const porta = new PortaDoOperador(gateway, efeitos);

    registro = new RegistroDeConectores();
    const cofre = new CofreService(p, eventos);
    digisac = new DigisacService(p, cofre, registro, new TransporteDeCanalRegistry(), interruptores);
    digisac.onModuleInit();

    const reacoes = new ReacoesRegistry();
    const fio = new FioService(p, reacoes);
    const sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    whats = new WhatsappComercialService(p, fio, reacoes, new RelogioComercialRegistry(), sala, efeitos, porta, undefined, digisac);
    whats.onModuleInit();
    entrada = new DigisacEntradaService(p, whats, sala, digisac);
    webhook = new WebhookDoDigisacController(entrada);
    integ = new IntegracaoDoDigisacController(digisac);
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (provedorAntes === undefined) delete process.env.WHATSAPP_PROVEDOR;
    else process.env.WHATSAPP_PROVEDOR = provedorAntes;
    await duble?.fechar();
    if (!prisma) return;
    const orgs = [ORG_A, ORG_B, ORG_C];
    const ids = (await prisma.lead.findMany({ where: { orgId: { in: orgs } }, select: { id: true } })).map((l) => l.id);
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = ANY($1::text[])', orgs),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.comercialMensagem.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialReacao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.salaDoCliente.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.approval.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.toolCall.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.policyDecision.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.segredoDeConector.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.conectorDesligado.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.user.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.role.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.org.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });

  it('autorizar grava url, token, conexão e segredo no cofre, cifrados, e o token não volta para a tela', async () => {
    const r = await em(ORG_A, () => integ.credencial(user(ORG_A), { url: `${duble.url}/api/v1`, token: TOKEN_A, servicoId: 'svc-a', segredoDoWebhook: SEG_A }));
    expect(r).toMatchObject({ origem: 'cofre', url: duble.url, servicoId: 'svc-a', tokenGuardado: true, segredoDoWebhook: true, desligado: false });
    expect(r.caminhoDoWebhook).toBe(`/api/comercial/webhooks/digisac/${ORG_A}`);
    expect(r.parametroDoSegredo).toBe('segredo');
    expect(JSON.stringify(r)).not.toContain(TOKEN_A);
    expect(JSON.stringify(r)).not.toContain(SEG_A);
    const linhas = await prisma.segredoDeConector.findMany({ where: { orgId: ORG_A, conector: 'digisac' }, select: { nome: true, valorCifrado: true } });
    expect(linhas.map((l) => l.nome).sort()).toEqual(['servico', 'token', 'url', 'webhook_segredo']);
    for (const l of linhas) {
      expect(l.valorCifrado).not.toContain(TOKEN_A);
      expect(l.valorCifrado).not.toContain(SEG_A);
    }
    // Endereço fora do padrão e segredo curto são recusados antes do cofre.
    await expect(em(ORG_A, () => integ.credencial(user(ORG_A), { url: 'http://conta.digisac.me', token: 'x', servicoId: 's' }))).rejects.toMatchObject({ status: 400 });
    await expect(em(ORG_A, () => integ.credencial(user(ORG_A), { url: duble.url, servicoId: 's', segredoDoWebhook: 'curto' }))).rejects.toMatchObject({ status: 400 });
    // Trocar só a conexão não pede o token de novo.
    const r2 = await em(ORG_A, () => integ.credencial(user(ORG_A), { url: duble.url, servicoId: 'svc-a' }));
    expect(r2.tokenGuardado).toBe(true);
  });

  it('sincronizar lista as conexões da conta; a saúde é sondada com latência medida', async () => {
    const { servicos } = await em(ORG_A, () => integ.servicos(user(ORG_A)));
    expect(servicos).toEqual([
      { id: 'svc-a', nome: 'WhatsApp Root', tipo: 'whatsapp', arquivado: false },
      { id: 'svc-velho', nome: 'Antigo', tipo: 'whatsapp', arquivado: true },
    ]);
    const s = await em(ORG_A, () => registro.sincronizar('digisac', { orgId: ORG_A }));
    expect(s).toMatchObject({ tipo: 'feito', numeros: { conexoes: 2, ativas: 1 } });
    const saude = await em(ORG_A, () => registro.sondar({ orgId: ORG_A, chave: 'digisac' }));
    expect(saude.estado).toBe('conectado');
    expect(saude.apuracao).toBe('tentativa');
    expect(typeof saude.latenciaMs).toBe('number');
    expect(saude.mensagem).toContain('WhatsApp Root');
    const semNada = await em(ORG_C, () => registro.sondar({ orgId: ORG_C, chave: 'digisac' }));
    expect(semNada.estado).toBe('nao_configurado');
    expect(duble.pedidos.every((p) => p.autorizacao === `Bearer ${TOKEN_A}`)).toBe(true);
  });

  it('a M1 fica retida (R3); depois da segunda pessoa sai como texto numerado, com Bearer e número normalizado', async () => {
    const antes = doTipo('POST', '/api/v1/messages').length;
    ({ leadId } = await em(ORG_A, () => whats.receberEntrada(ORG_A, { telefone: TELEFONE, texto: 'Oi! Funciona com Omie?', nome: 'Marina Teste', mensagemId: `${MARCA}-1` })));
    expect(doTipo('POST', '/api/v1/messages').length).toBe(antes);

    const m1 = await confirmarEEnviar('M1');
    expect(m1.estado).toBe('enviada');
    expect(m1.provedor).toBe('digisac');
    const [pedido] = doTipo('POST', '/api/v1/messages').slice(antes);
    expect(m1.mensagemExternaId).toMatch(/^msg-/);
    expect(pedido.autorizacao).toBe(`Bearer ${TOKEN_A}`);
    const corpo = pedido.corpo as Record<string, string>;
    expect(corpo).toMatchObject({ type: 'chat', number: '5532988880001', serviceId: 'svc-a' });
    expect(corpo.text).toContain('1. Qual sistema vocês usam?');
    expect(corpo.text).toContain('Responda numa mensagem só');
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'whats.enviada' } })).toBe(1);
  });

  it('o webhook com o segredo certo vira evento; o formulário respondido em números vira form.respondido', async () => {
    // Uma hora e pouco depois da M1: a M2 que esta resposta prepara não cai no sinal de volume atípico (que sobe R3 para R4).
    vi.setSystemTime(new Date(`${DIA}T15:10:00-03:00`));
    const recebidasAntes = await prisma.leadEvent.count({ where: { leadId, type: 'whats.recebida' } });
    expect(await entregar(ORG_A, mensagemDoLead('dg-in-1', '1. Omie\n2. sim\n3. fechamento leva 9 dias\n4. 3'), SEG_A)).toEqual({ ok: true });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'whats.recebida' } })).toBe(recebidasAntes + 1);
    const form = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'form.respondido' } });
    expect(form.payload).toMatchObject({ sistema: 'Omie', baseOrganizada: true, equipeFinanceiro: 3 });
    // O número veio do contato no DigiSac, com o token da empresa.
    const busca = doTipo('GET', '/api/v1/contacts/ct-lead');
    expect(busca.length).toBeGreaterThan(0);
    expect(busca.at(-1)!.autorizacao).toBe(`Bearer ${TOKEN_A}`);
  });

  it('a M2 sai com os horários numerados e a resposta "2" escolhe o segundo horário', async () => {
    const m2 = await confirmarEEnviar('M2');
    const botoes = (m2.interativo as { botoes: Array<{ chave: string; rotulo: string }> }).botoes;
    const corpo = doTipo('POST', '/api/v1/messages').at(-1)!.corpo as Record<string, string>;
    expect(corpo.text).toContain(`1. ${botoes[0].rotulo}\n2. ${botoes[1].rotulo}`);
    expect(corpo.text).toContain('Responda com o número da opção.');
    await entregar(ORG_A, mensagemDoLead('dg-in-2', '2'), SEG_A, true);
    const escolha = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'agenda.escolhida' } });
    expect(escolha.payload).toMatchObject({ horario: botoes[1].chave });
  });

  it('a entrada recusa sem segredo, com segredo errado e com o segredo de outra empresa', async () => {
    await em(ORG_B, () => integ.credencial(user(ORG_B), { url: duble.url, token: TOKEN_B, servicoId: 'svc-b', segredoDoWebhook: SEG_B }));
    const corpo = mensagemDoLead('dg-in-x', 'oi');
    const contar = () => prisma.leadEvent.count({ where: { lead: { orgId: { in: [ORG_A, ORG_B] } }, type: 'whats.recebida' } });
    const antes = await contar();
    await expect(entregar(ORG_A, corpo, undefined)).rejects.toMatchObject({ status: 404 });
    await expect(entregar(ORG_A, corpo, `${SEG_A}x`)).rejects.toMatchObject({ status: 404 });
    await expect(entregar(ORG_A, corpo, SEG_B)).rejects.toMatchObject({ status: 404 });
    await expect(entregar(ORG_B, corpo, SEG_A)).rejects.toMatchObject({ status: 404 });
    // Empresa sem segredo configurado recusa tudo.
    await expect(entregar(ORG_C, corpo, SEG_A)).rejects.toMatchObject({ status: 404 });
    expect(await contar()).toBe(antes);
  });

  it('a mensagem da própria conta e a de outra conexão são ignoradas', async () => {
    const antes = await prisma.leadEvent.count({ where: { leadId, type: 'whats.recebida' } });
    const pedidosAntes = duble.pedidos.length;
    expect(await entregar(ORG_A, mensagemDoLead('dg-in-3', 'resposta automática', { isFromMe: true }), SEG_A)).toEqual({ ok: true });
    expect((await em(ORG_A, () => entrada.processar(ORG_A, mensagemDoLead('dg-in-4', 'oi', { serviceId: 'svc-outra' })))).desfecho).toBe('ignorado: outra conexão da conta');
    expect(await em(ORG_A, () => entrada.processar(ORG_A, mensagemDoLead('dg-in-5', 'oi', { isFromMe: true })))).toEqual({ desfecho: 'ignorado: mensagem da própria conta' });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'whats.recebida' } })).toBe(antes);
    expect(duble.pedidos.length).toBe(pedidosAntes);
  });

  it('o grupo: o DigiSac cria o contato-grupo, põe os participantes e recebe a mensagem pelo contactId', async () => {
    const { jid } = await em(ORG_A, () => whats.porta.criarGrupo('Cliente Teste · Root', ['32988880001', '(32) 97777-0002']));
    expect(jid).toMatch(/^digisac:grp-/);
    const criar = doTipo('POST', '/api/v1/contacts').filter((p) => !p.caminho.includes('add-members')).at(-1)!;
    expect(criar.corpo).toMatchObject({ isGroup: true, serviceId: 'svc-a', internalName: 'Cliente Teste · Root' });
    const membros = doTipo('POST', '/api/v1/contacts/').filter((p) => p.caminho.endsWith('/add-members')).at(-1)!;
    expect(membros.corpo).toEqual([{ number: '5532988880001' }, { number: '5532977770002' }]);
    const feito = await em(ORG_A, () => whats.porta.enviarNoGrupo(jid, 'Bem-vindos.'));
    expect(feito.provedor).toBe('digisac');
    expect(doTipo('POST', '/api/v1/messages').at(-1)!.corpo).toMatchObject({ contactId: jid.slice('digisac:'.length), text: 'Bem-vindos.' });
  });

  it('isolamento: cada empresa usa o próprio token; empresa cliente nunca usa o ambiente; o cofre recusa empresa trocada', async () => {
    await em(ORG_B, () => whats.porta.enviarTexto('32911110000', 'oi'));
    expect(doTipo('POST', '/api/v1/messages').at(-1)!.autorizacao).toBe(`Bearer ${TOKEN_B}`);
    expect(doTipo('POST', '/api/v1/messages').at(-1)!.corpo).toMatchObject({ serviceId: 'svc-b' });

    const antes = { ...process.env };
    process.env.DIGISAC_URL = duble.url;
    process.env.DIGISAC_TOKEN = TOKEN_CASA;
    process.env.DIGISAC_SERVICE_ID = 'svc-casa';
    process.env.DIGISAC_WEBHOOK_SEGREDO = `casa-${MARCA}-0123456789abcdefghijklmn`;
    try {
      const p = prisma as unknown as PrismaService;
      const comAmbiente = new DigisacService(p, new CofreService(p, new EventLogService(p)));
      await expect(em(ORG_C, () => comAmbiente.enviarParaNumero(ORG_C, '5532911110000', 'oi'))).rejects.toThrow(/não configurado/);
      expect(await em(ORG_C, () => comAmbiente.webhookAutentico(ORG_C, process.env.DIGISAC_WEBHOOK_SEGREDO))).toBe(false);
      const casa = await em(casaId, () => comAmbiente.conexao(casaId));
      if (casa.origem === 'ambiente') {
        await em(casaId, () => comAmbiente.enviarParaNumero(casaId, '5532911110000', 'oi'));
        expect(doTipo('POST', '/api/v1/messages').at(-1)!.autorizacao).toBe(`Bearer ${TOKEN_CASA}`);
        expect(await em(casaId, () => comAmbiente.webhookAutentico(casaId, process.env.DIGISAC_WEBHOOK_SEGREDO))).toBe(true);
      } else {
        // A casa do banco de teste já tem credencial própria no cofre: ela vence o ambiente.
        expect(casa.origem).not.toBe('nenhuma');
      }
    } finally {
      for (const k of ['DIGISAC_URL', 'DIGISAC_TOKEN', 'DIGISAC_SERVICE_ID', 'DIGISAC_WEBHOOK_SEGREDO']) {
        if (antes[k] === undefined) delete process.env[k];
        else process.env[k] = antes[k];
      }
    }
    // A empresa do argumento diferente da do contexto: o interruptor e o cofre falham fechado, e nada sai.
    const antesDaTroca = duble.pedidos.length;
    await expect(em(ORG_B, () => digisac.enviarParaNumero(ORG_A, '5532911110000', 'oi'))).rejects.toThrow(/não é a da execução/);
    expect(duble.pedidos.length).toBe(antesDaTroca);
    const p2 = prisma as unknown as PrismaService;
    const semInterruptor = new DigisacService(p2, new CofreService(p2, new EventLogService(p2)));
    await expect(em(ORG_B, () => semInterruptor.enviarParaNumero(ORG_A, '5532911110000', 'oi'))).rejects.toBeInstanceOf(EmpresaDivergenteNoCofreError);
    expect(duble.pedidos.length).toBe(antesDaTroca);
  });

  it('desligado nesta empresa: nada sai e nada entra', async () => {
    await em(ORG_B, () => conectores.desligar(ORG_B, 'digisac', { motivo: 'teste', actorId: LUCAS.id }));
    const antes = duble.pedidos.length;
    await expect(em(ORG_B, () => whats.porta.enviarTexto('32911110000', 'oi'))).rejects.toThrow();
    expect(duble.pedidos.length).toBe(antes);
    expect(await em(ORG_B, () => entrada.processar(ORG_B, mensagemDoLead('dg-in-6', 'oi', { serviceId: 'svc-b' })))).toEqual({ desfecho: 'conector desligado' });
    expect((await em(ORG_B, () => integ.conexao(user(ORG_B)))).desligado).toBe(true);
  });

  it('revogar queima o cofre: nada sai, o webhook fecha e o ambiente não entra no lugar', async () => {
    const r = await em(ORG_A, () => registro.revogar('digisac', { orgId: ORG_A, actorId: LUCAS.id, motivo: 'teste' }));
    expect(r.tipo).toBe('revogado');
    if (r.tipo === 'revogado') expect(r.segredos.sort()).toEqual(['servico', 'token', 'url', 'webhook_segredo']);
    const c = await em(ORG_A, () => integ.conexao(user(ORG_A)));
    expect(c).toMatchObject({ origem: 'nenhuma', tokenGuardado: false, segredoDoWebhook: false });
    expect(c.tokenRevogadoEm).toBeTruthy();
    await expect(em(ORG_A, () => whats.porta.enviarTexto(TELEFONE, 'oi'))).rejects.toThrow(/revogado/);
    await expect(entregar(ORG_A, mensagemDoLead('dg-in-7', 'oi'), SEG_A)).rejects.toMatchObject({ status: 404 });
    const linhas = await prisma.segredoDeConector.findMany({ where: { orgId: ORG_A, conector: 'digisac' }, select: { valorCifrado: true, revogadoEm: true } });
    expect(linhas.every((l) => !l.valorCifrado && l.revogadoEm)).toBe(true);
  });
});
