import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { filtroDeLeitura } from '../memory/acesso-memoria';
import { hashDoCorpo } from '../memory/procedencia';

export interface PedidoDeVault {
  orgId: string;
  agentId: string;
  solicitanteId?: string | null;
}

export interface CitacaoDeVault {
  chave: string;
  itemId: string;
  versao: number;
  versionId: string;
  contentHash: string;
}

/** Leitor explícito da coleção vault:. Não ativa o contexto automático do runtime. */
@Injectable()
export class VaultVersionadaService {
  constructor(private readonly prisma: PrismaService) {}

  private async recusa(p: PedidoDeVault): Promise<string | null> {
    if (!p.orgId || !p.agentId || !p.solicitanteId) return 'solicitante_ausente';
    const casa = await this.prisma.org.findFirst({ where: { id: p.orgId, slug: 'root' }, select: { id: true } });
    if (!casa) return 'empresa_fora_da_casa';
    const agente = await this.prisma.agent.findFirst({
      where: { id: p.agentId, orgId: p.orgId, capacidades: { has: 'contexto.memoria.buscar' } },
      select: { id: true },
    });
    if (!agente) return 'agente_sem_concessao';
    const pessoa = await this.prisma.user.findFirst({
      where: { id: p.solicitanteId, orgId: p.orgId, isActive: true,
        roles: { some: { orgId: p.orgId, permissions: { some: { key: 'obsidian.ver' } } } } },
      select: { id: true },
    });
    if (!pessoa) return 'solicitante_sem_acesso';
    const desligado = await this.prisma.conectorDesligado.findFirst({
      where: { orgId: p.orgId, conector: 'obsidian' }, select: { id: true },
    });
    return desligado ? 'conector_desligado' : null;
  }

  async search(p: PedidoDeVault, query: string, limit = 5) {
    const acessoNegado = await this.recusa(p);
    if (acessoNegado) return { items: [], acessoNegado };
    const rows = await this.prisma.contextItem.findMany({
      where: { orgId: p.orgId, ...filtroDeLeitura(p.solicitanteId), sourceType: 'vault', chave: { startsWith: 'vault:' }, arquivadoEm: null,
        AND: { OR: [{ title: { contains: query, mode: 'insensitive' } }, { body: { contains: query, mode: 'insensitive' } }] } },
      take: Number.isFinite(limit) ? Math.min(20, Math.max(1, Math.floor(limit))) : 5,
      orderBy: { id: 'asc' },
    });
    const items = [];
    for (const row of rows) {
      const item = await this.lerVersao(p, row);
      if (item) items.push(item);
    }
    // Confere de novo depois da leitura; não guarda autorização em cache.
    const elegiveis = await this.prisma.contextItem.findMany({
      where: { orgId: p.orgId, sourceType: 'vault', chave: { startsWith: 'vault:' }, id: { in: items.map((i) => i.id) }, ...filtroDeLeitura(p.solicitanteId), arquivadoEm: null }, select: { id: true },
    });
    const permitidos = new Set(elegiveis.map((i) => i.id));
    const recusaFinal = await this.recusa(p);
    return recusaFinal ? { items: [], acessoNegado: recusaFinal } : { items: items.filter((i) => permitidos.has(i.id)) };
  }

  async get(p: PedidoDeVault, itemId: string) {
    if (await this.recusa(p)) return null;
    const row = await this.prisma.contextItem.findFirst({
      where: { id: itemId, orgId: p.orgId, ...filtroDeLeitura(p.solicitanteId), sourceType: 'vault', chave: { startsWith: 'vault:' }, arquivadoEm: null },
    });
    if (!row) return null;
    const item = await this.lerVersao(p, row);
    const atual = await this.prisma.contextItem.findFirst({ where: { id: itemId, orgId: p.orgId, sourceType: 'vault', chave: { startsWith: 'vault:' }, ...filtroDeLeitura(p.solicitanteId), arquivadoEm: null } });
    return (await this.recusa(p)) || !atual ? null : item;
  }

  private async lerVersao(p: PedidoDeVault, row: { id: string; chave: string; versao: number; contentHash: string; body: string }) {
    const v = await this.prisma.contextItemVersion.findFirst({
      where: { orgId: p.orgId, itemId: row.id, versao: row.versao, sourceType: 'vault', contentHash: row.contentHash },
    });
    if (!v || v.body !== row.body || hashDoCorpo(v.body) !== v.contentHash) return null;
    const citacao: CitacaoDeVault = { chave: row.chave, itemId: row.id, versao: v.versao,
      versionId: v.id, contentHash: v.contentHash };
    return { id: row.id, path: row.chave.slice('vault:'.length), title: v.title, content: v.body, citacao };
  }
}
