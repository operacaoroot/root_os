import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
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

export interface EspelhoConfig {
  destino: EspelhoDestino;
  dir: string; // subpasta dentro da vault (destino local)
  folderId: string | null; // id da pasta no Drive (destino drive)
}

/* ========================================================================== *
 * O ESPELHO SEM O NEST — o que o gerador de documentação (RF-M-07) reaproveita
 * ========================================================================== *
 *
 * A fatia 4.6 precisa das MESMAS três perguntas que o espelho já responde —
 * "para onde esta empresa espelha?", "esta pasta é mesmo a vault?" e "como se
 * grava um .md lá dentro sem escapar da pasta?" — só que a partir de um comando
 * de manutenção que NÃO SOBE O NEST (`src/scripts/gerar-documentacao.ts`, no
 * precedente de `expurgar-rastro.ts` e de `memoria.cli.ts`).
 *
 * Por isso a lógica desceu de método para FUNÇÃO LIVRE, e o serviço passou a
 * delegar. Duas consequências que são o motivo da escolha:
 *
 *  1. O ENDEREÇO DA VAULT CONTINUA MORANDO SÓ AQUI. `OBSIDIAN_VAULT_PATH` é
 *     credencial de conector na catraca de arquitetura (`test/arquitetura.test.ts`,
 *     mapa `CREDENCIAIS`), e este arquivo é uma das duas exceções declaradas.
 *     Se o gerador lesse a variável por conta própria, a catraca ficaria
 *     vermelha — e com razão: seria a terceira cópia do mesmo caminho.
 *  2. NÃO HÁ DUAS REGRAS DE ESCAPE DE PASTA. `espelhar()` e o gerador chamam o
 *     mesmo `gravarDocumentoLocal`, que é quem confere `resolve()` + prefixo.
 */

/**
 * A raiz da vault montada nesta máquina, ou string vazia.
 *
 * Função e não constante de módulo: o comando de manutenção roda num processo
 * próprio, e uma constante avaliada no import congelaria o valor antes de quem
 * chama ter chance de conferir o que leu.
 */
export function raizDaVault(): string {
  return process.env.OBSIDIAN_VAULT_PATH ?? '';
}

/** A leitura da configuração do espelho, sem o serviço. */
export async function configDoEspelho(
  prisma: Pick<PrismaService, 'integrationAccount'>,
  orgId: string,
): Promise<EspelhoConfig> {
  const acc = await prisma.integrationAccount.findFirst({
    where: { orgId, key: INTEGRATION_KEY },
  });
  const destinoBruto = (process.env.PAUTA_ESPELHO ?? 'off') as EspelhoDestino;
  const base: EspelhoConfig = {
    destino: ['off', 'local', 'drive'].includes(destinoBruto) ? destinoBruto : 'off',
    dir: process.env.PAUTA_ESPELHO_DIR ?? 'Cerebro-Conteudo/8 - Referência de Conteúdo/fichas-os',
    folderId: process.env.PAUTA_DRIVE_FOLDER_ID || null,
  };
  const saved = (acc?.config ?? null) as Partial<EspelhoConfig> | null;
  if (!saved) return base;
  return {
    destino: saved.destino ?? base.destino,
    dir: saved.dir ?? base.dir,
    folderId: saved.folderId ?? base.folderId,
  };
}

/**
 * Texto livre → pedaço de nome de arquivo seguro (sem acento, sem barra).
 *
 * Sai daqui, e não de uma cópia no gerador de documentação, porque as duas
 * escritas caem na MESMA vault: dois slugs diferentes gerariam dois nomes para o
 * mesmo título e ninguém notaria até ver os arquivos duplicados.
 */
export function slugDeArquivo(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

/** Recusa um `dir` que não seja caminho relativo dentro da vault. */
export function conferirSubpasta(dir: string): void {
  if (!dir.trim()) throw new BadRequestException('dir vazio.');
  if (dir.startsWith('/') || dir.split(/[\\/]/).includes('..')) {
    throw new BadRequestException('dir deve ser um caminho relativo, sem "..".');
  }
}

/** Quantas pastas a sonda abre antes de desistir de achar a marca da vault. */
const PASTAS_SONDADAS = 200;

/**
 * A MARCA DE IDENTIDADE de uma vault do Obsidian.
 *
 * É o próprio Obsidian que cria esta pasta, na primeira vez que a vault é
 * aberta, e NADA neste repositório escreve nela: o espelho de fichas e o gerador
 * de documentação só produzem `.md`. É por isso que ela serve de identidade e um
 * `.md` não serve — ver o cabeçalho de `conferirVaultDeVerdade`.
 */
const MARCA_DA_VAULT = '.obsidian';

/**
 * "A PASTA EXISTE" NÃO É PROVA DE QUE ELA É A VAULT — e esta é a lição que a
 * onda 9 pagou caro.
 *
 * `ObsidianService.reindex` só perguntava se o caminho existia, e um bind mount
 * caído deixa para trás um diretório vazio que passa nessa pergunta. O que vinha
 * depois zerava o índice e arquivava a memória inteira daquela origem. O
 * conserto de lá (e a guarda de `MemoriaService.projetarDaVault`) foi o mesmo
 * raciocínio desta função: EXIGIR PROVA antes de escrever.
 *
 * Aqui o estrago seria mais silencioso e, por isso, pior: documentação gerada
 * numa pasta que ninguém lê não dá erro nenhum — e, se a pasta for a errada mas
 * habitada, alguém lê a documentação da empresa A achando que é da B.
 *
 * NESTA INSTALAÇÃO NÃO É HIPÓTESE: o `OBSIDIAN_VAULT_HOST` da VPS aponta para
 * `/srv/marketing-os/vault`, que o CLAUDE.md do projeto diz, com todas as
 * letras, não ser a vault real. O destino Drive existe exatamente por isso.
 *
 * ----------------------------------------------------------------------------
 * POR QUE A PROVA É `.obsidian`, E NÃO "EXISTE ALGUM .md"
 * ----------------------------------------------------------------------------
 * A primeira versão desta função exigia um `.md` em algum lugar da árvore. Isso
 * pega a pasta VAZIA (o caso da onda 9) e **não pega o caso real acima**: basta
 * um arquivo aparecer em `/srv/marketing-os/vault` para a sonda passar dali em
 * diante — e quem faz esse arquivo aparecer é o próprio sistema. O espelho de
 * fichas grava `.md` ali; o gerador de documentação grava `.md` ali. Na primeira
 * volta a guarda recusa, alguém destrava "só desta vez", e a partir da segunda
 * ela nunca mais recusa: **uma prova que o próprio sistema produz não prova
 * nada.**
 *
 * `.obsidian` não tem esse defeito. Ela é criada pelo Obsidian ao abrir a vault,
 * nenhum caminho deste repositório a escreve, e a sua presença é exatamente a
 * definição de "isto é uma vault". Ela pode estar na raiz (é o caso do
 * `.../Meu Drive/Obsidian/`) ou uma ou mais pastas abaixo, quando a raiz
 * configurada guarda várias vaults (`Cerebro-Conteudo/.obsidian`) — por isso a
 * sonda desce a árvore em vez de olhar só a raiz.
 *
 * Pasta oculta continua sem ser VARRIDA (`.trash`, `.git` e a própria
 * `.obsidian` não são conteúdo), mas agora é OLHADA: é nela que a prova mora.
 */
export function conferirVaultDeVerdade(vault: string): { ok: boolean; motivo: string | null } {
  if (!vault) {
    return {
      ok: false,
      motivo:
        'OBSIDIAN_VAULT_PATH não está configurado nesta máquina. Sem ela não existe destino ' +
        'local — configure a variável ou use o destino Drive.',
    };
  }
  if (!existsSync(vault)) {
    return { ok: false, motivo: `A vault "${vault}" não existe nesta máquina.` };
  }

  const fila = [vault];
  let abertas = 0;
  while (fila.length > 0 && abertas < PASTAS_SONDADAS) {
    const atual = fila.shift() as string;
    abertas++;
    let entradas;
    try {
      entradas = readdirSync(atual, { withFileTypes: true });
    } catch {
      continue; // pasta ilegível não é prova de nada, nem a favor nem contra
    }
    for (const e of entradas) {
      if (e.isDirectory() && e.name === MARCA_DA_VAULT) return { ok: true, motivo: null };
      if (e.name.startsWith('.')) continue; // oculta: olhada acima, nunca varrida
      if (e.isDirectory()) fila.push(join(atual, e.name));
    }
  }

  return {
    ok: false,
    motivo:
      `A pasta "${vault}" existe, mas não tem NENHUMA "${MARCA_DA_VAULT}" nas primeiras ` +
      `${PASTAS_SONDADAS} pastas — e é o Obsidian que cria essa pasta, não nós. Sem ela isto é ` +
      'ponto de montagem caído ou caminho errado muito mais vezes do que é vault nova, e ' +
      'escrever aqui produz documentação que ninguém lê. Conferir a existência de um `.md` não ' +
      'serviria: o próprio sistema escreve `.md` aqui, então a primeira volta fabricaria a prova ' +
      'da segunda. Confira o caminho montado; se a vault é nova mesmo (nunca foi aberta no ' +
      'Obsidian), diga isso explicitamente a quem chamou.',
  };
}

/**
 * O caminho REAL do maior prefixo que já existe de um caminho.
 *
 * Sobe até achar algo que o sistema de arquivos consiga resolver. O que não
 * existe ainda não pode ser atalho para lugar nenhum — quem vai criar é o
 * `mkdirSync` daqui, com nome já conferido contra `..`.
 */
function realDoMaiorPrefixo(caminho: string): string {
  let atual = resolve(caminho);
  for (;;) {
    try {
      return realpathSync(atual);
    } catch {
      const pai = dirname(atual);
      if (pai === atual) return atual; // chegou na raiz sem resolver nada
      atual = pai;
    }
  }
}

/**
 * ESCAPE POR ATALHO DE SISTEMA DE ARQUIVOS — o que a conferência lexical não vê.
 *
 * `resolve()` + prefixo responde sobre o TEXTO do caminho, e um link simbólico
 * não aparece no texto: `<vault>/docs` pode ser um atalho para `/tmp/qualquer`
 * e o texto continua dizendo que está dentro da vault. Sem esta conferência a
 * árvore inteira da documentação era escrita FORA da vault, sem erro nenhum e
 * com código de saída zero.
 *
 * A conferência é a única que responde sobre o disco: resolver o maior prefixo
 * existente dos dois lados e exigir que o alvo caia dentro da base. Igualdade
 * vale — quando a subpasta ainda não existe, o maior prefixo dela É a base, e a
 * parte que falta será criada por nós.
 *
 * O que ela NÃO cobre é a troca entre a conferência e a escrita (alguém
 * transforma a pasta em atalho no meio do caminho). Fechar isso exigiria abrir
 * por descritor (`O_NOFOLLOW`) em vez de por nome, o que o `fs` síncrono não
 * oferece de graça; o ganho não paga o custo num comando de manutenção rodado à
 * mão.
 */
function conferirEscapePorAtalho(base: string, alvo: string): void {
  const baseReal = realDoMaiorPrefixo(base);
  const alvoReal = realDoMaiorPrefixo(alvo);
  if (alvoReal !== baseReal && !alvoReal.startsWith(baseReal + sep)) {
    throw new BadRequestException(
      'o caminho real aponta para fora da vault: há um atalho de sistema de arquivos ' +
        `("${alvo}" resolve para "${alvoReal}"). Nada foi escrito.`,
    );
  }
}

/**
 * O caminho absoluto de `dir` dentro da vault, conferido contra escape.
 *
 * Duas conferências, e as duas são necessárias: `resolve()` + prefixo responde
 * sobre o TEXTO (um `dir` com ".." ou com raiz absoluta), e
 * `conferirEscapePorAtalho` responde sobre o DISCO (um link simbólico que o
 * texto não denuncia).
 */
export function resolverPastaNaVault(vault: string, dir: string): string {
  conferirSubpasta(dir);
  const alvo = resolve(vault, dir);
  // Prefixo ESTRITO: a raiz da vault não vale como destino. Espelhar na raiz
  // despeja arquivo do sistema no meio das notas de quem usa a vault, e era o
  // que a conferência original de `espelhar()` já recusava.
  if (!alvo.startsWith(resolve(vault) + sep)) {
    throw new BadRequestException('dir aponta para fora da vault.');
  }
  conferirEscapePorAtalho(vault, alvo);
  return alvo;
}

/**
 * O caminho absoluto de um arquivo dentro da pasta, conferido contra escape.
 *
 * `nome` pode trazer subpasta (`regras/x.md`) — o gerador de documentação usa
 * isso —, e subpasta é exatamente onde cabe um ".." ou um atalho. As duas
 * conferências são as mesmas de `resolverPastaNaVault`, um nível abaixo.
 */
function resolverArquivoNaPasta(alvoDir: string, nome: string): string {
  const full = resolve(alvoDir, nome);
  if (!full.startsWith(resolve(alvoDir) + sep)) {
    throw new BadRequestException('nome de arquivo aponta para fora da pasta.');
  }
  conferirEscapePorAtalho(alvoDir, full);
  return full;
}

/**
 * O conteúdo atual de um .md da vault, ou `null` quando o arquivo não existe.
 *
 * É o que torna possível a promessa de RF-M-07 ("arquivo editado à mão nunca é
 * sobrescrito"): sem LER o que está lá, não há como saber se aquilo é nosso.
 */
export function lerDocumentoLocal(vault: string, dir: string, nome: string): string | null {
  const full = resolverArquivoNaPasta(resolverPastaNaVault(vault, dir), nome);
  try {
    if (!statSync(full).isFile()) return null;
    return readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

/** Contador de processo, para o nome do arquivo temporário não colidir consigo. */
let sequenciaDoTemporario = 0;

/**
 * Grava um .md dentro da vault, ATOMICAMENTE. Devolve o caminho relativo escrito.
 *
 * Escreve num temporário na MESMA pasta e renomeia por cima. Dois motivos, e os
 * dois são reais aqui:
 *
 *  1. `writeFileSync` trunca o arquivo antes de escrever. Se o processo morrer
 *     no meio — ou se o disco encher —, sobra um `.md` pela metade, e o que
 *     estava lá some. Numa vault isso é perda de conteúdo, não de cache.
 *  2. O Obsidian e o laço de reindexação leem a pasta a qualquer momento. Sem o
 *     renomear, eles podem ler a metade do arquivo e indexar isso; com ele, a
 *     troca é atômica dentro do mesmo sistema de arquivos e quem lê vê ou a
 *     versão velha inteira ou a nova inteira.
 *
 * O temporário nasce OCULTO (`.`) de propósito: é assim que ele fica invisível
 * para o `walk` do `ObsidianService`, para a varredura do gerador de
 * documentação e para o próprio Obsidian, que pulam nome começado com ponto.
 */
export function gravarDocumentoLocal(
  vault: string,
  dir: string,
  nome: string,
  conteudo: string,
): string {
  const alvoDir = resolverPastaNaVault(vault, dir);
  const full = resolverArquivoNaPasta(alvoDir, nome);
  // `nome` pode trazer subpasta (`regras/x.md`): é a pasta do ARQUIVO que tem
  // de existir, e ela já foi conferida contra escape pelos dois resolves acima.
  const pasta = dirname(full);
  mkdirSync(pasta, { recursive: true });

  const temporario = join(
    pasta,
    `.${basename(full)}.parcial-${process.pid}-${++sequenciaDoTemporario}`,
  );
  try {
    writeFileSync(temporario, conteudo, 'utf8');
    renameSync(temporario, full);
  } catch (e) {
    rmSync(temporario, { force: true });
    throw e;
  }
  return join(dir, nome);
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
  private readonly vault = raizDaVault();

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleService,
  ) {}

  async config(orgId: string): Promise<EspelhoConfig> {
    return configDoEspelho(this.prisma, orgId);
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
    conferirSubpasta(novo.dir);

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
    return slugDeArquivo(s);
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
      // resolve + prefixo (dentro de `gravarDocumentoLocal`): garante que nem
      // `dir` nem `nome` escaparam da vault.
      return gravarDocumentoLocal(this.vault, cfg.dir, nome, conteudo);
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
