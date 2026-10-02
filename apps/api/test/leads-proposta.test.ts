import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  type ArgumentsHost,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LeadCondicoesSchema,
  LeadDecisaoSchema,
  LeadEntradaSchema,
  LeadPropostaRegistroSchema,
  type LeadCondicoes,
  type LeadCondicoesMudaramCorpo,
  type LeadDecisaoInput,
  type LeadPropostaRegistroInput,
} from '@mktos/shared';
import { LeadsController } from '../src/leads/leads.controller';
import { LeadsService, type AtorDaEntrada } from '../src/leads/leads.service';
import {
  condicoesDoCard,
  diferencaDasCondicoes,
  estadoDaProposta,
  eventoIdDaDecisao,
  eventoIdDaProposta,
  evidenciaParaORastro,
  hashDaEvidencia,
  hashDasCondicoes,
  hashDoRegistroDaProposta,
  motivoDeCondicoesInsuficientes,
  origemDoLink,
  type ValorDeCampoDoCard,
} from '../src/leads/proposta-comercial';
import { AuditService } from '../src/audit/audit.service';
import { SENSITIVE_WRITE_KEY } from '../src/approvals/sensitive-write.decorator';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { ZodExceptionFilter } from '../src/common/zod-exception.filter';
import { ModulosService } from '../src/tenants/modulos.service';
import { ModulosInterceptor } from '../src/tenants/modulos.interceptor';
import { comContexto, novaCorrelacao } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ROOT-49 — PROPOSTA E ACEITE COMERCIAL, PERCURSO MÍNIMO (C-03, P-b, E15).
 *
 * Sem banco: condições do card, hash, diferença, identidade dos eventos, o
 * schema e as permissões declaradas. Com banco (Postgres descartável): o
 * registro, o aceite, a repetição, a CORRIDA de verdade, o 409 com a diferença,
 * a empresa alheia, as permissões e o RASTRO. A seção de RLS repete os mesmos
 * casos pelo cliente REAL da aplicação (`comTenantNaSessao`, modo `impor`)
 * conectado como `mktos_app`: só roda com `TENANT_DATABASE_URL` e
 * `RLS_NO_TESTE=1`, num banco só dela (ver `banco-de-teste.ts`).
 * Nenhum dado de produção: toda linha nasce e morre aqui, em empresas próprias.
 */

const sha = (texto: string) => createHash('sha256').update(texto).digest('hex');
const SHA_DOC = sha('proposta-v1.pdf');
const SHA_ARQ = sha('aceite-assinado.pdf');
const hex = (n: string) => n.repeat(64);

const valor = (over: Partial<ValorDeCampoDoCard> = {}): ValorDeCampoDoCard => ({
  campoId: 'f-valor',
  campoNome: 'Valor em negociação',
  campoTipo: 'moeda',
  valor: 'BRL 1500.00',
  opcao: null,
  ...over,
});
const card = (over: Partial<{ id: string; startDate: Date | null; dueDate: Date | null }> = {}) => ({
  id: 'card-1',
  startDate: null,
  dueDate: null,
  ...over,
});

describe('ROOT-49: as condições lidas do card (puro)', () => {
  it('guarda valor, datas e periodicidade; ignora o resto dos campos do card', () => {
    const c = condicoesDoCard(card({ startDate: new Date('2026-11-01T00:00:00Z'), dueDate: new Date('2026-11-30T00:00:00Z') }), [
      valor(),
      valor({ campoId: 'f-data', campoNome: 'Data de Cadastro do Lead', campoTipo: 'data', valor: '1790000000000' }),
      valor({ campoId: 'f-per', campoNome: ' PERIODICIDADE ', campoTipo: 'drop_down', valor: null, opcao: 'Mensal' }),
      valor({ campoId: 'f-vend', campoNome: 'Vendedor', campoTipo: 'drop_down', valor: null, opcao: 'Rodrigo' }),
      valor({ campoId: 'f-obj', campoNome: 'Objeção', campoTipo: 'drop_down', valor: null, opcao: 'Preço' }),
    ]);
    expect(c).toEqual({
      cardId: 'card-1',
      inicio: '2026-11-01T00:00:00.000Z',
      vencimento: '2026-11-30T00:00:00.000Z',
      campos: [
        { campoId: 'f-data', nome: 'Data de Cadastro do Lead', tipo: 'data', valor: '1790000000000' },
        { campoId: 'f-per', nome: ' PERIODICIDADE ', tipo: 'periodicidade', valor: 'Mensal' },
        { campoId: 'f-valor', nome: 'Valor em negociação', tipo: 'moeda', valor: 'BRL 1500.00' },
      ],
    });
    expect(LeadCondicoesSchema.safeParse(c).success).toBe(true);
  });

  it('a periodicidade sem acento ou com acento é a mesma, e o valor de texto vale quando não há opção', () => {
    const a = condicoesDoCard(card(), [valor({ campoId: 'p', campoNome: 'Periodicidade', campoTipo: 'texto', valor: ' anual ', opcao: null })]);
    expect(a.campos).toEqual([{ campoId: 'p', nome: 'Periodicidade', tipo: 'periodicidade', valor: 'anual' }]);
    const b = condicoesDoCard(card(), [valor({ campoId: 'p', campoNome: 'Periodicidáde', campoTipo: 'texto', valor: 'x' })]);
    expect(b.campos).toHaveLength(1);
  });

  it('o hash não depende da ordem das linhas, muda com qualquer condição e mora no campoId, não no nome', () => {
    const f1 = valor();
    const f2 = valor({ campoId: 'f-per', campoNome: 'Periodicidade', campoTipo: 'drop_down', valor: null, opcao: 'Mensal' });
    const h = hashDasCondicoes(condicoesDoCard(card(), [f1, f2]));
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDasCondicoes(condicoesDoCard(card(), [f2, f1]))).toBe(h);
    expect(hashDasCondicoes(condicoesDoCard(card(), [valor({ valor: 'BRL 1500.01' }), f2]))).not.toBe(h);
    expect(hashDasCondicoes(condicoesDoCard(card({ dueDate: new Date('2026-12-01T00:00:00Z') }), [f1, f2]))).not.toBe(h);
    expect(hashDasCondicoes(condicoesDoCard(card({ id: 'card-2' }), [f1, f2]))).not.toBe(h);
    expect(hashDasCondicoes(condicoesDoCard(card(), [f1, { ...f2, opcao: 'Anual' }]))).not.toBe(h);

    // Mora no campoId, não no nome: renomear (inclusive corrigir a grafia da lista real) não muda o hash...
    const renomeado = condicoesDoCard(card(), [valor({ campoNome: 'Valor em negociação' }), f2]);
    const grafiaAntiga = condicoesDoCard(card(), [valor({ campoNome: 'Valor em negocição' }), f2]);
    expect(hashDasCondicoes(grafiaAntiga)).toBe(h);
    expect(hashDasCondicoes(renomeado)).toBe(hashDasCondicoes(grafiaAntiga));
    expect(hashDasCondicoes(condicoesDoCard(card(), [f1, { ...f2, campoNome: 'PERIODICIDADE' }]))).toBe(h);
    // ...mas o nome continua nas condições devolvidas à tela...
    expect(renomeado.campos.find((c) => c.campoId === 'f-valor')?.nome).toBe('Valor em negociação');
    expect(grafiaAntiga.campos.find((c) => c.campoId === 'f-valor')?.nome).toBe('Valor em negocição');
    // ...e a identidade é o campoId e o tipo: outro campo com o mesmo nome e valor, ou o mesmo campo em outro tipo, é outra condição.
    expect(hashDasCondicoes(condicoesDoCard(card(), [valor({ campoId: 'f-outro' }), f2]))).not.toBe(h);
    expect(hashDasCondicoes(condicoesDoCard(card(), [valor({ campoTipo: 'data' }), f2]))).not.toBe(h);
  });

  it('sem valor em negociação (ou fora do formato canônico) as condições não servem', () => {
    expect(motivoDeCondicoesInsuficientes(condicoesDoCard(card(), []))).toMatch(/valor em negociação/);
    expect(motivoDeCondicoesInsuficientes(condicoesDoCard(card(), [valor({ valor: null })]))).toMatch(/valor em negociação/);
    expect(motivoDeCondicoesInsuficientes(condicoesDoCard(card(), [valor({ valor: '1.500,00' })]))).toMatch(/formato/);
    expect(motivoDeCondicoesInsuficientes(condicoesDoCard(card(), [valor()]))).toBeNull();
    // Só data e periodicidade, sem valor: não serve.
    expect(motivoDeCondicoesInsuficientes(condicoesDoCard(card(), [valor({ campoId: 'd', campoTipo: 'data', campoNome: 'D', valor: '1' })]))).not.toBeNull();
  });

  it('a diferença diz o que o card tinha e o que tem agora, campo a campo', () => {
    const vistas = condicoesDoCard(card(), [valor(), valor({ campoId: 'f-per', campoNome: 'Periodicidade', campoTipo: 'drop_down', valor: null, opcao: 'Mensal' })]);
    const atuais = condicoesDoCard(card({ dueDate: new Date('2026-12-01T00:00:00Z') }), [valor({ valor: 'BRL 1800.00' }), valor({ campoId: 'f-nova', campoNome: 'Data', campoTipo: 'data', valor: '5' })]);
    expect(diferencaDasCondicoes(vistas, atuais)).toEqual([
      { chave: 'vencimento', rotulo: 'Vencimento', vista: null, atual: '2026-12-01T00:00:00.000Z' },
      { chave: 'campo:f-nova', rotulo: 'Data', vista: null, atual: '5' },
      { chave: 'campo:f-per', rotulo: 'Periodicidade', vista: 'Mensal', atual: null },
      { chave: 'campo:f-valor', rotulo: 'Valor em negociação', vista: 'BRL 1500.00', atual: 'BRL 1800.00' },
    ]);
    expect(diferencaDasCondicoes(vistas, vistas)).toEqual([]);
    expect(diferencaDasCondicoes(vistas, { ...vistas, cardId: 'outro' })[0]).toMatchObject({ chave: 'card' });
    // O nome é só rótulo: o campo renomeado não aparece na diferença, e o rótulo de um campo que mudou é o nome de agora.
    const renomeadas = condicoesDoCard(card(), [valor({ campoNome: 'Valor negociado' }), valor({ campoId: 'f-per', campoNome: 'Periodicidade', campoTipo: 'drop_down', valor: null, opcao: 'Mensal' })]);
    expect(diferencaDasCondicoes(vistas, renomeadas)).toEqual([]);
    expect(diferencaDasCondicoes(vistas, condicoesDoCard(card(), [valor({ campoNome: 'Valor negociado', valor: 'BRL 1600.00' }), valor({ campoId: 'f-per', campoNome: 'Periodicidade', campoTipo: 'drop_down', valor: null, opcao: 'Mensal' })]))).toEqual([
      { chave: 'campo:f-valor', rotulo: 'Valor negociado', vista: 'BRL 1500.00', atual: 'BRL 1600.00' },
    ]);
  });
});

describe('ROOT-49: a identidade dos eventos (puro)', () => {
  const doc = { tipo: 'link', url: 'https://drive.exemplo/proposta', sha256: SHA_DOC } as const;

  it('o id do aceite é (lead, "aceite", hash das condições): estável, por empresa e por lead', () => {
    const id = eventoIdDaDecisao('org-1', 'lead-1', 'aceite', hex('a'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(eventoIdDaDecisao('org-1', 'lead-1', 'aceite', hex('a'))).toBe(id);
    expect(eventoIdDaDecisao('org-2', 'lead-1', 'aceite', hex('a'))).not.toBe(id);
    expect(eventoIdDaDecisao('org-1', 'lead-2', 'aceite', hex('a'))).not.toBe(id);
    expect(eventoIdDaDecisao('org-1', 'lead-1', 'aceite', hex('b'))).not.toBe(id);
  });

  it('aceite e recusa das mesmas condições têm ids diferentes (a recusa não engole o aceite)', () => {
    expect(eventoIdDaDecisao('o', 'l', 'recusa', hex('a'))).not.toBe(eventoIdDaDecisao('o', 'l', 'aceite', hex('a')));
  });

  it('a proposta é o conteúdo: o mesmo documento nas mesmas condições cai no mesmo id', () => {
    const r = hashDoRegistroDaProposta({ documento: doc, cardId: 'c', condicoesHash: hex('a') });
    expect(hashDoRegistroDaProposta({ documento: { ...doc }, cardId: 'c', condicoesHash: hex('a') })).toBe(r);
    expect(hashDoRegistroDaProposta({ documento: { ...doc, sha256: hex('9') }, cardId: 'c', condicoesHash: hex('a') })).not.toBe(r);
    expect(hashDoRegistroDaProposta({ documento: doc, cardId: 'c', condicoesHash: hex('b') })).not.toBe(r);
    expect(eventoIdDaProposta('o', 'l', r)).toBe(eventoIdDaProposta('o', 'l', r));
    expect(eventoIdDaProposta('o', 'l', r)).not.toBe(eventoIdDaProposta('o2', 'l', r));
  });

  it('o RASTRO leva o tipo e um resumo da evidência, nunca o texto da mensagem nem o caminho do link', () => {
    const msg = { tipo: 'mensagem', canal: 'whatsapp', texto: 'Aceito, pode seguir com o contrato — João' } as const;
    const link = { tipo: 'link', url: 'https://drive.exemplo/p/123?token=segredo' } as const;
    const arq = { tipo: 'arquivo', nome: 'aceite.pdf', sha256: SHA_ARQ } as const;
    const todos = JSON.stringify([evidenciaParaORastro(msg), evidenciaParaORastro(link), evidenciaParaORastro(arq)]);
    for (const proibido of ['Aceito', 'João', 'segredo', '/p/123', 'aceite.pdf']) expect(todos).not.toContain(proibido);
    expect(evidenciaParaORastro(link)).toMatchObject({ tipo: 'link', origem: 'https://drive.exemplo' });
    expect(evidenciaParaORastro(arq)).toMatchObject({ tipo: 'arquivo', sha256: SHA_ARQ });
    expect(evidenciaParaORastro(msg)).toMatchObject({ tipo: 'mensagem', canal: 'whatsapp' });
    expect(hashDaEvidencia(msg)).toBe(hashDaEvidencia({ ...msg }));
    expect(origemDoLink('não é url')).toBe('link-invalido');
  });

  it('o estado é o último fato entre proposta, aceite e recusa', () => {
    const t = (n: number) => new Date(2026, 9, 2, 10, 0, n);
    const ev = (type: string, n: number) => ({ id: `e${n}`, type, occurredAt: t(n) });
    expect(estadoDaProposta([])).toBe('sem_proposta');
    expect(estadoDaProposta([ev('entrada', 0)])).toBe('sem_proposta');
    expect(estadoDaProposta([ev('entrada', 0), ev('proposta', 1)])).toBe('proposta_registrada');
    expect(estadoDaProposta([ev('proposta', 1), ev('aceite', 2)])).toBe('aceite_registrado');
    expect(estadoDaProposta([ev('proposta', 1), ev('recusa', 2)])).toBe('recusa_registrada');
    expect(estadoDaProposta([ev('proposta', 1), ev('recusa', 2), ev('aceite', 3)])).toBe('aceite_registrado');
    expect(estadoDaProposta([ev('proposta', 1), ev('aceite', 2), ev('proposta', 3)])).toBe('proposta_registrada');
    // Empate de instante: a decisão vale sobre a proposta.
    expect(estadoDaProposta([ev('aceite', 2), ev('proposta', 2)])).toBe('aceite_registrado');
    expect(estadoDaProposta([ev('status_change', 9), ev('dono', 9)])).toBe('sem_proposta');
  });
});

describe('ROOT-49: os pedidos (schema)', () => {
  const base = { decisao: 'aceite', condicoesHash: hex('a') };
  const link = { tipo: 'link', url: 'https://drive.exemplo/aceite' };

  it('aceite exige evidência (arquivo com sha256, link ou mensagem) e o hash das condições', () => {
    expect(LeadDecisaoSchema.safeParse({ ...base, evidencia: link }).success).toBe(true);
    expect(LeadDecisaoSchema.safeParse({ ...base, evidencia: { tipo: 'arquivo', nome: 'a.pdf', sha256: SHA_ARQ } }).success).toBe(true);
    expect(LeadDecisaoSchema.safeParse({ ...base, evidencia: { tipo: 'mensagem', canal: 'whatsapp', texto: 'Aceito' } }).success).toBe(true);
    expect(LeadDecisaoSchema.safeParse({ ...base }).success).toBe(false);
    expect(LeadDecisaoSchema.safeParse({ ...base, evidencia: null }).success).toBe(false);
    expect(LeadDecisaoSchema.safeParse({ ...base, evidencia: {} }).success).toBe(false);
    expect(LeadDecisaoSchema.safeParse({ decisao: 'aceite', evidencia: link }).success).toBe(false);
    expect(LeadDecisaoSchema.safeParse({ ...base, evidencia: link, condicoesHash: 'abc' }).success).toBe(false);
  });

  it('a evidência recusa o que não prova nada: arquivo sem hash, link http ou com senha, mensagem vazia', () => {
    const ev = (e: unknown) => LeadDecisaoSchema.safeParse({ ...base, evidencia: e }).success;
    expect(ev({ tipo: 'arquivo', nome: 'a.pdf' })).toBe(false);
    expect(ev({ tipo: 'arquivo', nome: 'a.pdf', sha256: 'curto' })).toBe(false);
    expect(ev({ tipo: 'link', url: 'http://drive.exemplo/x' })).toBe(false);
    expect(ev({ tipo: 'link', url: 'javascript:alert(1)' })).toBe(false);
    expect(ev({ tipo: 'link', url: 'https://u:s@drive.exemplo/x' })).toBe(false);
    expect(ev({ tipo: 'link', url: 'não é link' })).toBe(false);
    expect(ev({ tipo: 'mensagem', canal: 'whatsapp', texto: '  ' })).toBe(false);
    expect(ev({ tipo: 'mensagem', canal: 'pombo', texto: 'Aceito' })).toBe(false);
    expect(ev({ tipo: 'oral', texto: 'Aceito' })).toBe(false);
    expect(ev({ tipo: 'link', url: 'https://x.exemplo/a', extra: 1 })).toBe(false);
  });

  it('a decisão é aceite ou recusa, e o pedido não aceita campo fora da lista (nem etapa)', () => {
    expect(LeadDecisaoSchema.safeParse({ ...base, decisao: 'recusa', evidencia: link }).success).toBe(true);
    expect(LeadDecisaoSchema.safeParse({ ...base, decisao: 'talvez', evidencia: link }).success).toBe(false);
    expect(LeadDecisaoSchema.safeParse({ ...base, evidencia: link, status: 'ganho' }).success).toBe(false);
  });

  it('a proposta é um link https com sha256; arquivo do card não entra (lacuna da ROOT-44)', () => {
    const ok = { documento: { tipo: 'link', url: 'https://drive.exemplo/p', sha256: SHA_DOC } };
    expect(LeadPropostaRegistroSchema.safeParse(ok).success).toBe(true);
    expect(LeadPropostaRegistroSchema.safeParse({ ...ok, cardId: 'c-1' }).success).toBe(true);
    expect(LeadPropostaRegistroSchema.safeParse({ documento: { tipo: 'link', url: 'https://drive.exemplo/p' } }).success).toBe(false);
    expect(LeadPropostaRegistroSchema.safeParse({ documento: { tipo: 'arquivo', arquivoId: 'x', sha256: SHA_DOC } }).success).toBe(false);
    expect(LeadPropostaRegistroSchema.safeParse({ documento: { ...ok.documento, url: 'http://x.exemplo' } }).success).toBe(false);
    expect(LeadPropostaRegistroSchema.safeParse({ ...ok, valor: 'BRL 1.00' }).success).toBe(false);
  });

  it('o sha256 maiúsculo é normalizado antes do hash, para o mesmo documento não virar dois', () => {
    const a = LeadPropostaRegistroSchema.parse({ documento: { tipo: 'link', url: 'https://d.exemplo/p', sha256: SHA_DOC.toUpperCase() } });
    expect(a.documento.sha256).toBe(SHA_DOC);
  });

  it('aceite sem evidência vira 400 pelo filtro de validação da API', () => {
    const controller = new LeadsController({} as LeadsService);
    let status = 0;
    let corpo: { issues: { path: string }[] } | null = null;
    const res = { status: (s: number) => ((status = s), { json: (b: typeof corpo) => (corpo = b) }) };
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
    const user = { sub: 'u', orgId: 'o', permissions: [] } as never;
    try {
      controller.decidir(user, 'l', { decisao: 'aceite', condicoesHash: hex('a') });
      throw new Error('deveria lançar');
    } catch (e) {
      new ZodExceptionFilter().catch(e as never, host);
    }
    expect(status).toBe(400);
    expect(corpo!.issues.map((i) => i.path)).toContain('evidencia');
  });
});

describe('ROOT-49: permissões e módulos declarados (puro)', () => {
  it('ler o estado pede leads.ver; condições, proposta e aceite pedem também tarefas.ver (R1)', () => {
    const p = LeadsController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.lerProposta)).toEqual(['leads.ver']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.lerCondicoes)).toEqual(['leads.ver', 'tarefas.ver']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.registrarProposta)).toEqual(['leads.editar', 'tarefas.ver']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.decidir)).toEqual(['leads.editar', 'tarefas.ver']);
    // Registrar a decisão do cliente não é escrita sensível (não muda etapa): o porquê está no controller.
    for (const h of [p.registrarProposta, p.decidir]) expect(Reflect.getMetadata(SENSITIVE_WRITE_KEY, h)).toBeUndefined();
    // A etapa segue sob aprovação.
    expect(Reflect.getMetadata(SENSITIVE_WRITE_KEY, p.update)).toBe('lead');
  });

  it('o guarda de permissão recusa com 403 quem não tem as duas permissões', () => {
    const guarda = new PermissionsGuard(new Reflector());
    const contexto = (permissions: string[], handler: (...a: never[]) => unknown) =>
      ({
        getHandler: () => handler,
        getClass: () => LeadsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
      }) as unknown as ExecutionContext;
    const p = LeadsController.prototype;
    for (const handler of [p.registrarProposta, p.decidir]) {
      expect(() => guarda.canActivate(contexto(['leads.ver', 'tarefas.ver'], handler as never))).toThrow(ForbiddenException); // sem leads.editar
      expect(() => guarda.canActivate(contexto(['leads.editar', 'leads.ver'], handler as never))).toThrow(ForbiddenException); // sem tarefas.ver
      expect(guarda.canActivate(contexto(['leads.editar', 'tarefas.ver'], handler as never))).toBe(true);
    }
    expect(() => guarda.canActivate(contexto(['leads.ver'], p.lerCondicoes as never))).toThrow(ForbiddenException); // sem tarefas.ver
    expect(() => guarda.canActivate(contexto(['tarefas.ver'], p.lerCondicoes as never))).toThrow(ForbiddenException); // sem leads.ver
    expect(guarda.canActivate(contexto(['leads.ver', 'tarefas.ver'], p.lerCondicoes as never))).toBe(true);
    expect(guarda.canActivate(contexto(['leads.ver'], p.lerProposta as never))).toBe(true);
  });

  it('o prefixo leads é do módulo leads: sem o módulo, as rotas novas respondem 404', async () => {
    const interceptor = new ModulosInterceptor({ modulosDaOrg: async () => new Set(['trabalho']) } as unknown as ModulosService);
    const ctx = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/leads/abc/aceite', user: { orgId: 'org-x' } }) }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of('passou') };
    await expect(lastValueFrom(interceptor.intercept(ctx, handler))).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// Com banco
// ---------------------------------------------------------------------------

const ORG_A = 'org-root49-a';
const ORG_B = 'org-root49-b';
const ORG_SEM_TRABALHO = 'org-root49-sem-trabalho';
const TODAS = [ORG_A, ORG_B, ORG_SEM_TRABALHO];

const URL = process.env.TEST_DATABASE_URL;
const URL_TENANT = process.env.TENANT_DATABASE_URL;
const RLS = process.env.RLS_NO_TESTE === '1';
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (empresas, usuários, leads, cards do Trabalho e auditoria da ROOT-49)');

const PROPOSTA = (extra: Partial<LeadPropostaRegistroInput> = {}): LeadPropostaRegistroInput =>
  LeadPropostaRegistroSchema.parse({ documento: { tipo: 'link', url: 'https://drive.exemplo/proposta-v1', sha256: SHA_DOC, titulo: 'Proposta v1' }, ...extra });

function casosContraOBanco(modoRls: boolean) {
  let admin: PrismaClient;
  let app: PrismaClient;
  let svc: LeadsService;
  let userA: string;
  let userB: string;
  let cardA: string;
  let cardB: string;
  let cardSemValor: string;
  let campoValorA: string;
  let campoPeriodicidadeA: string;
  let statusAbertoA: string;
  let statusFechadoA: string;
  let listaA: string;
  let leadSeq = 0;

  const ator = (over: Partial<AtorDaEntrada> = {}): AtorDaEntrada => ({
    sub: userA,
    orgId: ORG_A,
    permissions: ['leads.ver', 'leads.editar', 'tarefas.ver'],
    ...over,
  });
  const em = <T>(orgId: string, fn: () => Promise<T>) => comContexto({ orgId, correlationId: novaCorrelacao() }, fn);
  const eventos = (leadId: string, type: string) => admin.leadEvent.findMany({ where: { leadId, type }, orderBy: { occurredAt: 'asc' } });
  const auditorias = (leadId: string, action: string) => admin.auditLog.count({ where: { entityId: leadId, action } });

  /** Um lead novo da empresa A, de origem manual (sem card ligado) ou de origem clickup (card pelo externalId). */
  async function novoLead(origem: { tipo: 'manual' | 'clickup'; ref: string }, orgId = ORG_A): Promise<string> {
    leadSeq += 1;
    const a = ator({ orgId, sub: orgId === ORG_B ? userB : userA });
    const r = await em(orgId, () => svc.entrada(a, LeadEntradaSchema.parse({ origem, nome: `Lead ${leadSeq}` })));
    return r.id;
  }
  /** O id do lead é a origem, então cada lead de origem `clickup` precisa do seu próprio card (o `externalId` é a origem). */
  async function leadClickup(valor = 'BRL 1500.00'): Promise<{ lead: string; card: string }> {
    const externalId = `cu-${++leadSeq}-${modoRls ? 'rls' : 'dona'}`;
    const card = await criarCard(ORG_A, listaA, statusAbertoA, { valor, periodicidade: 'Mensal' }, { externalId });
    return { lead: await novoLead({ tipo: 'clickup', ref: externalId }), card };
  }
  const registrar = (leadId: string, input: LeadPropostaRegistroInput, a = ator()) => em(a.orgId, () => svc.registrarProposta(a, leadId, input));
  const decidir = (leadId: string, input: LeadDecisaoInput, a = ator()) => em(a.orgId, () => svc.decidir(a, leadId, input));
  const condicoes = (leadId: string, cardId?: string, orgId = ORG_A) => em(orgId, () => svc.lerCondicoes(orgId, leadId, cardId));
  const proposta = (leadId: string, orgId = ORG_A) => em(orgId, () => svc.lerProposta(orgId, leadId));
  const aceite = (hash: string, extra: Record<string, unknown> = {}): LeadDecisaoInput =>
    LeadDecisaoSchema.parse({
      decisao: 'aceite',
      condicoesHash: hash,
      evidencia: { tipo: 'link', url: 'https://drive.exemplo/aceite-assinado?t=segredo' },
      ...extra,
    });

  async function criarCard(orgId: string, lista: string, status: string, campos: { valor: string; periodicidade: string }, opts: { externalId?: string; semValor?: boolean; dueDate?: Date } = {}) {
    const tarefa = await admin.workTask.create({
      data: { orgId, listId: lista, statusId: status, title: `Card ${opts.externalId ?? 'avulso'}`, externalId: opts.externalId, dueDate: opts.dueDate },
    });
    const campo = await admin.workField.findFirstOrThrow({ where: { orgId, name: 'Valor em negociação' } });
    const per = await admin.workField.findFirstOrThrow({ where: { orgId, name: 'Periodicidade' } });
    if (!opts.semValor) await admin.workFieldValue.create({ data: { taskId: tarefa.id, fieldId: campo.id, value: campos.valor } });
    const opcao = await admin.workFieldOption.findFirstOrThrow({ where: { fieldId: per.id, name: campos.periodicidade } });
    await admin.workFieldValue.create({ data: { taskId: tarefa.id, fieldId: per.id, optionId: opcao.id } });
    return tarefa.id;
  }
  const mudarValor = (cardId: string, valor: string) =>
    admin.workFieldValue.updateMany({ where: { taskId: cardId, fieldId: campoValorA }, data: { value: valor } });

  async function limpar() {
    await admin.auditLog.deleteMany({ where: { orgId: { in: TODAS } } });
    await admin.leadEvent.deleteMany({ where: { lead: { orgId: { in: TODAS } } } });
    await admin.lead.deleteMany({ where: { orgId: { in: TODAS } } });
    await admin.workFieldValue.deleteMany({ where: { task: { orgId: { in: TODAS } } } });
    await admin.workTask.deleteMany({ where: { orgId: { in: TODAS } } });
    await admin.workFieldOption.deleteMany({ where: { field: { orgId: { in: TODAS } } } });
    await admin.workField.deleteMany({ where: { orgId: { in: TODAS } } });
    await admin.workStatus.deleteMany({ where: { list: { orgId: { in: TODAS } } } });
    await admin.workList.deleteMany({ where: { orgId: { in: TODAS } } });
    await admin.user.deleteMany({ where: { orgId: { in: TODAS } } });
    await admin.org.deleteMany({ where: { id: { in: TODAS } } });
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    await admin.$connect();
    await limpar();
    const orgs: Array<[string, string[]]> = [
      [ORG_A, ['leads', 'trabalho']],
      [ORG_B, ['leads', 'trabalho']],
      [ORG_SEM_TRABALHO, ['leads']],
    ];
    for (const [id, mods] of orgs) await admin.org.create({ data: { id, name: id, slug: id, modulos: mods } });
    const usuario = (id: string, orgId: string) =>
      admin.user.create({ data: { id, orgId, email: `${id}@root49.teste`, name: `Usuário ${id}`, passwordHash: 'sem-senha-util', isActive: true } });
    userA = (await usuario(`root49-ua${modoRls ? '-rls' : ''}`, ORG_A)).id;
    userB = (await usuario(`root49-ub${modoRls ? '-rls' : ''}`, ORG_B)).id;
    await usuario('root49-usm', ORG_SEM_TRABALHO);

    for (const orgId of [ORG_A, ORG_B]) {
      const lista = await admin.workList.create({ data: { orgId, name: 'Gestão de Leads' } });
      const aberto = await admin.workStatus.create({ data: { listId: lista.id, name: 'enviar orçamento', type: 'custom' } });
      const fechado = await admin.workStatus.create({ data: { listId: lista.id, name: 'fechado', type: 'closed' } });
      const valorField = await admin.workField.create({ data: { orgId, listId: lista.id, name: 'Valor em negociação', type: 'moeda' } });
      const perField = await admin.workField.create({ data: { orgId, listId: lista.id, name: 'Periodicidade', type: 'drop_down' } });
      await admin.workFieldOption.createMany({ data: [{ fieldId: perField.id, name: 'Mensal' }, { fieldId: perField.id, name: 'Anual' }] });
      await admin.workField.create({ data: { orgId, listId: lista.id, name: 'Vendedor', type: 'drop_down' } });
      if (orgId === ORG_A) {
        listaA = lista.id;
        statusAbertoA = aberto.id;
        statusFechadoA = fechado.id;
        campoValorA = valorField.id;
        campoPeriodicidadeA = perField.id;
        cardA = await criarCard(orgId, lista.id, aberto.id, { valor: 'BRL 1500.00', periodicidade: 'Mensal' }, { externalId: 'cu-card-a' });
        cardSemValor = await criarCard(orgId, lista.id, aberto.id, { valor: 'BRL 0.00', periodicidade: 'Anual' }, { externalId: 'cu-card-sem-valor', semValor: true });
      } else {
        cardB = await criarCard(orgId, lista.id, aberto.id, { valor: 'BRL 999.00', periodicidade: 'Anual' }, { externalId: 'cu-card-b' });
      }
    }

    let prismaDoServico: PrismaClient = admin;
    if (modoRls) {
      app = new PrismaClient({ datasourceUrl: URL_TENANT });
      await app.$connect();
      prismaDoServico = comTenantNaSessao(app, { modo: 'impor', avisar: () => undefined });
    }
    const p = prismaDoServico as unknown as PrismaService;
    svc = new LeadsService(p, new AuditService(p), new ModulosService(p));
  }, 60_000);

  afterAll(async () => {
    await limpar();
    await admin.$disconnect();
    if (app) await app.$disconnect();
  });

  it('a conexão do serviço é a esperada: dona sem RLS, ou mktos_app em modo impor', async () => {
    if (!modoRls) return;
    const [{ u, rls, sup }] = await app.$queryRaw<{ u: string; rls: boolean; sup: boolean }[]>`
      SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rls,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS sup`;
    expect({ u, rls, sup }).toEqual({ u: 'mktos_app', rls: false, sup: false });
    // Sem empresa no contexto, a consulta lança (o modo impor).
    await expect(svc.lerProposta(ORG_A, 'qualquer')).rejects.toBeDefined();
  });

  it('lê as condições do card do lead de origem clickup, sem copiar nada para o lead', async () => {
    const { lead, card: cardDoLead } = await leadClickup();
    const lido = await condicoes(lead);
    expect(lido.card?.id).toBe(cardDoLead);
    expect(lido.card?.titulo).toMatch(/^Card cu-/);
    expect(lido.motivo).toBeNull();
    expect(lido.propostaVigente).toBeNull();
    expect(lido.condicoes).toMatchObject({ cardId: cardDoLead, inicio: null, vencimento: null });
    expect(lido.condicoes!.campos.map((c) => [c.tipo, c.valor]).sort()).toEqual([['moeda', 'BRL 1500.00'], ['periodicidade', 'Mensal']]);
    expect(lido.hash).toBe(hashDasCondicoes(lido.condicoes!));
    // Lida, não copiada: o lead e a timeline seguem sem nenhum valor.
    const bruto = JSON.stringify([await admin.lead.findFirstOrThrow({ where: { id: lead } }), await admin.leadEvent.findMany({ where: { leadId: lead } })]);
    expect(bruto).not.toContain('1500');
  });

  it('registra a proposta: um evento com o documento e o hash das condições, e um AuditLog no nível do RASTRO', async () => {
    const { lead, card: cardDoLead } = await leadClickup();
    const antes = await proposta(lead);
    expect(antes).toEqual({ estado: 'sem_proposta', proposta: null, decisao: null });
    const lido = await condicoes(lead);
    const r = await registrar(lead, PROPOSTA());
    expect(r).toMatchObject({ id: lead, replayed: false, cardId: cardDoLead, condicoesHash: lido.hash });
    const [ev] = await eventos(lead, 'proposta');
    expect(ev.id).toBe(r.eventoId);
    expect(ev.payload).toMatchObject({
      documento: { tipo: 'link', url: 'https://drive.exemplo/proposta-v1', sha256: SHA_DOC, titulo: 'Proposta v1' },
      cardId: cardDoLead,
      condicoesHash: lido.hash,
      ator: userA,
    });
    const [aud] = await admin.auditLog.findMany({ where: { entityId: lead, action: 'lead.proposta' } });
    expect(aud).toMatchObject({ orgId: ORG_A, actorId: userA, entityType: 'lead' });
    expect(aud.after).toEqual({
      eventoId: r.eventoId,
      cardId: cardDoLead,
      condicoesHash: lido.hash,
      documento: { tipo: 'link', sha256: SHA_DOC, origem: 'https://drive.exemplo' },
    });
    expect(JSON.stringify(aud)).not.toContain('proposta-v1');
    const depois = await proposta(lead);
    expect(depois.estado).toBe('proposta_registrada');
    expect(depois.proposta).toMatchObject({ eventoId: r.eventoId, cardId: cardDoLead, condicoesHash: lido.hash });
    expect((await condicoes(lead)).propostaVigente).toBe(true);
  });

  it('o mesmo documento nas mesmas condições é no-op: um evento, um AuditLog', async () => {
    const { lead } = await leadClickup();
    const a = await registrar(lead, PROPOSTA());
    const b = await registrar(lead, PROPOSTA());
    expect(b).toMatchObject({ replayed: true, eventoId: a.eventoId });
    expect(await eventos(lead, 'proposta')).toHaveLength(1);
    expect(await auditorias(lead, 'lead.proposta')).toBe(1);
    // Outro documento (outro hash) é outra proposta.
    const c = await registrar(lead, LeadPropostaRegistroSchema.parse({ documento: { tipo: 'link', url: 'https://drive.exemplo/proposta-v2', sha256: sha('v2') } }));
    expect(c.replayed).toBe(false);
    expect(await eventos(lead, 'proposta')).toHaveLength(2);
  });

  it('registra o aceite com evidência e o hash: evento de id determinístico, estado, RASTRO, e NENHUM contrato nem lançamento financeiro', async () => {
    const { lead, card: cardDoLead } = await leadClickup();
    const p = await registrar(lead, PROPOSTA());
    const contratosAntes = await admin.contract.count({ where: { orgId: ORG_A } });
    const lancamentosAntes = await admin.financeTransaction.count({ where: { orgId: ORG_A } });

    const r = await decidir(lead, aceite(p.condicoesHash, { motivo: 'Fechou por telefone' }));
    expect(r).toMatchObject({ id: lead, decisao: 'aceite', replayed: false, evidenciaIgual: true, propostaEventoId: p.eventoId, condicoesHash: p.condicoesHash });
    expect(r.eventoId).toBe(eventoIdDaDecisao(ORG_A, lead, 'aceite', p.condicoesHash));
    const [ev] = await eventos(lead, 'aceite');
    expect(ev.id).toBe(r.eventoId);
    expect(ev.payload).toMatchObject({
      propostaEventoId: p.eventoId,
      cardId: cardDoLead,
      condicoesHash: p.condicoesHash,
      evidencia: { tipo: 'link', url: 'https://drive.exemplo/aceite-assinado?t=segredo' },
      motivo: 'Fechou por telefone',
      ator: userA,
    });
    const [aud] = await admin.auditLog.findMany({ where: { entityId: lead, action: 'lead.aceite' } });
    expect(aud.after).toMatchObject({
      eventoId: r.eventoId,
      propostaEventoId: p.eventoId,
      condicoesHash: p.condicoesHash,
      evidencia: { tipo: 'link', origem: 'https://drive.exemplo' },
      comMotivo: true,
    });
    const rastro = JSON.stringify(aud);
    for (const proibido of ['aceite-assinado', 'segredo', 'Fechou por telefone']) expect(rastro).not.toContain(proibido);

    const lido = await proposta(lead);
    expect(lido.estado).toBe('aceite_registrado');
    expect(lido.decisao).toMatchObject({ eventoId: r.eventoId, decisao: 'aceite', propostaEventoId: p.eventoId });
    // C-04: a proposta aceita é um fato comercial; contrato e lançamento são outro objeto.
    expect(await admin.contract.count({ where: { orgId: ORG_A } })).toBe(contratosAntes);
    expect(await admin.financeTransaction.count({ where: { orgId: ORG_A } })).toBe(lancamentosAntes);
    // A etapa do lead não mudou: aceite não escreve Lead.status.
    expect((await admin.lead.findFirstOrThrow({ where: { id: lead } })).status).toBe('novo');
  });

  it('a evidência por arquivo (com sha256) e por mensagem também vale; o texto fica só no evento', async () => {
    const { lead } = await leadClickup();
    const p = await registrar(lead, PROPOSTA());
    const msg = LeadDecisaoSchema.parse({
      decisao: 'aceite',
      condicoesHash: p.condicoesHash,
      evidencia: { tipo: 'mensagem', canal: 'whatsapp', texto: 'Aceito, pode mandar o contrato. Maria', recebidaEm: '2026-10-02T14:00:00.000Z' },
    });
    const r = await decidir(lead, msg);
    expect(r.replayed).toBe(false);
    const [ev] = await eventos(lead, 'aceite');
    expect(ev.payload).toMatchObject({ evidencia: { tipo: 'mensagem', canal: 'whatsapp', texto: 'Aceito, pode mandar o contrato. Maria' } });
    const [aud] = await admin.auditLog.findMany({ where: { entityId: lead, action: 'lead.aceite' } });
    expect(JSON.stringify(aud)).not.toContain('contrato. Maria');
    expect(aud.after).toMatchObject({ evidencia: { tipo: 'mensagem', canal: 'whatsapp' } });

    const { lead: lead2 } = await leadClickup();
    const p2 = await registrar(lead2, PROPOSTA());
    const arq = await decidir(lead2, aceite(p2.condicoesHash, { evidencia: { tipo: 'arquivo', nome: 'aceite-assinado.pdf', sha256: SHA_ARQ } }));
    expect(arq.replayed).toBe(false);
    const [ev2] = await eventos(lead2, 'aceite');
    expect(ev2.payload).toMatchObject({ evidencia: { tipo: 'arquivo', nome: 'aceite-assinado.pdf', sha256: SHA_ARQ } });
  });

  it('reenviar o mesmo aceite é no-op (um evento, um AuditLog); evidência diferente nas mesmas condições também, e diz que difere', async () => {
    const { lead } = await leadClickup();
    const p = await registrar(lead, PROPOSTA());
    const a = await decidir(lead, aceite(p.condicoesHash));
    const b = await decidir(lead, aceite(p.condicoesHash));
    expect(b).toMatchObject({ replayed: true, evidenciaIgual: true, eventoId: a.eventoId, propostaEventoId: p.eventoId });
    const c = await decidir(lead, aceite(p.condicoesHash, { evidencia: { tipo: 'link', url: 'https://outro.exemplo/aceite' } }));
    expect(c).toMatchObject({ replayed: true, evidenciaIgual: false, eventoId: a.eventoId });
    expect(await eventos(lead, 'aceite')).toHaveLength(1);
    expect(await auditorias(lead, 'lead.aceite')).toBe(1);
  });

  it('o aceite repetido segue sendo repetição mesmo depois de o card mudar (não vira 409)', async () => {
    const lead = await novoLead({ tipo: 'manual', ref: 'repete-apos-mudar' });
    const card = await criarCard(ORG_A, listaA, statusAbertoA, { valor: 'BRL 700.00', periodicidade: 'Mensal' });
    const p = await registrar(lead, PROPOSTA({ cardId: card }));
    await decidir(lead, aceite(p.condicoesHash));
    await mudarValor(card, 'BRL 800.00');
    expect(await decidir(lead, aceite(p.condicoesHash))).toMatchObject({ replayed: true });
    expect(await eventos(lead, 'aceite')).toHaveLength(1);
  });

  it('hash diferente do card atual: 409 com a diferença e o hash de agora, e nada é gravado', async () => {
    const lead = await novoLead({ tipo: 'manual', ref: 'hash-diferente' });
    const card = await criarCard(ORG_A, listaA, statusAbertoA, { valor: 'BRL 1000.00', periodicidade: 'Mensal' });
    const p = await registrar(lead, PROPOSTA({ cardId: card }));
    const vistas = (await condicoes(lead)).condicoes as LeadCondicoes;
    await mudarValor(card, 'BRL 1200.00');

    const erro = await decidir(lead, aceite(p.condicoesHash, { condicoesVistas: vistas })).catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    const corpo = erro.getResponse() as LeadCondicoesMudaramCorpo;
    expect(corpo.message).toMatch(/mudaram/);
    expect(corpo.diferenca).toEqual([{ chave: `campo:${campoValorA}`, rotulo: 'Valor em negociação', vista: 'BRL 1000.00', atual: 'BRL 1200.00' }]);
    expect(corpo.atual.campos.find((c) => c.tipo === 'moeda')?.valor).toBe('BRL 1200.00');
    expect(corpo.atualHash).toBe(hashDasCondicoes(corpo.atual));
    expect(corpo.atualHash).not.toBe(p.condicoesHash);
    expect(await eventos(lead, 'aceite')).toHaveLength(0);
    expect(await auditorias(lead, 'lead.aceite')).toBe(0);

    // Sem `condicoesVistas` o 409 vem igual, só que sem a diferença campo a campo.
    const semVistas = (await decidir(lead, aceite(p.condicoesHash)).catch((e) => e)) as ConflictException;
    expect((semVistas.getResponse() as LeadCondicoesMudaramCorpo).diferenca).toBeNull();
    expect((await proposta(lead)).estado).toBe('proposta_registrada');
    expect((await condicoes(lead)).propostaVigente).toBe(false);
  });

  it('com o hash novo do card, o aceite só vale depois de registrar a proposta de novo; e voltar ao valor antigo reabre a proposta antiga', async () => {
    const lead = await novoLead({ tipo: 'manual', ref: 'proposta-defasada' });
    const card = await criarCard(ORG_A, listaA, statusAbertoA, { valor: 'BRL 2000.00', periodicidade: 'Mensal' });
    const p1 = await registrar(lead, PROPOSTA({ cardId: card }));
    await mudarValor(card, 'BRL 2500.00');
    const hashNovo = (await condicoes(lead)).hash!;
    const erro = (await decidir(lead, aceite(hashNovo)).catch((e) => e)) as ConflictException;
    expect(erro).toBeInstanceOf(ConflictException);
    expect(erro.message).toMatch(/outras condições/);
    expect(await eventos(lead, 'aceite')).toHaveLength(0);

    const p2 = await registrar(lead, PROPOSTA({ cardId: card }));
    expect(p2.condicoesHash).toBe(hashNovo);
    expect(p2.eventoId).not.toBe(p1.eventoId);
    const ok = await decidir(lead, aceite(hashNovo));
    expect(ok).toMatchObject({ replayed: false, propostaEventoId: p2.eventoId });

    // O card volta ao valor da primeira proposta: a primeira proposta volta a valer (mesmo registro = no-op, mesmo evento).
    await mudarValor(card, 'BRL 2000.00');
    const volta = await decidir(lead, aceite(p1.condicoesHash));
    expect(volta).toMatchObject({ replayed: false, propostaEventoId: p1.eventoId });
    expect(await eventos(lead, 'aceite')).toHaveLength(2);
  });

  it('renomear o campo (corrigir a grafia da lista real) não muda o hash: a proposta segue vigente e o aceite com o hash antigo passa', async () => {
    const { lead, card: cardDoLead } = await leadClickup();
    const NOME = 'Valor em negociação';
    const GRAFIA_ANTIGA = 'Valor em negocição';
    try {
      await admin.workField.update({ where: { id: campoValorA }, data: { name: GRAFIA_ANTIGA } });
      const antes = await condicoes(lead);
      expect(antes.condicoes!.campos.find((c) => c.campoId === campoValorA)?.nome).toBe(GRAFIA_ANTIGA);
      const p = await registrar(lead, PROPOSTA());
      expect(p.condicoesHash).toBe(antes.hash);

      await admin.workField.update({ where: { id: campoValorA }, data: { name: NOME } });
      const depois = await condicoes(lead);
      // O nome novo aparece para a pessoa, o hash e a vigência não se mexem.
      expect(depois.condicoes!.campos.find((c) => c.campoId === campoValorA)?.nome).toBe(NOME);
      expect(depois.hash).toBe(antes.hash);
      expect(depois.propostaVigente).toBe(true);
      expect(diferencaDasCondicoes(antes.condicoes!, depois.condicoes!)).toEqual([]);

      const r = await decidir(lead, aceite(p.condicoesHash, { condicoesVistas: antes.condicoes }));
      expect(r).toMatchObject({ decisao: 'aceite', replayed: false, propostaEventoId: p.eventoId });
      expect(await eventos(lead, 'aceite')).toHaveLength(1);
      // Registrar de novo o mesmo documento depois da renomeação é o mesmo registro, não uma proposta nova.
      expect(await registrar(lead, PROPOSTA())).toMatchObject({ replayed: true, eventoId: p.eventoId, cardId: cardDoLead });
      expect(await eventos(lead, 'proposta')).toHaveLength(1);
    } finally {
      await admin.workField.update({ where: { id: campoValorA }, data: { name: NOME } });
    }
  });

  it('D3: qualquer proposta registrada com as condições de agora vale (o critério da decisão), e a leitura aponta qual', async () => {
    const lead = await novoLead({ tipo: 'manual', ref: 'vigente-qualquer' });
    const card = await criarCard(ORG_A, listaA, statusAbertoA, { valor: 'BRL 4000.00', periodicidade: 'Mensal' });
    const p1 = await registrar(lead, PROPOSTA({ cardId: card }));
    await mudarValor(card, 'BRL 4500.00');
    const meio = await condicoes(lead);
    expect(meio).toMatchObject({ propostaVigente: false, propostaVigenteResumo: null });
    const p2 = await registrar(lead, PROPOSTA({ cardId: card }));
    expect(p2.condicoesHash).not.toBe(p1.condicoesHash);
    expect((await condicoes(lead))).toMatchObject({ propostaVigente: true, propostaVigenteResumo: { eventoId: p2.eventoId } });

    // O card volta ao valor da v1: a última registrada é a v2, mas a vigente é a v1.
    await mudarValor(card, 'BRL 4000.00');
    const volta = await condicoes(lead);
    expect(volta.hash).toBe(p1.condicoesHash);
    expect(volta.propostaVigente).toBe(true);
    expect(volta.propostaVigenteResumo).toMatchObject({ eventoId: p1.eventoId, condicoesHash: p1.condicoesHash, cardId: card });
    expect((await proposta(lead)).proposta?.eventoId).toBe(p2.eventoId);
    // E é a v1 que a decisão cita, como a tela mostra.
    expect(await decidir(lead, aceite(volta.hash!))).toMatchObject({ replayed: false, propostaEventoId: p1.eventoId });
  });

  it('D1 (comportamento atual, PENDENTE DE DECISÃO do Pedro e do Rodrigo): aceite, recusa e aceite de novo devolve replayed e o estado fica na recusa', async () => {
    // Não é a regra desejada: é o que o código faz hoje, registrado para que a troca de decisão seja uma escolha e não um acidente.
    // Quando a regra mudar (409 "a decisão mais recente é a recusa", ou id que inclua a decisão anterior), este caso muda junto.
    const { lead } = await leadClickup();
    const p = await registrar(lead, PROPOSTA());
    const a1 = await decidir(lead, aceite(p.condicoesHash));
    expect(a1).toMatchObject({ decisao: 'aceite', replayed: false });
    const r = await decidir(lead, aceite(p.condicoesHash, { decisao: 'recusa', motivo: 'Voltou atrás' }));
    expect(r).toMatchObject({ decisao: 'recusa', replayed: false });
    expect((await proposta(lead)).estado).toBe('recusa_registrada');

    const a2 = await decidir(lead, aceite(p.condicoesHash));
    expect(a2).toMatchObject({ decisao: 'aceite', replayed: true, eventoId: a1.eventoId });
    expect(await eventos(lead, 'aceite')).toHaveLength(1);
    expect(await eventos(lead, 'recusa')).toHaveLength(1);
    expect(await auditorias(lead, 'lead.aceite')).toBe(1);
    expect((await proposta(lead)).estado).toBe('recusa_registrada');
  });

  it('aceite antes de existir proposta é 409; condicoesVistas que não bate com o hash é 400', async () => {
    const { lead } = await leadClickup();
    const h = (await condicoes(lead)).hash!;
    await expect(decidir(lead, aceite(h))).rejects.toThrow(/Registre a proposta antes/);
    const vistas = (await condicoes(lead)).condicoes as LeadCondicoes;
    await expect(decidir(lead, aceite(hex('f'), { condicoesVistas: vistas }))).rejects.toBeInstanceOf(BadRequestException);
    expect(await eventos(lead, 'aceite')).toHaveLength(0);
  });

  it('a recusa é registrada do mesmo jeito (evento próprio, evidência, no-op ao repetir) e não impede um aceite depois', async () => {
    const { lead } = await leadClickup();
    const p = await registrar(lead, PROPOSTA());
    const recusa = aceite(p.condicoesHash, { decisao: 'recusa', motivo: 'Achou caro' });
    const a = await decidir(lead, recusa);
    expect(a).toMatchObject({ decisao: 'recusa', replayed: false });
    expect(a.eventoId).toBe(eventoIdDaDecisao(ORG_A, lead, 'recusa', p.condicoesHash));
    expect(await decidir(lead, recusa)).toMatchObject({ replayed: true, eventoId: a.eventoId });
    expect(await eventos(lead, 'recusa')).toHaveLength(1);
    expect(await auditorias(lead, 'lead.recusa')).toBe(1);
    expect(await eventos(lead, 'aceite')).toHaveLength(0);
    expect((await proposta(lead)).estado).toBe('recusa_registrada');

    const depois = await decidir(lead, aceite(p.condicoesHash));
    expect(depois).toMatchObject({ decisao: 'aceite', replayed: false });
    expect(depois.eventoId).not.toBe(a.eventoId);
    expect((await proposta(lead)).estado).toBe('aceite_registrado');
  });

  it('mover o card para "fechado" não grava aceite', async () => {
    const lead = await novoLead({ tipo: 'manual', ref: 'fechado-sem-aceite' });
    const card = await criarCard(ORG_A, listaA, statusAbertoA, { valor: 'BRL 3000.00', periodicidade: 'Anual' });
    await registrar(lead, PROPOSTA({ cardId: card }));
    await admin.workTask.update({ where: { id: card }, data: { statusId: statusFechadoA } });
    expect(await eventos(lead, 'aceite')).toHaveLength(0);
    expect(await eventos(lead, 'recusa')).toHaveLength(0);
    expect(await auditorias(lead, 'lead.aceite')).toBe(0);
    expect((await proposta(lead)).estado).toBe('proposta_registrada');
    // O card fechado não muda as condições: o hash é o mesmo e o aceite continua sendo um ato explícito.
    expect((await condicoes(lead)).propostaVigente).toBe(true);
  });

  it('lead sem card ligado: 409 com o motivo; card sem valor em negociação: 409; card de outra empresa: 404', async () => {
    const semCard = await novoLead({ tipo: 'manual', ref: 'sem-card' });
    expect(await condicoes(semCard)).toMatchObject({ card: null, condicoes: null, hash: null, motivo: expect.stringMatching(/não tem card/) });
    await expect(registrar(semCard, PROPOSTA())).rejects.toThrow(/não tem card/);

    const clickupSemImportar = await novoLead({ tipo: 'clickup', ref: 'cu-nao-importado' });
    expect((await condicoes(clickupSemImportar)).motivo).toMatch(/ainda não foi importado/);
    await expect(registrar(clickupSemImportar, PROPOSTA())).rejects.toThrow(/ainda não foi importado/);

    const lead = await novoLead({ tipo: 'manual', ref: 'card-sem-valor' });
    const lido = await condicoes(lead, cardSemValor);
    expect(lido.motivo).toMatch(/valor em negociação/);
    expect(lido.condicoes).not.toBeNull();
    await expect(registrar(lead, PROPOSTA({ cardId: cardSemValor }))).rejects.toBeInstanceOf(ConflictException);

    await expect(registrar(lead, PROPOSTA({ cardId: cardB }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(condicoes(lead, cardB)).rejects.toBeInstanceOf(NotFoundException);
    await expect(registrar(lead, PROPOSTA({ cardId: 'nao-existe' }))).rejects.toBeInstanceOf(NotFoundException);
    for (const l of [semCard, clickupSemImportar, lead]) expect(await eventos(l, 'proposta')).toHaveLength(0);
  });

  it('lead de outra empresa é 404 em todas as operações, e nada é gravado', async () => {
    const leadB = await novoLead({ tipo: 'manual', ref: 'lead-da-b' }, ORG_B);
    const { lead: leadA, card: cardDeA } = await leadClickup();
    const pA = await registrar(leadA, PROPOSTA());

    // A empresa A pede o lead da B.
    await expect(proposta(leadB)).rejects.toBeInstanceOf(NotFoundException);
    await expect(condicoes(leadB)).rejects.toBeInstanceOf(NotFoundException);
    await expect(registrar(leadB, PROPOSTA({ cardId: cardDeA }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(decidir(leadB, aceite(pA.condicoesHash))).rejects.toBeInstanceOf(NotFoundException);
    // A empresa B pede o lead da A.
    const b = ator({ orgId: ORG_B, sub: userB });
    await expect(proposta(leadA, ORG_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(registrar(leadA, PROPOSTA({ cardId: cardB }), b)).rejects.toBeInstanceOf(NotFoundException);
    await expect(decidir(leadA, aceite(pA.condicoesHash), b)).rejects.toBeInstanceOf(NotFoundException);
    expect(await eventos(leadB, 'proposta')).toHaveLength(0);
    expect(await eventos(leadA, 'aceite')).toHaveLength(0);
    expect(await admin.auditLog.count({ where: { orgId: ORG_B, action: { startsWith: 'lead.' }, entityId: leadA } })).toBe(0);
  });

  it('sem o módulo trabalho (E15): condições, proposta e aceite respondem 404; o estado, que não lê o card, segue', async () => {
    const a = ator({ orgId: ORG_SEM_TRABALHO, sub: 'root49-usm' });
    const lead = await novoLead({ tipo: 'manual', ref: 'sem-modulo' }, ORG_SEM_TRABALHO);
    await expect(condicoes(lead, undefined, ORG_SEM_TRABALHO)).rejects.toBeInstanceOf(NotFoundException);
    await expect(registrar(lead, PROPOSTA(), a)).rejects.toBeInstanceOf(NotFoundException);
    await expect(decidir(lead, aceite(hex('a')), a)).rejects.toBeInstanceOf(NotFoundException);
    expect(await proposta(lead, ORG_SEM_TRABALHO)).toEqual({ estado: 'sem_proposta', proposta: null, decisao: null });
  });

  it('chamadas simultâneas do mesmo aceite: um evento, um AuditLog, uma só gravou (Postgres real)', async () => {
    const { lead } = await leadClickup();
    const p = await registrar(lead, PROPOSTA());
    const respostas = await Promise.all(Array.from({ length: 12 }, () => decidir(lead, aceite(p.condicoesHash))));
    expect(new Set(respostas.map((r) => r.eventoId)).size).toBe(1);
    expect(respostas.filter((r) => !r.replayed)).toHaveLength(1);
    expect(respostas.filter((r) => r.replayed)).toHaveLength(11);
    expect(await eventos(lead, 'aceite')).toHaveLength(1);
    expect(await auditorias(lead, 'lead.aceite')).toBe(1);
  });

  it('aceites simultâneos com evidências diferentes nas mesmas condições: um evento; quem perdeu é avisada de que a evidência difere', async () => {
    const { lead } = await leadClickup();
    const p = await registrar(lead, PROPOSTA());
    const variantes = Array.from({ length: 6 }, (_, i) => aceite(p.condicoesHash, { evidencia: { tipo: 'link', url: `https://exemplo.com/aceite-${i}` } }));
    const respostas = await Promise.all(variantes.map((v) => decidir(lead, v)));
    expect(await eventos(lead, 'aceite')).toHaveLength(1);
    expect(respostas.filter((r) => !r.replayed)).toHaveLength(1);
    expect(respostas.filter((r) => r.replayed && !r.evidenciaIgual)).toHaveLength(5);
  });

  it('propostas simultâneas iguais: um evento', async () => {
    const { lead } = await leadClickup();
    const respostas = await Promise.all(Array.from({ length: 10 }, () => registrar(lead, PROPOSTA())));
    expect(respostas.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await eventos(lead, 'proposta')).toHaveLength(1);
    expect(await auditorias(lead, 'lead.proposta')).toBe(1);
  });

  it('periodicidade e datas do card entram nas condições: mudar qualquer uma muda o hash', async () => {
    const lead = await novoLead({ tipo: 'manual', ref: 'periodicidade' });
    const card = await criarCard(ORG_A, listaA, statusAbertoA, { valor: 'BRL 500.00', periodicidade: 'Mensal' }, { dueDate: new Date('2026-12-15T00:00:00Z') });
    const h0 = (await condicoes(lead, card)).hash!;
    const anual = await admin.workFieldOption.findFirstOrThrow({ where: { fieldId: campoPeriodicidadeA, name: 'Anual' } });
    await admin.workFieldValue.updateMany({ where: { taskId: card, fieldId: campoPeriodicidadeA }, data: { optionId: anual.id } });
    const h1 = (await condicoes(lead, card)).hash!;
    expect(h1).not.toBe(h0);
    await admin.workTask.update({ where: { id: card }, data: { dueDate: new Date('2027-01-15T00:00:00Z') } });
    const h2 = (await condicoes(lead, card)).hash!;
    expect(new Set([h0, h1, h2]).size).toBe(3);
    const lido = await condicoes(lead, card);
    expect(lido.condicoes).toMatchObject({ vencimento: '2027-01-15T00:00:00.000Z' });
    expect(lido.condicoes!.campos.find((c) => c.tipo === 'periodicidade')?.valor).toBe('Anual');
  });
}

describe.skipIf(!URL)('ROOT-49: proposta e aceite contra o Postgres descartável (conexão dona)', () => casosContraOBanco(false));

if (URL && URL_TENANT && RLS) describe('ROOT-49: os mesmos casos sob RLS (mktos_app, TENANT_MODO=impor)', () => casosContraOBanco(true));
