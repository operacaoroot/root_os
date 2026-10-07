import { PASTA_DO_ONBOARDING } from '../onboarding/indice';
import { blobDoGit, tipoDoModo, TIPO_ARQUIVO, type EntradaDoIndice } from './indice-do-git';
import { lerNotaDaVault, type NotaLida } from './cabecalho-da-nota';

/*
 * ============================================================================
 * QUEM PERTENCE À COLEÇÃO `vault:` (C19-03, R-1, R-2, R-3)
 * ============================================================================
 *
 * Um `.md` da vault pertence à coleção quando cumpre as quatro condições:
 *
 *   1. termina em `.md` e nenhum segmento do caminho começa com ponto (o passeio
 *      já devolve só esses);
 *   2. o caminho, EM BYTES, está no índice do git, no estágio 0, sem
 *      `skip-worktree` nem `intent-to-add`, e com modo de arquivo comum;
 *   3. os bytes do disco dão o blob que o índice registra — o arquivo não foi
 *      mexido na VPS fora do git;
 *   4. o cabeçalho não traz a marca do gerador de documentação.
 *
 * O `kind` só é olhado DEPOIS da quarta condição (R-7): a página gerada é
 * excluída aqui e nunca chega à projeção, então ler o `kind` não reabre o eco
 * que `documentacao.ts` fechava excluindo `nota` da geração.
 *
 * A PERTENÇA E A LEITURA USAM O CAMINHO DO DISCO COMO ELE É, em bytes; o NFC
 * monta só a chave e o rótulo (R-1). A colisão de NFC é conferida ENTRE MEMBROS,
 * depois das quatro condições: um arquivo solto, criado à mão na VPS com o mesmo
 * nome noutra normalização, não tira da atualização a nota rastreada.
 *
 * AS SITUAÇÕES, e o que cada uma faz na volta:
 *
 *   situação                            índice e memória                 conjunto de vistos
 *   ----------------------------------  -------------------------------  ------------------
 *   membro                              entra                            (é visto por ser membro)
 *   não rastreado                       fora (até D2)                    não
 *   rastreado e alterado fora do git    fica a última versão projetada   sim (R-3)
 *   rastreado e apagado fora do git     fica a última versão projetada   sim (R-3)
 *   entrada não verificável             fica a última versão projetada   sim (R-3)
 *   colisão de NFC entre membros        os dois saem; o item fica        sim (R-3)
 *   página do gerador                   fora                             não
 *   `90-OS/` ou `onboarding/` na raiz   fora sempre                      não
 *   nome fora de UTF-8                  fora                             não (não há chave)
 *
 * "Conjunto de vistos" é o que a projeção não arquiva como sumido nem altera:
 * o que ficou fora por anomalia do clone não pode custar o histórico da nota.
 *
 * `90-OS/` são dados do OS (C-11, C-17). `onboarding/` é o espaço de nomes do
 * espelho da carga guiada no mesmo índice (`onboarding/indice.ts`): a coleção
 * não o usa, e uma pasta com esse nome criada na base fica fora com o motivo
 * no recibo (C19-06, regra 7, e a observação da ROOT-19-REV).
 */

/** As pastas da raiz que nunca entram na coleção. */
export const PASTAS_FORA_DA_COLECAO = ['90-OS', PASTA_DO_ONBOARDING] as const;

/**
 * Acima desta fração de rastreados "alterados fora do git", o recibo troca a
 * lista por um aviso único de conversão provável (R-2): é o sintoma de um
 * `core.autocrlf` na configuração GLOBAL do git da VPS, que o container não lê.
 * O piso evita chamar de conversão duas notas editadas à mão numa vault de três.
 */
export const FRACAO_DE_CONVERSAO_PROVAVEL = 0.5;
export const PISO_DE_CONVERSAO_PROVAVEL = 5;

export interface ArquivoNoDisco {
  /** Relativo à raiz, com `/`, em bytes como o sistema de arquivos devolveu. */
  caminho: Buffer;
  bytes: Buffer;
  modificadoEm: Date;
}

export interface MembroDaVault {
  /** NFC: a chave (`vault:` + este) e o `path` do índice. */
  caminho: string;
  nota: NotaLida;
  modificadoEm: Date;
}

export type SituacaoForaDaColecao =
  | 'nao_rastreado'
  | 'alterado_fora_do_git'
  | 'apagado_fora_do_git'
  | 'nao_verificavel'
  | 'colisao_nfc'
  | 'gerado_pelo_os'
  | 'pasta_fora_da_colecao'
  | 'nome_ilegivel';

export interface PertencaDaVault {
  /** `ok`, ou o motivo de "rastreamento não verificável" — e aí ninguém é membro. */
  rastreamento: 'ok' | string;
  membros: MembroDaVault[];
  /** Caminhos (NFC) que ficaram fora por anomalia e que a projeção conta como vistos (R-3). */
  vistos: string[];
  foraDaColecao: Array<{ caminho: string; situacao: SituacaoForaDaColecao }>;
  contagens: {
    mdNoDisco: number;
    rastreados: number;
    naoRastreados: number;
    alteradosForaDoGit: number;
    apagadosForaDoGit: number;
    naoVerificaveis: number;
    colisoesNFC: number;
    geradosExcluidos: number;
    nomesIlegiveis: number;
    pastasForaDaColecao: Record<string, number>;
    membros: number;
  };
  avisos: string[];
}

const ehMd = (c: Buffer): boolean => c.toString('latin1').toLowerCase().endsWith('.md');
const temSegmentoComPonto = (c: Buffer): boolean => c.toString('latin1').split('/').some((s) => s.startsWith('.'));

/** A pasta de primeiro nível que deixa o caminho fora, se houver. */
function pastaFora(c: Buffer): string | null {
  const primeira = c.toString('latin1').split('/')[0];
  return (PASTAS_FORA_DA_COLECAO as readonly string[]).includes(primeira) && c.includes(0x2f) ? primeira : null;
}

/** O caminho em texto, quando os bytes são UTF-8 de verdade. */
function emTexto(c: Buffer): string | null {
  const t = c.toString('utf8');
  return Buffer.from(t, 'utf8').equals(c) ? t : null;
}

/** A entrada vale como prova de rastreamento? Senão, o motivo. */
function entradaVerificavel(entradas: EntradaDoIndice[]): string | null {
  if (entradas.some((e) => e.estagio !== 0)) return 'conflito de merge no índice (estágio diferente de 0)';
  const e = entradas[0];
  if (e.skipWorktree) return 'skip-worktree no índice';
  if (e.intentToAdd) return 'intent-to-add no índice (git add -N)';
  if (tipoDoModo(e.modo) !== TIPO_ARQUIVO) return 'não é arquivo comum no índice (link simbólico ou submódulo)';
  return null;
}

/**
 * Classifica a vault. `rastreamento` diferente de `ok` (índice ilegível, sem
 * `.git`, objetos SHA-256, conversão de fim de linha) devolve nenhum membro e
 * nenhum visto: quem chama não cria, não altera e não arquiva nada (C19-03).
 */
export function classificarAVault(entrada: {
  arquivos: ArquivoNoDisco[];
  indice: EntradaDoIndice[] | null;
  naoVerificavel: string | null;
}): PertencaDaVault {
  const contagens: PertencaDaVault['contagens'] = {
    mdNoDisco: entrada.arquivos.length,
    rastreados: 0,
    naoRastreados: 0,
    alteradosForaDoGit: 0,
    apagadosForaDoGit: 0,
    naoVerificaveis: 0,
    colisoesNFC: 0,
    geradosExcluidos: 0,
    nomesIlegiveis: 0,
    pastasForaDaColecao: {},
    membros: 0,
  };
  const resultado: PertencaDaVault = {
    rastreamento: 'ok',
    membros: [],
    vistos: [],
    foraDaColecao: [],
    contagens,
    avisos: [],
  };
  if (entrada.naoVerificavel || !entrada.indice) {
    resultado.rastreamento = entrada.naoVerificavel ?? 'índice do git não lido';
    return resultado;
  }

  const porCaminho = new Map<string, EntradaDoIndice[]>();
  for (const e of entrada.indice) {
    const chave = e.caminho.toString('latin1');
    porCaminho.set(chave, [...(porCaminho.get(chave) ?? []), e]);
  }
  const noDisco = new Set(entrada.arquivos.map((a) => a.caminho.toString('latin1')));
  const vistos = new Set<string>();
  const fora = (caminho: string, situacao: SituacaoForaDaColecao) => resultado.foraDaColecao.push({ caminho, situacao });
  const candidatos: MembroDaVault[] = [];

  for (const a of entrada.arquivos) {
    const pasta = pastaFora(a.caminho);
    if (pasta) {
      contagens.pastasForaDaColecao[pasta] = (contagens.pastasForaDaColecao[pasta] ?? 0) + 1;
      fora(a.caminho.toString('utf8'), 'pasta_fora_da_colecao');
      continue;
    }
    const texto = emTexto(a.caminho);
    if (texto === null) {
      contagens.nomesIlegiveis++;
      fora(a.caminho.toString('utf8'), 'nome_ilegivel');
      continue;
    }
    const caminho = texto.normalize('NFC');
    const entradas = porCaminho.get(a.caminho.toString('latin1'));
    if (!entradas) {
      contagens.naoRastreados++;
      fora(caminho, 'nao_rastreado');
      continue;
    }
    contagens.rastreados++;
    const naoVerificavel = entradaVerificavel(entradas);
    if (naoVerificavel) {
      contagens.naoVerificaveis++;
      vistos.add(caminho);
      fora(caminho, 'nao_verificavel');
      continue;
    }
    if (blobDoGit(a.bytes) !== entradas[0].blob) {
      contagens.alteradosForaDoGit++;
      vistos.add(caminho);
      fora(caminho, 'alterado_fora_do_git');
      continue;
    }
    const nota = lerNotaDaVault(caminho, a.bytes.toString('utf8'));
    if (nota.cabecalho.geradoPeloOs) {
      contagens.geradosExcluidos++;
      fora(caminho, 'gerado_pelo_os');
      continue;
    }
    candidatos.push({ caminho, nota, modificadoEm: a.modificadoEm });
  }

  // Rastreado no índice e ausente do disco: apagado fora do git (R-3). Só o que
  // seria membro conta — `.md`, sem ponto, fora das pastas reservadas.
  for (const [chave, entradas] of porCaminho) {
    if (noDisco.has(chave)) continue;
    const c = entradas[0].caminho;
    if (!ehMd(c) || temSegmentoComPonto(c) || pastaFora(c)) continue;
    const texto = emTexto(c);
    if (texto === null) continue;
    const caminho = texto.normalize('NFC');
    if (entradaVerificavel(entradas)) {
      contagens.naoVerificaveis++;
      vistos.add(caminho);
      fora(caminho, 'nao_verificavel');
      continue;
    }
    contagens.apagadosForaDoGit++;
    vistos.add(caminho);
    fora(caminho, 'apagado_fora_do_git');
  }

  // A colisão de NFC, só entre quem passou nas quatro condições (R-1).
  const porChave = new Map<string, MembroDaVault[]>();
  for (const m of candidatos) porChave.set(m.caminho, [...(porChave.get(m.caminho) ?? []), m]);
  for (const [caminho, grupo] of porChave) {
    if (grupo.length > 1) {
      contagens.colisoesNFC += grupo.length;
      vistos.add(caminho);
      for (let i = 0; i < grupo.length; i++) fora(caminho, 'colisao_nfc');
      continue;
    }
    resultado.membros.push(grupo[0]);
  }
  contagens.membros = resultado.membros.length;

  if (
    contagens.alteradosForaDoGit >= PISO_DE_CONVERSAO_PROVAVEL &&
    contagens.alteradosForaDoGit > contagens.rastreados * FRACAO_DE_CONVERSAO_PROVAVEL
  ) {
    resultado.avisos.push(
      `${contagens.alteradosForaDoGit} de ${contagens.rastreados} arquivo(s) rastreado(s) não batem com o blob do ` +
        'índice: conversão de fim de linha ou filtro provável (configuração global do git da VPS, que o ' +
        'container não lê). Nenhum deles foi relido.',
    );
  }
  resultado.vistos = [...vistos];
  return resultado;
}
