import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import baseRoot from '../../../../packages/policy/politica-root.json';
import deltaMktos from '../../../../packages/policy/politica-marketing-os.json';
import {
  lerDelta,
  lerPolitica,
  resolverPolitica,
  type Politica,
} from '../../../../packages/policy/src/index.js';
import {
  PedidoDeSimulacaoSchema,
  linhaDeLog,
  paraLog,
  simularAcao,
} from '../../../api/src/policy/simulador.js';
import {
  conferirJanela,
  esquecerAvisosDeJanela,
  janelaLegivel,
  minutosDoDia,
  problemasDeJanela,
} from '../../../api/src/policy/limites.js';

/*
 * O SIMULADOR DA TELA DA RÉGUA — fatia 2.3, RF-P-09.
 *
 * Três coisas são provadas aqui:
 *
 *  1. o operador submete uma ação hipotética e recebe NÍVEL, GATILHOS ACESOS e
 *     O QUE SERIA EXIGIDO dele;
 *  2. uma empresa com sobrescrita vê o resultado DELA, não o do catálogo base —
 *     nível, exigência e limites saem da política resolvida daquela empresa;
 *  3. simular não executa: o módulo que decide é puro, não importa Prisma nem
 *     Nest, e o serviço que o chama não passa pelo caminho que grava decisão.
 *
 * POR QUE ESTE TESTE MORA EM `apps/web/tests`
 * A suíte da API (`apps/api/test/`) é de outras fatias desta onda. O simulador é
 * um módulo PURO — é justamente essa pureza que permite testá-lo daqui, por
 * caminho relativo, sem subir Nest e sem banco. Se um dia ele passar a precisar
 * de injeção, este import quebra na hora, e isso é bom: seria o sinal de que a
 * garantia (3) se perdeu.
 *
 * E POR QUE ELE NÃO DEPENDE MAIS DE `pnpm build`
 * `simulador.ts` importa `@mktos/policy`, que o `package.json` do pacote resolve
 * para `dist/` — artefato ignorado pelo git. Num checkout limpo isto não
 * resolvia; com um `dist/` velho era pior, porque passava: media o MOTOR ANTIGO
 * contra um documento lido pelo esquema NOVO e dizia que estava tudo certo.
 * `apps/web/vitest.config.ts` agora aponta `@mktos/policy` (e `@mktos/shared`)
 * para o código-fonte, que é o mesmo atalho que a suíte da API já usava para
 * ler `nav.ts`.
 */

const RAIZ = join(__dirname, '..', '..', '..', '..');

/** A base que toda empresa herda: política da ROOT + delta deste repositório. */
const BASE: Politica = resolverPolitica(
  lerPolitica(baseRoot, 'politica-root.json'),
  lerDelta(deltaMktos, 'politica-marketing-os.json'),
);

/**
 * Uma empresa que sobrescreveu a régua herdada — é a fatia 2.1 em ação.
 *
 * Ela aperta `operacao.tarefa.alterar`: no catálogo da ROOT a tarefa é dado
 * interno e a alteração é R2 (reversível, sem saída externa); nesta empresa o
 * mesmo campo carrega dado RESTRITO, e o efeito muda junto com o nível — que é
 * o que `verificarCatalogo()` cobra de qualquer sobrescrita real. E encurta a
 * janela horária, que é limite dela e não da ROOT.
 */
const EMPRESA: Politica = resolverPolitica(
  BASE,
  lerDelta(
    {
      versao: '1.1.0-empresa',
      atualizadoEm: '2026-09-11',
      origem: 'sobrescrita da empresa de teste',
      descricao: 'tarefa carrega dado restrito nesta operação',
      estende: 'politica-marketing-os.json',
      limitesPadrao: { janelaHoraria: ['09:00', '12:00'] },
      capacidades: [
        {
          id: 'operacao.tarefa.alterar',
          ferramenta: 'tarefa_atualizar_status',
          rota: 'PATCH /tasks/:id',
          descricao: 'Altera o status de uma tarefa.',
          nivel: 'R4',
          desfazer: 'operacao.tarefa.alterar',
          efeito: {
            escreveForaDoOS: true,
            produzArtefato: false,
            reversibilidade: 'automatica',
            exposicaoExterna: false,
            impactoFinanceiro: 'nenhum',
            sensibilidade: 'restrita',
            destruicao: false,
            obrigacaoLegal: false,
          },
        },
      ],
    },
    'delta da empresa de teste',
  ),
);

describe('o operador descreve uma ação hipotética', () => {
  it('recebe nível, gatilhos acesos e o que seria exigido dele', () => {
    const r = simularAcao(BASE, {
      descricao: 'mandar o relatório fechado para o cliente',
      efeito: {
        escreveForaDoOS: true,
        exposicaoExterna: true,
        reversibilidade: 'nenhuma',
      },
    });

    // 1. o nível
    expect(r.nivel).toBe('R3');
    expect(r.acao.origem).toBe('descrita');
    expect(r.acao.rotulo).toBe('mandar o relatório fechado para o cliente');

    // 2. os gatilhos que acenderam, com o campo e para onde cada um leva
    const porCampo = Object.fromEntries(r.gatilhos.map((g) => [g.campo, g.elevaPara]));
    expect(porCampo.escreveForaDoOS).toBe('R2');
    expect(porCampo.exposicaoExterna).toBe('R3');
    expect(porCampo.reversibilidade).toBe('R3');
    // gatilho que NÃO acendeu não aparece
    expect(porCampo.destruicao).toBeUndefined();

    // 3. o que seria exigido
    const exigencias = Object.fromEntries(r.exigencias.map((e) => [e.chave, e.detalhe]));
    expect(r.exigeAprovacao).toBe(true);
    expect(exigencias.aprovacao).toContain('responsavel');
    expect(exigencias.aprovacao).toContain('presa ao conteúdo exato');
    expect(exigencias.rastro).toContain('aprovador');
    expect(r.rastro).toContain('hashConteudo');

    // e a honestidade: ação fora do catálogo não é autorização nenhuma
    expect(r.avisos.join(' ')).toContain('não existe no catálogo');
  });

  it('a tabela de gatilhos do documento e o motor da escada concordam', () => {
    // A conferência do simulador: se a tabela do documento normativo divergir
    // de `classificar()`, o resultado sai com aviso. Nenhuma capacidade do
    // catálogo pode produzir esse aviso.
    for (const c of BASE.capacidades) {
      const r = simularAcao(BASE, { capabilityId: c.id });
      expect(
        r.avisos.filter((a) => a.includes('tabela de gatilhos')),
        `capacidade ${c.id}`,
      ).toEqual([]);
    }
  });

  it('ação que não escreve fora do OS para em R0, sem exigência nenhuma', () => {
    const r = simularAcao(BASE, { efeito: {}, descricao: 'só consultar' });
    expect(r.nivel).toBe('R0');
    expect(r.exigeAprovacao).toBe(false);
    expect(r.gatilhos).toHaveLength(1);
    expect(r.gatilhos[0].texto).toContain('não escreve fora do OS');
  });
});

describe('a ação escolhida do catálogo, com o momento dela', () => {
  it('um sinal aceso sobe exatamente um degrau e a exigência acompanha', () => {
    const normal = simularAcao(BASE, { capabilityId: 'email.enviar' });
    expect(normal.nivel).toBe('R3');
    expect(normal.exigeReautenticacao).toBe(false);

    const comSinal = simularAcao(BASE, {
      capabilityId: 'email.enviar',
      sinais: ['destinatario_novo'],
    });
    expect(comSinal.nivelBase).toBe('R3');
    expect(comSinal.nivel).toBe('R4');
    expect(comSinal.sinais.map((s) => s.id)).toEqual(['destinatario_novo']);
    expect(comSinal.exigeReautenticacao).toBe(true);
    expect(comSinal.exigeMotivo).toBe(true);
    expect(comSinal.exigencias.map((e) => e.chave)).toEqual(
      expect.arrayContaining(['reautenticacao', 'motivo']),
    );
  });

  it('o horário é conferido contra a janela da empresa, e o sinal sai como calculado', () => {
    const dentro = simularAcao(BASE, { capabilityId: 'email.enviar', horario: '10:00' });
    expect(dentro.sinais).toEqual([]);

    const fora = simularAcao(BASE, { capabilityId: 'email.enviar', horario: '23:30' });
    const sinal = fora.sinais.find((s) => s.id === 'fora_da_janela');
    expect(sinal?.origem).toBe('calculado');
    expect(sinal?.porque).toContain('08:00');
    expect(fora.nivel).toBe('R4');
  });

  it('o instante é lido no fuso de São Paulo, com a mesma conta da porta (MD3)', () => {
    const em = (momento: string) => simularAcao(BASE, { capabilityId: 'email.enviar', momento });

    // 21:00 UTC são 18h em SP: dentro da janela, qualquer que seja o TZ de quem roda.
    const tarde = em('2026-09-01T21:00:00Z');
    expect(tarde.sinais).toEqual([]);
    expect(tarde.relogio).toEqual({ fuso: 'America/Sao_Paulo', horario: '18:00' });

    const sinal = em('2026-09-01T23:30:00Z').sinais.find((s) => s.id === 'fora_da_janela');
    expect(sinal?.origem).toBe('calculado');
    expect(sinal?.porque).toContain('20:30 (America/Sao_Paulo)');

    const cedo = em('2026-09-01T10:30:00Z');
    expect(cedo.sinais.map((s) => s.id)).toContain('fora_da_janela');
    expect(cedo.relogio.horario).toBe('07:30');

    // o HH:MM digitado já é hora de parede de SP, e volta como veio
    const digitado = simularAcao(BASE, { capabilityId: 'email.enviar', horario: '10:00' });
    expect(digitado.relogio.horario).toBe('10:00');
    expect(simularAcao(BASE, { capabilityId: 'email.enviar' }).relogio.horario).toBeNull();
  });

  it('o pedido aceita horário, instante OU agora, e o instante precisa ser ISO', () => {
    const aceita = (extra: Record<string, unknown>) =>
      PedidoDeSimulacaoSchema.safeParse({ capabilityId: 'email.enviar', ...extra }).success;
    expect(aceita({ momento: '2026-09-01T21:00:00Z' })).toBe(true);
    expect(aceita({ momento: '2026-09-01T18:00:00-03:00' })).toBe(true);
    expect(aceita({ momento: 'agora' })).toBe(false);
    expect(aceita({ horario: '10:00', momento: '2026-09-01T21:00:00Z' })).toBe(false);
    expect(aceita({ agora: true })).toBe(true);
    expect(aceita({ agora: false })).toBe(false);
    expect(aceita({ agora: true, horario: '10:00' })).toBe(false);
    expect(aceita({ agora: true, momento: '2026-09-01T21:00:00Z' })).toBe(false);
  });

  it('"agora" é o relógio de quem simula, o servidor, lido uma vez só (MD3)', () => {
    // O navegador não manda hora: se mandasse, um relógio 10 min adiantado
    // veria 20:05 e R4 enquanto a porta, no mesmo instante, daria 19:55.
    let leituras = 0;
    const relogioDoServidor = () => {
      leituras += 1;
      return new Date('2026-09-01T22:55:00Z'); // 19:55 em SP
    };
    const r = simularAcao(
      BASE,
      { capabilityId: 'email.enviar', agora: true },
      'America/Sao_Paulo',
      relogioDoServidor,
    );
    expect(leituras).toBe(1);
    expect(r.relogio).toEqual({ fuso: 'America/Sao_Paulo', horario: '19:55' });
    expect(r.sinais).toEqual([]);

    const tarde = simularAcao(BASE, { capabilityId: 'email.enviar', agora: true }, undefined, () =>
      new Date('2026-09-01T23:05:00Z'),
    );
    expect(tarde.relogio.horario).toBe('20:05');
    expect(tarde.sinais.map((s) => s.id)).toContain('fora_da_janela');

    // sem `agora`, o relógio nem é consultado
    leituras = 0;
    simularAcao(BASE, { capabilityId: 'email.enviar', horario: '10:00' }, undefined, relogioDoServidor);
    expect(leituras).toBe(0);
  });

  it('janela horária ilegível acende o sinal — falha fechada', () => {
    const quebrada: Politica = {
      ...BASE,
      limitesPadrao: { ...BASE.limitesPadrao, janelaHoraria: ['oito', 'oito da noite'] },
    };
    const r = simularAcao(quebrada, { capabilityId: 'email.enviar', horario: '10:00' });
    expect(r.sinais.map((s) => s.id)).toContain('fora_da_janela');
  });

  it('procedência externa entra como sinal declarado e de mão única', () => {
    const r = simularAcao(BASE, {
      capabilityId: 'crm.lead.alterar',
      procedenciaExterna: true,
    });
    const sinal = r.sinais.find((s) => s.id === 'fonte_nao_confiavel');
    expect(sinal?.origem).toBe('declarado');
    expect(sinal?.maoUnica).toBe(true);
    expect(r.nivelBase).toBe('R2');
    expect(r.nivel).toBe('R3');
  });

  it('capacidade fora do catálogo volta bloqueada em R5 — falha fechada', () => {
    const r = simularAcao(BASE, { capabilityId: 'inventada.que.nao.existe' });
    expect(r.nivel).toBe('R5');
    expect(r.permitido).toBe(false);
    expect(r.acao.origem).toBe('desconhecida');
    expect(r.exigencias.map((e) => e.chave)).toContain('bloqueado');
    expect(r.avisos.join(' ')).toContain('invariante 2');
  });

  it('em R2 a aprovação é configurável, e desligá-la aparece na exigência', () => {
    const ligada = simularAcao(BASE, { capabilityId: 'operacao.tarefa.alterar' });
    expect(ligada.nivel).toBe('R2');
    expect(ligada.exigeAprovacao).toBe(true);

    const desligada = simularAcao(BASE, {
      capabilityId: 'operacao.tarefa.alterar',
      aprovacaoR2Ligada: false,
    });
    expect(desligada.exigeAprovacao).toBe(false);
    expect(desligada.exigencias.find((e) => e.chave === 'aprovacao')?.titulo).toContain(
      'desligada',
    );
  });
});

describe('a empresa com sobrescrita vê o resultado DELA', () => {
  it('a mesma ação dá nível diferente na base e na política da empresa', () => {
    const naBase = simularAcao(BASE, { capabilityId: 'operacao.tarefa.alterar' });
    const naEmpresa = simularAcao(EMPRESA, { capabilityId: 'operacao.tarefa.alterar' });

    expect(naBase.nivel).toBe('R2');
    expect(naEmpresa.nivel).toBe('R4');
    // não é só o rótulo: a exigência muda junto
    expect(naBase.exigeReautenticacao).toBe(false);
    expect(naEmpresa.exigeReautenticacao).toBe(true);
    expect(naEmpresa.exigeMotivo).toBe(true);
    expect(naEmpresa.aprovacao.alcadaMinima).toBe('titular');
  });

  it('o gatilho que acendeu é o da sobrescrita, e aparece com o valor dela', () => {
    const naEmpresa = simularAcao(EMPRESA, { capabilityId: 'operacao.tarefa.alterar' });
    const sensibilidade = naEmpresa.gatilhos.find((g) => g.campo === 'sensibilidade');
    expect(sensibilidade).toMatchObject({ valor: 'restrita', elevaPara: 'R4' });

    const naBase = BASE.capacidades.find((c) => c.id === 'operacao.tarefa.alterar');
    expect(naBase?.efeito.sensibilidade).toBe('interna');
  });

  it('a janela horária conferida é a da empresa, não a da base', () => {
    const pedido = { capabilityId: 'email.enviar', horario: '13:00' } as const;

    expect(simularAcao(BASE, pedido).sinais).toEqual([]);

    const naEmpresa = simularAcao(EMPRESA, pedido);
    const sinal = naEmpresa.sinais.find((s) => s.id === 'fora_da_janela');
    expect(sinal?.origem).toBe('calculado');
    expect(sinal?.porque).toContain('09:00');
    expect(sinal?.porque).toContain('12:00');
  });

  it('o resultado carrega a procedência da régua usada', () => {
    expect(simularAcao(EMPRESA, { capabilityId: 'email.enviar' }).politica.versao).toBe(
      '1.1.0-empresa',
    );
    expect(simularAcao(BASE, { capabilityId: 'email.enviar' }).politica.versao).toBe(
      BASE.versao,
    );
  });

  it('o que a empresa não sobrescreveu continua herdado', () => {
    expect(simularAcao(EMPRESA, { capabilityId: 'email.enviar' }).nivel).toBe(
      simularAcao(BASE, { capabilityId: 'email.enviar' }).nivel,
    );
  });
});

describe('simular não é executar', () => {
  /*
   * Lê o CÓDIGO, sem os comentários: os dois arquivos falam do que NÃO fazem, e
   * uma catraca que casse por causa da explicação obrigaria a apagar justamente
   * a parte que ensina a regra.
   */
  const fonte = (caminho: string) =>
    readFileSync(join(RAIZ, caminho), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

  it('os módulos que decidem são puros: sem Nest, sem Prisma, sem rede', () => {
    for (const arquivo of ['apps/api/src/policy/simulador.ts', 'apps/api/src/policy/limites.ts']) {
      const src = fonte(arquivo);
      for (const proibido of ['@nestjs', 'prisma', 'Prisma', 'fetch(', 'axios']) {
        expect(src, `${arquivo} não pode conhecer "${proibido}"`).not.toContain(proibido);
      }
    }
  });

  /*
   * A CATRACA PROCURA NOMES, e por isso a lista precisa cobrir o que o serviço
   * TEM EM MÃOS — não só o que ele chamava quando o teste foi escrito.
   * `ReguaService` recebe `PrismaService` injetado (ele lê agentes e pessoas),
   * então uma linha `this.prisma.policyDecision.create(...)` dentro de
   * `simular()` passaria por uma lista que só vigiasse `avaliarERegistrar`.
   * Aqui entra todo verbo de escrita do cliente do banco. Ler (`findMany`,
   * `findFirst`, `count`) continua liberado: o painel é leitura.
   */
  it('a rota do simulador não passa pelo caminho que grava decisão nem cria aprovação', () => {
    const src = fonte('apps/api/src/policy/regua.service.ts');
    for (const proibido of [
      'avaliarERegistrar', // é ele que grava PolicyDecision
      'policyDecision',
      'approval',
      'eventLog',
      'registrar(',
      // escrita direta pelo cliente do banco, que o serviço já tem injetado
      '.create(',
      '.createMany(',
      '.update(',
      '.updateMany(',
      '.upsert(',
      '.delete(',
      '.deleteMany(',
      '$executeRaw',
      '$queryRaw',
      '$transaction',
    ]) {
      expect(src, `regua.service.ts não pode chamar "${proibido}"`).not.toContain(proibido);
    }
    // e o que ele FAZ de registro é declaradamente consulta
    expect(src).toContain('linhaDeLog(');
  });

  it('a simulação não altera o documento de política que recebeu', () => {
    const antes = JSON.stringify(EMPRESA);
    simularAcao(EMPRESA, {
      capabilityId: 'operacao.tarefa.alterar',
      sinais: ['erro_recente'],
      procedenciaExterna: true,
      horario: '23:00',
      valorCentavos: 999_999,
    });
    expect(JSON.stringify(EMPRESA)).toBe(antes);
  });
});

/* ---------------------------------------------------------------- limites -- */

/*
 * A JANELA HORÁRIA — a mudança silenciosa que deixou de ser silenciosa.
 *
 * O leitor novo é mais estrito que o antigo: `'8h'`, `'25:00'` e `'10:70'`
 * passavam e agora não passam. Isso importa porque janela ilegível ACENDE o
 * sinal (falha fechada), e o sinal aceso sobe um degrau em TODA ação daquela
 * empresa. As três peças abaixo são o que impede a mudança de acontecer calada.
 */
describe('a janela horária, quando é ilegível', () => {
  beforeEach(() => esquecerAvisosDeJanela());

  it('reconhece horário e recusa o que não é', () => {
    expect(minutosDoDia('08:00')).toBe(480);
    expect(minutosDoDia('8:05')).toBe(485);
    expect(minutosDoDia('23:59')).toBe(1439);
    for (const ruim of ['8h', 'oito', '', '24:00', '10:70', '08:0', '08:000']) {
      expect(Number.isNaN(minutosDoDia(ruim)), `"${ruim}" não é horário`).toBe(true);
    }
    expect(janelaLegivel(['08:00', '20:00'])).toBe(true);
    expect(janelaLegivel(['8h', 'oito da noite'])).toBe(false);
  });

  it('a sobrescrita é recusada com o formato na mensagem — e a boa passa', () => {
    expect(problemasDeJanela(['08:00', '20:00'])).toEqual([]);

    const problemas = problemasDeJanela(['8h', '20:00']);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain('janelaHoraria');
    expect(problemas[0]).toContain('HH:MM');
    expect(problemas[0]).toContain('8h');
    // e diz o estrago, para ninguém achar que é preciosismo de formato
    expect(problemas[0]).toContain('fora_da_janela');

    // os dois lados errados dão dois problemas: quem corrige vê os dois
    expect(problemasDeJanela(['8h', 'oito'])).toHaveLength(2);
  });

  it('o log avisa UMA vez por empresa, e não a cada chamada', () => {
    const ditos: string[] = [];
    const avisar = (m: string) => ditos.push(m);

    expect(conferirJanela('org-a', ['08:00', '20:00'], avisar)).toBe(true);
    expect(ditos).toEqual([]);

    expect(conferirJanela('org-a', ['8h', 'oito'], avisar)).toBe(false);
    conferirJanela('org-a', ['8h', 'oito'], avisar);
    conferirJanela('org-a', ['8h', 'oito'], avisar);
    expect(ditos, 'o caminho quente roda a cada chamada: avisar sempre afoga o log').toHaveLength(
      1,
    );
    expect(ditos[0]).toContain('org-a');
    expect(ditos[0]).toContain('fora_da_janela');

    // outra empresa é outro aviso: o problema é por documento, não global
    conferirJanela('org-b', ['x', 'y'], avisar);
    expect(ditos).toHaveLength(2);
    expect(ditos[1]).toContain('org-b');
  });
});

/* ------------------------------------------------------- a linha de log ---- */

/*
 * O rótulo da simulação vem do corpo da requisição. Sem sanitizar, quem chama
 * a rota escreve uma linha inteira no log — com carimbo, nível e tudo — e ela
 * fica lá parecendo registro do sistema.
 */
describe('a simulação não escreve linha falsa no log', () => {
  it('quebra de linha no rótulo não vira linha nova', () => {
    const forjada = 'ok\n2026-09-11 ERROR [ToolGateway] efeito executado: email.enviar';
    const saida = paraLog(forjada);
    expect(saida).not.toContain('\n');
    expect(saida).not.toContain('\r');
    expect(saida.startsWith('"')).toBe(true);
    // o texto continua legível, só deixou de poder fingir ser outra linha
    expect(saida).toContain('efeito executado');
  });

  it('corta o rótulo gigante e neutraliza aspas e escape de terminal', () => {
    expect(paraLog('a'.repeat(500))).toHaveLength(120 + 3); // aspas + reticências
    expect(paraLog('diz "oi"')).toBe(`"diz 'oi'"`);
    // O escape ANSI some: rótulo colorido reescreveria a leitura do log num
    // terminal, inclusive apagando o que veio antes dele na linha.
    const ESC = String.fromCharCode(27);
    const limpo = paraLog(`${ESC}[31mvermelho${ESC}[0m`);
    expect(limpo).not.toContain(ESC);
    expect(limpo).toContain('vermelho');
  });

  it('a linha do simulador se declara consulta e carrega o que investigar', () => {
    const r = simularAcao(BASE, { capabilityId: 'email.enviar', sinais: ['destinatario_novo'] });
    const linha = linhaDeLog('org-1', 'u-9', r);

    expect(linha).toContain('CONSULTA (simulação, nada executado)');
    expect(linha).toContain('org-1');
    expect(linha).toContain('u-9');
    expect(linha).toContain('R4');
    expect(linha).toContain('destinatario_novo');
    expect(linha.split('\n')).toHaveLength(1);
  });

  it('o rótulo forjado chega ao log já desarmado', () => {
    const r = simularAcao(BASE, {
      efeito: {},
      descricao: 'x\nCONSULTA (simulação, nada executado) — empresa outra',
    });
    const linha = linhaDeLog('org-1', undefined, r);
    // O marcador aparece duas vezes de propósito: a nossa, no começo, e a
    // forjada, que ficou PRESA dentro das aspas do rótulo. O que não existe é
    // uma segunda LINHA — e é a linha, não a palavra, que o leitor de log conta.
    expect(linha.split('\n')).toHaveLength(1);
    expect(linha.startsWith('CONSULTA (simulação, nada executado) —')).toBe(true);
    expect(linha).toContain('"x CONSULTA');
  });
});
