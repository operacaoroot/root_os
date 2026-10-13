import { ActorType, PrismaClient } from '@prisma/client';
import { fatoDaPrimeiraPaga } from '@mktos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DinheiroService, type AceiteDoLead } from '../src/comercial/dinheiro.service';
import { FechamentoService, prontoParaFechar } from '../src/comercial/fechamento.service';
import { camposDoEvento } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import type { PortaDeAssinatura } from '../src/comercial/portas/assinatura.port';
import { estadoDoAsaas, lerWebhookDoAsaas, type NovaCobranca, type PortaDeCobranca } from '../src/comercial/portas/cobranca.port';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * REVISÃO ADVERSARIAL, P3 DO DINHEIRO (lane G/P3-servidor, 13/10/2026).
 *
 * D-10: estorno e chargeback do Asaas tiram a parcela de paga, com fato no fio,
 *       e o fechamento não segue com a 1ª parcela estornada. O fato da 1ª
 *       parcela paga tem o nome da forma (pix.pago só para Pix).
 * D-12: o fechamento não reaproveita um Partner fornecedor com o mesmo CNPJ.
 * A-7: as consultas do fechamento e do dinheiro levam a empresa no `where`.
 *
 * A porta de cobrança é dublê deste arquivo (com a leitura real do webhook);
 * o banco é o descartável.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lead, fio, cobrança, documento, partner e fechamento do comercial)');

const MARCA = `p3${Date.now().toString(36).slice(-6)}`;
const ORG = `org-revisao-p3d-${MARCA}`;
const SISTEMA = { id: 'comercial', tipo: ActorType.system };
const HASH_V1 = '3'.repeat(64);
const SEGREDO = `segredo-${MARCA}`;

describe('revisão P3 do dinheiro', () => {
  let prisma: PrismaClient;
  let fio: FioService;
  let dinheiro: DinheiroService;
  let fechamento: FechamentoService;
  let seq = 0;

  const cobranca: PortaDeCobranca = {
    provedor: `asaas-${MARCA}`,
    configurada: () => true,
    criarCliente: async () => ({ externoId: `cus-${MARCA}`, reaproveitado: false }),
    criarCobranca: async (n: NovaCobranca) => {
      const lote = ++seq;
      return {
        parcelas: Array.from({ length: n.parcelas }, (_, i) => ({
          externoId: `pay-${MARCA}-${lote}-${i + 1}`,
          parcela: i + 1,
          parcelas: n.parcelas,
          valorCentavos: n.parcelaCentavos,
          vence: '2026-10-13',
          estado: 'pendente' as const,
          pagaEm: null,
          linkPagamento: null,
        })),
        reaproveitada: false,
      };
    },
    consultarCobranca: async () => null,
    pixDaCobranca: async () => null,
    webhookAutentico: (t) => t === SEGREDO,
    interpretarWebhook: (corpo) => lerWebhookDoAsaas(corpo),
  };

  const whats = {
    criarGrupo: async () => ({ jid: `grupo-${MARCA}@g.us` }),
    enviarM8: async () => ({ pulado: 'teste' }),
  };

  /** Um lead com aceite da v1 na forma pedida, cobrança da v1 SEM pagar e contrato da v1 assinado pelos dois. */
  async function leadAssinado(cnpj: string, forma: 'pix' | 'boleto' | 'cartao'): Promise<{ leadId: string; a: AceiteDoLead; primeira: string }> {
    const lead = await prisma.lead.create({ data: { orgId: ORG, name: `Lead ${cnpj}`, phone: `5532${cnpj.slice(-9)}` } });
    const leadId = lead.id;
    await prisma.comercialFicha.create({ data: { leadId, etapa: 'contrato', perfil: 'P2' } });
    const t0 = new Date(Date.now() - 3_600_000);
    await fio.registrar(ORG, leadId, 'aceite.dados', 'dados', { cnpj, razaoSocial: `Empresa ${cnpj}`, endereco: 'Rua A, 1', quemAssina: 'Fulana', email: 'fulana@exemplo.com' } as never, { em: t0 });
    await fio.registrar(ORG, leadId, 'proposta.aceita', 'v1', { versao: 1, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, forma, hash: HASH_V1 } as never, { em: new Date(t0.getTime() + 1000) });
    const a = (await dinheiro.aceiteDoLead(leadId))!;
    await dinheiro.criarCobrancaDoAceite(ORG, leadId, a);
    const primeira = await prisma.comercialCobranca.findFirstOrThrow({ where: { leadId, parcela: 1 } });
    const doc = dinheiro.contratoDoAceite(a);
    const externoId = `doc-${MARCA}-${leadId.slice(0, 8)}`;
    await prisma.comercialDocumento.create({ data: { leadId, provedor: 'zapsign-teste', externoId, estado: 'assinado', hashConteudo: doc.hash, assinadoClienteEm: new Date(), assinadoRootEm: new Date() } });
    await fio.registrar(ORG, leadId, 'contrato.assinado_cliente', externoId, { provedor: 'zapsign-teste', externoId, em: new Date().toISOString() } as never);
    await fio.registrar(ORG, leadId, 'contrato.assinado_root', externoId, { provedor: 'zapsign-teste', externoId, em: new Date().toISOString(), por: null } as never);
    return { leadId, a, primeira: primeira.externoId };
  }

  const tiposDoLead = async (leadId: string) => (await prisma.leadEvent.findMany({ where: { leadId }, select: { type: true } })).map((e) => e.type);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.org.create({ data: { id: ORG, name: `Revisao P3 ${MARCA}`, slug: `revisao-p3d-${MARCA}` } });
    const p = prisma as unknown as PrismaService;
    const reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    const efeitos = { registrar: () => undefined };
    const porta = { executar: async () => ({ status: 'aguardando_aprovacao', approvalId: `ap-${MARCA}` }) };
    dinheiro = new DinheiroService(p, fio, reacoes, efeitos as never, porta as never, cobranca, {} as PortaDeAssinatura);
    const config = { ler: async () => ({ fechamentoAutomatico: false, janelaDeVetoMinutos: 0 }) };
    fechamento = new FechamentoService(p, fio, reacoes, efeitos as never, porta as never, dinheiro, config as never, {} as never, { aoDecidir: () => undefined } as never, undefined, whats as never, undefined, { consultar: async () => null } as never);
  });

  afterAll(async () => {
    const ids = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
    await prisma.contract.deleteMany({ where: { orgId: ORG } });
    await prisma.partner.deleteMany({ where: { orgId: ORG } });
    await prisma.comercialFechamento.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialCobranca.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialDocumento.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialReacao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialFicha.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  describe('D-10: estorno, chargeback e o nome do fato da 1ª parcela', () => {
    it('a leitura pura: estorno e chargeback têm tipo próprio; o status do Asaas também', () => {
      for (const evento of ['PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL', 'PAYMENT_RECEIVED_IN_CASH_UNDONE']) {
        expect(lerWebhookDoAsaas({ id: 'e', event: evento, payment: { id: 'pay_1', value: 10 } }), evento).toMatchObject({ tipo: 'estornada', evento });
      }
      expect(lerWebhookDoAsaas({ id: 'e', event: 'PAYMENT_CREATED', payment: { id: 'pay_1', value: 10 } })?.tipo).toBe('outro');
      expect(estadoDoAsaas('REFUNDED')).toBe('estornada');
      expect(estadoDoAsaas('CHARGEBACK_REQUESTED')).toBe('estornada');
      expect(fatoDaPrimeiraPaga('pix')).toBe('pix.pago');
      expect(fatoDaPrimeiraPaga('boleto')).toBe('boleto.pago');
      expect(fatoDaPrimeiraPaga('cartao')).toBe('cartao.pago');
      // Quem lê "a 1ª parcela foi paga?" aceita as três formas.
      expect(prontoParaFechar(new Set(['boleto.pago', 'contrato.assinado_cliente', 'contrato.assinado_root'])).pronto).toBe(true);
      expect(prontoParaFechar(new Set(['cartao.pago', 'contrato.assinado_cliente', 'contrato.assinado_root'])).pronto).toBe(true);
      // A ficha: a 1ª parcela estornada volta a não paga; a 2ª não mexe no marco.
      const em = new Date();
      expect(camposDoEvento('parcela.estornada', { parcela: 1 }, em, { pixPagoEm: em })).toEqual({ pixPagoEm: null });
      expect(camposDoEvento('parcela.estornada', { parcela: 2 }, em, { pixPagoEm: em })).toBeNull();
      expect(camposDoEvento('boleto.pago', { pagoEm: em.toISOString() }, em, {})).toEqual({ pixPagoEm: em });
    });

    it('boleto pago grava boleto.pago (não pix.pago); o estorno volta a parcela a não paga e o fechamento não segue; paga de novo, segue', async () => {
      const { leadId, primeira } = await leadAssinado(`2${Date.now().toString().slice(-13)}`, 'boleto');

      const pago = { id: `evt-pago-${MARCA}`, event: 'PAYMENT_RECEIVED', payment: { id: primeira, value: 3999, paymentDate: '2026-10-13' } };
      expect(await dinheiro.webhookDoAsaas(SEGREDO, pago)).toMatchObject({ gravados: 2 });
      let tipos = await tiposDoLead(leadId);
      expect(tipos).toContain('boleto.pago');
      expect(tipos).not.toContain('pix.pago');
      expect(await fechamento.prontidao(ORG, leadId, (await dinheiro.aceiteDoLead(leadId))!)).toEqual({ pronto: true, falta: [] });

      const estorno = { id: `evt-estorno-${MARCA}`, event: 'PAYMENT_CHARGEBACK_REQUESTED', payment: { id: primeira, value: 3999 } };
      expect(await dinheiro.webhookDoAsaas(SEGREDO, estorno)).toMatchObject({ gravados: 1 });
      const linha = await prisma.comercialCobranca.findFirstOrThrow({ where: { leadId, parcela: 1 } });
      expect(linha.estado).toBe('estornada');
      expect(linha.pagaEm).toBeNull();
      const fato = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'parcela.estornada' } });
      expect(fato.payload).toMatchObject({ parcela: 1, externoId: primeira, evento: 'PAYMENT_CHARGEBACK_REQUESTED' });
      // A reentrega do mesmo estorno não grava outro fato.
      expect(await dinheiro.webhookDoAsaas(SEGREDO, estorno)).toMatchObject({ gravados: 0 });

      const r = await fechamento.propor(ORG, leadId, SISTEMA);
      expect(r).toHaveProperty('pulado');
      expect((r as { pulado: string }).pulado).toContain('1ª parcela da cobrança da versão 1 paga');

      // O chargeback revertido: o Asaas manda o recebimento de novo. A parcela volta a paga com um fato novo.
      const deNovo = { id: `evt-pago2-${MARCA}`, event: 'PAYMENT_RECEIVED', payment: { id: primeira, value: 3999, paymentDate: '2026-10-14' } };
      expect(await dinheiro.webhookDoAsaas(SEGREDO, deNovo)).toMatchObject({ gravados: 2 });
      expect(await prisma.leadEvent.count({ where: { leadId, type: 'boleto.pago' } })).toBe(2);
      expect(await fechamento.propor(ORG, leadId, SISTEMA)).toMatchObject({ estado: 'na_fila' });
    });

    it('cartão pago grava cartao.pago; pix pago segue gravando pix.pago', async () => {
      const cartao = await leadAssinado(`3${Date.now().toString().slice(-13)}`, 'cartao');
      await dinheiro.webhookDoAsaas(SEGREDO, { id: `evt-c-${MARCA}`, event: 'PAYMENT_CONFIRMED', payment: { id: cartao.primeira, value: 3999, paymentDate: '2026-10-13' } });
      expect(await tiposDoLead(cartao.leadId)).toEqual(expect.arrayContaining(['cartao.pago', 'parcela.paga']));
      expect(await tiposDoLead(cartao.leadId)).not.toContain('pix.pago');

      const pix = await leadAssinado(`4${Date.now().toString().slice(-13)}`, 'pix');
      await dinheiro.webhookDoAsaas(SEGREDO, { id: `evt-p-${MARCA}`, event: 'PAYMENT_RECEIVED', payment: { id: pix.primeira, value: 3999, paymentDate: '2026-10-13' } });
      expect(await tiposDoLead(pix.leadId)).toContain('pix.pago');
    });
  });

  describe('D-12: o fechamento não reaproveita fornecedor com o mesmo CNPJ', () => {
    it('com um fornecedor de mesmo CNPJ, nasce um cliente novo e o fornecedor fica intocado', async () => {
      const cnpj = `5${Date.now().toString().slice(-13)}`;
      const fornecedor = await prisma.partner.create({ data: { orgId: ORG, isFornecedor: true, razaoSocial: 'Fornecedor Antigo', cnpjCpf: cnpj } });
      const { leadId, a, primeira } = await leadAssinado(cnpj, 'pix');
      await dinheiro.webhookDoAsaas(SEGREDO, { id: `evt-d12-${MARCA}`, event: 'PAYMENT_RECEIVED', payment: { id: primeira, value: 3999, paymentDate: '2026-10-13' } });

      const r = await fechamento.executar(ORG, leadId, a);
      const cliente = r.escritas.find((e) => e.escrita === 'cliente')!;
      expect(cliente.estado).toBe('criado');
      expect(cliente.ref).not.toBe(fornecedor.id);
      const novo = await prisma.partner.findUniqueOrThrow({ where: { id: cliente.ref! } });
      expect(novo).toMatchObject({ isCliente: true, cnpjCpf: cnpj });
      expect(await prisma.partner.findUniqueOrThrow({ where: { id: fornecedor.id } })).toMatchObject({ isCliente: false, isFornecedor: true, razaoSocial: 'Fornecedor Antigo' });
      expect((await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId } })).partnerId).toBe(novo.id);
    });

    it('um cliente que já existe com o CNPJ segue reaproveitado', async () => {
      const cnpj = `6${Date.now().toString().slice(-13)}`;
      const ja = await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Cliente Antigo', cnpjCpf: cnpj } });
      const { leadId, a, primeira } = await leadAssinado(cnpj, 'pix');
      await dinheiro.webhookDoAsaas(SEGREDO, { id: `evt-d12b-${MARCA}`, event: 'PAYMENT_RECEIVED', payment: { id: primeira, value: 3999, paymentDate: '2026-10-13' } });
      const r = await fechamento.executar(ORG, leadId, a);
      expect(r.escritas.find((e) => e.escrita === 'cliente')).toMatchObject({ estado: 'reaproveitado', ref: ja.id });
    });
  });

  describe('A-7: a empresa no where', () => {
    it('a prontidão de um lead lida com o id de outra empresa não acha o documento nem a cobrança dele', async () => {
      const { leadId, a, primeira } = await leadAssinado(`7${Date.now().toString().slice(-13)}`, 'pix');
      await dinheiro.webhookDoAsaas(SEGREDO, { id: `evt-a7-${MARCA}`, event: 'PAYMENT_RECEIVED', payment: { id: primeira, value: 3999, paymentDate: '2026-10-13' } });
      expect(await fechamento.prontidao(ORG, leadId, a)).toEqual({ pronto: true, falta: [] });
      const outra = await fechamento.prontidao(`org-outra-${MARCA}`, leadId, a);
      expect(outra.pronto).toBe(false);
      expect(outra.falta).toEqual(expect.arrayContaining(['contrato da versão 1 gerado']));
    });
  });
});
