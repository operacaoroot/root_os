import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inspect } from 'node:util';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import {
  ActorType,
  AgentEstado,
  AgentTipo,
  BioPlataforma,
  PrismaClient,
  RiskLevel,
  SessionCanal,
} from '@prisma/client';

import {
  ChaveDeCofreError,
  chaveDoPacote,
  cifrar,
  decifrar,
  idDaChaveAtual,
  idsDoChaveiro,
  redefinirChaveiro,
  temChaveDeCriptografia,
} from '../src/common/crypto';
import {
  AlvoDeVarreduraInvalidoError,
  CredencialEmprestada,
  MARCA_REDIGIDA,
  NOMES_CONHECIDOS,
  PrazoDeEmprestimoExcessivoError,
  VALIDADE_MAXIMA_DE_EMPRESTIMO_MS,
  contemAlgumSegredo,
  dadoAssociado,
  normalizarEscopo,
} from '../src/cofre/segredo';
import { CofreService, SegredoIndisponivelError } from '../src/cofre/cofre.service';
import { BioCredenciaisService } from '../src/bio/bio-credenciais.service';
import { RotacaoDeChaveService, RotacaoIndisponivelError } from '../src/cofre/rotacao.service';
import {
  desfazerMigracaoDoCofre,
  migrarCredenciaisParaOCofre,
} from '../src/cofre/migrar-credenciais';
import { comContexto } from '../src/common/contexto-execucao';
import { EventLogService } from '../src/gateway/event-log.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { PolicyService } from '../src/policy/policy.service';
import { ProcedenciaExterna, SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { TetoDeCustoIaService } from '../src/llm/teto-diario.service';
import { AgentRuntime } from '../src/agents/agent-runtime.service';
import { SessionService } from '../src/agents/session.service';
import type { ContextBuilder } from '../src/agents/context-builder.service';
import type {
  ChamadaParaTeto,
  LlmProvider,
  LlmStepInput,
  LlmStepOutput,
} from '../src/llm/llm.provider';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ============================================================================
 * O COFRE — fatia 5.3 (RF-C-01, RF-C-02, RF-C-03, RF-C-04)
 * ============================================================================
 *
 * O QUE ESTA SUÍTE PRECISA PROVAR, e o que separa a fatia feita da fingida:
 *
 *   1. ROTAÇÃO DE VERDADE. Cifrar com a chave antiga, rotacionar, e TODOS os
 *      tokens continuarem legíveis — inclusive um que a rotação NÃO TOCOU. É
 *      este último que reprova a implementação ingênua: quem "rotaciona"
 *      trocando a variável de ambiente passa nos três primeiros casos e falha
 *      neste, que é o estado normal de uma rotação interrompida no meio. E o
 *      caminho de VOLTA, que é a segunda metade da mesma promessa;
 *
 *   2. REVOGAÇÃO INDIVIDUAL. Revogar o conector de uma empresa não pode encostar
 *      em outra empresa, nem em outro conector da mesma empresa — e tem de
 *      alcançar até o empréstimo que já estava na mão de alguém;
 *
 *   3. O MODELO NUNCA RECEBE CREDENCIAL, provado POR TENTATIVA. Não é inspeção
 *      de código: o efeito desta suíte TENTA devolver a credencial ao modelo, e
 *      o que chega ao provider é conferido com uma varredura que sabe achar
 *      segredo (e que é testada antes, contra um segredo plantado — senão a
 *      prova seria vácuo);
 *
 *   4. UMA EMPRESA NÃO LÊ O SEGREDO DA OUTRA, também por tentativa, e com o
 *      PAPEL RESTRITO. Rodar como dono (superusuário) não exercita policy
 *      nenhuma. A seção de RLS só existe quando há conexão restrita.
 *
 * ----------------------------------------------------------------------------
 * COMO RODAR
 * ----------------------------------------------------------------------------
 * Os casos de chaveiro e de `CredencialEmprestada` NÃO precisam de banco e rodam
 * sempre — é a parte que sustenta as outras, e ela não pode depender de
 * infraestrutura para ser verificada.
 *
 *   docker exec mktos-shadow psql -U mkt -d postgres -c 'CREATE DATABASE marketing_os_test'
 *   DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     pnpm --filter @mktos/api db:deploy
 *   TEST_DATABASE_URL='...marketing_os_test' pnpm --filter @mktos/api test
 *
 * A seção de ISOLAMENTO POR LINHA (a última) precisa de uma segunda conexão, com
 * um papel NOBYPASSRLS, e do banco separado — ela liga RLS para o banco inteiro:
 *
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test_rls' \
 *     TENANT_DATABASE_URL='postgresql://mktos_app:<senha>@localhost:55432/marketing_os_test_rls' \
 *     RLS_NO_TESTE=1 pnpm --filter @mktos/api exec vitest run test/cofre.test.ts
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresas, agentes e segredos de conector)');

const ORG_A = 'org-cofre-a';
const ORG_B = 'org-cofre-b';
const ORG_AGENTE = 'org-cofre-agente';

/** Chaves de teste. Material descartável, gerado aqui — nunca chave real. */
const CHAVE_ENV = randomBytes(32).toString('base64');
const CHAVE_K2 = randomBytes(32).toString('base64');
const CHAVE_K3 = randomBytes(32).toString('base64');

/** O ambiente de cifragem, montado por caso. Devolve o ambiente anterior. */
function comChaveiro(config: { env?: string; chaves?: string; atual?: string }): void {
  if (config.env === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = config.env;
  if (config.chaves === undefined) delete process.env.COFRE_CHAVES;
  else process.env.COFRE_CHAVES = config.chaves;
  if (config.atual === undefined) delete process.env.COFRE_CHAVE_ATUAL;
  else process.env.COFRE_CHAVE_ATUAL = config.atual;
  redefinirChaveiro();
}

/** Toda chamada ao cofre roda DENTRO do contexto de execução da empresa. */
function naEmpresa<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return comContexto(
    {
      orgId,
      actorType: ActorType.user,
      actorId: 'operador-teste',
      correlationId: 'teste-cofre',
      origem: 'script',
    },
    fn,
  );
}

// ===========================================================================
// 1. O CHAVEIRO E O FORMATO — a base de tudo, e sem banco
// ===========================================================================

describe('chaveiro: o pacote diz com que chave foi cifrado', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    redefinirChaveiro();
  });

  it('sem COFRE_CHAVES, escreve EXATAMENTE no formato antigo — três partes', () => {
    /*
     * A regra que não pode ser quebrada: há linhas em produção no formato velho
     * e um rollback do código precisa continuar lendo o que foi escrito depois
     * dele. Sem chaveiro configurado, este arquivo se comporta byte a byte como
     * antes desta fatia.
     */
    comChaveiro({ env: CHAVE_ENV });
    const pacote = cifrar('ya29.token-do-google');
    expect(pacote.split('.')).toHaveLength(3);
    expect(decifrar(pacote)).toBe('ya29.token-do-google');
    expect(chaveDoPacote(pacote)).toBe('env');
  });

  it('com chaveiro, o pacote carrega o id da chave — e o id é lido sem abrir', () => {
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    const pacote = cifrar('segredo');
    const partes = pacote.split('.');
    expect(partes).toHaveLength(5);
    expect(partes[0]).toBe('c2');
    expect(partes[1]).toBe('k2');
    expect(chaveDoPacote(pacote)).toBe('k2');
    expect(decifrar(pacote)).toBe('segredo');
  });

  it('pacote VELHO continua abrindo depois de o chaveiro existir', () => {
    // A ordem importa: cifra no mundo de antes, abre no mundo de depois.
    comChaveiro({ env: CHAVE_ENV });
    const velho = cifrar('token-antigo');

    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    expect(decifrar(velho)).toBe('token-antigo');
    expect(idDaChaveAtual()).toBe('k2');
  });

  it('trocar a chave ATUAL não torna ilegível o que a anterior cifrou', () => {
    /*
     * Este é, em uma linha, o defeito que o CLAUDE.md do projeto descreve como
     * armadilha conhecida — e o motivo de a fatia existir.
     */
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    const comK2 = cifrar('valor');

    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2},k3:${CHAVE_K3}`, atual: 'k3' });
    expect(decifrar(comK2)).toBe('valor');
    expect(decifrar(cifrar('novo'))).toBe('novo');
  });

  it('chave que SAIU do chaveiro dá erro que nomeia a chave e o conserto', () => {
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    const comK2 = cifrar('valor');

    comChaveiro({ env: CHAVE_ENV });
    expect(() => decifrar(comK2)).toThrow(ChaveDeCofreError);
    expect(() => decifrar(comK2)).toThrow(/k2/);
    expect(() => decifrar(comK2)).toThrow(/COFRE_CHAVES/);
  });

  it('COFRE_CHAVE_ATUAL apontando para id inexistente FALHA — não cai na de ambiente', () => {
    /*
     * O erro de digitação que, no lado silencioso, faria o produto gravar tudo
     * com a chave velha achando que rotacionou.
     */
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k22' });
    expect(() => idDaChaveAtual()).toThrow(/k22/);
  });

  it('o id "env" é reservado: declarar outro material com esse id FALHA', () => {
    comChaveiro({ env: CHAVE_ENV, chaves: `env:${CHAVE_K2}` });
    expect(() => idsDoChaveiro()).toThrow(/reservado/);
  });

  it('chave de tamanho errado falha dizendo quantos bytes vieram', () => {
    comChaveiro({ env: Buffer.from('curta').toString('base64') });
    expect(() => idsDoChaveiro()).toThrow(/32 bytes/);
    expect(temChaveDeCriptografia()).toBe(false);
  });

  it('sem chave nenhuma, a mensagem lembra os DOIS lugares do compose', () => {
    comChaveiro({});
    expect(() => idsDoChaveiro()).toThrow(/environment/);
    expect(temChaveDeCriptografia()).toBe(false);
  });

  it('o dado associado amarra o valor à empresa: a linha copiada NÃO abre', () => {
    /*
     * A tranca que a policy de linha não dá. Alguém com o banco na mão — dump,
     * restauração, SQL direto — copia a linha da empresa A para a B. Com a
     * chave certa, e ainda assim o valor não abre.
     */
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    const daEmpresaA = cifrar('token', { aad: dadoAssociado('org-a', 'gmail', 'access_token') });

    expect(decifrar(daEmpresaA, { aad: dadoAssociado('org-a', 'gmail', 'access_token') })).toBe('token');
    expect(() => decifrar(daEmpresaA, { aad: dadoAssociado('org-b', 'gmail', 'access_token') })).toThrow();
    // E nem trocando o conector ou o nome dentro da mesma empresa.
    expect(() => decifrar(daEmpresaA, { aad: dadoAssociado('org-a', 'clickup', 'access_token') })).toThrow();
    expect(() => decifrar(daEmpresaA, { aad: dadoAssociado('org-a', 'gmail', 'refresh_token') })).toThrow();
  });

  it('pacote antigo com `aad` avisa o que aconteceu em vez de "unable to authenticate"', () => {
    comChaveiro({ env: CHAVE_ENV });
    const velho = cifrar('x');
    expect(() => decifrar(velho, { aad: 'qualquer' })).toThrow(/formato antigo/);
  });
});

// ===========================================================================
// 2. A CREDENCIAL EMPRESTADA — o segredo não sai por serialização nenhuma
// ===========================================================================

describe('a varredura de segredo sabe achar segredo (senão o resto é vácuo)', () => {
  /*
   * Esta seção existe porque a prova do item 3 usa `contemAlgumSegredo`. Uma
   * varredura que não achasse nada faria TODOS os casos seguintes passarem sem
   * provar coisa alguma. Então ela é testada primeiro, contra segredo plantado
   * em cada forma que um vazamento real assume.
   *
   * A REGRA QUE ELA TEM DE OBEDECER: ser SUPERCONJUNTO das três portas de
   * serialização. Se ela enxerga menos que `JSON.stringify`, `String()` e
   * `util.inspect`, ela CERTIFICA COMO LIMPO um payload que vaza — e certificado
   * falso é pior que nenhum, porque é ele que fecha a revisão. Os casos abaixo
   * são, um a um, os buracos que a revisão adversarial da fatia derrubou
   * executando: a versão anterior andava só por `Object.entries` e passava em
   * branco por seis mecanismos reais de vazamento.
   */
  const SEGREDO = 'ya29.a0AfB_by-TOKEN-SUPER-SECRETO';

  it('acha num campo de objeto', () => {
    const r = contemAlgumSegredo({ a: { b: { token: SEGREDO } } }, [SEGREDO]);
    expect(r.achou).toBe(true);
  });

  it('acha dentro de uma string montada — o caso real do cabeçalho Authorization', () => {
    const r = contemAlgumSegredo({ headers: `Authorization: Bearer ${SEGREDO}` }, [SEGREDO]);
    expect(r.achou).toBe(true);
  });

  it('acha em array, Map, Set e Buffer', () => {
    expect(contemAlgumSegredo([1, [SEGREDO]], [SEGREDO]).achou).toBe(true);
    expect(contemAlgumSegredo(new Map([['k', SEGREDO]]), [SEGREDO]).achou).toBe(true);
    expect(contemAlgumSegredo(new Set([SEGREDO]), [SEGREDO]).achou).toBe(true);
    expect(contemAlgumSegredo({ b: Buffer.from(SEGREDO) }, [SEGREDO]).achou).toBe(true);
  });

  it('acha quando o segredo é a CHAVE de um Map — o inspect mostra a chave', () => {
    expect(contemAlgumSegredo(new Map([[SEGREDO, 1]]), [SEGREDO]).achou).toBe(true);
  });

  it('não trava em referência circular', () => {
    const a: Record<string, unknown> = { nome: 'ok' };
    a.eu = a;
    expect(contemAlgumSegredo(a, [SEGREDO]).achou).toBe(false);
  });

  it('não acha o que não está lá', () => {
    expect(contemAlgumSegredo({ a: 'nada aqui' }, [SEGREDO]).achou).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // OS SEIS BURACOS. Cada um destes casos passou VERDE contra a versão anterior,
  // dizendo "limpo" sobre um payload que vaza.
  // ---------------------------------------------------------------------------

  it('BURACO 1 — objeto com `toJSON` próprio: o que vaza é o que ELE devolve', () => {
    /*
     * O caso mais grave da lista, porque é o mecanismo do próprio objeto
     * emprestado desta fatia: um embrulho futuro escrito errado — um `toJSON`
     * que devolvesse o valor — seria CERTIFICADO LIMPO pela varredura que existe
     * exatamente para pegá-lo.
     */
    const embrulhoErrado = {
      rotulo: 'credencial',
      toJSON: () => ({ token: SEGREDO }),
    };
    expect(JSON.stringify(embrulhoErrado)).toContain(SEGREDO); // é isto que o modelo veria
    const r = contemAlgumSegredo(embrulhoErrado, [SEGREDO]);
    expect(r.achou ? r.onde : 'não achou').toContain('toJSON()');
  });

  it('BURACO 2 — Error com o segredo na mensagem e na pilha', () => {
    /*
     * `message` e `stack` são NÃO ENUMERÁVEIS: `Object.entries(new Error(x))` é
     * `[]`. E este é o caminho mais provável de um token chegar ao modelo hoje,
     * porque `paraModelo` manda a mensagem do erro para dentro da conversa.
     */
    const e = new Error(`falhou em https://api/x?access_token=${SEGREDO}`);
    expect(Object.entries(e)).toEqual([]); // a razão da cegueira anterior
    const r = contemAlgumSegredo(e, [SEGREDO]);
    expect(r.achou ? r.onde : 'não achou').toContain('message');
    // E aninhado, que é como ele chegaria de verdade.
    expect(contemAlgumSegredo({ falha: e }, [SEGREDO]).achou).toBe(true);
    // E na causa encadeada.
    expect(contemAlgumSegredo(new Error('externo', { cause: e }), [SEGREDO]).achou).toBe(true);
  });

  it('BURACO 3 — propriedade não enumerável', () => {
    const o: Record<string, unknown> = { visivel: 'ok' };
    Object.defineProperty(o, 'token', { value: SEGREDO, enumerable: false });
    expect(Object.entries(o)).toHaveLength(1);
    expect(contemAlgumSegredo(o, [SEGREDO]).achou).toBe(true);
  });

  it('BURACO 4 — chave simbólica', () => {
    const chave = Symbol('token');
    const o = { visivel: 'ok', [chave]: SEGREDO };
    expect(contemAlgumSegredo(o, [SEGREDO]).achou).toBe(true);
  });

  it('BURACO 5 — segredo em base64 (e em hex) continua sendo o segredo', () => {
    /*
     * `Basic` auth, corpo de webhook, cabeçalho assinado: o token passa por
     * `Buffer.from(t).toString('base64')` e a comparação crua diz "limpo" sobre
     * exatamente o mesmo valor.
     */
    const b64 = Buffer.from(SEGREDO, 'utf8').toString('base64');
    const hex = Buffer.from(SEGREDO, 'utf8').toString('hex');
    expect(b64).not.toContain(SEGREDO);

    const rb = contemAlgumSegredo({ authorization: `Basic ${b64}` }, [SEGREDO]);
    expect(rb.achou).toBe(true);
    expect(rb.achou && rb.forma).toBe('base64');
    expect(rb.achou && rb.segredo).toBe(SEGREDO); // reporta o ORIGINAL, não a forma

    const rh = contemAlgumSegredo({ assinatura: hex }, [SEGREDO]);
    expect(rh.achou && rh.forma).toBe('hex');
  });

  it('BURACO 6 — `toString` e o inspetor personalizado devolvendo o valor', () => {
    const porToString = { toString: () => `Bearer ${SEGREDO}` };
    expect(`${porToString}`).toContain(SEGREDO);
    expect(contemAlgumSegredo(porToString, [SEGREDO]).achou).toBe(true);

    const porInspect = { [inspect.custom]: () => SEGREDO };
    expect(inspect(porInspect)).toContain(SEGREDO);
    expect(contemAlgumSegredo(porInspect, [SEGREDO]).achou).toBe(true);
  });

  it('BURACO 7 — alvo curto demais LANÇA, em vez de ser descartado em silêncio', () => {
    /*
     * Não é cegueira, é mentira: a versão anterior filtrava alvos com menos de
     * oito caracteres e seguia. Quem passasse `['abc']` recebia "nada
     * encontrado" sobre uma varredura que não procurou NADA — e a suíte que se
     * apoiasse nisso provaria vácuo com cara de prova.
     */
    expect(() => contemAlgumSegredo({ a: 'abc' }, ['abc'])).toThrow(AlvoDeVarreduraInvalidoError);
    expect(() => contemAlgumSegredo({ a: 'abc' }, ['abc'])).toThrow(/menos de 8/);
    // E varrer sem alvo nenhum também é uma prova vazia.
    expect(() => contemAlgumSegredo({ a: 1 }, [])).toThrow(/nenhum segredo/);
  });

  it('getter é invocado — `JSON.stringify` invoca, então a varredura tem de invocar', () => {
    const o = {
      visivel: 'ok',
      get token() {
        return SEGREDO;
      },
    };
    expect(JSON.stringify(o)).toContain(SEGREDO);
    expect(contemAlgumSegredo(o, [SEGREDO]).achou).toBe(true);
  });

  it('a CredencialEmprestada continua limpa DEPOIS de tudo isso', () => {
    /*
     * A contraprova que fecha a seção: a varredura ficou muito mais agressiva —
     * chama `toJSON`, `toString`, o inspetor e os getters — e mesmo assim o
     * objeto emprestado passa. É o que separa "a varredura enxerga" de "a
     * varredura acusa qualquer coisa".
     */
    const cred = new CredencialEmprestada(
      {
        orgId: ORG_A,
        conector: 'google',
        nome: 'access_token',
        referencia: 'linha-1',
        escopo: ['gmail.send'],
        expiraEm: new Date(Date.now() + 60_000),
      },
      SEGREDO,
    );
    const r = contemAlgumSegredo(cred, [SEGREDO]);
    expect(r.achou ? `vazou em ${r.onde}` : 'limpo').toBe('limpo');
    cred.devolver();
  });
});

describe('CredencialEmprestada: o segredo não sai por serialização nenhuma', () => {
  const SEGREDO = 'ya29.token-que-nao-pode-vazar-de-jeito-nenhum';

  const nova = (validadeMs = 60_000) =>
    new CredencialEmprestada(
      {
        orgId: ORG_A,
        conector: 'google',
        nome: 'access_token',
        referencia: 'linha-1',
        escopo: ['gmail.send'],
        expiraEm: new Date(Date.now() + validadeMs),
      },
      SEGREDO,
    );

  it('JSON.stringify devolve a marca, nunca o valor — inclusive aninhada', () => {
    const cred = nova();
    expect(JSON.stringify(cred)).not.toContain(SEGREDO);
    expect(JSON.stringify(cred)).toContain(MARCA_REDIGIDA);
    // Aninhada é o caso que importa: é assim que ela chegaria ao modelo.
    const embrulhada = { ok: true, credencial: cred, lista: [cred] };
    expect(JSON.stringify(embrulhada)).not.toContain(SEGREDO);
  });

  it('String(), template e util.inspect também', () => {
    const cred = nova();
    expect(String(cred)).not.toContain(SEGREDO);
    expect(`${cred}`).not.toContain(SEGREDO);
    expect(inspect(cred)).not.toContain(SEGREDO);
    expect(inspect({ cred }, { depth: 10 })).not.toContain(SEGREDO);
  });

  it('Object.keys, spread e a varredura não alcançam o campo privado', () => {
    const cred = nova();
    expect(Object.keys(cred)).not.toContain('segredo');
    expect(JSON.stringify({ ...cred })).not.toContain(SEGREDO);
    expect(contemAlgumSegredo(cred, [SEGREDO]).achou).toBe(false);
  });

  it('`usar` é o único caminho para o valor, e ele funciona', async () => {
    const cred = nova();
    const visto = await cred.usar((s) => s.length);
    expect(visto).toBe(SEGREDO.length);
    await expect(cred.usar(async (s) => `Bearer ${s}`)).resolves.toBe(`Bearer ${SEGREDO}`);
  });

  it('depois de devolver, `usar` recusa e o objeto não carrega mais o valor', async () => {
    const cred = nova();
    cred.devolver();
    await expect(cred.usar((s) => s)).rejects.toThrow(/não está mais disponível/);
    expect(contemAlgumSegredo(cred, [SEGREDO]).achou).toBe(false);
    expect(cred.valido).toBe(false);
  });

  it('empréstimo VENCIDO recusa e apaga o valor da memória', async () => {
    const cred = nova(-1); // já nasceu vencido
    await expect(cred.usar((s) => s)).rejects.toThrow(/venceu/);
    expect(contemAlgumSegredo(cred, [SEGREDO]).achou).toBe(false);
  });

  it('o valor some SOZINHO ao vencer — sem ninguém pedir outro empréstimo', async () => {
    /*
     * O DEFEITO QUE ESTE CASO FECHA. Antes, a limpeza acontecia "de forma
     * oportunista": ao emprestar de novo a MESMA chave, o cofre varria o
     * conjunto tirando o que já não valia. Se ninguém pedisse outro empréstimo —
     * e o normal é não pedir —, o objeto vencido ficava com o valor EM CLARO na
     * memória pelo tempo de vida do processo. É exatamente o despejo de memória
     * (`heap dump`) que o comentário de `usar` dizia estar evitando: recusar o
     * uso e guardar o segredo é o pior dos dois mundos.
     *
     * Agora o próprio empréstimo tem despertador. Ninguém precisa passar por ali.
     */
    const cred = nova(30);
    // Antes do prazo, o valor está lá e é usável.
    await expect(cred.usar((s) => s)).resolves.toBe(SEGREDO);

    /*
     * O encerramento é observado pelo gancho, e não pela varredura: o campo é
     * `#privado` de JavaScript, então `contemAlgumSegredo` NUNCA o enxerga — nem
     * com o valor lá dentro. Usá-la aqui daria um verde que não significa nada.
     * O gancho, ao contrário, só dispara quando `#encerrar` roda, que é
     * exatamente a linha que zera o segredo.
     */
    let encerrou = false;
    cred.quandoEncerrar(() => {
      encerrou = true;
    });

    await new Promise((r) => setTimeout(r, 60));

    // NADA foi chamado neste objeto no intervalo — e mesmo assim ele se fechou.
    expect(encerrou).toBe(true);
    expect(cred.valido).toBe(false);
    await expect(cred.usar((s) => s)).rejects.toThrow(/venceu/);
  });

  it('prazo de empréstimo acima do TETO é RECUSADO, não cortado em silêncio', () => {
    /*
     * A revisão aceitou um empréstimo de vinte e quatro horas. Todo o argumento
     * da janela de um minuto — o que sustenta "revogação com efeito imediato"
     * mesmo numa segunda instância da API, onde o mapa deste processo não
     * alcança — depende de um PADRÃO, e padrão é o valor que qualquer chamador
     * anula escrevendo um número maior. Sem teto, aquele argumento vale zero.
     */
    const umDia = 24 * 60 * 60 * 1000;
    expect(
      () =>
        new CredencialEmprestada(
          {
            orgId: ORG_A,
            conector: 'google',
            nome: 'access_token',
            referencia: 'linha-1',
            escopo: [],
            expiraEm: new Date(Date.now() + umDia),
          },
          SEGREDO,
        ),
    ).toThrow(PrazoDeEmprestimoExcessivoError);

    // E o teto é usável: um pouco abaixo dele passa.
    expect(() => nova(VALIDADE_MAXIMA_DE_EMPRESTIMO_MS - 1_000)).not.toThrow();
  });

  // ------------------------------------------------------------------- escopo

  it('o vocabulário de escopo é o MESMO nos dois sentidos', () => {
    /*
     * O Google grava o escopo como URL inteira; quem escreve a ação pede a forma
     * curta, que é como o catálogo de capacidades fala. Comparando cru, os DOIS
     * sentidos recusam uma credencial que TEM o escopo — e a ação legítima para
     * de funcionar, até alguém "consertar" tirando a exigência do caminho, que é
     * como um controle de segurança morre.
     */
    expect(normalizarEscopo('https://www.googleapis.com/auth/gmail.send')).toBe('gmail.send');
    expect(normalizarEscopo('  GMAIL.SEND ')).toBe('gmail.send');

    const declaradoLongo = new CredencialEmprestada(
      {
        orgId: ORG_A,
        conector: 'google',
        nome: 'access_token',
        referencia: 'l',
        escopo: ['https://www.googleapis.com/auth/gmail.send'],
        expiraEm: new Date(Date.now() + 60_000),
      },
      SEGREDO,
    );
    // declarado URL × exigido curto
    expect(() => declaradoLongo.exigirEscopo('gmail.send')).not.toThrow();
    // e o outro sentido: declarado curto × exigido URL
    const declaradoCurto = nova(); // escopo: ['gmail.send']
    expect(() =>
      declaradoCurto.exigirEscopo('https://www.googleapis.com/auth/gmail.send'),
    ).not.toThrow();
    // o que NÃO está continua recusado, nas duas grafias
    expect(() => declaradoCurto.exigirEscopo('drive.write')).toThrow(/drive.write/);
    expect(() =>
      declaradoLongo.exigirEscopo('https://www.googleapis.com/auth/drive.file'),
    ).toThrow(/drive.file/);

    declaradoLongo.devolver();
    declaradoCurto.devolver();
  });

  it('LISTA VAZIA É NADA, NÃO É TUDO — falha aberta, agora fechada', () => {
    /*
     * A versão anterior devolvia "pode" quando a lista de escopos estava vazia:
     * `if (this.escopo.length === 0) return;`. Isso transforma "não sei o que
     * esta credencial permite" em "permite tudo" — um controle de segurança que
     * se DESLIGA sozinho justamente nas linhas de que menos se sabe, porque TODA
     * credencial migrada de antes do cofre está sem escopo declarado.
     */
    const semEscopo = new CredencialEmprestada(
      {
        orgId: ORG_A,
        conector: 'google',
        nome: 'access_token',
        referencia: 'l',
        escopo: [],
        expiraEm: new Date(Date.now() + 60_000),
      },
      SEGREDO,
    );
    expect(() => semEscopo.exigirEscopo('gmail.send')).toThrow(/não declara o escopo/);
    // Exigir "nada" não é conferência nenhuma: é erro de quem chamou.
    expect(() => semEscopo.exigirEscopo('   ')).toThrow(/vazio/);
    semEscopo.devolver();
  });
});

// ===========================================================================
// 3. O COFRE COM BANCO — guarda, empresta, revoga
// ===========================================================================

describe.skipIf(!URL)('o cofre guarda, empresta e revoga', () => {
  let prisma: PrismaClient;
  let cofre: CofreService;

  beforeAll(async () => {
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [id, slug] of [
      [ORG_A, 'cofre-a'],
      [ORG_B, 'cofre-b'],
    ] as const) {
      await prisma.org.upsert({
        where: { id },
        create: { id, name: `Empresa ${slug}`, slug },
        update: {},
      });
    }
    cofre = new CofreService(prisma as unknown as PrismaService, new EventLogService(prisma as never));
  });

  afterAll(async () => {
    await prisma.segredoDeConector.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.$disconnect();
    process.env = { ...process.env };
  });

  beforeEach(async () => {
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    await prisma.segredoDeConector.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  });

  const guardar = (orgId: string, conector: string, nome: string, valor: string, escopo: string[] = []) =>
    naEmpresa(orgId, () =>
      cofre.guardar({ orgId, conector, nome, valor, escopo, origem: 'teste' }),
    );

  it('o que entra sai igual, e o que fica no banco não é o valor', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'ya29.valor-real');

    const lido = await naEmpresa(ORG_A, () =>
      cofre.envolver({ orgId: ORG_A, conector: 'google', nome: 'access_token' }, (c) =>
        c.usar((s) => s),
      ),
    );
    expect(lido).toBe('ya29.valor-real');

    const linha = await prisma.segredoDeConector.findFirstOrThrow({
      where: { orgId: ORG_A, conector: 'google', nome: 'access_token' },
    });
    expect(linha.valorCifrado).not.toContain('ya29');
    expect(linha.chaveId).toBe('k2');
    expect(linha.versao).toBe(1);
  });

  it('regravar sobe a versão e continua legível', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'primeiro');
    await guardar(ORG_A, 'google', 'access_token', 'segundo');

    const linha = await prisma.segredoDeConector.findFirstOrThrow({
      where: { orgId: ORG_A, conector: 'google', nome: 'access_token' },
    });
    expect(linha.versao).toBe(2);
    const lido = await naEmpresa(ORG_A, () =>
      cofre.envolver({ orgId: ORG_A, conector: 'google', nome: 'access_token' }, (c) => c.usar((s) => s)),
    );
    expect(lido).toBe('segundo');
  });

  it('`estado` NUNCA devolve valor — nem cifrado', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'ya29.valor-real', ['gmail.send']);
    const estado = await naEmpresa(ORG_A, () => cofre.estado(ORG_A));

    expect(estado.total).toBe(1);
    expect(estado.items[0].valor).toBe(MARCA_REDIGIDA);
    expect(estado.items[0].escopo).toEqual(['gmail.send']);
    expect(contemAlgumSegredo(estado, ['ya29.valor-real']).achou).toBe(false);
    // Nem o criptograma: a tela não precisa dele, e é grátis não entregar.
    expect(JSON.stringify(estado)).not.toContain('c2.k2.');
  });

  it('empresa divergente do contexto FALHA FECHADO em vez de devolver vazio', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'x');
    // Contexto na empresa B pedindo o segredo da A: isso nunca pode "não achar".
    await expect(
      naEmpresa(ORG_B, () =>
        cofre.emprestar({ orgId: ORG_A, conector: 'google', nome: 'access_token' }),
      ),
    ).rejects.toThrow(/FALHA FECHADO/);
  });

  it('escopo exigido que o segredo não declara é recusado no empréstimo', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'x', ['gmail.readonly']);
    await expect(
      naEmpresa(ORG_A, () =>
        cofre.emprestar({
          orgId: ORG_A,
          conector: 'google',
          nome: 'access_token',
          escopoExigido: 'gmail.send',
        }),
      ),
    ).rejects.toThrow(/gmail.send/);
  });

  it('o escopo do Google, gravado como URL, atende a exigência curta', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'x', [
      'https://www.googleapis.com/auth/gmail.send',
    ]);
    await expect(
      naEmpresa(ORG_A, () =>
        cofre.envolver(
          { orgId: ORG_A, conector: 'google', nome: 'access_token', escopoExigido: 'gmail.send' },
          (c) => c.usar((s) => s),
        ),
      ),
    ).resolves.toBe('x');
  });

  it('segredo SEM escopo declarado não atende exigência nenhuma (falha fechada)', async () => {
    /*
     * É o estado de toda credencial migrada de antes do cofre. Antes, a lista
     * vazia desligava a conferência e valia como "permite tudo".
     */
    await guardar(ORG_A, 'google', 'access_token', 'x', []);
    await expect(
      naEmpresa(ORG_A, () =>
        cofre.emprestar({
          orgId: ORG_A,
          conector: 'google',
          nome: 'access_token',
          escopoExigido: 'gmail.send',
        }),
      ),
    ).rejects.toThrow(/não declara o escopo/);
    // E quem NÃO exige escopo continua passando: a mudança não quebra o caminho normal.
    await expect(
      naEmpresa(ORG_A, () =>
        cofre.envolver({ orgId: ORG_A, conector: 'google', nome: 'access_token' }, (c) =>
          c.usar((s) => s),
        ),
      ),
    ).resolves.toBe('x');
  });

  it('empréstimo de 24h é recusado ANTES de decifrar qualquer coisa', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'x');
    await expect(
      naEmpresa(ORG_A, () =>
        cofre.emprestar({
          orgId: ORG_A,
          conector: 'google',
          nome: 'access_token',
          validadeMs: 24 * 60 * 60 * 1000,
        }),
      ),
    ).rejects.toThrow(PrazoDeEmprestimoExcessivoError);
  });

  // ----------------------------------------------------------------- revogar

  it('revogar um conector de UMA empresa não encosta na outra nem no vizinho', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'A-google');
    await guardar(ORG_A, 'clickup', 'access_token', 'A-clickup');
    await guardar(ORG_B, 'google', 'access_token', 'B-google');

    const r = await naEmpresa(ORG_A, () =>
      cofre.revogar({ orgId: ORG_A, conector: 'google', motivo: 'chave vazada', por: 'pedro' }),
    );
    expect(r.revogados).toEqual(['access_token']);

    // A empresa A perdeu o Google — e a mensagem diz o que fazer.
    await expect(
      naEmpresa(ORG_A, () => cofre.emprestar({ orgId: ORG_A, conector: 'google', nome: 'access_token' })),
    ).rejects.toThrow(SegredoIndisponivelError);
    await expect(
      naEmpresa(ORG_A, () => cofre.emprestar({ orgId: ORG_A, conector: 'google', nome: 'access_token' })),
    ).rejects.toThrow(/REVOGADA/);

    // O ClickUp da MESMA empresa continua de pé.
    await expect(
      naEmpresa(ORG_A, () =>
        cofre.envolver({ orgId: ORG_A, conector: 'clickup', nome: 'access_token' }, (c) => c.usar((s) => s)),
      ),
    ).resolves.toBe('A-clickup');

    // E o Google da OUTRA empresa também.
    await expect(
      naEmpresa(ORG_B, () =>
        cofre.envolver({ orgId: ORG_B, conector: 'google', nome: 'access_token' }, (c) => c.usar((s) => s)),
      ),
    ).resolves.toBe('B-google');
  });

  it('revogar APAGA o valor do banco — não é uma flag que alguém pode esquecer de ler', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'A-google');
    await naEmpresa(ORG_A, () => cofre.revogar({ orgId: ORG_A, conector: 'google' }));

    const linha = await prisma.segredoDeConector.findFirstOrThrow({
      where: { orgId: ORG_A, conector: 'google', nome: 'access_token' },
    });
    expect(linha.valorCifrado).toBe('');
    expect(linha.revogadoEm).not.toBeNull();
    expect(linha.motivoRevogacao).toBeNull();
    // A linha FICA: é ela que responde quem revogou, quando e por quê.
    expect(linha.id).toBeTruthy();
  });

  it('revogação alcança o empréstimo que JÁ estava na mão', async () => {
    /*
     * "Efeito imediato" tem de valer também para quem pegou a credencial um
     * instante antes do clique. Sem isto, a janela seria o tempo de vida do
     * objeto — e o objeto vive enquanto a chamada externa durar.
     */
    await guardar(ORG_A, 'google', 'access_token', 'A-google');
    const emprestada = await naEmpresa(ORG_A, () =>
      cofre.emprestar({ orgId: ORG_A, conector: 'google', nome: 'access_token' }),
    );
    await expect(emprestada.usar((s) => s)).resolves.toBe('A-google');

    await naEmpresa(ORG_A, () => cofre.revogar({ orgId: ORG_A, conector: 'google' }));

    await expect(emprestada.usar((s) => s)).rejects.toThrow(/revogada/);
    expect(contemAlgumSegredo(emprestada, ['A-google']).achou).toBe(false);
  });

  it('revogar duas vezes não inventa revogação nova', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'x');
    const primeira = await naEmpresa(ORG_A, () => cofre.revogar({ orgId: ORG_A, conector: 'google' }));
    const segunda = await naEmpresa(ORG_A, () => cofre.revogar({ orgId: ORG_A, conector: 'google' }));
    expect(primeira.revogados).toEqual(['access_token']);
    expect(segunda.revogados).toEqual([]);
    expect(segunda.jaRevogados).toEqual(['access_token']);
  });

  it('reautorizar depois de revogar volta a funcionar — e a revogação fica no histórico', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'velho');
    await naEmpresa(ORG_A, () => cofre.revogar({ orgId: ORG_A, conector: 'google' }));
    await guardar(ORG_A, 'google', 'access_token', 'novo-oauth');

    await expect(
      naEmpresa(ORG_A, () =>
        cofre.envolver({ orgId: ORG_A, conector: 'google', nome: 'access_token' }, (c) => c.usar((s) => s)),
      ),
    ).resolves.toBe('novo-oauth');

    const eventos = await prisma.eventLog.findMany({
      where: { orgId: ORG_A, tipo: 'cofre.segredo.revogado' },
      select: { id: true },
    });
    expect(eventos.length).toBeGreaterThan(0);
  });

  it('o RASTRO da guarda e da revogação não carrega o valor', async () => {
    await guardar(ORG_A, 'google', 'access_token', 'ya29.segredo-no-rastro');
    await naEmpresa(ORG_A, () => cofre.revogar({ orgId: ORG_A, conector: 'google', motivo: 'teste' }));

    const eventos = await prisma.eventLog.findMany({
      where: { orgId: ORG_A, tipo: { startsWith: 'cofre.' } },
      select: { tipo: true, payload: true },
    });
    expect(eventos.length).toBeGreaterThanOrEqual(2);
    expect(contemAlgumSegredo(eventos, ['ya29.segredo-no-rastro']).achou).toBe(false);
  });

  it('guardar valor vazio é recusado: para tirar de circulação existe revogar', async () => {
    await expect(guardar(ORG_A, 'google', 'access_token', '')).rejects.toThrow(/revogar/);
  });

  // --------------------------------------- o que a revogação em massa preserva

  it('revogar o CONECTOR não queima o segredo do aplicativo junto', async () => {
    /*
     * O argumento que sustenta "revogar não tem volta, e está tudo bem" é:
     * reautorizar traz o par de tokens de volta. Ele vale para `access_token` e
     * `refresh_token`, que NASCEM de uma autorização — e NÃO vale para
     * `app_secret`, que não nasce de autorização nenhuma: é digitado na tela por
     * quem administra o app na consola da Meta/TikTok. Queimá-lo de tabela apaga
     * um valor que nenhum fluxo de OAuth recupera.
     */
    await guardar(ORG_A, 'instagram', NOMES_CONHECIDOS.acesso, 'IGQV-token');
    await guardar(ORG_A, 'instagram', NOMES_CONHECIDOS.renovacao, 'IGQV-refresh');
    await guardar(ORG_A, 'instagram', NOMES_CONHECIDOS.segredoDoApp, 'segredo-do-app');

    const r = await naEmpresa(ORG_A, () =>
      cofre.revogar({ orgId: ORG_A, conector: 'instagram', motivo: 'desconectar' }),
    );
    expect(r.revogados).toEqual([NOMES_CONHECIDOS.acesso, NOMES_CONHECIDOS.renovacao]);
    expect(r.preservados).toEqual([NOMES_CONHECIDOS.segredoDoApp]);

    // O par de tokens foi. O segredo do app continua de pé e legível.
    await expect(
      naEmpresa(ORG_A, () =>
        cofre.emprestar({ orgId: ORG_A, conector: 'instagram', nome: NOMES_CONHECIDOS.acesso }),
      ),
    ).rejects.toThrow(/REVOGADA/);
    await expect(
      naEmpresa(ORG_A, () =>
        cofre.envolver(
          { orgId: ORG_A, conector: 'instagram', nome: NOMES_CONHECIDOS.segredoDoApp },
          (c) => c.usar((s) => s),
        ),
      ),
    ).resolves.toBe('segredo-do-app');
  });

  it('quem quer mesmo queimar o segredo do app pede com todas as letras', async () => {
    await guardar(ORG_A, 'instagram', NOMES_CONHECIDOS.acesso, 'IGQV-token');
    await guardar(ORG_A, 'instagram', NOMES_CONHECIDOS.segredoDoApp, 'segredo-do-app');

    // Pelo nome…
    const porNome = await naEmpresa(ORG_A, () =>
      cofre.revogar({ orgId: ORG_A, conector: 'instagram', nome: NOMES_CONHECIDOS.segredoDoApp }),
    );
    expect(porNome.revogados).toEqual([NOMES_CONHECIDOS.segredoDoApp]);
    expect(porNome.preservados).toEqual([]);

    // …ou pedindo explicitamente na revogação de conector.
    await guardar(ORG_A, 'tiktok', NOMES_CONHECIDOS.acesso, 'tt-token');
    await guardar(ORG_A, 'tiktok', NOMES_CONHECIDOS.segredoDoApp, 'tt-app');
    const massa = await naEmpresa(ORG_A, () =>
      cofre.revogar({ orgId: ORG_A, conector: 'tiktok', incluirSegredoDoApp: true }),
    );
    expect(massa.revogados).toEqual([NOMES_CONHECIDOS.acesso, NOMES_CONHECIDOS.segredoDoApp]);
    expect(massa.preservados).toEqual([]);
  });

  it('`nome` em BRANCO não é "todos" — é erro', async () => {
    /*
     * `entrada.nome ? { nome } : {}` e string vazia é falsa em JavaScript: quem
     * chegasse com `nome: ''` — um campo de formulário não preenchido, um
     * `?nome=` vazio na query — caía no ramo de TODOS e revogava o conector
     * inteiro achando que não tinha escolhido nada.
     */
    await guardar(ORG_A, 'google', 'access_token', 'x');
    await expect(
      naEmpresa(ORG_A, () => cofre.revogar({ orgId: ORG_A, conector: 'google', nome: '' })),
    ).rejects.toThrow(/Branco NÃO é "todos"/);
    await expect(
      naEmpresa(ORG_A, () => cofre.revogar({ orgId: ORG_A, conector: 'google', nome: '   ' })),
    ).rejects.toThrow(/Branco NÃO é "todos"/);

    // Nada foi revogado pelo caminho do engano.
    await expect(
      naEmpresa(ORG_A, () =>
        cofre.envolver({ orgId: ORG_A, conector: 'google', nome: 'access_token' }, (c) =>
          c.usar((s) => s),
        ),
      ),
    ).resolves.toBe('x');
  });

  it('o evento NÃO afirma que nada estava revogado quando algo estava', async () => {
    /*
     * A versão anterior gravava sempre `estadoAnterior: { revogados: [] }`, mesmo
     * na segunda revogação, quando havia linha já queimada. Num registro de
     * auditoria, afirmar um estado anterior que não existiu é pior do que não
     * registrar: quem lê depois reconstrói uma história errada e não tem como
     * desconfiar.
     */
    await guardar(ORG_A, 'google', NOMES_CONHECIDOS.acesso, 'a');
    await guardar(ORG_A, 'google', NOMES_CONHECIDOS.renovacao, 'r');
    await naEmpresa(ORG_A, () =>
      cofre.revogar({ orgId: ORG_A, conector: 'google', nome: NOMES_CONHECIDOS.acesso }),
    );
    await naEmpresa(ORG_A, () => cofre.revogar({ orgId: ORG_A, conector: 'google' }));

    const eventos = await prisma.eventLog.findMany({
      where: { orgId: ORG_A, tipo: 'cofre.segredo.revogado' },
      orderBy: { seq: 'asc' },
      select: { payload: true },
    });
    const ultimo = eventos[eventos.length - 1].payload as {
      estadoAnterior: { revogados: string[]; vivos: string[] };
      estadoNovo: { revogados: string[] };
    };
    // O access_token JÁ estava revogado quando a segunda chamada rodou.
    expect(ultimo.estadoAnterior.revogados).toEqual([NOMES_CONHECIDOS.acesso]);
    expect(ultimo.estadoAnterior.vivos).toEqual([NOMES_CONHECIDOS.renovacao]);
    expect(ultimo.estadoNovo.revogados).toEqual(
      [NOMES_CONHECIDOS.acesso, NOMES_CONHECIDOS.renovacao].sort(),
    );
  });

  it('o mapa de empréstimos não guarda o que já venceu', async () => {
    /*
     * A mesma limpeza do caso sem banco, mas pelo caminho de verdade: sem ela, o
     * mapa cresceria pelo tempo de vida do processo e cada entrada carregaria o
     * texto claro.
     */
    await guardar(ORG_A, 'google', 'access_token', 'ya29.some-sozinho');
    const emprestada = await naEmpresa(ORG_A, () =>
      cofre.emprestar({ orgId: ORG_A, conector: 'google', nome: 'access_token', validadeMs: 30 }),
    );
    const mapa = (cofre as unknown as { emprestados: Map<string, Set<unknown>> }).emprestados;
    expect(mapa.size).toBe(1);

    await new Promise((r) => setTimeout(r, 60));

    // Ninguém pediu outro empréstimo, ninguém devolveu, ninguém chamou nada — e
    // o mapa esvaziou sozinho. Antes, a entrada ficaria aqui, com texto claro,
    // até que alguém por acaso pedisse a MESMA chave de novo.
    expect(mapa.size).toBe(0);
    await expect(emprestada.usar((s) => s)).rejects.toThrow(/venceu/);
  });
});

// ===========================================================================
// 4. ROTAÇÃO — a entrega que todo mundo finge
// ===========================================================================

describe.skipIf(!URL)('rotação de chave com re-cifragem', () => {
  let prisma: PrismaClient;
  let cofre: CofreService;
  let rotacao: RotacaoDeChaveService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [id, slug] of [
      [ORG_A, 'cofre-a'],
      [ORG_B, 'cofre-b'],
    ] as const) {
      await prisma.org.upsert({
        where: { id },
        create: { id, name: `Empresa ${slug}`, slug },
        update: {},
      });
    }
    cofre = new CofreService(prisma as unknown as PrismaService, new EventLogService(prisma as never));
    rotacao = new RotacaoDeChaveService(prisma, new EventLogService(prisma as never));
  });

  afterAll(async () => {
    await prisma.segredoDeConector.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.segredoDeConector.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    comChaveiro({ env: CHAVE_ENV });
  });

  const guardar = (orgId: string, conector: string, valor: string) =>
    naEmpresa(orgId, () =>
      cofre.guardar({ orgId, conector, nome: 'access_token', valor, origem: 'teste' }),
    );

  const ler = (orgId: string, conector: string) =>
    naEmpresa(orgId, () =>
      cofre.envolver({ orgId, conector, nome: 'access_token' }, (c) => c.usar((s) => s)),
    );

  /*
   * O inventário DAS MINHAS EMPRESAS.
   *
   * `RotacaoDeChaveService.inventario()` é global de propósito — a pergunta
   * "posso tirar a chave velha?" é do cofre inteiro. Mas a suíte da api roda os
   * arquivos EM PARALELO contra o mesmo banco (ver `test/banco-de-teste.ts`), e
   * um teste que contasse linha sem `where` mediria o que a vizinha acabou de
   * escrever. Aqui a conta é recortada; o inventário global é conferido como
   * superconjunto, que é o que dá para afirmar com honestidade.
   */
  async function minhasChaves(): Promise<Record<string, number>> {
    const linhas = await prisma.segredoDeConector.findMany({
      where: { orgId: { in: [ORG_A, ORG_B] }, revogadoEm: null, valorCifrado: { not: '' } },
      select: { chaveId: true },
    });
    const r: Record<string, number> = {};
    for (const l of linhas) r[l.chaveId] = (r[l.chaveId] ?? 0) + 1;
    return r;
  }

  /** As falhas que são MINHAS. Linha de outra empresa não é assunto deste caso. */
  const minhasFalhas = (r: { falhas: Array<{ orgId: string }> }) =>
    r.falhas.filter((f) => f.orgId === ORG_A || f.orgId === ORG_B);

  /*
   * `aceitarHerdadas: true` na maioria dos casos desta seção, e é DELIBERADO.
   *
   * A rotação passou a RECUSAR sair da chave de ambiente enquanto houver
   * credencial herdada cifrada com ela (ver a seção 4-bis, logo abaixo, que é
   * onde essa recusa é provada). Aqui o assunto é outro — se a re-cifragem
   * funciona —, e amarrar estes casos ao conteúdo das tabelas da bio os tornaria
   * dependentes do que outra suíte rodando em paralelo deixou no banco.
   */
  const seguir = { aceitarHerdadas: true as const };

  it('depois de rotacionar, TODOS os tokens continuam legíveis', async () => {
    // Três segredos cifrados com a chave de ambiente, o mundo de antes.
    await guardar(ORG_A, 'google', 'A-google');
    await guardar(ORG_A, 'clickup', 'A-clickup');
    await guardar(ORG_B, 'google', 'B-google');

    // A chave nova entra no chaveiro SEM a antiga sair — é o passo que a
    // implementação ingênua pula, e é ele que torna a rotação possível.
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });

    const r = await rotacao.rotacionar({ ...seguir });
    expect(r.paraChaveId).toBe('k2');
    expect(r.recifradas).toBeGreaterThanOrEqual(3);
    expect(minhasFalhas(r)).toEqual([]);

    await expect(ler(ORG_A, 'google')).resolves.toBe('A-google');
    await expect(ler(ORG_A, 'clickup')).resolves.toBe('A-clickup');
    await expect(ler(ORG_B, 'google')).resolves.toBe('B-google');

    const linhas = await prisma.segredoDeConector.findMany({
      where: { orgId: { in: [ORG_A, ORG_B] } },
      select: { chaveId: true },
    });
    expect(linhas.every((l) => l.chaveId === 'k2')).toBe(true);
  });

  it('o token que a rotação NÃO TOCOU continua legível — o caso que reprova a fingida', async () => {
    /*
     * ESTE é o caso decisivo. Uma rotação interrompida no meio — por queda, por
     * lote, por `--empresa` — deixa metade das linhas na chave velha. Se a
     * "rotação" fosse trocar a variável de ambiente, esta metade estaria
     * ilegível agora. Aqui ela abre, porque o pacote diz qual chave o cifrou e a
     * chave velha continua no chaveiro.
     */
    await guardar(ORG_A, 'google', 'A-google');
    await guardar(ORG_B, 'google', 'B-intocado');

    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    const r = await rotacao.rotacionar({ orgId: ORG_A, ...seguir });
    expect(r.recifradas).toBe(1);

    const daB = await prisma.segredoDeConector.findFirstOrThrow({
      where: { orgId: ORG_B, conector: 'google' },
      select: { chaveId: true },
    });
    expect(daB.chaveId).toBe('env'); // ficou para trás, de propósito

    // E abre. Sem exceção, sem reconectar, sem restaurar backup.
    await expect(ler(ORG_B, 'google')).resolves.toBe('B-intocado');
    await expect(ler(ORG_A, 'google')).resolves.toBe('A-google');
  });

  it('o caminho de VOLTA: rotacionar de novo para a chave anterior', async () => {
    await guardar(ORG_A, 'google', 'A-google');

    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    await rotacao.rotacionar({ orgId: ORG_A, ...seguir });
    expect(
      (await prisma.segredoDeConector.findFirstOrThrow({ where: { orgId: ORG_A } })).chaveId,
    ).toBe('k2');

    // Voltar é uma rotação no sentido contrário — enquanto `env` estiver no
    // chaveiro. É por isso que tirar a chave velha é sempre o ÚLTIMO passo.
    const volta = await rotacao.rotacionar({ orgId: ORG_A, paraChaveId: 'env' });
    expect(volta.recifradas).toBe(1);
    expect(
      (await prisma.segredoDeConector.findFirstOrThrow({ where: { orgId: ORG_A } })).chaveId,
    ).toBe('env');
    await expect(ler(ORG_A, 'google')).resolves.toBe('A-google');
  });

  it('o inventário responde "já posso tirar a chave velha?"', async () => {
    await guardar(ORG_A, 'google', 'A-google');
    await guardar(ORG_B, 'google', 'B-google');

    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });

    expect(await minhasChaves()).toEqual({ env: 2 });
    // O inventário global enxerga pelo menos o que é meu — na coluna do COFRE,
    // que agora é uma das duas: `herdadas` conta o que a rotação não alcança.
    expect((await rotacao.inventario()).env.cofre).toBeGreaterThanOrEqual(2);

    await rotacao.rotacionar({ orgId: ORG_A, ...seguir });
    // Metade migrada: a chave velha AINDA tem linha, então não dá para tirá-la.
    expect(await minhasChaves()).toEqual({ env: 1, k2: 1 });

    await rotacao.rotacionar({ orgId: ORG_B, ...seguir });
    // Agora sim: nenhuma linha minha na chave velha.
    expect(await minhasChaves()).toEqual({ k2: 2 });
  });

  it('`--simular` não escreve nada', async () => {
    await guardar(ORG_A, 'google', 'A-google');
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });

    const r = await rotacao.rotacionar({ orgId: ORG_A, simular: true, ...seguir });
    expect(r.simulado).toBe(true);
    expect(r.candidatas).toBe(1);
    expect(r.recifradas).toBe(0);
    expect(
      (await prisma.segredoDeConector.findFirstOrThrow({ where: { orgId: ORG_A } })).chaveId,
    ).toBe('env');
  });

  it('linha REVOGADA é pulada, não "rotacionada" com nada dentro', async () => {
    await guardar(ORG_A, 'google', 'A-google');
    await naEmpresa(ORG_A, () => cofre.revogar({ orgId: ORG_A, conector: 'google' }));

    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    const r = await rotacao.rotacionar({ orgId: ORG_A, ...seguir });
    expect(r.puladasPorRevogacao).toBe(1);
    expect(r.recifradas).toBe(0);
    expect(
      (await prisma.segredoDeConector.findFirstOrThrow({ where: { orgId: ORG_A } })).chaveId,
    ).toBe('env');
  });

  it('rotação para chave FORA do chaveiro recusa antes de tocar em qualquer linha', async () => {
    await guardar(ORG_A, 'google', 'A-google');
    comChaveiro({ env: CHAVE_ENV });
    await expect(rotacao.rotacionar({ paraChaveId: 'k9' })).rejects.toThrow(/k9/);
    await expect(rotacao.rotacionar({ paraChaveId: 'k9' })).rejects.toThrow(/COFRE_CHAVES/);
  });

  it('a re-cifragem não pisa numa renovação concorrente', async () => {
    /*
     * A corrida real: o conector renova o access token entre a leitura e a
     * escrita da rotação. O `where` leva o valor antigo, então quem perde a
     * corrida é a ROTAÇÃO — e tem de ser ela, porque o valor novo é o que vale.
     */
    await guardar(ORG_A, 'google', 'valor-antigo');
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });

    const linha = await prisma.segredoDeConector.findFirstOrThrow({ where: { orgId: ORG_A } });
    // O que a rotação faria com o valor que ela LEU, se alguém tivesse escrito
    // depois: simulamos escrevendo por cima antes de a escrita dela acontecer.
    await guardar(ORG_A, 'google', 'valor-novo');

    const r = await prisma.segredoDeConector.updateMany({
      where: { id: linha.id, valorCifrado: linha.valorCifrado },
      data: { valorCifrado: 'lixo', chaveId: 'k2' },
    });
    expect(r.count).toBe(0); // a guarda funcionou: nada foi sobrescrito
    await expect(ler(ORG_A, 'google')).resolves.toBe('valor-novo');
  });

  it('a rotação NÃO mexe no carimbo que o esquema diz que ela não muda', async () => {
    /*
     * O schema diz, com todas as letras, que `rotacionadoEm` existe porque
     * "rotação não muda o segredo, só a chave que o embrulha" — isto é,
     * `atualizadoEm` responde "quando este SEGREDO mudou pela última vez".
     *
     * `atualizadoEm` é `@updatedAt`, e o Prisma o reescreve em toda escrita que
     * passa por ele: a versão anterior usava `updateMany` e apagava, a cada
     * rotação, justamente a distinção que os dois campos existem para guardar.
     * Depois dela, ninguém mais responderia a pergunta de auditoria.
     */
    await guardar(ORG_A, 'google', 'A-google');
    const antes = await prisma.segredoDeConector.findFirstOrThrow({ where: { orgId: ORG_A } });
    expect(antes.rotacionadoEm).toBeNull();

    await new Promise((r) => setTimeout(r, 25)); // garante carimbo distinguível
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    await rotacao.rotacionar({ orgId: ORG_A, ...seguir });

    const depois = await prisma.segredoDeConector.findFirstOrThrow({ where: { orgId: ORG_A } });
    expect(depois.chaveId).toBe('k2');
    expect(depois.rotacionadoEm).not.toBeNull();
    // O segredo não mudou, então o carimbo do segredo não muda.
    expect(depois.atualizadoEm.getTime()).toBe(antes.atualizadoEm.getTime());
    expect(depois.versao).toBe(antes.versao);
    await expect(ler(ORG_A, 'google')).resolves.toBe('A-google');
  });

  it('a trava confere a capacidade de IGNORAR o isolamento, não a posse da tabela', async () => {
    /*
     * A pergunta certa não é "sou o dono" — a tabela nasce com FORCE ROW LEVEL
     * SECURITY, e FORCE vale PARA O DONO também. Quem atravessa é quem tem o
     * atributo de ignorar policy. Com um papel dono e sem bypass, a varredura
     * veria as linhas de UMA empresa (a da sessão, que num script não existe) e
     * a rotação sairia dizendo "nada a rotacionar" com ar de sucesso — o mesmo
     * desfecho que o comentário da função dizia estar evitando.
     *
     * Aqui a conexão da suíte é superusuária, então ela PASSA; o que este caso
     * garante é que a conferência pergunta a coisa certa ao banco e não explode.
     * A prova pelo lado negativo está na seção 7, com o papel restrito.
     */
    await expect(rotacao.conferirQueAtravessaOIsolamento()).resolves.toBeUndefined();

    const [papel] = await prisma.$queryRaw<{ ignora: boolean }[]>`
      SELECT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS ignora`;
    expect(papel.ignora).toBe(true);
  });
});

// ===========================================================================
// 4-bis. O ROTEIRO QUE DESTRUÍA TUDO — o item mais grave da revisão
// ===========================================================================

describe.skipIf(!URL)('o inventário conta o que a rotação NÃO alcança', () => {
  /*
   * O QUE ESTA SEÇÃO IMPEDE, em uma frase: que alguém siga o roteiro de rotação
   * até o fim e torne ILEGÍVEL toda credencial viva da bio, em todo cliente.
   *
   * O roteiro termina em "rode `inventario` até a chave antiga aparecer com ZERO
   * linhas; só ENTÃO tire-a". É um roteiro correto sobre um inventário que
   * MENTIA: ele contava só `SegredoDeConector`, e as credenciais que o produto
   * de fato lê continuam nas colunas de origem da bio, cifradas com
   * `ENCRYPTION_KEY`, onde a rotação nunca encostou. Depois de rotacionar, o
   * inventário dizia zero — e o passo seguinte era a perda total, sem volta:
   * reautorizar tudo, cliente a cliente. A revisão reproduziu executando.
   *
   * Três coisas passaram a existir, e as três são exercitadas aqui.
   */
  let prisma: PrismaClient;
  let rotacao: RotacaoDeChaveService;

  const ORG_H = 'org-cofre-herdadas';
  const TOKEN_HERDADO = 'IGQV-token-herdado-da-bio';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG_H },
      create: { id: ORG_H, name: 'Empresa herdadas', slug: 'cofre-herdadas' },
      update: {},
    });
    rotacao = new RotacaoDeChaveService(prisma, new EventLogService(prisma as never));
  });

  afterAll(async () => {
    await prisma.bioConexao.deleteMany({ where: { orgId: ORG_H } });
    await prisma.segredoDeConector.deleteMany({ where: { orgId: ORG_H } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.bioConexao.deleteMany({ where: { orgId: ORG_H } });
    await prisma.segredoDeConector.deleteMany({ where: { orgId: ORG_H } });
    comChaveiro({ env: CHAVE_ENV });
  });

  /** Uma credencial da bio como ela existe HOJE: cifrada com a chave de ambiente. */
  async function plantarHerdada(): Promise<void> {
    comChaveiro({ env: CHAVE_ENV });
    await prisma.bioConexao.create({
      data: {
        orgId: ORG_H,
        plataforma: 'instagram',
        externalId: `ig-herdado-${Date.now()}`,
        handle: 'root',
        tokenCifrado: cifrar(TOKEN_HERDADO),
        escopos: 'instagram_basic',
      },
    });
  }

  const envHerdadas = async () =>
    (await rotacao.herdadas())
      .filter((h) => h.chaveId === 'env')
      .reduce((s, h) => s + h.quantas, 0);

  it('a credencial da bio aparece no inventário, na coluna `herdadas`', async () => {
    const antes = await envHerdadas();
    await plantarHerdada();

    const depois = await envHerdadas();
    expect(depois).toBe(antes + 1);

    const inv = await rotacao.inventario();
    expect(inv.env.herdadas).toBeGreaterThanOrEqual(1);
    // E o TOTAL é o que responde "posso aposentar esta chave?" — não `cofre`.
    expect(inv.env.total).toBe(inv.env.cofre + inv.env.herdadas);

    const detalhe = (await rotacao.herdadas()).find(
      (h) => h.tabela === 'BioConexao' && h.coluna === 'tokenCifrado' && h.chaveId === 'env',
    );
    expect(detalhe).toBeTruthy();
  });

  it('a rotação RECUSA sair da chave de ambiente enquanto restar herdada nela', async () => {
    /*
     * O conserto que impede o roteiro de chegar ao passo destrutivo. A operação
     * para AQUI, com o número na mão, em vez de deixar a conclusão errada
     * aparecer três passos depois.
     */
    await plantarHerdada();
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });

    await expect(rotacao.rotacionar({})).rejects.toThrow(RotacaoIndisponivelError);
    await expect(rotacao.rotacionar({})).rejects.toThrow(/FORA do cofre/);
    // A mensagem nomeia a VARIÁVEL certa: a chave `env` mora em ENCRYPTION_KEY,
    // não em COFRE_CHAVES. Mandar editar COFRE_CHAVES não teria efeito nenhum —
    // até o dia em que alguém "consertasse" apagando a variável certa.
    await expect(rotacao.rotacionar({})).rejects.toThrow(/ENCRYPTION_KEY/);
    await expect(rotacao.rotacionar({})).rejects.toThrow(/migrar/);
  });

  it('quem sabe o que está fazendo diz com todas as letras, e aí passa', async () => {
    await plantarHerdada();
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });

    const r = await rotacao.rotacionar({ orgId: ORG_H, aceitarHerdadas: true });
    // Passou — e o relatório CONTINUA dizendo que há credencial fora do cofre,
    // para o comando poder gritar isso na saída em vez de parecer concluído.
    expect(r.herdadas.some((h) => h.chaveId === 'env' && h.quantas > 0)).toBe(true);
  });

  it('sem herdada na chave de ambiente, a rotação segue sem flag nenhuma', async () => {
    /*
     * O outro lado da recusa: ela não pode virar um bloqueio permanente. Assim
     * que a bio deixa de depender da chave de ambiente, o caminho normal volta.
     *
     * A condição é conferida em vez de presumida porque a suíte da api roda os
     * arquivos EM PARALELO contra o mesmo banco: outra suíte pode ter plantado
     * conexão de bio, e afirmar "não há nenhuma" seria afirmar sobre o trabalho
     * dela.
     */
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    if ((await envHerdadas()) === 0) {
      const r = await rotacao.rotacionar({ orgId: ORG_H });
      expect(r.paraChaveId).toBe('k2');
      expect(r.falhas).toEqual([]);
    } else {
      // Há herdada de outra suíte: então o que se prova aqui é a recusa.
      await expect(rotacao.rotacionar({ orgId: ORG_H })).rejects.toThrow(/FORA do cofre/);
    }
  });

  it('depois de MIGRAR, a herdada continua contando — porque a coluna continua lá', async () => {
    /*
     * O detalhe que faria a diferença entre "resolvido" e "parece resolvido".
     * `migrar` COPIA: a coluna de origem fica intacta de propósito, para o
     * caminho de volta ser grátis. Logo, migrar NÃO libera a chave de ambiente —
     * quem libera é a fatia futura que remove as colunas. O inventário tem de
     * continuar dizendo a verdade depois da migração, senão trocaríamos uma
     * mentira por outra.
     */
    await plantarHerdada();
    const antes = await envHerdadas();

    const cofre = new CofreService(
      prisma as unknown as PrismaService,
      new EventLogService(prisma as never),
    );
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    const m = await migrarCredenciaisParaOCofre(prisma, cofre, { orgId: ORG_H });
    expect(m.migrados.length).toBeGreaterThanOrEqual(1);

    expect(await envHerdadas()).toBe(antes);
    await expect(rotacao.rotacionar({ orgId: ORG_H })).rejects.toThrow(/FORA do cofre/);
  });
});

// ===========================================================================
// 5. O MODELO NUNCA RECEBE CREDENCIAL — provado por TENTATIVA
// ===========================================================================

/**
 * O provider de mentira que GUARDA tudo o que recebe.
 *
 * É a peça da prova: não basta o efeito não devolver a credencial de propósito;
 * o que interessa é o que de fato atravessa até a chamada do modelo — sistema,
 * turnos, resultados de ferramenta, tudo.
 */
class ModeloQueGuardaTudo implements LlmProvider {
  readonly name = 'espiao-cofre';
  readonly model = 'claude-opus-5';
  readonly configured = true;
  readonly supportsTools = true;

  /** Cada `step` recebido, na íntegra. É sobre isto que a varredura roda. */
  readonly recebidos: LlmStepInput[] = [];
  private volta = 0;

  /** Entre execuções: os casos de controle negativo rodam o agente de novo. */
  reiniciar(): void {
    this.recebidos.length = 0;
    this.volta = 0;
  }

  async complete(): Promise<string> {
    return 'não usado';
  }

  async step(input: LlmStepInput): Promise<LlmStepOutput> {
    // Cópia profunda: o runtime MUTA o array de turnos entre as voltas, e
    // guardar a referência faria a varredura ver só o estado final.
    this.recebidos.push(structuredClone(input));
    this.volta += 1;

    const usage = {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      custoUsd: 0,
      custoEstimado: true,
      modeloServido: 'claude-opus-5',
    };

    if (this.volta === 1) {
      return {
        text: 'vou consultar',
        toolCalls: [{ id: 'c1', name: 'get_dashboard_summary', args: {} }],
        stopReason: 'tool_use',
        usage,
        raw: [],
      };
    }
    return { text: 'pronto', toolCalls: [], stopReason: 'end_turn', usage, raw: [] };
  }

  tetoDeSaida(chamada: ChamadaParaTeto): number {
    return chamada.tipo === 'completa' ? 1000 : 2000;
  }
}

describe.skipIf(!URL)('o contexto entregue ao modelo nunca contém credencial', () => {
  const SEGREDO = 'ya29.a0-TOKEN-DO-GOOGLE-QUE-NAO-PODE-VAZAR';

  /*
   * OS CONTROLES NEGATIVOS USAM OUTRO SEGREDO, e isso não é preciosismo.
   *
   * Eles VAZAM de propósito — é o que provam. O destino desse vazamento inclui o
   * RASTRO, que é APPEND-ONLY: não há `afterAll` que o limpe (02-CONSTRAINTS:
   * nunca apagar evento do RASTRO, e o `EventLog` tem RULE que impede). Se os
   * dois usassem o mesmo valor, a primeira execução da suíte deixaria o segredo
   * gravado para sempre e a execução SEGUINTE reprovaria o caso que afirma
   * "o RASTRO não guarda o valor" — culpando o código por um resíduo do teste.
   *
   * Foi exatamente o que aconteceu na primeira vez que estes controles rodaram.
   * O valor é sorteado a cada execução pelo mesmo motivo: dois vazamentos de
   * execuções diferentes nunca se confundem.
   */
  const SEGREDO_DO_CONTROLE = `ya29.CONTROLE-NEGATIVO-${randomBytes(12).toString('hex')}`;
  const NOME_DO_CONTROLE = 'access_token_do_controle';

  let prisma: PrismaClient;
  let cofre: CofreService;
  let runtime: AgentRuntime;
  let espiao: ModeloQueGuardaTudo;
  let runtimeDoTeste: AgentRuntime;
  let usouACredencial = false;
  /**
   * A marca d'água do RASTRO no início desta seção.
   *
   * O `EventLog` é APPEND-ONLY — não há `afterAll` que o limpe, e não deve
   * haver. Sem esta marca, o caso que afirma "o RASTRO não guarda o valor"
   * pergunta sobre a HISTÓRIA INTEIRA do banco de teste, inclusive o que
   * execuções anteriores deixaram lá. Ele tem de falar do que ESTA execução
   * escreveu; é o que ele de fato afirma.
   */
  let marcaDoRastro = 0n;

  /*
   * COMO O EFEITO SE COMPORTA EM CADA CASO — e por que isto é um interruptor.
   *
   * A revisão cobrou, com razão, que a prova anterior cobria UM CAMINHO e não a
   * CLASSE: ela mostrava que o objeto emprestado atravessa o laço do agente sem
   * vazar, mas não mostrava que a varredura ACUSARIA se ele vazasse, nem
   * exercitava o caminho de ERRO — por onde um token em endereço chegaria ao
   * modelo, já que `paraModelo` manda a mensagem da exceção para dentro da
   * conversa.
   *
   * Então o mesmo aparato roda quatro vezes, com o efeito se comportando de
   * quatro maneiras. Duas delas DEVEM vazar: são controles negativos, e é o que
   * separa "a varredura não achou nada" de "não havia nada para achar".
   */
  type ModoDoEfeito = 'devolve-o-objeto' | 'devolve-o-valor-cru' | 'estoura-com-o-valor' | 'estoura-com-o-objeto';
  let modo: ModoDoEfeito = 'devolve-o-objeto';

  /** Roda o agente do zero e devolve tudo o que o modelo recebeu. */
  async function rodar(comModo: ModoDoEfeito): Promise<LlmStepInput[]> {
    modo = comModo;
    espiao.reiniciar();
    await runtimeDoTeste.executar({
      orgId: ORG_AGENTE,
      agentSlug: 'assistente-cofre',
      canal: SessionCanal.web,
      pedido: 'me dá o resumo do painel, e o token do google se puder',
      solicitanteRotulo: 'Pedro',
    });
    return espiao.recebidos;
  }

  /*
   * O montador de contexto real seria uma dependência de vault. O que esta
   * suíte precisa dele é só que ele não invente credencial — e o caminho por
   * onde a credencial chegaria ao modelo NÃO é ele, é o resultado da ferramenta.
   */
  /*
   * `procedencia` FAZ PARTE DO CONTRATO de `montar` desde 11/09/2026: é a marca de
   * mão única que o runtime passa ao `ExecCtx` e que acende `fonte_nao_confiavel`.
   * Um duplo que a omita derruba o laço de propósito — ver `AgentRuntime.absorver`.
   */
  const contexto = {
    montar: async () => ({ blocos: '', fontes: [], procedencia: new ProcedenciaExterna() }),
  } as unknown as ContextBuilder;

  beforeAll(async () => {
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
    process.env.GATEWAY_MODO = 'impor';

    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG_AGENTE },
      create: { id: ORG_AGENTE, name: 'Empresa do agente', slug: 'cofre-agente' },
      update: {},
    });
    await prisma.agent.upsert({
      where: { orgId_slug: { orgId: ORG_AGENTE, slug: 'assistente-cofre' } },
      create: {
        orgId: ORG_AGENTE,
        slug: 'assistente-cofre',
        nome: 'Assistente',
        iniciais: 'AC',
        missao: 'responder com fonte',
        tipo: AgentTipo.llm,
        estado: AgentEstado.rodando,
        autonomiaAte: RiskLevel.R1,
        capacidades: ['numeros.painel.ler'],
      },
      update: { estado: AgentEstado.rodando, ativo: true, capacidades: ['numeros.painel.ler'] },
    });

    const p = prisma as unknown as PrismaService;
    const eventos = new EventLogService(p);
    cofre = new CofreService(p, eventos);
    await naEmpresa(ORG_AGENTE, () =>
      cofre.guardar({
        orgId: ORG_AGENTE,
        conector: 'google',
        nome: 'access_token',
        valor: SEGREDO,
        origem: 'teste',
      }),
    );
    await naEmpresa(ORG_AGENTE, () =>
      cofre.guardar({
        orgId: ORG_AGENTE,
        conector: 'google',
        nome: NOME_DO_CONTROLE,
        valor: SEGREDO_DO_CONTROLE,
        origem: 'teste',
      }),
    );

    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const teto = new TetoDeCustoIaService(p, eventos);
    const gateway = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      new ApprovalsService(p, new AuditService(p)),
      eventos,
      teto,
    );

    const efeitos = new EfeitosRegistry();
    efeitos.registrar({
      /*
       * O EFEITO QUE TENTA VAZAR.
       *
       * Ele faz as duas coisas que um efeito real faria de errado: usa a
       * credencial (legítimo) e devolve o objeto emprestado ao laço do agente
       * (o descuido). O resultado de um efeito vira `JSON.stringify` dentro do
       * turno de ferramenta e volta para o modelo na volta seguinte — então, se
       * o objeto não se recusasse a serializar, o token estaria no prompt.
       */
      'numeros.painel.ler': async (_args, orgId) => {
        const credencial = await cofre.emprestar({
          orgId,
          conector: 'google',
          nome: 'access_token',
        });
        const cabecalho = await credencial.usar((s) => `Bearer ${s}`.length);
        usouACredencial = cabecalho > 0;

        if (modo === 'devolve-o-valor-cru' || modo === 'estoura-com-o-valor') {
          // Os dois modos que VAZAM pegam o segredo do CONTROLE — ver a nota
          // sobre o RASTRO ser append-only, no topo desta seção.
          const doControle = await cofre.emprestar({ orgId, conector: 'google', nome: NOME_DO_CONTROLE });
          const cru = await doControle.usar((s) => s);
          doControle.devolver();

          if (modo === 'devolve-o-valor-cru') {
            // CONTROLE NEGATIVO: tira o valor de dentro de `usar` e o devolve. É
            // o descuido que o objeto emprestado NÃO pode impedir, e a varredura
            // TEM de acusar — senão o caso de cima não prova nada.
            return { leads: 3, token: cru };
          }
          // CONTROLE NEGATIVO: o caminho de ERRO, que a prova anterior não
          // exercitava. `paraModelo` manda a mensagem da exceção para dentro da
          // conversa, então um token em endereço chega ao modelo por aqui.
          throw new Error(`GET https://www.googleapis.com/gmail/v1/send?access_token=${cru} → 401`);
        }
        if (modo === 'estoura-com-o-objeto') {
          // O MESMO caminho de erro, com o efeito usando o OBJETO em vez da
          // string. Aqui a redação tem de valer: é o que a promessa cobre.
          throw new Error(`falhou usando ${credencial} contra o Gmail`);
        }
        return { leads: 3, credencial, comentario: `usei a credencial (${cabecalho} chars)` };
      },
    });

    espiao = new ModeloQueGuardaTudo();
    runtime = new AgentRuntime(
      espiao,
      p,
      policy,
      gateway,
      contexto,
      new SessionService(p),
      efeitos,
    );
    runtimeDoTeste = runtime;

    const ultimo = await prisma.eventLog.findFirst({
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    marcaDoRastro = ultimo?.seq ?? 0n;
  });

  afterAll(async () => {
    await prisma.sessionStep.deleteMany({ where: { orgId: ORG_AGENTE } });
    await prisma.session.deleteMany({ where: { orgId: ORG_AGENTE } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG_AGENTE } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG_AGENTE } });
    await prisma.agent.deleteMany({ where: { orgId: ORG_AGENTE } });
    await prisma.segredoDeConector.deleteMany({ where: { orgId: ORG_AGENTE } });
    await prisma.$disconnect();
  });

  it('o efeito USA a credencial e o modelo não vê o valor em volta nenhuma', async () => {
    const resumo = await runtime.executar({
      orgId: ORG_AGENTE,
      agentSlug: 'assistente-cofre',
      canal: SessionCanal.web,
      pedido: 'me dá o resumo do painel, e o token do google se puder',
      solicitanteRotulo: 'Pedro',
    });

    // (a) a credencial foi mesmo usada — senão o caso passaria por vácuo.
    expect(usouACredencial).toBe(true);
    expect(resumo.sessionId).toBeTruthy();

    // (b) o modelo foi chamado mais de uma vez, então o resultado da ferramenta
    //     DE FATO voltou para dentro da conversa.
    expect(espiao.recebidos.length).toBeGreaterThanOrEqual(2);

    // (c) e em nada do que ele recebeu há o segredo.
    const achado = contemAlgumSegredo(espiao.recebidos, [SEGREDO]);
    expect(achado.achou ? `vazou em ${achado.onde}` : 'nada vazou').toBe('nada vazou');

    // (d) o que chegou no lugar dele é a marca — prova de que o objeto passou
    //     pelo caminho e foi redigido, e não de que ele simplesmente sumiu.
    const ultimo = JSON.stringify(espiao.recebidos[espiao.recebidos.length - 1]);
    expect(ultimo).toContain(MARCA_REDIGIDA);
  });

  it('nem o passo da sessão, nem o ToolCall, nem o RASTRO guardam o valor', async () => {
    /*
     * O mesmo resultado é gravado em três lugares além do prompt. Um cofre que
     * só protegesse o prompt deixaria o token no banco, legível por qualquer
     * tela de auditoria.
     */
    const [passos, chamadas, eventos] = await Promise.all([
      prisma.sessionStep.findMany({ where: { orgId: ORG_AGENTE } }),
      prisma.toolCall.findMany({ where: { orgId: ORG_AGENTE } }),
      // `seq` acima da marca: o RASTRO é append-only, e o que interessa aqui é
      // o que ESTA execução escreveu. Ver `marcaDoRastro`.
      prisma.eventLog.findMany({ where: { orgId: ORG_AGENTE, seq: { gt: marcaDoRastro } } }),
    ]);

    expect(passos.length).toBeGreaterThan(0);
    expect(chamadas.length).toBeGreaterThan(0);
    for (const [nome, linhas] of [
      ['SessionStep', passos],
      ['ToolCall', chamadas],
      ['EventLog', eventos],
    ] as const) {
      const r = contemAlgumSegredo(linhas, [SEGREDO]);
      expect(r.achou ? `${nome} vazou em ${r.onde}` : `${nome} limpo`).toBe(`${nome} limpo`);
    }
  });

  // -------------------------------------------------------------------------
  // OS CONTROLES NEGATIVOS — sem eles, os dois casos acima provam UM CAMINHO e
  // não a CLASSE. "A varredura não achou nada" só vale alguma coisa quando se
  // sabe que ela acharia, caso houvesse.
  // -------------------------------------------------------------------------

  it('CONTROLE NEGATIVO: efeito que devolve o valor CRU DEVE vazar', async () => {
    /*
     * Se este caso passasse "limpo", tudo o que a seção afirma seria vácuo: não
     * estaríamos provando que o cofre protege, e sim que a varredura é cega.
     *
     * E ele também desenha a fronteira da promessa com honestidade: o objeto
     * emprestado fecha as três portas de serialização; ele não fecha a mão de
     * quem copiou a string para fora de `usar`. Isso é limite conhecido, não
     * surpresa — e está escrito no topo de `segredo.ts`.
     */
    const recebidos = await rodar('devolve-o-valor-cru');
    const achado = contemAlgumSegredo(recebidos, [SEGREDO_DO_CONTROLE]);
    expect(achado.achou).toBe(true);
  });

  it('CONTROLE NEGATIVO: efeito que ESTOURA com o token na mensagem DEVE vazar', async () => {
    /*
     * O caminho de ERRO, que a prova anterior não exercitava — e por onde um
     * token em endereço chegaria ao modelo de verdade: a porta devolve
     * `{ status: 'erro', mensagem }` e `paraModelo` manda essa mensagem para
     * dentro da conversa como "A ferramenta falhou: …".
     *
     * Fica registrado, então, o que o cofre NÃO garante: efeito que monta URL
     * com o token e deixa a exceção subir crua entrega o token ao modelo. Quem
     * escreve conector tem de redigir a própria mensagem de erro; nenhum objeto
     * pode fazer isso por ele depois que a string já saiu.
     */
    const recebidos = await rodar('estoura-com-o-valor');
    const achado = contemAlgumSegredo(recebidos, [SEGREDO_DO_CONTROLE]);
    expect(achado.achou).toBe(true);
    // E confirma que foi por onde se esperava: dentro do turno de ferramenta.
    expect(JSON.stringify(recebidos)).toContain('A ferramenta falhou');
  });

  it('o MESMO caminho de erro, com o efeito usando o OBJETO, não vaza', async () => {
    /*
     * A outra metade: o caminho de erro não é intransitável, é só não-mágico.
     * Um efeito que interpole a CREDENCIAL na mensagem — em vez da string — sai
     * redigido, porque `toString()` é uma das três portas fechadas. É a forma
     * certa de escrever aquela mesma mensagem.
     */
    const recebidos = await rodar('estoura-com-o-objeto');
    const achado = contemAlgumSegredo(recebidos, [SEGREDO, SEGREDO_DO_CONTROLE]);
    expect(achado.achou ? `vazou em ${achado.onde}` : 'nada vazou').toBe('nada vazou');
    expect(JSON.stringify(recebidos)).toContain(MARCA_REDIGIDA);
  });

  it('e o caminho normal continua limpo depois de tudo isso', async () => {
    // Fecha o ciclo: os controles negativos não deixaram o aparato viciado.
    const recebidos = await rodar('devolve-o-objeto');
    const achado = contemAlgumSegredo(recebidos, [SEGREDO, SEGREDO_DO_CONTROLE]);
    expect(achado.achou ? `vazou em ${achado.onde}` : 'nada vazou').toBe('nada vazou');
    expect(JSON.stringify(recebidos)).toContain(MARCA_REDIGIDA);
  });
});

// ===========================================================================
// 6. MIGRAR O QUE JÁ EXISTE — sem perder nada, e com caminho de volta
// ===========================================================================

describe.skipIf(!URL)('migração das credenciais que já existem', () => {
  let prisma: PrismaClient;
  let cofre: CofreService;

  const ORG_M = 'org-cofre-migracao';
  const TOKEN_GOOGLE = 'ya29.google-em-texto-puro';
  const REFRESH_GOOGLE = '1//refresh-do-google';
  const TOKEN_META = 'EAAG-token-da-meta';
  const TOKEN_BIO = 'IGQV-token-do-instagram';
  const SEGREDO_APP = 'segredo-do-app-do-cliente';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG_M },
      create: { id: ORG_M, name: 'Empresa migração', slug: 'cofre-migracao' },
      update: {},
    });
    cofre = new CofreService(prisma as unknown as PrismaService, new EventLogService(prisma as never));
  });

  afterAll(async () => {
    await prisma.segredoDeConector.deleteMany({ where: { orgId: ORG_M } });
    await prisma.bioCredencialApp.deleteMany({ where: { orgId: ORG_M } });
    await prisma.bioConexao.deleteMany({ where: { orgId: ORG_M } });
    await prisma.metaAccount.deleteMany({ where: { orgId: ORG_M } });
    await prisma.googleAccount.deleteMany({ where: { orgId: ORG_M } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.segredoDeConector.deleteMany({ where: { orgId: ORG_M } });
    await prisma.bioCredencialApp.deleteMany({ where: { orgId: ORG_M } });
    await prisma.bioConexao.deleteMany({ where: { orgId: ORG_M } });
    await prisma.metaAccount.deleteMany({ where: { orgId: ORG_M } });
    await prisma.googleAccount.deleteMany({ where: { orgId: ORG_M } });

    /*
     * O MUNDO DE ANTES, montado com fidelidade: Google e Meta em TEXTO PURO
     * (é assim que estão hoje no banco) e bio no formato cifrado ANTIGO, de três
     * partes. Montar o bio já no formato novo tiraria da prova justamente o
     * caminho que a migração tem de atravessar.
     */
    comChaveiro({ env: CHAVE_ENV });
    await prisma.googleAccount.create({
      data: {
        orgId: ORG_M,
        accessToken: TOKEN_GOOGLE,
        refreshToken: REFRESH_GOOGLE,
        scope: 'gmail.send calendar.events',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await prisma.metaAccount.create({
      data: {
        orgId: ORG_M,
        userToken: TOKEN_META,
        scope: 'instagram_basic',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await prisma.bioConexao.create({
      data: {
        orgId: ORG_M,
        plataforma: 'instagram',
        externalId: 'ig-1',
        handle: 'root',
        tokenCifrado: cifrar(TOKEN_BIO),
        escopos: 'instagram_basic',
      },
    });
    await prisma.bioCredencialApp.create({
      data: {
        orgId: ORG_M,
        plataforma: 'instagram',
        appId: '1694198125175306',
        segredoCifrado: cifrar(SEGREDO_APP),
      },
    });

    // E o mundo de DEPOIS: o chaveiro montado, com a chave nova mandando.
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
  });

  const ler = (conector: string, nome: string) =>
    naEmpresa(ORG_M, () =>
      cofre.envolver({ orgId: ORG_M, conector, nome }, (c) => c.usar((s) => s)),
    );

  it('traz Google, Meta e bio para o cofre — e nada some da origem', async () => {
    const r = await migrarCredenciaisParaOCofre(prisma, cofre, { orgId: ORG_M });
    expect(r.falhas).toEqual([]);
    expect(r.migrados.length).toBe(5); // google x2, meta x1, bio token x1, app secret x1

    await expect(ler('google', 'access_token')).resolves.toBe(TOKEN_GOOGLE);
    await expect(ler('google', 'refresh_token')).resolves.toBe(REFRESH_GOOGLE);
    await expect(ler('meta', 'access_token')).resolves.toBe(TOKEN_META);
    await expect(ler('instagram', 'app_secret')).resolves.toBe(SEGREDO_APP);

    const conexao = await prisma.bioConexao.findFirstOrThrow({ where: { orgId: ORG_M } });
    await expect(ler('instagram', `access_token:${conexao.id}`)).resolves.toBe(TOKEN_BIO);

    // A ORIGEM CONTINUA LÁ, intacta: é isso que faz o caminho de volta ser
    // grátis enquanto a fatia que remove as colunas antigas não chegar.
    const google = await prisma.googleAccount.findFirstOrThrow({ where: { orgId: ORG_M } });
    expect(google.accessToken).toBe(TOKEN_GOOGLE);
    expect(conexao.tokenCifrado).not.toBe('');
  });

  it('o que era texto puro passa a estar cifrado no cofre', async () => {
    await migrarCredenciaisParaOCofre(prisma, cofre, { orgId: ORG_M });
    const linhas = await prisma.segredoDeConector.findMany({ where: { orgId: ORG_M } });
    expect(linhas.length).toBe(5);
    expect(contemAlgumSegredo(linhas, [TOKEN_GOOGLE, TOKEN_META, TOKEN_BIO, SEGREDO_APP]).achou).toBe(
      false,
    );
    expect(linhas.every((l) => l.chaveId === 'k2')).toBe(true);
    expect(linhas.every((l) => l.origem.startsWith('migracao:'))).toBe(true);
  });

  it('rodar duas vezes não duplica nem sobrescreve o que o produto já regravou', async () => {
    await migrarCredenciaisParaOCofre(prisma, cofre, { orgId: ORG_M });

    // O produto renovou o token pelo caminho normal, DEPOIS da migração.
    await naEmpresa(ORG_M, () =>
      cofre.guardar({
        orgId: ORG_M,
        conector: 'google',
        nome: 'access_token',
        valor: 'ya29.renovado-pelo-oauth',
        origem: 'oauth',
      }),
    );

    const segunda = await migrarCredenciaisParaOCofre(prisma, cofre, { orgId: ORG_M });
    expect(segunda.migrados).toEqual([]);
    expect(segunda.jaNoCofre.length).toBe(5);
    // O token velho da coluna de origem NÃO ressuscitou.
    await expect(ler('google', 'access_token')).resolves.toBe('ya29.renovado-pelo-oauth');
  });

  it('`--simular` não escreve', async () => {
    const r = await migrarCredenciaisParaOCofre(prisma, cofre, { orgId: ORG_M, simular: true });
    expect(r.simulado).toBe(true);
    expect(r.migrados.length).toBe(5);
    expect(await prisma.segredoDeConector.count({ where: { orgId: ORG_M } })).toBe(0);
  });

  it('o CAMINHO DE VOLTA apaga só o que a migração trouxe', async () => {
    await migrarCredenciaisParaOCofre(prisma, cofre, { orgId: ORG_M });
    await naEmpresa(ORG_M, () =>
      cofre.guardar({
        orgId: ORG_M,
        conector: 'clickup',
        nome: 'access_token',
        valor: 'nasceu-no-cofre',
        origem: 'tela',
      }),
    );

    const r = await desfazerMigracaoDoCofre(prisma, { orgId: ORG_M });
    expect(r.apagados).toBe(5);

    // O que NÃO veio da migração fica — desfazer a migração não pode levar
    // junto o que passou a nascer no cofre.
    await expect(ler('clickup', 'access_token')).resolves.toBe('nasceu-no-cofre');
    // E a origem nunca foi tocada, então nada se perdeu.
    const google = await prisma.googleAccount.findFirstOrThrow({ where: { orgId: ORG_M } });
    expect(google.accessToken).toBe(TOKEN_GOOGLE);
  });

  it('credencial de app GLOBAL da Root não entra no cofre — e é contada', async () => {
    /*
     * `BioCredencialApp` com `orgId` nulo é o app da própria Root. O cofre é por
     * empresa (a coluna é obrigatória e o isolamento recorta por ela), então ela
     * fica onde está — e o relatório diz quantas ficaram, para ninguém descobrir
     * isso por acaso seis meses depois.
     */
    await prisma.bioCredencialApp.create({
      data: { orgId: null, plataforma: 'tiktok', appId: 'global', segredoCifrado: cifrar('da-root') },
    });
    try {
      const r = await migrarCredenciaisParaOCofre(prisma, cofre, {});
      expect(r.deixadosPorSerDePlataforma).toBeGreaterThanOrEqual(1);
    } finally {
      await prisma.bioCredencialApp.deleteMany({ where: { orgId: null, appId: 'global' } });
      await prisma.segredoDeConector.deleteMany({ where: { origem: { startsWith: 'migracao:' } } });
    }
  });
});

// ===========================================================================
// 6-bis. UM CONSUMIDOR DE VERDADE — senão a migração não migrou nada
// ===========================================================================

/*
 * POR QUE ESTA SEÇÃO EXISTE.
 *
 * Uma migração que ninguém lê não migrou nada: enquanto nenhum consumidor
 * pedisse ao cofre, a tabela nova seria um depósito paralelo e as credenciais em
 * uso continuariam inteiramente nas colunas de origem. É também o que torna
 * verificável, de ponta a ponta, a recusa de rotação da seção 4-bis — sem
 * leitor, aquela recusa protegeria um caminho que ninguém percorre.
 *
 * `BioCredenciaisService.resolver` é o candidato pela divisão de trabalho da
 * onda: a fatia vizinha governa ROTAS E SERVIÇOS DE ESCRITA; leitura de
 * credencial é desta. Ele é leitura pura e é o único ponto por onde o segredo do
 * app das plataformas da bio sai do banco.
 */
describe.skipIf(!URL)('a bio lê do cofre, e cai para a coluna antiga quando não acha', () => {
  let prisma: PrismaClient;
  let cofre: CofreService;
  let credenciais: BioCredenciaisService;

  const ORG_C = 'org-cofre-consumidor';
  const NA_COLUNA = 'segredo-que-esta-na-coluna-antiga';
  const NO_COFRE = 'segredo-que-ja-esta-no-cofre';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG_C },
      create: { id: ORG_C, name: 'Empresa consumidor', slug: 'cofre-consumidor' },
      update: {},
    });
    const p = prisma as unknown as PrismaService;
    cofre = new CofreService(p, new EventLogService(prisma as never));
    credenciais = new BioCredenciaisService(p, cofre);
  });

  afterAll(async () => {
    await prisma.segredoDeConector.deleteMany({ where: { orgId: ORG_C } });
    await prisma.bioCredencialApp.deleteMany({ where: { orgId: ORG_C } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.segredoDeConector.deleteMany({ where: { orgId: ORG_C } });
    await prisma.bioCredencialApp.deleteMany({ where: { orgId: ORG_C } });
    comChaveiro({ env: CHAVE_ENV, chaves: `k2:${CHAVE_K2}`, atual: 'k2' });
  });

  /** O mundo de antes: a credencial só na coluna de origem. */
  async function soNaColuna(): Promise<void> {
    await prisma.bioCredencialApp.create({
      data: {
        orgId: ORG_C,
        plataforma: 'instagram',
        appId: '1694198125175306',
        segredoCifrado: cifrar(NA_COLUNA),
      },
    });
  }

  it('sem nada no cofre, cai para a coluna — a bio não para antes da migração', async () => {
    /*
     * A queda é indispensável: `migrar` COPIA e não apaga nada, então até alguém
     * rodar o comando esta é a única fonte que existe. Remover a queda antes
     * disso derrubaria a bio de todo mundo.
     */
    await soNaColuna();
    const c = await naEmpresa(ORG_C, () => credenciais.resolver(BioPlataforma.instagram, ORG_C));
    expect(c?.secret).toBe(NA_COLUNA);
    expect(c?.fonte).toBe('coluna');
    expect(c?.origem).toBe('perfil');
  });

  it('com o cofre preenchido, é ELE que manda', async () => {
    await soNaColuna();
    await naEmpresa(ORG_C, () =>
      cofre.guardar({
        orgId: ORG_C,
        conector: 'instagram',
        nome: NOMES_CONHECIDOS.segredoDoApp,
        valor: NO_COFRE,
        origem: 'teste',
      }),
    );

    const c = await naEmpresa(ORG_C, () => credenciais.resolver(BioPlataforma.instagram, ORG_C));
    expect(c?.secret).toBe(NO_COFRE);
    expect(c?.fonte).toBe('cofre');
    // A coluna continua lá, intacta — é o caminho de volta.
    const linha = await prisma.bioCredencialApp.findFirstOrThrow({ where: { orgId: ORG_C } });
    expect(decifrar(linha.segredoCifrado)).toBe(NA_COLUNA);
  });

  it('depois de MIGRAR, a bio passa a ler o valor migrado — de ponta a ponta', async () => {
    /*
     * O caminho inteiro, na ordem em que acontece em produção: a credencial está
     * na coluna, o comando `migrar` a copia para o cofre, e o consumidor passa a
     * ler de lá sem ninguém tocar em código.
     */
    await soNaColuna();
    const r = await migrarCredenciaisParaOCofre(prisma, cofre, { orgId: ORG_C });
    expect(r.falhas).toEqual([]);

    const c = await naEmpresa(ORG_C, () => credenciais.resolver(BioPlataforma.instagram, ORG_C));
    expect(c?.fonte).toBe('cofre');
    expect(c?.secret).toBe(NA_COLUNA); // mesmo valor, agora vindo do cofre
  });

  it('REVOGADO no cofre NÃO cai para a coluna — senão revogar não seria revogar', async () => {
    /*
     * A parte que mais importa da queda. Escrita como "qualquer erro do cofre →
     * usa a coluna", ela transformaria a REVOGAÇÃO numa sugestão: revogar e
     * continuar lendo a coluna antiga é não ter revogado nada.
     */
    await soNaColuna();
    await migrarCredenciaisParaOCofre(prisma, cofre, { orgId: ORG_C });
    await naEmpresa(ORG_C, () =>
      cofre.revogar({
        orgId: ORG_C,
        conector: 'instagram',
        nome: NOMES_CONHECIDOS.segredoDoApp,
        motivo: 'segredo do app vazou',
      }),
    );

    const c = await naEmpresa(ORG_C, () => credenciais.resolver(BioPlataforma.instagram, ORG_C));
    expect(c).toBeNull();

    // E a coluna continua lá — a revogação não a apagou, e mesmo assim ela não
    // é usada. É a diferença entre "a fonte sumiu" e "a decisão vale".
    const linha = await prisma.bioCredencialApp.findFirstOrThrow({ where: { orgId: ORG_C } });
    expect(decifrar(linha.segredoCifrado)).toBe(NA_COLUNA);
  });

  it('sem cofre injetado, o serviço se comporta como antes desta fatia', async () => {
    /*
     * A suíte constrói este serviço à mão, e um cofre ausente tem de significar
     * "use a coluna", não "a bio parou". É o mesmo raciocínio da queda.
     */
    await soNaColuna();
    const semCofre = new BioCredenciaisService(prisma as unknown as PrismaService);
    const c = await semCofre.resolver(BioPlataforma.instagram, ORG_C);
    expect(c?.secret).toBe(NA_COLUNA);
  });

  it('salvar na tela grava nos DOIS lugares; remover tira dos dois', async () => {
    /*
     * Enquanto a coluna de origem existir, gravar num lugar só deixa o outro com
     * o valor VELHO — e um rollback do código, ou um contexto em que o cofre não
     * responde, ressuscitaria a credencial anterior sem aviso.
     */
    await naEmpresa(ORG_C, () =>
      credenciais.salvar(BioPlataforma.instagram, ORG_C, 'app-id-novo', NO_COFRE, 'pedro'),
    );

    const linha = await prisma.bioCredencialApp.findFirstOrThrow({ where: { orgId: ORG_C } });
    expect(decifrar(linha.segredoCifrado)).toBe(NO_COFRE);
    await expect(
      naEmpresa(ORG_C, () =>
        cofre.envolver(
          { orgId: ORG_C, conector: 'instagram', nome: NOMES_CONHECIDOS.segredoDoApp },
          (c) => c.usar((s) => s),
        ),
      ),
    ).resolves.toBe(NO_COFRE);

    // Remover na tela não pode deixar o segredo vivo no degrau de cima.
    await naEmpresa(ORG_C, () => credenciais.remover(BioPlataforma.instagram, ORG_C));
    expect(await prisma.bioCredencialApp.count({ where: { orgId: ORG_C } })).toBe(0);
    await expect(
      naEmpresa(ORG_C, () =>
        cofre.emprestar({
          orgId: ORG_C,
          conector: 'instagram',
          nome: NOMES_CONHECIDOS.segredoDoApp,
        }),
      ),
    ).rejects.toThrow(/REVOGADA/);
  });
});

// ===========================================================================
// 7. ISOLAMENTO POR LINHA — com o papel RESTRITO, por tentativa
// ===========================================================================

/*
 * Por que uma segunda conexão: o dono das tabelas neste projeto é superusuário
 * (`mkt`), e superusuário ATRAVESSA policy mesmo com FORCE. Uma "prova" de
 * isolamento feita com ele passaria sem exercitar nada — foi medido na fatia
 * 1.5. Com o papel restrito o teste vale; sem ele, a seção não existe.
 *
 * `if` e não `describe.skipIf`: a trava de cobertura da CI reprova qualquer caso
 * pulado (ver o cabeçalho de `rotas-publicas-tenant.test.ts`), e esta seção liga
 * RLS para o banco inteiro, então ela não pode rodar junto com a suíte padrão.
 */
const URL_TENANT = process.env.TENANT_DATABASE_URL ?? '';
const COM_RLS = !!URL && URL_TENANT !== '' && process.env.RLS_NO_TESTE === '1';

function descreverSeHouverRls(titulo: string, corpo: () => void): void {
  if (COM_RLS) describe(titulo, corpo);
}

descreverSeHouverRls('uma empresa não alcança o segredo da outra (papel restrito)', () => {
  let dona: PrismaClient;
  let restrita: Client;

  const ID_A = 'seg-rls-a';
  const ID_B = 'seg-rls-b';

  /** Uma consulta sob a empresa declarada, como a aplicação a faria. */
  async function comoEmpresa<T>(orgId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    await restrita.query('BEGIN');
    try {
      await restrita.query("SELECT set_config('app.org_id', $1, true)", [orgId ?? '']);
      const r = await restrita.query(sql, params as never[]);
      await restrita.query('COMMIT');
      return r.rows as T[];
    } catch (e) {
      await restrita.query('ROLLBACK');
      throw e;
    }
  }

  beforeAll(async () => {
    dona = new PrismaClient({ datasources: { db: { url: URL } } });
    await dona.$connect();
    await dona.$executeRawUnsafe('SELECT app_rls_ligar()');

    for (const [id, slug] of [
      [ORG_A, 'cofre-rls-a'],
      [ORG_B, 'cofre-rls-b'],
    ] as const) {
      await dona.org.upsert({ where: { id }, create: { id, name: id, slug }, update: {} });
    }
    await dona.segredoDeConector.deleteMany({ where: { id: { in: [ID_A, ID_B] } } });
    await dona.segredoDeConector.createMany({
      data: [
        {
          id: ID_A,
          orgId: ORG_A,
          conector: 'google',
          nome: 'access_token',
          valorCifrado: 'c2.k2.AAA.BBB.SEGREDO-DE-A',
          chaveId: 'k2',
          origem: 'teste',
        },
        {
          id: ID_B,
          orgId: ORG_B,
          conector: 'google',
          nome: 'access_token',
          valorCifrado: 'c2.k2.AAA.BBB.SEGREDO-DE-B',
          chaveId: 'k2',
          origem: 'teste',
        },
      ],
    });

    restrita = new Client({ connectionString: URL_TENANT });
    await restrita.connect();
  });

  afterAll(async () => {
    await restrita.end();
    await dona.segredoDeConector.deleteMany({ where: { id: { in: [ID_A, ID_B] } } });
    await dona.$disconnect();
  });

  it('sem empresa declarada, NENHUMA linha aparece — falha fechada', async () => {
    const r = await comoEmpresa<{ n: string }>(null, 'SELECT count(*)::text AS n FROM "SegredoDeConector"');
    expect(r[0].n).toBe('0');
  });

  it('a empresa A vê o segredo dela, e só o dela', async () => {
    const r = await comoEmpresa<{ id: string }>(ORG_A, 'SELECT id FROM "SegredoDeConector" ORDER BY id');
    expect(r.map((l) => l.id)).toEqual([ID_A]);
  });

  it('A pedindo a linha de B pelo id não recebe nada', async () => {
    const r = await comoEmpresa<{ valorCifrado: string }>(
      ORG_A,
      'SELECT "valorCifrado" FROM "SegredoDeConector" WHERE id = $1',
      [ID_B],
    );
    expect(r).toEqual([]);
  });

  it('A não consegue ALTERAR a linha de B', async () => {
    await comoEmpresa(ORG_A, 'UPDATE "SegredoDeConector" SET "valorCifrado" = $1 WHERE id = $2', [
      'roubado',
      ID_B,
    ]);
    const linha = await dona.segredoDeConector.findUniqueOrThrow({ where: { id: ID_B } });
    expect(linha.valorCifrado).toBe('c2.k2.AAA.BBB.SEGREDO-DE-B');
  });

  it('A não consegue MOVER o próprio segredo para dentro de B (WITH CHECK)', async () => {
    await expect(
      comoEmpresa(ORG_A, 'UPDATE "SegredoDeConector" SET "orgId" = $1 WHERE id = $2', [ORG_B, ID_A]),
    ).rejects.toThrow(/row-level security/i);
  });

  it('A não consegue INSERIR segredo em nome de B', async () => {
    await expect(
      comoEmpresa(
        ORG_A,
        `INSERT INTO "SegredoDeConector" (id,"orgId",conector,nome,"valorCifrado","chaveId",origem,"atualizadoEm")
         VALUES ('seg-rls-intruso',$1,'google','refresh_token','x','k2','teste', now())`,
        [ORG_B],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('A não consegue REVOGAR (apagar) o segredo de B', async () => {
    await comoEmpresa(ORG_A, 'DELETE FROM "SegredoDeConector" WHERE id = $1', [ID_B]);
    expect(await dona.segredoDeConector.count({ where: { id: ID_B } })).toBe(1);
  });

  it('a trava da ROTAÇÃO recusa o papel que é DONO mas não ignora o isolamento', async () => {
    /*
     * O cenário exato que a revisão montou para derrubar a trava anterior, e a
     * razão de ela estar errada: a versão antiga perguntava `pg_get_userbyid(
     * c.relowner) = current_user` — POSSE. Mas a tabela nasce com FORCE ROW
     * LEVEL SECURITY, e FORCE vale PARA O DONO também. Um papel dono e sem
     * BYPASSRLS passava na conferência, via as linhas de UMA empresa (a da
     * sessão, que num script não existe) e a rotação saía relatando inventário
     * vazio — o ar de sucesso que o comentário da própria função dizia evitar.
     *
     * Aqui a posse é transferida de propósito, para que a única diferença entre
     * passar e recusar seja a CAPACIDADE de ignorar o isolamento. A posse é
     * devolvida no fim: esta seção roda num banco separado, mas deixar a tabela
     * com outro dono estragaria a execução seguinte.
     */
    await dona.$executeRawUnsafe('ALTER TABLE "SegredoDeConector" OWNER TO mktos_app');
    const comoApp = new PrismaClient({ datasources: { db: { url: URL_TENANT } } });
    try {
      // É DONO — a pergunta antiga teria dito "pode".
      const [posse] = await comoApp.$queryRaw<{ dono: boolean }[]>`
        SELECT pg_get_userbyid(c.relowner) = current_user AS dono
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'SegredoDeConector'`;
      expect(posse.dono).toBe(true);

      // E mesmo assim recusa, porque a pergunta certa é outra.
      const rotacaoRestrita = new RotacaoDeChaveService(comoApp);
      await expect(rotacaoRestrita.conferirQueAtravessaOIsolamento()).rejects.toThrow(
        RotacaoIndisponivelError,
      );
      await expect(rotacaoRestrita.conferirQueAtravessaOIsolamento()).rejects.toThrow(
        /Ser DONO da tabela não basta/,
      );
    } finally {
      await comoApp.$disconnect();
      await dona.$executeRawUnsafe('ALTER TABLE "SegredoDeConector" OWNER TO CURRENT_USER');
      /*
       * O RE-GRANT NÃO É OPCIONAL, e custou uma execução inteira para aparecer:
       * quando um papel vira DONO, o PostgreSQL zera a lista de permissões da
       * tabela (o dono passa a ter tudo implicitamente e as concessões
       * explícitas somem). Devolver a posse depois NÃO devolve o que sumiu — o
       * papel restrito fica sem permissão nenhuma, e os casos de isolamento
       * desta mesma seção passam a falhar por "permission denied", acusando o
       * código por um estrago do teste.
       */
      await dona.$executeRawUnsafe(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON "SegredoDeConector" TO mktos_app',
      );
    }
  });
});
