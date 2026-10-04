import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorType, ContextKind, ContextSource, PrismaClient } from '@prisma/client';
import type { JwtUser } from '../src/auth/current-user.decorator';
import { comContexto } from '../src/common/contexto-execucao';
import { ConectoresConfiguradosRegistry } from '../src/gateway/conectores-configurados.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { RegistroDeConectores } from '../src/integrations/conectores.registry';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { aplicarNaVault, coletarEstado, montarPaginas } from '../src/memory/documentacao';
import { MemoriaController } from '../src/memory/memoria.controller';
import {
  MemoriaService,
  PISO_DO_PAR,
  TIPO_DA_LIBERACAO,
  TIPO_DO_RECIBO,
} from '../src/memory/memoria.service';
import { lerNotaDaVault } from '../src/obsidian/cabecalho-da-nota';
import { lerIndiceDoGit } from '../src/obsidian/indice-do-git';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import { classificarAVault } from '../src/obsidian/pertenca-da-vault';
import type { PrismaService } from '../src/prisma/prisma.service';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import { liberarAGuarda } from '../src/scripts/liberar-guarda-da-vault';
import { exigirBancoDescartavel, travarACasa } from './banco-de-teste';
import { git, versionarVault } from './vault-com-git';

/*
 * ROOT-20 — A COLEÇÃO `vault:` CONTRA O POSTGRES, COM DUAS EMPRESAS.
 *
 * Os ensaios E-20.3, E-20.4 (a a f), E-20.5, E-20.6, E-20.7, E-20.8 (a parte do
 * banco) e E-20.10 de `relatorios/ROOT-19/ensaios-previstos.md`, mais o recibo a
 * montante e o frescor (C19-08, R-9). Serviço real (`ObsidianService`,
 * `MemoriaService`, `EventLogService`, `MemoriaController`, `IntegrationsService`),
 * vault em pasta temporária VERSIONADA pelo git da própria suíte, sem fornecedor
 * de embedding (sem chave, nada é vetorizado: o que esta suíte mede é pertença,
 * movimento, cabeçalho, recusa e recibo).
 *
 * DUAS VEZES A MESMA BATERIA, como `leads-proposta.test.ts`:
 *   · conexão DONA (`TEST_DATABASE_URL`), que roda na suíte padrão;
 *   · papel restrito `mktos_app` com `comTenantNaSessao` em modo `impor`
 *     (`TENANT_DATABASE_URL` + `RLS_NO_TESTE=1`, num banco só dela). Essa seção
 *     é REGISTRADA por `if`, não pulada: sem as duas variáveis ela não existe.
 *
 * A EMPRESA DA CASA (slug `root`) é uma só no banco e a suíte da 05c também a
 * reindexa: as duas tomam a mesma trava (`travarACasa`) e uma espera a outra.
 * Todo caminho e toda chave que esta suíte grava levam a MARCA da execução,
 * inclusive os arquivos na raiz da vault (`90-OS/`, `onboarding/`), e a limpeza
 * apaga pela marca em qualquer posição e sem diferenciar caixa. Sobra derruba a
 * execução seguinte: a pré-condição da suíte da 05c recusa a casa com linha que
 * não é dela. Foi o que aconteceu depois do mutante M5 da ROOT-20, quando o
 * pedido com a chave `Vault:<marca>/x.md` (V maiúsculo) passou e escapou da
 * limpeza por prefixo exato. O RASTRO não se apaga (é append-only), e por isso
 * os recibos são achados pela correlação da volta.
 */

const URL = process.env.TEST_DATABASE_URL;
const URL_TENANT = process.env.TENANT_DATABASE_URL;
const RLS = process.env.RLS_NO_TESTE === '1';
if (URL) {
  exigirBancoDescartavel(URL, 'ESCREVE nele (a empresa da casa, índice e memória da vault, recibos no RASTRO)');
}

const SLUG_DA_CASA = 'root';
const TEMPO = 120_000;
const VARIAVEIS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OBSIDIAN_FONTE', 'OBSIDIAN_VAULT_PATH', 'OBSIDIAN_REINDEX_MIN'] as const;

/** Um corpo único e acima do piso do par. */
function corpo(semente: string): string {
  const texto = `# ${semente}\n\n${`Registro ${semente}: a regra combinada pela casa vale até segunda ordem. `.repeat(5)}`;
  if (texto.length < PISO_DO_PAR + 50) throw new Error('corpo de teste curto demais');
  return texto;
}

/** Uma nota com o cabeçalho do contrato da base. */
function nota(semente: string, cab: { kind?: string; de?: string; ate?: string; substitui?: string } = {}): string {
  const linhas = ['---'];
  if (cab.kind) linhas.push(`kind: ${cab.kind}`);
  linhas.push('dono: Rodrigo');
  if (cab.de) linhas.push(`valido_de: ${cab.de}`);
  if (cab.ate !== undefined) linhas.push(`valido_ate: ${cab.ate}`);
  if (cab.substitui) linhas.push(`substitui: "${cab.substitui}"`);
  linhas.push('tags: [root]', '---');
  return `${linhas.join('\n')}\n${corpo(semente)}`;
}

function casosContraOBanco(modoRls: boolean) {
  const MARCA = `r20-${randomUUID().slice(0, 8)}${modoRls ? '-rls' : ''}`;
  const B = `org-r20-b-${MARCA}`;
  let admin: PrismaClient;
  let app: PrismaClient | null = null;
  let servico: PrismaClient;
  let memoria: MemoriaService;
  let CASA = '';
  let pessoa = '';
  let papel = '';
  let soltarACasa: (() => Promise<void>) | null = null;
  const pastas: string[] = [];
  const salvas: Partial<Record<(typeof VARIAVEIS)[number], string>> = {};

  const naEmpresa = <T>(orgId: string, fn: () => Promise<T>, correlationId = `r20-${randomUUID()}`, ator?: string) =>
    comContexto(
      { orgId, actorType: ator ? ActorType.user : ActorType.system, actorId: ator ?? null, correlationId, origem: ator ? 'http' : 'cron' },
      fn,
    );

  /** A vault de teste: notas sob `<marca>/`, versionada a cada `commit()` (o `pull`). */
  function criarVault(arquivos: Record<string, string> = {}, naRaiz: Record<string, string> = {}) {
    const raiz = mkdtempSync(path.join(os.tmpdir(), 'r20-colecao-'));
    pastas.push(raiz);
    const em = (rel: string, raizDaVault = false) => path.join(raiz, raizDaVault ? rel : `${MARCA}/${rel}`);
    const escrever = (rel: string, texto: string, raizDaVault = false) => {
      mkdirSync(path.dirname(em(rel, raizDaVault)), { recursive: true });
      writeFileSync(em(rel, raizDaVault), texto);
    };
    for (const [rel, t] of Object.entries(arquivos)) escrever(rel, t);
    for (const [rel, t] of Object.entries(naRaiz)) escrever(rel, t, true);
    versionarVault(raiz);
    process.env.OBSIDIAN_VAULT_PATH = raiz;
    return {
      raiz,
      escrever,
      apagar: (rel: string) => rmSync(em(rel), { force: true }),
      mover: (de: string, para: string) => {
        mkdirSync(path.dirname(em(para)), { recursive: true });
        git(raiz, 'mv', `${MARCA}/${de}`, `${MARCA}/${para}`);
      },
      commit: () => versionarVault(raiz),
    };
  }

  function montar() {
    const contrato = new RegistroDeConectores();
    vi.spyOn(contrato['log'], 'log').mockImplementation(() => undefined);
    vi.spyOn(contrato['log'], 'warn').mockImplementation(() => undefined);
    const svc = new ObsidianService(servico as never, new ConectoresConfiguradosRegistry(), contrato, memoria as never);
    vi.spyOn(svc['log'], 'log').mockImplementation(() => undefined);
    vi.spyOn(svc['log'], 'warn').mockImplementation(() => undefined);
    vi.spyOn(memoria['log'], 'warn').mockImplementation(() => undefined);
    vi.spyOn(memoria['log'], 'error').mockImplementation(() => undefined);
    contrato.registrar(
      (svc as unknown as { descritorDoContrato(): Parameters<RegistroDeConectores['registrar']>[0] }).descritorDoContrato(),
      'ObsidianService',
    );
    return { svc, contrato };
  }

  /** Uma volta da reindexação da casa, com correlação própria. */
  async function volta(svc: ObsidianService) {
    const correlacao = `r20-volta-${randomUUID()}`;
    const r = await naEmpresa(CASA, () => svc.reindex(CASA), correlacao).then(
      (n) => ({ ok: n as number }),
      (e: { message: string; getStatus?: () => number }) => ({ erro: e.message, status: e.getStatus?.() }),
    );
    const recibo = await admin.eventLog.findFirst({ where: { orgId: CASA, tipo: TIPO_DO_RECIBO, correlationId: correlacao } });
    return { r, correlacao, recibo, payload: (recibo?.payload ?? null) as Record<string, any> | null };
  }

  const itens = () =>
    admin.contextItem.findMany({ where: { orgId: CASA, chave: { startsWith: `vault:${MARCA}` } }, orderBy: { chave: 'asc' } });
  const item = (rel: string) => admin.contextItem.findFirst({ where: { orgId: CASA, chave: `vault:${MARCA}/${rel}` } });
  const indice = () =>
    admin.knowledgeNote.findMany({ where: { orgId: CASA, path: { startsWith: MARCA } }, orderBy: { path: 'asc' } });
  const versoes = (itemId: string) => admin.contextItemVersion.findMany({ where: { itemId }, orderBy: { versao: 'asc' } });

  /** Tudo desta execução: a marca em qualquer posição do caminho ou da chave, com a caixa que for. */
  const daExecucao = { contains: MARCA, mode: 'insensitive' as const };

  async function limpar() {
    await admin.knowledgeNote.deleteMany({ where: { orgId: CASA, path: daExecucao } });
    await admin.contextItem.updateMany({ where: { orgId: CASA, chave: daExecucao }, data: { supersedesId: null } });
    await admin.contextItem.deleteMany({ where: { orgId: CASA, chave: daExecucao } });
    await admin.knowledgeNote.deleteMany({ where: { orgId: B } });
    await admin.contextItem.deleteMany({ where: { orgId: B } });
  }

  async function acharOuCriarACasa(): Promise<string> {
    const achar = () => admin.org.findUnique({ where: { slug: SLUG_DA_CASA }, select: { id: true } });
    const existente = await achar();
    if (existente) return existente.id;
    try {
      return (await admin.org.create({ data: { name: 'Casa (suíte ROOT-20)', slug: SLUG_DA_CASA }, select: { id: true } })).id;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      return (await achar())!.id;
    }
  }

  beforeAll(async () => {
    soltarACasa = await travarACasa(URL!);
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    await admin.$connect();
    CASA = await acharOuCriarACasa();
    const deOutraOrigem =
      (await admin.knowledgeNote.count({
        where: { orgId: CASA, NOT: [{ path: { startsWith: MARCA } }, { path: { startsWith: 'onboarding/' } }] },
      })) +
      (await admin.contextItem.count({
        where: { orgId: CASA, sourceType: ContextSource.vault, arquivadoEm: null, NOT: { chave: { startsWith: `vault:${MARCA}` } } },
      }));
    if (deOutraOrigem) {
      throw new Error(
        `A empresa "${SLUG_DA_CASA}" deste banco tem ${deOutraOrigem} linha(s) de índice ou item vivo da vault que não são ` +
          'desta suíte, e reindexar a casa os apagaria ou arquivaria. Rode contra um banco descartável sem essa casa.',
      );
    }
    await admin.org.upsert({ where: { id: B }, create: { id: B, name: `Cliente ${MARCA}`, slug: `cliente-${MARCA}` }, update: {} });
    const permissao = await admin.permission.upsert({ where: { key: 'obsidian.editar' }, create: { key: 'obsidian.editar' }, update: {} });
    papel = (
      await admin.role.create({
        data: { orgId: CASA, key: `liberador-${MARCA}`, name: 'Liberador da suíte', permissions: { connect: { id: permissao.id } } },
      })
    ).id;
    pessoa = (
      await admin.user.create({
        data: {
          orgId: CASA,
          email: `pessoa.${MARCA}@casa.teste`,
          name: 'Pessoa da casa',
          passwordHash: 'sem-senha-util',
          isActive: true,
          roles: { connect: { id: papel } },
        },
      })
    ).id;

    servico = admin;
    if (modoRls) {
      app = new PrismaClient({ datasourceUrl: URL_TENANT });
      await app.$connect();
      servico = comTenantNaSessao(app, { modo: 'impor', avisar: () => undefined });
    }
    memoria = new MemoriaService(servico as unknown as PrismaService, new EventLogService(servico as never));
  }, 10 * TEMPO);

  afterAll(async () => {
    try {
      if (!admin) return;
      await limpar();
      await admin.user.deleteMany({ where: { id: pessoa } });
      await admin.role.deleteMany({ where: { id: papel } });
      await admin.$disconnect();
      if (app) await app.$disconnect();
    } finally {
      await soltarACasa?.();
    }
  }, TEMPO);

  beforeEach(async () => {
    for (const v of VARIAVEIS) {
      salvas[v] = process.env[v];
      delete process.env[v];
    }
    await limpar();
  }, TEMPO);

  afterEach(() => {
    vi.restoreAllMocks();
    for (const v of VARIAVEIS) {
      if (salvas[v] === undefined) delete process.env[v];
      else process.env[v] = salvas[v];
    }
    for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  });

  it('a conexão do serviço é a esperada: dona, ou mktos_app sem atravessar policy', async () => {
    if (!modoRls) {
      expect(servico).toBe(admin);
      return;
    }
    const [{ u, rls, sup }] = await app!.$queryRaw<{ u: string; rls: boolean; sup: boolean }[]>`
      SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rls,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS sup`;
    expect({ u, rls, sup }).toEqual({ u: 'mktos_app', rls: false, sup: false });
    await expect(memoria.listar(CASA)).rejects.toBeDefined();
  });

  // -------------------------------------------------------------------------
  // E-20.3 — pertença (C19-03)
  // -------------------------------------------------------------------------

  it('E-20.3: só o rastreado e íntegro entra; o alterado mantém a versão anterior; o recibo conta cada caso; a cliente não ganha nada', async () => {
    const v = criarVault(
      {
        'intacta.md': nota('intacta', { kind: 'regra', de: '2026-09-15' }),
        'alterada.md': nota('alterada', { de: '2026-09-15' }),
        'gerada.md': `---\ngerado_por: root-os\ngerado_para: root\nkind: regra\n---\n${corpo('gerada')}`,
      },
      { [`90-OS/${MARCA}-anexo.md`]: corpo('dado do OS') },
    );
    const { svc } = montar();
    const v1 = await volta(svc);
    expect(v1.r).toEqual({ ok: 2 });

    v.escrever('solta.md', nota('solta'));
    v.escrever('alterada.md', `${nota('alterada', { de: '2026-09-15' })}\nmexida na VPS, fora do git`);
    const v2 = await volta(svc);

    const alterada = (await item('alterada.md'))!;
    expect({
      volta2: v2.r,
      indice: (await indice()).map((n) => [n.path.slice(MARCA.length + 1), n.content.includes('fora do git')]),
      itens: (await itens()).map((i) => [i.chave.slice(`vault:${MARCA}/`.length), i.kind, i.versao]),
      versoesDaAlterada: (await versoes(alterada.id)).length,
      corpoDaAlterada: alterada.body.includes('fora do git'),
      descoberta: v2.payload?.recibo.descoberta,
      resultado: v2.payload?.resultado,
      motivos: v2.payload?.motivos,
      empresaB: {
        indice: await admin.knowledgeNote.count({ where: { orgId: B } }),
        memoria: await admin.contextItem.count({ where: { orgId: B } }),
        recibos: await admin.eventLog.count({ where: { orgId: B, tipo: TIPO_DO_RECIBO } }),
      },
    }).toEqual({
      volta2: { ok: 1 },
      indice: [
        ['alterada.md', false],
        ['intacta.md', false],
      ],
      itens: [
        ['alterada.md', ContextKind.nota, 1],
        ['intacta.md', ContextKind.regra, 1],
      ],
      versoesDaAlterada: 1,
      corpoDaAlterada: false,
      descoberta: expect.objectContaining({
        mdNoDisco: 5,
        rastreados: 3,
        naoRastreados: 1,
        alteradosForaDoGit: 1,
        geradosExcluidos: 1,
        pastasForaDaColecao: { '90-OS': 1 },
        membros: 1,
        rastreamento: 'ok',
      }),
      resultado: 'parcial',
      motivos: ['1 arquivo(s) alterado(s) na VPS fora do git'],
      empresaB: { indice: 0, memoria: 0, recibos: 0 },
    });
    // Os caminhos de quem ficou fora vão sob `sigiloso`: nada de "solta.md" em claro no RASTRO.
    expect(JSON.stringify(v2.payload)).not.toContain('solta.md');
    expect(v2.payload?.recibo.foraDaColecao.nao_rastreado).toMatchObject({ total: 1, caminhos: [{ sigiloso: true }] });
    const erroDeB = await naEmpresa(B, () => svc.reindex(B)).catch((e: { getStatus?: () => number }) => e);
    expect((erroDeB as { getStatus?: () => number }).getStatus?.()).toBe(403);
  }, TEMPO);

  it('R-3: rastreado e apagado do disco FORA do git não arquiva; apagado PELO git arquiva', async () => {
    const v = criarVault({ 'a.md': nota('a'), 'b.md': nota('b') });
    const { svc } = montar();
    await volta(svc);
    v.apagar('a.md');
    const fora = await volta(svc);
    expect({ arquivada: (await item('a.md'))!.arquivadoEm, apagados: fora.payload?.recibo.descoberta.apagadosForaDoGit }).toEqual({
      arquivada: null,
      apagados: 1,
    });
    expect((await indice()).map((n) => n.path)).toEqual([`${MARCA}/a.md`, `${MARCA}/b.md`]);
    git(v.raiz, 'add', '-A');
    git(v.raiz, 'commit', '-q', '-m', 'agora sim');
    const pelaBase = await volta(svc);
    expect({ arquivada: Boolean((await item('a.md'))!.arquivadoEm), arquivadas: pelaBase.payload?.recibo.projecao.arquivadas }).toEqual({
      arquivada: true,
      arquivadas: 1,
    });
  }, TEMPO);

  // -------------------------------------------------------------------------
  // E-20.4 — movimento sem perder o itemId (C19-04, R-4, R-6)
  // -------------------------------------------------------------------------

  it('E-20.4 (a): mover sem editar mantém o itemId, com uma versão `alteracao` e o evento de vault:A para vault:B', async () => {
    const v = criarVault({ 'x/nota.md': nota('a-mover', { kind: 'fato', de: '2026-09-15' }) });
    const { svc } = montar();
    await volta(svc);
    const antes = (await item('x/nota.md'))!;
    v.mover('x/nota.md', 'y/nota.md');
    v.commit();
    const v2 = await volta(svc);
    const depois = (await item('y/nota.md'))!;
    const historico = await versoes(depois.id);
    const evento = await admin.eventLog.findFirst({
      where: { orgId: CASA, tipo: 'memoria.item.alterado', correlationId: v2.correlacao },
    });
    const ev = evento!.payload as Record<string, any>;
    expect({
      mesmoItem: depois.id === antes.id,
      origemSumiu: await item('x/nota.md'),
      versoes: historico.map((h) => [h.versao, h.mudanca, h.sourceRef?.slice(MARCA.length + 1)]),
      motivo: historico[1].motivo,
      kind: depois.kind,
      projecao: { movidas: v2.payload?.recibo.projecao.movidas, criadas: v2.payload?.recibo.projecao.criadas, arquivadas: v2.payload?.recibo.projecao.arquivadas },
      estado: [ev.estadoAnterior.procedencia, ev.estadoNovo.procedencia],
      pares: v2.payload?.recibo.projecao.pares,
    }).toEqual({
      mesmoItem: true,
      origemSumiu: null,
      versoes: [
        [1, 'criacao', 'x/nota.md'],
        [2, 'alteracao', 'y/nota.md'],
      ],
      motivo: `o arquivo foi movido na vault (${MARCA}/x/nota.md → ${MARCA}/y/nota.md, corpo idêntico)`,
      kind: ContextKind.fato,
      projecao: { movidas: 1, criadas: 0, arquivadas: 0 },
      estado: [`vault:${MARCA}/x/nota.md`, `vault:${MARCA}/y/nota.md`],
      pares: [{ de: expect.objectContaining({ sigiloso: true }), para: expect.objectContaining({ sigiloso: true }), situacao: 'movido' }],
    });
  }, TEMPO);

  it('E-20.4 (a2): mover e trocar só o cabeçalho na mesma volta: o movimento e depois a alteração comum', async () => {
    const v = criarVault({ 'x/nota.md': nota('a-mover', { kind: 'nota', de: '2026-09-15' }) });
    const { svc } = montar();
    await volta(svc);
    const antes = (await item('x/nota.md'))!;
    v.mover('x/nota.md', 'y/nota.md');
    v.escrever('y/nota.md', nota('a-mover', { kind: 'decisao', de: '2026-09-15', ate: '2026-12-31' }));
    v.commit();
    await volta(svc);
    const depois = (await item('y/nota.md'))!;
    expect({
      mesmoItem: depois.id === antes.id,
      kind: depois.kind,
      validUntil: depois.validUntil?.toISOString(),
      versoes: (await versoes(depois.id)).map((h) => [h.mudanca, h.motivo?.split(' ').slice(0, 4).join(' ')]),
    }).toEqual({
      mesmoItem: true,
      kind: ContextKind.decisao,
      validUntil: '2026-12-31T00:00:00.000Z',
      versoes: [
        ['criacao', 'indexação da vault do'],
        ['alteracao', 'o arquivo foi movido'],
        ['alteracao', 'o cabeçalho do arquivo'],
      ],
    });
  }, TEMPO);

  it('E-20.4 (b), (c) e (d): corpo repetido, destino que já existe arquivado e mover-e-editar caem no comportamento de antes', async () => {
    const v = criarVault({
      'b/um.md': nota('igual'),
      'b/dois.md': nota('igual'),
      'c/p.md': nota('p'),
      'c/q.md': nota('q'),
      'd/r.md': nota('r'),
    });
    const { svc } = montar();
    await volta(svc);
    // (c) q sai pela base; p é movido para o caminho de q, que já existe arquivado.
    git(v.raiz, 'rm', '-q', `${MARCA}/c/q.md`);
    v.commit();
    await volta(svc);
    const q = (await item('c/q.md'))!;
    const p = (await item('c/p.md'))!;
    expect(q.arquivadoEm).not.toBeNull();

    v.mover('b/um.md', 'b2/um.md');
    v.mover('b/dois.md', 'b2/dois.md');
    v.mover('c/p.md', 'c/q.md');
    v.mover('d/r.md', 'd/s.md');
    v.escrever('d/s.md', nota('r editada no mesmo commit'));
    v.commit();
    const v3 = await volta(svc);
    const pr = v3.payload?.recibo.projecao;
    expect({
      movidas: pr.movidas,
      descartados: pr.movimentosDescartados,
      // (b) os dois sumiram e nasceram de novo, com outro itemId
      b: (await itens())
        .filter((i) => i.chave.includes('/b'))
        .map((i) => [i.chave.split('/').slice(-2).join('/'), Boolean(i.arquivadoEm)] as const)
        .sort(([x], [y]) => (x < y ? -1 : 1)),
      // (c) p arquivado, q restaurado e alterado com o corpo de p — o itemId de q
      p: Boolean((await item('c/p.md'))!.arquivadoEm),
      q: { mesmoItem: (await item('c/q.md'))!.id === q.id, vivo: !(await item('c/q.md'))!.arquivadoEm, corpoDeP: (await item('c/q.md'))!.contentHash === p.contentHash },
      // (d) r arquivado, s nasceu
      d: [Boolean((await item('d/r.md'))!.arquivadoEm), Boolean(await item('d/s.md'))],
    }).toEqual({
      movidas: 0,
      descartados: { ambiguos: 2, curtos: 0 },
      b: [
        ['b/dois.md', true],
        ['b/um.md', true],
        ['b2/dois.md', false],
        ['b2/um.md', false],
      ],
      p: true,
      q: { mesmoItem: true, vivo: true, corpoDeP: true },
      d: [true, true],
    });
  }, TEMPO);

  it('E-20.4 (e) e R-6: movimentos acima do teto ficam segurados por inteiro; a liberação por gente move na volta seguinte', async () => {
    // Seis notas e seis movimentos: o teto é max(5, 20% de 6) = 5.
    const arquivos: Record<string, string> = {};
    for (let i = 0; i < 6; i++) arquivos[`origem/n${i}.md`] = nota(`teto-${i}`);
    const v = criarVault(arquivos);
    const { svc } = montar();
    await volta(svc);
    const ids = new Map((await itens()).map((i) => [i.chave.split('/').pop(), i.id]));
    for (let i = 0; i < 6; i++) v.mover(`origem/n${i}.md`, `destino/n${i}.md`);
    v.commit();
    const segura = await volta(svc);
    const pr = segura.payload?.recibo.projecao;
    expect({
      resultado: segura.payload?.resultado,
      movimentosRecusados: pr.movimentosRecusados,
      criadas: pr.criadas,
      arquivadas: pr.arquivadas,
      vivos: (await itens()).filter((i) => !i.arquivadoEm).length,
      destinos: (await itens()).filter((i) => i.chave.includes('/destino/')).length,
      conjunto: typeof pr.guardas.movimentos.conjunto,
    }).toEqual({ resultado: 'parcial', movimentosRecusados: 6, criadas: 0, arquivadas: 0, vivos: 6, destinos: 0, conjunto: 'string' });

    // Sem liberação, a volta seguinte segura de novo — e não grava recibo novo: nada mudou.
    const deNovo = await volta(svc);
    expect({ recibo: deNovo.recibo, destinos: (await itens()).filter((i) => i.chave.includes('/destino/')).length }).toEqual({
      recibo: null,
      destinos: 0,
    });

    // A pessoa libera pelo comando; o motivo e o autor vão ao RASTRO.
    const linhas: string[] = [];
    const lib = await liberarAGuarda(
      admin,
      { como: `pessoa.${MARCA}@casa.teste`, motivo: 'reorganização de pastas combinada com o Rodrigo' },
      (l) => linhas.push(l),
    );
    expect(lib.movimentos).toEqual({ conjunto: pr.guardas.movimentos.conjunto, quantidade: 6 });
    const evento = await admin.eventLog.findUniqueOrThrow({ where: { id: lib.eventoId! } });
    expect({ tipo: evento.tipo, ator: [evento.actorType, evento.actorId], motivo: (evento.payload as any).motivo }).toEqual({
      tipo: TIPO_DA_LIBERACAO,
      ator: [ActorType.user, pessoa],
      motivo: 'reorganização de pastas combinada com o Rodrigo',
    });

    const move = await volta(svc);
    const depois = await itens();
    expect({
      movidas: move.payload?.recibo.projecao.movidas,
      liberacaoUsada: move.payload?.liberacaoUsada,
      mesmosIds: [0, 1, 2, 3, 4, 5].every((i) => depois.find((x) => x.chave.endsWith(`/destino/n${i}.md`))?.id === ids.get(`n${i}.md`)),
      arquivadas: depois.filter((i) => i.arquivadoEm).length,
    }).toEqual({ movidas: 6, liberacaoUsada: lib.eventoId, mesmosIds: true, arquivadas: 0 });
    // Consumida, a liberação não vale de novo.
    expect(await naEmpresa(CASA, () => memoria.liberacaoDaVault(CASA))).toBeNull();
  }, TEMPO);

  it('R-6: a liberação vale só para o conjunto exato do recibo — a vault que mudou de novo segue segurada', async () => {
    const arquivos: Record<string, string> = {};
    for (let i = 0; i < 7; i++) arquivos[`origem/n${i}.md`] = nota(`exato-${i}`);
    const v = criarVault(arquivos);
    const { svc } = montar();
    await volta(svc);
    for (let i = 0; i < 6; i++) v.mover(`origem/n${i}.md`, `destino/n${i}.md`);
    v.commit();
    await volta(svc);
    const lib = await liberarAGuarda(admin, { como: pessoa, motivo: 'reorganização combinada, seis notas' }, () => undefined);
    expect(lib.movimentos?.quantidade).toBe(6);
    // Entre a liberação e a volta, mais um arquivo muda de pasta: o conjunto já não é o liberado.
    v.mover('origem/n6.md', 'destino/n6.md');
    v.commit();
    const outra = await volta(svc);
    expect({
      movidas: outra.payload?.recibo.projecao.movidas,
      segurados: outra.payload?.recibo.projecao.movimentosRecusados,
      liberacaoUsada: outra.payload?.liberacaoUsada,
    }).toEqual({ movidas: 0, segurados: 7, liberacaoUsada: null });
    // A liberação de antes continua não consumida, e não serve para o conjunto novo.
    expect((await naEmpresa(CASA, () => memoria.liberacaoDaVault(CASA)))?.eventoId).toBe(lib.eventoId);
  }, TEMPO);

  it('E-20.4 (f): reorganização com movimentos e uma exclusão real — a guarda conta só a exclusão', async () => {
    // Sete notas: o teto é 5; mover 4 e apagar 2 somaria 6 sumidas, e só 2 não têm par.
    const arquivos: Record<string, string> = {};
    for (let i = 0; i < 7; i++) arquivos[`pasta/n${i}.md`] = nota(`reorg-${i}`);
    const v = criarVault(arquivos);
    const { svc } = montar();
    await volta(svc);
    for (let i = 0; i < 4; i++) v.mover(`pasta/n${i}.md`, `nova/n${i}.md`);
    git(v.raiz, 'rm', '-q', `${MARCA}/pasta/n5.md`, `${MARCA}/pasta/n6.md`);
    v.commit();
    // 6 sumiram: acima do teto de 5 se contasse tudo; 2 sem par, abaixo dele.
    const r = await volta(svc);
    const pr = r.payload?.recibo.projecao;
    expect({ movidas: pr.movidas, arquivadas: pr.arquivadas, recusado: pr.arquivamentoRecusado, resultado: r.payload?.resultado }).toEqual({
      movidas: 4,
      arquivadas: 2,
      recusado: 0,
      resultado: 'ok',
    });
  }, TEMPO);

  it('R-6: arquivamento acima do teto fica segurado e a frase aponta o comando; liberado, a volta seguinte arquiva', async () => {
    const arquivos: Record<string, string> = {};
    for (let i = 0; i < 7; i++) arquivos[`massa/n${i}.md`] = nota(`massa-${i}`);
    const v = criarVault(arquivos);
    const { svc } = montar();
    const erros: string[] = [];
    vi.spyOn(memoria['log'], 'error').mockImplementation((m: unknown) => void erros.push(String(m)));
    await volta(svc);
    git(v.raiz, 'rm', '-q', ...Array.from({ length: 6 }, (_, i) => `${MARCA}/massa/n${i}.md`));
    v.commit();
    const segura = await volta(svc);
    expect(segura.payload?.recibo.projecao.arquivamentoRecusado).toBe(6);
    expect(erros.join('\n')).toMatch(/liberar-guarda-da-vault\.js --como/);
    expect(erros.join('\n')).not.toMatch(/arquive na tela/);
    await liberarAGuarda(admin, { como: pessoa, motivo: 'a pasta massa foi aposentada de propósito' }, () => undefined);
    const arquiva = await volta(svc);
    expect({ arquivadas: arquiva.payload?.recibo.projecao.arquivadas, vivos: (await itens()).filter((i) => !i.arquivadoEm).length }).toEqual({
      arquivadas: 6,
      vivos: 1,
    });
  }, TEMPO);

  // -------------------------------------------------------------------------
  // E-20.5 — cabeçalho, com a distribuição de produção (C19-05, R-7, R-8)
  // -------------------------------------------------------------------------

  it('E-20.5: a primeira volta lendo o cabeçalho muda exatamente as notas previstas, e nenhuma página do gerador volta', async () => {
    /*
     * A DISTRIBUIÇÃO É A DA ÁRVORE QUE PRODUÇÃO LIA (`e2a2178`, 397 notas da
     * coleção, medida sem conteúdo no clone local da base): kind decisao 39,
     * definicao 89, regra 23, fato 67, nota 179; `valido_de` em 392; `valido_ate`
     * em 2; `substitui` em 1. Mudam todas as que têm kind diferente de nota OU
     * alguma validade OU substituição: 395 — e não as ~219 que o contrato
     * estimou contando só o `kind`. A previsão é conferida sempre, pela leitura
     * pura do fixture inteiro.
     *
     * A PARTE COM BANCO roda uma amostra por padrão (as dez primeiras, que têm
     * os casos de borda, e uma a cada vinte e seis das outras): as 397 em
     * escala de produção são ~800 escritas com evento em sequência, e em paralelo
     * com as outras suítes da CI isso derruba prazo alheio. Com
     * `R20_ESCALA_DE_PRODUCAO=1` roda a árvore inteira (a evidência local da
     * ROOT-20 é essa).
     */
    const escalaDeProducao = process.env.R20_ESCALA_DE_PRODUCAO === '1';
    const kinds = [
      ...Array(39).fill('decisao'),
      ...Array(89).fill('definicao'),
      ...Array(23).fill('regra'),
      ...Array(67).fill('fato'),
    ];
    const todos: Array<{ i: number; rel: string; texto: string }> = [];
    for (let i = 0; i < 397; i++) {
      // 0 e 1: nota sem validade (as duas que não mudam); 2 a 4: kind sem validade; 220 em diante: nota com validade.
      const kind = i < 2 ? 'nota' : (kinds[i - 2] ?? 'nota');
      const cab = {
        kind,
        de: i >= 5 ? '2026-09-15' : undefined,
        ate: i === 5 || i === 6 ? '2026-12-31' : undefined,
        substitui: i === 7 ? `[[${MARCA}/n/n8]]` : undefined,
      };
      todos.push({ i, rel: `n/n${i}.md`, texto: nota(`cabecalho-${i}`, cab) });
    }
    const distribuicao = (lista: string[]) => lista.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
    const muda = (texto: string) => {
      const c = lerNotaDaVault('x.md', texto).cabecalho;
      return Boolean(c.kind !== ContextKind.nota || c.validFrom || c.validUntil || c.substitui);
    };
    expect({
      notas: todos.length,
      mudam: todos.filter((n) => muda(n.texto)).length,
      kinds: distribuicao(todos.map((n) => lerNotaDaVault('x.md', n.texto).cabecalho.kind)),
      comValidoDe: todos.filter((n) => lerNotaDaVault('x.md', n.texto).cabecalho.validFrom).length,
    }).toEqual({ notas: 397, mudam: 395, kinds: { nota: 179, decisao: 39, definicao: 89, regra: 23, fato: 67 }, comValidoDe: 392 });

    const usados = escalaDeProducao ? todos : todos.filter((n) => n.i < 10 || n.i % 26 === 0);
    const arquivos: Record<string, string> = Object.fromEntries(usados.map((n) => [n.rel, n.texto]));
    const previstas = usados.filter((n) => muda(n.texto)).length;
    const kindsPrevistos = distribuicao(usados.map((n) => lerNotaDaVault('x.md', n.texto).cabecalho.kind));
    const semCabecalhoLido = usados.map((n) => {
      const lida = lerNotaDaVault(`${MARCA}/${n.rel}`, n.texto);
      return { caminho: `${MARCA}/${n.rel}`, title: lida.title, body: lida.content, tags: lida.tags };
    });

    // O estado de antes da ROOT-20: a projeção sem ler cabeçalho (tudo `nota`, sem validade).
    await naEmpresa(CASA, () => memoria.projetarDaVault(CASA, semCabecalhoLido));
    expect(distribuicao((await itens()).map((i) => i.kind))).toEqual({ nota: usados.length });

    const v = criarVault(arquivos);
    const { svc } = montar();
    const primeira = await volta(svc);
    const versoesDaVolta = await admin.contextItemVersion.count({
      where: { orgId: CASA, item: { chave: { startsWith: `vault:${MARCA}` } }, mudanca: 'alteracao' },
    });
    const eventosDaVolta = await admin.eventLog.count({ where: { orgId: CASA, tipo: 'memoria.item.alterado', correlationId: primeira.correlacao } });
    const n7 = (await item('n/n7.md'))!;
    expect({
      alteradas: primeira.payload?.recibo.projecao.alteradas,
      inalteradas: primeira.payload?.recibo.projecao.inalteradas,
      versoesDaVolta,
      eventosDaVolta,
      kinds: distribuicao((await itens()).map((i) => i.kind)),
      substitui: n7.supersedesId === (await item('n/n8.md'))!.id,
      comValidade: (await itens()).filter((i) => i.validFrom).length,
    }).toEqual({
      alteradas: previstas,
      inalteradas: usados.length - previstas,
      versoesDaVolta: previstas,
      eventosDaVolta: previstas,
      kinds: kindsPrevistos,
      substitui: true,
      comValidade: usados.filter((n) => n.i >= 5).length,
    });
    if (escalaDeProducao) expect(previstas).toBe(395);
    // O histórico da validade vai no evento (R-8): antes nula, depois a data.
    const evDaN5 = await admin.eventLog.findFirst({
      where: { orgId: CASA, tipo: 'memoria.item.alterado', correlationId: primeira.correlacao, payload: { path: ['itemId'], equals: (await item('n/n5.md'))!.id } },
    });
    expect([(evDaN5!.payload as any).estadoAnterior.validUntil, (evDaN5!.payload as any).estadoNovo.validUntil]).toEqual([
      null,
      '2026-12-31T00:00:00.000Z',
    ]);

    // O gerador de documentação escreve as páginas na vault, e alguém as versiona (o pior caso).
    const estado = await coletarEstado(admin, CASA);
    const paginas = montarPaginas(estado);
    aplicarNaVault(v.raiz, `${MARCA}/documentacao`, estado, paginas, {
      aceitarPastaNaoProvada: true,
      aceitarReescritaEmMassa: true,
      aceitarColapsoParcial: true,
    });
    v.commit();
    const geradas = readdirSync(path.join(v.raiz, MARCA, 'documentacao'), { recursive: true }).filter((n) => String(n).endsWith('.md')).length;
    // Uma página por nota documentável (kind que não é `nota`), mais o índice e as de agentes, rotinas e conexões.
    const documentaveis = usados.filter((n) => lerNotaDaVault('x.md', n.texto).cabecalho.kind !== ContextKind.nota).length;
    expect(geradas).toBeGreaterThan(documentaveis);
    const depoisDoGerador = await volta(svc);
    expect({
      excluidas: depoisDoGerador.payload?.recibo.descoberta.geradosExcluidos,
      naMemoria: await admin.contextItem.count({ where: { orgId: CASA, chave: { startsWith: `vault:${MARCA}/documentacao` } } }),
      noIndice: await admin.knowledgeNote.count({ where: { orgId: CASA, path: { startsWith: `${MARCA}/documentacao` } } }),
      criadas: depoisDoGerador.payload?.recibo.projecao.criadas,
      alteradas: depoisDoGerador.payload?.recibo.projecao.alteradas,
    }).toEqual({ excluidas: geradas, naMemoria: 0, noIndice: 0, criadas: 0, alteradas: 0 });

    // `substitui` sem alvo vira aviso, não falha.
    v.escrever('n/orfa.md', nota('órfã', { kind: 'regra', de: '2026-09-15', substitui: 'nao/existe.md' }));
    v.commit();
    const semAlvo = await volta(svc);
    expect({
      criadas: semAlvo.payload?.recibo.projecao.criadas,
      semAlvo: semAlvo.payload?.recibo.projecao.substituicoes.semAlvo,
      resultado: semAlvo.payload?.resultado,
      supersedes: (await item('n/orfa.md'))!.supersedesId,
    }).toEqual({ criadas: 1, semAlvo: 1, resultado: 'ok', supersedes: null });
  }, 5 * TEMPO);

  // -------------------------------------------------------------------------
  // E-20.6 — a reserva do prefixo e a E4 na borda HTTP (C19-06, R-5)
  // -------------------------------------------------------------------------

  it('E-20.6: as sete recusas na borda, a projeção seguinte sem efeito, e a nota comum da tela continua editável', async () => {
    criarVault({ 'da-base.md': nota('da base', { kind: 'regra', de: '2026-09-15' }) });
    const { svc } = montar();
    await volta(svc);
    const daBase = (await item('da-base.md'))!;
    const rota = new MemoriaController(memoria);
    const quem: JwtUser = {
      sub: pessoa,
      orgId: CASA,
      email: `pessoa.${MARCA}@casa.teste`,
      name: 'Pessoa',
      roles: ['admin_master'],
      permissions: ['obsidian.editar', 'obsidian.ver'],
    };
    // `async` de propósito: o controlador recusa de forma SÍNCRONA, e a recusa tem de virar rejeição aqui.
    const comoPessoa = <T>(fn: () => Promise<T> | T) =>
      naEmpresa(CASA, async () => fn(), `r20-http-${randomUUID()}`, pessoa).then(
        () => 'passou',
        (e: { getStatus?: () => number; message: string }) => `${e.getStatus?.()} ${e.message.slice(0, 40)}`,
      );
    const daTela = await naEmpresa(
      CASA,
      () => rota.criar(quem, { chave: `${MARCA}/da-tela`, title: 'Da tela', body: 'nota digitada', sourceType: 'operador' }),
      `r20-${randomUUID()}`,
      pessoa,
    );

    const recusas = {
      alterar: await comoPessoa(() => rota.alterar(quem, daBase.id, { body: 'editado na tela' })),
      arquivar: await comoPessoa(() => rota.arquivar(quem, daBase.id, {})),
      restaurar: await comoPessoa(() => rota.restaurar(quem, daBase.id, {})),
      criarComPrefixo: await comoPessoa(() => rota.criar(quem, { chave: ` Vault:${MARCA}/x.md`, title: 'x', body: 'x', sourceType: 'operador' })),
      criarComOrigem: await comoPessoa(() => rota.criar(quem, { chave: `${MARCA}/y`, title: 'y', body: 'y', sourceType: 'vault' })),
      promoverComPrefixo: await comoPessoa(() => rota.promover(quem, { chave: `vault:${MARCA}/z.md`, title: 'z', body: 'z' })),
      trocarOrigem: await comoPessoa(() => rota.alterar(quem, daTela.id, { sourceType: 'vault' })),
    };
    for (const [nome, r] of Object.entries(recusas)) expect(r, nome).toMatch(/^403 /);
    expect(recusas.alterar).toMatch(/^403 Esta nota vem da vault da casa/);
    expect(recusas.criarComPrefixo).toMatch(/^403 A chave "vault:" e a origem "vault"/);

    const seguinte = await volta(svc);
    expect({
      inalteradas: seguinte.payload?.recibo.projecao?.inalteradas ?? 'sem recibo: nada mudou',
      versao: (await item('da-base.md'))!.versao,
      // O que esta execução tem na casa além da nota da base e da nota comum da tela: os
      // três pedidos com chave ou origem reservada (x.md, y e z.md) não gravaram nada, em
      // caixa nenhuma. Sobra de outra execução não é desta tela e não entra na conta.
      criadosPelaTela: await admin.contextItem.count({
        where: { orgId: CASA, chave: daExecucao, NOT: { chave: { in: [`vault:${MARCA}/da-base.md`, `${MARCA}/da-tela`] } } },
      }),
    }).toEqual({ inalteradas: 'sem recibo: nada mudou', versao: 1, criadosPelaTela: 0 });

    const comum = {
      alterar: await comoPessoa(() => rota.alterar(quem, daTela.id, { body: 'nota digitada e corrigida' })),
      arquivar: await comoPessoa(() => rota.arquivar(quem, daTela.id, {})),
      restaurar: await comoPessoa(() => rota.restaurar(quem, daTela.id, {})),
    };
    expect(comum).toEqual({ alterar: 'passou', arquivar: 'passou', restaurar: 'passou' });
  }, TEMPO);

  // -------------------------------------------------------------------------
  // E-20.7 — a sonda e o verbo para a cliente e para a casa (C19-06, regra 5)
  // -------------------------------------------------------------------------

  it('E-20.7: cliente ouve "a vault é da empresa da casa" (nem não configurado, nem erro) e não ganha recibo; casa como hoje', async () => {
    criarVault({ 'a.md': nota('a') });
    const { svc, contrato } = montar();
    await volta(svc);
    const integracoes = new IntegrationsService(
      servico as never,
      { log: async () => undefined } as never,
      { exigirLigado: async () => undefined, desligados: async () => new Map() } as never,
      new ConectoresConfiguradosRegistry(),
      contrato,
    );
    const sonda = (orgId: string) =>
      naEmpresa(orgId, () => contrato.sondar({ orgId, chave: 'obsidian', prazoMs: 4_000, semMemoria: true }));
    const verbo = (orgId: string) =>
      naEmpresa(orgId, () => integracoes.sincronizar(orgId, 'obsidian', pessoa, ['obsidian.editar', 'admin.usuarios']), undefined, pessoa).then(
        (r) => (r as { tipo: string }).tipo,
        (e: { getStatus?: () => number }) => e.getStatus?.(),
      );
    const cliente = await sonda(B);
    const casa = await sonda(CASA);
    expect({
      cliente: [cliente.estado, cliente.mensagem],
      casa: casa.estado,
      verboCliente: await verbo(B),
      verboCasa: await verbo(CASA),
      recibosDaCliente: await admin.eventLog.count({ where: { orgId: B, tipo: TIPO_DO_RECIBO } }),
      contaDaCliente: await admin.integrationAccount.count({ where: { orgId: B, key: 'obsidian' } }),
    }).toEqual({
      cliente: ['nao_verificado', 'A vault é da empresa da casa; a base de conhecimento desta empresa vem do onboarding e das notas da tela.'],
      casa: 'conectado',
      verboCliente: 403,
      verboCasa: 'feito',
      recibosDaCliente: 0,
      contaDaCliente: 0,
    });
  }, TEMPO);

  // -------------------------------------------------------------------------
  // E-20.8 — NFC no banco (C19-02, R-1)
  // -------------------------------------------------------------------------

  it('E-20.8: chave viva em NFC fica intacta com o arquivo em NFD; colisão entre membros não altera nem arquiva o item', async () => {
    const NFC = `${MARCA}/Decisões/aprovação.md`.normalize('NFC');
    const NFD = NFC.normalize('NFD');
    const texto = nota('aprovação', { kind: 'decisao', de: '2026-09-15' });
    const lida = lerNotaDaVault(NFC, texto);
    // O item como a projeção de antes o deixou, com a chave já em NFC.
    await naEmpresa(CASA, () =>
      memoria.projetarDaVault(CASA, [{ caminho: NFC, title: lida.title, body: lida.content, tags: lida.tags, cabecalho: { kind: lida.cabecalho.kind, validFrom: lida.cabecalho.validFrom, validUntil: lida.cabecalho.validUntil, substitui: null } }]),
    );
    const antes = (await admin.contextItem.findFirst({ where: { orgId: CASA, chave: `vault:${NFC}` } }))!;

    const raiz = mkdtempSync(path.join(os.tmpdir(), 'r20-nfd-'));
    pastas.push(raiz);
    mkdirSync(path.dirname(path.join(raiz, NFD)), { recursive: true });
    writeFileSync(path.join(raiz, NFD), texto);
    versionarVault(raiz);
    process.env.OBSIDIAN_VAULT_PATH = raiz;
    const { svc } = montar();
    const r = await volta(svc);
    const depois = await admin.contextItem.findMany({ where: { orgId: CASA, chave: { startsWith: `vault:${MARCA}` } } });
    expect({
      volta: r.r,
      itens: depois.map((i) => [i.id === antes.id, i.chave === `vault:${NFC}`, i.versao, Boolean(i.arquivadoEm)]),
      indice: (await indice()).map((n) => n.path === NFC),
    }).toEqual({ volta: { ok: 1 }, itens: [[true, true, 1, false]], indice: [true] });

    // Dois membros que viram a mesma chave: a pertença os tira e põe a chave nos vistos.
    const blob = git(raiz, 'rev-parse', `HEAD:${NFD}`).trim();
    git(raiz, 'update-index', '--add', '--cacheinfo', `100644,${blob},${NFC}`);
    const ix = lerIndiceDoGit(readFileSync(path.join(raiz, '.git', 'index')));
    const bytes = Buffer.from(texto);
    const pertenca = classificarAVault({
      arquivos: [NFC, NFD].map((c) => ({ caminho: Buffer.from(c), bytes, modificadoEm: new Date() })),
      indice: ix.ok ? ix.entradas : null,
      naoVerificavel: null,
    });
    expect({ membros: pertenca.membros.length, vistos: pertenca.vistos }).toEqual({ membros: 0, vistos: [NFC] });
    const resumo = await naEmpresa(CASA, () => memoria.projetarDaVault(CASA, [], { vistos: pertenca.vistos }));
    const intacto = (await admin.contextItem.findFirst({ where: { id: antes.id } }))!;
    expect({ arquivadas: resumo.arquivadas, versao: intacto.versao, arquivado: Boolean(intacto.arquivadoEm) }).toEqual({
      arquivadas: 0,
      versao: 1,
      arquivado: false,
    });
  }, TEMPO);

  // -------------------------------------------------------------------------
  // E-20.10 — espaço de nomes do índice (C19-06, regra 7)
  // -------------------------------------------------------------------------

  it('E-20.10: reindexar apaga só caminhos da vault; o espelho do onboarding fica; onboarding/ na base fica fora', async () => {
    await admin.knowledgeNote.create({
      data: {
        orgId: CASA, path: `onboarding/${MARCA}-tema.md`, folder: 'onboarding', title: 'Tema da carga', tags: [],
        content: 'ritual de fechamento da casa', links: [], wordCount: 5, fileTime: new Date('2026-09-30T12:00:00Z'),
      },
    });
    criarVault({ 'a.md': nota('a') }, { [`onboarding/${MARCA}-da-base.md`]: corpo('pasta com o nome reservado') });
    const { svc } = montar();
    const r = await volta(svc);
    expect({
      volta: r.r,
      espelho: (await admin.knowledgeNote.findFirst({ where: { orgId: CASA, path: `onboarding/${MARCA}-tema.md` } }))?.content,
      daBaseNoIndice: await admin.knowledgeNote.count({ where: { orgId: CASA, path: `onboarding/${MARCA}-da-base.md` } }),
      foraDaColecao: r.payload?.recibo.descoberta.pastasForaDaColecao,
      espelhoPreservado: r.payload?.recibo.indexacao.espelhoDoOnboardingPreservado,
    }).toEqual({
      volta: { ok: 1 },
      espelho: 'ritual de fechamento da casa',
      daBaseNoIndice: 0,
      foraDaColecao: { onboarding: 1 },
      espelhoPreservado: expect.any(Number),
    });
    expect(r.payload?.recibo.indexacao.espelhoDoOnboardingPreservado).toBeGreaterThanOrEqual(1);
  }, TEMPO);

  // -------------------------------------------------------------------------
  // O recibo e o frescor (C19-08, R-9)
  // -------------------------------------------------------------------------

  it('R-9: o frescor de toda volta vai a IntegrationHealth — `lastSyncAt` só com `ok`; recibo só quando muda, na mesma correlação da memória', async () => {
    const v = criarVault({ 'a.md': nota('a') });
    const { svc } = montar();
    const primeira = await volta(svc);
    const saude = () =>
      admin.integrationHealth.findFirst({ where: { account: { orgId: CASA, key: 'obsidian' } }, select: { status: true, lastSyncAt: true, lastError: true, checkedAt: true } });
    const ok = (await saude())!;
    const eventosDaMemoria = await admin.eventLog.findMany({ where: { orgId: CASA, correlationId: primeira.correlacao }, select: { tipo: true } });
    expect({
      recibo: Boolean(primeira.recibo),
      resultado: primeira.payload?.resultado,
      saude: [ok.status, Boolean(ok.lastSyncAt), ok.lastError],
      tipos: [...new Set(eventosDaMemoria.map((e) => e.tipo))].sort(),
    }).toEqual({
      recibo: true,
      resultado: 'ok',
      saude: ['ok', true, null],
      tipos: ['memoria.item.criado', TIPO_DO_RECIBO],
    });

    const quieta = await volta(svc);
    const depoisDaQuieta = (await saude())!;
    expect({ recibo: quieta.recibo, lastSyncAndou: depoisDaQuieta.lastSyncAt! > ok.lastSyncAt!, checou: depoisDaQuieta.checkedAt >= ok.checkedAt }).toEqual({
      recibo: null,
      lastSyncAndou: true,
      checou: true,
    });

    v.escrever('a.md', `${nota('a')}\nmexida fora do git`);
    const parcial = await volta(svc);
    const degradada = (await saude())!;
    expect({
      resultado: parcial.payload?.resultado,
      saude: [degradada.status, degradada.lastSyncAt?.getTime() === depoisDaQuieta.lastSyncAt?.getTime(), degradada.lastError],
    }).toEqual({
      resultado: 'parcial',
      saude: ['degraded', true, expect.stringMatching(/volta da vault: parcial .* alterado\(s\) na VPS fora do git/)],
    });
  }, TEMPO);

  it('R-9: projeção que falha não derruba a volta, e o recibo diz `falhou` — ele sai de um `finally`', async () => {
    criarVault({ 'a.md': nota('a') });
    const { svc } = montar();
    vi.spyOn(memoria, 'projetarDaVault').mockRejectedValueOnce(new Error('banco recusou no meio da projeção'));
    const r = await volta(svc);
    expect({ volta: r.r, resultado: r.payload?.resultado, motivos: r.payload?.motivos }).toEqual({
      volta: { ok: 1 },
      resultado: 'falhou',
      motivos: ['a projeção na memória falhou: banco recusou no meio da projeção'],
    });
  }, TEMPO);

  it('C19-03: rastreamento não verificável não cria, não altera e não arquiva — índice e memória ficam como a última volta boa', async () => {
    const v = criarVault({ 'a.md': nota('a'), 'b.md': nota('b') });
    const { svc } = montar();
    await volta(svc);
    const antes = { indice: (await indice()).map((n) => n.path), itens: (await itens()).map((i) => [i.chave, i.versao, i.arquivadoEm]) };
    git(v.raiz, 'config', 'core.autocrlf', 'true');
    v.escrever('c.md', nota('c'));
    v.apagar('b.md');
    v.commit();
    const r = await volta(svc);
    expect({
      volta: r.r,
      depois: { indice: (await indice()).map((n) => n.path), itens: (await itens()).map((i) => [i.chave, i.versao, i.arquivadoEm]) },
      resultado: r.payload?.resultado,
      saude: (await admin.integrationHealth.findFirst({ where: { account: { orgId: CASA, key: 'obsidian' } } }))?.status,
    }).toEqual({
      volta: { erro: expect.stringMatching(/rastreamento não verificável.*core\.autocrlf=true.*Nada foi criado/), status: 503 },
      depois: antes,
      resultado: 'falhou',
      saude: 'down',
    });
  }, TEMPO);
}

describe.skipIf(!URL)('ROOT-20: a coleção vault: contra o Postgres (conexão dona)', () => casosContraOBanco(false));
if (URL && URL_TENANT && RLS) {
  describe('ROOT-20: os mesmos casos sob RLS (mktos_app, TENANT_MODO=impor)', () => casosContraOBanco(true));
}
