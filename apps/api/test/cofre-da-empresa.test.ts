import { Readable } from 'node:stream';
import { beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { CofreDaEmpresaService, TENTATIVAS_ATE_BLOQUEAR } from '../src/cofre-da-empresa/cofre-da-empresa.service';

/*
 * Cofre da empresa, sem banco: um Prisma de mentira em memória, só com o que o
 * serviço usa. Cobre o que não pode falhar: segredo nunca vai em texto aberto
 * para o banco nem para o registro, cofre trancado não lista nem revela,
 * senha errada conta e bloqueia, e a senha do cofre não é a do login.
 */

const ORG = 'org-1', EU = 'u-1', OUTRO = 'u-2', LOGIN = 'senha-do-login';

function falsoPrisma() {
  const linhas = { senha: [] as any[], sessao: [] as any[], item: [] as any[] };
  let n = 0;
  const casa = (r: any, where: any) => Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('lt' in v) return r[k] < v.lt;
      return Object.entries(v).every(([kk, vv]) => r[kk] === vv); // chave composta orgId_userId
    }
    return r[k] === v;
  });
  const tabela = (t: any[]) => ({
    findUnique: async ({ where }: any) => t.find((r) => casa(r, where)) ?? null,
    findFirst: async ({ where }: any) => t.find((r) => casa(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => t.filter((r) => casa(r, where)),
    create: async ({ data }: any) => { const r = { id: data.id ?? `id-${++n}`, tentativas: 0, bloqueadoAte: null, createdAt: new Date(), updatedAt: new Date(), ...data }; t.push(r); return r; },
    update: async ({ where, data }: any) => { const r = t.find((x) => casa(x, where)); Object.assign(r, data, { updatedAt: new Date() }); return r; },
    upsert: async ({ where, create, update }: any) => {
      const r = t.find((x) => casa(x, where));
      if (r) { Object.assign(r, update); return r; }
      const novo = { id: `id-${++n}`, tentativas: 0, bloqueadoAte: null, ...create }; t.push(novo); return novo;
    },
    deleteMany: async ({ where }: any) => { const fica = t.filter((r) => !casa(r, where)); const c = t.length - fica.length; t.splice(0, t.length, ...fica); return { count: c }; },
    delete: async ({ where }: any) => { const i = t.findIndex((r) => casa(r, where)); return t.splice(i, 1)[0]; },
  });
  return {
    linhas,
    prisma: {
      cofreSenha: tabela(linhas.senha), cofreSessao: tabela(linhas.sessao), cofreItem: tabela(linhas.item),
      user: { findFirst: async ({ where }: any) => (where.id === EU || where.id === OUTRO ? { id: where.id, name: where.id, passwordHash: hashDoLogin } : null) },
    },
  };
}

let hashDoLogin = '';
const registro: any[] = [];
const audit = { log: async (x: any) => { registro.push(x); } };
const guardados = new Map<string, Buffer>();
const storage = {
  put: async (k: string, b: Buffer) => { guardados.set(k, b); },
  get: async (k: string) => ({ stream: Readable.from([guardados.get(k)!]), contentType: '', size: 0 }),
  remover: async (k: string) => { guardados.delete(k); },
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');
  hashDoLogin = await bcrypt.hash(LOGIN, 4);
});

function montar() {
  const f = falsoPrisma();
  const svc = new CofreDaEmpresaService(f.prisma as any, audit as any, storage as any);
  return { svc, ...f };
}

describe('cofre da empresa', () => {
  it('criar a senha do cofre exige a senha do login; depois, a do cofre abre e a do login não', async () => {
    const { svc } = montar();
    await expect(svc.definirSenha(ORG, EU, { senhaNova: 'cofre-123' })).rejects.toThrow(/senha com que você entra/);
    await expect(svc.definirSenha(ORG, EU, { senhaNova: 'cofre-123', senhaDoLogin: 'errada' })).rejects.toThrow();
    await svc.definirSenha(ORG, EU, { senhaNova: 'cofre-123', senhaDoLogin: LOGIN });
    await expect(svc.destrancar(ORG, EU, LOGIN)).rejects.toThrow(/Senha errada/);
    const { token } = await svc.destrancar(ORG, EU, 'cofre-123');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('trancado: não lista, não revela, não cria', async () => {
    const { svc } = montar();
    await expect(svc.listar(ORG, EU, undefined)).rejects.toThrow(/trancado/);
    await expect(svc.listar(ORG, EU, 'token-inventado')).rejects.toThrow(/trancado/);
    await expect(svc.criar(ORG, EU, undefined, { tipo: 'senha', titulo: 'x' })).rejects.toThrow(/trancado/);
  });

  it('o segredo vai cifrado para o banco e para o registro só vai o título; revelar devolve o original', async () => {
    const { svc, linhas } = montar();
    await svc.definirSenha(ORG, EU, { senhaNova: 'cofre-123', senhaDoLogin: LOGIN });
    const { token } = await svc.destrancar(ORG, EU, 'cofre-123');
    const { id } = await svc.criar(ORG, EU, token, { tipo: 'senha', titulo: 'Portal NFS-e', usuario: '46601327000110', segredo: 'S3nh@-Real!', notas: 'prefeitura' });
    const bruto = JSON.stringify(linhas.item);
    expect(bruto).not.toContain('S3nh@-Real!');
    expect(bruto).not.toContain('46601327000110');
    expect(JSON.stringify(registro)).not.toContain('S3nh@-Real!');
    const lista = await svc.listar(ORG, EU, token);
    expect(lista[0]).toMatchObject({ titulo: 'Portal NFS-e', temSegredo: true });
    expect(JSON.stringify(lista)).not.toContain('S3nh@-Real!');
    expect(await svc.revelar(ORG, EU, token, id)).toMatchObject({ usuario: '46601327000110', segredo: 'S3nh@-Real!', notas: 'prefeitura' });
    // o pacote de um item não abre no lugar de outro (dado associado ao id)
    linhas.item.push({ ...linhas.item[0], id: 'outro-id' });
    await expect(svc.revelar(ORG, EU, token, 'outro-id')).rejects.toThrow();
  });

  it(`${TENTATIVAS_ATE_BLOQUEAR} senhas erradas bloqueiam, mesmo que a próxima esteja certa`, async () => {
    const { svc } = montar();
    await svc.definirSenha(ORG, EU, { senhaNova: 'cofre-123', senhaDoLogin: LOGIN });
    for (let i = 0; i < TENTATIVAS_ATE_BLOQUEAR; i++) await expect(svc.destrancar(ORG, EU, 'errada')).rejects.toThrow();
    await expect(svc.destrancar(ORG, EU, 'cofre-123')).rejects.toThrow(/Muitas tentativas/);
    expect((await svc.estado(ORG, EU)).bloqueadoAte).not.toBeNull();
  });

  it('a sessão de um sócio não abre o cofre de outro; zerar a senha de outro derruba a sessão dele', async () => {
    const { svc } = montar();
    await svc.definirSenha(ORG, EU, { senhaNova: 'cofre-123', senhaDoLogin: LOGIN });
    await svc.definirSenha(ORG, OUTRO, { senhaNova: 'cofre-456', senhaDoLogin: LOGIN });
    const meu = (await svc.destrancar(ORG, EU, 'cofre-123')).token;
    const dele = (await svc.destrancar(ORG, OUTRO, 'cofre-456')).token;
    await expect(svc.listar(ORG, OUTRO, meu)).rejects.toThrow(/trancado/);
    await expect(svc.zerarSenhaDeOutro(ORG, EU, meu, EU)).rejects.toThrow();
    await svc.zerarSenhaDeOutro(ORG, EU, meu, OUTRO);
    await expect(svc.listar(ORG, OUTRO, dele)).rejects.toThrow(/trancado/);
    expect((await svc.estado(ORG, OUTRO)).temSenha).toBe(false);
  });

  it('o arquivo vai cifrado para o armazenamento e volta igual', async () => {
    const { svc } = montar();
    await svc.definirSenha(ORG, EU, { senhaNova: 'cofre-123', senhaDoLogin: LOGIN });
    const { token } = await svc.destrancar(ORG, EU, 'cofre-123');
    const { id } = await svc.criar(ORG, EU, token, { tipo: 'documento', titulo: 'Contrato social' });
    const pdf = Buffer.from('%PDF-1.4 contrato social da ROOT');
    await svc.guardarArquivo(ORG, EU, token, id, { nome: 'contrato.pdf', tipo: 'application/pdf', corpo: Readable.from([pdf]), tamanhoDeclarado: pdf.length });
    expect([...guardados.values()].some((b) => b.toString('utf8').includes('contrato social'))).toBe(false);
    const volta = await svc.abrirArquivo(ORG, EU, token, id);
    expect(volta.bytes.equals(pdf)).toBe(true);
    expect(volta.nome).toBe('contrato.pdf');
  });
});
