import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import type { KnowledgeList, NoteDetail, SearchResult } from '@mktos/shared';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { comContextoDePlataforma } from '../prisma/contexto-de-plataforma';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A empresa da casa, de onde o vault do Obsidian é indexado.
 *
 * Constante do código, nunca valor vindo de fora: era um `'root'` solto no meio
 * da consulta, e slug é adivinhável — o mesmo motivo que tirou o slug da chave
 * do pixel na fatia 1.4 (`src/events/pixel-tenant.service.ts`).
 */
const SLUG_DA_CASA = 'root';

// Base de conhecimento a partir de uma vault Obsidian (montada read-only no container).
// Ingesta .md → KnowledgeNote; embeddings OpenAI (text-embedding-3-small) → pgvector;
// busca SEMÂNTICA (KNN por cosseno) com fallback keyword. Só leitura.
const EMBED_MODEL = 'text-embedding-3-small';

interface ParsedNote {
  path: string;
  folder: string | null;
  title: string;
  tags: string[];
  content: string;
  links: string[];
  wordCount: number;
  fileTime: Date;
}

@Injectable()
export class ObsidianService implements OnModuleInit {
  private readonly log = new Logger('ObsidianService');
  private readonly vault = process.env.OBSIDIAN_VAULT_PATH ?? '';
  private readonly openaiKey = process.env.OPENAI_API_KEY ?? '';
  private readonly openaiBase = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');

  constructor(private readonly prisma: PrismaService) {}

  get configured(): boolean {
    return this.vault.length > 0 && existsSync(this.vault);
  }

  onModuleInit(): void {
    if (!this.configured) {
      if (this.vault) this.log.warn(`OBSIDIAN_VAULT_PATH="${this.vault}" não existe — base de conhecimento off.`);
      return;
    }
    const min = Number(process.env.OBSIDIAN_REINDEX_MIN ?? 30);
    /*
     * A REINDEXAÇÃO É UM CAMINHO DE PLATAFORMA — RF-T-02, RF-T-04.
     *
     * Ela roda 25s depois do arranque e de meia em meia hora, FORA de qualquer
     * requisição: não há token, não há interceptor, não há empresa no contexto.
     * E a primeira consulta é justamente a que DESCOBRE a empresa (a da casa,
     * pelo slug fixo) — não dá para exigir empresa de quem está indo buscá-la.
     *
     * São duas metades, e elas são diferentes de propósito:
     *
     *  1. a busca da empresa roda sob a SENTINELA DE PLATAFORMA, que a política
     *     de linha libera só para LER `Org` (ver `src/prisma/contexto-de-plataforma.ts`
     *     e a migration `20260911050000_isolamento_por_linha`);
     *  2. a indexação inteira — que ESCREVE em `KnowledgeNote` — roda dentro da
     *     empresa encontrada. Daqui em diante este cron é indistinguível de uma
     *     rota autenticada: `app.org_id` sai com a empresa certa e o banco contém
     *     a escrita.
     *
     * Sem a metade 2, sob isolamento por linha a escrita seria recusada (a
     * sentinela não escreve em lugar nenhum) e a base de conhecimento pararia de
     * indexar — em silêncio, porque o `catch` abaixo só avisa.
     */
    const run = async () => {
      try {
        const org = await comContextoDePlataforma(() =>
          this.prisma.org.findUnique({ where: { slug: SLUG_DA_CASA }, select: { id: true } }),
        );
        if (!org) {
          this.log.warn(
            `Obsidian reindex: empresa "${SLUG_DA_CASA}" não encontrada — nada a indexar.`,
          );
          return;
        }
        const r = await comContexto(
          {
            orgId: org.id,
            actorType: 'system',
            correlationId: novaCorrelacao('obsidian'),
            origem: 'cron',
          },
          () => this.reindex(org.id),
        );
        this.log.log(`Obsidian reindex: ${r} nota(s)`);
      } catch (e) {
        this.log.warn(`Obsidian reindex falhou: ${(e as Error).message}`);
      }
    };
    setTimeout(run, 25_000);
    if (min > 0) setInterval(run, min * 60_000);
    this.log.log(`Obsidian vault "${this.vault}" — reindex a cada ${min} min`);
  }

  // ---------- ingestão ----------
  private walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue; // .obsidian, .trash, etc.
      const full = join(dir, entry.name);
      if (entry.isDirectory()) this.walk(full, acc);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) acc.push(full);
    }
    return acc;
  }

  private parse(full: string): ParsedNote {
    const raw = readFileSync(full, 'utf8');
    const rel = relative(this.vault, full);
    const folderRel = dirname(rel);
    const st = statSync(full);

    let body = raw;
    const tags = new Set<string>();
    // frontmatter YAML simples
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fm) {
      body = raw.slice(fm[0].length);
      const inline = fm[1].match(/^tags:\s*\[([^\]]*)\]/m);
      if (inline) inline[1].split(',').forEach((t) => t.trim() && tags.add(t.trim().replace(/['"]/g, '')));
      const block = fm[1].match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
      if (block) block[1].split('\n').forEach((l) => { const m = l.match(/-\s*(.+)/); if (m) tags.add(m[1].trim()); });
    }
    // #tags inline
    for (const m of body.matchAll(/(?:^|\s)#([a-z0-9_\-/]{2,})/gi)) tags.add(m[1]);
    // wikilinks
    const links = [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());
    // título: 1º # ou nome do arquivo
    const h1 = body.match(/^#\s+(.+)$/m);
    const title = (h1?.[1] ?? rel.replace(/\.md$/i, '').split('/').pop() ?? rel).trim();

    return {
      path: rel,
      folder: folderRel === '.' ? null : folderRel,
      title,
      tags: [...tags],
      content: body.trim(),
      links: [...new Set(links)],
      wordCount: body.split(/\s+/).filter(Boolean).length,
      fileTime: st.mtime,
    };
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.openaiBase}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.openaiKey}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts.map((t) => t.slice(0, 8000)) }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings HTTP ${res.status}`);
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data.map((d) => d.embedding);
  }

  async reindex(orgId: string): Promise<number> {
    if (!this.configured) throw new ServiceUnavailableException('OBSIDIAN_VAULT_PATH não configurado.');
    const files = this.walk(this.vault);
    const notes = files.map((f) => this.parse(f));

    // substitui o índice do org (a vault é a fonte da verdade)
    await this.prisma.knowledgeNote.deleteMany({ where: { orgId } });
    for (const n of notes) {
      await this.prisma.knowledgeNote.create({
        data: {
          orgId,
          path: n.path,
          folder: n.folder,
          title: n.title,
          tags: n.tags,
          content: n.content,
          links: n.links,
          wordCount: n.wordCount,
          fileTime: n.fileTime,
        },
      });
    }

    // embeddings (se houver chave) — em lote
    if (this.openaiKey && notes.length) {
      const rows = await this.prisma.knowledgeNote.findMany({ where: { orgId }, select: { id: true, title: true, content: true } });
      const vectors = await this.embed(rows.map((r) => `${r.title}\n\n${r.content}`));
      for (let i = 0; i < rows.length; i++) {
        const vec = `[${vectors[i].join(',')}]`;
        await this.prisma.$executeRawUnsafe('UPDATE "KnowledgeNote" SET embedding = $1::vector WHERE id = $2', vec, rows[i].id);
      }
    }
    return notes.length;
  }

  // ---------- leitura ----------
  async list(orgId: string): Promise<KnowledgeList> {
    const rows = await this.prisma.knowledgeNote.findMany({
      where: { orgId },
      orderBy: { fileTime: 'desc' },
      select: { id: true, path: true, folder: true, title: true, tags: true, links: true, wordCount: true, fileTime: true },
    });
    const withEmb = await this.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      'SELECT count(*)::bigint AS n FROM "KnowledgeNote" WHERE "orgId" = $1 AND embedding IS NOT NULL',
      orgId,
    );
    return {
      items: rows.map((r) => ({ ...r, fileTime: r.fileTime.toISOString() })),
      total: rows.length,
      folders: [...new Set(rows.map((r) => r.folder).filter(Boolean) as string[])].sort(),
      indexedNotes: Number(withEmb[0]?.n ?? 0),
      source: { tool: 'obsidian', generatedAt: new Date().toISOString() },
    };
  }

  async get(orgId: string, id: string): Promise<NoteDetail | null> {
    const r = await this.prisma.knowledgeNote.findFirst({ where: { id, orgId } });
    if (!r) return null;
    return {
      id: r.id, path: r.path, folder: r.folder, title: r.title, tags: r.tags, links: r.links,
      wordCount: r.wordCount, fileTime: r.fileTime.toISOString(), content: r.content,
    };
  }

  async search(orgId: string, query: string, limit = 8): Promise<SearchResult> {
    const q = query.trim();
    const take = Math.min(Math.max(limit, 1), 20);
    let mode: 'semantic' | 'keyword' = 'keyword';
    let rows: Array<any> = [];

    if (this.openaiKey && q) {
      try {
        const [qv] = await this.embed([q]);
        const vec = `[${qv.join(',')}]`;
        rows = await this.prisma.$queryRawUnsafe(
          `SELECT id, path, folder, title, tags, links, "wordCount", "fileTime", content,
                  1 - (embedding <=> $1::vector) AS score
             FROM "KnowledgeNote"
            WHERE "orgId" = $2 AND embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT $3`,
          vec, orgId, take,
        );
        mode = 'semantic';
      } catch (e) {
        this.log.warn(`busca semântica falhou (${(e as Error).message}); usando keyword`);
      }
    }
    if (mode === 'keyword') {
      rows = await this.prisma.$queryRawUnsafe(
        `SELECT id, path, folder, title, tags, links, "wordCount", "fileTime", content, 0 AS score
           FROM "KnowledgeNote"
          WHERE "orgId" = $2 AND (title ILIKE $1 OR content ILIKE $1)
          LIMIT $3`,
        `%${q}%`, orgId, take,
      );
    }

    return {
      query: q,
      mode,
      items: rows.map((r) => ({
        id: r.id, path: r.path, folder: r.folder, title: r.title,
        tags: r.tags ?? [], links: r.links ?? [], wordCount: r.wordCount,
        fileTime: new Date(r.fileTime).toISOString(),
        score: Math.round(Number(r.score) * 1000) / 1000,
        snippet: snippet(r.content, q),
      })),
      source: { tool: 'obsidian', generatedAt: new Date().toISOString() },
    };
  }
}

function snippet(content: string, q: string): string {
  const text = content.replace(/\s+/g, ' ').trim();
  const term = q.split(/\s+/)[0]?.toLowerCase();
  const idx = term ? text.toLowerCase().indexOf(term) : -1;
  if (idx < 0) return text.slice(0, 180);
  const start = Math.max(0, idx - 70);
  return (start > 0 ? '…' : '') + text.slice(start, start + 180) + '…';
}
