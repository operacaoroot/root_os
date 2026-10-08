import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { ContextItem, Prisma } from '@prisma/client';
import type { M05FonteAutorizadaDto, M05CapacidadesExecutorDto } from '@mktos/shared';
import { hashDoCorpo } from './procedencia';

interface FonteItem {
  id: string; orgId: string; chave: string; versao: number; sourceType: string; sourceRef: string | null;
  arquivadoEm: Date | string | null; atualizadoEm: Date | string;
}
interface FonteVersao {
  id: string; orgId: string; itemId: string; versao: number; title: string; body: string;
  contentHash: string; sourceType: string; sourceRef: string | null; criadoEm: Date | string;
}
const iso = (value: Date | string) => new Date(value).toISOString();
function inconsistente(): never {
  throw new ConflictException({ code: 'contexto_fonte_inconsistente', message: 'A versão da fonte não pôde ser conferida.' });
}

/** Representa uma versão já autorizada pelo chamador; não concede acesso. */
export function construirFonteAutorizada(input: {
  item: FonteItem; versaoSelecionada: FonteVersao; incluirCorpo: boolean;
  acessoVerificadoEm: Date; novoUsoPermitido: boolean; chaveConsumida?: string;
}): M05FonteAutorizadaDto {
  const { item, versaoSelecionada: v } = input;
  if (v.orgId !== item.orgId || v.itemId !== item.id || v.versao < 1 || v.versao > item.versao
    || hashDoCorpo(v.body) !== v.contentHash) inconsistente();
  const chave = input.chaveConsumida ?? item.chave;
  if ((v.sourceType === 'vault') !== chave.startsWith('vault:')) inconsistente();
  return {
    itemId: item.id, chave, colecao: v.sourceType === 'vault' ? 'vault_canonica' : 'manual_local',
    identidadeCanonica: { documentId: item.id, origemDaIdentidade: 'item_existente' },
    versao: { versionId: v.id, numero: v.versao, contentHash: v.contentHash },
    origem: { tipo: v.sourceType, referencia: v.sourceRef }, title: v.title, body: input.incluirCorpo ? v.body : null,
    versaoAtual: item.versao, arquivada: !!item.arquivadoEm, registradaEm: iso(v.criadoEm), atualizadaNaMemoriaEm: iso(item.atualizadoEm),
    citacao: { chave, itemId: item.id, versao: v.versao, versionId: v.id, contentHash: v.contentHash },
    estado: { coleta: 'nao_verificada', indexacao: 'nao_verificada', projecao: 'nao_verificada', ultimoReciboId: null },
    acesso: { modelo: 'local_por_pessoa', verificadoEm: input.acessoVerificadoEm.toISOString(), novoUsoPermitido: input.novoUsoPermitido },
  };
}

export function construirCapacidadesExecutor(input: {
  agente: { id: string; slug: string; estado: string; ativo: boolean; modelo: string | null; capacidades: string[] };
  procedimentoVersao: number | null; responsavelDisponivel: boolean; permissaoExecutarAtual: boolean;
  estadoModelo: { disponivel: boolean; modelo: string | null; motivo: string | null };
}): M05CapacidadesExecutorDto {
  const { agente: a, estadoModelo: m } = input;
  const impedimento = !input.permissaoExecutarAtual ? 'Acesso insuficiente para iniciar outro pedido.'
    : a.estado !== 'ativo' || !a.ativo ? `Agente ${a.estado}. Retome antes de criar outro pedido.`
    : !input.responsavelDisponivel ? 'Responsável indisponível nesta empresa.'
    : input.procedimentoVersao === null ? 'Defina o procedimento antes de iniciar.'
    : !a.capacidades.includes('contexto.memoria.buscar') || a.capacidades.some((c) => c !== 'contexto.memoria.buscar') ? 'Ferramenta não permitida neste procedimento.'
    : !m.disponivel || !a.modelo || a.modelo !== m.modelo ? m.motivo ?? 'O modelo configurado não está disponível.' : null;
  return { modo: 'sintese_local_sem_ferramentas', capacidades: { lerVersao: true, sintetizarLocalmente: true, registrarResultado: true,
    ferramentasExternas: false, agendamento: false, cancelarInferencia: false },
    agente: { id: a.id, slug: a.slug, estado: a.estado, ativo: a.ativo, procedimentoVersao: input.procedimentoVersao },
    modelo: { ...m, provider: 'llama.cpp-local' }, novasExecucoesPermitidas: impedimento === null, impedimento };
}

export type FonteAtual = Pick<ContextItem, 'id' | 'orgId' | 'chave' | 'title' | 'versao' | 'sourceType' | 'sourceRef' | 'arquivadoEm' | 'atualizadoEm'>;

/** Última consulta: identidade ativa, permissões e fontes usam o mesmo snapshot. */
export async function reconferirFontesAtuais(
  db: Pick<Prisma.TransactionClient, '$queryRawUnsafe'>,
  orgId: string, pessoaId: string, permissoes: string[], itemIds: string[],
  permitirArquivadas = true, agenteAtivoSlug: string | null = null,
): Promise<{ fontes: FonteAtual[]; agenteDisponivel: boolean }> {
  const rows = await db.$queryRawUnsafe<Array<FonteAtual & { autorizado: boolean; agenteDisponivel: boolean }>>(`
    /* m05_fonte_pessoa_acl */
    WITH acesso AS (
      SELECT EXISTS (
        SELECT u.id FROM "User" u
        JOIN "_UserRoles" ur ON ur."B" = u.id
        JOIN "Role" r ON r.id = ur."A" AND r."orgId" = u."orgId"
        JOIN "_RolePermissions" rp ON rp."B" = r.id
        JOIN "Permission" p ON p.id = rp."A"
        WHERE u.id = $2 AND u."orgId" = $1 AND u."isActive" = true AND p.key = ANY($4::text[])
        GROUP BY u.id HAVING count(DISTINCT p.key) = cardinality($4::text[])
      ) AS autorizado,
      ($6::text IS NULL OR EXISTS (
        SELECT 1 FROM "Agent" a WHERE a."orgId" = $1 AND a.slug = $6 AND a.estado = 'ativo' AND a.ativo = true
      )) AS "agenteDisponivel"
    )
    SELECT a.autorizado, a."agenteDisponivel", c.id, c."orgId", c.chave, c.title, c.versao,
      c."sourceType"::text AS "sourceType", c."sourceRef", c."arquivadoEm", c."atualizadoEm"
    FROM acesso a LEFT JOIN "ContextItem" c
      ON a.autorizado AND c."orgId" = $1 AND c.id = ANY($3::text[])
      AND (c."acessoRestrito" = false OR $2::text = ANY(c.leitores))
      AND ($5::boolean OR c."arquivadoEm" IS NULL)
  `, orgId, pessoaId, itemIds, permissoes, permitirArquivadas, agenteAtivoSlug);
  if (!rows[0]?.autorizado) throw new ForbiddenException('Acesso insuficiente.');
  return { fontes: rows.filter((r) => !!r.id).map(({ autorizado: _acesso, agenteDisponivel: _agente, ...fonte }) => fonte),
    agenteDisponivel: rows[0].agenteDisponivel };
}
