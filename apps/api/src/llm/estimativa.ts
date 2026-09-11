import { precoDe } from './preco';
import type { LlmToolSpec, LlmTurn } from './llm.provider';

/*
 * QUANTO ESTA CHAMADA PODE CUSTAR — o número que permite cortar ANTES.
 *
 * O problema desta fatia em uma frase: o custo de uma chamada ao modelo só se
 * conhece DEPOIS dela. Uma trava que olhe apenas o já gasto corta tarde por
 * construção — a chamada que estoura o teto é justamente a que ainda não foi
 * contada. Para cortar antes é preciso um número antes, e esse número é uma
 * estimativa.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE NÚMERO É, E O QUE ELE NÃO É
 * ----------------------------------------------------------------------------
 * Ele é uma estimativa CONSERVADORA. Não é um limite superior, e chamá-lo assim
 * seria prometer o que ele não entrega — a versão anterior deste arquivo
 * prometia, e estava errada em três casos concretos:
 *
 *   · argumento e schema em JSON rendem MENOS caracteres por token que texto
 *     corrido (pontuação e chaves viram token sozinhas);
 *   · texto com muita pontuação, idem;
 *   · alfabeto não latino (CJK, cirílico, árabe) fica MUITO abaixo: perto de um
 *     token por caractere.
 *
 * Então a conta deixou de ter uma razão só. São três faixas, e a razão de cada
 * uma é declarada logo abaixo. Mesmo assim continua sendo estimativa: só o
 * tokenizador do provedor sabe o número exato, e ele custaria uma ida de rede
 * por chamada (nenhum dos três providers expõe um local).
 *
 * Os dois lados da conta:
 *
 *  · SAÍDA, na RESERVA — usa o `max_tokens` que a PRÓPRIA chamada vai mandar ao
 *    provedor (`LlmProvider.tetoDeSaida`). Esse lado é limite superior de
 *    verdade: é o teto que o pedido declara, e o modelo não pode passar dele.
 *
 *  · SAÍDA, na LIQUIDAÇÃO de `complete()` — usa o TEXTO QUE VOLTOU. `complete()`
 *    não devolve uso, então não há custo real para gravar; mas o tamanho da
 *    resposta é fato observado, e uma estimativa em cima dele fica na ordem do
 *    custo que aconteceu, em vez de sete vezes acima dele. Ver
 *    `estimarCustoDaResposta`.
 *
 *  · ENTRADA — deduzida do tamanho do que sobe, pelas três faixas.
 *
 * O QUE ACONTECE QUANDO A ESTIMATIVA ERRA PARA BAIXO: a chamada acontece, a
 * liquidação grava o custo REAL, o dia fecha acima do teto e a PRÓXIMA chamada é
 * recusada. O teto é uma linha de parada, não um contrato financeiro: o estouro
 * possível é o excedente de UMA chamada sobre a própria estimativa — nunca um
 * dia inteiro.
 *
 * MODELO FORA DA TABELA DE PREÇO não vira "custo zero": vira `medivel: false`, e
 * o serviço RECUSA a chamada quando o teto está valendo. É a mesma regra de
 * `preco.ts`: número sem procedência não entra — e teto que não sabe medir não é
 * teto.
 */

/**
 * Texto corrido em alfabeto latino. Português e inglês dão ~3,5 a 4; usar 3
 * superestima o número de tokens, que é o lado seguro.
 */
export const CARACTERES_POR_TOKEN_TEXTO = 3;

/**
 * Conteúdo ESTRUTURADO — schema de ferramenta, argumento de chamada, bloco cru
 * devolvido pelo modelo. `{"a":1,"b":[2,3]}` vira quase um token por símbolo:
 * medido em amostras reais do catálogo, a razão fica entre 2 e 2,5.
 */
export const CARACTERES_POR_TOKEN_ESTRUTURADO = 2;

/**
 * O tamanho do que vai subir, separado por faixa — é o que a estimativa de
 * entrada consome.
 *
 * `foraDoAscii` conta caracteres JÁ contados em `texto`/`estruturado`: ele não
 * soma tamanho, ele CORRIGE a razão daqueles caracteres para perto de um token
 * cada (ver `estimarTokensDeEntrada`).
 */
export interface TamanhoDaEntrada {
  texto: number;
  estruturado: number;
  foraDoAscii: number;
}

export const ENTRADA_VAZIA: TamanhoDaEntrada = { texto: 0, estruturado: 0, foraDoAscii: 0 };

export interface EstimativaDeCusto {
  /** Custo estimado desta chamada, em dólar. Conservador, não limite superior. */
  usd: number;
  /** false ⇒ o modelo não está na tabela de preço: não há o que estimar. */
  medivel: boolean;
  tokensEntrada: number;
  tokensSaida: number;
}

/** Caracteres fora do ASCII. Par substituto conta dois — e isso é conservador. */
function foraDoAscii(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) n++;
  return n;
}

/** Texto corrido: conta o tamanho e quanto dele está fora do ASCII. */
export function tamanhoDeTexto(...partes: (string | null | undefined)[]): TamanhoDaEntrada {
  let texto = 0;
  let nao = 0;
  for (const p of partes) {
    if (!p) continue;
    texto += p.length;
    nao += foraDoAscii(p);
  }
  return { texto, estruturado: 0, foraDoAscii: nao };
}

/** Conteúdo estruturado (schema, args, bloco cru). Ciclo ou valor impróprio vira 0. */
export function tamanhoEstruturado(v: unknown): TamanhoDaEntrada {
  let s: string;
  try {
    s = JSON.stringify(v) ?? '';
  } catch {
    return ENTRADA_VAZIA;
  }
  return { texto: 0, estruturado: s.length, foraDoAscii: foraDoAscii(s) };
}

export function somarTamanhos(...partes: TamanhoDaEntrada[]): TamanhoDaEntrada {
  const total = { texto: 0, estruturado: 0, foraDoAscii: 0 };
  for (const p of partes) {
    total.texto += p.texto;
    total.estruturado += p.estruturado;
    total.foraDoAscii += p.foraDoAscii;
  }
  return total;
}

/**
 * Tokens de entrada, pelas três faixas.
 *
 * O caractere fora do ASCII já foi contado na faixa dele (a 1/3 ou a 1/2 de
 * token); aqui ele SOBE para perto de um token inteiro, que é a ordem do que os
 * tokenizadores fazem com CJK e com alfabetos não latinos. A complementação usa
 * a razão de texto mesmo quando o caractere veio do bloco estruturado: erra para
 * cima, que é o lado seguro, e evita ter de rastrear a origem de cada caractere.
 */
export function estimarTokensDeEntrada(t: TamanhoDaEntrada): number {
  const corrido = Math.ceil(Math.max(t.texto, 0) / CARACTERES_POR_TOKEN_TEXTO);
  const estruturado = Math.ceil(Math.max(t.estruturado, 0) / CARACTERES_POR_TOKEN_ESTRUTURADO);
  const complemento = Math.ceil(
    Math.max(t.foraDoAscii, 0) * (1 - 1 / CARACTERES_POR_TOKEN_TEXTO),
  );
  return corrido + estruturado + complemento;
}

/**
 * O custo estimado desta chamada.
 *
 * Preço de entrada CHEIO, sem desconto de cache: o desconto de leitura em cache
 * é de 10x, e assumi-lo seria assumir um acerto que só se confirma depois.
 */
export function estimarCustoUsd(
  modelo: string,
  chamada: { entrada: TamanhoDaEntrada; tokensSaida: number },
): EstimativaDeCusto {
  const p = precoDe(modelo);
  const tokensEntrada = estimarTokensDeEntrada(chamada.entrada);
  const tokensSaida = Math.max(Math.ceil(chamada.tokensSaida), 0);
  if (!p) return { usd: 0, medivel: false, tokensEntrada, tokensSaida };

  const total = (tokensEntrada * p.entrada + tokensSaida * p.saida) / 1_000_000;
  // Seis casas, como em `preco.ts`: uma pergunta barata custa ~0,0004 USD e não
  // pode virar zero no arredondamento.
  return { usd: Number(total.toFixed(6)), medivel: true, tokensEntrada, tokensSaida };
}

/**
 * O custo estimado DEPOIS da resposta, com o tamanho dela já conhecido.
 *
 * É o que `complete()` liquida. A reserva dele foi feita com `max_tokens`, que
 * para uma resposta de texto costuma ser umas sete vezes o que a chamada de fato
 * consome — gravar aquele número no livro-caixa cortaria a empresa com uma
 * fração do orçamento que ela realmente gastou. Aqui a saída é medida: o texto
 * voltou, e o tamanho dele é fato.
 */
export function estimarCustoDaResposta(
  modelo: string,
  chamada: { entrada: TamanhoDaEntrada; resposta: string },
): EstimativaDeCusto {
  return estimarCustoUsd(modelo, {
    entrada: chamada.entrada,
    tokensSaida: estimarTokensDeEntrada(tamanhoDeTexto(chamada.resposta)),
  });
}

/**
 * O tamanho do que vai subir numa conversa com ferramentas.
 *
 * OS ESQUEMAS DAS FERRAMENTAS ENTRAM. Eles sobem INTEIROS a cada passo — é a
 * definição de todas as capacidades que o agente declarou — e num agente com
 * catálogo grande são o maior bloco fixo da chamada, maior que o pedido. Deixá-
 * los de fora subestimava toda conversa com ferramenta, que é o caminho por onde
 * o agente gasta.
 *
 * Os turnos são percorridos em vez de a conversa ser serializada duas vezes: só
 * os blocos crus (`raw`) passam por `JSON.stringify`, porque é neles que mora o
 * pensamento devolvido pelo modelo, que conta como entrada na volta seguinte e
 * costuma ser a maior parte do payload.
 */
export function caracteresDaConversa(
  system: string,
  turns: readonly LlmTurn[],
  tools?: readonly LlmToolSpec[],
): TamanhoDaEntrada {
  const partes: TamanhoDaEntrada[] = [tamanhoDeTexto(system)];

  for (const f of tools ?? []) {
    partes.push(tamanhoDeTexto(f.name, f.description));
    partes.push(tamanhoEstruturado(f.inputSchema));
  }

  for (const t of turns) {
    if (t.role === 'user') {
      partes.push(tamanhoDeTexto(t.text));
      continue;
    }
    if (t.role === 'assistant') {
      partes.push(tamanhoDeTexto(t.text));
      if (t.raw !== undefined) partes.push(tamanhoEstruturado(t.raw));
      else {
        for (const c of t.toolCalls ?? []) {
          partes.push(tamanhoDeTexto(c.name));
          partes.push(tamanhoEstruturado(c.args));
        }
      }
      continue;
    }
    for (const r of t.results) partes.push(tamanhoDeTexto(r.content));
  }

  return somarTamanhos(...partes);
}
