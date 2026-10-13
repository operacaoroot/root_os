import { ActorType, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DinheiroService, type AceiteDoLead } from '../src/comercial/dinheiro.service';
import { FechamentoService, faltaDaVersao } from '../src/comercial/fechamento.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import type { PortaDeAssinatura } from '../src/comercial/portas/assinatura.port';
import type { NovaCobranca, PortaDeCobranca } from '../src/comercial/portas/cobranca.port';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * REVISÃO ADVERSARIAL, P2 DO DINHEIRO (lane G/D-P2, 13/10/2026).
 *
 * D-4: o fechamento só vai à fila com o contrato assinado e a 1ª parcela paga
 *      DA VERSÃO ACEITA.
 * D-6: o grupo do WhatsApp do fechamento pergunta ao interruptor do conector.
 * D-7: duas execuções simultâneas não criam dois clientes, dois grupos nem
 *      duas cobranças.
 *
 * A porta e o WhatsApp são dublês deste arquivo; o banco é o descartável.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lead, fio, cobrança, documento e fechamento do comercial)');

const MARCA = `p2${Date.now().toString(36).slice(-6)}`;
const ORG = `org-revisao-p2-${MARCA}`;
const SISTEMA = { id: 'comercial', tipo: ActorType.system };
const HASH_V1 = '1'.repeat(64);
const HASH_V2 = '2'.repeat(64);

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('revisão P2 do dinheiro', () => {
  let prisma: PrismaClient;
  let fio: FioService;
  let dinheiro: DinheiroService;
  let fechamento: FechamentoService;
  const pedidosAPorta: { capabilityId: string; args: Record<string, unknown> }[] = [];
  const cobrancasCriadas: NovaCobranca[] = [];
  const gruposCriados: string[] = [];
  const consultas: { conector?: string | null; capabilityId?: string | null }[] = [];
  let whatsDesligado = false;
  let atrasoDaCobranca = 0;
  let atrasoDoGrupo = 0;
  let seq = 0;

  const cobranca: PortaDeCobranca = {
    provedor: `asaas-${MARCA}`,
    configurada: () => true,
    criarCliente: async () => ({ externoId: `cus-${MARCA}`, reaproveitado: false }),
    criarCobranca: async (n: NovaCobranca) => {
      cobrancasCriadas.push(n);
      if (atrasoDaCobranca) await esperar(atrasoDaCobranca);
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
    webhookAutentico: () => false,
    interpretarWebhook: () => null,
  };

  const whats = {
    criarGrupo: async (nome: string) => {
      gruposCriados.push(nome);
      if (atrasoDoGrupo) await esperar(atrasoDoGrupo);
      return { jid: `grupo-${MARCA}-${gruposCriados.length}@g.us` };
    },
    enviarM8: async () => ({ pulado: 'teste' }),
  };

  const interruptores = {
    consultar: async (e: { conector?: string | null; capabilityId?: string | null }) => {
      consultas.push(e);
      if (whatsDesligado && e.conector === 'whatsapp') {
        return { conector: 'whatsapp', rotuloDoConector: 'WhatsApp', capabilityId: e.capabilityId ?? null, desligadoEm: new Date(), desligadoPor: 'mesa', motivoDoDesligamento: 'emergência', rotulo: 'conector_desligado', motivo: 'O conector WhatsApp está desligado para esta empresa em Conexões.' };
      }
      return null;
    },
  };

  /** Um lead com aceite da v1, cobrança da v1 com a 1ª parcela paga e contrato da v1 assinado pelos dois. */
  async function leadFechavel(cnpj: string): Promise<{ leadId: string; a: AceiteDoLead }> {
    const lead = await prisma.lead.create({ data: { orgId: ORG, name: `Lead ${cnpj}`, phone: `5532${cnpj.slice(-9)}` } });
    const leadId = lead.id;
    await prisma.comercialFicha.create({ data: { leadId, etapa: 'contrato', perfil: 'P2' } });
    const t0 = new Date(Date.now() - 3_600_000);
    await fio.registrar(ORG, leadId, 'aceite.dados', 'dados', { cnpj, razaoSocial: `Empresa ${cnpj}`, endereco: 'Rua A, 1', quemAssina: 'Fulana', email: 'fulana@exemplo.com' } as never, { em: t0 });
    await fio.registrar(ORG, leadId, 'proposta.aceita', 'v1', { versao: 1, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, forma: 'pix', hash: HASH_V1 } as never, { em: new Date(t0.getTime() + 1000) });
    const a = (await dinheiro.aceiteDoLead(leadId))!;
    await dinheiro.criarCobrancaDoAceite(ORG, leadId, a);
    const primeira = await prisma.comercialCobranca.findFirstOrThrow({ where: { leadId, parcela: 1 } });
    await prisma.comercialCobranca.update({ where: { id: primeira.id }, data: { estado: 'paga', pagaEm: new Date() } });
    await fio.registrar(ORG, leadId, 'pix.pago', primeira.externoId, { provedor: cobranca.provedor, externoId: primeira.externoId, parcela: 1, valorCentavos: primeira.valorCentavos, pagoEm: new Date().toISOString() } as never);
    const doc = dinheiro.contratoDoAceite(a);
    const externoId = `doc-${MARCA}-${leadId.slice(0, 8)}`;
    await prisma.comercialDocumento.create({ data: { leadId, provedor: 'zapsign-teste', externoId, estado: 'assinado', hashConteudo: doc.hash, assinadoClienteEm: new Date(), assinadoRootEm: new Date() } });
    await fio.registrar(ORG, leadId, 'contrato.assinado_cliente', externoId, { provedor: 'zapsign-teste', externoId, em: new Date().toISOString() } as never);
    await fio.registrar(ORG, leadId, 'contrato.assinado_root', externoId, { provedor: 'zapsign-teste', externoId, em: new Date().toISOString(), por: null } as never);
    return { leadId, a };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.org.create({ data: { id: ORG, name: `Revisao P2 ${MARCA}`, slug: `revisao-p2-${MARCA}` } });
    const p = prisma as unknown as PrismaService;
    const reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    const efeitos = { registrar: () => undefined };
    const porta = {
      executar: async (req: { capabilityId: string; args: Record<string, unknown> }) => {
        pedidosAPorta.push({ capabilityId: req.capabilityId, args: req.args });
        return { status: 'aguardando_aprovacao', approvalId: `ap-${pedidosAPorta.length}` };
      },
    };
    dinheiro = new DinheiroService(p, fio, reacoes, efeitos as never, porta as never, cobranca, {} as PortaDeAssinatura);
    const config = { ler: async () => ({ fechamentoAutomatico: false, janelaDeVetoMinutos: 0 }) };
    const registroDeDecisoes = { aoDecidir: () => undefined };
    fechamento = new FechamentoService(p, fio, reacoes, efeitos as never, porta as never, dinheiro, config as never, {} as never, registroDeDecisoes as never, undefined, whats as never, undefined, interruptores as never);
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

  describe('D-4: o fechamento é da versão aceita', () => {
    it('a regra pura: documento de outra versão, cobrança de outra versão e parcela sem pagar viram o que falta', () => {
      const assinado = { hashConteudo: 'h1', assinadoClienteEm: new Date(), assinadoRootEm: new Date() };
      expect(faltaDaVersao({ versao: 1, hashesDoContrato: ['h1'], documentos: [assinado], cobrancaDaVersao: { primeiraPaga: true }, haCobranca: true })).toEqual([]);
      expect(faltaDaVersao({ versao: 2, hashesDoContrato: ['h2'], documentos: [assinado], cobrancaDaVersao: null, haCobranca: true })).toEqual([
        'contrato da versão 2 (o documento que existe é de outra versão)',
        'cobrança da versão 2 (a cobrança que existe é de outra versão)',
      ]);
      expect(faltaDaVersao({ versao: 1, hashesDoContrato: ['h1'], documentos: [{ ...assinado, assinadoRootEm: null }], cobrancaDaVersao: { primeiraPaga: false }, haCobranca: true })).toEqual([
        'contrato da versão 1 assinado pela Root',
        '1ª parcela da cobrança da versão 1 paga',
      ]);
    });

    it('com a v1 inteira o fechamento vai à fila; aceita a v2, o Pix e as assinaturas da v1 não fecham a v2', async () => {
      const { leadId } = await leadFechavel(`1${Date.now().toString().slice(-13)}`);
      const r1 = await fechamento.propor(ORG, leadId, SISTEMA);
      expect(r1).toMatchObject({ estado: 'na_fila', chave: `fech-${leadId}-v1` });
      const antes = pedidosAPorta.length;

      // A mesa publica a v2 e o cliente a aceita: no fio seguem pix.pago e as duas assinaturas, todos da v1.
      await fio.registrar(ORG, leadId, 'proposta.aceita', 'v2', { versao: 2, produto: 'operacao', valorCentavos: 1_151_700, parcelas: 3, forma: 'pix', hash: HASH_V2 } as never);
      const r2 = await fechamento.propor(ORG, leadId, SISTEMA);
      expect(r2).toHaveProperty('pulado');
      const pulado = (r2 as { pulado: string }).pulado;
      expect(pulado).toMatch(/contrato da versão 2/);
      expect(pulado).toMatch(/cobrança da versão 2/);
      expect(pedidosAPorta.length).toBe(antes);
      expect(await fechamento.talvezFechar(ORG, leadId)).toHaveProperty('pulado');
      expect(pedidosAPorta.length).toBe(antes);
    });
  });

  describe('D-6: o grupo do WhatsApp pergunta ao interruptor', () => {
    it('desligado em Conexões, o grupo fica em erro com o motivo e as outras escritas seguem; ligado, o rodar de novo o cria', async () => {
      const { leadId, a } = await leadFechavel(`2${Date.now().toString().slice(-13)}`);
      whatsDesligado = true;
      const gruposAntes = gruposCriados.length;
      const r1 = await fechamento.executar(ORG, leadId, a);
      const grupo = r1.escritas.find((e) => e.escrita === 'grupo')!;
      expect(grupo.estado).toBe('erro');
      expect(grupo.detalhe).toMatch(/WhatsApp está desligado/);
      expect(gruposCriados.length).toBe(gruposAntes);
      expect(consultas).toContainEqual(expect.objectContaining({ conector: 'whatsapp' }));
      for (const k of ['cliente', 'cobranca', 'contrato'] as const) expect(r1.escritas.find((e) => e.escrita === k)?.estado).not.toBe('erro');
      expect(r1.estado).toBe('erro');

      whatsDesligado = false;
      const r2 = await fechamento.executar(ORG, leadId, a);
      expect(r2.escritas.find((e) => e.escrita === 'grupo')?.estado).toBe('criado');
      expect(gruposCriados.length).toBe(gruposAntes + 1);
      expect(await prisma.partner.count({ where: { orgId: ORG, cnpjCpf: a.dados.cnpj } })).toBe(1);
    });
  });
});
