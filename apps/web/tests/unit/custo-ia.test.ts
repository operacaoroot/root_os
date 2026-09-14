import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PREFIXOS_DA_ESPINHA } from '../../../api/src/tenants/modulos.js';
import {
  alertaDoTeto,
  atribuicaoPorAgente,
  diaCurto,
  fraseDoExcedente,
  NAO_MEDIDO,
  ROTA_DO_RELATORIO,
  rotuloUsd,
  TOM_DO_TETO,
  totalDaJanela,
  tudoSemPreco,
  usd,
  type DiaDeCusto,
  type RelatorioDeCustoIa,
} from '../../src/app/painel/custo-ia/calculo';

/* ==========================================================================
 * O CÁLCULO DO PAINEL DE CUSTO DE IA — fatia 6.4 (RF-B-03)
 * ==========================================================================
 *
 * O critério da fatia tem duas metades, e as duas são provadas aqui:
 *
 *   1. O NÚMERO NA TELA BATE COM A SOMA DOS CUSTOS REGISTRADOS — e "bater" está
 *      dito com o quê: a soma feita pela tela, linha a linha, contra o
 *      `SUM()`/`COUNT()` que o banco devolveu sobre AS MESMAS LINHAS, no MESMO
 *      instantâneo. São quatro campos, e não dois: comparar só dinheiro deixava
 *      passar contagem de chamadas inventada.
 *   2. O ALERTA DISPARA AO CRUZAR O PERCENTUAL CONFIGURADO DO TETO — e dispara
 *      sobre o COMPROMETIDO, que é a soma que a porta compara.
 *
 * E uma terceira, que é a razão de a fatia ter sido reprovada da primeira vez:
 *   3. QUANDO NÃO HÁ LIVRO-CAIXA, NÃO HÁ TOTAL. Somar um eixo vazio dá zero, e
 *      zero com selo de "conferido com o banco" é o desfecho mais caro que este
 *      painel pode entregar.
 *
 * Os controles negativos estão marcados. Cada um deles fica VERMELHO se a defesa
 * correspondente sair do código.
 * ========================================================================== */

/**
 * `Intl` separa o símbolo da moeda com espaço NÃO SEPARÁVEL, e o teste não é
 * sobre isso. Escrito por ponto de código de propósito: com o caractere literal
 * no regex, um editor que normalize o arquivo troca o U+00A0 por espaço comum e
 * a substituição para de acontecer — sem erro, com o teste vermelho num lugar
 * que não tem nada a ver com o defeito.
 *
 * São DOIS pontos de código: o ICU passou a usar U+202F (espaço estreito não
 * separável) para moeda em versões recentes.
 */
const semNbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

function dia(p: Partial<DiaDeCusto> & { dia: string }): DiaDeCusto {
  return {
    medidoUsd: 0,
    estimadoUsd: 0,
    reservadoUsd: 0,
    chamadas: 0,
    chamadasSemPreco: 0,
    cortes: 0,
    ...p,
  };
}

/**
 * Um relatório de mentira, mas coerente: a `conferencia` é somada a partir dos
 * dias, como o banco somaria, e o `livroCaixa` nasce do que existe em `porDia`.
 * Quem quiser provar divergência ou ausência sobrescreve de propósito.
 */
function relatorio(p: Partial<RelatorioDeCustoIa> = {}): RelatorioDeCustoIa {
  const porDia = p.porDia ?? [];
  const seis = (n: number) => Number(n.toFixed(6));
  const base: RelatorioDeCustoIa = {
    orgId: 'org-1',
    fusoHorario: 'America/Sao_Paulo',
    de: '2026-09-01',
    ate: '2026-09-03',
    dias: 3,
    teto: {
      configurado: true,
      ativo: true,
      tetoDiarioUsd: 25,
      percentualAlerta: 80,
      definidoEm: '2026-08-01T12:00:00.000Z',
      motivo: null,
    },
    hoje: null,
    porDia,
    porAgente: [],
    porAgenteEDia: [],
    livroCaixa: {
      linhas: porDia.length,
      tetoConfigurado: true,
      passosComCusto: 0,
      gastoDosPassosUsd: 0,
      totalConfiavel: true,
      motivo: null,
    },
    conferencia: {
      medidoUsd: seis(porDia.reduce((t, d) => t + d.medidoUsd, 0)),
      estimadoUsd: seis(porDia.reduce((t, d) => t + d.estimadoUsd, 0)),
      chamadas: porDia.reduce((t, d) => t + d.chamadas, 0),
      linhas: porDia.length,
    },
    atribuidoAAgenteUsd: 0,
    // fatia A3: o panorama de orçamento por agente. Vazio por padrão — quem
    // quiser medir o alerta de orçamento põe agente com valor de propósito.
    orcamentoDeAgentes: [],
    naoCoberto: [],
    geradoEm: '2026-09-03T18:00:00.000Z',
  };
  return {
    ...base,
    ...p,
    porDia,
    livroCaixa: p.livroCaixa ?? base.livroCaixa,
    conferencia: p.conferencia ?? base.conferencia,
  };
}

function hoje(p: Partial<NonNullable<RelatorioDeCustoIa['hoje']>> = {}) {
  const gasto = p.gastoUsd ?? 0;
  const estimado = p.gastoEstimadoUsd ?? 0;
  const reservado = p.reservadoUsd ?? 0;
  const arrasto = p.arrastoUsd ?? 0;
  const teto = p.tetoUsd ?? 25;
  const comprometido = p.comprometidoUsd ?? gasto + estimado + reservado + arrasto;
  return {
    dia: '2026-09-03',
    fusoHorario: 'America/Sao_Paulo',
    ativo: true,
    tetoUsd: teto,
    gastoUsd: gasto,
    gastoEstimadoUsd: estimado,
    reservadoUsd: reservado,
    arrastoUsd: arrasto,
    comprometidoUsd: comprometido,
    restanteUsd: Math.max(teto - comprometido, 0),
    chamadas: p.chamadas ?? 0,
    chamadasSemPreco: p.chamadasSemPreco ?? 0,
    cortes: p.cortes ?? 0,
    ...p,
  };
}

// ---------------------------------------------------------------------------
// 1. O TOTAL BATE — e com o quê
// ---------------------------------------------------------------------------

describe('o total da tela contra a soma que o banco devolveu', () => {
  const r = relatorio({
    porDia: [
      dia({ dia: '2026-09-01', medidoUsd: 1.234567, estimadoUsd: 0.5, chamadas: 12, cortes: 1 }),
      dia({ dia: '2026-09-02', medidoUsd: 0.000004, estimadoUsd: 0.25, chamadas: 3 }),
      dia({ dia: '2026-09-03', medidoUsd: 2, estimadoUsd: 0, chamadas: 8, chamadasSemPreco: 2 }),
    ],
  });

  it('soma linha a linha e confere com o SUM() do banco', () => {
    const t = totalDaJanela(r);
    expect(t.medidoUsd).toBe(3.234571);
    expect(t.medidoUsd).toBe(r.conferencia.medidoUsd);
    expect(t.confere).toBe(true);
    expect(t.divergenciaUsd).toBe(0);
    expect(t.divergencias).toEqual([]);
  });

  it('medido e estimado continuam separados — a soma dos dois tem nome próprio', () => {
    const t = totalDaJanela(r);
    expect(t.estimadoUsd).toBe(0.75);
    // o gasto é a soma; o "custo medido" não é, e nunca pode virar
    expect(t.gastoUsd).toBe(Number((3.234571 + 0.75).toFixed(6)));
    expect(t.medidoUsd).not.toBe(t.gastoUsd);
  });

  it('conta chamadas, chamadas sem preço e cortes sem misturar com dinheiro', () => {
    const t = totalDaJanela(r);
    expect(t.chamadas).toBe(23);
    expect(t.chamadasSemPreco).toBe(2);
    expect(t.cortes).toBe(1);
    expect(t.diasComGasto).toBe(3);
  });

  it('quando o dinheiro discorda, a tela NÃO escolhe um: ela acusa e diz qual', () => {
    const torto = relatorio({
      porDia: [dia({ dia: '2026-09-01', medidoUsd: 1, chamadas: 1 })],
      conferencia: { medidoUsd: 1.5, estimadoUsd: 0, chamadas: 1, linhas: 1 },
    });
    const t = totalDaJanela(torto);
    expect(t.confere).toBe(false);
    expect(t.divergenciaUsd).toBe(0.5);
    expect(t.divergencias.join(' ')).toContain('medido');
  });

  /*
   * CONTROLE NEGATIVO. A conferência tinha em mãos `chamadas` e `linhas` e não
   * olhava para nenhum dos dois: um payload com contagem absurda — dinheiro
   * certinho, 900 mil chamadas — passava com selo de conferido. Quem voltar a
   * comparar só dinheiro derruba os dois casos abaixo.
   */
  it('CONTROLE NEGATIVO: contagem de chamadas absurda NÃO passa na conferência', () => {
    const torto = relatorio({
      porDia: [dia({ dia: '2026-09-01', medidoUsd: 1, chamadas: 3 })],
      conferencia: { medidoUsd: 1, estimadoUsd: 0, chamadas: 900_000, linhas: 1 },
    });
    const t = totalDaJanela(torto);
    // o dinheiro bate dígito a dígito — é só ele que batia antes
    expect(t.medidoUsd).toBe(torto.conferencia.medidoUsd);
    expect(t.divergenciaUsd).toBe(0);
    expect(t.confere).toBe(false);
    expect(t.divergencias.join(' ')).toContain('chamadas');
  });

  it('CONTROLE NEGATIVO: linha que não chegou na tela NÃO passa na conferência', () => {
    const torto = relatorio({
      porDia: [dia({ dia: '2026-09-01', medidoUsd: 1, chamadas: 1 })],
      conferencia: { medidoUsd: 1, estimadoUsd: 0, chamadas: 1, linhas: 30 },
    });
    const t = totalDaJanela(torto);
    expect(t.confere).toBe(false);
    expect(t.divergencias.join(' ')).toContain('linhas');
  });

  it('janela vazia é zero conferido, não divergência', () => {
    const t = totalDaJanela(relatorio({ porDia: [] }));
    expect(t.medidoUsd).toBe(0);
    expect(t.confere).toBe(true);
    expect(t.diasComGasto).toBe(0);
    // e continua sendo total disponível: empresa parada é zero de verdade
    expect(t.disponivel).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. NÃO HÁ LIVRO-CAIXA ⇒ NÃO HÁ TOTAL
// ---------------------------------------------------------------------------

describe('o total é recusado quando o livro-caixa não foi escrito', () => {
  const semLivro = relatorio({
    porDia: [],
    livroCaixa: {
      linhas: 0,
      tetoConfigurado: false,
      passosComCusto: 412,
      gastoDosPassosUsd: 812.34,
      totalConfiavel: false,
      motivo: 'a empresa não tem teto configurado e o livro-caixa só é escrito para quem tem',
    },
  });

  /*
   * CONTROLE NEGATIVO — e é o caso que reprovou a fatia. Sem a recusa, a soma
   * de `porDia` dá zero, a conferência bate (zero contra zero) e o cartão grande
   * imprime "US$ 0,00 · conferido com o banco" enquanto a tabela por agente
   * mostra US$ 812,34 logo acima. Quem tirar `disponivel` derruba este caso.
   */
  it('CONTROLE NEGATIVO: zero conferido não vira total quando houve gasto', () => {
    const t = totalDaJanela(semLivro);
    expect(t.medidoUsd).toBe(0);
    expect(t.confere).toBe(true); // zero contra zero bate — e isso não basta
    expect(t.disponivel).toBe(false);
    expect(t.motivoIndisponivel).toContain('teto configurado');
  });

  it('a recusa não alcança empresa parada — zero de verdade continua sendo total', () => {
    const parada = relatorio({
      porDia: [],
      livroCaixa: {
        linhas: 0,
        tetoConfigurado: true,
        passosComCusto: 0,
        gastoDosPassosUsd: 0,
        totalConfiavel: true,
        motivo: null,
      },
    });
    expect(totalDaJanela(parada).disponivel).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. O ALERTA DE TETO
// ---------------------------------------------------------------------------

describe('o alerta dispara ao cruzar o percentual configurado', () => {
  it('abaixo do limiar não dispara', () => {
    const a = alertaDoTeto(relatorio({ hoje: hoje({ tetoUsd: 100, gastoUsd: 79.9 }) }));
    expect(a.percentual).toBe(79.9);
    expect(a.estado).toBe('ok');
    expect(a.disparou).toBe(false);
  });

  it('EXATAMENTE no limiar dispara — "cruzar" inclui encostar', () => {
    const a = alertaDoTeto(relatorio({ hoje: hoje({ tetoUsd: 100, gastoUsd: 80 }) }));
    expect(a.percentual).toBe(80);
    expect(a.estado).toBe('atencao');
    expect(a.disparou).toBe(true);
    expect(a.frase).toContain('alerta em 80%');
  });

  it('o limiar vem do relatório, não de um número escrito na tela', () => {
    const r = relatorio({ hoje: hoje({ tetoUsd: 100, gastoUsd: 55 }) });
    expect(alertaDoTeto(r).estado).toBe('ok');
    const comLimiarBaixo = { ...r, teto: { ...r.teto, percentualAlerta: 50 } };
    expect(alertaDoTeto(comLimiarBaixo).estado).toBe('atencao');
    expect(alertaDoTeto(comLimiarBaixo).limiar).toBe(50);
  });

  it('encostar no teto é estouro: a próxima chamada é recusada', () => {
    const a = alertaDoTeto(relatorio({ hoje: hoje({ tetoUsd: 25, gastoUsd: 25 }) }));
    expect(a.estado).toBe('estourado');
    expect(a.disparou).toBe(true);
    expect(a.frase).toContain('a próxima chamada é recusada');
    expect(TOM_DO_TETO[a.estado]).toBe('bad');
  });

  /*
   * O CONTROLE NEGATIVO.
   *
   * Aqui o gasto MEDIDO é 5 de um teto de 25 — 20%, verde em qualquer leitura
   * ingênua. O comprometido é 24, porque há estimativa, reserva em voo e
   * arrasto, e é contra o comprometido que a porta corta. Quem trocar a fonte do
   * alerta por `gastoUsd` derruba as duas afirmações abaixo.
   */
  it('CONTROLE NEGATIVO: alerta sobre o comprometido, não sobre o gasto medido', () => {
    const h = hoje({
      tetoUsd: 25,
      gastoUsd: 5,
      gastoEstimadoUsd: 9,
      reservadoUsd: 7,
      arrastoUsd: 3,
    });
    expect(h.comprometidoUsd).toBe(24);

    const a = alertaDoTeto(relatorio({ hoje: h }));
    expect(a.comprometidoUsd).toBe(24);
    expect(a.percentual).toBe(96);
    expect(a.estado).toBe('atencao');
    expect(a.disparou).toBe(true);

    // a leitura ingênua — a que o alerta NÃO pode usar
    const ingenuo = (h.gastoUsd / h.tetoUsd) * 100;
    expect(ingenuo).toBe(20);
    expect(ingenuo < a.limiar).toBe(true);
  });

  it('teto em observação continua alertando, e diz que não corta', () => {
    const a = alertaDoTeto(
      relatorio({
        teto: {
          configurado: true,
          ativo: false,
          tetoDiarioUsd: 25,
          percentualAlerta: 80,
          definidoEm: null,
          motivo: null,
        },
        hoje: { ...hoje({ tetoUsd: 25, gastoUsd: 24 }), ativo: false },
      }),
    );
    expect(a.disparou).toBe(true);
    expect(a.impoe).toBe(false);
    expect(a.frase).toContain('observação');
  });

  it('empresa sem teto não é empresa com teto zero — e a frase diz o que isso custa', () => {
    const semTeto = alertaDoTeto(
      relatorio({
        teto: {
          configurado: false,
          ativo: false,
          tetoDiarioUsd: null,
          percentualAlerta: 80,
          definidoEm: null,
          motivo: null,
        },
        hoje: null,
      }),
    );
    expect(semTeto.estado).toBe('sem-teto');
    expect(semTeto.percentual).toBeNull();
    expect(semTeto.disparou).toBe(false);
    // sem teto é também "sem livro-caixa" — é a causa da recusa do total
    expect(semTeto.frase).toContain('livro-caixa');

    const zerado = alertaDoTeto(relatorio({ hoje: hoje({ tetoUsd: 0, gastoUsd: 0 }) }));
    expect(zerado.estado).toBe('zerado');
    expect(zerado.disparou).toBe(true);
    // e nunca uma divisão por zero disfarçada de percentual
    expect(zerado.percentual).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. PROCEDÊNCIA: o que não foi medido nunca vira zero — linha E agregado
// ---------------------------------------------------------------------------

describe('o que não foi medido aparece como não medido', () => {
  it('valor não medível vira travessão, inclusive quando é zero', () => {
    expect(rotuloUsd(0, false)).toBe(NAO_MEDIDO);
    expect(rotuloUsd(1.23, false)).toBe(NAO_MEDIDO);
    expect(semNbsp(rotuloUsd(0, true))).toBe('US$ 0,00');
  });

  it('dia em que TODA chamada foi de modelo sem preço não é dia de custo zero', () => {
    expect(tudoSemPreco(dia({ dia: 'x', chamadas: 4, chamadasSemPreco: 4 }))).toBe(true);
    expect(tudoSemPreco(dia({ dia: 'x', chamadas: 4, chamadasSemPreco: 3 }))).toBe(false);
    // dia sem chamada nenhuma É zero medido — ninguém chamou o modelo
    expect(tudoSemPreco(dia({ dia: 'x', chamadas: 0, chamadasSemPreco: 0 }))).toBe(false);
  });

  /*
   * CONTROLE NEGATIVO. A regra era respeitada linha a linha e abandonada no
   * agregado: três dias inteiramente sem preço somavam zero e o cartão grande
   * imprimia "US$ 0,00 · conferido com o banco". Quem tirar `tudoSemPreco` de
   * `totalDaJanela` derruba este caso.
   */
  it('CONTROLE NEGATIVO: janela inteira sem preço não é janela de custo zero', () => {
    const t = totalDaJanela(
      relatorio({
        porDia: [
          dia({ dia: '2026-09-01', chamadas: 10, chamadasSemPreco: 10 }),
          dia({ dia: '2026-09-02', chamadas: 7, chamadasSemPreco: 7 }),
        ],
      }),
    );
    expect(t.medidoUsd).toBe(0);
    expect(t.chamadas).toBe(17);
    expect(t.tudoSemPreco).toBe(true);
    expect(rotuloUsd(t.medidoUsd, !t.tudoSemPreco)).toBe(NAO_MEDIDO);
  });

  it('uma única chamada com preço já devolve o agregado a dinheiro', () => {
    const t = totalDaJanela(
      relatorio({
        porDia: [dia({ dia: '2026-09-01', medidoUsd: 0.02, chamadas: 10, chamadasSemPreco: 9 })],
      }),
    );
    expect(t.tudoSemPreco).toBe(false);
    expect(semNbsp(rotuloUsd(t.medidoUsd, !t.tudoSemPreco))).toBe('US$ 0,02');
  });

  it('dólar, escrito em português, com casas extras só para valor de centavo', () => {
    expect(semNbsp(usd(3.8))).toBe('US$ 3,80');
    expect(semNbsp(usd(0.0004))).toBe('US$ 0,0004');
    expect(semNbsp(usd(1234.5))).toBe('US$ 1.234,50');
  });

  it('o rótulo do dia não passa por Date — ele já vem no fuso da empresa', () => {
    expect(diaCurto('2026-09-01')).toBe('01/09');
    expect(diaCurto('quebrado')).toBe('quebrado');
  });
});

// ---------------------------------------------------------------------------
// 5. A SOMA POR AGENTE NÃO É O TOTAL DA EMPRESA — E O RESÍDUO NÃO É `complete()`
// ---------------------------------------------------------------------------

describe('quanto do gasto tem dono', () => {
  it('o resíduo do medido que não casou com passo é "não atribuído", e tende a zero', () => {
    const r = relatorio({
      porDia: [dia({ dia: '2026-09-01', medidoUsd: 10, estimadoUsd: 34, chamadas: 20 })],
      atribuidoAAgenteUsd: 9.999,
    });
    const a = atribuicaoPorAgente(r);
    expect(a.medidoUsd).toBe(10);
    expect(a.atribuidoUsd).toBe(9.999);
    expect(a.naoAtribuidoUsd).toBe(0.001);
    expect(a.excedente).toBe(false);
  });

  /*
   * CONTROLE NEGATIVO do rodapé. O gasto do período é 44 (10 medido + 34
   * estimado) e o eixo por agente só alcança o medido. Um rodapé que somasse só
   * a coluna "medido" mostraria 22,7% do gasto e chamaria de total — foi o que o
   * revisor mediu. Quem tirar `estimadoUsd`/`gastoUsd` da atribuição derruba
   * este caso.
   */
  it('CONTROLE NEGATIVO: o estimado entra na tabela por agente, senão o total é 23% do gasto', () => {
    const r = relatorio({
      porDia: [dia({ dia: '2026-09-01', medidoUsd: 10, estimadoUsd: 34, chamadas: 20 })],
      atribuidoAAgenteUsd: 10,
    });
    const a = atribuicaoPorAgente(r);
    expect(a.estimadoUsd).toBe(34);
    expect(a.gastoUsd).toBe(44);
    // a leitura antiga — a que apresentava um quarto do gasto como total
    expect(Number(((a.medidoUsd / a.gastoUsd) * 100).toFixed(1))).toBe(22.7);
  });

  it('passos somando mais que o livro-caixa é acusado, não escondido', () => {
    const r = relatorio({
      porDia: [dia({ dia: '2026-09-01', medidoUsd: 1, chamadas: 2 })],
      atribuidoAAgenteUsd: 1.02,
    });
    const a = atribuicaoPorAgente(r);
    expect(a.excedente).toBe(true);
    // e o "não atribuído" não vira negativo na tela
    expect(a.naoAtribuidoUsd).toBe(0);
  });

  /*
   * CONTROLE NEGATIVO do diagnóstico. O aviso afirmava SEMPRE a mesma causa —
   * "é o caso de borda da virada do dia" — e, numa empresa sem livro-caixa, a
   * diferença é o gasto inteiro. Quem voltar a fixar a causa derruba os três
   * casos abaixo, porque eles pedem três frases diferentes.
   */
  it('CONTROLE NEGATIVO: a causa do excedente é diagnosticada, não afirmada', () => {
    const sobra = atribuicaoPorAgente(
      relatorio({
        porDia: [dia({ dia: '2026-09-01', medidoUsd: 100, chamadas: 50 })],
        atribuidoAAgenteUsd: 102,
      }),
    );
    expect(sobra.causa).toBe('virada-do-dia');
    expect(fraseDoExcedente(sobra)).toContain('virada do dia');

    const semLivro = atribuicaoPorAgente(
      relatorio({
        porDia: [],
        atribuidoAAgenteUsd: 812.34,
        livroCaixa: {
          linhas: 0,
          tetoConfigurado: false,
          passosComCusto: 412,
          gastoDosPassosUsd: 812.34,
          totalConfiavel: false,
          motivo: 'sem teto configurado',
        },
      }),
    );
    expect(semLivro.causa).toBe('livro-caixa-nao-escrito');
    expect(fraseDoExcedente(semLivro)).toContain('gasto inteiro');
    expect(fraseDoExcedente(semLivro)).not.toContain('virada do dia');

    const absurdo = atribuicaoPorAgente(
      relatorio({
        porDia: [dia({ dia: '2026-09-01', medidoUsd: 1, chamadas: 2 })],
        atribuidoAAgenteUsd: 90,
      }),
    );
    expect(absurdo.causa).toBe('inexplicado');
    expect(fraseDoExcedente(absurdo)).toContain('defeito');
  });

  it('sem excedente não há frase — a tela não inventa aviso', () => {
    const a = atribuicaoPorAgente(
      relatorio({ porDia: [dia({ dia: '2026-09-01', medidoUsd: 5, chamadas: 1 })] }),
    );
    expect(a.excedente).toBe(false);
    expect(a.causa).toBeNull();
    expect(fraseDoExcedente(a)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. O CONTRATO COM A API, A FAMÍLIA DE ROTA — E A ROTA EXISTIR DE VERDADE
// ---------------------------------------------------------------------------

describe('a tela e a API falam da mesma coisa', () => {
  const api = (p: string) => readFileSync(join(__dirname, '../../../api/', p), 'utf8');
  const fonteDaApi = api('src/llm/relatorio-custo.service.ts');
  /*
   * O `hoje` do relatório é `ConsumoDoDia`, e ele NÃO é declarado no serviço de
   * relatório: vem inteiro de quem corta. Procurar `comprometidoUsd` no arquivo
   * errado é o defeito que esta suíte já produziu uma vez — catraca que lê o
   * arquivo errado passa verde sem provar nada. Cada campo é conferido onde ele
   * de fato mora.
   */
  const fonteDoTeto = api('src/llm/teto-diario.service.ts');
  const fonteDoModulo = api('src/llm/llm.module.ts');
  const fonteDoControlador = api('src/dashboard/dashboard.controller.ts');
  const compose = readFileSync(join(__dirname, '../../../../docker-compose.yml'), 'utf8');

  it('a rota que a tela chama é a que o serviço declara', () => {
    expect(fonteDaApi).toContain(`CAMINHO_DO_RELATORIO = '${ROTA_DO_RELATORIO.slice(1)}'`);
  });

  /*
   * CONTROLE NEGATIVO da fatia inteira: SERVIÇO SEM MÓDULO E SEM ROTA É CÓDIGO
   * MORTO. Antes da correção, o relatório não estava declarado em módulo nenhum
   * e nenhuma rota o alcançava: a tela pedia `/dashboard/custo-ia`, a API
   * respondia 404 e o critério de pronto ("o número na tela bate com a soma dos
   * custos registrados") não tinha como ser atingido. Apagar qualquer uma das
   * três linhas abaixo do código derruba este caso.
   */
  it('CONTROLE NEGATIVO: o serviço está declarado no módulo e a rota está publicada', () => {
    expect(fonteDoModulo).toContain('RelatorioDeCustoIaService');
    expect(fonteDoModulo).toMatch(/exports:\s*\[[^\]]*RelatorioDeCustoIaService/);
    expect(fonteDoControlador).toContain("@Get('custo-ia')");
    expect(fonteDoControlador).toContain('RelatorioDeCustoIaService');
    expect(fonteDoControlador).toContain("@RequirePermissions('dashboard.ver')");
  });

  /*
   * O prefixo de rota precisa estar DECLARADO — `moduloDoCaminho` LANÇA para
   * prefixo desconhecido, e isso é falha em execução, não só teste vermelho.
   * `dashboard` é espinha do OS: custo de IA não é módulo de negócio que se
   * contrata à parte, e um painel de custo que some por contrato seria um
   * sistema que gasta sem quem olhe.
   */
  it('o prefixo da rota é espinha do OS, e está declarado', () => {
    expect(ROTA_DO_RELATORIO.split('/')[1]).toBe('dashboard');
    expect(PREFIXOS_DA_ESPINHA).toContain('dashboard');
  });

  it('todo campo do relatório existe no serviço que o monta', () => {
    const campos = [
      'fusoHorario',
      'porDia',
      'porAgente',
      'porAgenteEDia',
      'livroCaixa',
      'totalConfiavel',
      'passosComCusto',
      'conferencia',
      'atribuidoAAgenteUsd',
      'orcamentoDeAgentes',
      'naoCoberto',
      'percentualAlerta',
      'medidoUsd',
      'estimadoUsd',
      'reservadoUsd',
      'chamadasSemPreco',
      'passosNaoMedidos',
    ];
    expect(campos.filter((c) => !fonteDaApi.includes(c))).toEqual([]);
  });

  it('os campos de `hoje` existem em quem os produz — o serviço do teto', () => {
    const campos = ['comprometidoUsd', 'arrastoUsd', 'gastoEstimadoUsd', 'restanteUsd'];
    expect(campos.filter((c) => !fonteDoTeto.includes(c))).toEqual([]);
    // e o relatório entrega esse tipo sem recalcular nada — é o que faz a
    // pílula e a porta concordarem sobre o mesmo número
    expect(fonteDaApi).toContain("type ConsumoDoDia } from './teto-diario.service'");
    expect(fonteDaApi).toContain('hoje: ConsumoDoDia | null');
  });

  it('a conferência lê as duas fontes no mesmo instantâneo', () => {
    // Duas consultas soltas divergiriam a cada liquidação que caísse no meio, e
    // a tarja vermelha apareceria num sistema são.
    expect(fonteDaApi).toContain('RepeatableRead');
    expect(fonteDaApi).toMatch(/\$transaction\(/);
  });

  it('a API declara a vetorização como gasto que este painel NÃO mede', () => {
    expect(fonteDaApi).toContain('Vetorização (embeddings)');
    expect(fonteDaApi).toMatch(/NAO_COBERTO/);
  });

  /*
   * CONTROLE NEGATIVO da procedência. O painel imprimia "US$ 50 a 60 por mês"
   * como ordem de grandeza do embedding, com a procedência "medido fora deste
   * painel, na fatura do provedor" — e essa medição não existe em arquivo nenhum
   * do repositório. Num painel cuja única razão de existir é não deixar número
   * sem fonte, era invenção de dado financeiro. Quem puser de volta um valor em
   * dólar naquele campo derruba este caso.
   */
  it('CONTROLE NEGATIVO: `ordemDeGrandeza` não carrega valor em dólar sem medição', () => {
    const campos = [...fonteDaApi.matchAll(/ordemDeGrandeza:\s*'([^']*)'/g)].map((m) => m[1]);
    expect(campos.length).toBeGreaterThan(0);
    expect(campos.filter((c) => /US\$|\bUSD\b|\d/.test(c))).toEqual([]);
    expect(campos.every((c) => c === 'não medido')).toBe(true);
  });

  /*
   * O limiar é "configurável" — e só é de verdade se a variável chegar ao
   * container. O container não lê o `.env`: só chega o que está no bloco
   * `environment:`. Sem esta linha, o percentual em produção é a constante 80 e
   * a tela afirma que ele veio da configuração.
   */
  it('CONTROLE NEGATIVO: o limiar do alerta está no bloco de ambiente do compose', () => {
    expect(fonteDaApi).toContain('TETO_IA_ALERTA_PERCENT');
    expect(compose).toMatch(/^\s+TETO_IA_ALERTA_PERCENT:\s*\$\{TETO_IA_ALERTA_PERCENT:-80\}/m);
  });
});
