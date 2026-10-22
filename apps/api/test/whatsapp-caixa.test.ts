import 'reflect-metadata';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  type ExecutionContext,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { formatarWhatsappBr } from '@mktos/shared';

import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import type { RespostaDeGentePelaEvolution } from '../src/gateway/canais/evolution.port';
import type { PrismaService } from '../src/prisma/prisma.service';
import { CaixaDoWhatsappController, SoGenteNaCaixaGuard } from '../src/whatsapp/caixa.controller';
import { CaixaDoWhatsappService, ondeDaBusca, ondeDoFiltro, type QuemNaCaixa } from '../src/whatsapp/caixa.service';
import type { SincronizacaoDoWhatsappService } from '../src/whatsapp/sincronizacao.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A CAIXA DE WHATSAPP (rodada de produção 4, W2, 22/10/2026).
 *
 *  1. as rotas: ler é `leads.ver`; arquivar e responder são `whatsapp.conversar` e de gente;
 *  2. a catraca: só o serviço da caixa chama `responderComoPessoa`, e o símbolo da porta só
 *     mora na porta, no módulo dos canais e na caixa;
 *  3. contra o banco (com um dublê da porta): lista, filtros, contagens, busca, abrir,
 *     paginação, ler, responder 1:1 e grupo, permissão, auditoria sem texto, ComercialMensagem
 *     só de lead, arquivar e voltar, isolamento entre empresas.
 *
 * Tudo fictício: números 5500000000xxx, nomes inventados.
 */

describe('caixa de WhatsApp: rotas e regras puras', () => {
  it('ler é leads.ver; marcar lida é leads.ver e só de gente; arquivar e responder são whatsapp.conversar e só de gente', () => {
    const h = CaixaDoWhatsappController.prototype;
    for (const m of [h.listar, h.abrir]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, m)).toEqual(['leads.ver']);
      expect(Reflect.getMetadata('__guards__', m)).toBeUndefined();
    }
    // Revisão 22C (A5): conta de máquina (o MCP tem leads.ver) não zera as não lidas da equipe.
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h.lida)).toEqual(['leads.ver']);
    expect(Reflect.getMetadata('__guards__', h.lida)).toEqual([SoGenteNaCaixaGuard]);
    for (const m of [h.arquivar, h.responder]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, m)).toEqual(['whatsapp.conversar']);
      expect(Reflect.getMetadata('__guards__', m)).toEqual([SoGenteNaCaixaGuard]);
    }
  });

  it('o guarda recusa papel de máquina pelo token e deixa gente passar', () => {
    const ctx = (user: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;
    const g = new SoGenteNaCaixaGuard();
    expect(() => g.canActivate(ctx({ sub: 'u', roles: ['ia_acao'] }))).toThrow(ForbiddenException);
    expect(() => g.canActivate(ctx({ sub: 'u', roles: ['ia_servico'] }))).toThrow(ForbiddenException);
    expect(() => g.canActivate(ctx(undefined))).toThrow(ForbiddenException);
    expect(g.canActivate(ctx({ sub: 'u', roles: ['admin_master'] }))).toBe(true);
  });

  it('cada filtro: arquivada só em Arquivadas; sem vínculo exclui lead, cliente e equipe', () => {
    expect(ondeDoFiltro('o', 'todas')).toEqual({ orgId: 'o', arquivadaEm: null });
    expect(ondeDoFiltro('o', 'arquivadas')).toEqual({ orgId: 'o', arquivadaEm: { not: null } });
    expect(ondeDoFiltro('o', 'sem_vinculo')).toEqual({ orgId: 'o', arquivadaEm: null, leadId: null, clienteId: null, equipe: false });
    // A mesma regra do resumo do Dia a dia: Leads e Clientes saem só do que não é equipe.
    expect(ondeDoFiltro('o', 'leads')).toEqual({ orgId: 'o', arquivadaEm: null, equipe: false, leadId: { not: null } });
    expect(ondeDoFiltro('o', 'clientes')).toEqual({ orgId: 'o', arquivadaEm: null, equipe: false, clienteId: { not: null } });
    expect(ondeDoFiltro('o', 'equipe')).toEqual({ orgId: 'o', arquivadaEm: null, equipe: true });
  });

  it('a busca: número só com termo de número; texto só a partir de 3 letras', () => {
    expect(ondeDaBusca('o', '  ')).toBeNull();
    const num = ondeDaBusca('o', '+55 (00) 0000')!.OR!;
    expect(num.some((w) => 'chatJid' in w)).toBe(true);
    const nome = ondeDaBusca('o', 'Loja 2')!.OR!;
    expect(nome.some((w) => 'chatJid' in w)).toBe(false);
    expect(nome.some((w) => 'mensagens' in w)).toBe(true);
    expect(ondeDaBusca('o', 'ab')!.OR!.some((w) => 'mensagens' in w)).toBe(false);
  });
});

/*
 * A CATRACA DA RESPOSTA DE GENTE. A porta manda texto a qualquer conversa do
 * número da empresa; só a caixa (depois da permissão e de conferir que é gente)
 * a chama.
 */
describe('caixa de WhatsApp: só a caixa responde como pessoa', () => {
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

  it('só src/whatsapp/caixa.service.ts chama .responderComoPessoa(', () => {
    const chamam = fontes.filter((f) => /\.responderComoPessoa\s*\(/.test(f.texto)).map((f) => f.arquivo).sort();
    expect(chamam).toEqual(['src/whatsapp/caixa.service.ts']);
  });

  it('o símbolo da porta só mora na porta, no módulo dos canais e na caixa', () => {
    const usam = fontes.filter((f) => f.texto.includes('RESPOSTA_DE_GENTE_PELA_EVOLUTION')).map((f) => f.arquivo).sort();
    expect(usam).toEqual(['src/gateway/canais/canais.module.ts', 'src/gateway/canais/evolution.port.ts', 'src/whatsapp/caixa.service.ts']);
  });

  it('a caixa não importa o conector da Evolution', () => {
    const fora = fontes
      .filter((f) => f.arquivo.startsWith('src/whatsapp/') && /from\s+['"][^'"]*pauta\/evolution\.service['"]/.test(f.texto))
      .map((f) => f.arquivo);
    expect(fora).toEqual([]);
  });
});

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, conversas e mensagens de WhatsApp fictícias, leads, clientes e auditoria)');

describe.skipIf(!URL)('caixa de WhatsApp contra o Postgres', () => {
  const MARCA = `cx${Date.now().toString(36).slice(-6)}`;
  const ORG = `org-caixa-a-${MARCA}`;
  const ORG2 = `org-caixa-b-${MARCA}`;
  const INST = 'instancia-ficticia';
  const PERMS = ['leads.ver', 'leads.editar', 'whatsapp.conversar'];

  let prisma: PrismaClient;
  let svc: CaixaDoWhatsappService;
  let gente: QuemNaCaixa;
  let maquina: QuemNaCaixa;
  let leitor: QuemNaCaixa;
  let soLe: QuemNaCaixa;
  let leadId: string;
  let clienteId: string;
  const ids: Record<string, string> = {};
  const enviados: Array<{ orgId: string; chatJid: string; texto: string }> = [];
  let falhar: Error | null = null;
  let proximoId = 0;

  const porta: RespostaDeGentePelaEvolution = {
    async responderComoPessoa(orgId, chatJid, texto) {
      if (falhar) throw falhar;
      enviados.push({ orgId, chatJid, texto });
      proximoId += 1;
      return { id: `EVO-${MARCA}-${proximoId}` };
    },
  };

  const T0 = new Date('2026-10-20T12:00:00.000Z').getTime();
  const em = (min: number) => new Date(T0 + min * 60_000);

  async function limpar() {
    for (const org of [ORG, ORG2]) {
      await prisma.whatsAppMensagem.deleteMany({ where: { orgId: org } });
      await prisma.whatsAppConversa.deleteMany({ where: { orgId: org } });
      await prisma.comercialMensagem.deleteMany({ where: { orgId: org } });
      await prisma.auditLog.deleteMany({ where: { orgId: org } });
    }
  }

  async function conversa(org: string, chave: string, dados: Record<string, unknown>) {
    const c = await prisma.whatsAppConversa.create({
      data: { orgId: org, instancia: INST, chatJid: `${chave}`, ...dados } as never,
      select: { id: true },
    });
    ids[chave] = c.id;
    return c.id;
  }

  async function mensagem(org: string, conversaId: string, chatJid: string, n: number, dados: Record<string, unknown> = {}) {
    return prisma.whatsAppMensagem.create({
      data: {
        orgId: org,
        conversaId,
        instancia: INST,
        chatJid,
        direcao: dados.deMim ? 'saida' : 'entrada',
        tipo: 'conversation',
        mensagemExternaId: `${chatJid}-${n}`,
        timestamp: em(n),
        origem: 'webhook',
        ...dados,
      } as never,
      select: { id: true },
    });
  }

  async function semear() {
    const lead = '5500000000001@s.whatsapp.net';
    const c1 = await conversa(ORG, lead, { nome: 'Contato Ficticio Um', leadId, naoLidas: 2, ultimaMensagemEm: em(30) });
    await mensagem(ORG, c1, lead, 10, { texto: 'primeira mensagem inventada', remetenteNumero: '5500000000001', leadId });
    await mensagem(ORG, c1, lead, 20, { texto: 'pergunta sobre o abacaxi azul', leadId });
    await mensagem(ORG, c1, lead, 30, { texto: 'resposta da casa', deMim: true, leadId });
    await mensagem(ORG, c1, lead, 25, { texto: 'mais uma de entrada', leadId });

    const g = '120363000000000001@g.us';
    const c2 = await conversa(ORG, g, {
      grupo: true,
      nome: 'ROOT | Cliente Ficticio',
      clienteId,
      participantes: 3,
      participantesLista: [
        { numero: '5500000000002', nome: 'Pessoa Ficticia', admin: true },
        { numero: '5500000000003', nome: null, admin: false },
        { lixo: true },
      ],
      naoLidas: 1,
      ultimaMensagemEm: em(50),
    });
    await mensagem(ORG, c2, g, 50, { grupo: true, texto: 'oi grupo', remetenteNome: 'Pessoa Ficticia', clienteId });

    const eq = '120363000000000002@g.us';
    const c3 = await conversa(ORG, eq, { grupo: true, nome: 'ROOT | Estratégia e Produto', equipe: true, ultimaMensagemEm: em(40) });
    await mensagem(ORG, c3, eq, 40, { grupo: true, texto: 'assunto interno' });

    const solto = '5500000000009@s.whatsapp.net';
    const c4 = await conversa(ORG, solto, { nome: null, naoLidas: 1, ultimaMensagemEm: em(5) });
    await mensagem(ORG, c4, solto, 5, { tipo: 'image', midia: { mime: 'image/jpeg', nome: null, tamanho: 1234 } });

    const arq = '5500000000008@s.whatsapp.net';
    await conversa(ORG, arq, { nome: 'Arquivado Ficticio', arquivadaEm: em(1), ultimaMensagemEm: em(60) });

    const vazia = '5500000000007@s.whatsapp.net';
    await conversa(ORG, vazia, { nome: 'Sem Mensagem Ficticia' });

    const outra = '5500000000005@s.whatsapp.net';
    const c5 = await conversa(ORG2, outra, { nome: 'Outra Empresa Ficticia', ultimaMensagemEm: em(70) });
    await mensagem(ORG2, c5, outra, 70, { texto: 'abacaxi azul da outra empresa' });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const org of [ORG, ORG2]) await prisma.org.upsert({ where: { id: org }, create: { id: org, name: org, slug: org }, update: {} });
    for (const key of PERMS) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const papel = async (key: string, perms: string[]) =>
      (await prisma.role.create({ data: { orgId: ORG, key, name: key, permissions: { connect: perms.map((k) => ({ key: k })) } }, select: { id: true } })).id;
    const admin = await papel('admin_master', PERMS);
    const ia = await papel('ia_acao', PERMS);
    const leit = await papel(`leitor_${MARCA}`, ['leads.ver']);
    const criar = async (nome: string, roleId: string, chave: string, perms: string[]): Promise<QuemNaCaixa> => ({
      id: (
        await prisma.user.create({
          data: { orgId: ORG, email: `${chave}-${MARCA}@caixa.teste`, name: nome, passwordHash: 'x', roles: { connect: { id: roleId } } },
          select: { id: true },
        })
      ).id,
      papeis: [chave === 'maquina' ? 'ia_acao' : chave === 'gente' ? 'admin_master' : `leitor_${MARCA}`],
      permissoes: perms,
    });
    gente = await criar('Pessoa Ficticia da Casa', admin, 'gente', PERMS);
    maquina = await criar('Conta de IA', ia, 'maquina', PERMS);
    // O token ainda diz whatsapp.conversar; o banco não: a releitura recusa.
    leitor = await criar('Pessoa que perdeu a permissao', leit, 'leitor', PERMS);
    soLe = { ...leitor, permissoes: ['leads.ver'] };
    leadId = (await prisma.lead.create({ data: { orgId: ORG, name: 'Lead Ficticio' }, select: { id: true } })).id;
    clienteId = (await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Cliente Ficticio Ltda' }, select: { id: true } })).id;

    const sinc = { garantirRotina: async () => undefined } as unknown as SincronizacaoDoWhatsappService;
    svc = new CaixaDoWhatsappService(prisma as unknown as PrismaService, sinc, porta);
  }, 60_000);

  beforeEach(async () => {
    falhar = null;
    enviados.length = 0;
    proximoId = 0;
    await limpar();
    await semear();
  });

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    for (const org of [ORG, ORG2]) {
      await prisma.lead.deleteMany({ where: { orgId: org } });
      await prisma.partner.deleteMany({ where: { orgId: org } });
      await prisma.user.deleteMany({ where: { orgId: org } });
      await prisma.role.deleteMany({ where: { orgId: org } });
      await prisma.org.deleteMany({ where: { id: org } });
    }
    await prisma.$disconnect();
  });

  it('lista: mais recente primeiro, nulos por último, sem arquivada, com contagens e permissões', async () => {
    const r = await svc.listar(ORG, {}, gente);
    expect(r.conversas.map((c) => c.nome)).toEqual([
      'ROOT | Cliente Ficticio',
      'ROOT | Estratégia e Produto',
      'Contato Ficticio Um',
      formatarWhatsappBr('5500000000009'),
      'Sem Mensagem Ficticia',
    ]);
    expect(r.conversas[3].numero).toBe('5500000000009');
    expect(r.conversas[3].previa).toMatchObject({ tipo: 'image', texto: null });
    expect(r.contagens).toEqual({ todas: 5, leads: 1, clientes: 1, grupos: 2, sem_vinculo: 2, equipe: 1, arquivadas: 1 });
    expect(r.podeResponder).toBe(true);
    expect(r.podeVincular).toBe(true);
    expect(r.mais).toBe(false);
    const lead = r.conversas.find((c) => c.vinculo?.tipo === 'lead')!;
    expect(lead.previa).toMatchObject({ texto: 'resposta da casa', deMim: true });
    expect(lead.naoLidas).toBe(2);
    const grupo = r.conversas[0];
    expect(grupo).toMatchObject({ grupo: true, participantes: 3, vinculo: { tipo: 'cliente', nome: 'Cliente Ficticio Ltda' } });
    expect(grupo.previa?.remetenteNome).toBe('Pessoa Ficticia');
  });

  it('cada filtro devolve o seu recorte; o limite liga o "mais"', async () => {
    const nomes = async (filtro: string) => (await svc.listar(ORG, { filtro }, gente)).conversas.map((c) => c.nome);
    expect(await nomes('leads')).toEqual(['Contato Ficticio Um']);
    expect(await nomes('clientes')).toEqual(['ROOT | Cliente Ficticio']);
    expect(await nomes('grupos')).toEqual(['ROOT | Cliente Ficticio', 'ROOT | Estratégia e Produto']);
    expect(await nomes('equipe')).toEqual(['ROOT | Estratégia e Produto']);
    expect((await nomes('sem_vinculo')).length).toBe(2);
    expect(await nomes('arquivadas')).toEqual(['Arquivado Ficticio']);
    expect(await nomes('inventado')).toHaveLength(5);
    const dois = await svc.listar(ORG, { limite: '2' }, gente);
    expect(dois.conversas).toHaveLength(2);
    expect(dois.mais).toBe(true);
  });

  it('busca por nome, número e texto de mensagem, sem atravessar empresa; contagens com a busca', async () => {
    const nome = await svc.listar(ORG, { q: 'ficticio um' }, gente);
    expect(nome.conversas.map((c) => c.nome)).toEqual(['Contato Ficticio Um']);
    expect(nome.contagens.todas).toBe(1);
    expect(nome.contagens.leads).toBe(1);
    expect(nome.contagens.clientes).toBe(0);
    const numero = await svc.listar(ORG, { q: '000 0009' }, gente);
    expect(numero.conversas.map((c) => c.numero)).toEqual(['5500000000009']);
    const texto = await svc.listar(ORG, { q: 'ABACAXI azul' }, gente);
    expect(texto.conversas.map((c) => c.nome)).toEqual(['Contato Ficticio Um']);
    expect(texto.contagens.todas).toBe(1);
  });

  it('quem só lê vê a caixa sem poder responder nem vincular; máquina não responde', async () => {
    const r = await svc.listar(ORG, {}, soLe);
    expect(r.podeResponder).toBe(false);
    expect(r.podeVincular).toBe(false);
    expect((await svc.listar(ORG, {}, maquina)).podeResponder).toBe(false);
  });

  it('abrir: da mais antiga para a mais nova, com paginação para trás pelo cursor', async () => {
    const id = ids['5500000000001@s.whatsapp.net'];
    const tudo = await svc.abrir(ORG, id, {}, gente);
    expect(tudo.mensagens.map((m) => m.texto)).toEqual([
      'primeira mensagem inventada',
      'pergunta sobre o abacaxi azul',
      'mais uma de entrada',
      'resposta da casa',
    ]);
    expect(tudo.maisAntigas).toBe(false);
    expect(tudo.participantes).toEqual([]);

    const ult = await svc.abrir(ORG, id, { limite: '2' }, gente);
    expect(ult.mensagens.map((m) => m.texto)).toEqual(['mais uma de entrada', 'resposta da casa']);
    expect(ult.maisAntigas).toBe(true);
    const antes = await svc.abrir(ORG, id, { limite: '2', antesDe: ult.mensagens[0].timestamp, antesDeId: ult.mensagens[0].id }, gente);
    expect(antes.mensagens.map((m) => m.texto)).toEqual(['primeira mensagem inventada', 'pergunta sobre o abacaxi azul']);
    expect(antes.maisAntigas).toBe(false);
  });

  it('abrir: o cursor não perde mensagem no mesmo segundo', async () => {
    const jid = '5500000000007@s.whatsapp.net';
    const id = ids[jid];
    for (const n of [1, 2, 3]) await mensagem(ORG, id, jid, 100, { mensagemExternaId: `mesmo-segundo-${n}`, texto: `m${n}` });
    const p1 = await svc.abrir(ORG, id, { limite: '2' }, gente);
    const p2 = await svc.abrir(ORG, id, { limite: '2', antesDe: p1.mensagens[0].timestamp, antesDeId: p1.mensagens[0].id }, gente);
    expect(new Set([...p1.mensagens, ...p2.mensagens].map((m) => m.texto))).toEqual(new Set(['m1', 'm2', 'm3']));
  });

  it('abrir grupo traz os participantes legíveis; mídia vem com os metadados', async () => {
    const g = await svc.abrir(ORG, ids['120363000000000001@g.us'], {}, gente);
    expect(g.participantes).toEqual([
      { numero: '5500000000002', nome: 'Pessoa Ficticia', admin: true },
      { numero: '5500000000003', nome: null, admin: false },
    ]);
    const m = await svc.abrir(ORG, ids['5500000000009@s.whatsapp.net'], {}, gente);
    expect(m.mensagens[0]).toMatchObject({ tipo: 'image', midia: { mime: 'image/jpeg', tamanho: 1234 } });
  });

  it('conversa de outra empresa ou inexistente é 404 igual', async () => {
    const outra = ids['5500000000005@s.whatsapp.net'];
    await expect(svc.abrir(ORG, outra, {}, gente)).rejects.toThrow(NotFoundException);
    await expect(svc.marcarLida(ORG, outra, gente)).rejects.toThrow(NotFoundException);
    await expect(svc.responder(ORG, outra, { texto: 'oi' }, gente)).rejects.toThrow(NotFoundException);
    await expect(svc.arquivar(ORG, outra, { arquivada: true }, gente)).rejects.toThrow(NotFoundException);
    await expect(svc.abrir(ORG, 'nao-existe', {}, gente)).rejects.toThrow(NotFoundException);
    expect(enviados).toEqual([]);
  });

  it('ler marca as de entrada com quem leu e zera o contador; de novo não muda nada', async () => {
    const id = ids['5500000000001@s.whatsapp.net'];
    expect(await svc.marcarLida(ORG, id, soLe)).toEqual({ lidas: 3 });
    const c = await prisma.whatsAppConversa.findUniqueOrThrow({ where: { id } });
    expect(c.naoLidas).toBe(0);
    const ms = await prisma.whatsAppMensagem.findMany({ where: { conversaId: id, deMim: false } });
    expect(ms.every((m) => m.lidaEm && m.lidaPorId === soLe.id)).toBe(true);
    expect((await prisma.whatsAppMensagem.findFirstOrThrow({ where: { conversaId: id, deMim: true } })).lidaEm).toBeNull();
    expect(await svc.marcarLida(ORG, id, gente)).toEqual({ lidas: 0 });
    const aberta = await svc.abrir(ORG, id, {}, gente);
    expect(aberta.mensagens.every((m) => m.lida)).toBe(true);
  });

  it('responder 1:1 a um lead: sai pela porta, grava a mensagem, o fio do lead e a auditoria sem texto', async () => {
    const jid = '5500000000001@s.whatsapp.net';
    const id = ids[jid];
    const texto = 'Resposta ficticia digitada pela pessoa';
    const r = await svc.responder(ORG, id, { texto: `  ${texto}\r\n` }, gente);
    expect(enviados).toEqual([{ orgId: ORG, chatJid: jid, texto }]);
    expect(r.mensagem).toMatchObject({ deMim: true, texto, tipo: 'conversation', enviadaPor: { id: gente.id, nome: 'Pessoa Ficticia da Casa' } });

    const m = await prisma.whatsAppMensagem.findUniqueOrThrow({ where: { id: r.mensagem.id } });
    expect(m).toMatchObject({ orgId: ORG, direcao: 'saida', origem: 'caixa', enviadaPorId: gente.id, leadId, mensagemExternaId: `EVO-${MARCA}-1` });
    const c = await prisma.whatsAppConversa.findUniqueOrThrow({ where: { id } });
    expect(c.ultimaMensagemEm!.getTime()).toBe(m.timestamp.getTime());

    const fio = await prisma.comercialMensagem.findMany({ where: { orgId: ORG, leadId } });
    expect(fio).toHaveLength(1);
    expect(fio[0]).toMatchObject({ direcao: 'saida', provedor: 'evolution', destino: 'lead', template: null, estado: 'enviada', mensagemExternaId: `EVO-${MARCA}-1` });
    expect(fio[0].enviadaEm).toBeTruthy();

    const aud = await prisma.auditLog.findMany({ where: { orgId: ORG, action: 'whatsapp.mensagem.enviada_por_pessoa' } });
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ actorId: gente.id, entityType: 'whatsapp_conversa', entityId: id });
    const bruto = JSON.stringify(aud[0]);
    expect(bruto).not.toContain(texto);
    expect(bruto).not.toContain('5500000000001');
    expect(aud[0].after).toMatchObject({ mensagemId: m.id, tamanho: texto.length, grupo: false, doLead: true });
  });

  it('responder no grupo do cliente: destino é o grupo, sem ComercialMensagem (não é lead)', async () => {
    const jid = '120363000000000001@g.us';
    const r = await svc.responder(ORG, ids[jid], { texto: 'oi grupo ficticio' }, gente);
    expect(enviados[0].chatJid).toBe(jid);
    const m = await prisma.whatsAppMensagem.findUniqueOrThrow({ where: { id: r.mensagem.id } });
    expect(m).toMatchObject({ grupo: true, clienteId, leadId: null, origem: 'caixa' });
    expect(await prisma.comercialMensagem.count({ where: { orgId: ORG } })).toBe(0);
  });

  it('grupo de lead grava ComercialMensagem com destino grupo', async () => {
    const jid = '120363000000000002@g.us';
    await prisma.whatsAppConversa.update({ where: { id: ids[jid] }, data: { leadId } });
    await svc.responder(ORG, ids[jid], { texto: 'para o grupo do lead' }, gente);
    const fio = await prisma.comercialMensagem.findMany({ where: { orgId: ORG, leadId } });
    expect(fio.map((f) => f.destino)).toEqual(['grupo']);
    // Conversa da equipe com lead conta em Equipe, nunca em Leads (a regra do resumo do Dia a dia).
    const l = await svc.listar(ORG, {}, gente);
    expect(l.contagens).toMatchObject({ leads: 1, equipe: 1 });
    expect((await svc.listar(ORG, { filtro: 'leads' }, gente)).conversas.map((c) => c.nome)).toEqual(['Contato Ficticio Um']);
  });

  it('o eco que chegou antes cai na mesma linha e passa a dizer quem escreveu', async () => {
    const jid = '5500000000009@s.whatsapp.net';
    const id = ids[jid];
    await mensagem(ORG, id, jid, 200, { mensagemExternaId: `EVO-${MARCA}-1`, deMim: true, texto: 'eco' });
    const r = await svc.responder(ORG, id, { texto: 'eco' }, gente);
    const linhas = await prisma.whatsAppMensagem.findMany({ where: { orgId: ORG, mensagemExternaId: `EVO-${MARCA}-1` } });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ id: r.mensagem.id, enviadaPorId: gente.id, origem: 'caixa' });
  });

  it('permissão: máquina, quem perdeu a permissão no banco e texto vazio são recusados sem enviar', async () => {
    const id = ids['5500000000001@s.whatsapp.net'];
    await expect(svc.responder(ORG, id, { texto: 'oi' }, maquina)).rejects.toThrow(ForbiddenException);
    // Mesmo com a permissão no token e um papel de gente declarado: o banco diz ia_acao.
    await expect(svc.responder(ORG, id, { texto: 'oi' }, { ...maquina, papeis: ['admin_master'] })).rejects.toThrow(ForbiddenException);
    await expect(svc.responder(ORG, id, { texto: 'oi' }, leitor)).rejects.toThrow(ForbiddenException);
    await expect(svc.responder(ORG, id, { texto: '   ' }, gente)).rejects.toThrow(BadRequestException);
    await expect(svc.responder(ORG, id, { texto: 'x'.repeat(4001) }, gente)).rejects.toThrow(BadRequestException);
    expect(enviados).toEqual([]);
    expect(await prisma.whatsAppMensagem.count({ where: { orgId: ORG, origem: 'caixa' } })).toBe(0);
  });

  it('falha da Evolution: 502/503 com frase, nada gravado como enviado', async () => {
    const id = ids['5500000000001@s.whatsapp.net'];
    const erro = (nome: string, msg: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(msg), { name: nome }, extra);
    falhar = erro('EvolutionNaoConfiguradaError', 'Conector evolution desligado nesta empresa.');
    await expect(svc.responder(ORG, id, { texto: 'oi' }, gente)).rejects.toThrow(ServiceUnavailableException);
    await expect(svc.responder(ORG, id, { texto: 'oi' }, gente)).rejects.toThrow(/desligado nesta empresa\. Nada foi enviado/);
    falhar = erro('EvolutionRespondeuErro', 'A Evolution respondeu HTTP 500 em POST /message/sendText.', { status: 500 });
    await expect(svc.responder(ORG, id, { texto: 'oi' }, gente)).rejects.toThrow(BadGatewayException);
    falhar = new Error('fetch failed');
    await expect(svc.responder(ORG, id, { texto: 'oi' }, gente)).rejects.toThrow(/não respondeu/);
    // Revisão 22C (A1): estourar o prazo NÃO diz "nada foi enviado" (pode ter saído): manda conferir antes de repetir.
    falhar = erro('TimeoutError', 'The operation was aborted due to timeout');
    await expect(svc.responder(ORG, id, { texto: 'oi' }, gente)).rejects.toThrow(BadGatewayException);
    await expect(svc.responder(ORG, id, { texto: 'oi' }, gente)).rejects.toThrow(/Confira no celular antes de repetir/);
    expect(await prisma.whatsAppMensagem.count({ where: { orgId: ORG, origem: 'caixa' } })).toBe(0);
    expect(await prisma.comercialMensagem.count({ where: { orgId: ORG } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: 'whatsapp.mensagem.enviada_por_pessoa' } })).toBe(0);
  });

  it('arquivar e voltar: some da lista, aparece em Arquivadas, auditado; arquivada não recebe resposta', async () => {
    const id = ids['5500000000009@s.whatsapp.net'];
    await expect(svc.arquivar(ORG, id, { arquivada: true }, maquina)).rejects.toThrow(ForbiddenException);
    await expect(svc.arquivar(ORG, id, { arquivada: true }, leitor)).rejects.toThrow(ForbiddenException);
    await expect(svc.arquivar(ORG, id, { arquivada: 'sim' }, gente)).rejects.toThrow(BadRequestException);
    const a = await svc.arquivar(ORG, id, { arquivada: true }, gente);
    expect(a.arquivada).toBe(true);
    // De novo não audita de novo.
    await svc.arquivar(ORG, id, { arquivada: true }, gente);
    const l = await svc.listar(ORG, {}, gente);
    expect(l.conversas.some((c) => c.id === id)).toBe(false);
    expect(l.contagens.arquivadas).toBe(2);
    expect((await svc.listar(ORG, { filtro: 'arquivadas' }, gente)).conversas.some((c) => c.id === id)).toBe(true);
    await expect(svc.responder(ORG, id, { texto: 'oi' }, gente)).rejects.toThrow(ConflictException);
    expect(enviados).toEqual([]);

    const v = await svc.arquivar(ORG, id, { arquivada: false }, gente);
    expect(v.arquivada).toBe(false);
    expect((await svc.listar(ORG, {}, gente)).conversas.some((c) => c.id === id)).toBe(true);
    const aud = await prisma.auditLog.findMany({ where: { orgId: ORG, entityId: id }, orderBy: { createdAt: 'asc' } });
    expect(aud.map((x) => x.action)).toEqual(['whatsapp.conversa.arquivada', 'whatsapp.conversa.desarquivada']);
  });

  it('isolamento: a outra empresa só vê a própria conversa', async () => {
    const r = await svc.listar(ORG2, {}, gente);
    expect(r.conversas.map((c) => c.nome)).toEqual(['Outra Empresa Ficticia']);
    expect(r.contagens.todas).toBe(1);
    const busca = await svc.listar(ORG2, { q: 'ficticio um' }, gente);
    expect(busca.conversas).toEqual([]);
  });
});
