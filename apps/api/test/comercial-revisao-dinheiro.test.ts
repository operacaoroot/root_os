import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CAP_COBRANCA, DinheiroService } from '../src/comercial/dinheiro.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import type { PortaDeAssinatura } from '../src/comercial/portas/assinatura.port';
import type { ClienteDeCobranca, NovaCobranca, PortaDeCobranca } from '../src/comercial/portas/cobranca.port';
import type { Efeito } from '../src/gateway/efeitos.registry';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * REVISÃO ADVERSARIAL (lane G, 13/10/2026) · a cobrança R4 presa ao devedor.
 *
 * Afirma o comportamento CERTO e fica vermelho enquanto o defeito existir; não
 * entra no commit da revisão (prova citada em `homolog/revisao/lane-D.md`).
 *
 * Os argumentos de `comercial.cobranca.criar` levam versão, hash, valor,
 * parcelas e forma, mas NÃO o CNPJ, a razão social nem o e-mail do devedor. O
 * efeito relê o `aceite.dados` MAIS NOVO do fio. A sala aceita `aceite/dados`
 * de novo a qualquer momento (chave = hash do conteúdo), então o cliente
 * anônimo troca o devedor DEPOIS da assinatura da titular, e a cobrança sai no
 * Asaas em nome de outro CNPJ.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lead e fio do comercial)');

const MARCA = `rd${Date.now().toString(36).slice(-6)}`;
const ORG = `org-revisao-d-${MARCA}`;
const HASH = 'a'.repeat(64);
const CNPJ_APROVADO = '11222333000181';
const CNPJ_TROCADO = '99888777000166';

describe('revisão: a cobrança aprovada pela titular sai para o devedor que ela viu', () => {
  let prisma: PrismaClient;
  let fio: FioService;
  let efeitoDeCobranca: Efeito | undefined;
  const clientes: ClienteDeCobranca[] = [];
  let leadId = '';

  const cobranca: PortaDeCobranca = {
    provedor: 'asaas-revisao',
    configurada: () => true,
    criarCliente: async (c) => {
      clientes.push(c);
      return { externoId: `cus-${MARCA}`, reaproveitado: false };
    },
    criarCobranca: async (n: NovaCobranca) => ({
      parcelas: Array.from({ length: n.parcelas }, (_, i) => ({
        externoId: `pay-${MARCA}-${i + 1}`,
        parcela: i + 1,
        parcelas: n.parcelas,
        valorCentavos: n.parcelaCentavos,
        vence: '2026-10-13',
        estado: 'pendente' as const,
        pagaEm: null,
        linkPagamento: null,
      })),
      reaproveitada: false,
    }),
    consultarCobranca: async () => null,
    pixDaCobranca: async () => null,
    webhookAutentico: () => false,
    interpretarWebhook: () => null,
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.org.create({ data: { id: ORG, name: `Revisao D ${MARCA}`, slug: `revisao-d-${MARCA}` } });
    const lead = await prisma.lead.create({ data: { orgId: ORG, name: 'Mercado Revisão', phone: '5532999990001' } });
    leadId = lead.id;
    const p = prisma as unknown as PrismaService;
    fio = new FioService(p, new ReacoesRegistry());
    const efeitos = { registrar: (m: Record<string, Efeito>) => (efeitoDeCobranca = m[CAP_COBRANCA]) };
    const dinheiro = new DinheiroService(p, fio, new ReacoesRegistry(), efeitos as never, {} as never, cobranca, {} as PortaDeAssinatura);
    dinheiro.onModuleInit();
  });

  afterAll(async () => {
    await prisma.comercialCobranca.deleteMany({ where: { leadId } });
    await prisma.leadEvent.deleteMany({ where: { leadId } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  it('o cliente troca o CNPJ depois da assinatura e a cobrança sai no CNPJ que a titular aprovou (ou não sai)', async () => {
    const t0 = new Date('2026-10-13T15:00:00Z');
    const dados = (cnpj: string) => ({ cnpj, razaoSocial: `Empresa ${cnpj}`, endereco: 'Rua A, 1', quemAssina: 'Fulana', email: 'fulana@exemplo.com' });
    await fio.registrar(ORG, leadId, 'aceite.dados', 'dados-1', dados(CNPJ_APROVADO) as never, { em: t0 });
    await fio.registrar(ORG, leadId, 'proposta.aceita', 'v1', { versao: 1, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, forma: 'pix', hash: HASH } as never, { em: new Date(t0.getTime() + 1000) });

    // Os argumentos exatos que `proporAceite` manda à porta (e que a titular assina).
    // Desde o conserto D-2 eles levam o devedor que a titular viu (o do aceite de antes da troca).
    const aprovado = dados(CNPJ_APROVADO);
    const args = {
      leadId,
      versao: 1,
      hash: HASH,
      valorCentavos: 1_199_700,
      parcelas: 3,
      forma: 'pix',
      devedorDocumento: aprovado.cnpj,
      devedorRazaoSocial: aprovado.razaoSocial,
      devedorEmail: aprovado.email,
    };

    // Depois da assinatura, a sala recebe `POST /sala/:token/aceite/dados` com outro CNPJ.
    await fio.registrar(ORG, leadId, 'aceite.dados', 'dados-2', dados(CNPJ_TROCADO) as never, { em: new Date(t0.getTime() + 60_000) });

    // A fila executa o pedido aprovado.
    let recusou = false;
    try {
      await efeitoDeCobranca!(args, ORG, { approvalId: 'aprovacao-da-titular', actorId: 'titular' } as never);
    } catch {
      recusou = true;
    }

    // Certo: ou o efeito recusa (o devedor mudou depois do pedido), ou cobra o CNPJ que estava na mesa.
    if (!recusou) expect(clientes.map((c) => c.documento)).toEqual([CNPJ_APROVADO]);
    expect(recusou || clientes[0]?.documento === CNPJ_APROVADO).toBe(true);
  });
});
