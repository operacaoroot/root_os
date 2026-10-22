import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import type { JwtUser } from '../src/auth/current-user.decorator';
import { CofreService } from '../src/cofre/cofre.service';
import { comContexto } from '../src/common/contexto-execucao';
import { EvolutionProvider } from '../src/comercial/canais/evolution.provider';
import { ProvedorIndisponivelError, provedorDoAmbiente } from '../src/comercial/canais/whatsapp.port';
import { EvolutionEntradaService, lerMensagemDaEvolution } from '../src/comercial/evolution-entrada.service';
import { IntegracaoDaEvolutionController } from '../src/comercial/evolution.controller';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService } from '../src/comercial/sala.service';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { segredoDoCanalDaEmpresa } from '../src/gateway/canais/configuracao-do-canal';
import { CanalDeAprovacaoController } from '../src/gateway/canais/canal-de-aprovacao.controller';
import { EntradaDeGrupoRegistry } from '../src/gateway/canais/entrada-de-grupo.registry';
import { EntradaDiretaRegistry, RAZAO_DO_LID_SEM_NUMERO, lerRemetenteDireto, remetenteDireto } from '../src/gateway/canais/entrada-direta.registry';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { RegistroDeConectores } from '../src/integrations/conectores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import { enderecoDeDentro } from '../src/pauta/endereco-de-dentro';
import { baseDaEvolution, enderecosPermitidos, EvolutionDaEmpresaService } from '../src/pauta/evolution.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';
import { QR_DO_DUBLE, subirDubleEvolution, type DubleEvolution } from './evolution-duble';

/*
 * O WHATSAPP DO COMERCIAL PELA EVOLUTION (Rodada de produção 1, 21/10/2026, P8).
 *
 * Primeiro as partes puras (a regra de endereço contra SSRF, a leitura do
 * webhook, o provedor sem empresa e o grupo de outro provedor) e a catraca: só
 * o provedor chama os métodos de envio da Evolution. Depois, com banco e um
 * DUBLÊ HTTP da Evolution, a cadeia inteira: guardar no cofre por empresa,
 * sondar (conectada, QR pendente), pedir o QR, a M1 retida pela régua (R3) e
 * entregue como texto numerado só depois da segunda pessoa, o webhook do canal
 * de aprovação com o segredo desviando a resposta do lead para o comercial (e a
 * identidade do canal ficando no canal), a recusa sem segredo, o grupo, o
 * isolamento entre empresas, o desligamento e a revogação. Nenhum dado do
 * escritório Cardozo & Saggioro: chaves, instâncias e números são inventados.
 */

describe('Evolution: a regra do endereço (SSRF)', () => {
  it('domínio público só em https; nome sem ponto só para a casa; IP literal nunca (loopback só em teste)', () => {
    const cliente = { daCasa: false, teste: false };
    const casa = { daCasa: true, teste: false };
    expect(baseDaEvolution('https://evolution.exemplo.com.br', cliente)).toBe('https://evolution.exemplo.com.br');
    expect(baseDaEvolution('https://Evolution.Exemplo.com/', cliente)).toBe('https://evolution.exemplo.com');
    expect(baseDaEvolution('https://api.exemplo.com/evolution/', cliente)).toBe('https://api.exemplo.com/evolution');
    expect(baseDaEvolution('http://evolution.exemplo.com', cliente)).toBeNull();
    expect(baseDaEvolution('http://root_evolution:8080', casa)).toBe('http://root_evolution:8080');
    expect(baseDaEvolution('http://root_evolution:8080', cliente)).toBeNull();
    expect(baseDaEvolution('http://127.0.0.1:8080', { daCasa: false, teste: true })).toBe('http://127.0.0.1:8080');
    // O `..` é resolvido pelo próprio URL: não sobe além da raiz do host.
    expect(baseDaEvolution('https://evolution.exemplo.com/a/../x', cliente)).toBe('https://evolution.exemplo.com/x');
    for (const url of [
      'http://127.0.0.1:8080',
      'http://localhost:8080',
      'https://169.254.169.254',
      'http://169.254.169.254/latest/meta-data',
      'https://10.0.0.5',
      'https://8.8.8.8',
      'https://[fd00::1]',
      'https://[::ffff:10.0.0.5]',
      'http://0.0.0.0:8080',
      'https://u:p@evolution.exemplo.com',
      'https://evolution.exemplo.com?x=1',
      'https://evolution.exemplo.com/#a',
      'ftp://evolution.exemplo.com',
      'não é url',
    ]) {
      expect(baseDaEvolution(url, casa), url).toBeNull();
      expect(baseDaEvolution(url, cliente), url).toBeNull();
    }
  });

  it('o nome resolvido: link-local e loopback fora para todos; rede privada só para a casa', () => {
    expect(enderecosPermitidos(['169.254.169.254'], true)).toBe(false);
    expect(enderecosPermitidos(['127.0.0.1'], true)).toBe(false);
    expect(enderecosPermitidos(['::1'], true)).toBe(false);
    expect(enderecosPermitidos(['fe80::1'], true)).toBe(false);
    expect(enderecosPermitidos(['172.18.0.5'], true)).toBe(true);
    expect(enderecosPermitidos(['172.18.0.5'], false)).toBe(false);
    expect(enderecosPermitidos(['10.0.0.5', '200.1.2.3'], false)).toBe(false);
    expect(enderecosPermitidos(['200.1.2.3'], false)).toBe(true);
    expect(enderecosPermitidos([], true)).toBe(false);
  });

  it('o endereço recusado não sai do sistema: nem o cofre nem a rede são tocados', async () => {
    const espiao = vi.spyOn(globalThis, 'fetch');
    try {
      const cofre = { envolver: vi.fn(), guardar: vi.fn(), estado: vi.fn() };
      const prisma = { org: { findFirst: vi.fn(async () => null) } };
      const conector = new EvolutionDaEmpresaService(prisma as never, cofre as never);
      conector.resolver = async (host) => (host === 'interna.exemplo.com' ? ['10.1.2.3'] : host === 'metadados.exemplo.com' ? ['169.254.169.254'] : ['200.1.2.3']);
      for (const url of ['http://root_evolution:8080', 'https://169.254.169.254', 'https://interna.exemplo.com', 'https://metadados.exemplo.com', 'https://10.0.0.5']) {
        const erro = await conector.guardarCredencial('org-x', { url, chave: 'chave-inventada-1', instancia: 'x' }, null).catch((e: unknown) => e);
        expect(erro, url).toBeInstanceOf(BadRequestException);
      }
      expect(espiao).not.toHaveBeenCalled();
      expect(cofre.guardar).not.toHaveBeenCalled();
    } finally {
      espiao.mockRestore();
    }
  });

  /** Um conector com a credencial no cofre de mentira; `casa` diz se a empresa é a da casa. */
  const conectorComCofre = (casa: boolean, url: string) => {
    const valores: Record<string, string> = { url, chave: 'chave-inventada-rebinding', instancia: 'inst-r' };
    const cofre = {
      envolver: vi.fn(async (ref: { nome: string }, fn: (c: { usar: (f: (v: string) => string) => string }) => unknown) => fn({ usar: (f) => f(valores[ref.nome]) })),
      guardar: vi.fn(),
      estado: vi.fn(),
    };
    const prisma = { org: { findFirst: vi.fn(async () => (casa ? { id: 'org-casa' } : null)) } };
    return new EvolutionDaEmpresaService(prisma as never, cofre as never);
  };

  it('rebinding (Produção 22, revisão): para quem não é a casa, a conexão vai ao IP conferido e nunca a uma segunda resolução', async () => {
    const espiao = vi.spyOn(globalThis, 'fetch');
    try {
      const conector = conectorComCofre(false, 'https://evo.exemplo.com');
      const perguntas: string[] = [];
      // público na conferência; rede privada em qualquer pergunta depois
      conector.resolver = async (host) => {
        perguntas.push(host);
        return perguntas.length === 1 ? ['200.1.2.3'] : ['10.0.0.5'];
      };
      const conexoes: Array<{ url: string; ip: string; metodo?: string; body?: string; apikey?: string }> = [];
      conector.conectar = async (u, ip, init) => {
        conexoes.push({ url: u.toString(), ip, metodo: init.method, body: init.body, apikey: init.headers?.apikey });
        return new Response(JSON.stringify({ key: { id: 'msg-1' } }), { status: 201, headers: { 'content-type': 'application/json' } });
      };
      expect(await conector.enviarAoNumero('org-x', '5532999990000', 'oi')).toEqual({ id: 'msg-1' });
      expect(perguntas).toEqual(['evo.exemplo.com']);
      expect(conexoes).toEqual([
        { url: 'https://evo.exemplo.com/message/sendText/inst-r', ip: '200.1.2.3', metodo: 'POST', body: JSON.stringify({ number: '5532999990000', text: 'oi' }), apikey: 'chave-inventada-rebinding' },
      ]);
      // a chamada seguinte confere de novo: agora o nome cai na rede privada, e nada sai
      await expect(conector.enviarAoNumero('org-x', '5532999990000', 'oi')).rejects.toThrow(/rede que esta empresa não pode chamar/);
      expect(conexoes).toHaveLength(1);
      expect(conexoes.every((c) => !enderecoDeDentro(c.ip))).toBe(true);
      expect(espiao).not.toHaveBeenCalled();
    } finally {
      espiao.mockRestore();
    }
  });

  it('rebinding: o 3xx da Evolution de fora não é seguido (vira erro com o status)', async () => {
    const conector = conectorComCofre(false, 'https://evo.exemplo.com');
    conector.resolver = async () => ['200.1.2.3'];
    const ips: string[] = [];
    conector.conectar = async (_u, ip) => {
      ips.push(ip);
      return new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/' } });
    };
    await expect(conector.enviarAoNumero('org-x', '5532999990000', 'oi')).rejects.toThrow(/HTTP 302/);
    expect(ips).toEqual(['200.1.2.3']);
  });

  it('a casa continua no fetch de sempre (rede privada e nome sem ponto são dela)', async () => {
    const espiao = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ key: { id: 'msg-casa' } }), { status: 201 }));
    try {
      const conector = conectorComCofre(true, 'http://root_evolution:8080');
      conector.resolver = async () => ['172.18.0.5'];
      const conectar = vi.fn();
      conector.conectar = conectar as never;
      expect(await conector.enviarAoNumero('org-casa', '5532999990000', 'oi')).toEqual({ id: 'msg-casa' });
      expect(espiao).toHaveBeenCalledTimes(1);
      expect(String(espiao.mock.calls[0][0])).toBe('http://root_evolution:8080/message/sendText/inst-r');
      expect(conectar).not.toHaveBeenCalled();
    } finally {
      espiao.mockRestore();
    }
  });
});

describe('Evolution: as partes puras da entrada e do provedor', () => {
  const evento = (extra: Record<string, unknown> = {}, key: Record<string, unknown> = {}) => ({
    event: 'messages.upsert',
    instance: 'inst-a',
    data: { key: { remoteJid: '5532988880001@s.whatsapp.net', fromMe: false, id: 'E1', ...key }, messageType: 'conversation', message: { conversation: ' Oi ' }, ...extra },
  });

  it('o remetente direto: só mensagem nova de conversa individual com telefone', () => {
    expect(remetenteDireto(evento())).toBe('5532988880001');
    expect(remetenteDireto({ ...evento(), event: 'messages.update' })).toBeNull();
    expect(remetenteDireto(evento({}, { fromMe: true }))).toBeNull();
    expect(remetenteDireto(evento({}, { remoteJid: '120363000000000000@g.us' }))).toBeNull();
    expect(remetenteDireto(evento({}, { participant: '5532911112222@s.whatsapp.net' }))).toBeNull();
    expect(remetenteDireto(evento({}, { remoteJid: '123456@lid' }))).toBeNull();
    expect(remetenteDireto(null)).toBeNull();
  });

  it('Produção 22: o remetente @lid vale pelo número real do campo próprio (remoteJidAlt, senderPn)', () => {
    const lid = { remoteJid: '271828182845904@lid' };
    expect(lerRemetenteDireto(evento({}, { ...lid, remoteJidAlt: '5532988880001@s.whatsapp.net' }))).toEqual({ remetente: '5532988880001' });
    expect(lerRemetenteDireto(evento({}, { ...lid, senderPn: '5532988880002@s.whatsapp.net' }))).toEqual({ remetente: '5532988880002' });
    // remoteJidAlt vem antes de senderPn
    expect(remetenteDireto(evento({}, { ...lid, remoteJidAlt: '5532988880001@s.whatsapp.net', senderPn: '5532988880002@s.whatsapp.net' }))).toBe('5532988880001');
    // sem o campo, ou com o campo fora da forma de telefone: a razão, não o número
    expect(lerRemetenteDireto(evento({}, lid))).toEqual({ ignorado: RAZAO_DO_LID_SEM_NUMERO });
    for (const ruim of ['271828@lid', '5532988880001@c.us', '5532988880001:3@s.whatsapp.net', '+5532988880001@s.whatsapp.net', '123@s.whatsapp.net', '120363000000000000@g.us', 5532988880001]) {
      expect(lerRemetenteDireto(evento({}, { ...lid, remoteJidAlt: ruim, senderPn: ruim })), String(ruim)).toEqual({ ignorado: RAZAO_DO_LID_SEM_NUMERO });
    }
    // o número real nunca substitui um remoteJid que já é telefone
    expect(remetenteDireto(evento({}, { remoteJidAlt: '5532900000000@s.whatsapp.net' }))).toBe('5532988880001');
  });

  it('a mensagem do lead: só texto digitado, com a instância do corpo', () => {
    expect(lerMensagemDaEvolution(evento())).toEqual({ mensagem: { mensagemId: 'E1', texto: 'Oi', instancia: 'inst-a' } });
    expect(lerMensagemDaEvolution(evento({ messageType: 'extendedTextMessage', message: { extendedTextMessage: { text: '2' } } }))).toMatchObject({ mensagem: { texto: '2' } });
    expect(lerMensagemDaEvolution(evento({ messageType: 'imageMessage', message: { imageMessage: {} } }))).toEqual({ ignorado: 'tipo imageMessage' });
    expect(lerMensagemDaEvolution(evento({ message: { protocolMessage: { editedMessage: { conversation: 'x' } } } }))).toEqual({ ignorado: 'edição ou protocolo' });
    expect(lerMensagemDaEvolution(evento({ message: { conversation: '   ' } }))).toEqual({ ignorado: 'sem texto' });
  });

  it('WHATSAPP_PROVEDOR=evolution escolhe o provedor; sem empresa ou sem conector, nada sai; grupo de outro provedor é recusado', async () => {
    expect(provedorDoAmbiente('evolution')).toBe('evolution');
    expect(provedorDoAmbiente('')).toBe('simulado');
    expect(new EvolutionProvider(null).configured).toBe(false);
    const envio = { enviarAoNumero: vi.fn(), abrirGrupo: vi.fn(), enviarAoGrupo: vi.fn() };
    const prov = new EvolutionProvider(envio);
    expect(prov.configured).toBe(true);
    await expect(prov.enviarTexto('32911112222', 'oi')).rejects.toBeInstanceOf(ProvedorIndisponivelError);
    await expect(comContexto({ orgId: 'org-x', correlationId: 'c' }, () => prov.enviarNoGrupo('sim-grupo@g.us', 'oi'))).rejects.toThrow(/não foi criado pela Evolution/);
    await expect(comContexto({ orgId: 'org-x', correlationId: 'c' }, () => new EvolutionProvider(null).enviarTexto('32911112222', 'oi'))).rejects.toThrow(/não está carregado/);
    expect(envio.enviarAoNumero).not.toHaveBeenCalled();
    expect(envio.enviarAoGrupo).not.toHaveBeenCalled();
  });
});

/*
 * A CATRACA DO ENVIO. A porta `ENVIO_PELA_EVOLUTION` manda texto a número
 * arbitrário. Só o provedor do comercial a usa (e o provedor só é chamado pelo
 * efeito de `comercial.whatsapp.enviar`, R3). Esta varredura é a prova.
 */
describe('Evolution: só o provedor manda mensagem pela empresa', () => {
  const RAIZ = path.resolve(__dirname, '..');
  const fontes: Array<{ arquivo: string; texto: string }> = [];
  const andar = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const c = path.join(dir, e);
      if (statSync(c).isDirectory()) andar(c);
      else if (e.endsWith('.ts')) {
        const texto = readFileSync(c, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        fontes.push({ arquivo: path.relative(RAIZ, c).split(path.sep).join('/'), texto });
      }
    }
  };
  andar(path.join(RAIZ, 'src'));

  it('a porta de envio só é injetada onde o provedor nasce', () => {
    const usam = fontes.filter((f) => f.texto.includes('ENVIO_PELA_EVOLUTION')).map((f) => f.arquivo).sort();
    expect(usam).toEqual(['src/comercial/whatsapp.service.ts', 'src/gateway/canais/canais.module.ts', 'src/gateway/canais/evolution.port.ts']);
  });

  it('os métodos de envio da empresa só são chamados pelo provedor', () => {
    const chamam = fontes.filter((f) => /\.(enviarAoNumero|enviarAoGrupo|abrirGrupo)\s*\(/.test(f.texto)).map((f) => f.arquivo).sort();
    expect(chamam).toEqual(['src/comercial/canais/evolution.provider.ts']);
  });

  it('o comercial não importa o conector da Evolution, só a porta', () => {
    const fora = fontes.filter((f) => f.arquivo.startsWith('src/comercial/') && /from\s+['"][^'"]*pauta\/evolution\.service['"]/.test(f.texto)).map((f) => f.arquivo);
    expect(fora).toEqual([]);
  });
});

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresas, cofre, leads, mensagens e aprovações da Evolution)');
if (Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64').length !== 32) process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

describe.skipIf(!URL)('Evolution com banco e dublê HTTP', () => {
  const MARCA = `ev${Date.now().toString(36).slice(-6)}`;
  const ORG_A = `org-eva-${MARCA}`;
  const ORG_B = `org-evb-${MARCA}`;
  const ORG_C = `org-evc-${MARCA}`;
  const LUCAS = { id: `lucas-${MARCA}`, papeis: ['gestor_marketing'] };
  const CHAVE_A = `chave-a-${MARCA}-inventada`;
  const CHAVE_B = `chave-b-${MARCA}-inventada`;
  const SEGREDO_DO_CANAL = `canal-${MARCA}-transporte-0123456789`;
  const SEGREDO_DO_CODIGO = `canal-${MARCA}-codigo-9876543210ab`;
  const TELEFONE = '32988880001';
  const TELEFONE_DO_OPERADOR = '32977776666';
  const DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + 2 * 86_400_000));

  let prisma: PrismaClient;
  let duble: DubleEvolution;
  let evo: EvolutionDaEmpresaService;
  let registro: RegistroDeConectores;
  let conectores: ConectoresService;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let whats: WhatsappComercialService;
  let integ: IntegracaoDaEvolutionController;
  let entrada: EvolutionEntradaService;
  let webhook: CanalDeAprovacaoController;
  const canal = { receber: vi.fn(async () => ({ desfecho: 'canal' })) };
  let leadId = '';
  const ambienteAntes = { ...process.env };

  const em = <T>(orgId: string, fn: () => Promise<T>): Promise<T> => comContexto({ orgId, correlationId: `ev-${MARCA}`, origem: 'http' }, fn);
  const user = (orgId: string): JwtUser => ({ sub: LUCAS.id, orgId, email: 'l@x.y', name: 'Lucas', roles: [], permissions: [] });
  const doTipo = (metodo: string, prefixo: string) => duble.pedidos.filter((p) => p.metodo === metodo && p.caminho.startsWith(prefixo));
  const mensagem = (id: string, telefone: string, texto: string, instancia = 'inst-a') => ({
    event: 'messages.upsert',
    instance: instancia,
    apikey: 'a-chave-da-instancia-vem-no-corpo',
    data: { key: { remoteJid: `55${telefone}@s.whatsapp.net`, fromMe: false, id }, pushName: 'Marina', messageType: 'conversation', message: { conversation: texto } },
  });
  const entregar = async (orgId: string, corpo: unknown, segredo: string | undefined) => {
    const r = await webhook.whatsapp(orgId, segredo, corpo);
    await webhook.trabalhoEmCurso;
    return r;
  };
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
    process.env.WHATSAPP_PROVEDOR = 'evolution';
    process.env.CANAL_APROVACAO_SEGREDO = SEGREDO_DO_CANAL;
    process.env.CANAL_APROVACAO_CODIGO_SEGREDO = SEGREDO_DO_CODIGO;
    duble = await subirDubleEvolution({
      [CHAVE_A]: { 'inst-a': { estado: 'open' } },
      [CHAVE_B]: { 'inst-b': { estado: 'close' } },
    });

    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    for (const [id, nome] of [[ORG_A, 'A'], [ORG_B, 'B'], [ORG_C, 'C']]) {
      await prisma.org.create({ data: { id, name: `Evolution ${nome} ${MARCA}`, slug: `ev-${nome.toLowerCase()}-${MARCA}` } });
    }
    const papel = await prisma.role.create({ data: { orgId: ORG_A, key: 'gestor_marketing', name: 'Gestor de Marketing' }, select: { id: true } });
    await prisma.user.create({ data: { id: LUCAS.id, orgId: ORG_A, email: `${LUCAS.id}@ev.teste`, name: 'Lucas', passwordHash: 'sem-senha-util', roles: { connect: { id: papel.id } } } });
    await prisma.channelIdentity.create({ data: { orgId: ORG_A, canal: 'whatsapp', externalId: `55${TELEFONE_DO_OPERADOR}`, userId: LUCAS.id, rotulo: 'Lucas' } });

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
    evo = new EvolutionDaEmpresaService(p, new CofreService(p, eventos), registro, interruptores);
    evo.onModuleInit();

    const reacoes = new ReacoesRegistry();
    const fio = new FioService(p, reacoes);
    const sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    whats = new WhatsappComercialService(p, fio, reacoes, new RelogioComercialRegistry(), sala, efeitos, porta, undefined, evo);
    whats.onModuleInit();
    const diretas = new EntradaDiretaRegistry(p);
    entrada = new EvolutionEntradaService(p, whats, sala, evo, diretas);
    entrada.onModuleInit();
    webhook = new CanalDeAprovacaoController(canal as never, new EntradaDeGrupoRegistry(), diretas);
    integ = new IntegracaoDaEvolutionController(evo);
  });

  afterAll(async () => {
    vi.useRealTimers();
    for (const k of ['WHATSAPP_PROVEDOR', 'CANAL_APROVACAO_SEGREDO', 'CANAL_APROVACAO_CODIGO_SEGREDO', 'GATEWAY_MODO', 'EVOLUTION_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCIA']) {
      if (ambienteAntes[k] === undefined) delete process.env[k];
      else process.env[k] = ambienteAntes[k];
    }
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
    await prisma.channelIdentity.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.user.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.role.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.org.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });

  it('o ambiente de teste deixa o dublê em loopback (e só ele)', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('guardar grava endereço, chave e instância no cofre da empresa, cifrados, e a chave não volta', async () => {
    const r = await em(ORG_A, () => integ.credencial(user(ORG_A), { url: `${duble.url}/`, chave: CHAVE_A, instancia: 'inst-a' }));
    expect(r).toMatchObject({ origem: 'cofre', url: duble.url, instancia: 'inst-a', chaveGuardada: true, desligado: false, entradaLigada: true, provedorDoComercial: 'evolution' });
    expect(r.caminhoDoWebhook).toBe(`/api/approvals/canal/whatsapp/${ORG_A}`);
    expect(r.cabecalhoDoSegredo).toBe('x-canal-segredo');
    expect(JSON.stringify(r)).not.toContain(CHAVE_A);
    expect(JSON.stringify(r)).not.toContain(SEGREDO_DO_CANAL);
    const linhas = await prisma.segredoDeConector.findMany({ where: { orgId: ORG_A, conector: 'evolution' }, select: { nome: true, valorCifrado: true } });
    expect(linhas.map((l) => l.nome).sort()).toEqual(['chave', 'instancia', 'url']);
    for (const l of linhas) expect(l.valorCifrado).not.toContain(CHAVE_A);
    // Trocar só a instância não pede a chave de novo; corpo fora do esquema é recusado.
    expect((await em(ORG_A, () => integ.credencial(user(ORG_A), { url: duble.url, instancia: 'inst-a' }))).chaveGuardada).toBe(true);
    await expect(em(ORG_A, () => integ.credencial(user(ORG_A), { url: duble.url, instancia: 'inst-a', extra: 1 }))).rejects.toMatchObject({ status: 400 });
    await expect(em(ORG_C, () => integ.credencial(user(ORG_C), { url: duble.url, instancia: 'inst-c' }))).rejects.toMatchObject({ status: 400 });
  });

  it('o estado da instância: aberta = conectada, com a chave da empresa no cabeçalho apikey', async () => {
    const e = await em(ORG_A, () => integ.estado(user(ORG_A)));
    expect(e).toMatchObject({ estado: 'open', mensagem: 'Instância conectada.' });
    const s = await em(ORG_A, () => registro.sondar({ orgId: ORG_A, chave: 'evolution' }));
    expect(s.estado).toBe('conectado');
    expect(typeof s.latenciaMs).toBe('number');
    expect(doTipo('GET', '/instance/connectionState/inst-a').every((p) => p.apikey === CHAVE_A)).toBe(true);
    const semNada = await em(ORG_C, () => registro.sondar({ orgId: ORG_C, chave: 'evolution' }));
    expect(semNada.estado).toBe('nao_configurado');
    // Instância aberta não ganha QR.
    expect(await em(ORG_A, () => integ.qr(user(ORG_A)))).toMatchObject({ estado: 'open', base64: null });
  });

  it('instância desconectada: a sonda acusa, o QR sai como imagem e a instância passa a QR pendente', async () => {
    await em(ORG_B, () => integ.credencial(user(ORG_B), { url: duble.url, chave: CHAVE_B, instancia: 'inst-b' }));
    const antes = await em(ORG_B, () => registro.sondar({ orgId: ORG_B, chave: 'evolution' }));
    expect(antes.estado).toBe('erro');
    expect(antes.mensagem).toContain('gere o QR');
    const qr = await em(ORG_B, () => integ.qr(user(ORG_B)));
    expect(qr.base64).toBe(QR_DO_DUBLE);
    expect(qr.codigoDePareamento).toBe('WZYEH1YY');
    expect(doTipo('GET', '/instance/connect/inst-b').at(-1)!.apikey).toBe(CHAVE_B);
    expect(await em(ORG_B, () => integ.estado(user(ORG_B)))).toMatchObject({ estado: 'connecting', mensagem: expect.stringContaining('QR pendente') });
  });

  it('a M1 fica retida (R3); depois da segunda pessoa sai como texto numerado, com apikey e número só com dígitos', async () => {
    const antes = doTipo('POST', '/message/sendText').length;
    ({ leadId } = await em(ORG_A, () => whats.receberEntrada(ORG_A, { telefone: TELEFONE, texto: 'Oi! Funciona com Omie?', nome: 'Marina Teste', mensagemId: `${MARCA}-1` })));
    expect(doTipo('POST', '/message/sendText').length).toBe(antes);
    const m1 = await confirmarEEnviar('M1');
    expect(m1.estado).toBe('enviada');
    expect(m1.provedor).toBe('evolution');
    expect(m1.mensagemExternaId).toMatch(/^EVO\d+$/);
    const [pedido] = doTipo('POST', '/message/sendText/inst-a').slice(antes);
    expect(pedido.apikey).toBe(CHAVE_A);
    const corpo = pedido.corpo as Record<string, string>;
    expect(corpo.number).toBe('5532988880001');
    expect(corpo.text).toContain('1. Qual sistema vocês usam?');
    expect(corpo.text).toContain('Responda numa mensagem só');
  });

  it('o webhook do canal com o segredo leva a resposta do lead ao comercial: o formulário numerado vira form.respondido', async () => {
    vi.setSystemTime(new Date(`${DIA}T15:10:00-03:00`));
    canal.receber.mockClear();
    const recebidas = await prisma.leadEvent.count({ where: { leadId, type: 'whats.recebida' } });
    expect(await entregar(ORG_A, mensagem('ev-in-1', TELEFONE, '1. Omie\n2. sim\n3. fechamento leva 9 dias\n4. 3'), segredoDoCanalDaEmpresa(ORG_A)!)).toEqual({ ok: true });
    expect(canal.receber).not.toHaveBeenCalled();
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'whats.recebida' } })).toBe(recebidas + 1);
    const form = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'form.respondido' } });
    expect(form.payload).toMatchObject({ sistema: 'Omie', baseOrganizada: true, equipeFinanceiro: 3 });
  });

  it('a M2 sai com os horários numerados e a resposta "2" escolhe o segundo horário', async () => {
    const m2 = await confirmarEEnviar('M2');
    const botoes = (m2.interativo as { botoes: Array<{ chave: string; rotulo: string }> }).botoes;
    const corpo = doTipo('POST', '/message/sendText/inst-a').at(-1)!.corpo as Record<string, string>;
    expect(corpo.text).toContain(`1. ${botoes[0].rotulo}\n2. ${botoes[1].rotulo}`);
    await entregar(ORG_A, mensagem('ev-in-2', TELEFONE, '2'), segredoDoCanalDaEmpresa(ORG_A)!);
    const escolha = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'agenda.escolhida' } });
    expect(escolha.payload).toMatchObject({ horario: botoes[1].chave });
  });

  it('sem segredo, com segredo errado ou com o canal desligado: 404 e nada entra', async () => {
    const contar = () => prisma.leadEvent.count({ where: { leadId, type: 'whats.recebida' } });
    const antes = await contar();
    const corpo = mensagem('ev-in-x', TELEFONE, 'oi');
    await expect(entregar(ORG_A, corpo, undefined)).rejects.toMatchObject({ status: 404 });
    await expect(entregar(ORG_A, corpo, `${SEGREDO_DO_CANAL}x`)).rejects.toMatchObject({ status: 404 });
    const segredo = process.env.CANAL_APROVACAO_CODIGO_SEGREDO;
    delete process.env.CANAL_APROVACAO_CODIGO_SEGREDO;
    try {
      await expect(entregar(ORG_A, corpo, segredoDoCanalDaEmpresa(ORG_A)!)).rejects.toMatchObject({ status: 404 });
    } finally {
      process.env.CANAL_APROVACAO_CODIGO_SEGREDO = segredo;
    }
    expect(await contar()).toBe(antes);
  });

  it('quem é identidade do canal fica no canal, mesmo sendo lead; número que não é lead também vai ao canal', async () => {
    await em(ORG_A, () => whats.receberEntrada(ORG_A, { telefone: TELEFONE_DO_OPERADOR, texto: 'teste', mensagemId: `${MARCA}-op` }));
    const doOperador = await prisma.lead.findFirstOrThrow({ where: { orgId: ORG_A, phone: `55${TELEFONE_DO_OPERADOR}` }, select: { id: true } });
    const antes = await prisma.leadEvent.count({ where: { leadId: doOperador.id, type: 'whats.recebida' } });
    canal.receber.mockClear();
    await entregar(ORG_A, mensagem('ev-in-op', TELEFONE_DO_OPERADOR, 'ROOT-ABCD1234 aprovar'), segredoDoCanalDaEmpresa(ORG_A)!);
    expect(canal.receber).toHaveBeenCalledTimes(1);
    expect(await prisma.leadEvent.count({ where: { leadId: doOperador.id, type: 'whats.recebida' } })).toBe(antes);
    await entregar(ORG_A, mensagem('ev-in-novo', '32900001111', 'oi, quero saber mais'), segredoDoCanalDaEmpresa(ORG_A)!);
    expect(canal.receber).toHaveBeenCalledTimes(2);
    expect(await prisma.lead.count({ where: { orgId: ORG_A, phone: '5532900001111' } })).toBe(0);
  });

  it('Produção 22: remetente @lid com o número real ao lado vai ao comercial pelo número real; sem ele, fica no canal', async () => {
    const comLid = (id: string, key: Record<string, unknown>) => {
      const m = mensagem(id, TELEFONE, 'oi pelo lid');
      return { ...m, data: { ...m.data, key: { fromMe: false, id, remoteJid: '271828182845904@lid', ...key } } };
    };
    const contar = () => prisma.leadEvent.count({ where: { leadId, type: 'whats.recebida' } });
    canal.receber.mockClear();
    const antes = await contar();
    await entregar(ORG_A, comLid('ev-lid-1', { remoteJidAlt: `55${TELEFONE}@s.whatsapp.net` }), segredoDoCanalDaEmpresa(ORG_A)!);
    expect(await contar()).toBe(antes + 1);
    expect(canal.receber).not.toHaveBeenCalled();
    await entregar(ORG_A, comLid('ev-lid-2', { senderPn: `55${TELEFONE}@s.whatsapp.net` }), segredoDoCanalDaEmpresa(ORG_A)!);
    expect(await contar()).toBe(antes + 2);
    // sem o número real: segue para o canal como antes, e nada entra no lead
    await entregar(ORG_A, comLid('ev-lid-3', {}), segredoDoCanalDaEmpresa(ORG_A)!);
    expect(canal.receber).toHaveBeenCalledTimes(1);
    expect(await contar()).toBe(antes + 2);
  });

  it('mensagem de outra instância, sem instância e não textual são ignoradas', async () => {
    const antes = await prisma.leadEvent.count({ where: { leadId, type: 'whats.recebida' } });
    expect(await em(ORG_A, () => entrada.processar(ORG_A, mensagem('ev-in-3', TELEFONE, 'oi', 'outra-inst'), `55${TELEFONE}`))).toBe('ignorado: outra instância');
    // Sem a instância no corpo não entra: o segredo do webhook é do processo, a instância é a prova de empresa.
    const { instance: _semInstancia, ...semInstancia } = mensagem('ev-in-5', TELEFONE, 'oi');
    expect(await em(ORG_A, () => entrada.processar(ORG_A, semInstancia, `55${TELEFONE}`))).toBe('ignorado: sem instância');
    const imagem = { ...mensagem('ev-in-4', TELEFONE, ''), data: { key: { remoteJid: `55${TELEFONE}@s.whatsapp.net`, fromMe: false, id: 'ev-in-4' }, messageType: 'imageMessage', message: { imageMessage: {} } } };
    expect(await em(ORG_A, () => entrada.processar(ORG_A, imagem, `55${TELEFONE}`))).toBe('ignorado: tipo imageMessage');
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'whats.recebida' } })).toBe(antes);
  });

  it('o grupo: a Evolution cria o grupo com os participantes e recebe a mensagem pelo JID @g.us', async () => {
    const { jid } = await em(ORG_A, () => whats.porta.criarGrupo('Cliente Teste · Root', ['32988880001', '(32) 97777-0002']));
    expect(jid).toMatch(/^evolution:1203630\d+@g\.us$/);
    const criar = doTipo('POST', '/group/create/inst-a').at(-1)!;
    expect(criar.apikey).toBe(CHAVE_A);
    expect(criar.corpo).toEqual({ subject: 'Cliente Teste · Root', participants: ['5532988880001', '5532977770002'] });
    const feito = await em(ORG_A, () => whats.porta.enviarNoGrupo(jid, 'Bem-vindos.'));
    expect(feito.provedor).toBe('evolution');
    expect(doTipo('POST', '/message/sendText/inst-a').at(-1)!.corpo).toEqual({ number: jid.slice('evolution:'.length), text: 'Bem-vindos.' });
  });

  it('isolamento: cada empresa usa a própria chave; empresa cliente nunca usa o ambiente; empresa trocada falha fechado', async () => {
    duble.contas.get(CHAVE_B)!['inst-b'].estado = 'open';
    await em(ORG_B, () => whats.porta.enviarTexto('32911110000', 'oi'));
    expect(doTipo('POST', '/message/sendText').at(-1)).toMatchObject({ caminho: '/message/sendText/inst-b', apikey: CHAVE_B });

    process.env.EVOLUTION_URL = duble.url;
    process.env.EVOLUTION_API_KEY = CHAVE_A;
    process.env.EVOLUTION_INSTANCIA = 'inst-a';
    const p = prisma as unknown as PrismaService;
    const comAmbiente = new EvolutionDaEmpresaService(p, new CofreService(p, new EventLogService(p)));
    await expect(em(ORG_C, () => comAmbiente.enviarAoNumero(ORG_C, '5532911110000', 'oi'))).rejects.toThrow(/não configurada/);
    expect((await em(ORG_C, () => comAmbiente.conexao(ORG_C))).origem).toBe('nenhuma');

    const antes = duble.pedidos.length;
    await expect(em(ORG_B, () => evo.enviarAoNumero(ORG_A, '5532911110000', 'oi'))).rejects.toThrow(/não é a da execução/);
    expect(duble.pedidos.length).toBe(antes);
  });

  it('desligado nesta empresa: nada sai, nada entra e o estado diz por quê', async () => {
    await em(ORG_B, () => conectores.desligar(ORG_B, 'evolution', { motivo: 'teste', actorId: LUCAS.id }));
    const antes = duble.pedidos.length;
    await expect(em(ORG_B, () => whats.porta.enviarTexto('32911110000', 'oi'))).rejects.toThrow();
    expect(duble.pedidos.length).toBe(antes);
    expect(await em(ORG_B, () => integ.estado(user(ORG_B)))).toMatchObject({ estado: 'desligada' });
    expect((await em(ORG_B, () => integ.conexao(user(ORG_B)))).desligado).toBe(true);
  });

  it('revogar queima o cofre: nada sai e o ambiente não entra no lugar', async () => {
    const r = await em(ORG_A, () => registro.revogar('evolution', { orgId: ORG_A, actorId: LUCAS.id, motivo: 'teste' }));
    expect(r.tipo).toBe('revogado');
    if (r.tipo === 'revogado') expect(r.segredos.sort()).toEqual(['chave', 'instancia', 'url']);
    const c = await em(ORG_A, () => integ.conexao(user(ORG_A)));
    expect(c).toMatchObject({ origem: 'nenhuma', chaveGuardada: false });
    expect(c.chaveRevogadaEm).toBeTruthy();
    await expect(em(ORG_A, () => whats.porta.enviarTexto(TELEFONE, 'oi'))).rejects.toThrow(/revogada/);
  });
});
