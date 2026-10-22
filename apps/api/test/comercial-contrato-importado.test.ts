import { Readable } from 'node:stream';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { classificar } from '@mktos/policy';
import {
  LigarReguaDoImportadoSchema,
  ParcelasDoImportadoSchema,
  diaDeVerdade,
  fraseDeLigarARegua,
  linhasDoLancamento,
  numerarParcelas,
  parcelasEmSerie,
  somaDasParcelas,
} from '@mktos/shared';

import type { ArmazemDoAnexo } from '../src/comercial/anexo-do-contrato';
import { ConfigComercialService } from '../src/comercial/config.service';
import { chaveDoAnexoImportado, estadoDoImportado } from '../src/comercial/contrato-importado';
import { ContratoImportadoService, EFEITO_DO_CONTRATO_IMPORTADO } from '../src/comercial/contrato-importado.service';
import { ContratoVivoService } from '../src/comercial/contrato-vivo.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { eventoIdComercial, resumoDoEvento } from '../src/comercial/eventos';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { SoGenteGuard } from '../src/comercial/mover.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O CONTRATO IMPORTADO DO CRM ANTIGO: O PDF E AS PARCELAS À MÃO (produção 22, M2).
 *
 *  1. as contas puras: dia de verdade, série mensal, numeração, soma em centavos, a frase de ligar;
 *  2. o PDF: o mesmo fato `contrato.anexado` com `procedencia: 'importado'`, o aviso some, o mesmo
 *     PDF não grava nada, outro PDF é versão nova (o anterior fica no fio), não-PDF recusado,
 *     sem `leads.editar` recusado, conta de máquina recusada (no token e no serviço);
 *  3. as parcelas: soma, datas de São Paulo, versão condicionada (409), edição travada com a régua ligada;
 *  4. a régua: desligada, o relógio passa com parcela vencida e não grava nada; ligar exige a ciência e a
 *     versão vista; ligada, a MESMA régua avisa (D+10 abre decisão), sem repetir, e parcela paga não avisa;
 *  5. nada de cobrança nova: nenhuma `ComercialCobranca`, nenhum `Contract`, nenhuma aprovação, nenhuma mensagem.
 */

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const OUTRO_PDF = Buffer.from('%PDF-1.7\n% versao assinada com aditivo\n%%EOF\n', 'latin1');
const ORIGEM = 'cartao:crm-sintetico-1';

describe('contrato importado: as contas puras', () => {
  it('dia de verdade recusa 31/02 e formato torto', () => {
    expect(diaDeVerdade('2026-02-28')).toBe(true);
    expect(diaDeVerdade('2028-02-29')).toBe(true);
    expect(diaDeVerdade('2026-02-29')).toBe(false);
    expect(diaDeVerdade('2026-02-31')).toBe(false);
    expect(diaDeVerdade('26-02-01')).toBe(false);
  });

  it('a série é mensal e o dia que não existe cai no último do mês', () => {
    const s = parcelasEmSerie(4, 150_000, '2026-01-31');
    expect(s.map((l) => l.vence)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(somaDasParcelas(s)).toBe(600_000);
    expect(s.every((l) => l.pagaEm === null)).toBe(true);
  });

  it('numera na ordem do vencimento e a soma é em centavos inteiros', () => {
    const n = numerarParcelas([{ valorCentavos: 33_333, vence: '2026-03-10', pagaEm: null }, { valorCentavos: 33_334, vence: '2026-02-10', pagaEm: '2026-02-09' }]);
    expect(n.map((l) => [l.n, l.vence])).toEqual([[1, '2026-02-10'], [2, '2026-03-10']]);
    expect(somaDasParcelas(n)).toBe(66_667);
  });

  it('o schema recusa valor com centavo quebrado, data inexistente, as duas formas juntas e nenhuma', () => {
    expect(ParcelasDoImportadoSchema.safeParse({ origem: ORIGEM, versaoEsperada: 0, linhas: [{ valorCentavos: 100.5, vence: '2026-03-01' }] }).success).toBe(false);
    expect(ParcelasDoImportadoSchema.safeParse({ origem: ORIGEM, versaoEsperada: 0, linhas: [{ valorCentavos: 100, vence: '2026-02-30' }] }).success).toBe(false);
    expect(ParcelasDoImportadoSchema.safeParse({ origem: ORIGEM, versaoEsperada: 0 }).success).toBe(false);
    expect(ParcelasDoImportadoSchema.safeParse({ origem: ORIGEM, versaoEsperada: 0, serie: { quantidade: 2, valorCentavos: 100, primeiroVencimento: '2026-03-01' }, linhas: [{ valorCentavos: 100, vence: '2026-03-01' }] }).success).toBe(false);
    expect(ParcelasDoImportadoSchema.safeParse({ origem: 'qualquer', versaoEsperada: 0, serie: { quantidade: 2, valorCentavos: 100, primeiroVencimento: '2026-03-01' } }).success).toBe(false);
    const ok = ParcelasDoImportadoSchema.parse({ origem: ORIGEM, versaoEsperada: 0, serie: { quantidade: 3, valorCentavos: 100, primeiroVencimento: '2026-03-01' } });
    expect(linhasDoLancamento(ok).map((l) => l.n)).toEqual([1, 2, 3]);
    expect(LigarReguaDoImportadoSchema.safeParse({ origem: ORIGEM, versaoDasParcelas: 1, ciente: false }).success).toBe(false);
  });

  it('a frase de ligar diz o que acontece, sem travessão', () => {
    const f = fraseDeLigarARegua([{ valorCentavos: 100_000, vence: '2026-01-10', pagaEm: null }, { valorCentavos: 100_000, vence: '2026-12-10', pagaEm: null }, { valorCentavos: 50_000, vence: '2025-12-10', pagaEm: '2025-12-10' }], '2026-10-22');
    expect(f).toContain('2 parcelas em aberto');
    expect(f).toContain('R$ 2.000,00');
    expect(f).toContain('1 já venceu');
    expect(f).toContain('Nenhuma mensagem vai ao cliente e nenhuma cobrança nasce no Asaas');
    expect(f).not.toMatch(/[—–]/);
    expect(fraseDeLigarARegua([{ valorCentavos: 1, vence: '2026-01-01', pagaEm: '2026-01-01' }], '2026-10-22')).toMatch(/não gera aviso/);
  });

  it('o efeito das escritas é interno: R0 pela escada', () => {
    expect(classificar(EFEITO_DO_CONTRATO_IMPORTADO)).toBe('R0');
  });

  it('o estado lê o PDF mais novo, a versão mais nova das parcelas, a régua e o aviso', () => {
    const em = (d: string) => new Date(`${d}T12:00:00-03:00`);
    const fatos = [
      { type: 'contrato.anexado', occurredAt: em('2026-10-20'), payload: { procedencia: 'importado', contratoImportado: ORIGEM, versao: 1, nome: 'a.pdf', bytes: 10, sha256: 'a'.repeat(64) } },
      { type: 'contrato.anexado', occurredAt: em('2026-10-21'), payload: { procedencia: 'importado', contratoImportado: ORIGEM, versao: 2, nome: 'b.pdf', bytes: 20, sha256: 'b'.repeat(64), por: 'Pessoa' } },
      { type: 'contrato.anexado', occurredAt: em('2026-10-21'), payload: { procedencia: 'registrado à mão', nome: 'fora.pdf' } },
      { type: 'contrato.parcelas_lancadas', occurredAt: em('2026-10-20'), payload: { origem: ORIGEM, versao: 1, linhas: [{ n: 1, valorCentavos: 10, vence: '2026-01-01', pagaEm: null }] } },
      { type: 'contrato.parcelas_lancadas', occurredAt: em('2026-10-21'), payload: { origem: ORIGEM, versao: 2, linhas: [{ n: 1, valorCentavos: 10, vence: '2026-10-01', pagaEm: '2026-10-01' }, { n: 2, valorCentavos: 20, vence: '2026-10-10', pagaEm: null }] } },
      { type: 'parcela.vence', occurredAt: em('2026-10-21'), payload: { parcela: 2, vence: '2026-10-10', aviso: 'D+10', contrato: ORIGEM } },
      { type: 'contrato.regua_ligada', occurredAt: em('2026-10-21'), payload: { origem: ORIGEM, por: 'Pessoa' } },
    ];
    const e = estadoDoImportado(ORIGEM, fatos, '2026-10-22');
    expect(e.anexo).toMatchObject({ nome: 'b.pdf', versao: 2, bytes: 20, por: 'Pessoa' });
    expect(e.anexosAnteriores).toBe(1);
    expect(e.parcelasManuais?.versao).toBe(2);
    expect(e.parcelasManuais?.somaCentavos).toBe(30);
    expect(e.parcelasManuais?.linhas.map((l) => [l.n, l.estado, l.aviso])).toEqual([[1, 'paga', null], [2, 'atrasada', 'D+10']]);
    expect(e.regua).toMatchObject({ ligada: true, por: 'Pessoa' });
    expect(estadoDoImportado('cartao:outro', fatos, '2026-10-22')).toMatchObject({ anexo: null, parcelasManuais: null, regua: { ligada: false } });
  });

  it('o fio tem a linha legível dos fatos novos', () => {
    expect(resumoDoEvento('contrato.anexado', { procedencia: 'importado', nome: 'c.pdf', versao: 2, por: 'Pessoa' }).resumo).toBe('PDF do contrato importado anexado (versão 2) · c.pdf · por Pessoa');
    expect(resumoDoEvento('contrato.parcelas_lancadas', { versao: 1, linhas: [{}, {}], somaCentavos: 250_000, por: 'Pessoa' }).resumo).toContain('2 parcelas · R$ 2.500,00');
    expect(resumoDoEvento('contrato.regua_ligada', { parcelasEmAberto: 3, por: 'Pessoa' }).resumo).toContain('ligada por Pessoa');
  });

  it('o guarda de gente recusa conta de máquina pelo token', () => {
    const ctx = (roles: string[]) => ({ switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u', roles } }) }) }) as unknown as ExecutionContext;
    expect(() => new SoGenteGuard().canActivate(ctx(['ia_acao']))).toThrow(ForbiddenException);
    expect(new SoGenteGuard().canActivate(ctx(['admin_master']))).toBe(true);
  });
});

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-contrato-importado-m2';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (uma empresa, leads, fatos do fio, decisões e auditoria)');

describe.skipIf(!URL)('contrato importado contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: ContratoImportadoService;
  let semStorage: ContratoImportadoService;
  let vivo: ContratoVivoService;
  const guardados = new Map<string, Buffer>();
  let gente: { id: string; nome: string; papeis: string[] };
  let maquina: { id: string; nome: string; papeis: string[] };
  let leitor: { id: string; nome: string; papeis: string[] };
  const AGORA = new Date('2026-10-22T13:00:00-03:00');
  const arquivo = (buffer = PDF, nome = 'Contrato assinado.pdf', mimetype = 'application/pdf') => ({ buffer, originalname: nome, mimetype, size: buffer.length });

  async function limpar() {
    const leads = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
    await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: leads } } });
    await prisma.comercialReacao.deleteMany({ where: { leadId: { in: leads } } });
    await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: leads } } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    guardados.clear();
  }

  /** Um cliente importado do CRM antigo com um contrato vivo sem PDF e sem parcela, como o importador deixa. */
  async function clienteImportado(nome = 'Cliente Sintético') {
    const lead = await prisma.lead.create({ data: { orgId: ORG, name: nome, status: 'ganho' }, select: { id: true } });
    await prisma.comercialFicha.create({ data: { leadId: lead.id, etapa: 'fechado', empresa: nome } });
    const p = prisma as unknown as PrismaService;
    const fio = new FioService(p, new ReacoesRegistry());
    await fio.registrar(ORG, lead.id, 'cliente.ativo', `importacao.crm:cartao:x-${lead.id}`, { chave: 'k', importado: true, origem: 'cartao:x' }, { semReacoes: true });
    await fio.registrar(ORG, lead.id, 'contrato.importado', ORIGEM, {
      origem: ORIGEM, cartaoDoCliente: 'cartao:x', titulo: 'Assessoria mensal', produto: null, produtoRotulo: 'Assessoria', valorCentavos: 600_000, fechadoEm: '2025-11-03',
      semDocumento: true, parcelas: '[a decidir]', por: 'Importador', porId: gente.id, marca: 'importacao.crm',
    }, { semReacoes: true, em: new Date('2025-11-03T12:00:00-03:00') });
    return lead.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await limpar();
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.upsert({ where: { id: ORG }, create: { id: ORG, name: ORG, slug: ORG }, update: {} });
    for (const key of ['leads.ver', 'leads.editar']) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin', permissions: { connect: [{ key: 'leads.ver' }, { key: 'leads.editar' }] } }, select: { id: true } });
    const ia = await prisma.role.create({ data: { orgId: ORG, key: 'ia_acao', name: 'IA ação', permissions: { connect: [{ key: 'leads.ver' }, { key: 'leads.editar' }] } }, select: { id: true } });
    const ver = await prisma.role.create({ data: { orgId: ORG, key: 'leitor_m2', name: 'Só lê', permissions: { connect: [{ key: 'leads.ver' }] } }, select: { id: true } });
    const criar = async (nome: string, roleId: string, papel: string) => ({
      id: (await prisma.user.create({ data: { orgId: ORG, email: `${papel}-m2@contrato-importado.teste`, name: nome, passwordHash: 'x', roles: { connect: { id: roleId } } }, select: { id: true } })).id,
      nome,
      papeis: [papel],
    });
    gente = await criar('Pessoa da Mesa', admin.id, 'admin_master');
    maquina = await criar('Conta de IA', ia.id, 'ia_acao');
    leitor = await criar('Pessoa que só lê', ver.id, 'leitor_m2');

    const p = prisma as unknown as PrismaService;
    const fio = new FioService(p, new ReacoesRegistry());
    const decisoes = new DecisoesService(p, fio, new ConfigComercialService(p), new DecisoesRegistry());
    vivo = new ContratoVivoService(p, fio, new RelogioComercialRegistry(), decisoes);
    const armazem: ArmazemDoAnexo = {
      put: async (k, corpo) => void guardados.set(k, corpo),
      get: async (k) => ({ stream: Readable.from(guardados.get(k) ?? Buffer.alloc(0)), contentType: 'application/pdf', size: guardados.get(k)?.length ?? 0 }),
    };
    svc = new ContratoImportadoService(p, fio, vivo, undefined, armazem);
    semStorage = new ContratoImportadoService(p, fio, vivo, { get: () => ({ configured: false }) } as never, undefined);
  }, 60_000);
  beforeEach(limpar);
  afterAll(async () => {
    await limpar();
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  async function efeitosExternos() {
    const leads = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
    return {
      cobrancas: await prisma.comercialCobranca.count({ where: { leadId: { in: leads } } }),
      contratos: await prisma.contract.count({ where: { orgId: ORG } }),
      aprovacoes: await prisma.approval.count({ where: { orgId: ORG } }),
      mensagens: await prisma.comercialMensagem.count({ where: { leadId: { in: leads } } }),
    };
  }

  it('anexar: o mesmo fato com procedência importado, o aviso some, nome, tamanho e data na tela, e auditado', async () => {
    const leadId = await clienteImportado();
    const antes = await vivo.doLead(ORG, leadId, AGORA);
    expect(antes.importados?.[0]).toMatchObject({ origem: ORIGEM, semDocumento: true, anexo: null, regua: { ligada: false } });

    const r = await svc.anexar(ORG, leadId, ORIGEM, gente, arquivo(), AGORA);
    expect(r.novo).toBe(true);
    expect(r.versao).toBe(1);
    const c = r.contrato.importados?.[0];
    expect(c?.semDocumento).toBe(false);
    expect(c?.anexo).toMatchObject({ nome: 'Contrato assinado.pdf', bytes: PDF.length, versao: 1, por: 'Pessoa da Mesa' });
    expect(c?.anexo?.em).toBe(AGORA.toISOString());

    const fato = await prisma.leadEvent.findMany({ where: { leadId, type: 'contrato.anexado' } });
    expect(fato).toHaveLength(1);
    expect(fato[0].payload).toMatchObject({ procedencia: 'importado', contratoImportado: ORIGEM, versao: 1, tipo: 'application/pdf', assinadoEm: '2025-11-03', porId: gente.id });
    expect(fato[0].id).toBe(eventoIdComercial(ORG, leadId, 'contrato.anexado', chaveDoAnexoImportado(ORIGEM, String((fato[0].payload as { sha256: string }).sha256))));
    expect([...guardados.keys()]).toEqual([`comercial/lead/${leadId}/contrato-assinado-${(fato[0].payload as { sha256: string }).sha256}.pdf`]);
    const linha = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'comercial.contrato_importado.pdf_anexado', entityId: leadId } });
    expect(linha.actorId).toBe(gente.id);
    expect(linha.after).toMatchObject({ contrato: ORIGEM, versao: 1, nivel: 'R0' });

    const baixado = await svc.anexo(ORG, leadId, ORIGEM);
    expect(baixado.nome).toBe('Contrato assinado.pdf');
    expect(baixado.size).toBe(PDF.length);
    expect(await efeitosExternos()).toEqual({ cobrancas: 0, contratos: 0, aprovacoes: 0, mensagens: 0 });
  });

  it('o mesmo PDF é idempotente; outro PDF é versão nova e o anterior fica no fio', async () => {
    const leadId = await clienteImportado();
    await svc.anexar(ORG, leadId, ORIGEM, gente, arquivo(), AGORA);
    const de = await svc.anexar(ORG, leadId, ORIGEM, gente, arquivo(PDF, 'renomeado.pdf'), AGORA);
    expect(de.novo).toBe(false);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.anexado' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: 'comercial.contrato_importado.pdf_anexado' } })).toBe(1);

    const v2 = await svc.anexar(ORG, leadId, ORIGEM, gente, arquivo(OUTRO_PDF, 'com aditivo.pdf'), new Date(AGORA.getTime() + 60_000));
    expect(v2).toMatchObject({ novo: true, versao: 2 });
    expect(v2.contrato.importados?.[0].anexo).toMatchObject({ nome: 'com aditivo.pdf', versao: 2 });
    expect(v2.contrato.importados?.[0].anexosAnteriores).toBe(1);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.anexado' } })).toBe(2);
    const auditoria = await prisma.auditLog.findMany({ where: { orgId: ORG, action: 'comercial.contrato_importado.pdf_anexado' }, orderBy: { createdAt: 'asc' } });
    expect(auditoria[1].before).toMatchObject({ versao: 1 });
    // O anterior continua baixável pelo sha.
    const sha1 = String(((await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'contrato.anexado', payload: { path: ['versao'], equals: 1 } } })).payload as { sha256: string }).sha256);
    expect((await svc.anexo(ORG, leadId, ORIGEM, sha1)).size).toBe(PDF.length);
  });

  it('recusa não-PDF, PDF acima do teto, sem permissão, conta de máquina, contrato que não existe e storage fora', async () => {
    const leadId = await clienteImportado();
    await expect(svc.anexar(ORG, leadId, ORIGEM, gente, arquivo(Buffer.from('<html>não sou pdf</html>'), 'falso.pdf'), AGORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.anexar(ORG, leadId, ORIGEM, gente, arquivo(PDF, 'x.pdf', 'text/plain'), AGORA)).rejects.toBeInstanceOf(BadRequestException);
    const grande = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    await expect(svc.anexar(ORG, leadId, ORIGEM, gente, arquivo(grande), AGORA)).rejects.toThrow(/10 MB/);
    await expect(svc.anexar(ORG, leadId, ORIGEM, leitor, arquivo(), AGORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.anexar(ORG, leadId, ORIGEM, maquina, arquivo(), AGORA)).rejects.toBeInstanceOf(ForbiddenException);
    // A conta de máquina que tentasse com um token sem o papel cai na releitura do banco.
    await expect(svc.anexar(ORG, leadId, ORIGEM, { ...maquina, papeis: [] }, arquivo(), AGORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.anexar(ORG, leadId, 'cartao:nao-existe', gente, arquivo(), AGORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.anexar(ORG, leadId, '../../etc', gente, arquivo(), AGORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(semStorage.anexar(ORG, leadId, ORIGEM, gente, arquivo(), AGORA)).rejects.toThrow(/indisponível/);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.anexado' } })).toBe(0);
    expect(guardados.size).toBe(0);
    expect(await prisma.auditLog.count({ where: { orgId: ORG } })).toBe(0);
  });

  it('parcelas: série mensal com a soma, versão condicionada, linha a linha com pagamento, e auditadas', async () => {
    const leadId = await clienteImportado();
    const r = await svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 0, serie: { quantidade: 3, valorCentavos: 200_000, primeiroVencimento: '2026-11-30' } }, gente, AGORA);
    expect(r).toMatchObject({ novo: true, versao: 1 });
    const p = r.contrato.importados?.[0].parcelasManuais;
    expect(p?.somaCentavos).toBe(600_000);
    expect(p?.linhas.map((l) => [l.n, l.vence, l.estado])).toEqual([[1, '2026-11-30', 'pendente'], [2, '2026-12-30', 'pendente'], [3, '2027-01-30', 'pendente']]);
    // A mesma versão de novo (outra aba que leu antes): 409, nada gravado.
    await expect(svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 0, serie: { quantidade: 2, valorCentavos: 1, primeiroVencimento: '2026-11-30' } }, gente, AGORA)).rejects.toBeInstanceOf(ConflictException);
    // As mesmas parcelas de novo: nada muda.
    const igual = await svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 1, serie: { quantidade: 3, valorCentavos: 200_000, primeiroVencimento: '2026-11-30' } }, gente, AGORA);
    expect(igual).toMatchObject({ novo: false, versao: 1 });
    const v2 = await svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 1, linhas: [
      { valorCentavos: 199_999, vence: '2026-09-30', pagaEm: '2026-09-29' },
      { valorCentavos: 200_001, vence: '2026-10-30' },
    ] }, gente, AGORA);
    expect(v2.versao).toBe(2);
    expect(v2.contrato.importados?.[0].parcelasManuais).toMatchObject({ versao: 2, somaCentavos: 400_000 });
    expect(v2.contrato.importados?.[0].parcelasManuais?.linhas.map((l) => [l.n, l.estado, l.pagaEm])).toEqual([[1, 'paga', '2026-09-29'], [2, 'pendente', null]]);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.parcelas_lancadas' } })).toBe(2);
    const auditoria = await prisma.auditLog.findMany({ where: { orgId: ORG, action: 'comercial.contrato_importado.parcelas_lancadas' }, orderBy: { createdAt: 'asc' } });
    expect(auditoria).toHaveLength(2);
    expect(auditoria[1].before).toMatchObject({ versao: 1, parcelas: 3, somaCentavos: 600_000 });
    expect(auditoria[1].after).toMatchObject({ versao: 2, parcelas: 2, somaCentavos: 400_000, modo: 'linhas' });
    // Pagamento no futuro, valor quebrado e conta de máquina: recusados.
    await expect(svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 2, linhas: [{ valorCentavos: 1, vence: '2026-10-01', pagaEm: '2026-10-23' }] }, gente, AGORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 2, linhas: [{ valorCentavos: 10.5, vence: '2026-10-01' }] }, gente, AGORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 2, linhas: [{ valorCentavos: 1, vence: '2026-10-01' }] }, maquina, AGORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 2, linhas: [{ valorCentavos: 1, vence: '2026-10-01' }] }, leitor, AGORA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await efeitosExternos()).toEqual({ cobrancas: 0, contratos: 0, aprovacoes: 0, mensagens: 0 });
  });

  it('régua desligada: o relógio passa com parcela vencida e não grava nada', async () => {
    const leadId = await clienteImportado();
    await svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 0, linhas: [{ valorCentavos: 100_000, vence: '2026-08-01' }, { valorCentavos: 100_000, vence: '2026-10-21' }] }, gente, AGORA);
    const antes = await prisma.leadEvent.count({ where: { leadId } });
    const r = await vivo.regua(ORG, AGORA);
    expect(r).toEqual({ avisos: 0, decisoes: 0 });
    expect(await prisma.leadEvent.count({ where: { leadId } })).toBe(antes);
    expect(await prisma.leadEvent.count({ where: { leadId, type: { in: ['parcela.vence', 'parcela.atrasada', 'decisao.aberta'] } } })).toBe(0);
    expect(await prisma.comercialDecisao.count({ where: { leadId } })).toBe(0);
  });

  it('ligar a régua exige parcelas, a ciência e a versão vista; ligada, a mesma régua avisa sem repetir e as parcelas travam', async () => {
    const leadId = await clienteImportado();
    await expect(svc.ligarRegua(ORG, leadId, { origem: ORIGEM, versaoDasParcelas: 1, ciente: true }, gente, AGORA)).rejects.toThrow(/Lance as parcelas/);
    await svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 0, linhas: [
      { valorCentavos: 100_000, vence: '2026-08-01' },
      { valorCentavos: 100_000, vence: '2026-09-01', pagaEm: '2026-09-01' },
      { valorCentavos: 100_000, vence: '2026-10-21' },
      { valorCentavos: 100_000, vence: '2026-12-01' },
    ] }, gente, AGORA);
    await expect(svc.ligarRegua(ORG, leadId, { origem: ORIGEM, versaoDasParcelas: 1 }, gente, AGORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.ligarRegua(ORG, leadId, { origem: ORIGEM, versaoDasParcelas: 1, ciente: false }, gente, AGORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.ligarRegua(ORG, leadId, { origem: ORIGEM, versaoDasParcelas: 7, ciente: true }, gente, AGORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.ligarRegua(ORG, leadId, { origem: ORIGEM, versaoDasParcelas: 1, ciente: true }, maquina, AGORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.ligarRegua(ORG, leadId, { origem: ORIGEM, versaoDasParcelas: 1, ciente: true }, leitor, AGORA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.regua_ligada' } })).toBe(0);

    const r = await svc.ligarRegua(ORG, leadId, { origem: ORIGEM, versaoDasParcelas: 1, ciente: true }, gente, AGORA);
    expect(r.novo).toBe(true);
    expect(r.contrato.importados?.[0].regua).toMatchObject({ ligada: true, por: 'Pessoa da Mesa' });
    const linha = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'comercial.contrato_importado.regua_ligada', entityId: leadId } });
    expect(linha.before).toEqual({ regua: 'desligada' });
    expect(linha.after).toMatchObject({ regua: 'ligada', parcelasEmAberto: 3, vencidas: 2, nivel: 'R0' });
    expect(String((linha.after as { frase: string }).frase)).toContain('Nenhuma mensagem vai ao cliente');
    // Ligar de novo não grava outro fato.
    expect((await svc.ligarRegua(ORG, leadId, { origem: ORIGEM, versaoDasParcelas: 1, ciente: true }, gente, AGORA)).novo).toBe(false);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.regua_ligada' } })).toBe(1);

    // Ligada, a régua é dona: as parcelas não se editam mais.
    await expect(svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 1, linhas: [{ valorCentavos: 1, vence: '2026-12-01' }] }, gente, AGORA)).rejects.toBeInstanceOf(ConflictException);

    // A mesma régua: a parcela de 01/08 está em D+82 (aviso D+10 e decisão), a de 21/10 em D+1, a paga e a de dezembro não avisam.
    const passagem = await vivo.regua(ORG, AGORA);
    expect(passagem).toEqual({ avisos: 2, decisoes: 1 });
    const avisos = await prisma.leadEvent.findMany({ where: { leadId, type: 'parcela.vence' }, select: { payload: true } });
    expect(avisos.map((a) => a.payload).sort((a, b) => String((a as { vence: string }).vence).localeCompare(String((b as { vence: string }).vence)))).toEqual([
      { parcela: 1, vence: '2026-08-01', aviso: 'D+10', contrato: ORIGEM },
      { parcela: 3, vence: '2026-10-21', aviso: 'D+1', contrato: ORIGEM },
    ]);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'parcela.atrasada' } })).toBe(2);
    expect(await prisma.comercialDecisao.count({ where: { leadId } })).toBe(1);
    // A passagem seguinte, no mesmo dia, não repete.
    expect(await vivo.regua(ORG, new Date(AGORA.getTime() + 60_000))).toEqual({ avisos: 0, decisoes: 0 });
    const tela = await vivo.doLead(ORG, leadId, AGORA);
    expect(tela.importados?.[0].parcelasManuais?.linhas.map((l) => [l.n, l.estado, l.aviso])).toEqual([[1, 'atrasada', 'D+10'], [2, 'paga', null], [3, 'atrasada', 'D+1'], [4, 'pendente', null]]);
    // As parcelas lançadas à mão não viram cobrança: a lista de parcelas do Asaas segue vazia.
    expect(tela.parcelas).toEqual([]);
    expect(await efeitosExternos()).toEqual({ cobrancas: 0, contratos: 0, aprovacoes: 0, mensagens: 0 });
  });

  it('contrato encerrado não liga a régua, e outra empresa não alcança o contrato', async () => {
    const leadId = await clienteImportado();
    await svc.lancarParcelas(ORG, leadId, { origem: ORIGEM, versaoEsperada: 0, serie: { quantidade: 1, valorCentavos: 1_000, primeiroVencimento: '2026-11-01' } }, gente, AGORA);
    await expect(svc.anexar('outra-empresa', leadId, ORIGEM, gente, arquivo(), AGORA)).rejects.toBeInstanceOf(ForbiddenException);
    await vivo.encerrar(ORG, leadId, { id: gente.id, papeis: gente.papeis }, { situacao: 'concluido', motivo: 'Escopo entregue.' }, AGORA);
    await expect(svc.ligarRegua(ORG, leadId, { origem: ORIGEM, versaoDasParcelas: 1, ciente: true }, gente, AGORA)).rejects.toThrow(/encerrado/);
  });
});
