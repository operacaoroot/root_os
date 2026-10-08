import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';
import type { CatalogoDeColecaoDto } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { hashDoCorpo, chaveDaVault } from '../memory/procedencia';
import { marcaDoRepositorio } from './estado-do-git';
import { blobDoGit, tipoDoModo, TIPO_ARQUIVO, type EntradaDoIndice } from './indice-do-git';
import type { ArquivoNoDisco, PertencaDaVault } from './pertenca-da-vault';
import { COLECAO } from './recibo-da-vault';

const sha = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const iso = (v: Date | string | null): string | null => v === null ? null : new Date(v).toISOString();
export interface MarcaDoCatalogo { repositorioId: string; head: string; indiceHash: string; indiceModificadoEm: number }
export interface MembroCapturado {
  chave: string; caminhoBytes: Buffer; blobGit: string; hashArquivo: string; contentHash: string;
  metadataHash: string; metadata: { title: string; kind: string; tags: string[]; validFrom: string | null; validUntil: string | null; sourceRef: string };
}
export interface CapturaDoCatalogo { marca: MarcaDoCatalogo; membershipDigest: string; membros: MembroCapturado[] }

/** Não publica caminho absoluto, configuração ou URL do repositório. */
export function marcaDoCatalogo(raiz: string): MarcaDoCatalogo | null {
  try {
    const m = marcaDoRepositorio(raiz);
    if (!m.head || m.indiceModificadoEm === null) return null;
    return { repositorioId: sha(realpathSync(raiz)), head: m.head,
      indiceHash: sha(readFileSync(join(raiz, '.git', 'index'))), indiceModificadoEm: m.indiceModificadoEm };
  } catch { return null; }
}
const mesmaMarca = (a: MarcaDoCatalogo | null, b: MarcaDoCatalogo | null): boolean =>
  a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
function hashMetadata(m: MembroCapturado['metadata']): string {
  return sha(JSON.stringify({ title: m.title, kind: m.kind, tags: [...m.tags].sort(),
    validFrom: m.validFrom, validUntil: m.validUntil, sourceRef: m.sourceRef }));
}

/** Recebe somente os resultados do classificador e os bytes lidos pelo integrador. */
export function prepararCapturaDoCatalogo(input: {
  pertenca: PertencaDaVault; arquivos: ArquivoNoDisco[]; indice: EntradaDoIndice[] | null;
  marcaAntes: MarcaDoCatalogo | null; marcaDepois: MarcaDoCatalogo | null; ilegiveis: number;
}): CapturaDoCatalogo | null {
  const { pertenca } = input;
  if (!mesmaMarca(input.marcaAntes, input.marcaDepois) || !input.indice || input.ilegiveis
    || pertenca.rastreamento !== 'ok' || pertenca.vistos.length || pertenca.avisos.length
    || pertenca.contagens.nomesIlegiveis) return null;
  const membros: MembroCapturado[] = [];
  for (const m of pertenca.membros) {
    const arquivos = input.arquivos.filter((a) => Buffer.from(a.caminho.toString('utf8')).equals(a.caminho)
      && a.caminho.toString('utf8').normalize('NFC') === m.caminho);
    if (arquivos.length !== 1) return null;
    const a = arquivos[0];
    const entradas = input.indice.filter((e) => e.caminho.equals(a.caminho));
    if (entradas.length !== 1 || tipoDoModo(entradas[0].modo) !== TIPO_ARQUIVO || entradas[0].estagio !== 0 || entradas[0].skipWorktree || entradas[0].intentToAdd
      || blobDoGit(a.bytes) !== entradas[0].blob || m.nota.cabecalho.geradoPeloOs) return null;
    const metadata = { title: m.nota.title, kind: m.nota.cabecalho.kind, tags: [...m.nota.tags],
      validFrom: iso(m.nota.cabecalho.validFrom), validUntil: iso(m.nota.cabecalho.validUntil), sourceRef: m.caminho };
    membros.push({ chave: chaveDaVault(m.caminho), caminhoBytes: Buffer.from(a.caminho), blobGit: entradas[0].blob,
      hashArquivo: sha(a.bytes), contentHash: hashDoCorpo(m.nota.content), metadataHash: hashMetadata(metadata), metadata });
  }
  membros.sort((a, b) => Buffer.compare(a.caminhoBytes, b.caminhoBytes));
  if (new Set(membros.map((m) => m.chave)).size !== membros.length) return null;
  const membershipDigest = sha(JSON.stringify(membros.map((m) => ({ chave: m.chave,
    caminhoBytes: m.caminhoBytes.toString('hex'), blobGit: m.blobGit, hashArquivo: m.hashArquivo,
    contentHash: m.contentHash, metadataHash: m.metadataHash }))));
  return { marca: input.marcaAntes!, membershipDigest, membros };
}

type Db = Pick<Prisma.TransactionClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;
interface ItemConferido { id: string; versionId: string; versao: number; chave: string; title: string; kind: string;
  tags: string[]; validFrom: Date | null; validUntil: Date | null; body: string; contentHash: string;
  sourceType: string; sourceRef: string | null; versionTitle: string; versionKind: string;
  versionBody: string; versionHash: string; versionSource: string; versionRef: string | null; arquivadoEm: Date | null }
function corresponde(m: MembroCapturado, item: ItemConferido): boolean {
  return item.chave === m.chave && !item.arquivadoEm && item.sourceType === 'vault' && item.versionSource === 'vault'
    && item.sourceRef === m.metadata.sourceRef && item.versionRef === m.metadata.sourceRef
    && item.contentHash === m.contentHash && item.versionHash === m.contentHash
    && hashDoCorpo(item.body) === m.contentHash && hashDoCorpo(item.versionBody) === m.contentHash
    && item.title === m.metadata.title && item.versionTitle === m.metadata.title
    && item.kind === m.metadata.kind && item.versionKind === m.metadata.kind
    && hashMetadata({ title: item.title, kind: item.kind, tags: item.tags,
      validFrom: iso(item.validFrom), validUntil: iso(item.validUntil), sourceRef: item.sourceRef! }) === m.metadataHash;
}

@Injectable()
export class CatalogoDeColecaoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Chamado no mesmo tx que substitui KnowledgeNote, já sob o lock do índice. */
  async persistirNoIndice(tx: Db, orgId: string, captura: CapturaDoCatalogo | null): Promise<string> {
    const id = randomUUID();
    await tx.$executeRawUnsafe(`INSERT INTO "ContextCollectionSelection"
      (id,"orgId","collectionId","sourceKind",generation,"marcaAntes","membershipDigest",estado)
      SELECT $1,$2,$3,'vault_pasta',COALESCE(MAX(generation),0)+1,$4::jsonb,$5,$6
      FROM "ContextCollectionSelection" WHERE "orgId"=$2 AND "collectionId"=$3`,
      id, orgId, COLECAO, JSON.stringify(captura?.marca ?? null), captura?.membershipDigest ?? null,
      captura ? 'classificado' : 'falhou');
    for (const m of captura?.membros ?? []) {
      await tx.$executeRawUnsafe(`INSERT INTO "ContextCollectionMember"
        (id,"orgId","selectionId",chave,"caminhoBytes","blobGit","hashArquivo","contentHash","metadataHash",metadata,estado)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'classificado')`,
        randomUUID(), orgId, id, m.chave, m.caminhoBytes, m.blobGit, m.hashArquivo, m.contentHash,
        m.metadataHash, JSON.stringify(m.metadata));
    }
    return id;
  }

  async registrarFalha(orgId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `obsidian-index:${orgId}`);
      await this.persistirNoIndice(tx, orgId, null);
    });
  }

  async falhar(orgId: string, selectionId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(`UPDATE "ContextCollectionSelection" SET estado='falhou'
      WHERE id=$1 AND "orgId"=$2 AND estado='classificado'`, selectionId, orgId);
  }

  /** A captura é relida sem fornecedor e deve coincidir inteira antes do commit. */
  async confirmar(orgId: string, selectionId: string, original: CapturaDoCatalogo,
    reler: () => CapturaDoCatalogo | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `obsidian-index:${orgId}`);
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `memoria:${orgId}`);
      const selecoes = await tx.$queryRawUnsafe<Array<{ id: string; estado: string }>>(`SELECT id,estado
        FROM "ContextCollectionSelection" WHERE "orgId"=$1 AND "collectionId"=$2 ORDER BY generation DESC LIMIT 1 FOR UPDATE`, orgId, COLECAO);
      if (selecoes[0]?.id !== selectionId || selecoes[0].estado !== 'classificado') {
        await tx.$executeRawUnsafe(`UPDATE "ContextCollectionSelection" SET estado='falhou'
          WHERE id=$1 AND "orgId"=$2 AND estado='classificado'`, selectionId, orgId);
        return;
      }
      const associacoes: Array<{ membroId: string; item: ItemConferido }> = [];
      for (const m of original.membros) {
        const itens = await tx.$queryRawUnsafe<ItemConferido[]>(`SELECT c.id,c.chave,c.versao,c.title,c.kind::text,
          c.tags,c."validFrom",c."validUntil",c.body,c."contentHash",c."sourceType"::text,c."sourceRef",c."arquivadoEm",
          v.id AS "versionId",v.title AS "versionTitle",v.kind::text AS "versionKind",v.body AS "versionBody",
          v."contentHash" AS "versionHash",v."sourceType"::text AS "versionSource",v."sourceRef" AS "versionRef"
          FROM "ContextItem" c JOIN "ContextItemVersion" v ON v."orgId"=c."orgId" AND v."itemId"=c.id AND v.versao=c.versao
          WHERE c."orgId"=$1 AND c.chave=$2 FOR SHARE OF c,v`, orgId, m.chave);
        const membros = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "ContextCollectionMember"
          WHERE "orgId"=$1 AND "selectionId"=$2 AND chave=$3 AND "hashArquivo"=$4 AND "contentHash"=$5
            AND "metadataHash"=$6 AND "caminhoBytes"=$7 AND "blobGit"=$8 AND estado='classificado'`,
          orgId, selectionId, m.chave, m.hashArquivo, m.contentHash, m.metadataHash, m.caminhoBytes, m.blobGit);
        if (itens.length !== 1 || membros.length !== 1 || !corresponde(m, itens[0])) {
          await tx.$executeRawUnsafe(`UPDATE "ContextCollectionSelection" SET estado='falhou' WHERE id=$1 AND "orgId"=$2`, selectionId, orgId);
          return;
        }
        associacoes.push({ membroId: membros[0].id, item: itens[0] });
      }
      const depois = reler();
      if (!depois || !mesmaMarca(original.marca, depois.marca) || original.membershipDigest !== depois.membershipDigest) {
        await tx.$executeRawUnsafe(`UPDATE "ContextCollectionSelection" SET estado='falhou' WHERE id=$1 AND "orgId"=$2`, selectionId, orgId);
        return;
      }
      for (const a of associacoes) await tx.$executeRawUnsafe(`UPDATE "ContextCollectionMember"
        SET "itemId"=$1,"versionId"=$2,versao=$3,estado='projetado' WHERE id=$4 AND "orgId"=$5 AND estado='classificado'`,
        a.item.id, a.item.versionId, a.item.versao, a.membroId, orgId);
      await tx.$executeRawUnsafe(`UPDATE "ContextCollectionSelection" SET estado='projetado',"marcaDepois"=$1::jsonb,"verificadaEm"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        WHERE id=$2 AND "orgId"=$3 AND estado='classificado'`, JSON.stringify(depois.marca), selectionId, orgId);
    });
  }

  /** Uma única consulta reconfirma pessoa/permissão/ACL e todos os metadados retornados. */
  async porItem(orgId: string, pessoaId: string, itemId: string): Promise<CatalogoDeColecaoDto> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ autorizado: boolean; itemId: string | null; atual: boolean | null;
      ultima: CatalogoDeColecaoDto['ultimaCaptura']; selecao: CatalogoDeColecaoDto['selecaoVerificada'];
      interno: null | { item: ItemConferido; metadata: MembroCapturado['metadata']; metadataHash: string; contentHash: string } }>>(`
      WITH acesso AS (SELECT EXISTS (
        SELECT 1 FROM "User" u JOIN "_UserRoles" ur ON ur."B"=u.id
        JOIN "Role" r ON r.id=ur."A" AND r."orgId"=u."orgId"
        JOIN "_RolePermissions" rp ON rp."B"=r.id JOIN "Permission" p ON p.id=rp."A"
        WHERE u.id=$2 AND u."orgId"=$1 AND u."isActive" AND p.key='obsidian.ver') AS autorizado),
      ultima AS (SELECT * FROM "ContextCollectionSelection" WHERE "orgId"=$1 AND "collectionId"=$4 ORDER BY generation DESC LIMIT 1)
      SELECT a.autorizado,c.id AS "itemId",
        CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id',u.id,'geracao',u.generation::text,
          'registradaEm',to_char(u."criadoEm",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'estado',u.estado) END AS ultima,
        CASE WHEN h.id IS NULL THEN NULL ELSE jsonb_build_object('id',h.id,'colecaoId',h."collectionId",'geracao',h.generation::text,
          'verificadaEm',to_char(h."verificadaEm",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'membershipDigest',h."membershipDigest",'atual',
          u.id=h.id AND u.estado='projetado' AND c.chave=h.chave AND c.versao=h.versao AND c."contentHash"=h."contentHash"
            AND c."sourceType"='vault' AND c."sourceRef"=h.metadata->>'sourceRef' AND c."arquivadoEm" IS NULL,
          'membro',jsonb_build_object('id',h."memberId",'chave',h.chave,'itemId',c.id,'versionId',h."versionId",
            'versao',h.versao,'contentHash',h."contentHash")) END AS selecao,
        CASE WHEN h.id IS NULL THEN NULL ELSE jsonb_build_object('metadata',h.metadata,'metadataHash',h."metadataHash",'contentHash',h."contentHash",
          'item',jsonb_build_object('id',c.id,'chave',c.chave,'versao',c.versao,'title',c.title,'kind',c.kind,'tags',c.tags,
            'validFrom',to_char(c."validFrom",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'validUntil',to_char(c."validUntil",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'body',c.body,'contentHash',c."contentHash",'sourceType',c."sourceType",
            'sourceRef',c."sourceRef",'arquivadoEm',c."arquivadoEm",'versionId',h."versionId",'versionTitle',h."versionTitle",'versionKind',h."versionKind",
            'versionBody',h."versionBody",'versionHash',h."versionHash",'versionSource',h."versionSource",'versionRef',h."versionRef")) END AS interno,
        false AS atual
      FROM acesso a LEFT JOIN "ContextItem" c ON a.autorizado AND c."orgId"=$1 AND c.id=$3
        AND (NOT c."acessoRestrito" OR $2=ANY(c.leitores))
      LEFT JOIN ultima u ON c.id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT s.*,m.id AS "memberId",m.chave,m.versao,m."versionId",m."contentHash",m.metadata,m."metadataHash",
          v.title AS "versionTitle",v.kind::text AS "versionKind",v.body AS "versionBody",v."contentHash" AS "versionHash",
          v."sourceType"::text AS "versionSource",v."sourceRef" AS "versionRef"
        FROM "ContextCollectionMember" m JOIN "ContextCollectionSelection" s ON s.id=m."selectionId" AND s."orgId"=m."orgId"
        JOIN "ContextItemVersion" v ON v.id=m."versionId" AND v."orgId"=m."orgId" AND v."itemId"=m."itemId"
          AND v.versao=m.versao AND v."contentHash"=m."contentHash" AND v."sourceType"='vault'
          AND v."sourceRef"=m.metadata->>'sourceRef' AND v.title=m.metadata->>'title' AND v.kind::text=m.metadata->>'kind'
        WHERE m."orgId"=$1 AND m."itemId"=c.id AND m.estado='projetado' AND s.estado='projetado' AND s."collectionId"=$4
        ORDER BY s.generation DESC LIMIT 1
      ) h ON true`, orgId, pessoaId, itemId, COLECAO);
    if (!rows[0]?.autorizado) throw new ForbiddenException('Acesso insuficiente.');
    if (!rows[0]?.itemId) throw new NotFoundException('Fonte não encontrada.');
    const r = rows[0];
    if (r.selecao && r.interno) {
      const i = r.interno;
      if (hashDoCorpo(i.item.versionBody) !== i.contentHash || hashMetadata(i.metadata) !== i.metadataHash) r.selecao = null;
      else r.selecao.atual = r.selecao.atual && corresponde({ chave: r.selecao.membro.chave,
        caminhoBytes: Buffer.alloc(0), blobGit: '', hashArquivo: '', metadata: i.metadata,
        metadataHash: i.metadataHash, contentHash: i.contentHash }, i.item);
    }
    return { itemId, capturaExternaAgora: false, movimentoDisponivel: false,
      selecaoVerificada: r.selecao, ultimaCaptura: r.ultima };
  }
}
