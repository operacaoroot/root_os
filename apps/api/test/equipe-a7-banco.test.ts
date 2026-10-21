import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, SessionCanal } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { funcaoPorSlug } from '@mktos/shared';

import { exigirBancoDescartavel } from './banco-de-teste';
import { AuditService } from '../src/audit/audit.service';
import { comContexto } from '../src/common/contexto-execucao';
import { identidadeDoCanal } from '../src/gateway/canais/quem-decide';
import { GastoPorFuncaoService } from '../src/llm/gasto-por-funcao.service';
import { CadastroService } from '../src/agents/cadastro.service';
import { EquipeService } from '../src/agents/equipe.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * A EQUIPE E O CATÁLOGO CONTRA UM BANCO DE VERDADE (rodada dos agentes, 21/10/2026, A7).
 *
 *  · a Equipe mostra as três pessoas, e as contas do sistema e de teste ficam fora;
 *  · trocar o dono: só admin/controle, relido no banco, auditado de quem para quem,
 *    em `Agent.donoId` (com registro) ou em `DonoDaFuncao` (sem);
 *  · o WhatsApp de cada pessoa: cadastrar, duplicado recusado, o canal de aprovação
 *    reconhece, o número antigo fica inativo (nunca apagado);
 *  · o catálogo: última e próxima execução da rotina, gasto do mês, modelo efetivo,
 *    estado do banco por cima do declarado.
 */

const URL = process.env.TEST_DATABASE_URL ?? '';
exigirBancoDescartavel(URL, 'cria e apaga empresas, pessoas, agentes, rotinas e identidades de teste');

const A = `a7-eq-${randomUUID().slice(0, 8)}`;
const B = `a7-eq-b-${randomUUID().slice(0, 8)}`;
const id = (s: string) => `${A}-${s}`;
const ROD = id('rodrigo');
const LUC = id('lucas');
const PED = id('pedro');
const ADM = id('admin');
const MESA = id('mesa');
const DE_B = `${B}-alguem`;

describe.skipIf(!URL)('a Equipe e o catálogo, com banco', () => {
  let prisma: PrismaClient;
  let equipe: EquipeService;
  let cadastro: CadastroService;
  let gasto: GastoPorFuncaoService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const db = prisma as unknown as PrismaService;
    equipe = new EquipeService(db, new AuditService(db));
    gasto = new GastoPorFuncaoService(db);
    cadastro = new CadastroService(db, gasto);

    const perms = ['dashboard.ver', 'admin.usuarios', 'admin.permissoes', 'aprovacoes.decidir', 'mcp.ver'];
    for (const key of perms) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const conecta = (ks: string[]) => ({ connect: ks.map((key) => ({ key })) });

    for (const org of [A, B]) {
      await prisma.org.create({ data: { id: org, name: `Empresa ${org}`, slug: org, modulos: [] } });
      await prisma.role.create({ data: { orgId: org, key: 'admin_master', name: 'Admin Master', permissions: conecta(perms) } });
      await prisma.role.create({
        data: { orgId: org, key: 'diretor', name: 'Diretor', permissions: conecta(['dashboard.ver', 'aprovacoes.decidir', 'mcp.ver']) },
      });
    }
    const papel = async (org: string, key: string) =>
      (await prisma.role.findUniqueOrThrow({ where: { orgId_key: { orgId: org, key } }, select: { id: true } })).id;
    const gente: [string, string, string, string, string][] = [
      [ROD, A, 'Rodrigo Exemplo', 'rodrigo@root.local', 'admin_master'],
      [LUC, A, 'Lucas Exemplo', 'lucas@root.local', 'diretor'],
      [PED, A, 'Pedro Exemplo', 'pedro@root.local', 'diretor'],
      [ADM, A, 'Admin Root', `admin-${A}@marketing-os.local`, 'admin_master'],
      [MESA, A, 'Mesa (homologação)', `mesa-${A}@root.homolog`, 'diretor'],
      [DE_B, B, 'Lucas de Outra Empresa', `lucas-${B}@root.local`, 'diretor'],
    ];
    for (const [uid, org, name, email, key] of gente) {
      const emailUnico = email.includes(A) || email.includes(B) ? email : email.replace('@', `-${A}@`);
      await prisma.user.create({
        data: { id: uid, orgId: org, name, email: emailUnico, passwordHash: 'x', roles: { connect: [{ id: await papel(org, key) }] } },
      });
    }
    // O leitor de ata do onboarding (IM-01, padrão Pedro) com o ponteiro antigo na conta do sistema.
    await prisma.agent.create({ data: { orgId: A, slug: 'leitor-de-ata', nome: 'Leitor de ata', missao: 'ler', donoId: ADM, estado: 'ativo' } });
    // Um agente criado pela tela, fora do cadastro, de dono Lucas.
    await prisma.agent.create({ data: { orgId: A, slug: 'agente-da-tela', nome: 'Agente da tela', missao: 'ajudar', donoId: LUC, estado: 'ativo' } });
  }, 60_000);

  afterEach(() => {
    delete process.env.LLM_MODELO_CO_03;
  });

  afterAll(async () => {
    const orgs = { in: [A, B] };
    await prisma.rotinaExecucao.deleteMany({ where: { orgId: orgs } });
    await prisma.rotina.deleteMany({ where: { orgId: orgs } });
    await prisma.gastoDeIaPorFuncao.deleteMany({ where: { orgId: orgs } });
    await prisma.channelIdentity.deleteMany({ where: { orgId: orgs } });
    await prisma.lead.deleteMany({ where: { orgId: orgs } });
    await prisma.partner.deleteMany({ where: { orgId: orgs } });
    await prisma.donoDaFuncao.deleteMany({ where: { orgId: orgs } });
    await prisma.agent.deleteMany({ where: { orgId: orgs } });
    await prisma.auditLog.deleteMany({ where: { orgId: orgs } });
    await prisma.user.deleteMany({ where: { orgId: orgs } });
    await prisma.role.deleteMany({ where: { orgId: orgs } });
    await prisma.org.deleteMany({ where: { id: orgs } });
    await prisma.$disconnect();
  }, 60_000);

  // ---------------------------------------------------------------------------
  describe('quem aparece', () => {
    it('três pessoas; o admin da instalação e a mesa de homologação ficam fora, contados', async () => {
      const e = await equipe.equipe(A, ROD);
      expect(e.pessoas.map((p) => p.id).sort()).toEqual([LUC, PED, ROD].sort());
      expect(e.foraDaVista).toEqual({ sistema: 1, teste: 1 });
      expect(e.podeEditarDono).toBe(true);
    });

    it('sob cada pessoa, as funções de que ela é dona, por área; o ponteiro na conta do sistema cai no padrão', async () => {
      const e = await equipe.equipe(A, ROD);
      const pedro = e.pessoas.find((p) => p.id === PED)!;
      const leitor = pedro.areas.flatMap((a) => a.funcoes).find((f) => f.slug === 'leitor-de-ata')!;
      expect(leitor).toMatchObject({ guardadoEm: 'agente', dono: { origem: 'padrao', bancoForaDaEquipe: true } });
      expect(pedro.areas.map((a) => a.area)).toContain('Implantação');
      const lucas = e.pessoas.find((p) => p.id === LUC)!;
      expect(lucas.areas.map((a) => a.area)).toEqual(expect.arrayContaining(['Comercial', 'Fora do cadastro']));
      const rodrigo = e.pessoas.find((p) => p.id === ROD)!;
      expect(rodrigo.areas.map((a) => a.area)).toEqual(expect.arrayContaining(['Trabalho e pastas', 'Agenda']));
      // Aposentado não aparece na Equipe.
      const todas = e.pessoas.flatMap((p) => p.areas.flatMap((a) => a.funcoes));
      expect(todas.some((f) => f.estado === 'aposentado')).toBe(false);
      expect(e.totais.pessoas).toBe(3);
    });

    it('quem não administra gente não pode editar dono', async () => {
      const e = await equipe.equipe(A, LUC);
      expect(e.podeEditarDono).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  describe('trocar o dono', () => {
    it('quem não é admin nem controle é recusado (relido no banco)', async () => {
      await expect(equipe.trocarDono(A, LUC, 'follow-up', LUC)).rejects.toThrow(/admin\.usuarios ou admin\.permissoes/);
    });

    it('função com registro: vai a Agent.donoId e fica auditado de quem para quem', async () => {
      const r = await equipe.trocarDono(A, ROD, 'leitor-de-ata', LUC);
      expect(r).toMatchObject({ guardadoEm: 'agente', dono: { efetivo: { id: LUC }, origem: 'banco' } });
      const ag = await prisma.agent.findUniqueOrThrow({ where: { orgId_slug: { orgId: A, slug: 'leitor-de-ata' } } });
      expect(ag.donoId).toBe(LUC);
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { orgId: A, action: 'equipe.dono.trocado', entityId: 'leitor-de-ata' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log.actorId).toBe(ROD);
      expect(log.before).toMatchObject({ donoId: ADM, efetivo: { id: PED }, origem: 'padrao' });
      expect(log.after).toMatchObject({ donoId: LUC, efetivo: { id: LUC }, origem: 'banco' });
    });

    it('função sem registro: vai a DonoDaFuncao; null volta ao padrão sem apagar a linha', async () => {
      const followUp = funcaoPorSlug('follow-up')!;
      await equipe.trocarDono(A, ROD, 'follow-up', PED);
      let linha = await prisma.donoDaFuncao.findUniqueOrThrow({ where: { orgId_funcaoId: { orgId: A, funcaoId: followUp.id } } });
      expect(linha).toMatchObject({ userId: PED, definidoPorId: ROD });
      let e = await equipe.equipe(A, ROD);
      expect(e.pessoas.find((p) => p.id === PED)!.areas.flatMap((a) => a.funcoes).some((f) => f.slug === 'follow-up')).toBe(true);

      await equipe.trocarDono(A, ROD, 'follow-up', null);
      linha = await prisma.donoDaFuncao.findUniqueOrThrow({ where: { orgId_funcaoId: { orgId: A, funcaoId: followUp.id } } });
      expect(linha.userId).toBeNull();
      e = await equipe.equipe(A, ROD);
      const volta = e.pessoas.find((p) => p.id === LUC)!.areas.flatMap((a) => a.funcoes).find((f) => f.slug === 'follow-up');
      expect(volta?.dono.origem).toBe('padrao');
      const logs = await prisma.auditLog.count({ where: { orgId: A, action: 'equipe.dono.trocado', entityId: 'follow-up' } });
      expect(logs).toBe(2);
    });

    it('o destino tem de ser pessoa da Equipe: conta de teste e gente de outra empresa são recusadas', async () => {
      await expect(equipe.trocarDono(A, ROD, 'follow-up', MESA)).rejects.toThrow(/pessoa da Equipe/);
      await expect(equipe.trocarDono(A, ROD, 'follow-up', DE_B)).rejects.toThrow(/pessoa da Equipe/);
      await expect(equipe.trocarDono(A, ROD, 'nao-existe-em-lugar-nenhum', LUC)).rejects.toThrow(/não existe/);
    });

    it('a FK composta prende o dono à empresa no próprio banco', async () => {
      await expect(
        prisma.donoDaFuncao.create({ data: { orgId: A, funcaoId: 'CO-02', userId: DE_B, definidoPorId: ROD } }),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  describe('o WhatsApp de cada pessoa (CA-02)', () => {
    const reconhece = (chave: string) =>
      comContexto({ orgId: A, correlationId: 'teste-a7', origem: 'http' }, () =>
        identidadeDoCanal(prisma as never, A, chave),
      );

    it('a própria pessoa cadastra o seu, e o canal de aprovação passa a reconhecer', async () => {
      const r = await equipe.cadastrarWhatsapp(A, LUC, LUC, '+55 (32) 99999-0001');
      expect(r).toMatchObject({ cadastrado: true, final: '…0001', numero: '+55 (32) 99999-0001' });
      const quem = await reconhece('5532999990001');
      expect(quem?.userId).toBe(LUC);
      expect(quem?.decide).toBe(true);
      const log = await prisma.auditLog.findFirstOrThrow({ where: { orgId: A, action: 'equipe.whatsapp.cadastrado', entityId: LUC } });
      expect(JSON.stringify(log)).not.toContain('999990001');
      expect(log.after).toMatchObject({ final: '0001' });
    });

    it('o de outra pessoa só quem administra gente', async () => {
      await expect(equipe.cadastrarWhatsapp(A, PED, LUC, '32999990009')).rejects.toThrow(/administra gente/);
    });

    it('número de outra pessoa é recusado (409), e número torto também (400)', async () => {
      await expect(equipe.cadastrarWhatsapp(A, ROD, PED, '32 99999-0001')).rejects.toThrow(/outra pessoa/);
      await expect(equipe.cadastrarWhatsapp(A, ROD, PED, '+55 20 99999-0001')).rejects.toThrow(/DDD 20/);
    });

    it('trocar de número: o antigo fica INATIVO (não apagado) e o canal só reconhece o novo', async () => {
      await equipe.cadastrarWhatsapp(A, LUC, LUC, '32 99999-0002');
      const linhas = await prisma.channelIdentity.findMany({ where: { orgId: A, userId: LUC, canal: SessionCanal.whatsapp } });
      expect(linhas.map((l) => [l.externalId, l.ativo]).sort()).toEqual([
        ['5532999990001', false],
        ['5532999990002', true],
      ]);
      expect(await reconhece('5532999990001')).toBeNull();
      expect((await reconhece('5532999990002'))?.userId).toBe(LUC);
      // O número antigo, liberado, pode ir a outra pessoa (a linha é retomada, não recriada).
      await equipe.cadastrarWhatsapp(A, ROD, PED, '32 99999-0001');
      expect((await reconhece('5532999990001'))?.userId).toBe(PED);
    });

    it('a Equipe mostra o número inteiro só para a própria pessoa e para quem administra gente', async () => {
      const comoPedro = await equipe.equipe(A, PED);
      const lucasVistoPorPedro = comoPedro.pessoas.find((p) => p.id === LUC)!;
      expect(lucasVistoPorPedro.whatsapp).toEqual({ cadastrado: true, final: '…0002', numero: null });
      expect(lucasVistoPorPedro.podeEditarWhatsapp).toBe(false);
      expect(comoPedro.pessoas.find((p) => p.id === PED)!.whatsapp.numero).toBe('+55 (32) 99999-0001');
      const comoRodrigo = await equipe.equipe(A, ROD);
      expect(comoRodrigo.pessoas.find((p) => p.id === LUC)!.whatsapp.numero).toBe('+55 (32) 99999-0002');
    });

    it('remover desativa, sem apagar, e o canal deixa de reconhecer', async () => {
      await equipe.cadastrarWhatsapp(A, PED, PED, null);
      expect(await reconhece('5532999990001')).toBeNull();
      expect(await prisma.channelIdentity.count({ where: { orgId: A, externalId: '5532999990001' } })).toBe(1);
    });

    it('REVISÃO: número que é telefone de lead ou de cliente da empresa é recusado (só pelos dígitos); o de outra empresa não conta', async () => {
      await prisma.lead.create({ data: { orgId: A, name: 'Lead Fictício', phone: '(32) 98888-7001' } });
      await prisma.partner.create({ data: { orgId: A, razaoSocial: 'Cliente Fictício Ltda', isCliente: true, phone: '+55 32 3333-7002' } });
      await prisma.lead.create({ data: { orgId: B, name: 'Lead da Outra', phone: '32 98888-7003' } });
      await expect(equipe.cadastrarWhatsapp(A, LUC, LUC, '+55 (32) 98888-7001')).rejects.toThrow(/lead ou de um cliente/);
      await expect(equipe.cadastrarWhatsapp(A, LUC, LUC, '3233337002')).rejects.toThrow(/lead ou de um cliente/);
      expect(await prisma.channelIdentity.count({ where: { orgId: A, externalId: { in: ['5532988887001', '553233337002'] } } })).toBe(0);
      const r = await equipe.cadastrarWhatsapp(A, LUC, LUC, '32 98888-7003');
      expect(r.cadastrado).toBe(true);
      await equipe.cadastrarWhatsapp(A, LUC, LUC, '32 99999-0002');
    });

    it('conta de outra empresa não é alcançada', async () => {
      await expect(equipe.cadastrarWhatsapp(A, ROD, DE_B, '32999990005')).rejects.toThrow(/não encontrada/);
    });
  });

  // ---------------------------------------------------------------------------
  describe('o catálogo (GET /agents/cadastro)', () => {
    it('rotina: última do histórico e próxima da rotina; gasto do mês pela função; modelo efetivo', async () => {
      const agora = new Date();
      const rotina = await prisma.rotina.create({
        data: {
          orgId: A,
          slug: 'relogio-do-comercial',
          nome: 'Relógio do comercial',
          tipo: 'comercial.relogio',
          cron: '*/30 * * * *',
          ativo: true,
          estado: 'rodando',
          proximaExecucaoEm: new Date(agora.getTime() + 30 * 60_000),
        },
      });
      await prisma.rotinaExecucao.create({
        data: { orgId: A, rotinaId: rotina.id, status: 'ok', inicioEm: new Date(agora.getTime() - 60 * 60_000) },
      });
      await prisma.rotinaExecucao.create({
        data: { orgId: A, rotinaId: rotina.id, status: 'erro', inicioEm: new Date(agora.getTime() - 5 * 60_000) },
      });
      await gasto.registrar({ orgId: A, funcao: 'CO-11', modelo: 'claude-haiku-5-5', gastoUsd: 0.002, agora });
      await gasto.registrar({ orgId: A, funcao: 'CO-11', modelo: 'claude-haiku-5-5', gastoUsd: 0.003, agora });
      process.env.LLM_MODELO_CO_03 = 'claude-sonnet-5-5';

      const c = await cadastro.catalogo(A, agora);
      const por = new Map(c.linhas.map((l) => [l.slug, l]));

      const relogio = por.get(funcaoPorSlug('relogio-do-comercial')!.slug)!;
      expect(relogio.aba).toBe('rotinas');
      expect(relogio.ultima).toMatchObject({ status: 'erro', fonte: 'rotina' });
      expect(relogio.proxima?.fonte).toBe('rotina');
      expect(new Date(relogio.proxima!.em).getTime()).toBeGreaterThan(agora.getTime());
      expect(relogio.rotina).toEqual({ tipo: 'comercial.relogio', cadastradas: 1, ativas: 1 });

      const vigia = por.get('vigia-das-08h')!;
      expect(vigia.gastoMes).toEqual({ totalUsd: 0.005, chamadas: 2 });
      expect(vigia.ultima?.fonte).toBe('gasto');
      expect(vigia.modelo).toMatchObject({ modelo: 'claude-haiku-5-5', esforco: 'low', origem: 'cadastro' });

      expect(por.get('leitor-de-ata-do-comercial')!.modelo).toMatchObject({ modelo: 'claude-sonnet-5-5', origem: 'variavel' });
      expect(por.get('qualificador')!.modelo).toBeNull();
      expect(c.linhas.filter((l) => l.tipo !== 'agente').every((l) => l.modelo === null)).toBe(true);
    });

    it('estado do banco: agente pausado vira desligado com o motivo; rotina desligada idem', async () => {
      await prisma.agent.update({ where: { orgId_slug: { orgId: A, slug: 'leitor-de-ata' } }, data: { estado: 'pausado' } });
      await prisma.rotina.updateMany({ where: { orgId: A, tipo: 'comercial.relogio' }, data: { ativo: false } });
      const c = await cadastro.catalogo(A);
      const por = new Map(c.linhas.map((l) => [l.slug, l]));
      expect(por.get('leitor-de-ata')).toMatchObject({ estado: 'desligado', estadoDeclarado: 'ativo', estadoMotivo: 'pausado na tela de Agentes', registrado: true });
      expect(por.get('relogio-do-comercial')).toMatchObject({ estado: 'desligado', estadoMotivo: 'rotina desligada em /rotinas', proxima: null });
      await prisma.agent.update({ where: { orgId_slug: { orgId: A, slug: 'leitor-de-ata' } }, data: { estado: 'ativo' } });
    });

    it('o ajuste do registro vale para o modelo (é o que o laço passa explícito)', async () => {
      await prisma.agent.update({ where: { orgId_slug: { orgId: A, slug: 'leitor-de-ata' } }, data: { modelo: 'claude-sonnet-5-5', effort: 'medium' } });
      const c = await cadastro.catalogo(A);
      expect(c.linhas.find((l) => l.slug === 'leitor-de-ata')!.modelo).toEqual({ modelo: 'claude-sonnet-5-5', esforco: 'medium', origem: 'registro' });
    });

    it('o dono é o efetivo, o mesmo da Equipe; o agente fora do cadastro aparece com área própria', async () => {
      const c = await cadastro.catalogo(A);
      const por = new Map(c.linhas.map((l) => [l.slug, l]));
      expect(por.get('leitor-de-ata')!.dono).toMatchObject({ efetivo: { id: LUC }, origem: 'banco' });
      expect(por.get('qualificador')!.dono).toMatchObject({ efetivo: { id: LUC }, origem: 'padrao', padrao: 'lucas' });
      expect(por.get('agente-da-tela')).toMatchObject({ id: null, area: 'Fora do cadastro', aba: 'agentes', registrado: true, dono: { efetivo: { id: LUC } } });
      // Todas as linhas do cadastro estão lá.
      expect(c.linhas.filter((l) => l.id).length).toBeGreaterThanOrEqual(79);
    });

    it('outra empresa não vê as linhas, o gasto nem os donos desta', async () => {
      const c = await cadastro.catalogo(B);
      expect(c.linhas.some((l) => l.slug === 'agente-da-tela')).toBe(false);
      expect(c.linhas.find((l) => l.slug === 'vigia-das-08h')!.gastoMes).toBeNull();
      expect(c.linhas.find((l) => l.slug === 'qualificador')!.dono.efetivo?.id).toBe(DE_B);
    });
  });

  it('a rota do catálogo vem antes de `agents/:slug` (ordem dos controllers no módulo)', () => {
    // Lido do fonte, sem subir o Nest: importar o módulo inteiro puxa meio app.
    const fonte = readFileSync(join(__dirname, '../src/agents/agents.module.ts'), 'utf8');
    const lista = /controllers:\s*\[([^\]]*)\]/.exec(fonte)?.[1] ?? '';
    const nomes = lista.split(',').map((x) => x.trim()).filter(Boolean);
    expect(nomes.indexOf('CadastroController')).toBeGreaterThanOrEqual(0);
    expect(nomes.indexOf('CadastroController')).toBeLessThan(nomes.indexOf('AgentsController'));
  });
});
