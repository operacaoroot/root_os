import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TOTEM_GESTAO_AVISO_PRECO_DESLIGADO, totemNormalizarCodigo } from '@mktos/shared';

import type { UsuarioDoEscopo } from '../src/totem/comum/escopo';
import { TOTEM_NAO_ENCONTRADO } from '../src/totem/comum/modulo';
import { hashToken } from '../src/totem/comum/segredos';
import {
  totemGestaoCriarDispositivo,
  totemGestaoListarDispositivos,
  totemGestaoNovoCodigo,
  totemGestaoRenomearDispositivo,
  totemGestaoRevogarDispositivo,
} from '../src/totem/gestao/dispositivos';
import { totemGestaoListarEventos } from '../src/totem/gestao/eventos';
import {
  totemGestaoCriarLoja,
  totemGestaoEditarLoja,
  totemGestaoListarLojas,
  totemGestaoListarUsuarios,
  totemGestaoVincularLoja,
} from '../src/totem/gestao/lojas';
import {
  totemGestaoCriarProduto,
  totemGestaoEditarProduto,
  totemGestaoListarProdutos,
  totemGestaoObterConfig,
  totemGestaoObterProduto,
  totemGestaoSalvarConfig,
} from '../src/totem/gestao/produtos';
import { totemGestaoCarregarResumo } from '../src/totem/gestao/resumo';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O PAINEL DO TOTEM CONTRA O POSTGRES — escopo de loja e código de ativação.
 *
 * As funções recebem o client por parâmetro, então o teste passa um
 * `PrismaClient` cru, sem Nest. Roda em paralelo com as outras suítes no mesmo
 * banco: cria duas empresas com marca própria, nunca conta linha sem `where` e
 * apaga só o que criou.
 */

const URL = process.env.TEST_DATABASE_URL;
const MARCA = randomUUID().slice(0, 8);
const AGORA = new Date('2026-10-11T15:00:00.000Z');
const semLotes = async () => new Map();

async function esperar404(promessa: Promise<unknown>): Promise<void> {
  const erro = await promessa.then(
    () => null,
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(NotFoundException);
  expect((erro as NotFoundException).message).toBe(TOTEM_NAO_ENCONTRADO);
}

describe.skipIf(!URL)('painel do totem com banco', () => {
  let prisma: PrismaClient;
  let orgA: string;
  let orgB: string;
  let loja1: string;
  let loja2: string;
  let lojaDeB: string;
  let gerente: UsuarioDoEscopo;
  let rede: UsuarioDoEscopo;
  let redeDeB: UsuarioDoEscopo;
  let totemDaLoja2: string;

  beforeAll(async () => {
    exigirBancoDescartavel(URL!, 'do painel do totem cria e apaga as próprias empresas');
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();

    const a = await prisma.org.create({
      data: { name: `Painel A ${MARCA}`, slug: `painel-a-${MARCA}`, modulos: ['totem'] },
    });
    const b = await prisma.org.create({
      data: { name: `Painel B ${MARCA}`, slug: `painel-b-${MARCA}`, modulos: ['totem'] },
    });
    orgA = a.id;
    orgB = b.id;

    const novaLoja = (orgId: string, codigo: string, nome: string) =>
      prisma.totemLoja.create({ data: { orgId, codigo, nome } });
    loja1 = (await novaLoja(orgA, 'L1', 'Loja 1')).id;
    loja2 = (await novaLoja(orgA, 'L2', 'Loja 2')).id;
    lojaDeB = (await novaLoja(orgB, 'L1', 'Loja da outra empresa')).id;

    const novoUsuario = (orgId: string, nome: string) =>
      prisma.user.create({
        data: { orgId, name: nome, email: `${nome}-${MARCA}@teste.invalid`, passwordHash: 'nao-usado' },
      });
    const g = await novoUsuario(orgA, 'gerente');
    const r = await novoUsuario(orgA, 'rede');
    const rb = await novoUsuario(orgB, 'rede-b');
    await prisma.totemUsuarioLoja.create({ data: { orgId: orgA, userId: g.id, lojaId: loja1 } });

    gerente = { sub: g.id, orgId: orgA, permissions: ['totem.ver', 'totem.dispositivos', 'totem.lojas'] };
    rede = { sub: r.id, orgId: orgA, permissions: ['totem.ver', 'totem.dispositivos', 'totem.lojas', 'totem.rede'] };
    redeDeB = { sub: rb.id, orgId: orgB, permissions: ['totem.ver', 'totem.dispositivos', 'totem.rede'] };

    totemDaLoja2 = (await totemGestaoCriarDispositivo(prisma, rede, { lojaId: loja2, nome: 'Totem da loja 2' }, AGORA))
      .dispositivo.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    const orgs = { orgId: { in: [orgA, orgB].filter(Boolean) } };
    await prisma.totemDispositivo.deleteMany({ where: orgs });
    await prisma.totemUsuarioLoja.deleteMany({ where: orgs });
    await prisma.totemProduto.deleteMany({ where: orgs });
    await prisma.totemConfig.deleteMany({ where: orgs });
    await prisma.totemLoja.deleteMany({ where: orgs });
    await prisma.user.deleteMany({ where: orgs });
    await prisma.org.deleteMany({ where: { id: { in: [orgA, orgB].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  describe('escopo de loja', () => {
    it('o gerente da loja 1 só vê a loja 1; quem tem a rede vê as duas', async () => {
      expect((await totemGestaoListarLojas(prisma, gerente, 'todas')).map((l) => l.id)).toEqual([loja1]);
      expect((await totemGestaoListarLojas(prisma, rede, 'todas')).map((l) => l.id).sort()).toEqual(
        [loja1, loja2].sort(),
      );
    });

    it('o gerente da loja 1 recebe 404 ao editar a loja 2', async () => {
      await esperar404(totemGestaoEditarLoja(prisma, gerente, loja2, { nome: 'Invadida' }));
      expect((await prisma.totemLoja.findUnique({ where: { id: loja2 } }))!.nome).toBe('Loja 2');
    });

    it('o gerente da loja 1 recebe 404 em tudo que é totem da loja 2', async () => {
      await esperar404(totemGestaoListarDispositivos(prisma, gerente, loja2, AGORA));
      await esperar404(totemGestaoCriarDispositivo(prisma, gerente, { lojaId: loja2, nome: 'Intruso' }, AGORA));
      await esperar404(totemGestaoNovoCodigo(prisma, gerente, totemDaLoja2, AGORA));
      await esperar404(totemGestaoRenomearDispositivo(prisma, gerente, totemDaLoja2, 'Outro nome', AGORA));
      await esperar404(totemGestaoRevogarDispositivo(prisma, gerente, totemDaLoja2, AGORA));
      const intacto = await prisma.totemDispositivo.findUnique({ where: { id: totemDaLoja2 } });
      expect(intacto).toMatchObject({ nome: 'Totem da loja 2', revogadoEm: null });
    });

    it('a lista de totens sem filtro não mostra o da loja 2 ao gerente', async () => {
      const ids = (await totemGestaoListarDispositivos(prisma, gerente, undefined, AGORA)).map((d) => d.id);
      expect(ids).not.toContain(totemDaLoja2);
    });

    it('o gerente da loja 1 recebe 404 no resumo e nos eventos filtrados pela loja 2', async () => {
      await esperar404(totemGestaoCarregarResumo(prisma, gerente, loja2, AGORA, semLotes));
      await esperar404(totemGestaoListarEventos(prisma, gerente, { lojaId: loja2, pagina: 1, porPagina: 50 }));
    });

    it('o resumo do gerente soma só a loja dele, e o mapa de lotes vazio não quebra nada', async () => {
      const r = await totemGestaoCarregarResumo(prisma, gerente, undefined, AGORA, semLotes);
      expect(r.redeInteira).toBe(false);
      expect(r.lojasDoEscopo.map((l) => l.id)).toEqual([loja1]);
      expect(r.porLoja.map((l) => l.lojaId)).toEqual([loja1]);
      expect(r.total.lotesVencidos).toBe(0);
    });

    it('o resumo da rede vê as duas lojas e o totem aguardando ativação na loja 2', async () => {
      const r = await totemGestaoCarregarResumo(prisma, rede, undefined, AGORA, semLotes);
      expect(r.redeInteira).toBe(true);
      expect(r.porLoja.map((l) => l.lojaId).sort()).toEqual([loja1, loja2].sort());
      expect(r.porLoja.find((l) => l.lojaId === loja2)!.indicadores.totensAguardando).toBe(1);
    });

    it('vincular o gerente à loja 2 exige a loja no escopo de quem vincula', async () => {
      await esperar404(totemGestaoVincularLoja(prisma, gerente, gerente.sub, loja2));
      const usuarios = await totemGestaoListarUsuarios(prisma, gerente);
      const visto = usuarios.find((u) => u.id === gerente.sub)!;
      expect(visto.lojaIds).toEqual([loja1]);
    });

    it('gerente que cria loja fica vinculado a ela; código repetido é conflito', async () => {
      const nova = await prisma.$transaction((tx) =>
        totemGestaoCriarLoja(tx, gerente, { codigo: 'L3', nome: 'Loja 3' }),
      );
      expect((await totemGestaoListarLojas(prisma, gerente, 'todas')).map((l) => l.id)).toContain(nova.id);
      await expect(
        prisma.$transaction((tx) => totemGestaoCriarLoja(tx, gerente, { codigo: 'L3', nome: 'De novo' })),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('outra empresa', () => {
    it('a rede da empresa B não alcança loja, totem nem produto da empresa A', async () => {
      await esperar404(totemGestaoEditarLoja(prisma, redeDeB, loja1, { nome: 'X' }));
      await esperar404(totemGestaoNovoCodigo(prisma, redeDeB, totemDaLoja2, AGORA));
      const p = await totemGestaoCriarProduto(prisma, orgA, { codigo: `PA-${MARCA}`, nome: 'Produto de A' });
      await esperar404(totemGestaoObterProduto(prisma, orgB, p.produto.id));
      await esperar404(totemGestaoEditarProduto(prisma, orgB, p.produto.id, { nome: 'Tomado' }));
      expect((await totemGestaoListarLojas(prisma, redeDeB, 'todas')).map((l) => l.id)).toEqual([lojaDeB]);
    });
  });

  describe('código de ativação', () => {
    it('o banco guarda só o hash do código normalizado, com 30 minutos de validade', async () => {
      const r = await totemGestaoCriarDispositivo(prisma, gerente, { lojaId: loja1, nome: 'Totem da entrada' }, AGORA);
      expect(r.codigo).toMatch(/^[0-9A-Z]{8}$/);
      expect(r.expiraEm).toBe(new Date(AGORA.getTime() + 30 * 60_000).toISOString());
      expect(r.dispositivo.estado).toBe('aguardando_ativacao');
      expect(JSON.stringify(r.dispositivo)).not.toContain(r.codigo);

      const linha = await prisma.totemDispositivo.findUniqueOrThrow({ where: { id: r.dispositivo.id } });
      expect(linha.codigoAtivacaoHash).toBe(hashToken(totemNormalizarCodigo(r.codigo)));
      expect(linha.tokenHash).toBeNull();
      expect(Object.values(linha).map(String)).not.toContain(r.codigo);

      const lista = await totemGestaoListarDispositivos(prisma, gerente, loja1, AGORA);
      const daLista = lista.find((d) => d.id === r.dispositivo.id)!;
      expect(JSON.stringify(daLista)).not.toContain(linha.codigoAtivacaoHash!);
      expect(JSON.stringify(daLista)).not.toContain(r.codigo);
    });

    it('o código vence: depois de 30 minutos o totem aparece com código vencido', async () => {
      const r = await totemGestaoCriarDispositivo(prisma, gerente, { lojaId: loja1, nome: 'Totem do fundo' }, AGORA);
      const depois = new Date(AGORA.getTime() + 31 * 60_000);
      const visto = (await totemGestaoListarDispositivos(prisma, gerente, loja1, depois)).find(
        (d) => d.id === r.dispositivo.id,
      )!;
      expect(visto.estado).toBe('codigo_expirado');
      expect(visto.ativacaoExpiraEm).toBeNull();
    });

    it('gerar código novo troca o hash; revogar apaga os dois hashes e trava código novo', async () => {
      const r = await totemGestaoCriarDispositivo(prisma, gerente, { lojaId: loja1, nome: 'Totem do caixa' }, AGORA);
      const novo = await totemGestaoNovoCodigo(prisma, gerente, r.dispositivo.id, AGORA);
      expect(novo.codigo).not.toBe(r.codigo);
      const linha = await prisma.totemDispositivo.findUniqueOrThrow({ where: { id: r.dispositivo.id } });
      expect(linha.codigoAtivacaoHash).toBe(hashToken(totemNormalizarCodigo(novo.codigo)));

      await prisma.totemDispositivo.update({
        where: { id: r.dispositivo.id },
        data: { tokenHash: hashToken(`token-${MARCA}`), ativadoEm: AGORA },
      });
      const revogado = await totemGestaoRevogarDispositivo(prisma, gerente, r.dispositivo.id, AGORA);
      expect(revogado.estado).toBe('revogado');
      const depois = await prisma.totemDispositivo.findUniqueOrThrow({ where: { id: r.dispositivo.id } });
      expect(depois).toMatchObject({ tokenHash: null, codigoAtivacaoHash: null, ativacaoExpiraEm: null });
      await expect(totemGestaoNovoCodigo(prisma, gerente, r.dispositivo.id, AGORA)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('produtos e configuração', () => {
    it('nomeBusca nasce e muda com o nome; a busca acha por palavras em qualquer ordem', async () => {
      const criado = await totemGestaoCriarProduto(prisma, orgA, {
        codigo: `CP-${MARCA}`,
        nome: 'Castanha-do-Pará Torrada',
        precoCentavos: 8990,
        unidadePreco: 'kg',
      });
      expect(criado.produto.nomeBusca).toBe('castanha do para torrada');

      const achados = await totemGestaoListarProdutos(prisma, orgA, {
        busca: 'PARÁ castanha',
        situacao: 'todos',
        pagina: 1,
        porPagina: 25,
      });
      expect(achados.itens.map((p) => p.id)).toEqual([criado.produto.id]);

      const editado = await totemGestaoEditarProduto(prisma, orgA, criado.produto.id, { nome: 'Castanha de Caju' });
      expect(editado.produto.nomeBusca).toBe('castanha de caju');
      const linha = await prisma.totemProduto.findUniqueOrThrow({ where: { id: criado.produto.id } });
      expect(linha.nomeBusca).toBe('castanha de caju');
    });

    it('a fila do que falta: só os sem foto, ou só os sem tabela nutricional', async () => {
      const foto = `/api/totem-publico/midia/${orgA}/${'a'.repeat(32)}.webp`;
      const tabela = [{ nutriente: 'Sódio', quantidade: 12, unidade: 'mg' as const, vd: null }];
      const completo = await totemGestaoCriarProduto(prisma, orgA, { codigo: `FC-${MARCA}`, nome: `Fila ${MARCA} completo`, imagemUrl: foto, nutricional: tabela });
      const semFoto = await totemGestaoCriarProduto(prisma, orgA, { codigo: `FF-${MARCA}`, nome: `Fila ${MARCA} sem foto`, nutricional: tabela });
      const semTabela = await totemGestaoCriarProduto(prisma, orgA, { codigo: `FT-${MARCA}`, nome: `Fila ${MARCA} sem tabela`, imagemUrl: foto });
      const listar = (falta?: 'foto' | 'tabela') =>
        totemGestaoListarProdutos(prisma, orgA, { busca: `fila ${MARCA}`, situacao: 'todos', falta, pagina: 1, porPagina: 25 }).then((r) =>
          r.itens.map((p) => p.id).sort(),
        );
      expect(await listar()).toEqual([completo, semFoto, semTabela].map((c) => c.produto.id).sort());
      expect(await listar('foto')).toEqual([semFoto.produto.id]);
      expect(await listar('tabela')).toEqual([semTabela.produto.id]);
    });

    it('preço sem unidade é recusado e código repetido é conflito', async () => {
      await expect(
        totemGestaoCriarProduto(prisma, orgA, { codigo: `SU-${MARCA}`, nome: 'Sem unidade', precoCentavos: 100 }),
      ).rejects.toThrow(/unidade/);
      await totemGestaoCriarProduto(prisma, orgA, { codigo: `DP-${MARCA}`, nome: 'Primeiro' });
      await expect(
        totemGestaoCriarProduto(prisma, orgA, { codigo: `DP-${MARCA}`, nome: 'Segundo' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('sem configuração o preço está desligado e toda resposta de produto avisa; ligado, o aviso some', async () => {
      expect((await totemGestaoObterConfig(prisma, orgA)).existe).toBe(false);
      const antes = await totemGestaoListarProdutos(prisma, orgA, { situacao: 'todos', pagina: 1, porPagina: 5 });
      expect(antes.avisoPreco).toBe(TOTEM_GESTAO_AVISO_PRECO_DESLIGADO);

      const salva = await totemGestaoSalvarConfig(prisma, orgA, {
        nomeExibicao: 'Painel A',
        corPrimaria: '#28371D',
        corFundo: '#F5F3EC',
        precoLigado: true,
        cadastroLigado: false,
        tempoOciosoSeg: 90,
        controladorNome: 'Empresa A Ltda',
      });
      expect(salva).toMatchObject({ existe: true, precoLigado: true, tempoOciosoSeg: 90 });
      const depois = await totemGestaoListarProdutos(prisma, orgA, { situacao: 'todos', pagina: 1, porPagina: 5 });
      expect(depois).toMatchObject({ precoLigado: true, avisoPreco: null });
      expect((await totemGestaoObterConfig(prisma, orgB)).existe).toBe(false);
    });
  });
});
