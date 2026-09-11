import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleService } from '../google/google.service';

// Espelho .md da ficha (docs/PAUTA.md §8). O Postgres é canônico; o vault recebe
// cópia — escrita numa direção só, sem conflito de sync.
//
// Três destinos, escolhidos na tela (guardados em IntegrationAccount.config, então
// trocar não exige redeploy):
//   off   — não espelha (default)
//   local — grava no filesystem da vault montada (OBSIDIAN_VAULT_PATH)
//   drive — grava numa pasta do Google Drive pela conta OAuth já conectada
//
// O "local" só funciona onde a vault existe: hoje a API roda na VPS com
// OBSIDIAN_VAULT_HOST=/srv/marketing-os/vault, enquanto o vault de verdade vive no
// Drive do Mac. Por isso o "drive" existe — ele não depende de bind mount nenhum.

export type EspelhoDestino = 'off' | 'local' | 'drive';

const INTEGRATION_KEY = 'pauta-espelho';

interface EspelhoConfig {
  destino: EspelhoDestino;
  dir: string; // subpasta dentro da vault (destino local)
  folderId: string | null; // id da pasta no Drive (destino drive)
}

interface FichaEspelhavel {
  id: string;
  titulo: string;
  familia: string;
  objetivo: string;
  autor: string | null;
  plataforma: string | null;
  url: string | null;
  tags: string[];
  campea: boolean;
  atualizadaEm: Date;
  materiaPrima: string;
  tensaoCentral: string;
  emocaoAlvo: string;
  motorPsicologico: string;
  formulaHeadline: string;
  estruturaCorpo: string;
  prova: string;
  cta: string | null;
  preRequisitos: string | null;
  antiPadroes: string | null;
  teoriaImplicita: string | null;
}

@Injectable()
export class EspelhoService {
  private readonly log = new Logger('EspelhoService');
  private readonly vault = process.env.OBSIDIAN_VAULT_PATH ?? '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleService,
  ) {}

  private defaults(): EspelhoConfig {
    const destino = (process.env.PAUTA_ESPELHO ?? 'off') as EspelhoDestino;
    return {
      destino: ['off', 'local', 'drive'].includes(destino) ? destino : 'off',
      dir: process.env.PAUTA_ESPELHO_DIR ?? 'Cerebro-Conteudo/8 - Referência de Conteúdo/fichas-os',
      folderId: process.env.PAUTA_DRIVE_FOLDER_ID || null,
    };
  }

  async config(orgId: string): Promise<EspelhoConfig> {
    const acc = await this.prisma.integrationAccount.findFirst({
      where: { orgId, key: INTEGRATION_KEY },
    });
    const base = this.defaults();
    const saved = (acc?.config ?? null) as Partial<EspelhoConfig> | null;
    if (!saved) return base;
    return {
      destino: saved.destino ?? base.destino,
      dir: saved.dir ?? base.dir,
      folderId: saved.folderId ?? base.folderId,
    };
  }

  async setConfig(orgId: string, patch: Partial<EspelhoConfig>): Promise<EspelhoConfig> {
    const atual = await this.config(orgId);
    const novo: EspelhoConfig = {
      destino: patch.destino ?? atual.destino,
      dir: patch.dir ?? atual.dir,
      folderId: patch.folderId !== undefined ? patch.folderId : atual.folderId,
    };
    if (!['off', 'local', 'drive'].includes(novo.destino)) {
      throw new BadRequestException('destino deve ser off, local ou drive.');
    }
    // Caminho relativo e sem "..": o espelho nunca escreve fora da subpasta.
    if (novo.dir.startsWith('/') || novo.dir.split(/[\\/]/).includes('..')) {
      throw new BadRequestException('dir deve ser um caminho relativo, sem "..".');
    }

    const existente = await this.prisma.integrationAccount.findFirst({
      where: { orgId, key: INTEGRATION_KEY },
    });
    if (existente) {
      await this.prisma.integrationAccount.update({
        where: { id: existente.id },
        data: { config: { ...novo }, status: novo.destino === 'off' ? 'disconnected' : 'connected' },
      });
    } else {
      await this.prisma.integrationAccount.create({
        data: {
          orgId,
          key: INTEGRATION_KEY,
          label: 'Espelho .md das fichas',
          status: novo.destino === 'off' ? 'disconnected' : 'connected',
          config: { ...novo },
        },
      });
    }
    return novo;
  }

  /** Estado para a tela: destino atual, alvo e se dá para gravar agora. */
  async estado(orgId: string): Promise<{
    destino: EspelhoDestino;
    alvo: string | null;
    disponivel: boolean;
    motivo: string | null;
  }> {
    const cfg = await this.config(orgId);
    if (cfg.destino === 'off') {
      return { destino: 'off', alvo: null, disponivel: true, motivo: null };
    }
    if (cfg.destino === 'local') {
      if (!this.vault) {
        return { destino: 'local', alvo: null, disponivel: false, motivo: 'OBSIDIAN_VAULT_PATH não configurado.' };
      }
      if (!existsSync(this.vault)) {
        return {
          destino: 'local',
          alvo: join(this.vault, cfg.dir),
          disponivel: false,
          motivo: `A vault "${this.vault}" não existe nesta máquina — use o destino Drive ou monte a vault.`,
        };
      }
      return { destino: 'local', alvo: join(this.vault, cfg.dir), disponivel: true, motivo: null };
    }
    // drive
    const st = await this.google.status(orgId);
    if (!st.connected) {
      return {
        destino: 'drive',
        alvo: cfg.folderId,
        disponivel: false,
        motivo: 'Google não conectado. Conecte em /google (a autorização OAuth ainda está pendente).',
      };
    }
    if (!cfg.folderId) {
      return { destino: 'drive', alvo: null, disponivel: false, motivo: 'Falta o id da pasta do Drive.' };
    }
    return { destino: 'drive', alvo: cfg.folderId, disponivel: true, motivo: null };
  }

  // ---------- geração do markdown ----------

  private slug(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
  }

  /** Ficha em markdown com frontmatter — o mesmo formato das fichas do vault. */
  markdown(f: FichaEspelhavel): string {
    const campo = (rotulo: string, valor: string | null): string =>
      `- **${rotulo}:** ${valor && valor.trim() ? valor.trim() : 'não consta'}`;

    return [
      '---',
      'type: ficha-referencia',
      `name: ${JSON.stringify(f.titulo)}`,
      `familia: ${f.familia}`,
      `objetivo: ${f.objetivo}`,
      `campea: ${f.campea}`,
      `origem: marketing-os`,
      `id: ${f.id}`,
      `tags: [ficha, referencia, ${f.familia.toLowerCase()}, ${f.objetivo.toLowerCase()}${f.tags.length ? ', ' + f.tags.join(', ') : ''}]`,
      `updated: ${f.atualizadaEm.toISOString().slice(0, 10)}`,
      '---',
      '',
      `# ${f.titulo}`,
      '',
      `> Gerada no Marketing OS (módulo Pauta). O registro canônico é o do sistema —`,
      `> editar aqui não volta pro banco.`,
      '',
      campo('Família / Objetivo', `${f.familia} / ${f.objetivo}`),
      campo('Autor', f.autor),
      campo('Plataforma', f.plataforma),
      campo('Matéria-prima', f.materiaPrima),
      campo('Tensão central', f.tensaoCentral),
      campo('Emoção-alvo do 1º segundo', f.emocaoAlvo),
      campo('Motor psicológico', f.motorPsicologico),
      campo('Fórmula da headline/gancho', f.formulaHeadline),
      campo('Estrutura do corpo', f.estruturaCorpo),
      campo('Prova', f.prova),
      campo('CTA', f.cta),
      campo('Pré-requisitos do criador', f.preRequisitos),
      campo('Anti-padrões', f.antiPadroes),
      campo('Link de referência', f.url),
      campo('Teoria implícita', f.teoriaImplicita),
      '',
    ].join('\n');
  }

  // ---------- gravação ----------

  /** Espelha a ficha no destino configurado. Devolve o caminho/id, ou null se off. */
  async espelhar(orgId: string, ficha: FichaEspelhavel): Promise<string | null> {
    const cfg = await this.config(orgId);
    if (cfg.destino === 'off') return null;

    const nome = `${this.slug(ficha.titulo?.trim() || 'ficha')}-${ficha.id.slice(0, 8)}.md`;
    const conteudo = this.markdown(ficha);

    if (cfg.destino === 'local') {
      if (!this.vault || !existsSync(this.vault)) {
        throw new BadRequestException(
          `Espelho local indisponível: a vault "${this.vault}" não existe nesta máquina.`,
        );
      }
      // resolve + prefixo: garante que dir não escapou da vault
      const alvoDir = resolve(this.vault, cfg.dir);
      if (!alvoDir.startsWith(resolve(this.vault) + sep)) {
        throw new BadRequestException('dir aponta para fora da vault.');
      }
      mkdirSync(alvoDir, { recursive: true });
      const full = join(alvoDir, nome);
      writeFileSync(full, conteudo, 'utf8');
      return join(cfg.dir, nome);
    }

    /*
     * Drive.
     *
     * O ENDEREÇO NÃO MORA MAIS AQUI (fatia 3.3). Até 11/09/2026 este serviço
     * montava as duas URLs da API do Drive — a busca pelo nome e o upload
     * multipart — e as entregava ao `google.api()`, um passa-tudo que aceitava
     * URL e método arbitrários. A porta não via nem o método nem o destino, e a
     * catraca de arquitetura contava isto como violação em duas frentes de uma
     * vez: endereço de fornecedor fora do conector e uso do conector por um
     * atalho genérico.
     *
     * Agora o espelho pede o que ele quer — "grava este texto com este nome
     * nesta pasta" — e quem conhece o endpoint é o conector, que é quem também
     * guarda a credencial.
     */
    if (!cfg.folderId) throw new BadRequestException('Espelho no Drive sem pasta definida.');
    const r = await this.google.gravarArquivoNoDrive(orgId, {
      folderId: cfg.folderId,
      nome,
      conteudo,
    });
    return `drive:${r.id}`;
  }
}
