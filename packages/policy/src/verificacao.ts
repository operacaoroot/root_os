import { classificar, avaliar, type Capacidade, type Decisao } from './escada.js';
import type { Politica } from './esquema.js';

/*
 * A trava que o documento normativo exige: `04-ESCADA-R0-R5.md` diz que o
 * código é "o espelho executável deste texto, e teste-politica.ts reprova
 * quando os dois divergem".
 *
 * O laço vinha de scripts/verificar.ts e virou função para que o CLI e o
 * vitest chamem exatamente o mesmo código. A lógica mudou de casa; a garantia
 * não. Se alguém "melhorar" classificar() ao portar, isto fica vermelho.
 */

export interface LinhaVerificacao {
  id: string;
  declarado: string;
  calculado: string;
  ok: boolean;
}

export function verificarCatalogo(pol: Pick<Politica, 'capacidades'>): LinhaVerificacao[] {
  return pol.capacidades.map((c) => {
    const calculado = classificar(c.efeito as Capacidade['efeito']);
    return { id: c.id, declarado: c.nivel, calculado, ok: calculado === c.nivel };
  });
}

export type MotivoReversibilidade =
  | 'sem-desfazer'
  | 'desfazer-inexistente'
  | 'desfazer-r5'
  | 'desfazer-nao-implementado'
  | 'autorreferencia-invalida'
  | 'ciclo';

export interface LinhaReversibilidade {
  id: string;
  nivel: string;
  motivo: MotivoReversibilidade;
  /** O ponteiro declarado — ou o caminho inteiro, quando o motivo é `ciclo`. */
  desfazer?: string;
}

type CapacidadeDoCatalogo = Politica['capacidades'][number];

/**
 * Alteração é a única forma que se desfaz com ela mesma: chamar de novo com o
 * valor anterior devolve o registro ao estado de antes. Criar de novo não
 * desfaz uma criação, enviar de novo não desfaz um envio.
 *
 * A prova é o último segmento do id, que é o contrato de nome do catálogo
 * (`criar` · `alterar` · `excluir` · `enviar` · `baixar` · `rotacionar`…).
 */
const ehAlteracao = (c: CapacidadeDoCatalogo) => c.id.split('.').pop() === 'alterar';

/**
 * "O PRÓPRIO OS consegue desfazer" é uma afirmação sobre o produto de hoje, não
 * sobre o catálogo: sem rota e sem ferramenta, ninguém executa o desfazer —
 * ele é só um nome escrito num JSON.
 */
const implementada = (c: CapacidadeDoCatalogo) => Boolean(c.rota || c.ferramenta);

/**
 * A segunda trava, irmã de verificarCatalogo().
 *
 * `04-ESCADA-R0-R5.md` prende o R2 a uma condição verificável — "cria ou altera
 * um registro interno que o PRÓPRIO OS consegue desfazer" — e é só a
 * reversibilidade automática que segura a ação nesse degrau: sem ela o gatilho
 * manda para R3. Uma capacidade que se declara automaticamente reversível e
 * aponta um desfazer que ninguém sabe executar está ganhando um degrau de
 * desconto por uma promessa vazia.
 *
 * Conferir só se o id do desfazer EXISTE no catálogo não fecha nada: existir é
 * o mais barato dos requisitos. Falha fechada tem seis formatos:
 *
 *  - `sem-desfazer`: escreve fora do OS, se diz automática e não nomeia o desfazer;
 *  - `desfazer-inexistente`: nomeia um id que não existe no catálogo;
 *  - `desfazer-r5`: nomeia um R5 — que o OS NUNCA executa, só prepara e entrega
 *    a uma pessoa. Prometer volta automática apontando para um R5 é prometer
 *    que outra pessoa vai desfazer, um dia, à mão;
 *  - `desfazer-nao-implementado`: nomeia capacidade sem rota e sem ferramenta,
 *    isto é, declarada e não construída;
 *  - `autorreferencia-invalida`: aponta para si mesma sem ser uma alteração.
 *    A autorreferência é legítima e é a forma mais comum de R2 aqui (PATCH de
 *    status: chamar de novo com o valor anterior desfaz), mas só para alteração;
 *  - `ciclo`: a cadeia de desfazer volta a um id já visitado e nunca aterrissa
 *    em nada que se sustente sozinho — `a → b → a` são duas promessas apoiadas
 *    uma na outra. Um par legítimo do tipo arquivar/desarquivar se declara com
 *    uma ponta terminal: só `arquivar` aponta `desfazer`, e a outra ponta se
 *    resolve como alteração que se desfaz com ela mesma.
 *
 * Não se exige desfazer de R0/R1: quem não escreve fora do OS não tem o que
 * desfazer lá fora.
 */
export function verificarReversibilidade(
  pol: Pick<Politica, 'capacidades'>,
): LinhaReversibilidade[] {
  const porId = new Map(pol.capacidades.map((c) => [c.id, c]));
  const linhas: LinhaReversibilidade[] = [];

  /** Terminal da cadeia: alteração que se desfaz com ela mesma. */
  const autoDesfaz = (c: CapacidadeDoCatalogo) => c.desfazer === c.id && ehAlteracao(c);

  for (const c of pol.capacidades) {
    const anota = (motivo: MotivoReversibilidade, desfazer?: string) =>
      linhas.push({ id: c.id, nivel: c.nivel, motivo, desfazer });

    if (!c.desfazer) {
      if (c.efeito.escreveForaDoOS && c.efeito.reversibilidade === 'automatica') {
        anota('sem-desfazer');
      }
      continue;
    }

    if (c.desfazer === c.id) {
      if (!ehAlteracao(c)) anota('autorreferencia-invalida', c.desfazer);
      else if (c.nivel === 'R5') anota('desfazer-r5', c.desfazer);
      else if (!implementada(c)) anota('desfazer-nao-implementado', c.desfazer);
      continue;
    }

    const alvo = porId.get(c.desfazer);
    if (!alvo) {
      anota('desfazer-inexistente', c.desfazer);
      continue;
    }
    if (alvo.nivel === 'R5') {
      anota('desfazer-r5', c.desfazer);
      continue;
    }
    if (!implementada(alvo)) {
      anota('desfazer-nao-implementado', c.desfazer);
      continue;
    }

    // A cadeia precisa aterrissar: ou numa capacidade que não promete mais
    // nada, ou numa alteração que se desfaz com ela mesma.
    const caminho = [c.id];
    const vistos = new Set([c.id]);
    let atual: CapacidadeDoCatalogo = c;
    while (atual.desfazer && !autoDesfaz(atual)) {
      const proximo = porId.get(atual.desfazer);
      if (!proximo) break; // ponteiro quebrado — quem reporta é a linha dele
      caminho.push(proximo.id);
      if (vistos.has(proximo.id)) {
        anota('ciclo', caminho.join(' → '));
        break;
      }
      vistos.add(proximo.id);
      atual = proximo;
    }
  }
  return linhas;
}

export interface CasoDeDecisao {
  nome: string;
  decisao: Decisao;
}

/**
 * Os casos que o anexo imprime, para que o comportamento — e não só a
 * classificação — fique preso ao documento. Recebe as capacidades por id para
 * servir tanto ao catálogo ROOT quanto ao do marketing-os.
 *
 * `interno` é o exemplo de R2 e vem nulo quando o catálogo não tem nenhum — é o
 * caso do politica-root.json desde 10/09/2026, em que os três "criar" subiram
 * para R3 por não terem desfazer declarado. Catálogo sem R2 devolve só os três
 * casos que não dependem dele, em vez de fingir um R2 sintético.
 */
export function casosDeDecisao(
  pol: Pick<Politica, 'capacidades'>,
  ids: { externo: string; interno?: string | null },
): CasoDeDecisao[] {
  const acha = (id: string) => {
    const c = pol.capacidades.find((x) => x.id === id);
    if (!c) throw new Error(`capacidade "${id}" não existe no catálogo`);
    return c as unknown as Capacidade;
  };
  const externo = acha(ids.externo);

  const casos: CasoDeDecisao[] = [
    { nome: 'saída externa, normal', decisao: avaliar(externo) },
    {
      nome: 'saída externa, destinatário novo',
      decisao: avaliar(externo, { sinais: ['destinatario_novo'] }),
    },
  ];

  if (ids.interno) {
    const interno = acha(ids.interno);
    casos.push(
      {
        nome: 'registro interno, aprovação desligada',
        decisao: avaliar(interno, { aprovacaoR2Ligada: false }),
      },
      {
        nome: 'registro interno, fonte não confiável',
        decisao: avaliar(interno, { sinais: ['fonte_nao_confiavel'] }),
      },
    );
  }

  casos.push({ nome: 'ferramenta desconhecida', decisao: avaliar(null) });
  return casos;
}
