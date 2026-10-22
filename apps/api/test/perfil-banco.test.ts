import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

import { exigirBancoDescartavel } from './banco-de-teste';
import { AuditService } from '../src/audit/audit.service';
import { comContexto } from '../src/common/contexto-execucao';
import { EquipeService } from '../src/agents/equipe.service';
import { PerfilService } from '../src/perfil/perfil.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { jpegDe, notasDoDuble, pngDe } from './perfil-dubles';

/*
 * O PERFIL E A EQUIPE CONTRA UM BANCO DE VERDADE (produção 22B, I6).
 *
 *  · a pessoa edita o próprio perfil; o de outra só com `admin.usuarios`
 *    (relido no banco); conta de máquina não edita; outra aba no meio = 409;
 *  · a auditoria leva os campos, sem a data de nascimento nem o telefone;
 *  · a foto: guardada no banco, trocar e tirar NÃO apagam (a anterior ganha
 *    `substituidaEm`), a auditoria não leva o conteúdo, e outra empresa não
 *    alcança a foto;
 *  · quem vê o perfil de outra pessoa não vê a data com o ano nem o telefone;
 *  · a lista de avatares (o responsável em qualquer tela) e a Equipe com a
 *    foto, o aniversário e as atribuições do vault-dublê; sem vault, "memória
 *    da Root indisponível".
 */

const URL = process.env.TEST_DATABASE_URL ?? '';
exigirBancoDescartavel(URL, 'cria e apaga empresas, pessoas, fotos e notas do vault de teste');

const A = `i6-perfil-${randomUUID().slice(0, 8)}`;
const B = `i6-perfil-b-${randomUUID().slice(0, 8)}`;
const id = (s: string) => `${A}-${s}`;
const ALICE = id('alice');
const BRUNO = id('bruno');
const CLARA = id('clara');
const ROBO = id('robo');
const DE_B = `${B}-alguem`;

describe.skipIf(!URL)('o perfil e a Equipe, com banco', () => {
  let prisma: PrismaClient;
  let perfil: PerfilService;
  let equipe: EquipeService;
  const comoGente = <T>(org: string, quem: string, fn: () => Promise<T>) =>
    comContexto({ orgId: org, correlationId: `i6-${randomUUID()}`, origem: 'http', actorType: 'user', actorId: quem }, fn);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const db = prisma as unknown as PrismaService;
    perfil = new PerfilService(db, new AuditService(db));
    equipe = new EquipeService(db, new AuditService(db));

    const perms = ['dashboard.ver', 'admin.usuarios', 'obsidian.ver'];
    for (const key of perms) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const conecta = (ks: string[]) => ({ connect: ks.map((key) => ({ key })) });
    for (const org of [A, B]) {
      await prisma.org.create({ data: { id: org, name: `Empresa ${org}`, slug: org, modulos: [] } });
      await prisma.role.create({ data: { orgId: org, key: 'admin_master', name: 'Admin', permissions: conecta(perms) } });
      await prisma.role.create({ data: { orgId: org, key: 'diretor', name: 'Diretor', permissions: conecta(['dashboard.ver', 'obsidian.ver']) } });
      await prisma.role.create({ data: { orgId: org, key: 'ia_acao', name: 'IA', permissions: conecta(['dashboard.ver', 'admin.usuarios']) } });
    }
    const papel = async (org: string, key: string) =>
      (await prisma.role.findUniqueOrThrow({ where: { orgId_key: { orgId: org, key } }, select: { id: true } })).id;
    const gente: [string, string, string, string][] = [
      [ALICE, A, 'Alice Exemplo', 'admin_master'],
      [BRUNO, A, 'Bruno Exemplo', 'diretor'],
      [CLARA, A, 'Clara Exemplo', 'diretor'],
      [ROBO, A, 'Robô de ação', 'ia_acao'],
      [DE_B, B, 'Alguém de Outra', 'admin_master'],
    ];
    for (const [uid, org, name, key] of gente) {
      await prisma.user.create({
        data: { id: uid, orgId: org, name, email: `${uid}@root.local`, passwordHash: 'x', roles: { connect: [{ id: await papel(org, key) }] } },
      });
    }
  }, 60_000);

  afterAll(async () => {
    const orgs = { in: [A, B] };
    await prisma.fotoDePerfil.deleteMany({ where: { orgId: orgs } });
    await prisma.knowledgeNote.deleteMany({ where: { orgId: orgs } });
    await prisma.auditLog.deleteMany({ where: { orgId: orgs } });
    await prisma.user.deleteMany({ where: { orgId: orgs } });
    await prisma.role.deleteMany({ where: { orgId: orgs } });
    await prisma.org.deleteMany({ where: { id: orgs } });
    await prisma.$disconnect();
  }, 60_000);

  const versao = async (uid: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: uid }, select: { perfilAtualizadoEm: true } })).perfilAtualizadoEm.toISOString();

  describe('editar', () => {
    it('a própria pessoa edita o seu perfil; a auditoria não leva a data de nascimento nem o telefone', async () => {
      const r = await perfil.alterar(A, BRUNO, BRUNO, {
        esperado: await versao(BRUNO),
        cargo: 'Sócio de produto',
        cidade: 'Cidade Fictícia',
        fuso: 'America/Sao_Paulo',
        dataNascimento: '1990-10-22',
        telefone: '+55 32 99999-0000',
        apelido: 'Bru',
      });
      expect(r).toMatchObject({ cargo: 'Sócio de produto', aniversario: '10-22', dataNascimento: '1990-10-22', proprio: true, podeEditar: true });
      const log = await prisma.auditLog.findFirstOrThrow({ where: { orgId: A, action: 'perfil.alterado', entityId: BRUNO } });
      const texto = JSON.stringify(log);
      expect(texto).not.toContain('1990');
      expect(texto).not.toContain('99999');
      expect((log.after as Record<string, unknown>).dataNascimento).toBe('definida');
      expect((log.after as Record<string, unknown>).cargo).toBe('Sócio de produto');
    });

    it('o perfil de outra pessoa: sem admin.usuarios é 403; com, passa (relido no banco)', async () => {
      await expect(perfil.alterar(A, CLARA, BRUNO, { esperado: await versao(BRUNO), cargo: 'invasão' })).rejects.toBeInstanceOf(ForbiddenException);
      const r = await perfil.alterar(A, ALICE, BRUNO, { esperado: await versao(BRUNO), nomeNoVault: 'Bruno' });
      expect(r).toMatchObject({ nomeNoVault: 'Bruno', proprio: false, podeEditar: true });
    });

    it('conta de máquina não edita, mesmo com admin.usuarios no papel', async () => {
      await expect(perfil.alterar(A, ROBO, BRUNO, { esperado: await versao(BRUNO), cargo: 'robô' })).rejects.toThrow(/máquina/);
    });

    it('outra aba no meio: 409', async () => {
      await expect(perfil.alterar(A, BRUNO, BRUNO, { esperado: '2000-01-01T00:00:00.000Z', cargo: 'velho' })).rejects.toThrow(/mudou/);
    });

    it('quem vê o perfil de outra pessoa não vê a data com o ano nem o telefone; o aniversário (dia e mês) sim', async () => {
      const visto = await perfil.ver(A, CLARA, BRUNO);
      expect(visto).toMatchObject({ aniversario: '10-22', dataNascimento: null, telefone: null, podeEditar: false });
      const peloAdmin = await perfil.ver(A, ALICE, BRUNO);
      expect(peloAdmin.dataNascimento).toBe('1990-10-22');
    });

    it('outra empresa não acha a pessoa', async () => {
      await expect(perfil.ver(B, DE_B, BRUNO)).rejects.toThrow(/não encontrada/);
    });
  });

  describe('a foto', () => {
    it('enviar guarda no banco; trocar e tirar não apagam; a auditoria não leva o conteúdo', async () => {
      const primeira = pngDe(256, 256, 64);
      const r1 = await perfil.enviarFoto(A, CLARA, CLARA, { buffer: primeira, mimetype: 'image/png', size: primeira.length });
      expect(r1.foto).toMatchObject({ tipo: 'png', largura: 256, altura: 256, url: expect.stringMatching(new RegExp(`^/perfil/${CLARA}/foto\\?v=`)) });

      const segunda = jpegDe(200, 200);
      const r2 = await perfil.enviarFoto(A, CLARA, CLARA, { buffer: segunda, mimetype: 'image/jpeg', size: segunda.length });
      expect(r2.foto?.tipo).toBe('jpeg');
      expect(r2.foto?.url).not.toBe(r1.foto?.url);

      const servida = await perfil.foto(A, CLARA);
      expect(servida.tipo).toBe('jpeg');
      expect(Buffer.compare(servida.conteudo, segunda)).toBe(0);

      const r3 = await perfil.tirarFoto(A, CLARA, CLARA);
      expect(r3.foto).toBeNull();
      const linhas = await prisma.fotoDePerfil.findMany({ where: { orgId: A, userId: CLARA } });
      expect(linhas).toHaveLength(2);
      expect(linhas.every((l) => l.substituidaEm !== null)).toBe(true);
      await expect(perfil.foto(A, CLARA)).rejects.toThrow(/Sem foto/);

      const logs = await prisma.auditLog.findMany({ where: { orgId: A, entityId: CLARA, action: { startsWith: 'perfil.foto' } } });
      expect(logs.map((l) => l.action).sort()).toEqual(['perfil.foto.enviada', 'perfil.foto.enviada', 'perfil.foto.retirada']);
      expect(JSON.stringify(logs)).not.toContain(segunda.toString('base64').slice(0, 16));
    });

    it('SVG e imagem grande são recusados antes de gravar', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      await expect(perfil.enviarFoto(A, CLARA, CLARA, { buffer: svg, mimetype: 'image/svg+xml', size: svg.length })).rejects.toThrow(/SVG/);
      const grande = pngDe(2000, 2000);
      await expect(perfil.enviarFoto(A, CLARA, CLARA, { buffer: grande, mimetype: 'image/png', size: grande.length })).rejects.toThrow(/512/);
    });

    it('a foto de outra pessoa: só com admin.usuarios; a de outra empresa não é alcançada', async () => {
      const b = pngDe(128, 128);
      await expect(perfil.enviarFoto(A, CLARA, BRUNO, { buffer: b, mimetype: 'image/png', size: b.length })).rejects.toBeInstanceOf(ForbiddenException);
      await perfil.enviarFoto(A, ALICE, BRUNO, { buffer: b, mimetype: 'image/png', size: b.length });
      await expect(perfil.foto(B, BRUNO)).rejects.toThrow(/Sem foto/);
      expect((await perfil.foto(A, BRUNO)).tipo).toBe('png');
    });
  });

  describe('os avatares e a Equipe', () => {
    it('a lista de avatares traz a rota da foto e o aniversário, sem conta de máquina', async () => {
      const r = await perfil.avatares(A);
      expect(r.pessoas.map((p) => p.id).sort()).toEqual([ALICE, BRUNO, CLARA].sort());
      const bruno = r.pessoas.find((p) => p.id === BRUNO)!;
      expect(bruno).toMatchObject({ aniversario: '10-22', cargo: 'Sócio de produto', fotoUrl: expect.stringContaining(`/perfil/${BRUNO}/foto?v=`) });
      expect(r.pessoas.find((p) => p.id === CLARA)!.fotoUrl).toBeNull();
    });

    it('sem o vault no índice: "memória da Root indisponível", e a Equipe segue com foto e aniversário', async () => {
      const e = await comoGente(A, ALICE, () => equipe.equipe(A, ALICE));
      expect(e.memoria).toMatchObject({ disponivel: false, motivo: 'ausente', frase: expect.stringContaining('Memória da Root indisponível') });
      const bruno = e.pessoas.find((p) => p.id === BRUNO)!;
      expect(bruno).toMatchObject({ aniversario: '10-22', cargo: 'Sócio de produto', fotoUrl: expect.any(String) });
      expect(bruno.atribuicoes).toMatchObject({ nomeNoVault: 'Bruno', origemDoNome: 'perfil', dona: [] });
    });

    it('sem contexto de pessoa (fora de uma requisição), a leitura é recusada como sem permissão', async () => {
      const e = await equipe.equipe(A, ALICE);
      expect(e.memoria.motivo).toBe('sem_permissao');
    });

    it('com o vault-dublê no índice: o que cada um conduz, é dono e é substituto; nome do perfil ou sugerido', async () => {
      for (const n of notasDoDuble()) {
        await prisma.knowledgeNote.create({
          data: { orgId: A, path: n.caminho, folder: n.caminho.split('/')[0], title: n.caminho, content: n.conteudo, fileTime: new Date() },
        });
      }
      const e = await comoGente(A, ALICE, () => equipe.equipe(A, ALICE));
      expect(e.memoria).toMatchObject({ disponivel: true, motivo: null });
      expect(e.memoria.socios.sort()).toEqual(['Alice', 'Bruno', 'Clara']);

      const bruno = e.pessoas.find((p) => p.id === BRUNO)!.atribuicoes;
      expect(bruno).toMatchObject({ nomeNoVault: 'Bruno', origemDoNome: 'perfil', conduz: 'Produto e tecnologia' });
      expect(bruno.dona.map((f) => f.nome)).toEqual(['Conteúdo', 'Governança', 'Produto']);
      expect(bruno.substituta.map((f) => f.nome)).toEqual(['Comercial', 'Financeiro']);

      // Alice e Clara não preencheram: sugeridos pelo primeiro nome.
      const alice = e.pessoas.find((p) => p.id === ALICE)!.atribuicoes;
      expect(alice).toMatchObject({ nomeNoVault: 'Alice', origemDoNome: 'sugerido', conduz: 'Comercial e relacionamento' });
    });

    it('sem obsidian.ver, a Equipe não lê o vault', async () => {
      await prisma.role.create({ data: { orgId: A, key: 'leitor', name: 'Leitor', permissions: { connect: [{ key: 'dashboard.ver' }] } } });
      const leitor = id('leitor');
      await prisma.user.create({
        data: { id: leitor, orgId: A, name: 'Leitor Exemplo', email: `${leitor}@root.local`, passwordHash: 'x', roles: { connect: [{ orgId_key: { orgId: A, key: 'leitor' } }] } },
      });
      const e = await comoGente(A, leitor, () => equipe.equipe(A, leitor));
      expect(e.memoria.motivo).toBe('sem_permissao');
      expect(e.pessoas.every((p) => p.atribuicoes.dona.length === 0)).toBe(true);
    });
  });
});
