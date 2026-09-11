import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * ============================================================================
 * SEGREDOS EM REPOUSO — E O CHAVEIRO QUE TORNA A ROTAÇÃO POSSÍVEL (RF-C-04)
 * ============================================================================
 *
 * AES-256-GCM: além de cifrar, o GCM AUTENTICA — valor adulterado no banco falha
 * na abertura em vez de virar lixo silencioso. Isso não mudou.
 *
 * O QUE MUDOU (fatia 5.3, 11/09/2026) E POR QUÊ
 * --------------------------------------------------------------------------
 * Até aqui havia UMA chave (`ENCRYPTION_KEY`) e nada no pacote cifrado dizia
 * qual chave o produziu. A consequência está escrita no CLAUDE.md do projeto
 * como armadilha conhecida: trocar a chave torna TODOS os tokens ilegíveis de
 * uma vez. Não é hipótese — `prisma/migrate-bio.ts` precisou de um
 * `BIO_OLD_ENCRYPTION_KEY` e de trocar `process.env` no meio da execução para
 * contornar exatamente isso, uma vez, na mão.
 *
 * Rotação de chave não é "cifrar com a nova". É poder VIVER com as duas: a nova
 * cifrando o que entra, a velha ainda abrindo o que ninguém re-cifrou. Para isso
 * faltavam duas coisas, e as duas entram aqui:
 *
 *   1. o pacote precisa DIZER com que chave foi cifrado. O formato novo
 *      (`c2.<chaveId>.<iv>.<tag>.<dados>`) carrega o id;
 *   2. o processo precisa carregar MAIS DE UMA chave ao mesmo tempo. É o
 *      CHAVEIRO, lido de `COFRE_CHAVES`.
 *
 * Com os dois, rotacionar vira: escrever com a chave nova, re-cifrar as linhas
 * antigas em ritmo próprio, e só tirar a chave velha do chaveiro quando não
 * sobrar nenhuma linha nela — uma pergunta que se responde com um `GROUP BY
 * "chaveId"`. E o caminho de volta existe pela mesma razão: enquanto as duas
 * estiverem no chaveiro, apontar `COFRE_CHAVE_ATUAL` de volta para a antiga é
 * uma linha de configuração, não uma restauração de backup.
 *
 * --------------------------------------------------------------------------
 * COMPATIBILIDADE COM O QUE JÁ ESTÁ NO BANCO — a regra que não pode ser quebrada
 * --------------------------------------------------------------------------
 * Existem hoje três chamadores de `cifrar`/`decifrar` (`bio-credenciais`,
 * `bio-oauth.controller`, `bio-sync`) e linhas gravadas em produção no formato
 * VELHO, de três partes (`iv.tag.dados`). Duas regras cuidam disso:
 *
 *   · `decifrar` ACEITA OS DOIS FORMATOS. Pacote de três partes é aberto com a
 *     chave de ambiente, como sempre foi;
 *   · `cifrar` CONTINUA ESCREVENDO NO FORMATO VELHO enquanto a chave atual for a
 *     de ambiente e não houver dado associado. Ou seja: sem `COFRE_CHAVES`
 *     configurado, este arquivo se comporta byte a byte como antes, e um
 *     rollback do código continua conseguindo ler o que foi escrito depois dele.
 *     O formato novo só passa a ser escrito quando alguém DECIDE montar um
 *     chaveiro — e aí a decisão é de quem configurou, não um efeito colateral.
 *
 * --------------------------------------------------------------------------
 * DADO ASSOCIADO (AAD): A TRANCA QUE A POLICY NÃO DÁ
 * --------------------------------------------------------------------------
 * O cofre cifra amarrando o valor a `orgId|conector|nome`. O GCM verifica esse
 * dado na abertura sem guardá-lo no pacote: uma linha copiada para outra empresa
 * — por dump, por restauração, por SQL de quem tem o banco na mão — NÃO ABRE,
 * mesmo com a chave certa. O isolamento por linha protege a CONSULTA; o dado
 * associado protege o DADO. As duas travas respondem a ameaças diferentes e por
 * isso existem as duas.
 *
 * --------------------------------------------------------------------------
 * O QUE ESTE ARQUIVO NÃO FAZ, E NÃO DEVE PASSAR A FAZER
 * --------------------------------------------------------------------------
 * Não busca chave em serviço externo (KMS, Vault, Secrets Manager). Dependência
 * nova é decisão humana (02-CONSTRAINTS), e trocar variável de ambiente por um
 * serviço muda o modelo de falha do arranque inteiro. O chaveiro foi desenhado
 * para que essa troca seja possível depois sem tocar em nenhum chamador: quem
 * quiser um KMS implementa `carregarChaveiro` lendo de lá.
 */

/** O id reservado da chave que vem de `ENCRYPTION_KEY`. */
export const ID_DA_CHAVE_DE_AMBIENTE = 'env';

/** O prefixo do formato que carrega o id da chave. */
const FORMATO_COM_ID = 'c2';

/**
 * Ids aceitos num chaveiro. Restrito de propósito: o id viaja DENTRO do pacote,
 * separado por ponto, e um id com ponto quebraria a separação em silêncio — o
 * pacote abriria com a chave errada ou não abriria, e ninguém saberia por quê.
 */
const ID_VALIDO = /^[A-Za-z0-9_-]{1,32}$/;

export interface ChaveDoCofre {
  readonly id: string;
  readonly material: Buffer;
}

export interface Chaveiro {
  /** A chave com que TUDO que entra a partir de agora é cifrado. */
  readonly atual: ChaveDoCofre;
  readonly porId: ReadonlyMap<string, ChaveDoCofre>;
  /** Todos os ids disponíveis, para diagnóstico. Nunca o material. */
  readonly ids: readonly string[];
}

/** Chave ausente, malformada ou id desconhecido. Sempre alta, nunca silenciosa. */
export class ChaveDeCofreError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ChaveDeCofreError';
  }
}

function material(bruta: string, onde: string): Buffer {
  const buf = Buffer.from(bruta.trim(), 'base64');
  if (buf.length !== 32) {
    throw new ChaveDeCofreError(
      `${onde}: a chave precisa ter 32 bytes em base64 (veio com ${buf.length}). ` +
        'Gere uma com: openssl rand -base64 32',
    );
  }
  return buf;
}

/*
 * O CHAVEIRO É MEMORIZADO, MAS PELA STRING DO AMBIENTE — não por "já li uma vez".
 *
 * Parece detalhe e não é: `prisma/migrate-bio.ts` troca `process.env.ENCRYPTION_KEY`
 * NO MEIO DA EXECUÇÃO para abrir tokens com a chave antiga e regravar com a
 * nova. Um cache que ignorasse a troca faria aquele script decifrar tudo com a
 * chave errada e reportar sucesso. Memorizar pelo VALOR do ambiente dá o
 * desempenho (derivar Buffer a cada `cifrar` é desperdício) sem a armadilha.
 */
let memoria: { assinatura: string; chaveiro: Chaveiro } | null = null;

function assinaturaDoAmbiente(): string {
  return [
    process.env.COFRE_CHAVES ?? '',
    process.env.COFRE_CHAVE_ATUAL ?? '',
    process.env.ENCRYPTION_KEY ?? '',
  ].join('\u0000');
}

/**
 * Esquece o chaveiro memorizado. Para a suíte e para quem troca o ambiente em
 * tempo de execução — a memorização por assinatura já cobre isso, e esta função
 * existe para o caso em que a troca acontece e alguém quer ser explícito.
 */
export function redefinirChaveiro(): void {
  memoria = null;
}

/**
 * Monta o chaveiro a partir do ambiente.
 *
 *   COFRE_CHAVES="k1:<base64 32B>,k2:<base64 32B>"
 *   COFRE_CHAVE_ATUAL="k2"
 *   ENCRYPTION_KEY="<base64 32B>"          (entra como a chave `env`)
 *
 * SEM `COFRE_CHAVES`, o chaveiro tem UMA chave — a de ambiente — e o
 * comportamento é idêntico ao de antes desta fatia. É o estado de hoje em
 * produção, e ele continua válido: o cofre funciona, só não dá para rotacionar.
 * Rotacionar exige ter para onde ir, e ter para onde ir é uma decisão de
 * operação (ver PERGUNTAS no relatório da fatia 5.3).
 */
export function chaveiro(): Chaveiro {
  const assinatura = assinaturaDoAmbiente();
  if (memoria && memoria.assinatura === assinatura) return memoria.chaveiro;

  const porId = new Map<string, ChaveDoCofre>();

  const doAmbiente = process.env.ENCRYPTION_KEY?.trim();
  if (doAmbiente) {
    porId.set(ID_DA_CHAVE_DE_AMBIENTE, {
      id: ID_DA_CHAVE_DE_AMBIENTE,
      material: material(doAmbiente, 'ENCRYPTION_KEY'),
    });
  }

  for (const item of (process.env.COFRE_CHAVES ?? '').split(',')) {
    const limpo = item.trim();
    if (!limpo) continue;
    const corte = limpo.indexOf(':');
    if (corte <= 0) {
      throw new ChaveDeCofreError(
        `COFRE_CHAVES: entrada "${limpo.slice(0, 12)}…" não está no formato <id>:<base64>.`,
      );
    }
    const id = limpo.slice(0, corte);
    if (!ID_VALIDO.test(id)) {
      throw new ChaveDeCofreError(
        `COFRE_CHAVES: id "${id}" inválido. Use só letras, números, hífen e sublinhado (até 32).`,
      );
    }
    if (id === ID_DA_CHAVE_DE_AMBIENTE) {
      throw new ChaveDeCofreError(
        `COFRE_CHAVES: "${ID_DA_CHAVE_DE_AMBIENTE}" é reservado para ENCRYPTION_KEY. ` +
          'Dois materiais com o mesmo id abririam pacotes com a chave errada.',
      );
    }
    porId.set(id, { id, material: material(limpo.slice(corte + 1), `COFRE_CHAVES[${id}]`) });
  }

  if (porId.size === 0) {
    throw new ChaveDeCofreError(
      'Nenhuma chave de cifragem configurada: preencha ENCRYPTION_KEY ou COFRE_CHAVES. ' +
        'Variável nova precisa entrar em DOIS lugares neste projeto — o bloco `environment:` ' +
        'do serviço no docker-compose.yml E o .env; o que não está no bloco não chega no container.',
    );
  }

  const pedida = process.env.COFRE_CHAVE_ATUAL?.trim();
  let atual: ChaveDoCofre | undefined;
  if (pedida) {
    atual = porId.get(pedida);
    if (!atual) {
      /*
       * FALHA ALTA, e não "cai na de ambiente". Apontar a chave atual para um id
       * que não existe é o erro de digitação que, no lado silencioso, faria o
       * produto gravar tudo com a chave velha achando que rotacionou.
       */
      throw new ChaveDeCofreError(
        `COFRE_CHAVE_ATUAL="${pedida}" não está no chaveiro. Disponíveis: ${[...porId.keys()].join(', ')}.`,
      );
    }
  } else {
    // Sem escolha declarada: a de ambiente, se houver; senão a única/primeira.
    atual = porId.get(ID_DA_CHAVE_DE_AMBIENTE) ?? [...porId.values()][0];
  }

  const montado: Chaveiro = { atual, porId, ids: [...porId.keys()] };
  memoria = { assinatura, chaveiro: montado };
  return montado;
}

/** Há como cifrar? (Usado por quem se desliga em vez de falhar — ver `bio-sync`.) */
export function temChaveDeCriptografia(): boolean {
  try {
    chaveiro();
    return true;
  } catch {
    return false;
  }
}

/** Os ids disponíveis. Diagnóstico e tela — nunca material de chave. */
export function idsDoChaveiro(): string[] {
  return [...chaveiro().ids];
}

/** O id da chave com que tudo que entra agora é cifrado. */
export function idDaChaveAtual(): string {
  return chaveiro().atual.id;
}

function chavePorId(id: string): ChaveDoCofre {
  const c = chaveiro().porId.get(id);
  if (!c) {
    throw new ChaveDeCofreError(
      `chave "${id}" não está no chaveiro (disponíveis: ${idsDoChaveiro().join(', ')}). ` +
        'Um valor cifrado com ela NÃO abre até que ela volte a COFRE_CHAVES — foi por isso ' +
        'que a chave velha não pode sair do chaveiro antes de a rotação terminar.',
    );
  }
  return c;
}

export interface OpcoesDeCifragem {
  /** Cifrar com uma chave específica do chaveiro. Padrão: a atual. */
  chaveId?: string;
  /**
   * Dado associado. NÃO é guardado no pacote: quem abre precisa informar o
   * mesmo valor, ou o GCM recusa. É o que amarra o valor à empresa.
   */
  aad?: string;
}

/**
 * Cifra. Ver a nota de compatibilidade no topo: o formato de saída depende de
 * haver chaveiro configurado, e é assim de propósito.
 */
export function cifrar(texto: string, opcoes: OpcoesDeCifragem = {}): string {
  const chave = opcoes.chaveId ? chavePorId(opcoes.chaveId) : chaveiro().atual;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave.material, iv);
  if (opcoes.aad) c.setAAD(Buffer.from(opcoes.aad, 'utf8'));
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  const tag = c.getAuthTag();

  const formatoVelho = chave.id === ID_DA_CHAVE_DE_AMBIENTE && !opcoes.aad;
  const corpo = `${iv.toString('base64')}.${tag.toString('base64')}.${dados.toString('base64')}`;
  return formatoVelho ? corpo : `${FORMATO_COM_ID}.${chave.id}.${corpo}`;
}

/** O id da chave que cifrou este pacote — sem abri-lo. É a coluna `chaveId`. */
export function chaveDoPacote(pacote: string): string {
  const partes = pacote.split('.');
  if (partes.length === 5 && partes[0] === FORMATO_COM_ID) return partes[1];
  if (partes.length === 3) return ID_DA_CHAVE_DE_AMBIENTE;
  throw new ChaveDeCofreError('pacote cifrado malformado');
}

export interface OpcoesDeAbertura {
  /** O mesmo dado associado usado na cifragem. */
  aad?: string;
}

/**
 * Decifra. Aceita os dois formatos (ver o topo).
 *
 * ERRO ALTO EM VEZ DE `null`: valor que não abre é adulteração, chave errada ou
 * chave ausente — três coisas que ninguém deve tratar como "então não tem
 * token". `bio-sync` já escolhe explicitamente se pula ou falha.
 */
export function decifrar(pacote: string, opcoes: OpcoesDeAbertura = {}): string {
  const partes = pacote.split('.');

  let chaveId: string;
  let iv: string | undefined;
  let tag: string | undefined;
  let dados: string | undefined;

  if (partes.length === 5 && partes[0] === FORMATO_COM_ID) {
    [, chaveId, iv, tag, dados] = partes;
  } else if (partes.length === 3) {
    chaveId = ID_DA_CHAVE_DE_AMBIENTE;
    [iv, tag, dados] = partes;
    if (opcoes.aad) {
      /*
       * Pacote velho nunca teve dado associado. Deixar passar faria o GCM falhar
       * com "unable to authenticate data" e mandaria quem investiga procurar
       * corrupção de banco — quando o defeito é um chamador novo lendo linha
       * velha. Dizer isso aqui economiza a investigação.
       */
      throw new ChaveDeCofreError(
        'pacote no formato antigo (sem id de chave) não carrega dado associado; ' +
          'abra-o sem `aad` ou re-cifre-o antes.',
      );
    }
  } else {
    throw new ChaveDeCofreError('pacote cifrado malformado');
  }

  if (!iv || !tag || !dados) throw new ChaveDeCofreError('pacote cifrado malformado');

  const chave = chavePorId(chaveId);
  const d = createDecipheriv('aes-256-gcm', chave.material, Buffer.from(iv, 'base64'));
  if (opcoes.aad) d.setAAD(Buffer.from(opcoes.aad, 'utf8'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
}

/**
 * Comparação de segredo em tempo constante.
 *
 * Mora aqui porque é o mesmo assunto e o mesmo cuidado: comparar segredo com
 * `===` vaza o tamanho do prefixo que bateu pelo tempo da comparação. Tamanhos
 * diferentes devolvem `false` sem chamar o comparador — `timingSafeEqual` LANÇA
 * quando os buffers têm tamanhos diferentes, e um throw dentro de uma
 * verificação de igualdade seria pior que o vazamento que ele evita.
 */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
