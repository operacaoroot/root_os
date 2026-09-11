import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import type { KnowledgeList, NoteDetail, SearchResult } from '@mktos/shared';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { comContextoDePlataforma } from '../prisma/contexto-de-plataforma';
import { PrismaService } from '../prisma/prisma.service';
import { ConectoresConfiguradosRegistry } from '../gateway/conectores-configurados.registry';
import {
  PRAZO_DA_CHAMADA_DE_SONDA_MS,
  RegistroDeConectores,
} from '../integrations/conectores.registry';
import {
  type ConectorDoContrato,
  type ContextoDoVerbo,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
  frasedoErro,
  naoConfigurado,
} from '../integrations/contrato-de-conector';

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

  constructor(
    private readonly prisma: PrismaService,
    /*
     * Vem do `GatewayModule`, que é `@Global`: injetar aqui NÃO acrescenta
     * dependência de módulo nenhuma, e é por isso que a inscrição cabe numa
     * linha. Ver o cabeçalho de `gateway/conectores-configurados.registry.ts`.
     */
    private readonly conectoresConfigurados: ConectoresConfiguradosRegistry,
    /**
     * O contrato único de conector (fatia 5.4). Vem de um módulo `@Global`, como
     * o registro acima: injetar aqui não acrescenta aresta de módulo nenhuma.
     */
    private readonly contrato: RegistroDeConectores,
  ) {}

  get configured(): boolean {
    return this.vault.length > 0 && existsSync(this.vault);
  }

  /**
   * O CONTRATO ÚNICO — autorizar, sincronizar, saúde, revogar (RF-X-01).
   *
   * O Obsidian é o conector que mais exercita a parte "não se aplica" do
   * contrato, e é bom que exercite: ele não tem OAuth, não tem token e não tem
   * nada a revogar. O contrato não o esconde atrás de métodos ausentes — ele diz
   * as três coisas com todas as letras, e é isso que a tela mostra em vez de um
   * botão cinza sem explicação.
   */
  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: 'obsidian',
      rotulo: 'Obsidian',
      /*
       * `POST knowledge/reindex` sempre exigiu `obsidian.editar`. O verbo do
       * contrato faz a mesma coisa e por isso exige o mesmo — ver
       * `permissaoParaSincronizar`.
       */
      permissaoParaSincronizar: 'obsidian.editar',
      /*
       * A vault é um CAMINHO NO DISCO da máquina que roda a API, montado pelo
       * operador. Não é credencial desta empresa: todas as empresas do processo
       * enxergam a mesma pasta. O que É por empresa são as notas indexadas — e é
       * por isso que a sonda de saúde conta as notas DESTA empresa, não as da
       * pasta.
       */
      escopoDaCredencial: 'processo',

      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'manual',
        instrucao:
          'O Obsidian não tem autorização a pedir: a vault é uma pasta montada no disco da ' +
          'máquina que roda a API (só leitura), apontada por variável de ambiente pelo ' +
          'operador da VPS. Se a sonda diz que não está configurado, o conserto é montar a ' +
          'pasta e reiniciar a API — não há tela em que alguém clique "permitir".',
      }),

      sincronizar: async (ctx: ContextoDoVerbo): Promise<ResultadoDeSincronizacao> => {
        const n = await this.reindex(ctx.orgId);
        return {
          tipo: 'feito',
          resumo: `${n} nota(s) relidas da vault e reindexadas para esta empresa.`,
          numeros: { notas: n },
        };
      },

      /**
       * A sonda: LÊ a pasta de verdade, SEM BLOQUEAR O PROCESSO.
       *
       * `existsSync` responde à pergunta errada — uma vault desmontada no meio do
       * dia continua com o caminho "existindo" em alguns arranjos de bind mount,
       * e uma pasta sem permissão de leitura existe e não serve para nada. Abrir
       * o diretório é a tentativa contra a dependência real, que é o que separa
       * verde de verde inventado.
       *
       * ----------------------------------------------------------------------
       * POR QUE `readdir` ASSÍNCRONO, E POR QUE ISSO NÃO É PREFERÊNCIA DE ESTILO
       * ----------------------------------------------------------------------
       * `readdirSync` num ponto de montagem PENDURADO (um NFS/sshfs cujo
       * servidor sumiu — que é o modo normal de uma vault montada morrer)
       * bloqueia a thread principal. E o relógio de fora do registro, que existe
       * justamente para que um conector travado não segure a tela, NÃO PODE
       * DISPARAR enquanto o laço de eventos está preso: ele é um `setTimeout`.
       * O resultado seria a API inteira parada — não a linha do Obsidian em
       * vermelho, que é o que esta fatia promete. A versão assíncrona faz a
       * chamada de disco no pool de threads do libuv: o laço continua girando, o
       * relógio dispara, e uma pasta travada derruba a LINHA dela.
       *
       * O prazo de dentro (`Promise.race`) existe pelo mesmo motivo dos outros
       * conectores: vencer o relógio de fora para que a frase que chegue à tela
       * seja esta, que diz o que fazer.
       */
      saude: async (ctx: ContextoDoVerbo): Promise<SaudeDeConector> => {
        if (!this.vault) {
          return naoConfigurado(
            'Nenhuma vault do Obsidian foi apontada no ambiente da API. Enquanto não houver ' +
              'pasta montada, a base de conhecimento fica vazia para todas as empresas.',
          );
        }
        const comecou = Date.now();
        let arquivos: number;
        try {
          arquivos = (await this.lerRaizDaVault()).length;
        } catch (e) {
          return erroDeConector(
            `Não consegui ler a vault em "${this.vault}": ${frasedoErro(e)}. ` +
              'A pasta pode ter sido desmontada, estar pendurada, ou o processo da API pode ter ' +
              'perdido permissão de leitura.',
            Date.now() - comecou,
          );
        }
        /*
         * A PARTE POR EMPRESA. O disco é do processo; o índice é do cliente.
         *
         * ZERO NOTA NÃO É VERDE, e a primeira versão desta fatia dizia o
         * contrário de si mesma aqui: escrevia que responder "a pasta abre" seria
         * verde verdadeiro sobre a pergunta errada — o mesmo defeito do Google —
         * e em seguida devolvia verde com zero nota indexada, mudando só a
         * mensagem. A pergunta desta sonda é "ESTA EMPRESA consegue usar a base
         * de conhecimento AGORA?", e com o índice vazio a resposta é não.
         *
         * `nao_configurado` e não `erro`: nada falhou. Falta rodar a indexação —
         * e o botão que faz isso está na mesma linha da tela.
         */
        const notas = await this.prisma.knowledgeNote.count({ where: { orgId: ctx.orgId } });
        if (notas === 0) {
          return naoConfigurado(
            `A vault abre (${arquivos} entrada(s) na raiz), mas NENHUMA nota está indexada para ` +
              'esta empresa — a base de conhecimento responde vazia a qualquer busca. Rode ' +
              '"sincronizar" nesta linha para indexar.',
          );
        }
        return conectado(
          Date.now() - comecou,
          `vault legível (${arquivos} entrada(s) na raiz) · ${notas} nota(s) indexada(s) para ` +
            'esta empresa.',
        );
      },

      revogar: async (): Promise<ResultadoDeRevogacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'Não há credencial do Obsidian para queimar: a vault é uma pasta lida do disco, sem ' +
          'token nem senha. Para esta empresa parar de usar a base de conhecimento agora, ' +
          'DESLIGUE o conector em Conexões. Para apagar o que já foi indexado, rode ' +
          '"sincronizar" com a vault vazia ou desmontada — o índice é substituído a cada ' +
          'reindexação.',
      }),
    };
  }

  /**
   * Lê a raiz da vault com prazo próprio, sem bloquear o laço de eventos.
   *
   * `readdir` do `fs/promises` roda no pool de threads do libuv — o laço
   * continua girando, e por isso o relógio de fora do registro consegue
   * disparar. O `race` daqui é o corte de DENTRO: ele vence o de fora e entrega
   * à tela a frase deste conector em vez da genérica.
   *
   * O que o prazo NÃO faz é cancelar a chamada de disco: `readdir` não aceita
   * `AbortSignal` em todas as versões suportadas, e uma thread do pool presa num
   * ponto de montagem morto fica presa. São quatro threads por padrão, então o
   * pior caso conhecido está escrito aqui: quatro sondas simultâneas contra uma
   * vault pendurada esgotam o pool e outras operações de disco esperam. Não é o
   * mesmo que travar a API — e é por isso que a resposta de erro sai na hora,
   * com o nome do problema, em vez de a tela ficar girando.
   */
  private async lerRaizDaVault(prazoMs = PRAZO_DA_CHAMADA_DE_SONDA_MS): Promise<string[]> {
    let relogio: ReturnType<typeof setTimeout> | null = null;
    const estouro = new Promise<never>((_, rejeitar) => {
      relogio = setTimeout(
        () =>
          rejeitar(
            new Error(
              `a pasta não respondeu em ${prazoMs} ms — provavelmente é um ponto de montagem ` +
                'pendurado (o servidor do NFS/sshfs sumiu sem fechar a conexão)',
            ),
          ),
        prazoMs,
      );
      relogio.unref?.();
    });
    try {
      return await Promise.race([readdir(this.vault), estouro]);
    } finally {
      if (relogio) clearTimeout(relogio);
    }
  }

  onModuleInit(): void {
    /*
     * A INSCRIÇÃO VEM ANTES DE QUALQUER RETORNO ANTECIPADO — e a ordem é o
     * ponto, não detalhe.
     *
     * A tela de Conexões lia `OBSIDIAN_VAULT_PATH` por conta própria para
     * decidir o selo "conectado" (`integrations/integrations.service.ts`). O
     * nome da variável virava um contrato duplicado entre a tela e este
     * serviço: renomear aqui — ou passar a ler de outro lugar — faria a tela
     * afirmar "desconectado" sobre uma vault montada, sem erro de compilação e
     * sem nada no log. Agora ela PERGUNTA, e quem responde é quem sabe.
     *
     * Se esta linha ficasse depois do `return` abaixo, uma máquina sem vault
     * não se inscreveria — e o `onApplicationBootstrap` do registro DERRUBA a
     * aplicação quando um conector cobrado não responde. "Sem credencial" é
     * uma RESPOSTA (`false`), não uma ausência de resposta: as duas coisas são
     * diferentes e a tela precisa das duas.
     */
    this.conectoresConfigurados.registrar('obsidian', () => this.configured);

    /*
     * O CONTRATO ÚNICO (fatia 5.4), pela mesma razão e com a mesma ordem: ANTES
     * do retorno antecipado. Uma máquina sem vault precisa responder "não
     * configurado, e aqui está o porquê" — e o registro do contrato derruba o
     * arranque quando um conector cobrado não se inscreve, exatamente como o de
     * cima.
     */
    this.contrato.registrar(this.descritorDoContrato(), 'ObsidianService');

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
