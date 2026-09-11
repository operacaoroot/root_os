/**
 * DESLIGAR UM CONECTOR, POR EMPRESA, EM SEGUNDOS — RF-G-06 (fatia 3.7)
 * ====================================================================
 *
 * O que esta suíte cobra, na ordem em que a fatia pede:
 *
 *   1. desligar o Google de uma empresa faz a próxima chamada de ferramenta do
 *      Google ser RECUSADA COM MOTIVO, e a recusa fica no RASTRO;
 *   2. a empresa VIZINHA não sente nada;
 *   3. o conector VIZINHO da mesma empresa não sente nada;
 *   4. RELIGAR volta a funcionar SEM NOVA AUTORIZAÇÃO — a credencial nunca foi
 *      tocada;
 *   5. o efeito vale na PRÓXIMA CHAMADA, inclusive numa instância que nunca
 *      soube do desligamento (é o teste que prova que não há cache nem
 *      necessidade de recriar container).
 *
 * DUAS SEÇÕES. A primeira é pura — o mapa capacidade → conector, interrogado
 * contra o catálogo de política inteiro, sem banco e sem Nest. A segunda precisa
 * de TEST_DATABASE_URL e se pula sozinha sem ele (mesma convenção de
 * `porta.test.ts`).
 *
 * COMO RODAR A PARTE DE BANCO:
 *   DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     npx prisma migrate deploy
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     npx vitest run test/conector-desligado.test.ts
 *
 * POR QUE NÃO SOBE O NEST. Nada que dependa de injeção funciona sob vitest (o
 * esbuild não emite `emitDecoratorMetadata`). Os serviços são construídos à mão,
 * como em `porta.test.ts` — o que se mede aqui é a decisão e a escrita, não a
 * fiação do módulo.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  CHAVES_DE_CONECTOR,
  CODIGO_CONECTOR_DESLIGADO,
  CONECTORES_COM_RECUSA_LIGADA,
  CONECTOR_DA_CAPACIDADE,
  ConectorDesconhecidoError,
  GRUPOS_DE_CONECTOR,
  ROTULO_CONECTOR_DESLIGADO,
  SEM_INTERRUPTOR,
  TEXTO_DA_APLICACAO,
  aplicacaoDoDesligamento,
  conectorDaCapacidade,
  corpoDaRecusa,
  expandirAlvo,
  grupoDoConector,
  montarRecusa,
} from '../src/integrations/conectores';
import {
  ConectorDesligadoError,
  ConectoresService,
  EmpresaDivergenteError,
} from '../src/integrations/conectores.service';
import { ClickupService } from '../src/integrations/clickup.service';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { SemTenantError, comContexto } from '../src/common/contexto-execucao';
import { exigirBancoDescartavel } from './banco-de-teste';

// ---------------------------------------------------------------------------
// SEÇÃO 1 — O MAPA (sem banco)
// ---------------------------------------------------------------------------

/** A raiz do monorepo, achada por um marco em vez de caminho relativo ao cwd. */
function acharRaizDoRepo(): string {
  const marco = path.join('packages', 'policy', 'politica-marketing-os.json');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, marco))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`não achei a raiz do repositório a partir de ${process.cwd()}`);
}

interface CapacidadeDoCatalogo {
  id: string;
  nivel: string;
  rota?: string | null;
  ferramenta?: string | null;
}

function lerCatalogo(nome: string): CapacidadeDoCatalogo[] {
  const arquivo = path.join(acharRaizDoRepo(), 'packages', 'policy', nome);
  const json = JSON.parse(readFileSync(arquivo, 'utf8')) as { capacidades: CapacidadeDoCatalogo[] };
  return json.capacidades;
}

/*
 * O CATÁLOGO QUE VALE É A UNIÃO — e é aqui que a primeira versão errou.
 *
 * `politica-marketing-os.json` é um DELTA sobre `politica-root.json`: quem
 * decide em execução é `resolverPolitica(base, delta)`, e o que ela devolve são
 * as 16 da base MAIS as 51 do delta, com os ids repetidos sobrescritos — 60.
 *
 * A catraca lia só o delta. As nove que só existem na base ficavam sem decisão
 * declarada e, como capacidade desconhecida devolve `null` (ver
 * `conectorDaCapacidade`), NUNCA seriam bloqueáveis — com a suíte verde. Entre
 * elas: emitir nota fiscal, baixar pagamento, excluir registro e criar tarefa no
 * ClickUp, que é justamente o único conector com recusa ligada hoje.
 *
 * A união é montada AQUI, à mão e com a mesma regra do `resolverPolitica`, em
 * vez de importada do pacote de política: ler os dois JSON é o que garante que a
 * catraca continue medindo o ARQUIVO, e não uma versão já resolvida em memória
 * que poderia estar filtrada por outro caminho.
 */
function capacidadesDoCatalogo(): CapacidadeDoCatalogo[] {
  const porId = new Map<string, CapacidadeDoCatalogo>();
  for (const c of lerCatalogo('politica-root.json')) porId.set(c.id, c);
  for (const c of lerCatalogo('politica-marketing-os.json')) porId.set(c.id, c);
  return [...porId.values()];
}

describe('o mapa capacidade → conector', () => {
  /*
   * A CATRACA. Ela é o motivo de o mapa ser escrito à mão em vez de deduzido da
   * rota: capacidade nova sem decisão declarada reprova aqui, em vez de virar um
   * conector que o desligamento não reconhece e que segue mandando coisa para
   * fora depois de alguém ter mandado parar.
   */
  it('a união do catálogo é o que a catraca mede — 16 da base + 53 do delta, 7 repetidos', () => {
    // Trava a FONTE, não só o resultado: se alguém voltar a ler só o delta, o
    // número cai para o do delta e este caso avisa antes de as nove sumirem
    // de novo.
    expect(lerCatalogo('politica-root.json')).toHaveLength(16);
    expect(lerCatalogo('politica-marketing-os.json')).toHaveLength(53);
    expect(capacidadesDoCatalogo()).toHaveLength(62);
    const soNaBase = lerCatalogo('politica-root.json')
      .map((c) => c.id)
      .filter((id) => !lerCatalogo('politica-marketing-os.json').some((d) => d.id === id));
    expect(soNaBase).toHaveLength(9);
    // As quatro que o revisor nomeou: todas passaram a ter decisão declarada.
    for (const id of [
      'nfe.emitir',
      'omie.pagamento.baixar',
      'registro.excluir',
      'clickup.tarefa.criar',
    ]) {
      expect(soNaBase, `${id} deveria vir só da base`).toContain(id);
      expect(
        id in CONECTOR_DA_CAPACIDADE || SEM_INTERRUPTOR.has(id),
        `${id} sem decisão declarada`,
      ).toBe(true);
    }
  });

  it('toda capacidade do catálogo tem entrada declarada, em exatamente uma lista', () => {
    const semEntrada = capacidadesDoCatalogo()
      .filter((c) => !(c.id in CONECTOR_DA_CAPACIDADE) && !SEM_INTERRUPTOR.has(c.id))
      .map((c) => `${c.id} (${c.rota ?? 'sem rota'})`);

    expect(
      semEntrada,
      '\nCAPACIDADE SEM DECISÃO DE CONECTOR:\n' +
        semEntrada.map((c) => `  - ${c}`).join('\n') +
        '\n\n  Toda capacidade precisa dizer se sai da casa e por qual conector.\n' +
        '  Conserto: acrescente a entrada em `CONECTOR_DA_CAPACIDADE`\n' +
        '  (src/integrations/conectores.ts). `null` = não sai da casa, e é a\n' +
        '  resposta certa para leitura do próprio banco do OS. Sai da casa por\n' +
        '  conector que não existe no catálogo? Entra em `SEM_INTERRUPTOR`, com\n' +
        '  o motivo por escrito.\n',
    ).toEqual([]);

    // Em UMA lista, nunca nas duas: `null` no mapa e uma entrada no
    // `SEM_INTERRUPTOR` diriam coisas opostas sobre a mesma capacidade.
    const nasDuas = [...SEM_INTERRUPTOR.keys()].filter((id) => id in CONECTOR_DA_CAPACIDADE);
    expect(nasDuas, `declaradas duas vezes: ${nasDuas.join(', ')}`).toEqual([]);
  });

  it('o ALCANCE do interruptor é medido, não estimado — 17 capacidades saem da casa', () => {
    /*
     * QUANTAS CAPACIDADES O INTERRUPTOR DE FATO ALCANÇA.
     *
     * O número importa por causa da FALHA FECHADA. `ConectoresService` recusa a
     * responder quando não consegue provar que a leitura enxerga a linha certa
     * (contexto de execução ausente ou em outra empresa), e a porta transforma
     * isso em recusa. Um comentário dizendo que "toda ferramenta de agente para"
     * seria largo: `recusaDe` devolve `null` ANTES de tocar no contexto quando a
     * capacidade não tem conector, então as que não saem da casa passam
     * incólumes por um `comContexto` esquecido.
     *
     * Este caso trava a conta para o comentário não envelhecer sozinho — ver a
     * nota "O ALCANCE DESSA FALHA FECHADA" em
     * `src/gateway/tool-gateway.service.ts`.
     */
    const comConector = Object.entries(CONECTOR_DA_CAPACIDADE).filter(([, c]) => c !== null);
    expect(comConector).toHaveLength(17);
    expect(capacidadesDoCatalogo()).toHaveLength(62);

    // E `conectorDaCapacidade` concorda com o mapa, para os dois lados: o que
    // está declarado `null` e o que está em `SEM_INTERRUPTOR` devolve `null`.
    for (const [id] of comConector) expect(conectorDaCapacidade(id)).not.toBeNull();
    for (const id of SEM_INTERRUPTOR.keys()) expect(conectorDaCapacidade(id)).toBeNull();
  });

  it('a lista não tem entrada morta — e olha para a MESMA fonte da catraca', () => {
    /*
     * O CASO IRMÃO. Ele e o de cima têm de ler o mesmo catálogo, senão um deles
     * mente: com a fonte errada (só o delta), acrescentar as nove ao mapa
     * deixaria ESTE caso vermelho por engano, acusando de "morta" uma entrada
     * que a execução usa todo dia. Os dois só consertam juntos.
     */
    const doCatalogo = new Set(capacidadesDoCatalogo().map((c) => c.id));
    const fantasmas = [
      ...Object.keys(CONECTOR_DA_CAPACIDADE),
      ...SEM_INTERRUPTOR.keys(),
    ].filter((id) => !doCatalogo.has(id));
    expect(
      fantasmas,
      `\nEntrada de conector para capacidade que não existe mais: ${fantasmas.join(', ')}.\n`,
    ).toEqual([]);
  });

  it('nada em SEM_INTERRUPTOR está implementado neste produto', () => {
    /*
     * A CATRACA DO TERCEIRO ESTADO — e a razão de ele custar zero hoje.
     *
     * `SEM_INTERRUPTOR` é uma lista de capacidades que SAEM DA CASA e que
     * nenhum interruptor alcança. Isso só é aceitável enquanto nenhuma delas
     * for alcançável: sem `rota` e sem `ferramenta`, nem tela nem agente as
     * chama. No dia em que alguém implementar uma, este caso fica vermelho e
     * obriga a retomar a decisão — acrescentar a linha do conector em
     * `CONNECTORS` e mover a capacidade para `CONECTOR_DA_CAPACIDADE`.
     *
     * R5 É EXCEÇÃO, e não por conveniência: o OS NUNCA executa R5 — prepara e
     * encaminha a uma pessoa (`avaliar` devolve `permitido: false`). A régua
     * recusa antes de qualquer efeito, o que é uma trava mais forte, e mais
     * acima, do que o interruptor de conector. É o caso de
     * `financeiro.pagamento.baixar`, que tem ferramenta de propósito: ela existe
     * justamente para provar que a régua recusa antes de existir efeito.
     */
    const porId = new Map(capacidadesDoCatalogo().map((c) => [c.id, c]));
    const implementadas = [...SEM_INTERRUPTOR.keys()]
      .map((id) => porId.get(id))
      .filter(
        (c): c is CapacidadeDoCatalogo =>
          !!c && Boolean(c.rota || c.ferramenta) && c.nivel !== 'R5',
      )
      .map((c) => `${c.id} ${c.nivel} (${c.rota ?? c.ferramenta})`);

    expect(
      implementadas,
      '\nCAPACIDADE ABAIXO DE R5 QUE SAI DA CASA, GANHOU IMPLEMENTAÇÃO\n' +
        'E NENHUM INTERRUPTOR ALCANÇA:\n' +
        implementadas.map((c) => `  - ${c}`).join('\n') +
        '\n\n  Conserto: crie a linha do conector em packages/shared/src/schemas.ts\n' +
        '  (CONNECTORS) e mova a capacidade para `CONECTOR_DA_CAPACIDADE`.\n',
    ).toEqual([]);
  });

  it('todo motivo de SEM_INTERRUPTOR é uma frase, não um rótulo', () => {
    // O valor do mapa é o que a próxima pessoa lê para decidir. Vazio ou de uma
    // palavra não explica nada e a lista vira um `null` com outro nome.
    for (const [id, motivo] of SEM_INTERRUPTOR) {
      expect(motivo.length, `${id} sem motivo escrito`).toBeGreaterThan(40);
    }
  });

  it('todo conector citado no mapa existe no catálogo de conectores', () => {
    const inventados = [...new Set(Object.values(CONECTOR_DA_CAPACIDADE))]
      .filter((c): c is string => !!c)
      .filter((c) => !CHAVES_DE_CONECTOR.has(c));
    expect(inventados).toEqual([]);
  });

  it('as quatro superfícies do Google são um grupo só', () => {
    expect(expandirAlvo('google').sort()).toEqual(['drive', 'gcal', 'gdocs', 'gmail']);
    expect(expandirAlvo('gmail')).toEqual(['gmail']);
    expect(grupoDoConector('gdocs')).toBe('google');
    expect(grupoDoConector('clickup')).toBeNull();
    expect(GRUPOS_DE_CONECTOR.google).toHaveLength(4);
  });

  it('alvo desconhecido é erro de entrada, não 500', () => {
    expect(() => expandirAlvo('gogle')).toThrow(ConectorDesconhecidoError);
    // A mensagem lista o que existe: quem erra a chave está a uma letra de acertar.
    expect(() => expandirAlvo('gogle')).toThrow(/gmail/);
  });

  it('capacidade que não sai da casa não tem conector', () => {
    expect(conectorDaCapacidade('numeros.painel.ler')).toBeNull();
    expect(conectorDaCapacidade('financeiro.dre.ler')).toBeNull();
    // Espelho do ClickUp lido do banco é local; quem ESCREVE lá é que é conector.
    expect(conectorDaCapacidade('pecas.conteudo.listar')).toBeNull();
    expect(conectorDaCapacidade('clickup.tarefa.alterar')).toBe('clickup');
  });

  it('a rota que administra conector NÃO é bloqueável — senão desligar tranca a porta por dentro', () => {
    expect(conectorDaCapacidade('credencial.rotacionar')).toBeNull();
    // O próprio interruptor pelo mesmo motivo: se ele se recusasse, desligar o
    // ClickUp impediria de religar o ClickUp e a saída seria banco na mão.
    expect(conectorDaCapacidade('conector.desligar')).toBeNull();
    expect(conectorDaCapacidade('conector.religar')).toBeNull();
  });

  /*
   * ==========================================================================
   * O QUE A TELA PODE PROMETER — a correção do achado GRAVE nº 1
   * ==========================================================================
   * A primeira versão oferecia o interruptor nas dezesseis linhas e o aviso do
   * topo afirmava que toda ferramenta do conector era recusada com motivo e
   * ficava no rastro. Era verdade para UMA. Os casos abaixo prendem a promessa
   * ao código que a cumpre.
   *
   * COM O GANCHO DA PORTA (estabilização da onda 6) a promessa passou a valer
   * para as dezesseis no caminho do agente, e é isso que estes casos cobram
   * agora. O que continua fora é o caminho HTTP direto, e a catraca disso é a
   * frase — ver o cabeçalho de `CONECTORES_COM_RECUSA_LIGADA`.
   */
  it('a recusa está ligada para TODO conector do catálogo, não só para o ClickUp', () => {
    expect(CONECTORES_COM_RECUSA_LIGADA).toBe(CHAVES_DE_CONECTOR);

    // O WhatsApp era o caso que mais doía: é a única escrita externa de verdade
    // ligada hoje, e desligá-lo NÃO a barrava. Agora barra.
    expect(aplicacaoDoDesligamento('whatsapp')).toBe('recusa');
    for (const chave of ['clickup', 'gmail', 'gcal', 'gdocs', 'drive', 'instagram', 'obsidian']) {
      expect(aplicacaoDoDesligamento(chave), chave).toBe('recusa');
    }
  });

  it('toda chave do catálogo tem uma frase, e a frase diz a verdade daquela chave', () => {
    for (const chave of CHAVES_DE_CONECTOR) {
      const texto = TEXTO_DA_APLICACAO[aplicacaoDoDesligamento(chave)];
      expect(texto, chave).toBeTruthy();
    }
    // A frase de quem só registra NÃO pode afirmar que a chamada é barrada. Ela
    // ficou sem nenhuma chave quando o gancho entrou, e continua escrita para o
    // caso de alguma voltar — ver o comentário em `TEXTO_DA_APLICACAO`.
    expect(TEXTO_DA_APLICACAO.registro).toContain('ainda NÃO barra a chamada');
    expect(TEXTO_DA_APLICACAO.registro).toContain('REGISTRA a decisão');
    expect(TEXTO_DA_APLICACAO.recusa).toContain('recusa a chamada');
    // E a de quem recusa tem de dizer que a trava vale nos DOIS momentos: na
    // proposta e na hora de soltar o que já estava aprovado.
    expect(TEXTO_DA_APLICACAO.recusa).toContain('já estava aprovada');
  });

  it('todo conector com recusa ligada existe no catálogo de conectores', () => {
    for (const chave of CONECTORES_COM_RECUSA_LIGADA) {
      expect(CHAVES_DE_CONECTOR.has(chave), chave).toBe(true);
    }
  });

  it('o motivo é legível, em português, e diz que a credencial continua guardada', () => {
    /*
     * A DATA É CONSTRUÍDA EM HORA LOCAL, e isto não é detalhe de estilo.
     *
     * `dataLegivel` formata com `getDate`/`getHours`, isto é, no fuso da
     * máquina — correto, porque quem lê a frase é um operador brasileiro. A
     * primeira versão do caso escrevia `new Date('2026-09-11T14:32:00-03:00')`
     * e cobrava "11/09/2026": 17:32 UTC, que em qualquer fuso a leste de +07
     * já é dia 12. A suíte ficava vermelha por causa do relógio de quem roda,
     * não do código. `new Date(ano, mês, dia, ...)` monta a data NO FUSO LOCAL,
     * então a formatação devolve exatamente estes componentes em toda máquina.
     */
    const r = montarRecusa({
      conector: 'gmail',
      capabilityId: 'email.enviar',
      desligadoEm: new Date(2026, 8, 11, 14, 32, 0),
      desligadoPor: 'pedro',
      motivoDoDesligamento: 'suspeita de vazamento de token',
    });
    expect(r.motivo).toContain('Gmail');
    expect(r.motivo).toContain('11/09/2026 14:32');
    expect(r.motivo).toContain('suspeita de vazamento de token');
    expect(r.motivo).toContain('Nada foi enviado');
    expect(r.motivo).toContain('sem nova autorização');
    // O rótulo é ESTÁVEL: é por ele que o relatório agrupa, então não pode
    // carregar o nome do conector nem a data.
    expect(r.rotulo).toBe(ROTULO_CONECTOR_DESLIGADO);
    expect(r.rotulo).not.toContain('Gmail');
  });

  it('sem motivo escrito, a frase continua completa', () => {
    const r = montarRecusa({
      conector: 'clickup',
      capabilityId: null,
      desligadoEm: new Date(2026, 8, 11, 9, 5, 0),
      desligadoPor: null,
      motivoDoDesligamento: null,
    });
    expect(r.motivo).toContain('ClickUp');
    expect(r.motivo).not.toContain('Motivo registrado');
  });

  /*
   * O CORPO DO 403 — o terceiro destinatário da recusa.
   *
   * `motivo` é para a pessoa, `rotulo` é para o relatório agrupar, e o CÓDIGO é
   * para a TELA: é por ele que o painel distingue esta recusa das outras e
   * oferece o caminho de conserto (Conexões) em vez de mais uma caixa vermelha.
   * O caso trava as três coisas ao mesmo tempo porque foi a divergência entre
   * elas que criou a necessidade: casar por substring da frase em português
   * quebraria na primeira reescrita do texto, em silêncio.
   *
   * `message` continua sendo a frase: é dela que o Nest tira o `Error.message`
   * (conferido na versão instalada), então quem já conferia a mensagem — as
   * suítes e o script de terminal — não muda de comportamento.
   */
  it('o corpo do 403 leva o código estável, e a frase continua em message', () => {
    const r = montarRecusa({
      conector: 'gmail',
      capabilityId: 'email.enviar',
      desligadoEm: new Date(2026, 8, 11, 14, 32, 0),
      desligadoPor: 'pedro',
      motivoDoDesligamento: null,
    });
    const corpo = corpoDaRecusa(r);

    expect(corpo.statusCode).toBe(403);
    expect(corpo.error).toBe(CODIGO_CONECTOR_DESLIGADO);
    expect(corpo.message).toBe(r.motivo);
    expect(corpo.conector).toBe('gmail');
    expect(corpo.rotuloDoConector).toBe('Gmail');

    // O código é um IDENTIFICADOR, não uma frase: nada de espaço, acento ou
    // maiúscula. A tela do web repete este valor à mão (o pacote compartilhado
    // não expõe nada da porta), e um valor com espaço convidaria a alguém a
    // "melhorá-lo" de um lado só.
    expect(CODIGO_CONECTOR_DESLIGADO).toBe('conector_desligado');
    expect(CODIGO_CONECTOR_DESLIGADO).toMatch(/^[a-z_]+$/);
    // E não se confunde com o rótulo de agrupamento, que é prosa.
    expect(CODIGO_CONECTOR_DESLIGADO).not.toBe(ROTULO_CONECTOR_DESLIGADO);
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 2 — O DESLIGAMENTO DE VERDADE (precisa de banco)
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
const ORG_A = 'org-teste-conector-a';
const ORG_B = 'org-teste-conector-b';

exigirBancoDescartavel(URL ?? '', 'cria empresas, credenciais falsas e desligamentos');

/*
 * O CONTEXTO DE EXECUÇÃO, EM VOLTA DE TODA CHAMADA — e por que os casos mudaram.
 *
 * `ConectoresService` passou a EXIGIR que a empresa do argumento seja a mesma da
 * execução em curso. Não é zelo: sob isolamento por linha, a policy recorta
 * `ConectorDesligado` pela empresa da SESSÃO do banco, e uma leitura com a
 * empresa errada não erra — devolve vazio. Vazio, no desenho ingênuo, quer dizer
 * "conector ligado". Um botão de emergência não pode ter "não consegui ler" como
 * sinônimo de "liberado".
 *
 * A consequência para a suíte é que os casos deixaram de chamar o serviço "no
 * ar" e passaram a abrir o escopo, como a aplicação faz — o que também deixa
 * estes casos mais parecidos com o caminho real do que eram antes.
 */
const naEmpresa = <T>(orgId: string, fn: () => Promise<T>): Promise<T> =>
  comContexto({ orgId, correlationId: `teste-${orgId}`, origem: 'script' }, fn);

describe.skipIf(!URL)('desligar um conector, por empresa', () => {
  let prisma: PrismaClient;
  let conectores: ConectoresService;
  /** Uma SEGUNDA instância, que nunca soube de desligamento nenhum: é ela que
   *  prova que o efeito não depende de invalidar cache em quem atendeu o clique
   *  (leia: outra réplica do container). */
  let outraInstancia: ConectoresService;

  /** O token do Google da empresa A, como estava antes de qualquer coisa. */
  let credencialAntes: { accessToken: string; refreshToken: string | null; connectedAt: Date };

  const limparDesligamentos = () =>
    prisma.conectorDesligado.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });

  /*
   * A MARCA D'ÁGUA DO RASTRO.
   *
   * `EventLog` é append-only: o `beforeEach` não pode apagá-lo como apaga as
   * outras tabelas, e os casos rodam em sequência no mesmo banco. Sem uma marca,
   * o caso que confere "desligar e religar entram no rastro" leria também os
   * eventos dos doze casos anteriores. Guardar o `seq` do momento e consultar só
   * o que veio DEPOIS é o jeito de medir este caso sem desligar a garantia que a
   * fatia 3.5 existe para manter.
   */
  let marca = 0n;
  const marcarRastro = async () => {
    const ultimo = await prisma.eventLog.findFirst({
      where: { orgId: ORG_A },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    marca = ultimo?.seq ?? 0n;
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();

    for (const [id, slug] of [
      [ORG_A, 'teste-conector-a'],
      [ORG_B, 'teste-conector-b'],
    ]) {
      await prisma.org.upsert({
        where: { id },
        create: { id, name: `Empresa ${slug}`, slug },
        update: {},
      });
    }

    // A CREDENCIAL. Ela existe para o teste poder afirmar, no fim, que ninguém
    // a tocou — é isso que sustenta "religar não pede autorização de novo".
    await prisma.googleAccount.upsert({
      where: { orgId: ORG_A },
      create: {
        orgId: ORG_A,
        email: 'conta@teste.local',
        accessToken: 'token-de-teste-que-ninguem-pode-mexer',
        refreshToken: 'refresh-de-teste',
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      },
      update: { accessToken: 'token-de-teste-que-ninguem-pode-mexer' },
    });
    await prisma.integrationAccount.deleteMany({ where: { orgId: ORG_A, key: 'clickup' } });
    await prisma.integrationAccount.create({
      data: { orgId: ORG_A, key: 'clickup', label: 'ClickUp', status: 'connected' },
    });

    const g = await prisma.googleAccount.findUniqueOrThrow({
      where: { orgId: ORG_A },
      select: { accessToken: true, refreshToken: true, connectedAt: true },
    });
    credencialAntes = g;

    const p = prisma as unknown as PrismaService;
    conectores = new ConectoresService(p, new AuditService(p), new EventLogService(p));
    outraInstancia = new ConectoresService(p, new AuditService(p), new EventLogService(p));
  });

  afterAll(async () => {
    // O RASTRO é append-only de verdade — a RULE de DELETE vale para o teste
    // também. Desligar explicitamente é o preço da garantia ser real.
    await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete');
    await prisma.eventLog.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete');
    await prisma.auditLog.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await limparDesligamentos();
    await prisma.googleAccount.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    // A saúde ANTES da conta: `IntegrationHealth` tem FK para
    // `IntegrationAccount`, e o último caso faz o ClickUp marcar saúde da
    // empresa B ao falhar na rede.
    await prisma.integrationHealth.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.integrationAccount.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.org.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await limparDesligamentos();
    await prisma.auditLog.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await marcarRastro();
  });

  it('com tudo ligado, a ferramenta do Google passa', async () => {
    expect(await naEmpresa(ORG_A, () => conectores.recusaDe({ orgId: ORG_A, capabilityId: 'email.enviar' }))).toBeNull();
  });

  it('desligar o Google recusa a próxima chamada de ferramenta do Google, com motivo', async () => {
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', {
      motivo: 'suspeita de vazamento de token',
      actorId: 'pedro',
    }));

    const recusa = await naEmpresa(ORG_A, () =>
      conectores.verificar({ orgId: ORG_A, capabilityId: 'email.enviar' }),
    );
    expect(recusa).not.toBeNull();
    expect(recusa!.conector).toBe('gmail');
    expect(recusa!.motivo).toContain('Gmail');
    expect(recusa!.motivo).toContain('suspeita de vazamento de token');
    expect(recusa!.rotulo).toBe(ROTULO_CONECTOR_DESLIGADO);

    // As outras três superfícies do Google caem junto — é uma credencial só.
    for (const cap of ['agenda.evento.criar', 'documento.criar', 'contexto.arquivo.listar']) {
      expect(await naEmpresa(ORG_A, () => conectores.recusaDe({ orgId: ORG_A, capabilityId: cap }))).not.toBeNull();
    }
  });

  it('recusar é NÃO CHAMAR: o efeito embrulhado não roda', async () => {
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { actorId: 'pedro' }));

    let chamou = false;
    await expect(
      naEmpresa(ORG_A, () =>
        conectores.envolver('gmail', ORG_A, async () => {
          chamou = true;
          return 'mandou';
        }),
      ),
    ).rejects.toBeInstanceOf(ConectorDesligadoError);
    expect(chamou).toBe(false);
  });

  it('a recusa é de política e fica no rastro, com o motivo', async () => {
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { motivo: 'auditoria em curso', actorId: 'pedro' }));
    const antes = await prisma.eventLog.count({ where: { orgId: ORG_A, tipo: 'conector.recusado' } });

    await naEmpresa(ORG_A, () =>
      conectores.verificar({
        orgId: ORG_A,
        capabilityId: 'email.enviar',
        correlationId: 'sess-teste-1',
        actorId: 'agente-teste',
        agentSlug: 'assistente',
      }),
    );

    const eventos = await prisma.eventLog.findMany({
      where: { orgId: ORG_A, tipo: 'conector.recusado' },
      orderBy: { seq: 'desc' },
      take: 1,
    });
    expect(
      await prisma.eventLog.count({ where: { orgId: ORG_A, tipo: 'conector.recusado' } }),
    ).toBe(antes + 1);

    const payload = eventos[0].payload as Record<string, unknown>;
    expect(eventos[0].capabilityId).toBe('email.enviar');
    expect(eventos[0].correlationId).toBe('sess-teste-1');
    expect(payload.conector).toBe('gmail');
    expect(payload.motivoDoDesligamento).toBe('auditoria em curso');
    expect(String(payload.motivo)).toContain('Gmail');
  });

  it('a empresa vizinha não sente nada', async () => {
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { actorId: 'pedro' }));

    expect(await naEmpresa(ORG_B, () => conectores.recusaDe({ orgId: ORG_B, capabilityId: 'email.enviar' }))).toBeNull();
    await expect(
      naEmpresa(ORG_B, () => conectores.envolver('gmail', ORG_B, async () => 'mandou')),
    ).resolves.toBe('mandou');
    expect(await prisma.eventLog.count({ where: { orgId: ORG_B, tipo: 'conector.recusado' } })).toBe(0);
  });

  it('o conector vizinho da mesma empresa não sente nada', async () => {
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { actorId: 'pedro' }));

    expect(
      await naEmpresa(ORG_A, () => conectores.recusaDe({ orgId: ORG_A, capabilityId: 'clickup.tarefa.alterar' })),
    ).toBeNull();
    expect(
      await naEmpresa(ORG_A, () => conectores.recusaDe({ orgId: ORG_A, capabilityId: 'whatsapp.mensagem.enviar' })),
    ).toBeNull();
    expect(
      await naEmpresa(ORG_A, () => conectores.recusaDe({ orgId: ORG_A, capabilityId: 'contexto.memoria.buscar' })),
    ).toBeNull();
  });

  it('desligar NÃO apaga credencial nem desconecta a integração', async () => {
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { motivo: 'teste', actorId: 'pedro' }));

    const g = await prisma.googleAccount.findUniqueOrThrow({
      where: { orgId: ORG_A },
      select: { accessToken: true, refreshToken: true, connectedAt: true },
    });
    expect(g).toEqual(credencialAntes);

    const ia = await prisma.integrationAccount.findFirstOrThrow({
      where: { orgId: ORG_A, key: 'clickup' },
      select: { status: true, config: true },
    });
    expect(ia.status).toBe('connected');
    expect(ia.config).toBeNull();
  });

  it('religar volta a funcionar SEM NOVA AUTORIZAÇÃO', async () => {
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { motivo: 'incidente', actorId: 'pedro' }));
    expect(await naEmpresa(ORG_A, () => conectores.recusaDe({ orgId: ORG_A, capabilityId: 'email.enviar' }))).not.toBeNull();

    const r = await naEmpresa(ORG_A, () => conectores.religar(ORG_A, 'google', { actorId: 'pedro' }));
    expect(r.efetivados).toEqual(['drive', 'gcal', 'gdocs', 'gmail']);

    expect(await naEmpresa(ORG_A, () => conectores.recusaDe({ orgId: ORG_A, capabilityId: 'email.enviar' }))).toBeNull();
    await expect(
      naEmpresa(ORG_A, () => conectores.envolver('gmail', ORG_A, async () => 'mandou')),
    ).resolves.toBe('mandou');

    // O QUE FAZ ISSO SER "SEM NOVA AUTORIZAÇÃO": o token é o MESMO de antes do
    // desligamento. Se religar exigisse OAuth, esta linha seria a que falharia.
    const g = await prisma.googleAccount.findUniqueOrThrow({
      where: { orgId: ORG_A },
      select: { accessToken: true, refreshToken: true, connectedAt: true },
    });
    expect(g).toEqual(credencialAntes);
  });

  it('o efeito vale na PRÓXIMA CHAMADA, inclusive em instância que nunca soube do desligamento', async () => {
    // A outra instância já perguntou uma vez e viu "ligado": se houvesse cache,
    // é esta resposta que ficaria guardada.
    expect(await naEmpresa(ORG_A, () => outraInstancia.recusaDe({ orgId: ORG_A, capabilityId: 'email.enviar' }))).toBeNull();

    const t0 = Date.now();
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { actorId: 'pedro' }));
    const recusa = await naEmpresa(ORG_A, () => outraInstancia.recusaDe({ orgId: ORG_A, capabilityId: 'email.enviar' }));
    const levou = Date.now() - t0;

    expect(recusa).not.toBeNull();
    // "Em segundos" com folga: o desligamento vale na consulta seguinte. O teto
    // generoso aqui é para não ficar sensível a máquina lenta — o que se prova é
    // que NÃO existe janela de cache, não a latência do Postgres.
    expect(levou).toBeLessThan(2000);

    // E o caminho de volta também é imediato, na outra instância.
    await naEmpresa(ORG_A, () => conectores.religar(ORG_A, 'google', { actorId: 'pedro' }));
    expect(await naEmpresa(ORG_A, () => outraInstancia.recusaDe({ orgId: ORG_A, capabilityId: 'email.enviar' }))).toBeNull();
  });

  it('desligar de novo não move o "desde quando"', async () => {
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'gmail', { motivo: 'primeiro', actorId: 'pedro' }));
    const primeira = await prisma.conectorDesligado.findUniqueOrThrow({
      where: { orgId_conector: { orgId: ORG_A, conector: 'gmail' } },
      select: { desligadoEm: true, motivo: true },
    });

    const r = await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { motivo: 'segundo', actorId: 'ana' }));
    // O gmail já estava desligado; só as outras três nasceram agora.
    expect(r.efetivados).toEqual(['drive', 'gcal', 'gdocs']);

    const depois = await prisma.conectorDesligado.findUniqueOrThrow({
      where: { orgId_conector: { orgId: ORG_A, conector: 'gmail' } },
      select: { desligadoEm: true, motivo: true },
    });
    expect(depois.desligadoEm.toISOString()).toBe(primeira.desligadoEm.toISOString());
    expect(depois.motivo).toBe('primeiro');
  });

  it('desligar e religar entram no rastro e na auditoria', async () => {
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { motivo: 'incidente', actorId: 'pedro' }));
    await naEmpresa(ORG_A, () => conectores.religar(ORG_A, 'google', { actorId: 'pedro' }));

    const tipos = await prisma.eventLog.findMany({
      where: {
        orgId: ORG_A,
        seq: { gt: marca },
        tipo: { in: ['conector.desligado', 'conector.religado'] },
      },
      orderBy: { seq: 'asc' },
      select: { tipo: true, actorId: true, payload: true },
    });
    expect(tipos.map((t) => t.tipo)).toEqual(['conector.desligado', 'conector.religado']);
    expect(tipos[0].actorId).toBe('pedro');
    expect((tipos[0].payload as Record<string, unknown>).motivo).toBe('incidente');

    const auditoria = await prisma.auditLog.findMany({
      where: { orgId: ORG_A, action: { in: ['conector.desligado', 'conector.religado'] } },
      select: { action: true, entityId: true },
    });
    expect(auditoria).toHaveLength(2);
    expect(auditoria.every((a) => a.entityId === 'google')).toBe(true);
  });

  it('a tela recebe o estado de verdade, com motivo e data', async () => {
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { motivo: 'incidente', actorId: 'pedro' }));
    const lista = await naEmpresa(ORG_A, () => conectores.listar(ORG_A));
    expect(lista.map((l) => l.conector)).toEqual(['drive', 'gcal', 'gdocs', 'gmail']);
    expect(lista[0].grupo).toBe('google');
    expect(lista[0].motivo).toBe('incidente');
    expect(lista[0].desligadoPor).toBe('pedro');
    expect(new Date(lista[0].desligadoEm).getTime()).toBeGreaterThan(0);

    expect(await naEmpresa(ORG_B, () => conectores.listar(ORG_B))).toEqual([]);
  });

  it('a tela recebe também O QUE o desligamento faz em cada linha', async () => {
    /*
     * A CORREÇÃO DO ACHADO GRAVE Nº 1, do lado do dado.
     *
     * A tela oferecia o interruptor nas dezesseis linhas e afirmava, no aviso do
     * topo, que toda ferramenta do conector era recusada com motivo. Só o
     * ClickUp era. Agora cada linha carrega `aplicacao`, e o texto da tela é
     * montado a partir dele — o componente não tem como voltar a prometer o que
     * o código não cumpre, porque não é ele que decide a frase.
     *
     * COM O GANCHO DA PORTA as quatro superfícies do Google viraram `recusa`
     * junto com o resto, e este caso é o que prova que a virada chegou à TELA
     * sem ninguém tocar em componente nenhum: o dado vem do mesmo lugar de onde
     * vem a decisão.
     */
    await naEmpresa(ORG_A, () =>
      conectores.desligar(ORG_A, 'clickup', { motivo: 'conta suspensa', actorId: 'pedro' }),
    );
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { actorId: 'pedro' }));

    const porChave = new Map(
      (await naEmpresa(ORG_A, () => conectores.listar(ORG_A))).map((l) => [l.conector, l]),
    );
    for (const chave of ['clickup', 'gmail', 'gcal', 'gdocs', 'drive']) {
      expect(porChave.get(chave)!.aplicacao, chave).toBe('recusa');
    }
  });

  /*
   * ==========================================================================
   * O INTERRUPTOR FALHA FECHADO — correção do achado nº 3
   * ==========================================================================
   * Sob isolamento por linha, perguntar pela empresa A com a sessão do banco na
   * empresa B não devolve erro: devolve VAZIO. E vazio, antes, queria dizer
   * "ligado". Os dois casos abaixo cobram a recusa nas duas formas do desvio.
   */
  it('perguntar por uma empresa com a sessão em outra RECUSA, não responde "ligado"', async () => {
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { actorId: 'pedro' }));

    // A empresa B perguntando pela A: sob policy, a linha do desligamento seria
    // invisível e a resposta ingênua seria `null` — "pode mandar".
    await expect(
      naEmpresa(ORG_B, () => conectores.recusaDe({ orgId: ORG_A, capabilityId: 'email.enviar' })),
    ).rejects.toBeInstanceOf(EmpresaDivergenteError);

    // Vale para todo caminho de entrada, não só a leitura.
    await expect(
      naEmpresa(ORG_B, () => conectores.listar(ORG_A)),
    ).rejects.toBeInstanceOf(EmpresaDivergenteError);
    await expect(
      naEmpresa(ORG_B, () => conectores.desligar(ORG_A, 'clickup')),
    ).rejects.toBeInstanceOf(EmpresaDivergenteError);
    await expect(
      naEmpresa(ORG_B, () => conectores.religar(ORG_A, 'google')),
    ).rejects.toBeInstanceOf(EmpresaDivergenteError);

    // E a recusa da empresa A continua de pé: nada foi religado por engano.
    expect(
      await naEmpresa(ORG_A, () => conectores.recusaDe({ orgId: ORG_A, capabilityId: 'email.enviar' })),
    ).not.toBeNull();
  });

  it('o isolamento por linha ESCONDE a linha em silêncio — a razão de o guarda existir', async () => {
    /*
     * A PREMISSA, medida no banco e não afirmada em comentário.
     *
     * O guarda acima seria zelo inútil se a leitura com a empresa errada desse
     * ERRO. Ela não dá: sob `FORCE ROW LEVEL SECURITY`, a policy recorta pela
     * empresa da SESSÃO e a linha simplesmente NÃO APARECE. Zero linhas, zero
     * erro, zero log — e `null`, no desenho ingênuo, é "conector ligado".
     *
     * Este caso troca de papel para `mktos_app` dentro da transação: rodar como
     * dono (`mkt`, que é quem a suíte usa) não exercita policy nenhuma, porque o
     * dono atravessa o isolamento. `SET LOCAL ROLE` não pede senha vindo do
     * dono, e volta sozinho no fim da transação.
     */
    await naEmpresa(ORG_A, () =>
      conectores.desligar(ORG_A, 'gmail', { motivo: 'premissa', actorId: 'pedro' }),
    );

    const visiveisCom = async (empresaDaSessao: string) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE mktos_app');
        await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, empresaDaSessao);
        const r = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*)::bigint AS n FROM "ConectorDesligado" WHERE "orgId" = $1`,
          ORG_A,
        );
        return Number(r[0].n);
      });

    // A empresa dona enxerga a própria linha.
    expect(await visiveisCom(ORG_A)).toBe(1);
    // A vizinha perguntando pela linha da A: VAZIO, e sem erro nenhum.
    expect(await visiveisCom(ORG_B)).toBe(0);
    // Sessão sem empresa declarada: vazio também — o caso mais perigoso, porque
    // aconteceria em toda rotina que esquecesse de abrir o contexto.
    expect(await visiveisCom('')).toBe(0);
  });

  it('sem contexto de execução nenhum também RECUSA — é o caso mais perigoso', async () => {
    /*
     * Sessão sem empresa declarada faz `app_org_resolvida()` ser falso e NENHUMA
     * linha aparecer. Responder "ligado" aí seria liberar TUDO de TODA empresa
     * sempre que alguém esquecesse de abrir o contexto.
     */
    await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { actorId: 'pedro' }));
    await expect(
      conectores.recusaDe({ orgId: ORG_A, capabilityId: 'email.enviar' }),
    ).rejects.toBeInstanceOf(EmpresaDivergenteError);
  });

  it('dois desligamentos simultâneos do mesmo alvo não estouram', async () => {
    /*
     * A CORRIDA. `findMany` e `createMany` não são atômicos entre si: duas abas
     * (ou dois operadores no mesmo incidente) leem "não existe" ao mesmo tempo e
     * as duas inserem. Sem `skipDuplicates`, a segunda batia no índice único
     * `(orgId, conector)` e virava 500 — a tela dizendo "erro no servidor" no
     * exato momento em que o conector ACABOU de ser desligado com sucesso.
     */
    const [a, b] = await Promise.all([
      naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { motivo: 'aba 1' })),
      naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google', { motivo: 'aba 2' })),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    // Uma linha por conector, não duas, e o desligamento vale.
    const linhas = await prisma.conectorDesligado.findMany({ where: { orgId: ORG_A } });
    expect(linhas.map((l) => l.conector).sort()).toEqual(['drive', 'gcal', 'gdocs', 'gmail']);
    expect(
      await naEmpresa(ORG_A, () => conectores.recusaDe({ orgId: ORG_A, capabilityId: 'email.enviar' })),
    ).not.toBeNull();
  });

  it('desligar e religar devolvem a MESMA forma', async () => {
    // Um nome e um tipo para o mesmo dado. Antes eram `desligados: string[]` de
    // um lado e `religados: number` do outro.
    const off = await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'google'));
    const on = await naEmpresa(ORG_A, () => conectores.religar(ORG_A, 'google'));
    expect(Object.keys(off).sort()).toEqual(Object.keys(on).sort());
    // Mesma ordem também: forma igual é nome, tipo E ordem.
    expect(off.efetivados).toEqual(['drive', 'gcal', 'gdocs', 'gmail']);
    expect(on.efetivados).toEqual(['drive', 'gcal', 'gdocs', 'gmail']);

    // Repetir o clique não muda nada e diz isso na mesma forma.
    expect((await naEmpresa(ORG_A, () => conectores.religar(ORG_A, 'google'))).efetivados).toEqual([]);
  });

  it('falhar em REGISTRAR não faz a tela dizer que o desligamento falhou', async () => {
    /*
     * O registro vem DEPOIS do efeito: a linha já está no banco quando o evento
     * é gravado. Deixar a falha do log subir faria a rota responder erro para
     * uma ação que ACONTECEU — e quem clicou tentaria de novo, ou procuraria
     * outro jeito de parar a máquina achando que nada mudou.
     *
     * O estado real é o que vale; o que se perde sai no log em nível de erro.
     */
    const quebrado = new ConectoresService(
      prisma as unknown as PrismaService,
      new AuditService(prisma as unknown as PrismaService),
      {
        registrar: async () => {
          throw new Error('rastro fora do ar');
        },
      } as unknown as EventLogService,
    );

    const r = await naEmpresa(ORG_A, () => quebrado.desligar(ORG_A, 'clickup', { motivo: 'x' }));
    expect(r.ok).toBe(true);
    expect(r.efetivados).toEqual(['clickup']);

    // E o desligamento VALE, que é o ponto: o efeito não dependia do log.
    expect(
      await naEmpresa(ORG_A, () =>
        conectores.recusaDe({ orgId: ORG_A, capabilityId: 'clickup.tarefa.alterar' }),
      ),
    ).not.toBeNull();
  });

  /*
   * O CONECTOR DE VERDADE. As provas acima medem a decisão; esta mede o único
   * serviço de conector que é desta fatia: o ClickUp recusa ANTES de falar com a
   * API externa. Se a recusa não existisse, `sync` iria até o `fetch` e
   * estouraria por rede — outro erro, outra mensagem, e o conector teria agido.
   */
  it('o ClickupService recusa antes de sair da casa', async () => {
    const antes = process.env.CLICKUP_API_TOKEN;
    const baseAntes = process.env.CLICKUP_BASE_URL;
    process.env.CLICKUP_API_TOKEN = 'token-falso-de-teste';
    /*
     * A API é apontada para a porta 9 do próprio host — a porta "discard", que
     * recusa conexão na hora. Sem isto o caso da empresa B ia de verdade até
     * api.clickup.com e a suíte passava a depender de rede (10 s por execução,
     * vermelho em máquina sem internet). O que se mede aqui é QUEM foi barrado
     * antes do `fetch`, não o que o ClickUp responde.
     */
    process.env.CLICKUP_BASE_URL = 'http://127.0.0.1:9';
    try {
      const p = prisma as unknown as PrismaService;
      // Construído à mão: `onModuleInit` não roda, então nenhum timer de sync
      // agendado fica para trás.
      const clickup = new ClickupService(p, new AuditService(p), conectores);

      await naEmpresa(ORG_A, () => conectores.desligar(ORG_A, 'clickup', { motivo: 'conta suspensa', actorId: 'pedro' }));
      const syncA = () => naEmpresa(ORG_A, () => clickup.sync(ORG_A));
      await expect(syncA()).rejects.toBeInstanceOf(ConectorDesligadoError);
      await expect(syncA()).rejects.toThrow(/ClickUp/);
      await expect(syncA()).rejects.toThrow(/conta suspensa/);

      // A empresa vizinha não é barrada aqui — ela vai adiante e falha por
      // REDE/token falso, que é outro erro. É o que prova que a recusa é da
      // empresa A, não do ClickUp em geral.
      await expect(
        naEmpresa(ORG_B, () => clickup.sync(ORG_B)),
      ).rejects.not.toBeInstanceOf(ConectorDesligadoError);

      /*
       * A BRECHA FECHADA — correção do achado nº 4.
       *
       * A primeira versão tinha um ramo incondicional: sem empresa resolvível,
       * avisava no log e DEIXAVA PASSAR. O revisor confirmou que nenhum agente
       * alcançava aquilo hoje — era conveniência, não desvio — mas o primeiro
       * trabalho agendado que chamasse `writeTaskStatus` ou `criarTarefa`
       * atravessaria o interruptor sem nada vermelho em canto nenhum.
       *
       * Agora recusa. E recusa ANTES do `fetch`: se passasse, a chamada iria à
       * porta 9 e o erro seria de rede, não de empresa.
       */
      await expect(clickup.sync('')).rejects.toBeInstanceOf(SemTenantError);
      // Os dois métodos que não recebem `orgId` e dependem do contexto: fora de
      // requisição, não existe contexto, e eles param aqui.
      await expect(clickup.writeTaskStatus('tarefa-x', 'feito')).rejects.toBeInstanceOf(
        SemTenantError,
      );
      await expect(clickup.criarTarefa({ nome: 'x', descricao: 'y' })).rejects.toBeInstanceOf(
        SemTenantError,
      );
      // E a mensagem diz o que fazer, não só que deu errado.
      await expect(clickup.criarTarefa({ nome: 'x', descricao: 'y' })).rejects.toThrow(
        /comContexto/,
      );

      // DENTRO do contexto, os mesmos dois passam pela avaliação: com o ClickUp
      // desligado para a empresa A, a recusa é de POLÍTICA, não de tenant.
      await expect(
        naEmpresa(ORG_A, () => clickup.writeTaskStatus('tarefa-x', 'feito')),
      ).rejects.toBeInstanceOf(ConectorDesligadoError);
      await expect(
        naEmpresa(ORG_A, () => clickup.criarTarefa({ nome: 'x', descricao: 'y' })),
      ).rejects.toBeInstanceOf(ConectorDesligadoError);
    } finally {
      // `process.env.X = undefined` grava a STRING "undefined": variável que
      // não existia tem de voltar a não existir.
      if (antes === undefined) delete process.env.CLICKUP_API_TOKEN;
      else process.env.CLICKUP_API_TOKEN = antes;
      if (baseAntes === undefined) delete process.env.CLICKUP_BASE_URL;
      else process.env.CLICKUP_BASE_URL = baseAntes;
    }
  }, 30_000);
});
