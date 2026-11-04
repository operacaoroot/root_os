import 'reflect-metadata';
import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CofreDepositoService, EnvioDepositoSchema } from '../src/cofre-da-empresa/deposito.service';
import { CofreReceberController, LimiteDeposito } from '../src/cofre-da-empresa/deposito.controller';
import { comContexto, tenantAtual } from '../src/common/contexto-execucao';
import { decifrar } from '../src/common/crypto';
const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA = '22222222-2222-4222-8222-222222222222';
const USER = 'pessoa';
const CLIENTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function montar() {
  const dados = { links: [] as any[], itens: [] as any[], recibos: [] as any[], audit: [] as any[], ativo: true, clientePermitido: true, amplo: false };
  const casa = (r: any, w: any) => Object.entries(w ?? {}).every(([k, v]) => r[k] === v);
  const db: any = {
    org: { findFirst: async () => dados.ativo ? { id: ORG } : null },
    user: { findFirst: async ({ where }: any) => dados.ativo && where.id === USER && where.orgId === ORG ? { id: USER } : null },
    cofreDeposito: {
      create: async ({ data }: any) => { const r = { id: randomUUID(), createdAt: new Date(), revogadoEm: null, recebidos: 0, ...data }; dados.links.push(r); return r; },
      findFirst: async ({ where }: any) => dados.links.find((d) => casa(d, where)) ?? null,
      findMany: async ({ where }: any) => dados.links.filter((d) => casa(d, where)),
      update: async ({ where, data }: any) => { const d = dados.links.find((x) => casa(x, where)); d.recebidos += data.recebidos.increment; return d; },
      updateMany: async ({ where, data }: any) => { const ds = dados.links.filter((d) => casa(d, where)); ds.forEach((d) => Object.assign(d, data)); return { count: ds.length }; },
    },
    cofreDepositoRecibo: {
      findFirst: async ({ where }: any) => dados.recibos.find((d) => casa(d, where)) ?? null,
      create: async ({ data }: any) => { const r = { id: randomUUID(), ...data }; dados.recibos.push(r); return { id: r.id }; },
    },
    cofreItem: { create: async ({ data }: any) => { expect(tenantAtual()).toBe(ORG); dados.itens.push(data); return data; } },
    $queryRaw: async (_sql: any, orgId: string, tokenHash: string) => dados.links.filter((d) => d.orgId === orgId && d.tokenHash === tokenHash).map((d) => ({ id: d.id })),
    $transaction: async (fn: any) => fn(db),
  };
  const svc = new CofreDepositoService(db, { log: async (r: any) => { dados.audit.push(r); } } as any, { filtro: async (orgId: string) => ({orgId}), exigirCliente: async (_o: string, _u: string, id: string | null) => { if (!dados.clientePermitido || (id !== CLIENTE && !(id === null && dados.amplo))) throw new Error('sem acesso'); return {id: CLIENTE, nomeFantasia: 'JUMA', razaoSocial: 'JUMA'}; } } as any);
  return { svc, dados };
}
async function preparar() {
  const f = montar();
  const emitido = await f.svc.emitir(ORG, USER, CLIENTE);
  const token = emitido.caminho.split('#')[1];
  const envio = { token, envioId: randomUUID(), titulo: 'Sistema de teste', usuario: 'login-sintetico', segredo: 'segredo-sintetico', notas: 'nota-sintetica' };
  return { ...f, emitido, token, envio };
}
beforeEach(() => { process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); });
describe('depósito de senhas', () => {
  it('emite por sete dias e guarda somente hash do token', async () => {
    const { emitido, token, dados } = await preparar();
    expect(emitido.expiraEm.getTime() - Date.now()).toBeGreaterThan(7 * 86400000 - 2000);
    expect(emitido.expiraEm.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86400000);
    expect(token).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(dados)).not.toContain(token);
  });
  it('recusa emissor sem permissão atual ou de outra empresa', async () => {
    const { svc } = montar();
    await expect(svc.emitir(ORG, 'intruso', CLIENTE)).rejects.toThrow('Sem acesso');
    await expect(svc.emitir(OUTRA, USER, CLIENTE)).rejects.toThrow('Sem acesso');
  });
  it('não emite link para cliente fora do escopo', async () => {
    const {svc, dados} = montar();
    await expect(svc.emitir(ORG, USER, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).rejects.toThrow();
    expect(dados.links).toHaveLength(0);
  });
  it('recebe cifrado e só responde com recibo; estado não revela itens', async () => {
    const { svc, dados, envio, token } = await preparar();
    const r = await svc.receber(envio);
    expect(Object.keys(r).sort()).toEqual(['ok', 'recibo']);
    const item = dados.itens[0];
    expect(item.clienteId).toBe(CLIENTE);
    expect(item.titulo).toBe('JUMA · Sistema de teste');
    expect(decifrar(item.segredoCifrado, { aad: `cofre-da-empresa:${ORG}:${item.id}:segredo` })).toBe(envio.segredo);
    expect(JSON.stringify(dados)).not.toContain(envio.segredo);
    expect(JSON.stringify(dados.audit)).not.toContain(envio.usuario);
    expect(Object.keys(await svc.estado(token)).sort()).toEqual(['cliente', 'expiraEm', 'podeEnviar']);
  });
  it('repetir envio, inclusive com corpo alterado, retorna o mesmo recibo sem sobrescrever', async () => {
    const { svc, dados, envio } = await preparar();
    const a = await svc.receber(envio);
    expect(await svc.receber({ ...envio, segredo: 'valor-alterado' })).toEqual(a);
    expect(dados.itens).toHaveLength(1); expect(dados.links[0].recebidos).toBe(1);
  });
  it('token adulterado e troca do tenant não alcançam dados', async () => {
    const { svc, token, dados } = await preparar();
    await expect(svc.estado(`${OUTRA}.${token.split('.')[1]}`)).rejects.toThrow('indisponível');
    await expect(svc.estado(token.slice(0, -3) + 'xyz')).rejects.toThrow('indisponível');
    await expect(comContexto({ orgId: OUTRA, correlationId: 'teste' }, () => svc.estado(token))).rejects.toThrow('indisponível');
    expect(dados.itens).toHaveLength(0);
  });
  it('expiração impede envio e preserva credenciais recebidas', async () => {
    const { svc, dados, envio, token } = await preparar();
    await svc.receber(envio);
    dados.links[0].expiraEm = new Date(Date.now() - 1);
    await expect(svc.estado(token)).rejects.toThrow('indisponível');
    await expect(svc.receber({ ...envio, envioId: randomUUID() })).rejects.toThrow('indisponível');
    expect(dados.itens).toHaveLength(1);
  });
  it('revogação só afeta a própria empresa e impede novos envios, sem apagar itens', async () => {
    const { svc, dados, envio, token, emitido } = await preparar();
    await svc.receber(envio);
    await svc.revogar(OUTRA, USER, emitido.id); await expect(svc.estado(token)).resolves.toBeDefined();
    await svc.revogar(ORG, USER, emitido.id); await expect(svc.estado(token)).rejects.toThrow('indisponível');
    expect(dados.itens).toHaveLength(1);
  });
  it('link legado sem cliente permanece utilizável apenas pelo emissor amplo', async () => {
    const { svc, dados, envio, token } = await preparar();
    dados.links[0].clienteId = null;
    await expect(svc.receber(envio)).rejects.toThrow('indisponível');
    dados.amplo = true;
    await expect(svc.receber(envio)).resolves.toMatchObject({ok:true});
    expect(dados.itens[0].clienteId).toBeNull();
    expect(dados.links[0].tokenHash).toBeTruthy();
    await expect(svc.estado(token)).resolves.toMatchObject({cliente:'JUMA'});
  });
  it('revogar acesso ao cliente invalida link já emitido antes de gravar ou repetir recibo', async () => {
    const { svc, dados, envio } = await preparar();
    await svc.receber(envio);
    dados.clientePermitido = false;
    await expect(svc.receber(envio)).rejects.toThrow('indisponível');
    await expect(svc.receber({ ...envio, envioId: randomUUID() })).rejects.toThrow('indisponível');
    expect(dados.itens).toHaveLength(1);
  });
  it('desativar emissor ou empresa encerra a capacidade de depósito', async () => {
    const { svc, dados, envio } = await preparar(); dados.ativo = false;
    await expect(svc.receber(envio)).rejects.toThrow('indisponível');
  });
  it('limita envios e rejeita tentativa de injetar destino e campos extras', async () => {
    const { svc, dados, envio } = await preparar(); dados.links[0].recebidos = 100;
    await expect(svc.receber(envio)).rejects.toThrow('Limite de envios');
    expect(EnvioDepositoSchema.safeParse({ ...envio, orgId: OUTRA }).success).toBe(false);
    expect(EnvioDepositoSchema.safeParse({ ...envio, clienteId: CLIENTE }).success).toBe(false);
    expect(EnvioDepositoSchema.safeParse({ ...envio, segredo: '' }).success).toBe(false);
    expect(EnvioDepositoSchema.safeParse({ ...envio, segredo: 'x'.repeat(5001) }).success).toBe(false);
  });
  it('aplica limite por origem e rejeita submissão de outro site ou formulário HTML', async () => {
    const limite = new LimiteDeposito();
    for (let i = 0; i < 120; i++) limite.conferir('ip', 0);
    expect(() => limite.conferir('ip', 1)).toThrow('Muitas tentativas');
    expect(() => limite.conferir('ip', 3_600_001)).not.toThrow();
    const c = new CofreReceberController({} as any, new LimiteDeposito());
    expect(() => c.estado({}, { headers: { origin: 'https://intruso.test' }, is: () => true } as any)).toThrow('Origem');
    expect(() => c.estado({}, { headers: {}, is: () => false } as any)).toThrow('formulário');
  });
});
