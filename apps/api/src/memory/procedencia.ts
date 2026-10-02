import { createHash } from 'node:crypto';
import { ContextSource } from '@prisma/client';

/*
 * ============================================================================
 * PROCEDÊNCIA — de onde a nota veio, dito de um jeito só (RF-M-02)
 * ============================================================================
 *
 * Funções puras, sem banco e sem Nest, para que a suíte possa exercitá-las sem
 * `TEST_DATABASE_URL` — e para que o CLI de migração use exatamente as mesmas
 * regras que o serviço, em vez de reescrevê-las com uma vírgula de diferença.
 *
 * NOTA É CONTEÚDO EXTERNO, e nada aqui muda isso. Estas funções produzem o
 * RÓTULO da procedência; quem cerca, neutraliza e marca o conteúdo continua
 * sendo `blocoExterno`/`neutralizarConteudoExterno` de
 * `src/agents/context-builder.service.ts`, pelo caminho que já existe. O rótulo
 * é o que aquele caminho põe no cabeçalho da cerca — e é justamente para o
 * cabeçalho não ser inventado duas vezes que ele nasce aqui.
 */

/** O prefixo da chave estável de uma nota vinda da vault do Obsidian. */
export const PREFIXO_DA_VAULT = 'vault:';

/**
 * A chave estável de uma nota da vault: `vault:<caminho relativo em NFC>`.
 *
 * É ela que faz a reindexação ser IDEMPOTENTE. Sem chave estável, cada volta do
 * cron criaria notas novas para os mesmos arquivos e o "histórico de versões"
 * viraria um monte de notas com uma versão cada — o oposto do que RF-M-01 pede.
 *
 * NFC AQUI E NO PONTO ONDE O CAMINHO NASCE (C19-02). O mesmo nome com acento
 * pode chegar do disco em NFD (arquivo criado no macOS e versionado sem
 * `core.precomposeunicode`) e em NFC; sem normalizar, viraria duas notas. Caixa
 * não é dobrada: o git e o disco da VPS diferenciam. Medido na árvore da base
 * que produção lê: 0 caminho fora de NFC, então nenhuma chave viva muda.
 */
export function chaveDaVault(caminhoRelativo: string): string {
  return `${PREFIXO_DA_VAULT}${caminhoRelativo.normalize('NFC')}`;
}

/**
 * A chave é da coleção `vault:`? Sem diferenciar caixa nem espaço na frente: a
 * reserva do prefixo (C19-06, regra 3) recusa também `Vault:x` e ` vault:x`,
 * que a tela aparava ou que só um olho cansado distingue do de verdade.
 */
export function ehChaveDaVault(chave: string | null | undefined): boolean {
  return String(chave ?? '').normalize('NFC').trim().toLowerCase().startsWith(PREFIXO_DA_VAULT);
}

/**
 * O rótulo de origem que o cabeçalho da cerca recebe: `<tipo>:<referência>`.
 *
 * O FORMATO NÃO É ESCOLHA LIVRE: `context-builder.service.ts` já monta
 * `vault:${path}` para as notas da base de conhecimento, e o dia em que a
 * memória alimentar o contexto os dois lados têm de dizer a mesma coisa sobre a
 * mesma nota. Divergir aqui produziria duas procedências para um insumo só, que
 * é a forma mais silenciosa de RF-M-02 deixar de valer.
 *
 * Sem referência, fica só o tipo — e isso é honesto: "veio de um envio" já é
 * mais do que "veio de algum lugar".
 */
export function rotuloDeProcedencia(
  sourceType: ContextSource,
  sourceRef?: string | null,
): string {
  const ref = (sourceRef ?? '').trim();
  return ref ? `${sourceType}:${ref}` : String(sourceType);
}

/**
 * O resumo criptográfico do corpo, que serve a duas coisas diferentes:
 *
 *  1. PULAR REESCRITA. A vault é relida a cada 30 minutos; sem comparar o hash,
 *     toda volta gravaria uma versão nova de cada nota e gastaria um vetor por
 *     nota — o item mais caro do sistema — para registrar que nada mudou.
 *  2. DAR À DETECÇÃO DE CONTRADIÇÃO (RF-M-08) um jeito barato de responder
 *     "isto é literalmente a mesma afirmação" antes de gastar modelo para
 *     descobrir se é a mesma afirmação com outras palavras.
 *
 * Normaliza espaço em branco de propósito: um `\r\n` que virou `\n` na viagem
 * de um arquivo entre sistemas operacionais não é mudança de conteúdo, e tratá-lo
 * como mudança faria a nota versionar sozinha para sempre.
 */
export function hashDoCorpo(corpo: string): string {
  return createHash('sha256').update(corpoNormalizado(corpo)).digest('hex');
}

/** O texto que `hashDoCorpo` resume: `\r\n` vira `\n` e as pontas são aparadas. */
export function corpoNormalizado(corpo: string): string {
  return String(corpo ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

/**
 * A FORMA do corpo — tamanho e resumo criptográfico, ZERO texto do cliente.
 *
 * É o que o evento do RASTRO carrega no lugar do corpo, e a mudança em relação à
 * primeira versão desta fatia é deliberada: antes ia um EXCERTO (as primeiras
 * 280 letras), o que significa que corpo CURTO entrava inteiro no registro.
 *
 * O ARGUMENTO QUE DECIDE. O RASTRO é lido com `auditoria.ver`; a memória, com
 * `obsidian.ver`. São públicos diferentes. Pôr o texto da nota no registro faz o
 * conteúdo do cliente atravessar essa fronteira de permissão sem que ninguém
 * tenha decidido que ele deve atravessar — e o registro é justamente o lugar de
 * onde não se apaga nada depois (02-CONSTRAINTS).
 *
 * O que quem audita precisa saber continua ali: QUE mudou (o hash muda), QUANTO
 * mudou (o tamanho) e ONDE ler (a `referencia` aponta para a linha de versão).
 * O que ele NÃO tem de graça é o conteúdo.
 *
 * Conta em PONTO DE CÓDIGO (`Array.from`) e não em unidade de 16 bits: emoji e
 * ideograma são um caractere para quem lê e dois para o `length` do JavaScript,
 * e um número que diz 400 para um texto de 200 letras não ajuda ninguém.
 */
export function formaDoCorpo(corpo: string, contentHash: string): string {
  const caracteres = Array.from(String(corpo ?? '')).length;
  return `${caracteres} caractere(s) · corpo sha256:${contentHash.slice(0, 12)}`;
}

/**
 * POR QUE uma versão nasceu sem elo com o RASTRO.
 *
 * Os dois valores existem porque, sem eles, seriam o MESMO sinal — e um sinal
 * com dois significados não é sinal. Ver `ContextItemVersion.semEventoPorque`.
 */
export const SEM_EVENTO = {
  /** Veio do comando de migração do acervo, que roda fora da aplicação. */
  migracao: 'migracao',
  /** A escrita do evento falhou. O rastro nunca derruba a operação. */
  falha: 'falha_ao_registrar',
} as const;

export type SemEventoPorque = (typeof SEM_EVENTO)[keyof typeof SEM_EVENTO];

/** O ponteiro que o evento guarda para onde o conteúdo cru de fato mora. */
export function referenciaDaVersao(versaoId: string): string {
  return `ContextItemVersion:${versaoId}`;
}

/**
 * A procedência é obrigatória, e "obrigatória" quer dizer que a falta LANÇA.
 *
 * RF-M-02 promete procedência em toda resposta. Uma resposta não tem como
 * carregar o que a nota não guardou, então o lugar de cobrar é a entrada — e
 * não a saída, onde a única opção seria mentir ou omitir.
 */
export function exigirProcedencia(
  sourceType: ContextSource | null | undefined,
  onde: string,
): ContextSource {
  if (!sourceType || !Object.values(ContextSource).includes(sourceType)) {
    throw new Error(
      `${onde}: nota sem procedência. Toda nota da MEMÓRIA declara de onde veio ` +
        `(${Object.values(ContextSource).join(', ')}) — ver RF-M-02 e ADR-011.`,
    );
  }
  return sourceType;
}
