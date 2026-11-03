import { Prisma } from '@prisma/client';

import { uuidDe } from './eventos';

/*
 * O DINHEIRO DO CONTRATO (etapa 4, 03/11/2026) — "o dinheiro aparece sozinho".
 *
 * O registro do contrato (`ComercialContrato`, módulo de contratos do Rodrigo) é a
 * fonte única do contrato. No fechamento, o dinheiro dele passa a morar nas
 * parcelas de um acordo comercial (`AcordoComercial` + `AcordoParcela`), que é o
 * que o Financeiro já lê: a parcela sem cobrança vira o previsto `parc_<id>`, a
 * cobrança do Asaas veste a parcela pelo id (`asaasPaymentId` = `externoId` da
 * `ComercialCobranca`) e o extrato a marca paga. O contrato do Financeiro que o
 * fechamento escreve aponta o mesmo registro e deixa de ser projetado.
 *
 * QUAL ACORDO (decisão do dono, 03/11), o primeiro degrau que valer:
 *   1. o acordo já ligado a este contrato (rodar de novo cai nele);
 *   2. o acordo de uma parcela que a cobrança do lead já vestiu (o sync do Asaas chegou antes);
 *   3. o único acordo PAGANTE do mesmo cliente (o principal ou um repetido dele) ainda sem contrato;
 *   4. nenhum: nasce um, com id derivado do contrato.
 * Mais de um candidato num degrau é AMBÍGUO: nada é ligado nem criado, e quem chama
 * deixa o aviso (`dinheiro.a_conciliar`). Acordo com o nome do cliente e sem cliente
 * ligado também é ambíguo: criar outro contaria o mesmo dinheiro duas vezes.
 *
 * AS PARCELAS: uma por cobrança do lead (número, valor, vencimento, paga em, id no
 * Asaas) ou, de quem fechou fora sem cobrança, as do valor declarado. A que já
 * existe no acordo é ADOTADA (pelo id do Asaas ou pelo número); a do mesmo número
 * ainda sem id ganha o id, como no sync. Nada do que uma pessoa digitou muda além
 * das colunas de ligação: `comercialContratoId`, o `partnerId` vazio do acordo e o
 * `asaasPaymentId` vazio da parcela.
 *
 * SÓ LIGAR (`soLigar`, o backfill do importado sem cobrança nem parcelas lançadas, 03/11): o
 * dinheiro já mora no Financeiro. Os degraus são os mesmos, mas o 4 não cria acordo e nenhuma
 * parcela nasce: só o acordo que já existe ganha o `comercialContratoId`.
 *
 * Funções soltas, sem Nest, como `registro-do-documento.ts`: o fechamento chama sob
 * o cadeado do contrato do lead, e o script `ligar-dinheiro-dos-contratos` usa as
 * mesmas (o ensaio só planeja).
 */

type Banco = Pick<Prisma.TransactionClient, 'comercialContrato' | 'acordoComercial' | 'acordoParcela' | 'partner'>;

/** O contrato que tem dinheiro: assinado pelos dois (ou já ativo depois do `cliente.ativo`). */
export const ESTADOS_COM_DINHEIRO = ['assinado', 'ativo'];

export interface ParcelaDoDinheiro {
  numero: number;
  valorCentavos: number;
  vence: Date;
  pagaEm: Date | null;
  /** O `externoId` da cobrança no Asaas; nulo de quem fechou fora sem cobrança. */
  asaasPaymentId: string | null;
}

export interface EntradaDoDinheiro {
  orgId: string;
  leadId: string;
  /** O cliente do fechamento (o `Partner` da escrita do cliente). */
  partnerId: string;
  /** Fechado fora: o registro que o PDF anexado garantiu. Sem ele, o contrato assinado ou ativo do lead. */
  contratoId?: string | null;
  cliente: string;
  produto: string;
  valorCentavos: number;
  fechadoEm: Date;
  parcelas: readonly ParcelaDoDinheiro[];
  /** Só liga o acordo que já existe: não cria acordo nem parcela (o importado sem cobrança). */
  soLigar?: boolean;
}

export interface PlanoDoDinheiro {
  contrato: { id: string; estado: string; partnerId: string | null } | null;
  acordo: { acao: 'ligado' | 'adotar' | 'criar'; id: string; por: string } | null;
  criar: ParcelaDoDinheiro[];
  vestir: Array<{ id: string; numero: number; asaasPaymentId: string }>;
  adotar: Array<{ id: string; numero: number }>;
  /** Quantas parcelas o acordo escolhido já tem (o que o `soLigar` liga sem criar). */
  existentes: number;
  /** Os motivos de não ligar. Com algum, nada é escrito. */
  ambiguo: string[];
  /** Os acordos (ou registros) que podiam ser: vão no aviso, para quem concilia. */
  candidatos: string[];
  /** O lead não tem registro do contrato com dinheiro: o dinheiro segue no contrato do Financeiro. */
  semRegistro: string | null;
}

/** Uma linha do diário do backfill: o que mudou, para desfazer. */
export interface AnotacaoDoDinheiro {
  tabela: 'ComercialContrato' | 'AcordoComercial' | 'AcordoParcela' | 'Contract' | 'LeadEvent';
  linha: string;
  /** `*` = a linha nasceu aqui (desfazer apaga). */
  coluna: string;
  antes: string | null;
  depois: string | null;
}

export const idDoAcordoDoContrato = (orgId: string, contratoId: string): string => uuidDe([orgId, 'acordo-do-contrato', contratoId]);
export const idDaParcelaDoContrato = (orgId: string, acordoId: string, numero: number): string => uuidDe([orgId, 'acordo-parcela', acordoId, String(numero)]);

/** O mesmo cadeado de `ContratosService.cadeado`: um ato por vez no contrato do lead. */
export function cadeadoDoContrato(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, orgId: string, leadId: string): Promise<unknown> {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`comercial-contrato:${orgId}:${leadId}`}))`;
}

const minusculo = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** O dia de São Paulo como coluna `date` (meia-noite UTC), sem trocar de dia no fuso. */
export function diaDoDinheiro(d: Date): Date {
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return new Date(`${dia}T00:00:00Z`);
}

const reais = (centavos: number) => new Prisma.Decimal((centavos / 100).toFixed(2));

/** Cadastro único (03/11): o cliente, o principal dele e os repetidos do cliente são o mesmo cliente. */
export async function doMesmoCliente(db: Pick<Banco, 'partner'>, orgId: string, partnerId: string) {
  const cliente = await db.partner.findFirst({ where: { id: partnerId, orgId }, select: { id: true, principalId: true, razaoSocial: true, nomeFantasia: true } });
  const repetidos = await db.partner.findMany({ where: { orgId, principalId: partnerId }, select: { id: true } });
  return { cliente, ids: [...new Set([partnerId, cliente?.principalId, ...repetidos.map((r) => r.id)].filter((x): x is string => !!x))] };
}

/** Só lê: o que ligar, adotar e criar para o dinheiro deste contrato (ou por que não). */
export async function planejarDinheiro(db: Banco, e: EntradaDoDinheiro): Promise<PlanoDoDinheiro> {
  const plano: PlanoDoDinheiro = { contrato: null, acordo: null, criar: [], vestir: [], adotar: [], existentes: 0, ambiguo: [], candidatos: [], semRegistro: null };
  const { orgId, leadId } = e;
  const selecao = { id: true, estado: true, partnerId: true } as const;
  const registros = e.contratoId
    ? await db.comercialContrato.findMany({ where: { id: e.contratoId, orgId, leadId }, select: selecao })
    : await db.comercialContrato.findMany({ where: { orgId, leadId, tipo: 'contrato', estado: { in: ESTADOS_COM_DINHEIRO } }, orderBy: { criadoEm: 'asc' }, select: selecao });
  if (!registros.length) {
    plano.semRegistro = e.contratoId ? 'o registro do contrato anexado não é deste lead' : 'o lead não tem contrato assinado no registro';
    return plano;
  }
  // "Um contrato vivo por lead" é regra do serviço, não índice: dois assinados é para uma pessoa olhar.
  if (registros.length > 1) {
    plano.ambiguo.push(`o lead tem ${registros.length} contratos assinados no registro`);
    plano.candidatos = registros.map((r) => r.id);
    return plano;
  }
  const contrato = registros[0];
  plano.contrato = contrato;

  const ids = [...new Set(e.parcelas.map((p) => p.asaasPaymentId).filter((x): x is string => !!x))];
  const vestidas = ids.length
    ? await db.acordoParcela.findMany({ where: { orgId, asaasPaymentId: { in: ids } }, select: { id: true, numero: true, acordoId: true, asaasPaymentId: true } })
    : [];
  const ligado = await db.acordoComercial.findFirst({ where: { orgId, comercialContratoId: contrato.id }, select: { id: true } });
  if (ligado) {
    plano.acordo = { acao: 'ligado', id: ligado.id, por: 'já ligado a este contrato' };
  } else {
    const dasCobrancas = [...new Set(vestidas.map((v) => v.acordoId))];
    if (dasCobrancas.length > 1) {
      plano.ambiguo.push(`as cobranças do lead estão em ${dasCobrancas.length} acordos diferentes`);
      plano.candidatos = dasCobrancas;
    } else if (dasCobrancas.length === 1) {
      const a = await db.acordoComercial.findFirst({ where: { id: dasCobrancas[0], orgId }, select: { id: true, comercialContratoId: true } });
      if (!a || a.comercialContratoId) {
        plano.ambiguo.push('as cobranças do lead estão no acordo de outro contrato');
        plano.candidatos = dasCobrancas;
      } else {
        plano.acordo = { acao: 'adotar', id: a.id, por: 'a cobrança do Asaas já vestia uma parcela dele' };
      }
    } else {
      const { cliente, ids: doCliente } = await doMesmoCliente(db, orgId, e.partnerId);
      const pagantes = await db.acordoComercial.findMany({ where: { orgId, tipo: 'pagante', comercialContratoId: null, partnerId: { in: doCliente } }, select: { id: true } });
      if (pagantes.length > 1) {
        plano.ambiguo.push(`o cliente tem ${pagantes.length} acordos pagantes sem contrato`);
        plano.candidatos = pagantes.map((a) => a.id);
      } else if (pagantes.length === 1) {
        plano.acordo = { acao: 'adotar', id: pagantes[0].id, por: 'o acordo pagante do cliente, digitado à mão' };
      } else {
        const nomes = new Set([cliente?.razaoSocial, cliente?.nomeFantasia, e.cliente].map(minusculo).filter((n) => n.length >= 3));
        const soltos = await db.acordoComercial.findMany({ where: { orgId, comercialContratoId: null, partnerId: null }, select: { id: true, cliente: true } });
        const mesmoNome = soltos.filter((a) => nomes.has(minusculo(a.cliente)));
        if (mesmoNome.length) {
          plano.ambiguo.push(`há ${mesmoNome.length} acordo(s) com o nome do cliente e sem cliente ligado`);
          plano.candidatos = mesmoNome.map((a) => a.id);
        } else if (!e.soLigar) {
          plano.acordo = { acao: 'criar', id: idDoAcordoDoContrato(orgId, contrato.id), por: 'nenhum acordo do cliente' };
        }
      }
    }
  }
  if (!plano.acordo || plano.ambiguo.length) return plano;

  const acordoId = plano.acordo.id;
  const existentes = plano.acordo.acao === 'criar'
    ? []
    : await db.acordoParcela.findMany({ where: { orgId, acordoId }, select: { id: true, numero: true, asaasPaymentId: true } });
  plano.existentes = existentes.length;
  for (const p of e.parcelas) {
    const peloId = p.asaasPaymentId ? existentes.find((x) => x.asaasPaymentId === p.asaasPaymentId) : undefined;
    if (peloId) {
      plano.adotar.push({ id: peloId.id, numero: peloId.numero });
      continue;
    }
    if (p.asaasPaymentId && vestidas.some((v) => v.asaasPaymentId === p.asaasPaymentId && v.acordoId !== acordoId)) {
      plano.ambiguo.push(`a cobrança da parcela ${p.numero} veste uma parcela de outro acordo`);
      continue;
    }
    const peloNumero = existentes.find((x) => x.numero === p.numero);
    if (!peloNumero) {
      plano.criar.push(p);
    } else if (!peloNumero.asaasPaymentId && p.asaasPaymentId) {
      plano.vestir.push({ id: peloNumero.id, numero: p.numero, asaasPaymentId: p.asaasPaymentId });
    } else if (peloNumero.asaasPaymentId && p.asaasPaymentId && peloNumero.asaasPaymentId !== p.asaasPaymentId) {
      plano.ambiguo.push(`a parcela ${p.numero} do acordo já tem outra cobrança`);
    } else {
      plano.adotar.push({ id: peloNumero.id, numero: peloNumero.numero });
    }
  }
  if (plano.ambiguo.length) plano.candidatos = [acordoId];
  return plano;
}

/**
 * Escreve o plano (sem ambiguidade). Quem chama está numa transação, sob o cadeado
 * do contrato do lead. `anotar` recebe cada mudança (o diário do backfill).
 */
export async function aplicarDinheiro(
  db: Banco,
  e: EntradaDoDinheiro,
  plano: PlanoDoDinheiro,
  anotar: (a: AnotacaoDoDinheiro) => void | Promise<void> = () => undefined,
): Promise<{ contratoId: string; acordoId: string; acao: 'ligado' | 'adotar' | 'criar'; criadas: number; vestidas: number; adotadas: number }> {
  if (!plano.contrato || !plano.acordo || plano.ambiguo.length) throw new Error('o plano do dinheiro não tem contrato e acordo sem ambiguidade: nada a aplicar');
  const { orgId } = e;
  const contratoId = plano.contrato.id;
  const acordoId = plano.acordo.id;
  // O registro copiou o cliente da ficha quando nasceu; vale o do fechamento.
  if (plano.contrato.partnerId !== e.partnerId) {
    await db.comercialContrato.updateMany({ where: { id: contratoId, orgId }, data: { partnerId: e.partnerId } });
    await anotar({ tabela: 'ComercialContrato', linha: contratoId, coluna: 'partnerId', antes: plano.contrato.partnerId, depois: e.partnerId });
  }
  if (plano.acordo.acao === 'criar') {
    const r = await db.acordoComercial.createMany({
      data: [{
        id: acordoId, orgId, cliente: e.cliente, produto: e.produto, valor: reais(e.valorCentavos), tipo: 'pagante',
        partnerId: e.partnerId, fechadoEm: diaDoDinheiro(e.fechadoEm), comercialContratoId: contratoId,
      }],
      skipDuplicates: true,
    });
    if (r.count) await anotar({ tabela: 'AcordoComercial', linha: acordoId, coluna: '*', antes: null, depois: 'criado' });
  } else if (plano.acordo.acao === 'adotar') {
    const r = await db.acordoComercial.updateMany({ where: { id: acordoId, orgId, comercialContratoId: null }, data: { comercialContratoId: contratoId } });
    if (r.count !== 1) throw new Error('o acordo escolhido ganhou outro contrato no meio do caminho: nada foi ligado');
    await anotar({ tabela: 'AcordoComercial', linha: acordoId, coluna: 'comercialContratoId', antes: null, depois: contratoId });
    const semCliente = await db.acordoComercial.updateMany({ where: { id: acordoId, orgId, partnerId: null }, data: { partnerId: e.partnerId } });
    if (semCliente.count) await anotar({ tabela: 'AcordoComercial', linha: acordoId, coluna: 'partnerId', antes: null, depois: e.partnerId });
  }
  let vestidas = 0;
  for (const v of plano.vestir) {
    const r = await db.acordoParcela.updateMany({ where: { id: v.id, orgId, asaasPaymentId: null }, data: { asaasPaymentId: v.asaasPaymentId } });
    if (r.count) {
      vestidas++;
      await anotar({ tabela: 'AcordoParcela', linha: v.id, coluna: 'asaasPaymentId', antes: null, depois: v.asaasPaymentId });
    }
  }
  // Uma a uma: o `skipDuplicates` cobre a corrida com o sync (mesmo id do Asaas), e o diário só anota a que nasceu.
  let criadas = 0;
  for (const p of plano.criar) {
    const id = idDaParcelaDoContrato(orgId, acordoId, p.numero);
    const r = await db.acordoParcela.createMany({
      data: [{
        id, orgId, acordoId, numero: p.numero, valor: reais(p.valorCentavos), vencimento: diaDoDinheiro(p.vence),
        pagaEm: p.pagaEm ? diaDoDinheiro(p.pagaEm) : null, asaasPaymentId: p.asaasPaymentId,
      }],
      skipDuplicates: true,
    });
    if (r.count) {
      criadas++;
      await anotar({ tabela: 'AcordoParcela', linha: id, coluna: '*', antes: null, depois: 'criado' });
    }
  }
  return { contratoId, acordoId, acao: plano.acordo.acao, criadas, vestidas, adotadas: plano.adotar.length };
}

/** Uma frase para a escrita do fechamento (e o ensaio do backfill). */
export function resumoDoPlano(plano: PlanoDoDinheiro): string {
  if (plano.semRegistro) return `sem registro do contrato (${plano.semRegistro}): o dinheiro segue no contrato do Financeiro`;
  if (plano.ambiguo.length) return `dinheiro a conciliar: ${plano.ambiguo.join('; ')}`;
  if (!plano.acordo) return 'sem acordo';
  const acao = { ligado: 'acordo já ligado', adotar: 'acordo adotado', criar: 'acordo criado' }[plano.acordo.acao];
  const partes = [`${plano.criar.length} parcela(s) nova(s)`];
  if (plano.adotar.length) partes.push(`${plano.adotar.length} adotada(s)`);
  if (plano.vestir.length) partes.push(`${plano.vestir.length} com a cobrança ligada`);
  return `${acao} (${plano.acordo.por}) · ${partes.join(', ')}`;
}

// ---------------------------------------------------------------------------
// F-05: a parcela paga no Financeiro avisa o Comercial
// ---------------------------------------------------------------------------

export interface PagaNoFinanceiro {
  leadId: string;
  parcelaId: string;
  numero: number;
  valorCentavos: number;
  pagaEm: Date;
  asaasPaymentId: string | null;
}

/** As parcelas pagas dos acordos ligados a um contrato do registro, com o lead do contrato. */
export async function parcelasPagasDosContratos(db: Pick<Banco, 'comercialContrato' | 'acordoComercial' | 'acordoParcela'>, orgId: string): Promise<PagaNoFinanceiro[]> {
  const acordos = await db.acordoComercial.findMany({ where: { orgId, comercialContratoId: { not: null } }, select: { id: true, comercialContratoId: true } });
  if (!acordos.length) return [];
  const contratos = await db.comercialContrato.findMany({ where: { orgId, id: { in: acordos.map((a) => a.comercialContratoId!) } }, select: { id: true, leadId: true } });
  const leadDoContrato = new Map(contratos.map((c) => [c.id, c.leadId]));
  const leadDoAcordo = new Map(acordos.map((a) => [a.id, leadDoContrato.get(a.comercialContratoId!) ?? null]));
  const pagas = await db.acordoParcela.findMany({
    where: { orgId, acordoId: { in: acordos.map((a) => a.id) }, pagaEm: { not: null } },
    select: { id: true, acordoId: true, numero: true, valor: true, pagaEm: true, asaasPaymentId: true },
  });
  return pagas.flatMap((p) => {
    const leadId = leadDoAcordo.get(p.acordoId);
    if (!leadId || !p.pagaEm) return [];
    return [{ leadId, parcelaId: p.id, numero: p.numero, valorCentavos: Math.round(Number(p.valor) * 100), pagaEm: p.pagaEm, asaasPaymentId: p.asaasPaymentId }];
  });
}

/**
 * F-04: a conta e o plano do contrato que o fechamento escreve no Financeiro. A conta é a do Asaas (a
 * mesma regra de `materializarParcelas`: a do Asaas, senão a mais antiga); o plano é "Serviços
 * Prestados" (1.1.02 no plano da FullBPO), para implantação e continuidade. Sem tabela de configuração.
 */
export async function contaEPlanoDoFechamento(db: Pick<Prisma.TransactionClient, 'financeAccount' | 'chartAccount'>, orgId: string): Promise<{ accountId: string | null; chartAccountId: string | null }> {
  const conta = (await db.financeAccount.findFirst({ where: { orgId, provider: 'asaas' }, select: { id: true } }))
    ?? (await db.financeAccount.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } }));
  const plano = (await db.chartAccount.findFirst({ where: { orgId, codigo: '1.1.02' }, select: { id: true } }))
    ?? (await db.chartAccount.findFirst({ where: { orgId, nome: 'Serviços Prestados' }, select: { id: true } }));
  return { accountId: conta?.id ?? null, chartAccountId: plano?.id ?? null };
}
