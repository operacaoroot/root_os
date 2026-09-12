import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/*
 * Catraca de arquitetura — RF-G-01: ninguém alcança conector fora da porta.
 *
 * O Tool Gateway existe para que TODA ação sobre um sistema externo passe por
 * classificação de risco, retenção e RASTRO. Um caminho paralelo fura essa
 * porta em silêncio: o código compila, o teste de unidade passa, e a escrita
 * externa sai sem decisão de política nenhuma.
 *
 * São CINCO frentes. As quatro primeiras são as quatro maneiras de chegar no
 * fornecedor de dentro de `apps/api`:
 *
 *   1. importar o serviço de conector (`import { EvolutionService }`);
 *   2. escrever a URL do fornecedor e chamar `fetch` — sem conector nenhum;
 *   3. disparar o efeito de uma capacidade sem passar pela porta;
 *   4. ler a credencial ou a URL-base do conector e montar a chamada na mão —
 *      invisível às três primeiras, porque não há import, não há URL literal
 *      (a base vem do ambiente) e não há efeito registrado.
 *
 * A QUINTA É DE OUTRA NATUREZA E ENTROU NA FATIA 5.8: sair de `apps/api`.
 *
 * As quatro primeiras varrem `apps/api` e mais nada. Durante meses existiu um
 * `apps/telegram` que não era coberto por nenhuma delas — um segundo cliente de
 * modelo, um segundo cliente de MCP e um terceiro caminho de escrita, com
 * credencial de conta de máquina no próprio processo. Não havia import de
 * conector (frente 1 cega), o fornecedor dele não estava em `HOSTS` (frente 2
 * cega), ele não registrava efeito (frente 3 cega) e as credenciais dele não
 * estavam em `CREDENCIAIS` (frente 4 cega) — e, sobretudo, ele ficava fora da
 * pasta que as quatro varrem. Uma catraca que não olha para onde o defeito está
 * não é catraca. A frente 5 anda a partir da RAIZ do monorepo — com limites
 * conhecidos, e eles estão escritos ao lado dela, não omitidos.
 *
 * Este arquivo não refatora nada. Ele só congela o estado de hoje e impede que
 * ele piore. A fatia 3.3 pagou parte das violações listadas; o resto está reapontado, linha a
 * linha, para a onda que vai pagá-lo — e a catraca recusa exceção que aponte para fatia já
 * executada.
 *
 * A lista de exceções é uma DÍVIDA declarada, não um perdão: o teste falha nos
 * dois sentidos — quando aparece violação nova fora da lista, e quando uma
 * exceção da lista deixa de existir (aí a linha tem de sair da lista). Sem a
 * segunda metade a lista apodrece e a catraca vira decoração.
 *
 * Roda sem banco e sem dependência nova: é varredura de código-fonte com
 * `node:fs`. Fica no `pnpm test` padrão.
 */

// ---------------------------------------------------------------------------
// Onde fica o código
// ---------------------------------------------------------------------------

/**
 * Acha a raiz de `apps/api` subindo a partir do cwd. Vitest roda com cwd em
 * `apps/api`, mas a CI e o turbo podem invocar de outro lugar — e um teste de
 * arquitetura que não acha o código passaria vazio, que é o pior fracasso
 * possível para uma catraca.
 */
function acharRaizDaApi(): string {
  const marco = path.join('src', 'gateway', 'tool-gateway.service.ts');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, marco))) return dir;
    if (existsSync(path.join(dir, 'apps', 'api', marco))) return path.join(dir, 'apps', 'api');
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(
    `Não encontrei apps/api a partir de "${process.cwd()}". ` +
      'A catraca de arquitetura não pode rodar sem o código-fonte.',
  );
}

const RAIZ = acharRaizDaApi();

/*
 * O que é código de produção desta API. `prisma/` entra: os scripts de semente
 * e de migração de dados rodam com credencial de produção na mão e nada os
 * impede de chamar um conector — varrer só `src/` deixaria essa porta aberta.
 * `test/` fica FORA de propósito: teste não é produção, e um teste que se
 * varresse a si mesmo acusaria os próprios exemplos.
 */
const RAIZES = ['src', 'prisma'];
const PASTAS_IGNORADAS = new Set(['node_modules', 'dist', 'migrations', '.turbo']);

/** Todos os .ts das raízes, em caminho relativo a apps/api e com "/" como separador. */
function listarFontes(): string[] {
  const saida: string[] = [];

  const andar = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const completo = path.join(dir, entrada);
      if (statSync(completo).isDirectory()) {
        if (!PASTAS_IGNORADAS.has(entrada)) andar(completo);
        continue;
      }
      if (entrada.endsWith('.ts') && !entrada.endsWith('.d.ts')) {
        saida.push(path.relative(RAIZ, completo).split(path.sep).join('/'));
      }
    }
  };

  for (const raiz of RAIZES) {
    const completo = path.join(RAIZ, raiz);
    if (existsSync(completo)) andar(completo);
  }
  return saida.sort();
}

// ---------------------------------------------------------------------------
// Varredor: separar código de comentário e de texto
// ---------------------------------------------------------------------------

/*
 * Por que não basta `texto.includes(...)`.
 *
 * Um comentário que cita `ToolGateway` isentava o arquivo; uma mensagem de erro
 * que cita `ASAAS_API_KEY` seria confundida com uso da credencial; e uma URL
 * dentro de comentário viraria violação. Cada uma dessas confusões é um furo em
 * uma direção diferente — duas afrouxam a catraca, uma dá alarme falso.
 *
 * `limpar()` devolve duas VISÕES do arquivo, ambas do mesmo tamanho do original
 * (o que é apagado vira espaço, e a quebra de linha é preservada), para que o
 * deslocamento de qualquer achado ainda dê o número de linha certo:
 *
 *   - `codigo`:   comentário apagado, texto de string preservado.
 *                 É a visão de quem procura import (o especificador é string)
 *                 e endereço de fornecedor (a URL é string).
 *   - `semTexto`: comentário E conteúdo de string apagados.
 *                 É a visão de quem procura identificador — nome de variável de
 *                 ambiente, nome de propriedade injetada, chamada de método.
 *
 * Literal de expressão regular é reconhecido para que `/['"]/` não abra uma
 * string fantasma e desalinhe o resto do arquivo. A expressão dentro de
 * `${...}` num template continua sendo CÓDIGO: `fetch(`${process.env.X}/y`)`
 * é uso de credencial, e apagá-lo seria justamente o furo que a frente 4 fecha.
 */
interface Visoes {
  codigo: string;
  semTexto: string;
}

function limpar(texto: string): Visoes {
  const codigo = texto.split('');
  const semTexto = texto.split('');
  const n = texto.length;

  /** Apaga a posição i. `tudo` = também some do código (caso do comentário). */
  const apagar = (i: number, tudo: boolean) => {
    if (i >= n || texto[i] === '\n') return;
    semTexto[i] = ' ';
    if (tudo) codigo[i] = ' ';
  };

  /** Consome uma string 'x' / "x" a partir da aspa de abertura. */
  const pularString = (i: number, aspas: string): number => {
    i++;
    while (i < n) {
      const c = texto[i];
      if (c === '\\') {
        apagar(i, false);
        apagar(i + 1, false);
        i += 2;
        continue;
      }
      if (c === aspas) return i + 1;
      if (c === '\n') return i; // string não fechada: não engole o arquivo inteiro
      apagar(i, false);
      i++;
    }
    return i;
  };

  /** Consome um template `x${expr}y` a partir da crase de abertura. */
  const pularTemplate = (i: number): number => {
    i++;
    while (i < n) {
      const c = texto[i];
      if (c === '\\') {
        apagar(i, false);
        apagar(i + 1, false);
        i += 2;
        continue;
      }
      if (c === '`') return i + 1;
      if (c === '$' && texto[i + 1] === '{') {
        i = pularExpressao(i + 2); // conteúdo de ${} é código: fica intacto
        continue;
      }
      apagar(i, false);
      i++;
    }
    return i;
  };

  /** Consome o interior de `${...}` até a chave que fecha. */
  const pularExpressao = (i: number): number => {
    let chaves = 1;
    while (i < n && chaves > 0) {
      const c = texto[i];
      if (c === "'" || c === '"') {
        i = pularString(i, c);
        continue;
      }
      if (c === '`') {
        i = pularTemplate(i);
        continue;
      }
      if (c === '{') chaves++;
      else if (c === '}') chaves--;
      i++;
    }
    return i;
  };

  /*
   * Depois destes caracteres, uma barra abre expressão regular; depois de um
   * identificador ou de `)`/`]`, é divisão. Basta para o corpus real, onde
   * regex aparece em `.replace(/…/)`, `= /…/`, `.split(/…/)` e afins.
   */
  const ANTES_DE_REGEX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '~', '<', '>']);
  let anterior = '';

  let i = 0;
  while (i < n) {
    const c = texto[i];
    const d = texto[i + 1];

    if (c === '/' && d === '/') {
      while (i < n && texto[i] !== '\n') apagar(i++, true);
      continue;
    }
    if (c === '/' && d === '*') {
      apagar(i, true);
      apagar(i + 1, true);
      i += 2;
      while (i < n && !(texto[i] === '*' && texto[i + 1] === '/')) apagar(i++, true);
      apagar(i, true);
      apagar(i + 1, true);
      i += 2;
      continue;
    }
    if (c === '/' && ANTES_DE_REGEX.has(anterior)) {
      i++;
      let classe = false;
      while (i < n) {
        const r = texto[i];
        if (r === '\\') {
          i += 2;
          continue;
        }
        if (r === '\n') break;
        if (r === '[') classe = true;
        else if (r === ']') classe = false;
        else if (r === '/' && !classe) {
          i++;
          break;
        }
        i++;
      }
      anterior = 'x';
      continue;
    }
    if (c === "'" || c === '"') {
      i = pularString(i, c);
      anterior = 'x';
      continue;
    }
    if (c === '`') {
      i = pularTemplate(i);
      anterior = 'x';
      continue;
    }

    if (!/\s/.test(c)) anterior = c;
    i++;
  }

  return { codigo: codigo.join(''), semTexto: semTexto.join('') };
}

interface Fonte extends Visoes {
  arquivo: string;
}

const FONTES: Fonte[] = listarFontes().map((arquivo) => ({
  arquivo,
  ...limpar(readFileSync(path.join(RAIZ, arquivo), 'utf8')),
}));

const CAMINHOS = FONTES.map((f) => f.arquivo);
const EXISTE = new Set(CAMINHOS);

/** Número da linha (1-based) de um deslocamento dentro do arquivo. */
function linhaDe(texto: string, deslocamento: number): number {
  let linha = 1;
  for (let i = 0; i < deslocamento && i < texto.length; i++) if (texto[i] === '\n') linha++;
  return linha;
}

// ---------------------------------------------------------------------------
// O que é conector
// ---------------------------------------------------------------------------

/*
 * Conector = código que fala com um sistema de terceiro em nome do tenant.
 * A chave é o caminho relativo a apps/api; o valor é o nome do fornecedor, que
 * só serve para a mensagem de erro ficar legível.
 *
 * Acrescentar um conector novo aqui é obrigatório: um conector fora desta lista
 * não é vigiado por ninguém.
 *
 * `bio/plataformas/*` não são serviços do Nest — são módulos de função solta,
 * herdados do root-bio — mas fazem OAuth próprio e chamam a API do fornecedor,
 * que é a definição de conector. Ficaram de fora da primeira versão desta
 * catraca e por isso a dívida da bio era invisível: o instagram só aparecia por
 * acaso, porque a URL dele contém "instagram.com", e o tiktok não aparecia de
 * jeito nenhum. Declarados aqui, os dois viram dívida contada.
 */
const CONECTORES: Record<string, string> = {
  'src/google/google.service.ts': 'Google',
  'src/meta/meta.service.ts': 'Meta',
  'src/pauta/evolution.service.ts': 'Evolution (WhatsApp)',
  'src/integrations/clickup.service.ts': 'ClickUp',
  'src/obsidian/obsidian.service.ts': 'Obsidian',
  'src/pauta/apify.service.ts': 'Apify',
  'src/finance/pluggy.service.ts': 'Pluggy',
  'src/finance/asaas.service.ts': 'Asaas',
  /*
   * DOIS CLIENTES DE ASAAS NO MESMO PROCESSO, e é declarado em vez de escondido
   * (fatia 6.2, RF-O-03). O de `finance/` fala com a conta da própria ROOT, com
   * a chave de ambiente, e serve ao painel de finanças. Este fala com a conta que
   * COBRA CADA EMPRESA, com a chave que mora no cofre por empresa, e serve à
   * assinatura do produto — relação diferente, credencial diferente, e num mundo
   * com revenda não existe "a chave", existe a de cada operador.
   *
   * O mesmo raciocínio dos dois clientes de Instagram (ver o bloco da bio, mais
   * abaixo): duas autorizações diferentes da mesma plataforma não são o mesmo
   * cliente. Declarar aqui é o que põe este arquivo sob as quatro frentes — sem
   * a linha, ele endereçaria `asaas.com` sem ninguém vigiar.
   */
  'src/billing/cobranca-asaas.service.ts': 'Asaas (cobrança da assinatura)',
  'src/bio/plataformas/instagram.ts': 'Instagram (bio)',
  'src/bio/plataformas/tiktok.ts': 'TikTok (bio)',
};

/**
 * Quem pode importar um conector:
 *
 * 1. o próprio arquivo do conector;
 * 2. o `*.module.ts` da MESMA pasta — é a fiação do Nest, e sem ela o provider
 *    não existe. Declarar um provider não é executar uma ação;
 * 3. qualquer arquivo de `src/gateway/` — a porta.
 *
 * Controller da própria pasta NÃO entra: `google.controller.ts` publica
 * `POST /gmail/send` e `POST /calendar/event`, que são escrita externa sem
 * classificação de risco. É exatamente o buraco que esta catraca vigia.
 *
 * A isenção do `*.module.ts` vale só para IMPORTAR. Re-exportar é outra coisa e
 * tem regra própria mais abaixo — senão a própria isenção viraria o atalho.
 */
function importadorPermitido(arquivo: string, conector: string): boolean {
  if (arquivo === conector) return true;
  if (arquivo.startsWith('src/gateway/')) return true;
  const pastaDoConector = path.posix.dirname(conector);
  return path.posix.dirname(arquivo) === pastaDoConector && arquivo.endsWith('.module.ts');
}

// ---------------------------------------------------------------------------
// Varredura de imports e re-exports
// ---------------------------------------------------------------------------

/*
 * Quatro formas de referenciar outro arquivo. Todas rodam sobre a visão
 * `codigo` (sem comentário), e todas aceitam quebra de linha entre as partes —
 * `from` numa linha e a string na seguinte é TypeScript válido e passaria por
 * uma varredura linha a linha.
 *
 * A classe `[^;'"\`=()]` impede que o casamento atravesse o fim de uma
 * instrução e junte um `export const` com o `import` de baixo: declaração de
 * import e de re-export não contém `;`, `=`, parêntese nem outra string.
 */
const REFERENCIAS: Array<{ padrao: RegExp; tipo: 'import' | 'reexport' | 'ambos' }> = [
  { padrao: /\b(import|export)\b[^;'"`=()]*?\bfrom\s*['"]([^'"]+)['"]/g, tipo: 'ambos' },
  { padrao: /\bimport\s*['"]([^'"]+)['"]/g, tipo: 'import' },
  { padrao: /\bimport\s*\(\s*['"]([^'"]+)['"]/g, tipo: 'import' },
  { padrao: /\brequire\s*\(\s*['"]([^'"]+)['"]/g, tipo: 'import' },
];

interface Referencia {
  arquivo: string;
  linha: number;
  alvo: string;
  tipo: 'import' | 'reexport';
}

/**
 * Especificador relativo → caminho de arquivo relativo a apps/api.
 *
 * Cobre as três grafias que resolvem para o mesmo arquivo e que uma varredura
 * ingênua deixaria passar: sem extensão (`./x`), com extensão de saída
 * (`./x.js`, que é como TypeScript com `moduleResolution: node16` escreve) e
 * pasta com barril (`./x` → `./x/index.ts`).
 */
function resolver(origem: string, especificador: string): string | null {
  if (!especificador.startsWith('.')) return null; // pacote: conector é arquivo do projeto
  const cru = path.posix.normalize(path.posix.join(path.posix.dirname(origem), especificador));
  const semExt = cru.replace(/\.(ts|js|mjs|cjs)$/, '');
  for (const candidato of [`${semExt}.ts`, `${semExt}/index.ts`]) {
    if (EXISTE.has(candidato)) return candidato;
  }
  return `${semExt}.ts`; // não existe no corpus: devolve a melhor leitura para a mensagem
}

function lerReferencias(fonte: Fonte): Referencia[] {
  const saida: Referencia[] = [];
  for (const { padrao, tipo } of REFERENCIAS) {
    padrao.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = padrao.exec(fonte.codigo)) !== null) {
      const especificador = tipo === 'ambos' ? m[2] : m[1];
      const alvo = resolver(fonte.arquivo, especificador);
      if (!alvo) continue;
      saida.push({
        arquivo: fonte.arquivo,
        linha: linhaDe(fonte.codigo, m.index),
        alvo,
        tipo: tipo === 'ambos' ? (m[1] === 'export' ? 'reexport' : 'import') : 'import',
      });
    }
  }
  return saida;
}

const REFS = FONTES.flatMap(lerReferencias);

// ---------------------------------------------------------------------------
// A dívida declarada
// ---------------------------------------------------------------------------

interface Excecao {
  /** Arquivo que alcança o conector (relativo a apps/api). */
  arquivo: string;
  /** Conector alcançado (chave de CONECTORES) ou alvo equivalente da frente. */
  conector: string;
  /** Por que existe hoje e o que precisa acontecer para sumir. */
  motivo: string;
  /** Fatia do plano que remove esta violação. */
  fatia: string;
}

/*
 * Violações que já existem. Cada linha é uma promessa, e o campo `fatia` diz QUEM a paga.
 * Nada aqui é permissão permanente — a lista só encolhe.
 *
 * DEPOIS DA FATIA 3.3 (11/09/2026) as promessas foram REAPONTADAS. Elas diziam "sai na 3.3"
 * e a 3.3 já rodou: promessa que aponta para o passado é dívida sem dono, que ninguém herda e
 * ninguém cobra. Cada uma agora nomeia a onda seguinte, e o `motivo` diz o que impediu agora.
 * A catraca `toda exceção diz qual fatia a remove` recusa fatia já executada.
 */
const EXCECOES: Excecao[] = [
  /*
   * --------------------------------------------------------------------------
   * O QUE A FATIA 3.3 PAGOU AQUI (11/09/2026) — está escrito para que ninguém
   * reintroduza o caminho achando que era assim mesmo:
   *
   *   · `agents/efeitos.service.ts -> pauta/evolution.service.ts` — o efeito de
   *     `whatsapp.mensagem.enviar` mudou de lado: quem o declara agora é o
   *     PRÓPRIO conector, no `onModuleInit` dele. A regra que ficou é
   *     "efeito que fala com sistema de terceiro é declarado pelo conector
   *     daquele sistema"; o mapa de `agents/` só liga o que lê o banco do OS.
   *   · `google/google.controller.ts -> google/google.service.ts` — as nove
   *     ações do Google (cinco leituras e as QUATRO escritas externas) passaram
   *     a ir pela porta (`gateway/porta-do-operador.service.ts`). O controlador
   *     virou tradutor: valida o corpo, traduz para os argumentos do catálogo e
   *     entrega. Não conhece mais o conector.
   * --------------------------------------------------------------------------
   */

  // --- superfície de agentes: o runtime alcança conector sem passar pela porta
  {
    arquivo: 'src/agents/efeitos.service.ts',
    conector: 'src/obsidian/obsidian.service.ts',
    motivo:
      'contexto.memoria.buscar lê o vault direto do mapa de efeitos. É a última linha deste ' +
      'mapa que importa conector, e o conserto é de UMA linha, igual ao que o EvolutionService ' +
      'recebeu nesta fatia: o ObsidianService ganha um onModuleInit que registra o efeito em ' +
      'EfeitosRegistry (que é @Global, então não mexe no grafo de módulos). Não foi feito aqui ' +
      'porque src/obsidian/ é de outra fatia desta onda e a última escrita venceria.',
    fatia: 'onda 8 — resto da 3.3: o conserto mora em src/obsidian/, que era de outra fatia da onda 7',
  },
  {
    arquivo: 'src/agents/context-builder.service.ts',
    conector: 'src/obsidian/obsidian.service.ts',
    motivo:
      'O montador de contexto do agente busca no vault sem passar pela porta. Mesmo conserto e ' +
      'mesmo impedimento da linha acima: o efeito passa a ser declarado pelo ObsidianService e ' +
      'o montador pede a capacidade `contexto.memoria.buscar` em vez do serviço.',
    fatia: 'onda 8 — resto da 3.3: o conserto mora em src/obsidian/, que era de outra fatia da onda 7',
  },

  // --- controllers do próprio módulo do conector: HTTP direto no fornecedor
  {
    arquivo: 'src/google/google-conexao.controller.ts',
    conector: 'src/google/google.service.ts',
    motivo:
      'O CICLO DE VIDA DA CREDENCIAL, e só ele: connect, callback do OAuth, status e ' +
      'disconnect. As nove AÇÕES saíram deste arquivo na fatia 3.3 e hoje passam pela porta; ' +
      'este controlador foi separado justamente para que a exceção fosse precisa em vez de ' +
      'cobrir tudo. Conectar não é ação sobre o mundo — é o consentimento que TORNA a ação ' +
      'possível, dado pela própria pessoa na tela do Google, e o callback é público por ' +
      'construção (quem chega nele é o browser redirecionado, sem sessão). Não há o que reter ' +
      'para aprovação depois. Guardar, ler, cifrar e revogar credencial é o COFRE (fatia 5.3): ' +
      'quando ele existir, é o cofre que este controlador injeta e a linha sai daqui.',
    fatia: '5.3 (COFRE) — permanente até lá',
  },
  {
    arquivo: 'src/meta/meta.controller.ts',
    conector: 'src/meta/meta.service.ts',
    motivo: 'Callback OAuth e leitura do Instagram fora da porta.',
    fatia: 'onda 8 — resto da 3.3',
  },
  {
    arquivo: 'src/obsidian/obsidian.controller.ts',
    conector: 'src/obsidian/obsidian.service.ts',
    motivo: 'Leitura e reindexação do vault protegidas só por permissão de papel, sem RASTRO da porta.',
    fatia: 'onda 8 — resto da 3.3',
  },
  {
    arquivo: 'src/integrations/integrations.controller.ts',
    conector: 'src/integrations/clickup.service.ts',
    motivo: 'POST clickup/sync dispara sincronização com o ClickUp fora da porta.',
    fatia: 'onda 8 — resto da 3.3',
  },

  // --- serviços de domínio que falam com o fornecedor por conta própria
  {
    arquivo: 'src/content/content.service.ts',
    conector: 'src/integrations/clickup.service.ts',
    motivo: 'O módulo de conteúdo escreve tarefa no ClickUp direto.',
    fatia: 'onda 8 — resto da 3.3',
  },
  {
    arquivo: 'src/goals/goals.service.ts',
    conector: 'src/meta/meta.service.ts',
    motivo: 'Metas puxa número do Instagram/Meta direto para preencher a semana.',
    fatia: 'onda 8 — resto da 3.3',
  },
  {
    arquivo: 'src/finance/finance.service.ts',
    conector: 'src/finance/pluggy.service.ts',
    motivo: 'Financeiro consulta Open Finance direto (leitura, mas fora do RASTRO da porta).',
    fatia: 'onda 8 — resto da 3.3',
  },
  {
    arquivo: 'src/finance/finance.service.ts',
    conector: 'src/finance/asaas.service.ts',
    motivo: 'Financeiro consulta o Asaas direto — e o Asaas também sabe cobrar, não só ler.',
    fatia: 'onda 8 — resto da 3.3',
  },
  {
    arquivo: 'src/billing/assinatura.service.ts',
    conector: 'src/billing/cobranca-asaas.service.ts',
    motivo:
      'A ASSINATURA CONSULTA O PROVEDOR DE COBRANÇA DIRETO, e a leitura é SÓ LEITURA: `GET ' +
      '/payments?subscription=…`, com a chave saindo do cofre por empréstimo com prazo. ' +
      'Nenhuma escrita externa passa por aqui — criar cobrança, cancelar e alterar valor ' +
      'continuam sendo feitos no painel do provedor, justamente porque escrita externa é R3 e ' +
      'não sai fora da porta. O que impede a leitura de ir pela porta HOJE é que ela precisaria ' +
      'de uma capacidade NOVA no catálogo (`assinatura.cobrancas.listar`), e capacidade nova em ' +
      'produção só entra por semente assinada, que é ritual de três passos fora do alcance de ' +
      'uma fatia. O que a exceção custa está medido: esta chamada não gera linha de RASTRO da ' +
      'porta — mas a DECISÃO que ela alimenta gera (`assinatura.suspensa`/`assinatura.ativa`, ' +
      'R4, com motivo e estado anterior), então o que mudou acesso fica registrado.',
    fatia: 'onda 12 — capacidade `assinatura.cobrancas.listar` no catálogo + semente assinada',
  },

  // --- pauta: o módulo mais furado, com quatro caminhos próprios
  {
    arquivo: 'src/pauta/pauta.service.ts',
    conector: 'src/pauta/apify.service.ts',
    motivo: 'Coleta de Instagram/TikTok via Apify direto, sem teto de execuções decidido pela porta.',
    fatia: 'onda 8 — resto da 3.3',
  },
  {
    arquivo: 'src/pauta/espelho.service.ts',
    conector: 'src/google/google.service.ts',
    motivo:
      'O PASSA-TUDO FOI FECHADO NA FATIA 3.3 e o que sobra aqui é outra coisa. `google.api()` ' +
      'era público e aceitava URL e método arbitrários: o espelho montava os dois endereços do ' +
      'Drive aqui dentro e entregava prontos, então mover o import não moveria fronteira ' +
      'nenhuma. Hoje `api()` é privado e o espelho chama `gravarArquivoNoDrive(orgId, {folderId, ' +
      'nome, conteudo})` — destino fixo, método fixo, decidido pelo conector. O import que resta ' +
      'é de uma escrita do OS no Drive DELE, por rotina, e não de ação proposta por agente: para ' +
      'virar capacidade ela precisaria de uma entrada nova no catálogo, e capacidade nova em ' +
      'produção só entra por semente assinada.',
    fatia: 'onda 8 — resto da 3.3: passa-tudo já fechado; o import só sai com capacidade NOVA no catálogo',
  },
  {
    arquivo: 'src/pauta/publicacao.service.ts',
    conector: 'src/pauta/evolution.service.ts',
    motivo: 'Publicação manda WhatsApp em grupo direto pela Evolution.',
    fatia: 'onda 8 — resto da 3.3',
  },
  {
    arquivo: 'src/pauta/publicacao.service.ts',
    conector: 'src/integrations/clickup.service.ts',
    motivo: 'Publicação abre tarefa no ClickUp direto.',
    fatia: 'onda 8 — resto da 3.3',
  },
  {
    arquivo: 'src/pauta/rodada.controller.ts',
    conector: 'src/pauta/evolution.service.ts',
    motivo: 'O controller da rodada consulta o estado da instância da Evolution direto.',
    fatia: 'onda 8 — resto da 3.3',
  },

  /*
   * --------------------------------------------------------------------------
   * BIO: dois conectores inteiros fora da porta, herdados do root-bio
   * --------------------------------------------------------------------------
   *
   * A DECISÃO DA FATIA 3.3 SOBRE OS DOIS CLIENTES DE INSTAGRAM NO MESMO PROCESSO
   * — a pergunta era se `bio/plataformas/instagram.ts` dobra dentro do
   * `MetaService` ou permanece conector próprio. **Permanece separado**, e o
   * argumento tem três partes:
   *
   *  1. NÃO SÃO O MESMO CLIENTE, SÃO DUAS AUTORIZAÇÕES DIFERENTES DA MESMA
   *     PLATAFORMA. O da bio autoriza a conta PESSOAL do criador para listar as
   *     mídias que alimentam a página de links; o `MetaService` fala com a conta
   *     de negócio, pelo app da Meta, para ler métrica e alcance. Escopos
   *     diferentes, telas de consentimento diferentes, ciclos de renovação
   *     diferentes. Fundir os dois obrigaria uma das duas superfícies a pedir
   *     escopo que ela não usa — o contrário do que a régua quer.
   *  2. O ENDEREÇO DE RETORNO ESTÁ TRAVADO POR REVISÃO EXTERNA. O callback da
   *     bio (`/api/conectar/:plataforma/callback`) é a redirect URI registrada
   *     nos consoles da Meta e do TikTok. Trocá-la exige App Review novo, cujo
   *     prazo não depende de nós. Pagar esse custo para ganhar um cliente HTTP a
   *     menos é trocar risco de arquitetura por risco de operação.
   *  3. O QUE PRECISA CONVERGIR NÃO É O CLIENTE, É O PORTÃO. Dois clientes são
   *     aceitáveis; duas fronteiras, não. As três consequências concretas, que é
   *     o que sobra de dívida aqui:
   *       (a) as ações dos dois passam a ser capacidade declarada e a sair pela
   *           porta, como as do Google passaram nesta fatia;
   *       (b) os dois respondem pela MESMA chave de conector (`instagram`), para
   *           que "desligar o Instagram" na tela de Conexões pare os dois — hoje
   *           para só um;
   *       (c) os dois se inscrevem em `ConectoresConfiguradosRegistry`.
   *
   * POR QUE NÃO FOI FEITO AQUI: `src/bio/` é editado ao mesmo tempo pela fatia
   * 5.3 (COFRE), que move o armazenamento e a cifragem dos tokens destes dois
   * conectores. Mexer nas mesmas linhas em paralelo destruiria um dos dois
   * trabalhos — a divisão combinada é "3.3 mexe em rota e serviço de escrita,
   * 5.3 mexe em credencial", e em `bio/` as duas coisas estão no mesmo método
   * (trocar código por token É guardar credencial). Fica para a onda seguinte,
   * com o desenho acima já decidido.
   */
  {
    arquivo: 'src/bio/bio.service.ts',
    conector: 'src/bio/plataformas/instagram.ts',
    motivo:
      'Monta a URL de autorização OAuth do Instagram direto, sem a porta ver a concessão de ' +
      'escopo. Ver a DECISÃO no bloco acima: os dois clientes permanecem separados; o que ' +
      'converge é o portão (capacidade declarada, mesma chave de conector, inscrição no ' +
      'registro de configurados).',
    fatia: 'onda 8 — desenho decidido na 3.3; a execução é em src/bio/, que era da 5.3 na onda 7',
  },
  {
    arquivo: 'src/bio/bio.service.ts',
    conector: 'src/bio/plataformas/tiktok.ts',
    motivo: 'Idem para o TikTok, incluindo o verifier PKCE. Ver a DECISÃO no bloco acima.',
    fatia: 'onda 8 — desenho decidido na 3.3; a execução é em src/bio/',
  },
  {
    arquivo: 'src/bio/bio-oauth.controller.ts',
    conector: 'src/bio/plataformas/instagram.ts',
    motivo:
      'Troca o código por token e lê o perfil no callback, fora da porta. Este método é o ' +
      'ponto exato onde as duas fatias desta onda se encontram: trocar código por token É ' +
      'guardar credencial (5.3) e é também rota de escrita (3.3). Ver a DECISÃO no bloco acima.',
    fatia: 'onda 8 — desenho decidido na 3.3; a execução é em src/bio/',
  },
  {
    arquivo: 'src/bio/bio-oauth.controller.ts',
    conector: 'src/bio/plataformas/tiktok.ts',
    motivo: 'Idem para o TikTok. Ver a DECISÃO no bloco acima.',
    fatia: 'onda 8 — desenho decidido na 3.3; a execução é em src/bio/',
  },
  {
    arquivo: 'src/bio/bio-sync.service.ts',
    conector: 'src/bio/plataformas/instagram.ts',
    motivo:
      'Renova token e puxa mídias do Instagram por rotina, sem classificação nem RASTRO. ' +
      'Renovar token é 5.3; puxar mídia é 3.3. Ver a DECISÃO no bloco acima.',
    fatia: 'onda 8 — desenho decidido na 3.3; a execução é em src/bio/',
  },
  {
    arquivo: 'src/bio/bio-sync.service.ts',
    conector: 'src/bio/plataformas/tiktok.ts',
    motivo:
      'Renova token e puxa vídeos do TikTok por rotina, sem classificação nem RASTRO. ' +
      'Ver a DECISÃO no bloco acima.',
    fatia: 'onda 8 — desenho decidido na 3.3; a execução é em src/bio/',
  },
];

const chave = (arquivo: string, conector: string) => `${arquivo} -> ${conector}`;

/** Casa a lista de violações reais com a lista declarada, nos dois sentidos. */
function conferir(
  reais: Array<{ arquivo: string; conector: string }>,
  declaradas: Excecao[],
): { novas: Array<{ arquivo: string; conector: string }>; podres: string[] } {
  const jaSabidas = new Set(declaradas.map((e) => chave(e.arquivo, e.conector)));
  const existentes = new Set(reais.map((v) => chave(v.arquivo, v.conector)));
  return {
    novas: reais.filter((v) => !jaSabidas.has(chave(v.arquivo, v.conector))),
    podres: declaradas.map((e) => chave(e.arquivo, e.conector)).filter((k) => !existentes.has(k)),
  };
}

// ---------------------------------------------------------------------------
// Prova de que o varredor faz o que promete
// ---------------------------------------------------------------------------

/*
 * A catraca inteira depende de `limpar()` separar código de comentário e de
 * texto. Se essa separação errar, a catraca erra em silêncio — que é o modo de
 * falha mais caro. Então ela é testada contra um trecho sintético com todas as
 * armadilhas conhecidas, em vez de ser assumida correta.
 */
describe('varredor: separa código, comentário e texto', () => {
  const amostra = [
    "// import { Falso } from './comentario.service';",
    "/* export { Outro } from './bloco.service'; https://api.clickup.com */",
    "import { Real } from './real.service';",
    "import {",
    "  Quebrado,",
    "}",
    "from",
    "  './quebrado.service';",
    "const barra = '/x'.replace(/['\"]/g, '');",
    "const url = 'https://api.pluggy.ai/items';",
    "const erro = 'defina ASAAS_API_KEY no .env';",
    "const usa = `${process.env.EVOLUTION_URL}/message`;",
  ].join('\n');

  const { codigo, semTexto } = limpar(amostra);

  it('não deixa o comentário virar código', () => {
    expect(codigo).not.toContain('comentario.service');
    expect(codigo).not.toContain('bloco.service');
    expect(codigo).not.toContain('api.clickup.com');
  });

  it('preserva o tamanho e as quebras de linha', () => {
    expect(codigo.length).toBe(amostra.length);
    expect(semTexto.length).toBe(amostra.length);
    expect(codigo.split('\n').length).toBe(amostra.split('\n').length);
  });

  it('acha import quebrado em várias linhas e ignora o de comentário', () => {
    const fonte: Fonte = { arquivo: 'src/x/y.service.ts', codigo, semTexto };
    const alvos = lerReferencias(fonte).map((r) => r.alvo);
    expect(alvos).toContain('src/x/real.service.ts');
    expect(alvos).toContain('src/x/quebrado.service.ts');
    expect(alvos).not.toContain('src/x/comentario.service.ts');
    expect(alvos).not.toContain('src/x/bloco.service.ts');
  });

  it('a aspa dentro de expressão regular não desalinha o resto do arquivo', () => {
    // Se `/['"]/` abrisse uma string fantasma, a URL da linha seguinte sumiria.
    expect(codigo).toContain('https://api.pluggy.ai/items');
  });

  it('nome de variável em mensagem de erro não conta como uso', () => {
    expect(semTexto).not.toContain('ASAAS_API_KEY');
  });

  it('expressão dentro de template continua sendo código', () => {
    expect(semTexto).toContain('process.env.EVOLUTION_URL');
  });
});

// ---------------------------------------------------------------------------
// Frente 1: importar (ou re-exportar) o conector
// ---------------------------------------------------------------------------

describe('catraca de arquitetura: conector só pela porta', () => {
  const importsDeConector = REFS.filter((r) => r.tipo === 'import' && CONECTORES[r.alvo] !== undefined);
  const violacoes = importsDeConector
    .filter((r) => !importadorPermitido(r.arquivo, r.alvo))
    .map((r) => ({ arquivo: r.arquivo, linha: r.linha, conector: r.alvo }));

  /*
   * Guarda de sanidade. Uma varredura que não achou nada passa em silêncio, e
   * um teste que sempre passa não protege coisa nenhuma.
   */
  it('acha o código-fonte da API', () => {
    expect(CAMINHOS.length).toBeGreaterThan(50);
    expect(CAMINHOS).toContain('src/gateway/tool-gateway.service.ts');
    expect(CAMINHOS.some((c) => c.startsWith('prisma/'))).toBe(true);
    expect(REFS.length).toBeGreaterThan(50);
  });

  it('o catálogo de conectores aponta para arquivos que existem', () => {
    // Renomear um conector sem atualizar o catálogo desarmaria a catraca sem
    // que ninguém percebesse.
    const sumidos = Object.keys(CONECTORES).filter((c) => !EXISTE.has(c));
    expect(sumidos, `conector do catálogo não existe mais: ${sumidos.join(', ')}`).toEqual([]);
  });

  it('nenhum módulo novo importa conector fora do gateway', () => {
    const { novas } = conferir(violacoes, EXCECOES);
    expect(
      novas.map((v) => `${v.arquivo} importa ${CONECTORES[v.conector]} (${v.conector})`),
      'Conector alcançado fora do Tool Gateway. Toda ação sobre sistema externo passa pela ' +
        'porta (RF-G-01): classificação, retenção e RASTRO. Se a violação for inevitável por ' +
        'ora, declare em EXCECOES com o motivo e a fatia que a remove.',
    ).toEqual([]);
  });

  it('a lista de exceções não guarda violação que já foi resolvida', () => {
    const { podres } = conferir(violacoes, EXCECOES);
    expect(
      podres,
      'Exceção declarada que não corresponde a nenhuma violação real. A dívida foi paga: ' +
        'apague a linha de EXCECOES para a catraca não afrouxar sozinha.',
    ).toEqual([]);
  });

  /*
   * Sem lista de exceção, de propósito.
   *
   * `export { GoogleService } from './google.service'` dentro do
   * `google.module.ts` — que é isento de importar — transformaria o módulo num
   * segundo endereço do conector, e daí qualquer arquivo do projeto poderia
   * importar o conector pelo módulo sem que a frente 1 visse nada. O mesmo vale
   * para um barril `index.ts` na pasta do conector. Não existe re-export
   * legítimo de conector: quem precisa dele injeta o provider.
   */
  it('ninguém re-exporta conector, nem o módulo isento', () => {
    const reexports = REFS.filter(
      (r) => r.tipo === 'reexport' && CONECTORES[r.alvo] !== undefined && r.arquivo !== r.alvo,
    );
    expect(
      reexports.map((r) => `${r.arquivo}:${r.linha} re-exporta ${CONECTORES[r.alvo]} (${r.alvo})`),
      'Re-export de conector cria um segundo endereço para ele e contorna a frente 1 inteira: ' +
        'quem importar o re-exportador alcança o conector sem aparecer em lugar nenhum. ' +
        'Quem precisa do conector injeta o provider pelo módulo do Nest.',
    ).toEqual([]);
  });

  it('toda exceção diz qual fatia a remove — e não uma que já rodou', () => {
    const todas = [
      ...EXCECOES,
      ...EXCECOES_HOST,
      ...EXCECOES_EFEITO,
      ...EXCECOES_CREDENCIAL,
      ...EXCECOES_MODELO,
      ...EXCECOES_CONTA_DE_ACAO,
    ];
    const semDestino = todas
      .filter((e) => e.fatia.trim() === '' || e.motivo.trim() === '')
      .map((e) => chave(e.arquivo, e.conector));
    expect(semDestino, 'exceção sem motivo ou sem fatia de remoção').toEqual([]);

    /*
     * ------------------------------------------------------------------------
     * DÍVIDA NÃO PODE APONTAR PARA UMA FATIA QUE JÁ ACONTECEU
     * ------------------------------------------------------------------------
     * A catraca conferia só que o campo não estava vazio. Resultado: 22 das 25
     * exceções continuavam prometendo "sai na 3.3" DEPOIS de a 3.3 ter rodado,
     * e uma promessa que aponta para o passado é dívida sem dono — ninguém a
     * herda, ninguém a cobra, e a lista deixa de encolher sem que nada reprove.
     *
     * A lista abaixo é das fatias já executadas. Quem a atualiza é quem fecha a
     * onda: ao terminar uma fatia, o que ela NÃO pagou tem de ser reapontado
     * para a fatia (ou a onda) que vai pagar, com o impedimento por escrito.
     */
    const JA_RODARAM = ['3.2', '3.3'];
    /*
     * ANCORADO NO COMEÇO da string: o DESTINO é a primeira coisa que o campo
     * diz. Citar a fatia antiga mais adiante continua valendo — "onda 8 — resto
     * da 3.3" é exatamente a frase certa, porque diz quem paga e de onde a
     * dívida veio. O que reprova é o campo ABRIR com uma fatia já executada.
     */
    const apontamParaOPassado = todas
      .filter((e) => JA_RODARAM.some((f) => new RegExp(`^\\s*${f.replace('.', '\\.')}\\b`).test(e.fatia)))
      .map((e) => `${chave(e.arquivo, e.conector)} → "${e.fatia}"`);
    expect(
      apontamParaOPassado,
      '\nEXCEÇÃO APONTANDO PARA FATIA JÁ EXECUTADA:\n' +
        apontamParaOPassado.map((c) => `  - ${c}`).join('\n') +
        '\n\n  Uma dívida que promete sair numa fatia que já rodou não tem dono. Reaponte para\n' +
        '  a onda/fatia que de fato vai pagá-la, dizendo no `motivo` o que impediu agora.\n' +
        '  Mencionar a fatia antiga no MOTIVO continua permitido — é a procedência da dívida;\n' +
        '  o que não vale é declará-la como DESTINO.\n',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Frente 2: alcançar o fornecedor sem sequer usar o conector
// ---------------------------------------------------------------------------

/*
 * Import de conector é só um dos caminhos. O outro é escrever a URL do
 * fornecedor num arquivo qualquer e chamar `fetch` — aí não há nem conector nem
 * porta. Esta frente vigia o endereço, não o import.
 *
 * Arquivo de conector é ignorado de propósito: falar com o fornecedor é o
 * trabalho dele.
 */
const HOSTS: Array<{ padrao: RegExp; conector: string }> = [
  { padrao: /https?:\/\/[\w.-]*googleapis\.com/, conector: 'src/google/google.service.ts' },
  { padrao: /https?:\/\/(?:[\w-]+\.)*google\.com/, conector: 'src/google/google.service.ts' },
  { padrao: /https?:\/\/(?:[\w-]+\.)*facebook\.com/, conector: 'src/meta/meta.service.ts' },
  { padrao: /https?:\/\/(?:[\w-]+\.)*instagram\.com/, conector: 'src/meta/meta.service.ts' },
  { padrao: /https?:\/\/(?:[\w-]+\.)*clickup\.com/, conector: 'src/integrations/clickup.service.ts' },
  { padrao: /https?:\/\/(?:[\w-]+\.)*apify\.com/, conector: 'src/pauta/apify.service.ts' },
  { padrao: /https?:\/\/(?:[\w-]+\.)*pluggy\.ai/, conector: 'src/finance/pluggy.service.ts' },
  { padrao: /https?:\/\/(?:[\w-]+\.)*asaas\.com/, conector: 'src/finance/asaas.service.ts' },
  // TikTok tem dois domínios: o de autorização e o da API aberta.
  { padrao: /https?:\/\/(?:[\w-]+\.)*tiktok\.com/, conector: 'src/bio/plataformas/tiktok.ts' },
  { padrao: /https?:\/\/(?:[\w-]+\.)*tiktokapis\.com/, conector: 'src/bio/plataformas/tiktok.ts' },
];

/*
 * DÍVIDA PAGA NA FATIA 3.3: `src/pauta/espelho.service.ts` não endereça mais a
 * API do Drive. Ele montava a busca por nome e o upload multipart aqui dentro e
 * entregava as duas URLs ao passa-tudo `google.api()`; hoje chama
 * `GoogleService.gravarArquivoNoDrive`, que tem destino e método fixos. A linha
 * saiu desta lista.
 */
const EXCECOES_HOST: Excecao[] = [
  {
    arquivo: 'src/auth/google-login.service.ts',
    conector: 'src/google/google.service.ts',
    motivo:
      'DECIDIDO NA FATIA 3.3: autenticação do OPERADOR **não** é conector, e por isso o cliente ' +
      'HTTP não vai para o GoogleService. A régua R0–R5 classifica ação que a EMPRESA faz sobre ' +
      'o mundo por meio de um terceiro; entrar no OS não é isso — é uma pessoa provando quem é, ' +
      'sem efeito nenhum fora da casa, e não há o que reter para aprovação nem o que desligar ' +
      'num incidente (desligar o Google não pode trancar o login). Mandar este fluxo pelo ' +
      'conector acoplaria a porta de entrada do produto ao interruptor de um conector, o que é ' +
      'o contrário do que se quer. A linha FICA, então, como regra e não como dívida de ' +
      'arquitetura. O que continua sendo dívida REAL é outra coisa e é da fatia do COFRE: as ' +
      'credenciais são as MESMAS do GoogleService, lidas em dois lugares — trocar num e esquecer ' +
      'o outro quebra metade do produto sem erro de compilação. O conserto é as duas leituras ' +
      'virem do cofre, não este arquivo virar conector.',
    fatia: '5.3 (COFRE) — a leitura duplicada da credencial; o endereço fica aqui por decisão',
  },
];

describe('catraca de arquitetura: endereço de fornecedor só dentro do conector', () => {
  const achados = FONTES.filter((f) => CONECTORES[f.arquivo] === undefined).flatMap((fonte) => {
    const porConector = new Map<string, number>();
    for (const { padrao, conector } of HOSTS) {
      const m = new RegExp(padrao.source, 'g').exec(fonte.codigo);
      if (m && !porConector.has(conector)) porConector.set(conector, linhaDe(fonte.codigo, m.index));
    }
    return [...porConector].map(([conector, linha]) => ({ arquivo: fonte.arquivo, linha, conector }));
  });

  it('nenhum arquivo novo chama o fornecedor direto', () => {
    const { novas } = conferir(achados, EXCECOES_HOST);
    expect(
      novas.map((a) => `${a.arquivo} endereça ${CONECTORES[a.conector]} direto`),
      'Endpoint de fornecedor fora do conector: nem a porta nem o conector veem essa chamada. ' +
        'Mova para o serviço de conector, ou declare em EXCECOES_HOST com a fatia que remove.',
    ).toEqual([]);
  });

  it('a lista de exceções de endereço não guarda dívida já paga', () => {
    const { podres } = conferir(achados, EXCECOES_HOST);
    expect(podres, 'exceção de endereço sem violação correspondente: apague a linha').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Frente 3: um único caminho de execução de efeito
// ---------------------------------------------------------------------------

/*
 * `EfeitosRegistry.executar()` é o gatilho do efeito de uma capacidade. Quem o
 * chama tem de estar dentro da decisão da porta — na prática, ou é o próprio
 * `tool-gateway.service.ts`, ou é um arquivo que injeta `ToolGateway` e passa o
 * efeito como callback (é o que o agent-runtime faz).
 *
 * A isenção NÃO é "o arquivo cita ToolGateway em algum lugar": citar é barato, e
 * um comentário bastaria para desarmar a frente. É a mesma técnica do registro —
 * extrair o nome da propriedade injetada e exigir a chamada de verdade.
 */
/*
 * VAZIA DESDE A FATIA 3.3, e é o objetivo desta frente atingido.
 *
 * A única exceção que existia era `src/gateway/acoes.service.ts`, o caminho de
 * execução PÓS-APROVAÇÃO. Ela nunca foi "apagar o arquivo": sem ele, aprovar
 * volta a não executar nada. O que mudou foi o DONO DO DISPARO — `AcoesService`
 * não conhece mais o `EfeitosRegistry`; ele continua conferindo o estado da
 * aprovação, queimando o uso único e escrevendo `acao.executada`/`acao.falhou`,
 * e pede à porta que dispare (`ToolGateway.executarAprovado`).
 *
 * O que a porta acrescentou nesse caminho não é cerimônia: ela RECLASSIFICA a
 * capacidade com a régua de HOJE antes de soltar uma ação proposta ONTEM
 * (sobrescrita por tenant pode ter subido a capacidade para R5, e R5 o OS nunca
 * executa), trata capacidade que saiu do catálogo como bloqueio, e revalida os
 * argumentos gravados contra o `argsSchema` atual.
 *
 * Quem dispara efeito hoje, e por que cada um é legítimo:
 *   · `src/gateway/tool-gateway.service.ts` — é a porta;
 *   · `src/gateway/porta-do-operador.service.ts` — injeta a porta e passa o
 *     efeito como callback de `gateway.executar()`;
 *   · `src/agents/agent-runtime.service.ts` — idem, pelo laço do agente.
 *
 * Se um dia esta lista voltar a ter linha, a pergunta a fazer é a mesma: quem
 * está disparando efeito sem a decisão de política em volta?
 */
const EXCECOES_EFEITO: Excecao[] = [];

describe('catraca de arquitetura: efeito só dispara pela porta', () => {
  const REGISTRO = 'src/gateway/efeitos.registry.ts';
  const PORTA = 'src/gateway/tool-gateway.service.ts';

  /** Nomes de propriedade injetada de um tipo: `private readonly efeitos: EfeitosRegistry`. */
  const propriedadesDoTipo = (fonte: Fonte, tipo: string): string[] =>
    [...fonte.semTexto.matchAll(new RegExp(`(\\w+)\\s*:\\s*${tipo}\\b`, 'g'))].map((m) => m[1]);

  /** O arquivo chama `this.<prop>.<metodo>(` para alguma propriedade daquele tipo? */
  const chama = (fonte: Fonte, tipo: string, metodo: string): number | null => {
    for (const nome of propriedadesDoTipo(fonte, tipo)) {
      const m = new RegExp(`this\\s*\\.\\s*${nome}\\s*\\.\\s*${metodo}\\s*\\(`).exec(fonte.semTexto);
      if (m) return linhaDe(fonte.semTexto, m.index);
    }
    return null;
  };

  const disparam = FONTES.filter((f) => f.arquivo !== REGISTRO).flatMap((fonte) => {
    const linha = chama(fonte, 'EfeitosRegistry', 'executar');
    return linha === null ? [] : [{ arquivo: fonte.arquivo, linha, conector: REGISTRO }];
  });

  it('o registro de efeitos existe onde a catraca procura', () => {
    expect(CAMINHOS).toContain(REGISTRO);
    expect(disparam.length).toBeGreaterThan(0);
  });

  it('quem dispara efeito passa pela porta', () => {
    const legitimo = (arquivo: string) => {
      if (arquivo === PORTA) return true;
      const fonte = FONTES.find((f) => f.arquivo === arquivo)!;
      // Injeta a porta E a chama: passar o efeito como callback de
      // `gateway.executar()` é o caminho legítimo. Citar "ToolGateway" não é.
      return chama(fonte, 'ToolGateway', 'executar') !== null;
    };

    const { novas } = conferir(disparam.filter((d) => !legitimo(d.arquivo)), EXCECOES_EFEITO);
    expect(
      novas.map((d) => `${d.arquivo} chama EfeitosRegistry.executar sem passar pelo ToolGateway`),
      'Efeito disparado fora da porta: a ação sai sem classificação de risco.',
    ).toEqual([]);
  });

  it('a lista de exceções de efeito não guarda dívida já paga', () => {
    const { podres } = conferir(disparam, EXCECOES_EFEITO);
    expect(podres, 'exceção de efeito sem violação correspondente: apague a linha').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Frente 4: usar a credencial (ou a URL-base) do conector fora dele
// ---------------------------------------------------------------------------

/*
 * O furo que as três primeiras frentes não veem.
 *
 * A URL-base do ClickUp, da Pluggy, do Asaas, da Evolution e do Graph da Meta
 * vem do AMBIENTE (`CLICKUP_BASE_URL`, `EVOLUTION_URL`…). Um arquivo novo que
 * faça
 *
 *     fetch(`${process.env.EVOLUTION_URL}/message/sendText/${inst}`,
 *           { headers: { apikey: process.env.EVOLUTION_API_KEY } })
 *
 * não importa conector (frente 1 cega), não tem URL de fornecedor literal
 * (frente 2 cega) e não registra efeito nenhum (frente 3 cega) — e mandaria
 * WhatsApp, que é R3, sem passar por lugar nenhum. A Evolution e o Obsidian,
 * aliás, não tinham padrão em frente alguma antes desta.
 *
 * Quem manda no segredo é o dono do segredo: a credencial e o endereço de um
 * fornecedor moram no serviço de conector daquele fornecedor, e mais em lugar
 * nenhum. A varredura roda sobre `semTexto`, então citar o nome da variável numa
 * mensagem de erro ("defina APIFY_TOKEN no .env") continua permitido — o que não
 * se pode é LER a variável.
 */
const CREDENCIAIS: Record<string, string> = {
  EVOLUTION_URL: 'src/pauta/evolution.service.ts',
  EVOLUTION_API_KEY: 'src/pauta/evolution.service.ts',
  EVOLUTION_INSTANCIA: 'src/pauta/evolution.service.ts',
  EVOLUTION_GRUPO_JID: 'src/pauta/evolution.service.ts',
  CLICKUP_API_TOKEN: 'src/integrations/clickup.service.ts',
  CLICKUP_BASE_URL: 'src/integrations/clickup.service.ts',
  APIFY_TOKEN: 'src/pauta/apify.service.ts',
  PLUGGY_CLIENT_ID: 'src/finance/pluggy.service.ts',
  PLUGGY_CLIENT_SECRET: 'src/finance/pluggy.service.ts',
  PLUGGY_BASE_URL: 'src/finance/pluggy.service.ts',
  ASAAS_API_KEY: 'src/finance/asaas.service.ts',
  ASAAS_BASE_URL: 'src/finance/asaas.service.ts',
  GOOGLE_CLIENT_ID: 'src/google/google.service.ts',
  GOOGLE_CLIENT_SECRET: 'src/google/google.service.ts',
  GOOGLE_REDIRECT_URI: 'src/google/google.service.ts',
  META_APP_ID: 'src/meta/meta.service.ts',
  META_APP_SECRET: 'src/meta/meta.service.ts',
  META_REDIRECT_URI: 'src/meta/meta.service.ts',
  META_GRAPH_URL: 'src/meta/meta.service.ts',
  OBSIDIAN_VAULT_PATH: 'src/obsidian/obsidian.service.ts',
};

/*
 * ============================================================================
 * A DECISÃO DA FATIA 3.3: ler credencial só para testar presença NÃO é legítimo
 * ============================================================================
 *
 * Seis das trinta e uma violações eram disso — a tela de Conexões e o espelho
 * lendo `CLICKUP_API_TOKEN`, `PLUGGY_*`, `ASAAS_API_KEY`, `OBSIDIAN_VAULT_PATH`
 * só para dizer "configurado"/"não configurado". A pergunta era se isso vira
 * regra (e sai da lista) ou se vira conserto. Virou conserto, por três motivos:
 *
 *  1. MENTE SEM ERRO DE COMPILAÇÃO. O nome da variável passa a ser um contrato
 *     duplicado entre a tela e o conector. Renomear do lado do conector — ou
 *     passar a ler do cofre por tenant, que é a fatia 5.3 — faz a tela afirmar
 *     "desconectado" sobre um conector que está funcionando. Nada quebra e nada
 *     avisa; só a tela passa a mentir, e é por ela que se decide se religa, se
 *     refaz OAuth ou se abre chamado.
 *  2. "PRESENÇA" NÃO É A MESMA PERGUNTA EM DOIS CONECTORES. A Pluggy precisa de
 *     duas variáveis; o Asaas tem uma, mas a lê com `.trim()`, então uma chave
 *     só com espaços está presente para quem testa `!!process.env.X` e ausente
 *     para o conector. O critério é de quem usa a credencial.
 *  3. A CATRACA NÃO CONSEGUE DISTINGUIR TESTAR DE USAR. Abrir exceção para "só
 *     testar presença" abriria também para `fetch(process.env.EVOLUTION_URL ?
 *     ... : ...)`, que é uso. A frente 4 existe justamente porque esse caminho é
 *     invisível às outras três.
 *
 * O CONSERTO, que era o que a própria lista apontava: cada conector responde se
 * está configurado, e a tela pergunta por um registro
 * (`src/gateway/conectores-configurados.registry.ts`) em vez de importar o
 * conector — importar seria a frente 1 da mesma catraca. `ClickupService`,
 * `PluggyService`, `AsaasService` e `EvolutionService` já se inscrevem no
 * arranque; as três linhas de integrations.service.ts que correspondiam a eles
 * saíram desta lista.
 *
 * O `GoogleService` NÃO se inscreve, e a ausência é decisão: as quatro chaves
 * dele são de autorização POR EMPRESA, e o estado verdadeiro delas é a linha de
 * `IntegrationAccount` que o retorno do OAuth cria — não a credencial do
 * processo. Inscrevê-las com `() => this.configured` fez a tela exibir o Google
 * como conectado para empresa que nunca autorizou nada, e foi desfeito. Ver o
 * cabeçalho de `src/gateway/conectores-configurados.registry.ts`.
 */
const EXCECOES_CREDENCIAL: Excecao[] = [
  {
    arquivo: 'src/auth/google-login.service.ts',
    conector: 'src/google/google.service.ts',
    motivo:
      'Lê GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI para fazer o login do ' +
      'operador — as MESMAS credenciais do GoogleService, duplicadas. A fatia 3.3 decidiu que ' +
      'autenticação do operador NÃO é conector (ver EXCECOES_HOST, mesma dupla arquivo/conector, ' +
      'com o argumento inteiro), então o arquivo continua onde está. A duplicata, porém, segue ' +
      'sendo dívida de verdade: trocar a credencial em um lugar e esquecer o outro quebra metade ' +
      'do produto sem erro de compilação. O conserto é as duas leituras virem do COFRE.',
    fatia: '5.3 (COFRE)',
  },
  {
    arquivo: 'src/pauta/espelho.service.ts',
    conector: 'src/obsidian/obsidian.service.ts',
    motivo:
      'Lê OBSIDIAN_VAULT_PATH e escreve .md no filesystem da vault por conta própria, em ' +
      'paralelo ao ObsidianService, que é quem conhece esse caminho. Escrita em vault é efeito: ' +
      'devia ser capacidade do conector, chamada pela porta. O lado Drive deste mesmo serviço FOI ' +
      'consertado nesta fatia (ver EXCECOES_HOST); o lado local não, porque o conserto mora em ' +
      'src/obsidian/, que é de outra fatia desta onda.',
    fatia: 'onda 8 — resto da 3.3: o conserto mora em src/obsidian/, que era de outra fatia da onda 7',
  },
  /*
   * SAIU DAQUI NA ESTABILIZAÇÃO DA ONDA 7: `src/integrations/integrations.service.ts`
   * lendo `OBSIDIAN_VAULT_PATH`. Era a última das quatro linhas de status
   * derivado de credencial, e dependia de uma linha em `src/obsidian/`, que era
   * de outra fatia da onda e não podia ser editado pela 3.3. A linha existe: o
   * `ObsidianService` se inscreve em `ConectoresConfiguradosRegistry` no
   * `onModuleInit`, antes do retorno antecipado, e `obsidian` entrou na lista
   * cobrada no arranque.
   */
];


describe('catraca de arquitetura: credencial de conector só dentro do conector', () => {
  const achados = FONTES.flatMap((fonte) => {
    const porConector = new Map<string, number>();
    for (const [variavel, conector] of Object.entries(CREDENCIAIS)) {
      if (fonte.arquivo === conector) continue; // o dono do segredo pode lê-lo
      const m = new RegExp(`\\b${variavel}\\b`).exec(fonte.semTexto);
      if (m && !porConector.has(conector)) porConector.set(conector, linhaDe(fonte.semTexto, m.index));
    }
    return [...porConector].map(([conector, linha]) => ({ arquivo: fonte.arquivo, linha, conector }));
  });

  it('o catálogo de credenciais aponta para conectores do catálogo', () => {
    const orfas = Object.entries(CREDENCIAIS)
      .filter(([, conector]) => CONECTORES[conector] === undefined)
      .map(([v]) => v);
    expect(orfas, `credencial apontando para arquivo que não é conector: ${orfas.join(', ')}`).toEqual([]);
  });

  it('a credencial de cada conector é lida dentro do próprio conector', () => {
    // Se ninguém lê a variável nem no conector, ou ela morreu ou mudou de nome —
    // e a catraca estaria vigiando um segredo que não existe mais.
    const mortas = Object.entries(CREDENCIAIS).filter(([variavel, conector]) => {
      const fonte = FONTES.find((f) => f.arquivo === conector);
      return !fonte || !new RegExp(`\\b${variavel}\\b`).test(fonte.semTexto);
    });
    expect(
      mortas.map(([v, c]) => `${v} não é lida em ${c}`),
      'Variável do catálogo que o próprio conector não usa mais: atualize CREDENCIAIS.',
    ).toEqual([]);
  });

  it('nenhum arquivo novo usa credencial ou URL-base de conector', () => {
    const { novas } = conferir(achados, EXCECOES_CREDENCIAL);
    expect(
      novas.map((a) => `${a.arquivo} lê credencial/URL de ${CONECTORES[a.conector]} (${a.conector})`),
      'Credencial ou URL-base de fornecedor lida fora do conector dele: dá para montar a ' +
        'chamada na mão sem import, sem URL literal e sem efeito registrado — invisível às ' +
        'outras três frentes. Peça ao serviço de conector, ou declare em EXCECOES_CREDENCIAL.',
    ).toEqual([]);
  });

  it('a lista de exceções de credencial não guarda dívida já paga', () => {
    const { podres } = conferir(achados, EXCECOES_CREDENCIAL);
    expect(podres, 'exceção de credencial sem violação correspondente: apague a linha').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Frente 5: o que está FORA de apps/api
// ---------------------------------------------------------------------------

/*
 * POR QUE ESTA FRENTE EXISTE — a lição do `apps/telegram`, aposentado na 5.8.
 *
 * As quatro frentes acima varrem `apps/api/{src,prisma}` e param ali. O
 * monorepo, porém, tem outros lugares onde se pode escrever código que roda: um
 * app novo em `apps/`, um pacote novo em `packages/`. Foi exatamente ali que o
 * bot de Telegram viveu — ele chamava o modelo com prompt de sistema próprio,
 * subia o servidor MCP como processo filho e escrevia na API com a senha da
 * conta de máquina `ia-acao@`, e nenhuma das quatro frentes tinha como vê-lo,
 * porque nenhuma delas saía de `apps/api`.
 *
 * A frente 5 não repete o trabalho das outras quatro: ela vigia as TRÊS coisas
 * que transformam um processo qualquer em um caminho paralelo ao produto.
 *
 *   (a) FALAR COM O MODELO. O modelo mora atrás do `LlmProvider`
 *       (`apps/api/src/llm/`), e é lá que estão o teto de custo por empresa e
 *       por dia (RF-G-05), a medição, a marca de procedência e a régua que
 *       decide o que a resposta pode acionar. Um segundo cliente de modelo é um
 *       segundo produto, com política própria e sem RASTRO.
 *   (b) SER CLIENTE DE MCP. `packages/mcp` é um SERVIDOR — ele importa
 *       `@modelcontextprotocol/sdk/server/*`. Quem importa o lado `client/` está
 *       montando um agente fora do runtime de agentes: escolhe as ferramentas,
 *       escreve o prompt e decide sozinho o que chamar.
 *   (c) CARREGAR CREDENCIAL DE CONTA DE MÁQUINA. Quem tem a senha de `mcp@` ou
 *       de `ia-acao@` fala com a API como programa. `MCP_SERVICE_*` tem UMA casa
 *       (o cliente HTTP do servidor MCP). `MCP_ACTION_*` não tem nenhuma: a
 *       conta de ação era do bot, e a fatia 3.10 já havia tirado dela o direito
 *       de assinar a própria proposta (`ia_acao` não tem `aprovacoes.decidir`, e
 *       `ApprovalsService.confirm` recusa conta de máquina e recusa o
 *       proponente). Um leitor novo dessas duas variáveis é um caminho de
 *       escrita novo nascendo.
 *
 * ONDE ELA ANDA: a partir da RAIZ do monorepo, e não de uma lista de pastas.
 * Varredura presa a `apps/` e `packages/` reproduz em miniatura o ponto cego que
 * esta frente existe para fechar — bastaria pôr o arquivo em `deploy/`, em
 * `tools/` ou na raiz para sumir dela. O teste do manifesto, mais abaixo neste
 * mesmo arquivo, sempre andou a partir da raiz: a incoerência era interna.
 *
 * O QUE ELA ACEITA COMO CÓDIGO: `.ts`, `.tsx`, `.js`, `.jsx` e as formas `.mjs`,
 * `.cjs`, `.mts`, `.cts`. Aceitar só `.ts`/`.tsx` deixava de fora cinco arquivos
 * que rodam de verdade — o arranque compilado da API, duas configurações do
 * Next, o mapa de rotas antigas e o `pixel.js` servido ao navegador — e fazia de
 * "salvo como `.mjs`" uma burla de um caractere.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA FRENTE NÃO PEGA. Três limites, escritos porque catraca que promete
 * mais do que entrega é pior do que catraca nenhuma: a primeira dá confiança
 * falsa, a segunda ao menos não engana.
 *
 *   1. PASTA DE TESTE — deliberado, e com preço medido. `test/`, `tests/` e
 *      `__tests__/` ficam fora: teste não é produção, e uma varredura que se
 *      lesse a si mesma acusaria os próprios exemplos (este arquivo cita
 *      `OPENAI_API_KEY` e `MCP_ACTION_PASSWORD` dezenas de vezes, e `leVariavel`
 *      casaria com cada uma). São 57 arquivos hoje nesse ponto cego — quem
 *      quiser esconder um cliente de modelo tem diretórios de nome reservado
 *      para isso. Não há saída dentro deste desenho: ou a catraca ignora teste,
 *      ou ela se acusa. As outras pastas ignoradas — `node_modules/`, `dist/`,
 *      `.next/`, `.turbo/`, `coverage/`, `.git/` — guardam cópia gerada ou
 *      instalada do que já foi varrido no original; ignorá-las não esconde
 *      código-fonte novo.
 *
 *   2. NOME MONTADO EM PEDAÇOS. Esta frente reconhece por NOME: nome de variável
 *      de ambiente, endereço literal do fornecedor, especificador de import.
 *      Quem guarda o nome da credencial numa constante, monta a URL por
 *      concatenação e importa o SDK com especificador concatenado atravessa as
 *      três alíneas sem acender nada — e isso cabe em doze linhas. É o bot do
 *      Telegram reescrito de outro jeito.
 *
 *   3. PROVEDOR DE MODELO FORA DO CATÁLOGO. `CREDENCIAIS_DO_MODELO` e
 *      `HOSTS_DO_MODELO` são listas escritas à mão. Gemini, Mistral, Bedrock ou
 *      um gateway interno são invisíveis enquanto ninguém acrescentar as linhas.
 *
 * Os limites 2 e 3 são INERENTES a reconhecer por nome, e nenhum ajuste deste
 * arquivo os fecha — o que os pegaria é análise de fluxo, não de texto. O que
 * esta catraca entrega, e é o que ela deve prometer: encarece o desvio
 * ACIDENTAL (o app novo que chama a OpenAI "só pra testar", o `.mjs` de
 * configuração que vira cliente de modelo) e obriga o desvio deliberado a se
 * declarar — quem monta o nome em pedaços para fugir daqui deixa escrita, no
 * próprio código, a prova de que conhecia a regra.
 * ---------------------------------------------------------------------------
 *
 * SOBRE `.tsx` E `.jsx`: entram na varredura, senão quase todo o `apps/web`
 * ficaria invisível — e app de front é justamente onde alguém tentaria "só
 * chamar a OpenAI daqui". O separador de código/texto não entende JSX: em
 * `<div/>` ele pode tomar a barra por início de expressão regular e seguir sem
 * apagar o que vier até a próxima barra. O efeito disso é deixar texto de string
 * INTACTO na visão `semTexto`, o que só gera alarme FALSO — nunca esconde
 * violação. Erro nessa direção é o aceitável numa catraca.
 */

/** A raiz do monorepo é a pasta que tem o `pnpm-workspace.yaml`. */
function acharRaizDoMonorepo(): string {
  let dir = RAIZ;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(
    `Não encontrei o pnpm-workspace.yaml subindo de "${RAIZ}". ` +
      'A frente 5 não pode rodar sem saber onde o monorepo começa.',
  );
}

const RAIZ_MONO = acharRaizDoMonorepo();

/*
 * Cópia gerada/instalada do que já foi varrido (as seis primeiras) e teste, que
 * não é produção. `migrations/` NÃO está aqui de propósito: ela guarda `.sql`, e
 * ignorar por nome uma pasta que não esconde código só cria esconderijo.
 * O preço da exclusão de teste está medido no comentário da frente: 57 arquivos.
 */
const PASTAS_IGNORADAS_MONO = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '.git',
  'coverage',
  'test',
  'tests',
  '__tests__',
]);

/**
 * Extensões que a catraca trata como código que roda. Aceitar só `.ts`/`.tsx`
 * fazia de "salvo como `.mjs`" uma burla de um caractere.
 */
const EXTENSOES_DE_CODIGO = /\.(?:[cm]?tsx?|[cm]?jsx?)$/;

/** Declaração de tipo não é código que roda — e `.d.mts`/`.d.cts` existem. */
const SO_DECLARACAO = /\.d\.[cm]?ts$/;

/** Pastas de primeiro nível em que a varredura realmente entrou. Confere o CAMINHO, não o achado. */
const PASTAS_VARRIDAS = new Set<string>();

/** Todo arquivo de código do monorepo, a partir da RAIZ, em caminho relativo a ela. */
function listarFontesDoMonorepo(): string[] {
  const saida: string[] = [];

  const andar = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const completo = path.join(dir, entrada);
      if (statSync(completo).isDirectory()) {
        if (PASTAS_IGNORADAS_MONO.has(entrada)) continue;
        if (dir === RAIZ_MONO) PASTAS_VARRIDAS.add(entrada);
        andar(completo);
        continue;
      }
      if (EXTENSOES_DE_CODIGO.test(entrada) && !SO_DECLARACAO.test(entrada)) {
        saida.push(path.relative(RAIZ_MONO, completo).split(path.sep).join('/'));
      }
    }
  };

  andar(RAIZ_MONO);
  return saida.sort();
}

const FONTES_MONO: Fonte[] = listarFontesDoMonorepo().map((arquivo) => ({
  arquivo,
  ...limpar(readFileSync(path.join(RAIZ_MONO, arquivo), 'utf8')),
}));

const CAMINHOS_MONO = FONTES_MONO.map((f) => f.arquivo);

/*
 * DUAS MANEIRAS DE LER UMA VARIÁVEL DE AMBIENTE, e a catraca precisa das duas.
 *
 *   · `process.env.OPENAI_API_KEY` — identificador. Aparece em `semTexto`.
 *   · `envOpcional('ANTHROPIC_API_KEY')` — o nome vai como STRING, e é assim que
 *     os provedores de `src/llm/` leem. Em `semTexto` some; em `codigo` fica.
 *
 * Olhar só `semTexto` deixaria passar a segunda forma. Olhar `codigo` inteiro
 * acusaria qualquer frase que CITE o nome ("defina OPENAI_API_KEY no .env"), que
 * é justamente o que a frente 4 decidiu não contar como uso. A saída é exigir,
 * na visão `codigo`, que o nome seja a string INTEIRA e que ela esteja como
 * argumento ou índice: `('X')`, `('X',` ou `['X']`. Frase que menciona o nome
 * no meio de um texto maior não casa.
 */
function leVariavel(fonte: Fonte, variavel: string): number | null {
  const comoIdentificador = new RegExp(`\\b${variavel}\\b`).exec(fonte.semTexto);
  if (comoIdentificador) return linhaDe(fonte.semTexto, comoIdentificador.index);

  const comoArgumento = new RegExp(`[(\\[]\\s*['"]${variavel}['"]\\s*[),\\]]`).exec(fonte.codigo);
  return comoArgumento ? linhaDe(fonte.codigo, comoArgumento.index) : null;
}

// --- (a) o modelo ----------------------------------------------------------

/** A única casa do cliente de modelo. Prefixo, não arquivo: são três provedores. */
const CASA_DO_MODELO = 'apps/api/src/llm/';

/** Credenciais e URLs-base de provedor de modelo. */
const CREDENCIAIS_DO_MODELO = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
];

/** Endereços de provedor de modelo. */
const HOSTS_DO_MODELO = [
  /https?:\/\/api\.openai\.com/,
  /https?:\/\/api\.anthropic\.com/,
  /https?:\/\/(?:[\w-]+\.)*openrouter\.ai/,
];

/*
 * A DÍVIDA DE MODELO QUE JÁ EXISTE — toda ela dentro de `apps/api`, e nenhuma
 * fora. A fatia 5.8 não a paga: ela a torna visível e contada, que é o que a
 * catraca sabe fazer. As três linhas têm o mesmo conserto de fundo — o cliente
 * de modelo é UM e mora em `src/llm/` — e o mesmo impedimento: `LlmProvider` só
 * sabe conversar (`step()`), não sabe gerar embedding, e a fatia que cria essa
 * segunda porta ainda não existe no plano. Ver o relatório da 5.8.
 */
const EXCECOES_MODELO: Excecao[] = [
  {
    arquivo: 'apps/api/src/obsidian/obsidian.service.ts',
    conector: CASA_DO_MODELO,
    motivo:
      'Lê OPENAI_API_KEY/OPENAI_BASE_URL e chama api.openai.com direto para gerar EMBEDDING do ' +
      'vault. Não é conversa com o modelo — é o endpoint de embeddings, que o LlmProvider não ' +
      'expõe (e que a Anthropic não tem, por isso o OpenAI continua obrigatório). Enquanto essa ' +
      'chamada ficar aqui, ela não entra no teto de custo de IA por empresa e por dia: o gasto ' +
      'de reindexar um vault grande é invisível para quem lê o painel de custo. O conserto é um ' +
      'provedor de embeddings em src/llm/, com a mesma medição do step().',
    fatia: 'onda 11 — pede um provedor de embeddings em src/llm/ (item novo no plano; ver o relatório da 5.8)',
  },
  {
    arquivo: 'apps/api/src/pauta/pauta.service.ts',
    conector: CASA_DO_MODELO,
    motivo:
      'Mesma chamada de embeddings da linha acima, para a busca semântica do acervo de ' +
      'referências. Mesmo conserto, mesmo impedimento.',
    fatia: 'onda 11 — pede um provedor de embeddings em src/llm/ (item novo no plano; ver o relatório da 5.8)',
  },
  {
    arquivo: 'apps/api/src/integrations/integrations.service.ts',
    conector: CASA_DO_MODELO,
    motivo:
      'Lê OPENAI_API_KEY só para a tela de Conexões dizer "configurado". É o mesmo defeito que a ' +
      'fatia 3.3 consertou para ClickUp, Pluggy, Asaas, Evolution e Obsidian, e pela mesma razão: ' +
      'o nome da variável vira contrato duplicado entre a tela e quem usa a credencial, e ' +
      'renomear de um lado faz a tela mentir sem erro de compilação. O conserto é o mesmo: quem ' +
      'usa o modelo se inscreve em ConectoresConfiguradosRegistry e a tela pergunta ao registro. ' +
      'Não foi feito aqui porque o registro é alimentado por serviço de conector, e o provedor de ' +
      'modelo ainda não é tratado como conector em lugar nenhum.',
    fatia: 'onda 11 — junto com o provedor de embeddings; ver o relatório da 5.8',
  },
];

describe('catraca de arquitetura: o modelo tem uma casa só', () => {
  const achados = FONTES_MONO.filter((f) => !f.arquivo.startsWith(CASA_DO_MODELO)).flatMap((fonte) => {
    for (const variavel of CREDENCIAIS_DO_MODELO) {
      const linha = leVariavel(fonte, variavel);
      if (linha !== null) return [{ arquivo: fonte.arquivo, linha, conector: CASA_DO_MODELO }];
    }
    for (const padrao of HOSTS_DO_MODELO) {
      const m = padrao.exec(fonte.codigo);
      if (m) return [{ arquivo: fonte.arquivo, linha: linhaDe(fonte.codigo, m.index), conector: CASA_DO_MODELO }];
    }
    return [];
  });

  it('a varredura do monorepo acha código fora de apps/api', () => {
    // Uma varredura que não sai de apps/api reproduziria o ponto cego que esta
    // frente existe para fechar — e passaria em silêncio.
    expect(CAMINHOS_MONO.length).toBeGreaterThan(150);
    expect(CAMINHOS_MONO).toContain('packages/mcp/src/client.ts');
    expect(CAMINHOS_MONO).toContain('packages/shared/src/nav.ts');
    expect(CAMINHOS_MONO).toContain('apps/api/src/gateway/tool-gateway.service.ts');
    expect(
      CAMINHOS_MONO.some((c) => c.startsWith('apps/web/src/') && c.endsWith('.tsx')),
      'nenhum .tsx de apps/web na varredura: o front inteiro estaria invisível',
    ).toBe(true);
  });

  it('a varredura anda a partir da raiz, não de uma lista de pastas', () => {
    /*
     * Confere o CAMINHO PERCORRIDO, e não o achado — porque hoje não existe
     * arquivo de código fora de `apps/` e `packages/`, e uma asserção sobre
     * achados passaria igual com a varredura presa àquelas duas pastas. O que
     * este teste barra é a volta da lista fixa: qualquer pasta de primeiro nível
     * não ignorada (`deploy/`, `tools/`, `docs/`, `.github/`) é território da
     * frente 5, e o dia em que alguém puser um `.mjs` ali ela já está olhando.
     */
    const deFora = readdirSync(RAIZ_MONO).filter(
      (e) => !PASTAS_IGNORADAS_MONO.has(e) && statSync(path.join(RAIZ_MONO, e)).isDirectory(),
    );
    expect(deFora.length, 'nenhuma pasta de primeiro nível: a varredura não rodou').toBeGreaterThan(2);
    expect(
      deFora.filter((p) => !PASTAS_VARRIDAS.has(p)),
      'pasta de primeiro nível fora da varredura da frente 5: ela voltou a andar por lista fixa',
    ).toEqual([]);
  });

  it('a varredura aceita as outras extensões de código, não só .ts e .tsx', () => {
    /*
     * `.mjs`/`.cjs`/`.js` rodam igual — e trocar a extensão era uma burla de um
     * caractere. Os dois exemplos abaixo são âncoras: se saírem do repositório,
     * troque-os por outros em vez de apagar a asserção.
     */
    expect(CAMINHOS_MONO).toContain('apps/api/scripts/smoke-boot.mjs');
    expect(CAMINHOS_MONO).toContain('apps/web/public/pixel.js');
    expect(
      CAMINHOS_MONO.filter((c) => !/\.tsx?$/.test(c)).length,
      'só .ts/.tsx na varredura: as extensões voltaram a ficar de fora',
    ).toBeGreaterThan(0);
  });

  it('a casa do modelo existe e é quem lê as credenciais dele', () => {
    const daCasa = FONTES_MONO.filter((f) => f.arquivo.startsWith(CASA_DO_MODELO));
    expect(daCasa.length, `nada em ${CASA_DO_MODELO}: o cliente de modelo mudou de lugar`).toBeGreaterThan(0);

    // Variável do catálogo que ninguém lê nem na própria casa ou morreu ou
    // mudou de nome — e a catraca estaria vigiando um segredo que não existe.
    const mortas = CREDENCIAIS_DO_MODELO.filter(
      (v) => !daCasa.some((f) => leVariavel(f, v) !== null),
    );
    expect(
      mortas,
      `credencial de modelo que ${CASA_DO_MODELO} não usa mais: atualize CREDENCIAIS_DO_MODELO.`,
    ).toEqual([]);
  });

  it('ninguém fora de src/llm/ fala com um provedor de modelo', () => {
    // `conferir` devolve só arquivo e conector; a linha vem de `achados`, para a
    // mensagem apontar o lugar exato em vez de mandar procurar no arquivo.
    const linhaDoAchado = new Map(achados.map((a) => [a.arquivo, a.linha]));
    const { novas } = conferir(achados, EXCECOES_MODELO);
    expect(
      novas.map(
        (a) =>
          `${a.arquivo}:${linhaDoAchado.get(a.arquivo)} fala com provedor de modelo fora de ${CASA_DO_MODELO}`,
      ),
      'Cliente de modelo fora de src/llm/: a chamada sai sem teto de custo por empresa, sem ' +
        'medição, sem marca de procedência e sem RASTRO — e com prompt de sistema próprio, que ' +
        'é um segundo produto. Peça ao LlmProvider, ou declare em EXCECOES_MODELO com a fatia ' +
        'que remove.',
    ).toEqual([]);
  });

  it('a lista de exceções de modelo não guarda dívida já paga', () => {
    const { podres } = conferir(achados, EXCECOES_MODELO);
    expect(podres, 'exceção de modelo sem violação correspondente: apague a linha').toEqual([]);
  });
});

// --- (b) o MCP -------------------------------------------------------------

describe('catraca de arquitetura: ninguém é cliente de MCP', () => {
  const SDK = '@modelcontextprotocol/sdk';
  const CASA_DO_MCP = 'packages/mcp';

  /*
   * O LADO CLIENTE TEM UMA CASA, E ELA É O PRÓPRIO PACOTE DO MCP.
   *
   * `packages/mcp/scripts/smoke.ts` sobe o servidor por stdio e se conecta a ele
   * como cliente para listar e chamar as ferramentas — é o servidor testando a
   * si mesmo, ponta a ponta, e não um agente paralelo. Quem escreve o protocolo
   * precisa poder falar dos dois lados dele. Fora daquele pacote, importar o
   * lado cliente é montar um laço de ferramenta próprio.
   */
  const clientes = FONTES_MONO.filter(
    (f) => f.codigo.includes(`${SDK}/client`) && !f.arquivo.startsWith(`${CASA_DO_MCP}/`),
  ).map((f) => ({
    arquivo: f.arquivo,
    linha: linhaDe(f.codigo, f.codigo.indexOf(`${SDK}/client`)),
  }));

  it('o servidor MCP continua onde a catraca procura', () => {
    // Sem este par, a frente passaria tanto se ninguém for cliente quanto se o
    // pacote inteiro tiver sumido — e as duas coisas não são a mesma.
    const servidores = FONTES_MONO.filter((f) => f.codigo.includes(`${SDK}/server`));
    expect(
      servidores.map((f) => f.arquivo),
      'ninguém importa o lado servidor do SDK: packages/mcp mudou de lugar ou de forma',
    ).not.toEqual([]);
    expect(servidores.every((f) => f.arquivo.startsWith(`${CASA_DO_MCP}/`))).toBe(true);
  });

  it('ninguém importa o lado cliente do SDK do MCP', () => {
    expect(
      clientes.map((c) => `${c.arquivo}:${c.linha} importa ${SDK}/client`),
      'Cliente de MCP fora do produto: quem monta a lista de ferramentas, escreve o prompt e ' +
        'decide o que chamar está construindo um agente paralelo ao runtime de agentes — sem ' +
        'capacidades declaradas, sem a régua R0–R5 e sem RASTRO. Foi o que `apps/telegram` fazia ' +
        'até a fatia 5.8. O runtime de agentes é o único laço de ferramenta do produto.',
    ).toEqual([]);
  });

  it('só packages/mcp declara o SDK do MCP como dependência', () => {
    /*
     * Varre os `package.json` além do código: um app novo que adiciona o SDK é
     * pego antes de escrever a primeira linha que o usa — e dependência nova é
     * decisão humana, então a linha do manifesto é o lugar certo de barrar.
     */
    const manifestos: string[] = [];
    const andar = (dir: string) => {
      for (const entrada of readdirSync(dir)) {
        const completo = path.join(dir, entrada);
        if (statSync(completo).isDirectory()) {
          if (!PASTAS_IGNORADAS_MONO.has(entrada)) andar(completo);
          continue;
        }
        if (entrada === 'package.json') {
          manifestos.push(path.relative(RAIZ_MONO, completo).split(path.sep).join('/'));
        }
      }
    };
    andar(RAIZ_MONO);

    expect(manifestos.length, 'nenhum package.json encontrado: a varredura não rodou').toBeGreaterThan(3);

    const declaram = manifestos.filter((m) => {
      if (m === `${CASA_DO_MCP}/package.json`) return false;
      const json = JSON.parse(readFileSync(path.join(RAIZ_MONO, m), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return SDK in { ...json.dependencies, ...json.devDependencies };
    });
    expect(
      declaram.map((m) => `${m} declara ${SDK}`),
      `O SDK do MCP é dependência de ${CASA_DO_MCP} e de mais ninguém.`,
    ).toEqual([]);
  });
});

// --- (c) as contas de máquina ----------------------------------------------

/*
 * `MCP_API_URL` entra junto das senhas de propósito: é o endereço que o programa
 * usa para falar com a API COMO PROGRAMA. Quem o lê está montando um cliente
 * HTTP do produto fora do produto — que foi exatamente o `write-client.ts` do
 * bot, com a conta `ia-acao@` e o `x-approval-token` na mão.
 */
const CONTA_DE_SERVICO = ['MCP_SERVICE_EMAIL', 'MCP_SERVICE_PASSWORD', 'MCP_API_URL'];

/*
 * DUAS CASAS, E SÃO PAPÉIS DIFERENTES:
 *
 *   · `packages/mcp/src/client.ts` — quem USA a credencial para entrar na API;
 *   · `apps/api/prisma/seed.ts` — quem CRIA a conta, e para isso precisa da
 *     senha em claro uma vez, para guardar o hash. É a certidão de nascimento da
 *     conta, não um cliente dela. Deixar a semente de fora da regra obrigaria a
 *     declará-la como dívida, e dívida que não tem conserto apodrece a lista.
 */
const CASAS_DA_CONTA_DE_SERVICO = ['packages/mcp/src/client.ts', 'apps/api/prisma/seed.ts'];

/**
 * A conta de AÇÃO não tem usuário: ela era do bot de Telegram e de mais ninguém.
 * As variáveis existem aqui como lápide.
 */
const CONTA_DE_ACAO = ['MCP_ACTION_EMAIL', 'MCP_ACTION_PASSWORD'];

/*
 * A ÚNICA LINHA QUE AINDA CONHECE A CONTA DE AÇÃO, e é dívida de verdade.
 *
 * O bot morreu; a semente continua criando `ia-acao@` e continua exigindo a
 * senha dela. Sobra uma conta de máquina com permissão de escrita (`leads.editar`,
 * `campanhas.editar`, `tarefas.editar`, `gmail.responder`, `agenda.editar`,
 * `drive.editar`) que ninguém usa — credencial viva sem dono é superfície de
 * ataque, não resíduo cosmético.
 *
 * Não saiu na 5.8 porque `apps/api/prisma/seed.ts` e
 * `packages/shared/src/permissions.ts` não eram daquela fatia, e porque APAGAR A
 * CONTA É DECISÃO, não limpeza: se algum dia o produto voltar a ter um executor
 * de máquina para ação aprovada, é este perfil que ele herda. O caminho curto,
 * enquanto a decisão não vem, é a semente parar de exigir `MCP_ACTION_PASSWORD`
 * (criar a conta sem senha utilizável) — aí esta linha sai daqui sozinha.
 */
const EXCECOES_CONTA_DE_ACAO: Excecao[] = [
  {
    arquivo: 'apps/api/prisma/seed.ts',
    conector: 'conta de máquina ia-acao@',
    motivo:
      'A semente cria a conta de AÇÃO da IA e lê MCP_ACTION_PASSWORD para guardar o hash. O ' +
      'único cliente dela era o bot de Telegram, aposentado na fatia 5.8 — e o laço dele já ' +
      'estava morto antes disso, porque `ia_acao` não tem `aprovacoes.decidir` e ' +
      'ApprovalsService.confirm recusa conta de máquina e recusa o proponente (fatia 3.10). ' +
      'Sobra uma conta com seis permissões de escrita e nenhum usuário. Some quando alguém ' +
      'decidir entre apagar a conta e guardá-la para um executor futuro.',
    fatia: 'onda 11 — decisão humana sobre apagar a conta ia-acao@; ver o relatório da 5.8',
  },
];

describe('catraca de arquitetura: credencial de conta de máquina tem dono', () => {
  it('a conta de serviço do MCP é lida nas casas dela', () => {
    const casas = CASAS_DA_CONTA_DE_SERVICO.map((c) => {
      const fonte = FONTES_MONO.find((f) => f.arquivo === c);
      expect(fonte, `${c} sumiu: a catraca perdeu a referência`).toBeDefined();
      return fonte!;
    });
    const mortas = CONTA_DE_SERVICO.filter((v) => !casas.some((f) => leVariavel(f, v) !== null));
    expect(
      mortas,
      'variável de conta de serviço que nenhuma das casas lê mais: atualize CONTA_DE_SERVICO.',
    ).toEqual([]);
  });

  it('só quem usa e quem cria a conta de serviço carregam a credencial dela', () => {
    const fora = FONTES_MONO.filter((f) => !CASAS_DA_CONTA_DE_SERVICO.includes(f.arquivo)).flatMap((f) => {
      for (const v of CONTA_DE_SERVICO) {
        const linha = leVariavel(f, v);
        if (linha !== null) return [`${f.arquivo}:${linha} lê ${v}`];
      }
      return [];
    });
    expect(
      fora,
      'Credencial de conta de máquina fora das casas dela: quem a tem fala com a API como ' +
        `programa, sem gente no meio. As casas são ${CASAS_DA_CONTA_DE_SERVICO.join(' e ')}.`,
    ).toEqual([]);
  });

  it('a conta de ação só é conhecida por quem a cria', () => {
    const { novas } = conferir(leitoresDaContaDeAcao(), EXCECOES_CONTA_DE_ACAO);
    expect(
      novas.map((l) => `${l.arquivo} lê a credencial da conta ia-acao@`),
      'A conta `ia-acao@` era do bot de Telegram, aposentado na fatia 5.8, e não tem sucessor. ' +
        'Ela propunha a aprovação e confirmava a própria proposta — que a fatia 3.10 já proibia ' +
        'em dois lugares (`ia_acao` não tem `aprovacoes.decidir`, e ApprovalsService.confirm ' +
        'recusa conta de máquina e recusa o proponente). Um leitor novo destas variáveis é um ' +
        'caminho de escrita novo nascendo fora da porta: quem precisa executar o que foi ' +
        'aprovado usa POST /approvals/:id/confirm com identidade de gente.',
    ).toEqual([]);
  });

  it('a exceção da conta de ação não guarda dívida já paga', () => {
    const { podres } = conferir(leitoresDaContaDeAcao(), EXCECOES_CONTA_DE_ACAO);
    expect(
      podres,
      'A semente parou de conhecer a conta ia-acao@: apague a linha de EXCECOES_CONTA_DE_ACAO ' +
        'para a catraca não afrouxar sozinha.',
    ).toEqual([]);
  });
});

/** Quem lê a credencial da conta de ação hoje. Usado nos dois sentidos da conferência. */
function leitoresDaContaDeAcao(): Array<{ arquivo: string; conector: string }> {
  return FONTES_MONO.flatMap((f) => {
    for (const v of CONTA_DE_ACAO) {
      if (leVariavel(f, v) !== null) {
        return [{ arquivo: f.arquivo, conector: 'conta de máquina ia-acao@' }];
      }
    }
    return [];
  });
}

// --- (d) o canal de aprovação -----------------------------------------------

/*
 * ============================================================================
 * A PROMESSA QUE ERA SÓ COMENTÁRIO — fatia 5.5, corrigida
 * ============================================================================
 *
 * `src/gateway/canais/transporte.registry.ts` promete, por escrito, que o
 * registro de transporte "não é um segundo caminho até o conector para uso
 * geral". A promessa era verdadeira sobre o que o código FAZIA hoje e mentirosa
 * sobre o que ele PERMITIA:
 *
 *   · `TransporteDeCanalRegistry` é provider de um módulo `@Global` e é
 *     exportado (tem de ser: quem se inscreve mora fora, em
 *     `pauta/evolution.service.ts`);
 *   · `entregar(canal, destino, texto)` é público e aceita destino e texto
 *     arbitrários;
 *   · `EnvioDeAprovacaoService.responder(destino, texto)` idem.
 *
 * Ou seja: qualquer serviço novo do processo injetava um dos dois e mandava
 * texto arbitrário para número arbitrário pela instância da ROOT — sem passar
 * pela porta, sem classificação de risco, sem aprovação. E NENHUMA das quatro
 * catracas anteriores via isso: não importa conector (frente 1 cega), não tem
 * endereço de fornecedor (frente 2), não registra efeito (frente 3) e não lê
 * credencial nenhuma (frente 4) — o conector é alcançado por uma indireção que
 * as quatro foram desenhadas para não enxergar.
 *
 * Esta frente fecha isso: SÓ A PASTA DO CANAL entrega mensagem por ali.
 * Inscrever-se continua livre (`registrar`), porque inscrever é a direção que o
 * desenho quer — é o conector oferecendo o transporte, não alguém consumindo-o.
 */
const CASA_DO_CANAL = 'src/gateway/canais/';

/**
 * Nomes de propriedade injetada de um tipo: `private readonly x: Tipo`.
 *
 * O `\??` NÃO é enfeite: quem injeta um registro `@Global` quase sempre o injeta
 * com `@Optional()`, e aí a propriedade se escreve `canais?: Tipo`. Sem o `??` a
 * varredura não encontrava NENHUMA das duas que interessam aqui — a catraca
 * passaria verde por cegueira, que é o pior jeito de uma catraca passar. O caso
 * "o varredor enxerga a chamada de dentro do canal" existe para provar que não é
 * isso que está acontecendo.
 */
const propriedadesDoTipoNoCanal = (fonte: Fonte, tipo: string): string[] =>
  [...fonte.semTexto.matchAll(new RegExp(`(\\w+)\\s*\\??\\s*:\\s*${tipo}\\b`, 'g'))].map(
    (m) => m[1],
  );

/** O arquivo chama `this.<prop>.<metodo>(` para alguma propriedade daquele tipo? */
const chamaNoCanal = (fonte: Fonte, tipo: string, metodo: string): number | null => {
  for (const nome of propriedadesDoTipoNoCanal(fonte, tipo)) {
    const m = new RegExp(`this\\s*\\.\\s*${nome}\\s*\\??\\s*\\.\\s*${metodo}\\s*\\(`).exec(
      fonte.semTexto,
    );
    if (m) return linhaDe(fonte.semTexto, m.index);
  }
  return null;
};

/** Quem, fora da pasta do canal, ENTREGA mensagem pelo transporte do canal. */
function entregadoresForaDoCanal(): Array<{ arquivo: string; conector: string; linha: number }> {
  const alvos: Array<[string, string, string]> = [
    ['TransporteDeCanalRegistry', 'entregar', 'transporte do canal'],
    ['EnvioDeAprovacaoService', 'responder', 'resposta do canal'],
  ];
  return FONTES.filter((f) => !f.arquivo.startsWith(CASA_DO_CANAL)).flatMap((fonte) => {
    for (const [tipo, metodo, rotulo] of alvos) {
      const linha = chamaNoCanal(fonte, tipo, metodo);
      if (linha !== null) return [{ arquivo: fonte.arquivo, conector: rotulo, linha }];
    }
    return [];
  });
}

/*
 * VAZIA, e é o objetivo desta frente atingido. Uma linha aqui é um serviço que
 * ganhou o direito de mandar WhatsApp pela instância da ROOT sem passar pela
 * porta — e a pergunta a fazer é sempre a mesma: por que isto não é
 * `whatsapp.mensagem.enviar`, que é R3 e pede assinatura de gente?
 */
const EXCECOES_CANAL: Excecao[] = [];

describe('catraca de arquitetura: mensagem de serviço do canal só sai do canal', () => {
  it('a pasta do canal existe onde a catraca procura', () => {
    expect(CAMINHOS).toContain(`${CASA_DO_CANAL}transporte.registry.ts`);
    expect(CAMINHOS).toContain(`${CASA_DO_CANAL}envio-de-aprovacao.service.ts`);
  });

  it('o varredor enxerga a chamada de dentro do canal — senão a catraca é cega', () => {
    // Prova viva: quem DEVE chamar `entregar` chama, e o detector acha.
    const envio = FONTES.find((f) => f.arquivo === `${CASA_DO_CANAL}envio-de-aprovacao.service.ts`)!;
    expect(chamaNoCanal(envio, 'TransporteDeCanalRegistry', 'entregar')).not.toBeNull();
  });

  it('ninguém fora da pasta do canal entrega mensagem pelo transporte dele', () => {
    const { novas } = conferir(entregadoresForaDoCanal(), EXCECOES_CANAL);
    expect(
      novas.map((v) => `${v.arquivo} usa ${v.conector} fora de ${CASA_DO_CANAL}`),
      'Segundo caminho até o conector nascendo: com o registro de transporte injetado, um ' +
        'serviço manda texto arbitrário para número arbitrário pela instância da ROOT, fora da ' +
        'porta e sem classificação. Publicar é `whatsapp.mensagem.enviar` (R3, com aprovação de ' +
        'gente); o que passa pelo canal é mensagem de SERVIÇO do próprio canal.',
    ).toEqual([]);
  });

  it('a lista de exceções do canal não guarda dívida já paga', () => {
    const { podres } = conferir(entregadoresForaDoCanal(), EXCECOES_CANAL);
    expect(podres, 'exceção de canal sem violação correspondente: apague a linha').toEqual([]);
  });

  /*
   * INSCREVER-SE continua livre, e o teste diz isso em voz alta para que ninguém
   * "conserte" a catraca apertando o que ela não deve apertar: `EvolutionService`
   * PRECISA chamar `registrar`, e é a direção certa da dependência (o conector
   * oferece o transporte à porta, nunca o contrário).
   */
  it('inscrever transporte continua permitido, e é o conector que faz isso', () => {
    const evolution = FONTES.find((f) => f.arquivo === 'src/pauta/evolution.service.ts');
    expect(evolution, 'o conector de WhatsApp sumiu do lugar que a catraca conhece').toBeDefined();
    expect(chamaNoCanal(evolution!, 'TransporteDeCanalRegistry', 'registrar')).not.toBeNull();
    expect(chamaNoCanal(evolution!, 'TransporteDeCanalRegistry', 'entregar')).toBeNull();
  });

  /*
   * E o serviço que DECIDE aprovação a partir de um corpo arbitrário não é
   * oferecido a ninguém: `CanaisModule` parou de exportá-lo, e nenhum arquivo
   * fora da pasta o importa.
   */
  it('ninguém fora do canal importa o serviço que decide aprovação por webhook', () => {
    // Pelo grafo de referências já resolvido (`REFS`), e não por texto: o
    // especificador de import é uma STRING, e a visão `semTexto` apaga strings.
    const alvo = `${CASA_DO_CANAL}canal-de-aprovacao.service.ts`;
    expect(CAMINHOS, 'o serviço do canal mudou de lugar').toContain(alvo);
    const fora = REFS.filter(
      (r) => r.alvo === alvo && !r.arquivo.startsWith(CASA_DO_CANAL),
    ).map((r) => `${r.arquivo}:${r.linha}`);
    expect(
      fora,
      '`CanalDeAprovacaoService.receber` transforma um corpo arbitrário em decisão de ' +
        'aprovação. Quem o alcança contorna o webhook, o segredo e o teto de tentativas.',
    ).toEqual([]);
  });
});
