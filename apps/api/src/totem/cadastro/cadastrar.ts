import type { Prisma } from '@prisma/client';
import {
  TOTEM_TAMANHO_CODIGO_CUPOM,
  totemDetalheDoBeneficio,
  totemStatusEfetivoDoCupom,
  totemTextoDoBeneficio,
  totemValidoAte,
  type TotemBeneficio,
  type TotemCadastroResposta,
  type TotemCupomEmitido,
  type TotemMotivoSemCupom,
  type TotemStatusCupom,
} from '@mktos/shared';

import { gerarCodigo } from '../comum/segredos';

/*
 * O CADASTRO E O CUPOM, sem Nest: recebem o client do Prisma (a transação) por
 * parâmetro para os testes rodarem contra o banco de teste.
 *
 * Regras (CONTRATO.md, seção 4):
 *   · um cliente por CPF na empresa (`@@unique([orgId, cpfHash])`);
 *   · um cupom por cliente por campanha (`@@unique([orgId, campanhaId, clienteId])`).
 *     O cadastro repetido devolve o mesmo cupom enquanto ele vale, e nada do
 *     que está guardado volta na resposta;
 *   · sem campanha valendo na loja, o cadastro é gravado e o cupom vem `null`.
 *
 * Quem repete o cadastro com o mesmo CPF e OUTRO celular não troca o celular
 * gravado: o totem não tem como saber se é o dono do CPF. A troca passa pelo
 * encarregado de dados, que confere a pessoa antes.
 */

type Tx = Prisma.TransactionClient;

export interface EntradaDoCadastro {
  orgId: string;
  lojaId: string;
  dispositivoId: string | null;
  canal: 'totem' | 'qr';
  cpfHash: string;
  cpfMascarado: string;
  /** E.164, já normalizado pelo schema. */
  telefone: string;
  nome: string | null;
  aceitaCampanhas: boolean;
  politicaVersao: string;
  agora?: Date;
}

interface CampanhaDoCupom {
  id: string;
  chamada: string;
  tipoBeneficio: string;
  valorBeneficio: Prisma.Decimal | number | null;
  descricaoBeneficio: string | null;
  validadeDias: number;
}

const TENTATIVAS_DE_CODIGO = 5;

export function finalidadesDoConsentimento(aceitaCampanhas: boolean): string[] {
  return aceitaCampanhas ? ['cupom', 'campanhas'] : ['cupom'];
}

function mesmasFinalidades(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((f) => b.includes(f));
}

export function beneficioDa(c: Pick<CampanhaDoCupom, 'tipoBeneficio' | 'valorBeneficio' | 'descricaoBeneficio'>): TotemBeneficio {
  return {
    tipoBeneficio: c.tipoBeneficio,
    valorBeneficio: c.valorBeneficio == null ? null : Number(c.valorBeneficio),
    descricaoBeneficio: c.descricaoBeneficio,
  };
}

/** Ativa, já começou, não terminou e vale na loja (lista vazia quer dizer todas). */
export function filtroDeCampanhaVigente(orgId: string, lojaId: string, agora: Date): Prisma.TotemCampanhaWhereInput {
  return {
    orgId,
    ativa: true,
    inicioEm: { lte: agora },
    AND: [
      { OR: [{ fimEm: null }, { fimEm: { gt: agora } }] },
      { OR: [{ lojaIds: { isEmpty: true } }, { lojaIds: { has: lojaId } }] },
    ],
  };
}

/** Com mais de uma valendo, a que começou por último. */
export function campanhaVigenteDaLoja(
  tx: Pick<Tx, 'totemCampanha'>,
  orgId: string,
  lojaId: string,
  agora: Date = new Date(),
) {
  return tx.totemCampanha.findFirst({
    where: filtroDeCampanhaVigente(orgId, lojaId, agora),
    orderBy: [{ inicioEm: 'desc' }, { criadoEm: 'desc' }],
  });
}

function cupomEmitido(cupom: { codigo: string; validoAte: Date }, campanha: CampanhaDoCupom): TotemCupomEmitido {
  const b = beneficioDa(campanha);
  return {
    codigo: cupom.codigo,
    validoAte: cupom.validoAte.toISOString(),
    chamada: campanha.chamada,
    beneficio: totemTextoDoBeneficio(b),
    detalhe: totemDetalheDoBeneficio(b),
  };
}

const MOTIVO_DO_STATUS: Partial<Record<TotemStatusCupom, TotemMotivoSemCupom>> = {
  usado: 'cupom_usado',
  expirado: 'cupom_vencido',
  cancelado: 'cupom_cancelado',
};

/** Um código que ainda não existe na empresa. Com 32^8 combinações, a segunda tentativa já é rara. */
async function codigoLivre(tx: Pick<Tx, 'totemCupom'>, orgId: string): Promise<string> {
  for (let i = 0; i < TENTATIVAS_DE_CODIGO; i += 1) {
    const codigo = gerarCodigo(TOTEM_TAMANHO_CODIGO_CUPOM);
    const ocupado = await tx.totemCupom.findUnique({ where: { orgId_codigo: { orgId, codigo } }, select: { id: true } });
    if (!ocupado) return codigo;
  }
  throw new Error('não foi possível sortear um código de cupom livre');
}

type ClienteDoCadastro = Pick<Tx, 'totemCliente' | 'totemConsentimento' | 'totemCampanha' | 'totemCupom'>;

/** Grava (ou reconhece) o cliente, registra o consentimento e emite o cupom da campanha da loja. */
export async function cadastrarCliente(tx: ClienteDoCadastro, e: EntradaDoCadastro): Promise<TotemCadastroResposta> {
  const agora = e.agora ?? new Date();
  const finalidades = finalidadesDoConsentimento(e.aceitaCampanhas);
  const registrarConsentimento = (clienteId: string) =>
    tx.totemConsentimento.create({
      data: {
        orgId: e.orgId,
        clienteId,
        politicaVersao: e.politicaVersao,
        finalidades,
        canal: e.canal,
        lojaId: e.lojaId,
        dispositivoId: e.dispositivoId,
        aceitoEm: agora,
      },
    });

  let cliente = await tx.totemCliente.findUnique({
    where: { orgId_cpfHash: { orgId: e.orgId, cpfHash: e.cpfHash } },
    select: { id: true, telefone: true, aceitaCampanhas: true },
  });

  if (!cliente) {
    cliente = await tx.totemCliente.create({
      data: {
        orgId: e.orgId,
        cpfHash: e.cpfHash,
        cpfMascarado: e.cpfMascarado,
        telefone: e.telefone,
        nome: e.nome,
        lojaOrigemId: e.lojaId,
        canalOrigem: e.canal,
        aceitaCampanhas: e.aceitaCampanhas,
      },
      select: { id: true, telefone: true, aceitaCampanhas: true },
    });
    await registrarConsentimento(cliente.id);
  } else {
    const ativos = await tx.totemConsentimento.findMany({
      where: { orgId: e.orgId, clienteId: cliente.id, revogadoEm: null },
      select: { finalidades: true, politicaVersao: true },
    });
    if (ativos.length === 0) {
      await tx.totemCliente.update({
        where: { id: cliente.id },
        data: { telefone: e.telefone, aceitaCampanhas: e.aceitaCampanhas, ...(e.nome ? { nome: e.nome } : {}) },
      });
      await registrarConsentimento(cliente.id);
    } else if (cliente.telefone === e.telefone) {
      const igual = ativos.some(
        (c) => c.politicaVersao === e.politicaVersao && mesmasFinalidades(c.finalidades, finalidades),
      );
      if (!igual) {
        await tx.totemConsentimento.updateMany({
          where: { orgId: e.orgId, clienteId: cliente.id, revogadoEm: null },
          data: { revogadoEm: agora },
        });
        await registrarConsentimento(cliente.id);
      }
      if (!igual || e.nome || cliente.aceitaCampanhas !== e.aceitaCampanhas) {
        await tx.totemCliente.update({
          where: { id: cliente.id },
          data: { aceitaCampanhas: e.aceitaCampanhas, ...(e.nome ? { nome: e.nome } : {}) },
        });
      }
    }
  }

  const campanha = await campanhaVigenteDaLoja(tx, e.orgId, e.lojaId, agora);
  if (!campanha) return { cupom: null, motivoSemCupom: 'sem_campanha' };

  const existente = await tx.totemCupom.findUnique({
    where: { orgId_campanhaId_clienteId: { orgId: e.orgId, campanhaId: campanha.id, clienteId: cliente.id } },
    select: { codigo: true, status: true, validoAte: true },
  });
  if (existente) {
    const status = totemStatusEfetivoDoCupom(existente.status, existente.validoAte, agora);
    if (status === 'emitido') return { cupom: cupomEmitido(existente, campanha), motivoSemCupom: null };
    return { cupom: null, motivoSemCupom: MOTIVO_DO_STATUS[status] ?? 'cupom_cancelado' };
  }

  const cupom = await tx.totemCupom.create({
    data: {
      orgId: e.orgId,
      campanhaId: campanha.id,
      clienteId: cliente.id,
      codigo: await codigoLivre(tx, e.orgId),
      emitidoEm: agora,
      validoAte: totemValidoAte(agora, campanha.validadeDias),
    },
    select: { codigo: true, validoAte: true },
  });
  return { cupom: cupomEmitido(cupom, campanha), motivoSemCupom: null };
}
