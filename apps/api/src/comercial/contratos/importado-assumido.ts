import { ForbiddenException } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';

import { temPapelDeMaquina } from '../../approvals/alcada';
import { lerAprovador } from '../../auth/aprovador';
import { exigirAcessoAtual } from '../../memory/acesso-memoria';
import type { PrismaService } from '../../prisma/prisma.service';
import { contratosImportados } from '../contrato-vivo.service';
import { cadeadoDoContrato } from '../dinheiro-do-contrato';
import { uuidDe } from '../eventos';
import type { EventoGravado, FioService } from '../fio.service';
import { fimVigente } from './contratos-puro';

/*
 * O CONTRATO IMPORTADO VIRA REGISTRO (módulo de contratos, 02/11/2026; extraído em 03/11/2026).
 *
 * O caminho de `ContratosService.assumirImportado`, sem Nest, para o backfill do dinheiro
 * (`scripts/ligar-dinheiro-dos-contratos.ts --assumir-importados`) usar O MESMO código da tela:
 *   · `lerImportadoParaAssumir` lê o fio e a ficha (a mesma leitura, na mesma ordem);
 *   · `registroDoImportado` monta a linha (puro: o ensaio mostra o que nasceria sem escrever);
 *   · `gravarImportadoAssumido` escreve sob o cadeado do lead: a linha, o fato e a auditoria.
 * O serviço chama os três; quem mudar a regra muda aqui, e a tela e o script mudam juntos.
 * Também moram aqui a regra de "só gente" (`exigirGenteNoContrato`) e a auditoria do registro.
 */

export const RECUSA_DE_MAQUINA = 'Contrato é de gente: conta de serviço (IA) não mexe aqui. O agente propõe o envio pela porta.';

export interface QuemNoContrato {
  id: string;
  nome: string | null;
  papeis: readonly string[];
}

export type PessoaNoContrato = { id: string; nome: string | null };

/** Gente de verdade, relida no banco: ativa, desta empresa, sem papel de máquina e com `leads.editar` agora. */
export async function exigirGenteNoContrato(db: PrismaService, orgId: string, quem: QuemNoContrato): Promise<PessoaNoContrato> {
  if (!quem.id || temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
  const doBanco = await lerAprovador(db, quem.id, orgId);
  if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Só gente ativa da empresa mexe no contrato.');
  if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
  await exigirAcessoAtual(db, orgId, quem.id, ['leads.editar']);
  const u = await db.user.findFirst({ where: { id: quem.id, orgId }, select: { name: true } });
  return { id: quem.id, nome: u?.name ?? quem.nome };
}

export function auditarContrato(tx: Prisma.TransactionClient, orgId: string, atorId: string | null, acao: string, contratoId: string, before: unknown, after: unknown, ator: ActorType = ActorType.user): Promise<unknown> {
  return tx.auditLog.create({
    data: {
      orgId, actorType: ator, actorId: atorId, action: acao, entityType: 'comercial.contrato', entityId: contratoId,
      before: (before ?? Prisma.JsonNull) as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue,
    },
  });
}

type FatoDoFim = { type: string; payload: unknown; occurredAt: Date };

export interface BaseDoImportado {
  fatos: Array<{ payload: unknown }>;
  ficha: { partnerId: string | null; valorCentavos: number | null; valorNegociadoCentavos: number | null } | null;
  fins: FatoDoFim[];
}

/** O que o registro do importado lê. Sem fato `contrato.importado`: nulo (o serviço responde 404). */
export async function lerImportadoParaAssumir(db: Pick<Prisma.TransactionClient, 'leadEvent' | 'comercialFicha'>, orgId: string, leadId: string): Promise<BaseDoImportado | null> {
  const fatos = await db.leadEvent.findMany({ where: { orgId, leadId, type: 'contrato.importado' }, select: { payload: true } });
  if (!fatos.length) return null;
  const [ficha, fins] = await Promise.all([
    db.comercialFicha.findFirst({ where: { orgId, leadId }, select: { partnerId: true, valorCentavos: true, valorNegociadoCentavos: true } }),
    db.leadEvent.findMany({ where: { orgId, leadId, type: { in: ['contrato.concluido', 'contrato.desativado', 'contrato.reaberto'] } }, select: { type: true, payload: true, occurredAt: true } }),
  ]);
  return { fatos, ficha, fins };
}

export interface RegistroDoImportado {
  id: string;
  /** Exatamente o `data` do `comercialContrato.create`. */
  data: Prisma.ComercialContratoUncheckedCreateInput & { id: string; leadId: string; estado: string; partnerId: string | null; valorCentavos: number | null; origemImportada: string };
  origens: string[];
}

/**
 * Puro: a linha que o primeiro ato cria. Mais de um importado no lead continua sendo UM contrato (o cartão
 * soma): a primeira origem vai em `origemImportada`, todas em `dadosDoContrato.origens`. Sem vigência:
 * o importado não a traz (a pessoa edita depois).
 */
export function registroDoImportado(orgId: string, leadId: string, base: BaseDoImportado): RegistroDoImportado {
  const importados = contratosImportados(base.fatos);
  const principal = importados[0]!;
  const soma = importados.every((c) => c.valorCentavos !== null) ? importados.reduce((s, c) => s + (c.valorCentavos ?? 0), 0) : null;
  const { ficha } = base;
  const fim = fimVigente(base.fins);
  const concluido = fim?.type === 'contrato.concluido' ? fim : null;
  const id = uuidDe([orgId, 'comercial-contrato', 'importado', leadId]);
  const origens = importados.map((c) => c.origem);
  return {
    id,
    origens,
    data: {
      id, leadId, partnerId: ficha?.partnerId ?? null, tipo: 'contrato', estado: concluido ? 'encerrado' : 'ativo',
      valorCentavos: soma ?? ficha?.valorNegociadoCentavos ?? ficha?.valorCentavos ?? null, origemImportada: principal.origem,
      dadosDoContrato: { origens },
      motivoDoFim: concluido ? String(((concluido.payload ?? {}) as Record<string, unknown>).motivo ?? '') : null, encerradoEm: concluido?.occurredAt ?? null,
    },
  };
}

/**
 * Dentro da transação de quem chama: cadeado do lead, a linha (se ninguém a criou antes), o fato
 * `contrato.registrado` (ato `importado_assumido`) e a auditoria. Devolve se criou e o fato novo, para
 * quem chama rodar `fio.reagir` depois do commit (o serviço roda; nenhuma reação escuta este fato hoje).
 */
export async function gravarImportadoAssumido(
  tx: Prisma.TransactionClient,
  orgId: string,
  leadId: string,
  registro: RegistroDoImportado,
  pessoa: PessoaNoContrato,
  agora: Date,
  fio: Pick<FioService, 'gravarNaTransacao'>,
): Promise<{ criado: boolean; evento: EventoGravado | null }> {
  const { id } = registro;
  await cadeadoDoContrato(tx, orgId, leadId);
  const ja = await tx.comercialContrato.findFirst({ where: { orgId, leadId, origemImportada: { not: null } }, select: { id: true } });
  if (ja) return { criado: false, evento: null };
  await tx.comercialContrato.create({ data: registro.data });
  const g = await fio.gravarNaTransacao(tx, orgId, leadId, 'contrato.registrado', `${id}:importado`, { contratoId: id, tipo: 'contrato', ato: 'importado_assumido', por: pessoa.nome, porId: pessoa.id }, agora);
  await auditarContrato(tx, orgId, pessoa.id, 'comercial.contrato.importado_assumido', id, null, { leadId, origens: registro.origens, eventoId: g.evento.eventoId });
  return { criado: true, evento: g.novo ? g.evento : null };
}
