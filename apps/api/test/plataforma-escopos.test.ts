import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AuthService, type UserWithRoles } from '../src/auth/auth.service';
import { GoogleLoginService } from '../src/auth/google-login.service';
import { provisionarTenant } from '../src/tenants/provisionar';
import { ClickupService } from '../src/integrations/clickup.service';
import { PolicyService } from '../src/policy/policy.service';
import { HealthController } from '../src/health/health.controller';
import { BioSyncService } from '../src/bio/bio-sync.service';
import { comContexto, contextoAtual } from '../src/common/contexto-execucao';
import {
  ORG_PLATAFORMA, CAMINHOS_DE_PLATAFORMA_EXIGIDOS, CHAMADORES_DE_PLATAFORMA,
  comContextoDePlataforma, comContextoDaEmpresaResolvida,
} from '../src/prisma/contexto-de-plataforma';
import { conferirCoberturaDePlataforma } from '../src/prisma/sessao-de-banco';

// Controles de aplicação com Prisma simulado e dados sintéticos. Não medem RLS.
// A consulta só executa em then(), como PrismaPromise: o contexto é observado
// no await, e não quando o serviço constrói a operação.
function lazy<T>(effect: () => T): Promise<T> {
  return {
    then(
      fulfilled?: ((value: T) => unknown) | null,
      rejected?: ((reason: unknown) => unknown) | null,
    ) { return Promise.resolve().then(effect).then(fulfilled, rejected); },
  } as unknown as Promise<T>;
}
function fake<T>(value: unknown): T { return value as T; }
const A = 'qa-empresa-a';
const B = 'qa-empresa-b';
function emA<T>(fn: () => T): T {
  return comContexto({ orgId: A, actorId: 'qa-pessoa-a', actorType: 'user', correlationId: 'qa-correlacao', origem: 'http' }, fn);
}
function usuario(orgId = A): UserWithRoles & { passwordHash: string } {
  return { id: 'qa-pessoa', orgId, name: 'Pessoa QA', email: 'pessoa@qa.invalid', isActive: true,
    passwordHash: 'hash-sintetico', roles: [{ key: 'qa-papel', permissions: [{ key: 'tarefas.ver' }] }] };
}
let saidaExterna: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  vi.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
  vi.spyOn(bcrypt, 'hash').mockImplementation(async () => 'hash-sintetico');
  saidaExterna = vi.fn(() => { throw new Error('Saída externa proibida neste controle sintético'); });
  vi.stubGlobal('fetch', saidaExterna);
});
afterEach(() => {
  expect(saidaExterna).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

vi.mock('../src/common/crypto', async () => ({
  ...await vi.importActual<typeof import('../src/common/crypto')>('../src/common/crypto'),
  temChaveDeCriptografia: () => true,
}));

describe('limites do contexto de plataforma — sem banco', () => {
  it('aguarda operação lazy dentro da sentinela e restaura ausência de contexto', async () => {
    const observados: Array<string | null | undefined> = [];
    await comContextoDePlataforma(() => lazy(() => observados.push(contextoAtual()?.orgId)));
    expect(observados).toEqual([ORG_PLATAFORMA]);
    expect(contextoAtual()).toBeUndefined();
  });
  it('preserva empresa, pessoa e correlação já resolvidas durante descoberta', async () => {
    await emA(async () => {
      await comContextoDePlataforma(() => lazy(() => expect(contextoAtual()).toMatchObject({ orgId: A, actorId: 'qa-pessoa-a', correlationId: 'qa-correlacao' })));
      expect(contextoAtual()?.orgId).toBe(A);
    });
  });
  it('recusa trocar empresa e recusa escrita sob sentinela antes do callback', async () => {
    const efeito = vi.fn(() => lazy(() => true));
    await expect(emA(() => comContextoDaEmpresaResolvida(B, efeito))).rejects.toThrow('não pode mudar');
    await expect(comContextoDaEmpresaResolvida(ORG_PLATAFORMA, efeito)).rejects.toThrow('não foi resolvida');
    await expect(comContextoDaEmpresaResolvida(' ', efeito)).rejects.toThrow('não foi resolvida');
    expect(efeito).not.toHaveBeenCalled();
  });
  it('aguarda a escrita lazy dentro da empresa descoberta e restaura o escopo externo', async () => {
    await comContextoDePlataforma(async () => {
      await comContextoDaEmpresaResolvida(A, () => lazy(() => expect(contextoAtual()?.orgId).toBe(A)));
      expect(contextoAtual()?.orgId).toBe(ORG_PLATAFORMA);
    });
    expect(contextoAtual()).toBeUndefined();
  });
  it('mantém dez caminhos exigidos e recusa cobertura restrita incompleta', () => {
    expect(CAMINHOS_DE_PLATAFORMA_EXIGIDOS).toHaveLength(10);
    expect(CHAMADORES_DE_PLATAFORMA).toHaveLength(8);
    const cobertura = conferirCoberturaDePlataforma(false);
    expect(cobertura.recusar).toBe(true);
    expect(cobertura.faltando.map((c) => c.arquivo).sort()).toEqual([
      'src/bio/bio-oauth.controller.ts', 'src/finance/finance.service.ts',
    ]);
    expect(conferirCoberturaDePlataforma(true).recusar).toBe(false);
  });
});

function montarAuth(user = usuario()) {
  const passos: Array<[string, string | null | undefined]> = [];
  const prisma = { user: {
    findUnique: vi.fn(() => lazy(() => { passos.push(['descoberta', contextoAtual()?.orgId]); return user; })),
    update: vi.fn(() => lazy(() => { passos.push(['lastLogin', contextoAtual()?.orgId]); return user; })),
  } };
  const jwt = { signAsync: vi.fn(async () => { passos.push(['jwt', contextoAtual()?.orgId]); return 'token-sintetico'; }) };
  const audit = { log: vi.fn(async () => { passos.push(['audit', contextoAtual()?.orgId]); }) };
  return { service: new AuthService(fake(prisma), fake(jwt), fake(audit)), prisma, jwt, audit, passos };
}
describe('login por senha', () => {
  it('descobre usuário sob plataforma e emite sessão/escreve somente na empresa encontrada', async () => {
    const s = montarAuth();
    expect(await s.service.login('pessoa@qa.invalid', 'senha-sintetica')).toMatchObject({ token: 'token-sintetico' });
    expect(s.passos).toEqual([['descoberta', ORG_PLATAFORMA], ['jwt', A], ['lastLogin', A], ['audit', A]]);
    expect(s.audit.log).toHaveBeenCalledWith(expect.objectContaining({ orgId: A, actorId: 'qa-pessoa' }));
    expect(contextoAtual()).toBeUndefined();
  });
  it.each(['senha inválida', 'pessoa inativa'])('%s não emite nem escreve', async (caso) => {
    const user = usuario();
    if (caso === 'pessoa inativa') user.isActive = false;
    else vi.mocked(bcrypt.compare).mockImplementation(async () => false);
    const s = montarAuth(user);
    await expect(s.service.login(user.email, 'senha-sintetica')).rejects.toThrow('Credenciais inválidas');
    expect(s.jwt.signAsync).not.toHaveBeenCalled();
    expect(s.prisma.user.update).not.toHaveBeenCalled();
    expect(s.audit.log).not.toHaveBeenCalled();
  });
  it('uma consulta simulada que retorna B sob A não permite sessão ou escrita em B', async () => {
    const s = montarAuth(usuario(B));
    await expect(emA(() => s.service.login('pessoa@qa.invalid', 'senha-sintetica'))).rejects.toThrow('não pode mudar');
    expect(s.passos).toEqual([['descoberta', A]]);
    expect(s.jwt.signAsync).not.toHaveBeenCalled();
    expect(s.prisma.user.update).not.toHaveBeenCalled();
  });
});

function montarGoogle(orgId = A) {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'id-sintetico');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'segredo-sintetico');
  vi.stubEnv('GOOGLE_LOGIN_ALLOWED_EMAILS', 'pessoa@qa.invalid');
  vi.stubEnv('WEB_ORIGIN', 'http://qa.invalid');
  const passos: Array<[string, string | null | undefined]> = [];
  const prisma = {
    org: {
      findUnique: vi.fn(() => lazy(() => { passos.push(['org', contextoAtual()?.orgId]); return { id: orgId }; })),
      findFirst: vi.fn(() => lazy(() => null)),
    },
    user: {
      findUnique: vi.fn(() => lazy(() => { passos.push(['user', contextoAtual()?.orgId]); return null; })),
      create: vi.fn(() => lazy(() => { passos.push(['create', contextoAtual()?.orgId]); return usuario(orgId); })),
    },
    role: { findUnique: vi.fn(() => lazy(() => { passos.push(['role', contextoAtual()?.orgId]); return { id: 'qa-admin-existente' }; })) },
  };
  const jwt = { verify: vi.fn(() => ({ typ: 'estado-login' })) };
  const auth = { issueSession: vi.fn(async () => ({ token: 'token-sintetico' })) };
  const service = new GoogleLoginService(fake(prisma), fake(jwt), fake(auth));
  const ports = service as unknown as {
    exchange(code: string): Promise<string>;
    fetchProfile(token: string): Promise<{ email: string; email_verified: boolean; name: string }>;
  };
  const exchange = vi.spyOn(ports, 'exchange').mockResolvedValue('token-provedor-sintetico');
  vi.spyOn(ports, 'fetchProfile').mockResolvedValue({ email: 'pessoa@qa.invalid', email_verified: true, name: 'Pessoa QA' });
  return { service, prisma, jwt, auth, passos, exchange };
}
describe('login Google com troca/perfil simulados', () => {
  it('mantém descoberta em plataforma e role/create na empresa existente', async () => {
    const s = montarGoogle();
    expect(await s.service.completeToRedirect('codigo-sintetico', 'login:state-sintetico')).toContain('#token=');
    expect(s.passos).toEqual([['user', ORG_PLATAFORMA], ['org', ORG_PLATAFORMA], ['role', A], ['create', A]]);
    expect(s.prisma.role.findUnique).toHaveBeenCalledWith({ where: { orgId_key: { orgId: A, key: 'admin_master' } } });
    expect(s.prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orgId: A, roles: { connect: { id: 'qa-admin-existente' } } }) }));
    expect(s.auth.issueSession).toHaveBeenCalledWith(expect.objectContaining({ orgId: A }), undefined, 'auth.login.google');
  });
  it('sem allowlist não busca empresa nem cria usuário', async () => {
    const s = montarGoogle();
    vi.stubEnv('GOOGLE_LOGIN_ALLOWED_EMAILS', '');
    expect(await s.service.completeToRedirect('codigo-sintetico', 'login:state-sintetico')).toContain('erro=nao-autorizado');
    expect(s.prisma.org.findUnique).not.toHaveBeenCalled();
    expect(s.prisma.user.create).not.toHaveBeenCalled();
    expect(s.auth.issueSession).not.toHaveBeenCalled();
  });
  it('estado inválido ou expirado não troca código nem acessa usuário', async () => {
    const s = montarGoogle();
    s.jwt.verify.mockImplementation(() => { throw new Error('estado sintético vencido'); });
    expect(await s.service.completeToRedirect('codigo-sintetico', 'login:state-sintetico')).toContain('erro=estado-invalido');
    expect(s.exchange).not.toHaveBeenCalled();
    expect(s.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(s.prisma.user.create).not.toHaveBeenCalled();
  });
  it('não cria pessoa em B quando A já foi resolvida', async () => {
    const s = montarGoogle(B);
    expect(await emA(() => s.service.completeToRedirect('codigo-sintetico', 'login:state-sintetico'))).toContain('erro=falhou');
    expect(s.passos).toEqual([['user', A], ['org', A]]);
    expect(s.prisma.role.findUnique).not.toHaveBeenCalled();
    expect(s.prisma.user.create).not.toHaveBeenCalled();
  });
});

describe('descoberta do provisionamento', () => {
  it('descobre org existente com operação lazy e mantém o gancho de empresa para o restante', async () => {
    const observados: Array<string | null | undefined> = [];
    const prisma = { org: { findUnique: vi.fn(() => lazy(() => {
      observados.push(contextoAtual()?.orgId);
      return { id: A, name: 'Empresa QA', isActive: true, modulos: [] };
    })) }, $transaction: vi.fn() };
    const recusaDoOperador = new Error('gancho sintético recusou antes da operação');
    const emContexto = vi.fn(async (orgId: string) => { expect(orgId).toBe(A); throw recusaDoOperador; });
    await expect(provisionarTenant(fake(prisma), { slug: 'qa-empresa', modo: 'criar' }, { emContexto })).rejects.toBe(recusaDoOperador);
    expect(observados).toEqual([ORG_PLATAFORMA]);
    expect(emContexto).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(contextoAtual()).toBeUndefined();
  });
});

function montarClickup(org: { id: string } | null = { id: A }) {
  vi.stubEnv('CLICKUP_API_TOKEN', 'token-sintetico');
  vi.stubEnv('CLICKUP_SYNC_INTERVAL_MIN', '60');
  const observados: Array<string | null | undefined> = [];
  const prisma = { org: { findUnique: vi.fn(() => lazy(() => { observados.push(contextoAtual()?.orgId); return org; })) } };
  const conectores = { exigirLigado: vi.fn(async () => { throw new Error('conector sintético desligado'); }) };
  const registry = { registrar: vi.fn() };
  const service = new ClickupService(fake(prisma), fake({}), fake(conectores), fake(registry), fake(registry), fake(registry));
  return { service, prisma, observados, conectores };
}
describe('cron ClickUp simulado', () => {
  it('descobre root na plataforma e sincroniza sob a empresa encontrada', async () => {
    vi.useFakeTimers();
    const s = montarClickup();
    const sync = vi.spyOn(s.service, 'sync').mockImplementation(async (orgId) => {
      expect(orgId).toBe(A); expect(contextoAtual()?.orgId).toBe(A);
      return fake({ tasks: 0, content: 0 });
    });
    s.service.onModuleInit();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.observados).toEqual([ORG_PLATAFORMA]);
    expect(sync).toHaveBeenCalledOnce();
    expect(s.prisma.org.findUnique).toHaveBeenCalledWith({ where: { slug: 'root' } });
    expect(contextoAtual()).toBeUndefined();
  });
  it('root ausente não faz fallback nem sincroniza', async () => {
    vi.useFakeTimers();
    const s = montarClickup(null);
    const sync = vi.spyOn(s.service, 'sync');
    s.service.onModuleInit(); await vi.advanceTimersByTimeAsync(20_000);
    expect(s.prisma.org.findUnique).toHaveBeenCalledOnce();
    expect(sync).not.toHaveBeenCalled();
  });
  it('intervalo zero não agenda e desligamento barra saída externa', async () => {
    vi.useFakeTimers();
    const s = montarClickup(); vi.stubEnv('CLICKUP_SYNC_INTERVAL_MIN', '0');
    s.service.onModuleInit(); expect(vi.getTimerCount()).toBe(0);
    await expect(emA(() => s.service.sync(A))).rejects.toThrow('desligado');
    expect(s.conectores.exigirLigado).toHaveBeenCalledWith({ orgId: A, conector: 'clickup' });
    expect(s.prisma.org.findUnique).not.toHaveBeenCalled();
  });
});

describe('carregamento de políticas', () => {
  it('recusa A para B antes do fallback e conserva a política B já carregada', async () => {
    const prisma = { policyVersion: {
      findFirst: vi.fn(() => lazy(() => ({ id: 'qa-politica-b', versao: 9, documento: service.baseHerdada() }))),
    } };
    const service: PolicyService = new PolicyService(fake(prisma));
    const cache = (service as unknown as { cache: Map<string, unknown> }).cache;
    await service.recarregar(B);
    const politicaB = cache.get(B);
    expect(politicaB).toBeDefined();
    prisma.policyVersion.findFirst.mockClear();
    let recusa: unknown;
    try { await emA(() => service.recarregar(B)); } catch (e) { recusa = e; }
    expect(cache.get(B)).toBe(politicaB);
    expect(recusa).toBeInstanceOf(Error);
    expect((recusa as Error).message).toContain('não pode mudar');
    expect(prisma.policyVersion.findFirst).not.toHaveBeenCalled();
  });
  it('enumeração autenticada A descarta ID B sem alterar o cache de B', async () => {
    const prisma = { policyVersion: {
      findFirst: vi.fn(() => lazy(() => ({ id: 'qa-politica', versao: 9, documento: service.baseHerdada() }))),
      findMany: vi.fn(() => lazy(() => [{ orgId: A }, { orgId: B }])),
    } };
    const service: PolicyService = new PolicyService(fake(prisma));
    const cache = (service as unknown as { cache: Map<string, unknown> }).cache;
    await service.recarregar(B);
    const politicaB = cache.get(B);
    expect(politicaB).toBeDefined();
    prisma.policyVersion.findFirst.mockClear();
    await emA(() => service.recarregarEmpresas());
    expect(cache.get(B)).toBe(politicaB);
    expect(prisma.policyVersion.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.policyVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: A, ativaAte: null } }));
  });
  it('consulta base/enumeração na plataforma e versões próprias por empresa', async () => {
    const observados: Array<[string, string | null | undefined]> = [];
    const prisma = { policyVersion: {
      findFirst: vi.fn((args: { where: { orgId: string | null } }) => lazy(() => { observados.push(['documento', contextoAtual()?.orgId]); return null; })),
      findMany: vi.fn(() => lazy(() => { observados.push(['ids', contextoAtual()?.orgId]); return [{ orgId: A }, { orgId: B }]; })),
    } };
    const service = new PolicyService(fake(prisma));
    await service.onModuleInit();
    expect(observados).toEqual([['documento', ORG_PLATAFORMA], ['ids', ORG_PLATAFORMA], ['documento', A], ['documento', B]]);
    expect(prisma.policyVersion.findMany).toHaveBeenCalledWith({ where: { orgId: { not: null }, ativaAte: null }, select: { orgId: true }, distinct: ['orgId'] });
    expect(service.baseHerdada()).toHaveProperty('capacidades');
    expect(contextoAtual()).toBeUndefined();
  });
  it('empresa A consulta somente seus ids e não lê documento de B mesmo se o mock o devolver', async () => {
    const documentos: Array<string | null | undefined> = [];
    const prisma = { policyVersion: {
      findFirst: vi.fn(() => lazy(() => { documentos.push(contextoAtual()?.orgId); return null; })),
      findMany: vi.fn(() => lazy(() => [{ orgId: A }, { orgId: B }])),
    } };
    const service = new PolicyService(fake(prisma));
    await emA(() => service.recarregarEmpresas());
    expect(prisma.policyVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: A, ativaAte: null } }));
    expect(documentos).toEqual([A]);
  });
});

describe('sonda SELECT 1', () => {
  it.each([undefined, A])('consulta lazy sem ampliar o contexto %s', async (empresa) => {
    const observados: Array<string | null | undefined> = [];
    const query = vi.fn(() => lazy(() => { observados.push(contextoAtual()?.orgId); return 1; }));
    const service = new HealthController(fake({ $queryRaw: query }));
    const result = empresa ? await emA(() => service.check()) : await service.check();
    expect(result).toMatchObject({ status: 'ok', db: 'ok' });
    expect(observados).toEqual([empresa ?? ORG_PLATAFORMA]);
    expect(query).toHaveBeenCalledWith(['SELECT 1']);
  });
  it('falha continua down/degraded', async () => {
    const service = new HealthController(fake({ $queryRaw: () => lazy(() => { throw new Error('banco sintético indisponível'); }) }));
    expect(await service.check()).toMatchObject({ status: 'degraded', db: 'down' });
  });
});

function montarBio(falhaNaEmpresaA = false) {
  const observados: Array<[string, string | null | undefined]> = [];
  const prisma = {
    org: { findMany: vi.fn(() => lazy(() => { observados.push(['ids', contextoAtual()?.orgId]); return [{ id: A }, { id: B }]; })) },
    bioChallengeAccount: { findMany: vi.fn((args: { where: { challenge: { orgId: string }; conexao: { orgId: string } } }) => lazy(() => {
      const empresa = contextoAtual()?.orgId;
      observados.push(['contas', empresa]);
      expect(args.where.challenge.orgId).toBe(empresa); expect(args.where.conexao.orgId).toBe(empresa);
      if (falhaNaEmpresaA && empresa === A) throw new Error('falha sintética em A');
      return [{ id: `qa-conta-${empresa}` }];
    })) },
    bioConexao: { findMany: vi.fn((args: { where: { orgId: string } }) => lazy(() => {
      const empresa = contextoAtual()?.orgId;
      observados.push(['conexoes', empresa]); expect(args.where.orgId).toBe(empresa);
      return [{ id: `qa-conexao-${empresa}`, orgId: empresa }];
    })), update: vi.fn() },
  };
  const service = new BioSyncService(fake(prisma), fake({}));
  const sync = vi.spyOn(service, 'sincronizarConta').mockImplementation(async (id) => {
    observados.push(['sync', contextoAtual()?.orgId]); return { contaId: id, ok: true };
  });
  const renovar = vi.spyOn(service as unknown as { tokenValido(c: unknown): Promise<string> }, 'tokenValido').mockImplementation(async () => {
    observados.push(['renovar', contextoAtual()?.orgId]); return 'token-sintetico';
  });
  return { service, prisma, observados, sync, renovar };
}
describe('Bio por empresa — tokens e respostas simulados', () => {
  it('enumera apenas Org.id na plataforma e processa contas/conexões sob A e B', async () => {
    const s = montarBio();
    expect(await s.service.sincronizarTudo()).toHaveLength(2);
    expect(await s.service.renovarContasDePublicacao()).toHaveLength(2);
    expect(s.prisma.org.findMany).toHaveBeenCalledWith({ select: { id: true } });
    expect(s.observados).toEqual([
      ['ids', ORG_PLATAFORMA], ['contas', A], ['sync', A], ['contas', B], ['sync', B],
      ['ids', ORG_PLATAFORMA], ['conexoes', A], ['renovar', A], ['conexoes', B], ['renovar', B],
    ]);
    expect(contextoAtual()).toBeUndefined();
  });
  it('chamada autenticada sem org explícita não enumera nem processa outra empresa', async () => {
    const s = montarBio();
    await emA(async () => { await s.service.sincronizarTudo(); await s.service.renovarContasDePublicacao(); });
    expect(s.prisma.org.findMany).not.toHaveBeenCalled();
    expect(s.observados).toEqual([['contas', A], ['sync', A], ['conexoes', A], ['renovar', A]]);
  });
  it('A com org explícita B é recusada antes de ler ou renovar', async () => {
    const s = montarBio();
    await expect(emA(() => s.service.sincronizarTudo(B))).rejects.toThrow('não pode mudar');
    await expect(emA(() => s.service.renovarContasDePublicacao(B))).rejects.toThrow('não pode mudar');
    expect(s.observados).toEqual([]);
    expect(s.sync).not.toHaveBeenCalled(); expect(s.renovar).not.toHaveBeenCalled();
  });
  it('falha em A não interrompe cron global nem contamina contexto de B', async () => {
    const s = montarBio(true);
    expect(await s.service.sincronizarTudo()).toEqual([{ contaId: `qa-conta-${B}`, ok: true }]);
    expect(s.observados).toEqual([['ids', ORG_PLATAFORMA], ['contas', A], ['contas', B], ['sync', B]]);
    expect(contextoAtual()).toBeUndefined();
  });
  it('erro de chamada autenticada propaga e intervalo zero não agenda', async () => {
    vi.useFakeTimers();
    vi.stubEnv('BIO_SYNC_INTERVAL_MIN', '0');
    const s = montarBio(true);
    s.service.onModuleInit(); expect(vi.getTimerCount()).toBe(0);
    await expect(emA(() => s.service.sincronizarTudo())).rejects.toThrow('falha sintética');
    expect(s.prisma.org.findMany).not.toHaveBeenCalled();
  });
});
