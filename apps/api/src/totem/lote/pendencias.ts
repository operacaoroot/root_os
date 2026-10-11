import {
  TOTEM_DIAS_ATENCAO_VALIDADE,
  totemLoteDiasParaVencer,
  totemLoteHoje,
  type TotemLotePendente,
  type TotemPendenciasDaLoja,
  type TotemProdutoPendente,
} from '@mktos/shared';

import type { UsuarioDoEscopo } from '../comum/escopo';
import { lojasDaConsulta, type BancoDoLote } from './acesso';
import { loteVigentePorProduto, type TotemLoteVigente } from './lote-vigente';

/*
 * Pendências de lote por loja (CONTRATO.md, seção 4): produto ativo sem lote
 * vigente, lote vencido (alerta) e lote a 15 dias ou menos de vencer
 * (atenção). Tudo sai de `loteVigentePorProduto`, a mesma régua do totem.
 */

export interface ProdutoDaPendencia {
  id: string;
  codigo: string;
  nome: string;
}

export function classificarPendencias(
  produtos: readonly ProdutoDaPendencia[],
  vigentes: ReadonlyMap<string, TotemLoteVigente>,
  hoje: Date,
): Pick<TotemPendenciasDaLoja, 'semLote' | 'vencidos' | 'vencendo'> {
  const semLote: TotemProdutoPendente[] = [];
  const vencidos: TotemLotePendente[] = [];
  const vencendo: TotemLotePendente[] = [];
  for (const p of produtos) {
    const v = vigentes.get(p.id);
    if (!v) {
      semLote.push({ produtoId: p.id, codigo: p.codigo, nome: p.nome });
      continue;
    }
    const dias = totemLoteDiasParaVencer(v.validadeEm, hoje);
    if (dias > TOTEM_DIAS_ATENCAO_VALIDADE) continue;
    const pendente: TotemLotePendente = {
      produtoId: p.id,
      codigo: p.codigo,
      nome: p.nome,
      loteId: v.loteId,
      loteCodigo: v.codigo,
      validadeEm: v.validadeEm.toISOString().slice(0, 10),
      presumido: v.presumido,
      dias,
    };
    (dias < 0 ? vencidos : vencendo).push(pendente);
  }
  const porDias = (a: TotemLotePendente, b: TotemLotePendente) => a.dias - b.dias || a.codigo.localeCompare(b.codigo);
  return { semLote, vencidos: vencidos.sort(porDias), vencendo: vencendo.sort(porDias) };
}

export async function pendenciasDasLojas(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  filtro: { lojaId?: string },
  agora = new Date(),
): Promise<TotemPendenciasDaLoja[]> {
  const hoje = totemLoteHoje(agora);
  return db.$transaction(async (tx) => {
    const escopo = await lojasDaConsulta(tx, user, filtro.lojaId);
    const lojas = await tx.totemLoja.findMany({
      where: {
        orgId: user.orgId,
        ...(escopo === 'todas' ? { ativa: true } : { id: { in: escopo } }),
      },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, nome: true },
    });
    const produtos = await tx.totemProduto.findMany({
      where: { orgId: user.orgId, ativo: true },
      orderBy: { codigo: 'asc' },
      select: { id: true, codigo: true, nome: true },
    });
    const ids = produtos.map((p) => p.id);
    const saida: TotemPendenciasDaLoja[] = [];
    for (const loja of lojas) {
      const vigentes = await loteVigentePorProduto(tx, loja.id, ids);
      saida.push({ lojaId: loja.id, lojaCodigo: loja.codigo, lojaNome: loja.nome, ...classificarPendencias(produtos, vigentes, hoje) });
    }
    return saida;
  });
}
