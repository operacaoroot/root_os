import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lerPolitica, lerDelta, resolverPolitica, type Politica } from '../src/esquema.js';
import {
  afrouxamentosDoDiff,
  canonico,
  diffDePolitica,
  explicarRecusas,
  recusasDaSobrescrita,
  redundanciasDoDelta,
  textosDosAfrouxamentos,
  uniaoDosAfrouxamentos,
  type Afrouxamento,
  type DiffDePolitica,
} from '../src/sobrescrita.js';

/*
 * A SOBRESCRITA POR EMPRESA — RF-P-04 e RF-P-06.
 *
 * Esta suíte cobre a metade PURA da fatia 2.1: o que mudou (diff) e se a
 * mudança pode acontecer sozinha (trava). A metade que grava a versão, com
 * data e responsável, está em `apps/api/test/politica-por-tenant.test.ts`,
 * porque precisa de banco.
 *
 * A base usada aqui é a de verdade — politica-root.json + o delta deste
 * repositório —, e não um catálogo de brinquedo: a trava tem de valer contra o
 * catálogo que roda hoje, com as 51 capacidades que ele tem.
 */

const raiz = fileURLToPath(new URL('..', import.meta.url));
const json = (nome: string) => JSON.parse(readFileSync(raiz + nome, 'utf8'));

const ROOT = lerPolitica(json('politica-root.json'), 'politica-root.json');
const DELTA_DO_REPO = lerDelta(json('politica-marketing-os.json'), 'politica-marketing-os.json');
/** A base que uma empresa herda: ROOT resolvida com o catálogo do produto. */
const BASE = resolverPolitica(ROOT, DELTA_DO_REPO);

/** Um delta de empresa, com o cabeçalho obrigatório e só o que o caso precisa. */
const deltaDaEmpresa = (capacidades: unknown[], limites?: Record<string, unknown>) =>
  lerDelta(
    {
      versao: '1.0.0',
      atualizadoEm: '2026-09-11',
      origem: 'teste',
      descricao: 'sobrescrita de teste',
      estende: 'politica-marketing-os.json',
      capacidades,
      ...(limites ? { limitesPadrao: limites } : {}),
    },
    'teste',
  );

/** A capacidade da base, com os campos trocados — é assim que um cliente edita. */
function comoNaBase(id: string, troca: Record<string, unknown>) {
  const c = BASE.capacidades.find((x) => x.id === id);
  if (!c) throw new Error(`${id} não existe na base`);
  return { ...JSON.parse(JSON.stringify(c)), ...troca };
}

/** O caminho normal: resolver um delta sobre uma referência e diffar. */
const diffDoDelta = (referencia: Politica, capacidades: unknown[], limites?: Record<string, unknown>) =>
  diffDePolitica(referencia, resolverPolitica(referencia, deltaDaEmpresa(capacidades, limites)));

/** A trava sempre come afrouxamentos, nunca um diff: a referência é escolha de quem chama. */
const recusas = (diff: DiffDePolitica, assinatura: Parameters<typeof recusasDaSobrescrita>[1]) =>
  recusasDaSobrescrita(afrouxamentosDoDiff(diff), assinatura);

const textos = (diff: DiffDePolitica) => textosDosAfrouxamentos(afrouxamentosDoDiff(diff));

const ASSINADA = { autorId: 'user-123', motivo: 'decisão registrada na ata de 11/09/2026' };

describe('herdar e sobrescrever apenas o que a operação exigir (RF-P-04)', () => {
  /*
   * O critério da fatia, ao pé da letra: sobrescreveu UMA, continua herdando
   * TODAS as outras. Não é o teste óbvio de "a mudança pegou" — é o teste de
   * que a mudança não levou o resto junto, que é o jeito clássico de um delta
   * quebrar (substituir o array inteiro em vez de casar por id).
   */
  it('sobrescrever uma capacidade não mexe em nenhuma outra', () => {
    const delta = deltaDaEmpresa([
      comoNaBase('operacao.tarefa.alterar', {
        nivel: 'R4',
        efeito: {
          ...BASE.capacidades.find((c) => c.id === 'operacao.tarefa.alterar')!.efeito,
          sensibilidade: 'restrita',
        },
      }),
    ]);
    const resolvida = resolverPolitica(BASE, delta);

    // o catálogo inteiro continua lá, com o mesmo tamanho
    expect(resolvida.capacidades).toHaveLength(BASE.capacidades.length);

    const diff = diffDePolitica(BASE, resolvida);
    expect(diff.capacidades.map((c) => c.id)).toEqual(['operacao.tarefa.alterar']);
    expect(diff.capacidades[0]).toMatchObject({ de: 'R2', para: 'R4', direcao: 'sobe' });
    expect(diff.capacidades[0].campos).toEqual(['efeito', 'nivel']);
    expect(diff.limites).toEqual([]);
    expect(diff.secoes).toEqual([]);

    // e o que ela herdou continua idêntico, campo a campo
    for (const c of BASE.capacidades) {
      if (c.id === 'operacao.tarefa.alterar') continue;
      expect(resolvida.capacidades.find((x) => x.id === c.id)).toEqual(c);
    }
    // inclusive o que não é capacidade: níveis, gatilhos e invariantes
    expect(resolvida.niveis).toEqual(BASE.niveis);
    expect(resolvida.gatilhos).toEqual(BASE.gatilhos);
    expect(resolvida.invariantes).toEqual(BASE.invariantes);
  });

  it('um delta vazio não produz mudança nenhuma', () => {
    const diff = diffDoDelta(BASE, []);
    expect(diff).toEqual({ capacidades: [], limites: [], secoes: [] });
    expect(recusas(diff, {})).toEqual([]);
  });

  /*
   * "Sobrescreve APENAS o que a operação dele exigir" tem um lado que não é
   * proibição e sim dívida: copiar a capacidade idêntica é parar de herdar. No
   * dia em que a base subir aquele nível, a empresa que copiou fica para trás e
   * ninguém percebe.
   */
  it('capacidade copiada idêntica da base é apontada como redundante', () => {
    const delta = deltaDaEmpresa([
      comoNaBase('email.enviar', {}),
      comoNaBase('crm.lead.alterar', { descricao: 'texto da empresa' }),
    ]);
    expect(redundanciasDoDelta(BASE, delta)).toEqual(['email.enviar']);
    // e a que mudou de verdade não é redundante, mesmo mudando só a descrição
    const diff = diffDePolitica(BASE, resolverPolitica(BASE, delta));
    expect(diff.capacidades.map((c) => `${c.id}:${c.campos.join('+')}`)).toEqual([
      'crm.lead.alterar:descricao',
    ]);
    expect(diff.capacidades[0].direcao).toBe('igual');
    expect(afrouxamentosDoDiff(diff)).toEqual([]);
  });
});

describe('rebaixar nível nunca é automático (RF-P-06)', () => {
  /** Rebaixa de verdade: o efeito acompanha, senão o catálogo fica inválido. */
  const rebaixaWhatsapp = [
    comoNaBase('whatsapp.mensagem.enviar', {
      nivel: 'R2',
      efeito: {
        escreveForaDoOS: true,
        produzArtefato: false,
        reversibilidade: 'automatica',
        exposicaoExterna: false,
        impactoFinanceiro: 'nenhum',
        sensibilidade: 'interna',
        destruicao: false,
        obrigacaoLegal: false,
      },
      desfazer: undefined,
    }),
  ];

  const diffQueRebaixa = () => diffDoDelta(BASE, rebaixaWhatsapp);

  it('sem responsável identificado, a sobrescrita é recusada', () => {
    const r = recusas(diffQueRebaixa(), { motivo: 'porque sim, e escrito' });
    expect(r.map((x) => x.motivo)).toEqual(['afrouxamento-sem-responsavel']);
    expect(r[0].itens).toEqual(['whatsapp.mensagem.enviar: R3 → R2']);
    expect(r[0].afrouxamentos[0].tipo).toBe('nivel-rebaixado');
  });

  it('responsável em branco não conta como responsável', () => {
    for (const autorId of ['', '   ', null, undefined]) {
      expect(
        recusas(diffQueRebaixa(), { autorId, motivo: 'motivo bem escrito aqui' }).map(
          (r) => r.motivo,
        ),
      ).toEqual(['afrouxamento-sem-responsavel']);
    }
  });

  /*
   * "Só por configuração ESCRITA" — o motivo é metade do requisito, e é a
   * metade que um chamador automático atropela: `motivo` é NOT NULL no banco,
   * então quem grava sem pensar manda `''` e a coluna aceita.
   */
  it('sem motivo escrito, também é recusada — e as duas faltas saem juntas', () => {
    expect(recusas(diffQueRebaixa(), { autorId: 'user-1', motivo: 'curto' }).map((r) => r.motivo)).toEqual(
      ['afrouxamento-sem-motivo'],
    );
    expect(recusas(diffQueRebaixa(), {}).map((r) => r.motivo)).toEqual([
      'afrouxamento-sem-responsavel',
      'afrouxamento-sem-motivo',
    ]);
  });

  it('com responsável e motivo, o rebaixamento passa', () => {
    expect(recusas(diffQueRebaixa(), ASSINADA)).toEqual([]);
  });

  it('subir nível é automático: não exige responsável nenhum', () => {
    const diff = diffDoDelta(BASE, [
      comoNaBase('crm.lead.alterar', {
        nivel: 'R3',
        efeito: {
          ...BASE.capacidades.find((c) => c.id === 'crm.lead.alterar')!.efeito,
          sensibilidade: 'confidencial',
        },
      }),
    ]);
    expect(diff.capacidades[0].direcao).toBe('sobe');
    expect(afrouxamentosDoDiff(diff)).toEqual([]);
    expect(recusas(diff, {})).toEqual([]);
  });

  /*
   * O desvio óbvio, se `nova` fosse mudança neutra: em vez de rebaixar
   * `whatsapp.mensagem.enviar`, a empresa declara outro id em R0 e manda a
   * mesma mensagem. Capacidade sem classificação vale R5 — declarar uma nova é
   * sempre afrouxar, seja qual for o degrau em que ela entre.
   */
  it('capacidade NOVA conta como afrouxamento, mesmo entrando em R0', () => {
    const diff = diffDoDelta(BASE, [
      {
        id: 'atalho.mensagem.enviar',
        descricao: 'o desvio que a trava tem de pegar',
        nivel: 'R0',
        efeito: {
          escreveForaDoOS: false,
          produzArtefato: false,
          reversibilidade: 'automatica',
          exposicaoExterna: false,
          impactoFinanceiro: 'nenhum',
          sensibilidade: 'interna',
          destruicao: false,
          obrigacaoLegal: false,
        },
      },
    ]);
    expect(diff.capacidades[0]).toMatchObject({ id: 'atalho.mensagem.enviar', de: null, direcao: 'nova' });
    expect(afrouxamentosDoDiff(diff)[0].tipo).toBe('capacidade-nova');
    expect(recusas(diff, {}).map((r) => r.motivo)).toContain('afrouxamento-sem-responsavel');
    expect(recusas(diff, ASSINADA)).toEqual([]);
  });

  it('a recusa diz o que afrouxou, para dar o que consertar', () => {
    const texto = explicarRecusas(recusas(diffQueRebaixa(), {}));
    expect(texto).toContain('RF-P-06');
    expect(texto).toContain('whatsapp.mensagem.enviar: R3 → R2');
    expect(texto).toContain('responsável identificado');
    expect(texto).toContain('motivo escrito');
  });
});

/*
 * ============================================================================
 * A REFERÊNCIA DA TRAVA — o furo que o revisor provou três vezes.
 * ============================================================================
 *
 * Medir a trava só contra a BASE HERDADA deixa passar toda redução em relação
 * ao que estava valendo PARA AQUELA EMPRESA: enquanto o resultado continuar
 * igual ou acima da base, nada afrouxa contra a base. A empresa sobe uma
 * capacidade, depois devolve com um delta vazio, e a devolução entra sem
 * responsável e sem motivo.
 */
describe('a trava mede contra o que estava valendo para a empresa, não só contra a base', () => {
  /** O que a empresa tinha em vigor depois de subir a tarefa para R4. */
  const SUBIU = [
    comoNaBase('operacao.tarefa.alterar', {
      nivel: 'R4',
      efeito: {
        ...BASE.capacidades.find((c) => c.id === 'operacao.tarefa.alterar')!.efeito,
        sensibilidade: 'restrita',
      },
    }),
  ];
  const valendoNaEmpresa = resolverPolitica(BASE, deltaDaEmpresa(SUBIU));

  it('delta VAZIO que devolve R4 para R2 não afrouxa contra a base — e afrouxa contra o que valia', () => {
    const devolve = resolverPolitica(BASE, deltaDaEmpresa([]));

    const contraABase = diffDePolitica(BASE, devolve);
    expect(contraABase).toEqual({ capacidades: [], limites: [], secoes: [] });
    expect(afrouxamentosDoDiff(contraABase)).toEqual([]); // era por aqui que passava

    const contraOQueValia = diffDePolitica(valendoNaEmpresa, devolve);
    expect(contraOQueValia.capacidades[0]).toMatchObject({
      id: 'operacao.tarefa.alterar',
      de: 'R4',
      para: 'R2',
      direcao: 'desce',
    });

    const uniao = uniaoDosAfrouxamentos(
      afrouxamentosDoDiff(contraABase),
      afrouxamentosDoDiff(contraOQueValia),
    );
    expect(textosDosAfrouxamentos(uniao)).toEqual(['operacao.tarefa.alterar: R4 → R2']);
    expect(recusasDaSobrescrita(uniao, {}).map((r) => r.motivo)).toEqual([
      'afrouxamento-sem-responsavel',
      'afrouxamento-sem-motivo',
    ]);
    expect(recusasDaSobrescrita(uniao, ASSINADA)).toEqual([]);
  });

  it('teto diário voltando de 20 para 200 é afrouxamento, mesmo sendo o valor da base', () => {
    const apertado = resolverPolitica(BASE, deltaDaEmpresa([], { porDia: 20 }));
    const devolvido = resolverPolitica(BASE, deltaDaEmpresa([]));

    expect(afrouxamentosDoDiff(diffDePolitica(BASE, devolvido))).toEqual([]);
    const contraOQueValia = diffDePolitica(apertado, devolvido);
    expect(contraOQueValia.limites).toEqual([
      { campo: 'porDia', de: 20, para: 200, direcao: 'afrouxa' },
    ]);
    expect(recusas(contraOQueValia, {})).toHaveLength(2);
  });

  /*
   * A terceira: o diff gravado MENTIA sobre a direção. Uma queda de R4 para R3
   * saía como "sobe" porque a base é R2 e 3 > 2. As duas leituras são
   * verdadeiras — cada uma responde a uma pergunta — e é por isso que as duas
   * ficam gravadas, em campos com nome, em vez de uma só chamada de `diff`.
   */
  it('queda de R4 para R3 sai "desce" contra o que valia e "sobe" contra a base', () => {
    const caiParaR3 = resolverPolitica(
      BASE,
      deltaDaEmpresa([
        comoNaBase('operacao.tarefa.alterar', {
          nivel: 'R3',
          efeito: {
            ...BASE.capacidades.find((c) => c.id === 'operacao.tarefa.alterar')!.efeito,
            reversibilidade: 'manual',
          },
          desfazer: undefined,
        }),
      ]),
    );

    expect(diffDePolitica(BASE, caiParaR3).capacidades[0]).toMatchObject({
      de: 'R2',
      para: 'R3',
      direcao: 'sobe',
    });
    expect(diffDePolitica(valendoNaEmpresa, caiParaR3).capacidades[0]).toMatchObject({
      de: 'R4',
      para: 'R3',
      direcao: 'desce',
    });
  });

  it('a união não repete o mesmo item quando as duas referências acusam', () => {
    const rebaixa = resolverPolitica(
      BASE,
      deltaDaEmpresa([
        comoNaBase('clickup.tarefa.alterar', {
          nivel: 'R2',
          desfazer: 'clickup.tarefa.alterar',
          efeito: {
            ...BASE.capacidades.find((c) => c.id === 'clickup.tarefa.alterar')!.efeito,
            reversibilidade: 'automatica',
          },
        }),
      ]),
    );
    const uniao = uniaoDosAfrouxamentos(
      afrouxamentosDoDiff(diffDePolitica(BASE, rebaixa)),
      afrouxamentosDoDiff(diffDePolitica(valendoNaEmpresa, rebaixa)),
    );
    const rebaixamentos = uniao.filter((a: Afrouxamento) => a.alvo === 'clickup.tarefa.alterar');
    expect(rebaixamentos).toHaveLength(1);
  });
});

/*
 * ============================================================================
 * CAMPOS QUE SÃO TRAVA DE EXECUÇÃO — afrouxam sem o nível descer.
 * ============================================================================
 */
describe('ferramenta e esquema de argumentos têm direção própria', () => {
  it('capacidade que ganha ferramenta afrouxa: nenhum agente a alcançava', () => {
    // QUATORZE capacidades da base estão hoje sem ferramenta — declaradas na
    // política e fora do alcance de qualquer agente, porque `tool-adapter.ts`
    // filtra por `ferramenta`. Acrescentar o nome é liberar execução.
    //
    // Eram doze até a fatia 3.7 (RF-G-06) declarar `conector.desligar` e
    // `conector.religar`, as DUAS que subiram o número. As duas nascem sem
    // ferramenta de propósito, e essa ausência é a regra: nenhum agente pode
    // religar um conector que uma pessoa desligou. Se alguém acrescentar
    // `ferramenta` a qualquer uma delas, o desligamento de emergência vira algo
    // que o próprio OS desfaz — e é este caso que reprova primeiro.
    //
    // Quinze desde a MD6 (24/09/2026): `instagram.post.publicar` também nasce
    // sem ferramenta. Quem publica é gente pela tela ou a rotina com o lote
    // assinado (MD8); agente nenhum posta no Instagram da empresa.
    //
    // Dezesseis desde a MD7 (24/09/2026): `pauta.semana.aprovar` também. Pedir
    // a assinatura do lote é clique de gente; um agente que a pedisse estaria
    // propondo a semana inteira de uma vez.
    //
    // Dezessete desde a MD9 (25/09/2026): `instagram.comentario.ler` também.
    // É leitura, mas o que ela devolve é o @ de quem comentou — vai para a fila
    // da DM à mão, nunca para o contexto de um modelo.
    //
    // Dezenove desde a MD10 (25/09/2026): `youtube.video.enviar` e
    // `youtube.video.publicar`. Quem envia é o Mac, pela sessão que a tela
    // abre com o lote assinado; quem agenda é a rotina. Agente nenhum sobe
    // vídeo nem marca horário no canal da empresa.
    //
    // Vinte e uma desde a MD11 (25/09/2026): `instagram.resposta_privada.enviar`
    // e `instagram.regra_de_resposta.pausar`. Quem manda a DM é a rotina, com a
    // regra assinada no lote; quem pausa é gente na fila. Um agente que
    // mandasse DM a estranho em nome da marca é exatamente o que a regra evita.
    //
    // Vinte e seis desde o cockpit do lead (13/10/2026): as cinco escritas do
    // comercial (`comercial.whatsapp.enviar`, `.proposta.publicar`,
    // `.cobranca.criar`, `.contrato.enviar`, `.fechamento.executar`). Quem as
    // dispara é a reação do fio ou o clique na tela, pela porta; agente nenhum
    // manda mensagem ao lead, cobra ou fecha por conta própria.
    //
    // Vinte e sete desde a rodada da implantação I3 (18/10/2026):
    // `comercial.sala.publicar`. A versão da sala sai pelo clique de gente na
    // bancada e a segunda pessoa libera; agente nenhum publica a sala do cliente.
    //
    // Vinte e oito desde a produção 21 (P7, 21/10/2026): `contexto.arquivo.ler`.
    // É leitura do texto de um arquivo do Drive para o banco de atas, pedida
    // pelo clique de gente na tela de Atas; o texto volta sigiloso e não vai ao
    // contexto de agente nenhum por esta porta.
    expect(BASE.capacidades.filter((c) => !c.ferramenta)).toHaveLength(28);
    for (const id of [
      'contexto.arquivo.ler',
      'instagram.post.publicar',
      'pauta.semana.aprovar',
      'instagram.comentario.ler',
      'youtube.video.enviar',
      'youtube.video.publicar',
      'instagram.resposta_privada.enviar',
      'instagram.regra_de_resposta.pausar',
      'comercial.whatsapp.enviar',
      'comercial.proposta.publicar',
      'comercial.cobranca.criar',
      'comercial.contrato.enviar',
      'comercial.fechamento.executar',
      'comercial.sala.publicar',
    ]) {
      expect(BASE.capacidades.find((c) => c.id === id)?.ferramenta, id).toBeUndefined();
    }
    for (const id of ['conector.desligar', 'conector.religar']) {
      expect(BASE.capacidades.find((c) => c.id === id)?.ferramenta, id).toBeUndefined();
    }
    expect(BASE.capacidades.find((c) => c.id === 'espelho.consultar')?.ferramenta).toBeUndefined();

    const diff = diffDoDelta(BASE, [comoNaBase('espelho.consultar', { ferramenta: 'espelho_ler' })]);
    const mudanca = diff.capacidades[0];
    expect(mudanca.direcao).toBe('igual'); // o NÍVEL não mudou
    expect(mudanca.travas.ferramenta?.direcao).toBe('afrouxa');
    expect(afrouxamentosDoDiff(diff)[0].tipo).toBe('trava-de-execucao');
    expect(recusas(diff, {})).toHaveLength(2);
    expect(recusas(diff, ASSINADA)).toEqual([]);
  });

  it('perder a ferramenta aperta: a capacidade sai da lista exposta ao modelo', () => {
    const diff = diffDoDelta(BASE, [comoNaBase('operacao.tarefa.listar', { ferramenta: undefined })]);
    expect(diff.capacidades[0].travas.ferramenta?.direcao).toBe('aperta');
    expect(afrouxamentosDoDiff(diff)).toEqual([]);
  });

  /*
   * O ataque: `validarArgs` (gateway/validacao.ts) devolve lista vazia quando
   * o schema não declara `properties`. Trocar o schema por `{type:'object'}`
   * desliga a validação de argumento da porta — que é justamente a trava que a
   * última fatia da branch original construiu — sem mexer no nível.
   */
  it('esquema que deixa de declarar propriedades afrouxa (a porta para de validar)', () => {
    const diff = diffDoDelta(BASE, [
      comoNaBase('operacao.tarefa.listar', { argsSchema: { type: 'object' } }),
    ]);
    expect(diff.capacidades[0].travas.argsSchema?.direcao).toBe('afrouxa');
    expect(textos(diff)[0]).toContain('deixou de declarar propriedades');
    expect(recusas(diff, {})).toHaveLength(2);
  });

  it('esquema que some afrouxa', () => {
    const diff = diffDoDelta(BASE, [comoNaBase('operacao.tarefa.listar', { argsSchema: undefined })]);
    expect(diff.capacidades[0].travas.argsSchema?.direcao).toBe('afrouxa');
    expect(textos(diff)[0]).toContain('o esquema sumiu');
  });

  it('esquema que passa a aceitar propriedade extra afrouxa', () => {
    const antes = BASE.capacidades.find((c) => c.id === 'operacao.tarefa.listar')!.argsSchema!;
    const diff = diffDoDelta(BASE, [
      comoNaBase('operacao.tarefa.listar', {
        argsSchema: { ...antes, additionalProperties: true },
      }),
    ]);
    expect(diff.capacidades[0].travas.argsSchema?.direcao).toBe('afrouxa');
    expect(textos(diff)[0]).toContain('additionalProperties');
  });

  it('esquema que declara propriedade nova afrouxa', () => {
    const antes = BASE.capacidades.find((c) => c.id === 'operacao.tarefa.listar')!.argsSchema!;
    const diff = diffDoDelta(BASE, [
      comoNaBase('operacao.tarefa.listar', {
        argsSchema: {
          ...antes,
          properties: { ...(antes.properties as object), overdue: { type: 'boolean' } },
        },
      }),
    ]);
    expect(diff.capacidades[0].travas.argsSchema?.direcao).toBe('afrouxa');
    expect(textos(diff)[0]).toContain('propriedade nova: overdue');
  });

  it('esquema que NASCE onde não havia aperta: a porta começa a validar', () => {
    expect(BASE.capacidades.find((c) => c.id === 'relatorio.gerar')?.argsSchema).toBeUndefined();
    const diff = diffDoDelta(BASE, [
      comoNaBase('relatorio.gerar', {
        argsSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['periodo'],
          properties: { periodo: { type: 'string' } },
        },
      }),
    ]);
    expect(diff.capacidades[0].travas.argsSchema?.direcao).toBe('aperta');
    expect(afrouxamentosDoDiff(diff)).toEqual([]);
  });

  /* Falha fechada: mudança que não dá para provar que aperta exige assinatura. */
  it('mudança de tipo dentro do esquema afrouxa, por não dar para provar o contrário', () => {
    const diff = diffDoDelta(BASE, [
      comoNaBase('operacao.tarefa.listar', {
        argsSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { status: { type: 'number' } },
        },
      }),
    ]);
    expect(diff.capacidades[0].travas.argsSchema?.direcao).toBe('afrouxa');
  });

  /*
   * MD7: o modo de aprovação decide quantas saídas uma assinatura cobre. Toda
   * mudança nele é afrouxamento, e é por isso que o seed da MD7 pede a
   * assinatura de REBAIXAMENTO além da de capacidade nova.
   */
  it('a invariante 4 reescrita (MD7) conta como invariante removida: pede a assinatura de rebaixamento', () => {
    const antiga = 'aprovação é de uso único, presa ao conteúdo exato e com prazo';
    const anterior = { ...BASE, invariantes: BASE.invariantes.map((i, n) => (n === 3 ? antiga : i)) };
    const diff = diffDePolitica(anterior, BASE);
    const itens = afrouxamentosDoDiff(diff);
    expect(itens).toEqual([{ tipo: 'secao', alvo: 'invariantes', texto: `invariante removida: ${antiga}` }]);
  });

  it('mudar o modo de aprovação afrouxa, em qualquer direção', () => {
    const pub = 'instagram.post.publicar';
    const semModo = diffDoDelta(BASE, [comoNaBase(pub, { aprovacao: undefined })]);
    expect(semModo.capacidades[0].travas.aprovacao?.direcao).toBe('afrouxa');
    expect(textos(semModo).join()).toMatch(/modo de aprovação mudou \(sob_lote → uso único\)/);

    const outroLote = diffDoDelta(BASE, [comoNaBase('pauta.semana.aprovar', { aprovacao: { modo: 'lote', tetoDeItens: 90, validadeMaximaDias: 8 } })]);
    expect(outroLote.capacidades[0].travas.aprovacao?.direcao).toBe('afrouxa');
    expect(afrouxamentosDoDiff(outroLote).map((a) => a.tipo)).toEqual(['trava-de-execucao']);
    expect(recusas(outroLote, {})).toHaveLength(2);

    const igual = diffDoDelta(BASE, [comoNaBase(pub, { descricao: 'outra' })]);
    expect(igual.capacidades[0].travas.aprovacao).toBeUndefined();
  });
});

describe('os limites também afrouxam, e a trava vale para eles', () => {
  const comLimites = (limites: Record<string, unknown>) => diffDoDelta(BASE, [], limites);

  it('teto maior afrouxa; teto menor aperta', () => {
    expect(comLimites({ porDia: 1000 }).limites).toEqual([
      { campo: 'porDia', de: 200, para: 1000, direcao: 'afrouxa' },
    ]);
    expect(comLimites({ porDia: 50 }).limites[0].direcao).toBe('aperta');
    expect(recusas(comLimites({ porDia: 1000 }), {})).toHaveLength(2);
    expect(recusas(comLimites({ porDia: 50 }), {})).toEqual([]);
  });

  it('janela mais larga afrouxa e janela mais estreita aperta', () => {
    expect(comLimites({ janelaHoraria: ['06:00', '23:00'] }).limites[0].direcao).toBe('afrouxa');
    expect(comLimites({ janelaHoraria: ['09:00', '18:00'] }).limites[0].direcao).toBe('aperta');
  });

  /*
   * Janela DESLOCADA é o caso que um `fim - início` ingênuo deixa passar:
   * 08:00–20:00 → 10:00–22:00 tem a MESMA largura, e libera duas horas que a
   * anterior proibia. Falha fechada: o que não é subconjunto, afrouxa.
   */
  it('janela deslocada com a mesma largura afrouxa', () => {
    const diff = comLimites({ janelaHoraria: ['10:00', '22:00'] });
    expect(diff.limites[0].direcao).toBe('afrouxa');
    expect(recusas(diff, {}).length).toBeGreaterThan(0);
  });

  it('o teto de custo por execução entra na mesma conta', () => {
    expect(comLimites({ tetoCustoCentavosPorExecucao: 5000 }).limites[0].direcao).toBe('afrouxa');
    expect(comLimites({ tetoCustoCentavosPorExecucao: 100 }).limites[0].direcao).toBe('aperta');
  });
});

/*
 * ============================================================================
 * O RESTO DO DOCUMENTO — níveis, escalonamento, invariantes, gatilhos, retenção.
 * ============================================================================
 *
 * O seed anunciava a trava "para o documento inteiro" e comparava só
 * capacidades e limites. Dois documentos que diferissem na exigência de
 * aprovação por nível, na alçada mínima, no escalonamento e na retenção
 * passavam sem afrouxamento nenhum. Hoje isso é inerte (a avaliação usa a
 * constante do código, e ninguém lê retenção nem escalonamento) — mas a trava
 * nasceria furada para o dia em que essas seções forem ligadas.
 *
 * Um delta de EMPRESA não alcança estas seções: `resolverPolitica()` copia
 * todas da base. Quem escreve aqui é o seed, comparando o documento do
 * repositório com o que está gravado — por isso os casos montam as duas
 * políticas na mão.
 */
describe('as seções fora de capacidades e limites têm direção', () => {
  const comNivel = (nivel: string, troca: Record<string, unknown>): Politica => {
    const copia = JSON.parse(JSON.stringify(BASE)) as Politica;
    const alvo = (copia.niveis as Record<string, Record<string, unknown>>)[nivel];
    (copia.niveis as Record<string, unknown>)[nivel] = {
      ...alvo,
      ...troca,
      aprovacao: { ...(alvo.aprovacao as object), ...((troca.aprovacao as object) ?? {}) },
    };
    return copia;
  };

  it('exigir menos aprovação afrouxa', () => {
    const solta = comNivel('R2', { aprovacao: { exigida: 'nunca' } });
    const diff = diffDePolitica(BASE, solta);
    expect(diff.secoes).toEqual([
      {
        secao: 'niveis',
        direcao: 'afrouxa',
        itens: ['niveis.R2.aprovacao.exigida: "configuravel" → "nunca"'],
      },
    ]);
    expect(afrouxamentosDoDiff(diff)[0].tipo).toBe('secao');
    expect(recusas(diff, {})).toHaveLength(2);
    expect(recusas(diff, ASSINADA)).toEqual([]);
  });

  it('exigir MAIS aprovação aperta e não pede assinatura', () => {
    const diff = diffDePolitica(BASE, comNivel('R2', { aprovacao: { exigida: 'sempre' } }));
    expect(diff.secoes[0].direcao).toBe('aperta');
    expect(afrouxamentosDoDiff(diff)).toEqual([]);
  });

  it('alçada mínima menor afrouxa', () => {
    const diff = diffDePolitica(
      BASE,
      comNivel('R4', { aprovacao: { alcadaMinima: 'operador' } }),
    );
    expect(textos(diff)[0]).toContain('alcadaMinima');
    expect(recusas(diff, {})).toHaveLength(2);
  });

  it('desligar uso único, vínculo com conteúdo ou reautenticação afrouxa', () => {
    for (const troca of [
      { usoUnico: false },
      { vinculo: 'nenhum' },
      { validadeSegundos: 86400 },
    ]) {
      const diff = diffDePolitica(BASE, comNivel('R2', { aprovacao: troca }));
      expect(diff.secoes[0].direcao, JSON.stringify(troca)).toBe('afrouxa');
    }
    const semReauth = diffDePolitica(BASE, comNivel('R4', { aprovacao: { reautenticacao: false } }));
    expect(semReauth.secoes[0].direcao).toBe('afrouxa');
  });

  it('nível que desbloqueia ou passa a escrever afrouxa', () => {
    expect(diffDePolitica(BASE, comNivel('R5', { bloqueado: false })).secoes[0].direcao).toBe(
      'afrouxa',
    );
    expect(diffDePolitica(BASE, comNivel('R0', { escreve: true })).secoes[0].direcao).toBe(
      'afrouxa',
    );
  });

  it('rastro que perde campo afrouxa', () => {
    const diff = diffDePolitica(BASE, comNivel('R2', { rastro: ['ator'] }));
    expect(textos(diff)[0]).toContain('rastro perdeu');
  });

  it('sinal de escalonamento removido afrouxa; a regra mudando também', () => {
    const semSinal = JSON.parse(JSON.stringify(BASE)) as Politica;
    semSinal.escalonamento.sinais = semSinal.escalonamento.sinais.filter(
      (s) => s.id !== 'fora_da_janela',
    );
    expect(textos(diffDePolitica(BASE, semSinal))[0]).toContain('fora_da_janela');

    const outraRegra = JSON.parse(JSON.stringify(BASE)) as Politica;
    outraRegra.escalonamento.regra = 'qualquer sinal sobe dois degraus';
    expect(textos(diffDePolitica(BASE, outraRegra))[0]).toContain('escalonamento.regra');
  });

  it('invariante removida afrouxa; invariante acrescentada aperta', () => {
    const menos = JSON.parse(JSON.stringify(BASE)) as Politica;
    menos.invariantes = menos.invariantes.slice(1);
    expect(textos(diffDePolitica(BASE, menos))[0]).toContain('invariante removida');

    const mais = JSON.parse(JSON.stringify(BASE)) as Politica;
    mais.invariantes = [...mais.invariantes, 'nada sai sem rastro'];
    const diff = diffDePolitica(BASE, mais);
    expect(diff.secoes[0]).toMatchObject({ secao: 'invariantes', direcao: 'aperta' });
    expect(afrouxamentosDoDiff(diff)).toEqual([]);
  });

  /*
   * Retenção e gatilhos não têm ordem definida em documento nenhum e ninguém
   * os lê hoje. Falha fechada: mudou, exige assinatura. É a alternativa
   * honesta a dizer que a trava cobre o documento inteiro e não cobrir.
   */
  it('retenção e gatilhos mudando exigem assinatura, por não terem direção definida', () => {
    for (const secao of ['retencao', 'gatilhos'] as const) {
      const outro = JSON.parse(JSON.stringify(BASE)) as Politica;
      (outro as unknown as Record<string, unknown>)[secao] = { mudou: true };
      const diff = diffDePolitica(BASE, outro);
      expect(diff.secoes.map((s) => s.secao), secao).toContain(secao);
      expect(recusas(diff, {}), secao).toHaveLength(2);
      expect(recusas(diff, ASSINADA), secao).toEqual([]);
    }
  });
});

describe('o diff sobrevive ao JSONB', () => {
  /*
   * O documento volta do Postgres como JSONB, com as chaves em outra ordem. Um
   * diff que compare `JSON.stringify` acusaria as 51 capacidades como mudadas
   * — num histórico que existe justamente para dizer quem mudou o quê.
   */
  it('mesma política com as chaves em outra ordem não produz diff', () => {
    const embaralhada = JSON.parse(JSON.stringify(BASE), (_k, v) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return Object.fromEntries(Object.entries(v).reverse());
      }
      return v;
    }) as Politica;
    expect(diffDePolitica(BASE, embaralhada)).toEqual({ capacidades: [], limites: [], secoes: [] });
  });

  /*
   * A IDEMPOTÊNCIA E O CAMPO OPCIONAL AUSENTE.
   *
   * `{ desfazer: undefined }` é o que sai de um objeto montado por spread
   * quando o campo opcional não se aplica — e é exatamente o que um dos casos
   * desta suíte monta logo acima. O Postgres DESCARTA a chave ao gravar, então
   * enquanto `canonico` contasse a chave presente com valor indefinido, o
   * documento em memória nunca batia com o que voltava do banco: a comparação
   * de idempotência dizia "mudou" em toda chamada e três execuções idênticas
   * do mesmo script abriam três versões.
   */
  it('chave com valor indefinido não conta — é o que a serialização do banco faz', () => {
    expect(canonico({ a: 1, b: undefined })).toBe(canonico({ a: 1 }));
    expect(canonico({ a: 1, b: undefined })).toBe(JSON.stringify({ a: 1, b: undefined }));
    // e o caminho que importa: a capacidade com `desfazer: undefined`
    const comChave = comoNaBase('whatsapp.mensagem.enviar', { desfazer: undefined });
    const semChave = { ...comoNaBase('whatsapp.mensagem.enviar', {}) };
    delete (semChave as Record<string, unknown>).desfazer;
    expect(canonico(comChave)).toBe(canonico(semChave));
    // o que o banco devolveria, depois de um ida e volta por JSON
    expect(canonico(comChave)).toBe(canonico(JSON.parse(JSON.stringify(comChave))));
  });
});
