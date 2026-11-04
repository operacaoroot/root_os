import { ActorType, ApprovalState } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { PedidoDePasta, ResultadoDaPasta } from '../src/clientes/portas';
import { DecisoesRegistry } from '../src/comercial/decisoes.service';
import type { AceiteDoLead, DinheiroService } from '../src/comercial/dinheiro.service';
import { CAP_FECHAMENTO, FechamentoService, chaveDoFechamento } from '../src/comercial/fechamento.service';
import { ReacoesRegistry, type FioService } from '../src/comercial/fio.service';
import { EfeitosRegistry, type ContextoDoEfeito } from '../src/gateway/efeitos.registry';
import type { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { FechamentoDoLead } from '@mktos/shared';

const ORG = 'empresa-teste';
const LEAD = '00000000-0000-4000-8000-000000000101';
const CLIENTE = 'cliente-teste';
const APROVACAO_DO_FECHAMENTO = 'aprovacao-pai-consumida';
const PROPONENTE = 'quem-propos-o-fechamento';
const APROVADOR = 'quem-aprovou-o-fechamento';

const ACEITE: AceiteDoLead = {
  versao: 2, produto: 'operacao', valorCentavos: 100_000, parcelas: 1, forma: 'boleto',
  hash: 'a'.repeat(64), em: new Date('2026-10-01T12:00:00.000Z'),
  dados: { cnpj: '12345678000199', razaoSocial: 'Empresa Teste', endereco: 'Rua A', quemAssina: 'Ana', email: 'ana@teste.invalid' },
};

function montar(origemDaPropostaAnterior?: ActorType) {
  const chave = chaveDoFechamento(LEAD, ACEITE.versao);
  const linha = { id: 'fechamento-teste', chave, versao: ACEITE.versao, estado: 'erro',
    iniciadoEm: null, concluidoEm: null, escritas: [], vetadoEm: null };
  const ficha = { partnerId: CLIENTE, grupoJid: 'grupo-ja-criado' };
  const cliente = { id: CLIENTE, cnpjCpf: ACEITE.dados.cnpj, email: ACEITE.dados.email, pastaDriveId: null };
  const prisma = {
    comercialFechamento: {
      createMany: async () => ({ count: 0 }),
      findFirst: async () => linha,
      findFirstOrThrow: async () => linha,
      findUniqueOrThrow: async () => linha,
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }: { data: Partial<typeof linha> }) => Object.assign(linha, data),
    },
    approval: {
      findFirst: vi.fn(async () => origemDaPropostaAnterior && origemDaPropostaAnterior !== ActorType.system
        ? { id: 'aprovacao-anterior', propostoPorTipo: origemDaPropostaAnterior, status: ApprovalState.expirada }
        : null),
    },
    leadEvent: {
      findMany: async ({ where }: { where: { type: unknown } }) => where.type === 'proposta.aceita'
        ? [{ leadId: LEAD }]
        : [{ type: 'boleto.pago' }, { type: 'contrato.assinado_cliente' }, { type: 'contrato.assinado_root' }],
    },
    comercialFicha: { findFirst: async () => ficha },
    lead: { findFirstOrThrow: async () => ({ name: 'Empresa Teste', email: ACEITE.dados.email, phone: null }) },
    partner: { findFirst: async ({ where }: { where: { id: string | object } }) => where.id === CLIENTE ? cliente : null },
    contract: { findUnique: async () => ({ id: 'contrato-reaproveitado', comercialContratoId: null }) },
    comercialCobranca: { findMany: async () => [] },
    $executeRaw: async () => 1,
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(prisma),
  };
  const fio = { registrar: vi.fn(async () => ({})) } as unknown as FioService;
  const dinheiro = {
    aceiteDaCobrancaAprovada: async () => ACEITE,
    criarCobrancaDoAceite: async () => ({ reaproveitada: true, referencia: 'cob-teste' }),
    aceiteDoLead: async () => ACEITE,
    proporAceite: async () => ({ approvalIds: [] }),
    aprovacaoViva: async () => null,
    travaDaRepeticao: async () => null,
  } as unknown as DinheiroService;
  const proporNaPorta = vi.fn(async () => ({ status: 'aguardando_aprovacao', approvalId: 'novo-fechamento-r4' }));
  const operador = { executar: proporNaPorta } as unknown as PortaDoOperador;
  const efeitos = new EfeitosRegistry();

  let proponenteAtivo = true;
  const proponentesDosPedidos: string[] = [];
  // Simula a fronteira do módulo Clientes. Pedido antigo sem referência cairia
  // na origem automática. Com referência, a carteira original é conferida a cada pedido.
  const garantir = vi.fn(async (pedido: PedidoDePasta): Promise<ResultadoDaPasta> => {
    const referencia = pedido.fechamentoApprovalId;
    if (referencia && (referencia !== APROVACAO_DO_FECHAMENTO || !proponenteAtivo)) {
      return { estado: 'erro', motivo: 'A autorização original da pasta não está mais válida.' };
    }
    proponentesDosPedidos.push(referencia ? PROPONENTE : pedido.atorId ?? 'system');
    return { estado: 'aguardando_aprovacao', approvalId: 'aprovacao-da-pasta' };
  });

  const fechamento = new FechamentoService(
    prisma as unknown as PrismaService, fio, new ReacoesRegistry(), efeitos, operador, dinheiro,
    undefined as never, undefined as never, new DecisoesRegistry(), undefined, undefined, undefined, undefined, { garantir },
  );
  vi.spyOn(fechamento, 'aceiteParaFechar').mockResolvedValue(ACEITE);
  vi.spyOn(fechamento, 'prontidao').mockResolvedValue({ pronto: true, falta: [] });
  fechamento.onModuleInit();

  const contexto: ContextoDoEfeito = { orgId: ORG, actorType: ActorType.user, actorId: APROVADOR, approvalId: APROVACAO_DO_FECHAMENTO };
  const disparar = (ctx = contexto) => efeitos.executar(CAP_FECHAMENTO, { leadId: LEAD, chave, propostaHash: ACEITE.hash }, ctx) as Promise<FechamentoDoLead>;
  const revogar = () => { proponenteAtivo = false; };
  return { disparar, revogar, garantir, proponentesDosPedidos, fechamento, contexto, proporNaPorta };
}

const pasta = (r: FechamentoDoLead) => r.escritas.find((escrita) => escrita.escrita === 'pasta');

describe('origem da pasta criada pelo fechamento', () => {
  it('encaminha a aprovação pai para reconstruir o proponente, que é distinto do aprovador', async () => {
    const m = montar();
    expect(pasta(await m.disparar())).toMatchObject({ estado: 'aguardando_aprovacao', ref: 'aprovacao-da-pasta' });
    expect(m.garantir).toHaveBeenCalledExactlyOnceWith({
      orgId: ORG, partnerId: CLIENTE, origem: 'fechamento', leadId: LEAD, fechamentoApprovalId: APROVACAO_DO_FECHAMENTO,
    });
    expect(m.proponentesDosPedidos).toEqual([PROPONENTE]);
  });

  it('bloqueia a criação da pasta se o proponente foi revogado depois da confirmação', async () => {
    const m = montar();
    m.revogar();
    expect(pasta(await m.disparar())).toMatchObject({ estado: 'erro' });
    expect(m.proponentesDosPedidos).toEqual([]);
  });

  it('reconfere o mesmo proponente ao repetir o fechamento', async () => {
    const m = montar();
    expect(pasta(await m.disparar())?.estado).toBe('aguardando_aprovacao');
    m.revogar();
    expect(pasta(await m.disparar())?.estado).toBe('erro');
    expect(m.proponentesDosPedidos).toEqual([PROPONENTE]);
  });

  it('não chama a porta da pasta quando a execução direta não tem prova de origem', async () => {
    const m = montar();
    expect(pasta(await m.fechamento.executar(ORG, LEAD, ACEITE))?.estado).toBe('erro');
    expect(m.garantir).not.toHaveBeenCalled();
  });

  it('recusa a origem forjada sem abrir pedido automático', async () => {
    const m = montar();
    expect(pasta(await m.disparar({ ...m.contexto, approvalId: 'aprovacao-forjada' }))?.estado).toBe('erro');
    expect(m.proponentesDosPedidos).toEqual([]);
  });
});


describe('reproposta automática do fechamento', () => {
  const agora = new Date('2026-10-02T12:00:00.000Z');

  it('deixa o fechamento humano expirado para uma nova ação humana', async () => {
    const m = montar(ActorType.user);
    expect(await m.fechamento.repropor(ORG, agora)).toEqual({ aceites: 0, fechamentos: 0 });
    expect(m.proporNaPorta).not.toHaveBeenCalled();
    const novo = await m.fechamento.propor(ORG, LEAD, { id: PROPONENTE, tipo: ActorType.user }, agora);
    expect(novo).toMatchObject({ estado: 'na_fila', approvalId: 'novo-fechamento-r4' });
    expect(m.proporNaPorta).toHaveBeenCalledWith(expect.objectContaining({ actorId: PROPONENTE, actorType: ActorType.user }));
  });

  it('repropõe a aprovação que já veio do sistema de fechamento', async () => {
    const m = montar(ActorType.system);
    expect(await m.fechamento.repropor(ORG, agora)).toEqual({ aceites: 0, fechamentos: 1 });
    expect(m.proporNaPorta).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'comercial', actorType: ActorType.system }));
  });
});
