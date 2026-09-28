import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { avaliar, classificar, APROVACAO_POR_NIVEL, type Capacidade } from '../src/escada.js';
import { lerPolitica, lerDelta, resolverPolitica, type Politica } from '../src/esquema.js';
import { verificarCatalogo, verificarReversibilidade, casosDeDecisao } from '../src/verificacao.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const json = (nome: string) => JSON.parse(readFileSync(raiz + nome, 'utf8'));

const ROOT = lerPolitica(json('politica-root.json'), 'politica-root.json');
const DELTA = lerDelta(json('politica-marketing-os.json'), 'politica-marketing-os.json');
// É a resolução que vale: o catálogo daqui herda níveis, gatilhos e
// invariantes da base ROOT e só acrescenta o que existe em código.
const MKTOS = resolverPolitica(ROOT, DELTA);

/*
 * Esta suíte é a trava que o documento normativo (04-ESCADA-R0-R5.md) exige:
 * o código é o espelho executável do texto, e o teste reprova quando divergem.
 */

/*
 * `interno` é o exemplo de R2 do catálogo. Vem nulo no politica-root.json desde
 * 10/09/2026: os três "criar" que ocupavam o degrau subiram para R3 quando o
 * desfazer pendurado foi fechado (fatia 2.2), e a base ROOT ficou sem nenhuma
 * escrita que o próprio OS saiba desfazer. Ver o teste "o degrau R2..." abaixo.
 */
type Catalogo = [nome: string, pol: Politica, ids: { externo: string; interno: string | null }];

type CapacidadeDoCatalogo = Politica['capacidades'][number];

/** Escrita interna comum: é o efeito que a régua classifica como R2. */
const EFEITO_INTERNO = {
  escreveForaDoOS: true,
  produzArtefato: false,
  reversibilidade: 'automatica',
  exposicaoExterna: false,
  impactoFinanceiro: 'nenhum',
  sensibilidade: 'interna',
  destruicao: false,
  obrigacaoLegal: false,
} satisfies CapacidadeDoCatalogo['efeito'];

const cap = (p: Partial<CapacidadeDoCatalogo> & { id: string }): CapacidadeDoCatalogo => ({
  descricao: p.id,
  nivel: 'R2',
  ...p,
  efeito: { ...EFEITO_INTERNO, ...(p.efeito ?? {}) },
});

/*
 * O R2 que o politica-root.json não tem mais. Existe para que os dois casos de
 * decisão de R2 do anexo continuem sendo exercidos contra a base ROOT — antes
 * eles eram PULADOS (`it.skip`) quando o catálogo não tinha nenhum R2, e um
 * teste pulado prova exatamente nada. A forma é a do R2 legítimo: alteração
 * implementada que se desfaz com ela mesma.
 */
const R2_SINTETICO = cap({
  id: 'sintetico.registro.alterar',
  descricao: 'R2 construído no teste, para exercer os casos de decisão do degrau.',
  ferramenta: 'sintetico_registro_alterar',
  rota: 'PATCH /sintetico/:id',
  desfazer: 'sintetico.registro.alterar',
});

const CATALOGOS: Catalogo[] = [
  ['politica-root.json', ROOT, { externo: 'whatsapp.mensagem.enviar', interno: null }],
  ['politica-marketing-os.json', MKTOS, { externo: 'whatsapp.mensagem.enviar', interno: 'operacao.tarefa.alterar' }],
];

describe.each(CATALOGOS)('%s', (_nome, pol, ids) => {
  it('todo nível declarado é o que a régua calcula do efeito', () => {
    const linhas = verificarCatalogo(pol);
    const falhas = linhas.filter((l) => !l.ok);
    expect(
      falhas.map((f) => `${f.id}: declarado=${f.declarado} calculado=${f.calculado} ${f.problemas.join('; ')}`.trim()),
    ).toEqual([]);
    expect(linhas.length).toBeGreaterThan(0);
  });

  it('não repete id de capacidade', () => {
    const ids2 = pol.capacidades.map((c) => c.id);
    expect(new Set(ids2).size).toBe(ids2.length);
  });

  /*
   * ACHADO NO ANEXO NORMATIVO, 28/08/2026 — não era typo, era lacuna sistemática:
   * as TRÊS capacidades R2 do politica-root.json nomeavam um desfazer
   * (clickup.tarefa.excluir, crm.lead.arquivar, agenda.evento.excluir) que não
   * existia no catálogo, e era essa promessa de volta que as segurava em R2.
   *
   * FECHADO EM 10/09/2026 (fatia 2.2), pela regra do documento e falhando
   * fechado: nenhuma das três ações de desfazer existe no produto — não há
   * DELETE de tarefa no conector ClickUp, não há arquivamento de lead, não há
   * exclusão de evento na Agenda — então a reversibilidade delas é manual e o
   * gatilho as leva a R3. Não há mais exceção declarada aqui: o Set
   * DESFAZER_PENDURADO deixou de existir, e qualquer desfazer pendurado novo,
   * em qualquer dos dois catálogos, reprova na hora.
   */
  it('nenhuma capacidade promete uma volta que o catálogo não sabe dar', () => {
    expect(
      verificarReversibilidade(pol).map((l) => `${l.id} (${l.nivel}): ${l.motivo} ${l.desfazer ?? ''}`.trim()),
    ).toEqual([]);
  });

  /*
   * O delta é conferido SOZINHO, além de resolvido: uma capacidade daqui que
   * apontasse o desfazer para a base passaria no teste acima e quebraria no dia
   * em que um cliente sobrescrevesse aquela capacidade da base.
   */
  it('o delta daqui não pendura desfazer nem sobre a base', () => {
    const conhecidas = new Set(DELTA.capacidades.map((c) => c.id));
    const pendurados = DELTA.capacidades
      .filter((c) => c.desfazer && !conhecidas.has(c.desfazer))
      .map((c) => `${c.id} → ${c.desfazer}`);
    expect(pendurados).toEqual([]);
  });

  it('os casos de decisão do anexo se comportam como o documento manda', () => {
    const casos = casosDeDecisao(pol, ids);
    const porNome = Object.fromEntries(casos.map((c) => [c.nome, c.decisao]));

    // R3: saída externa exige aprovação humana presa ao conteúdo, uso único
    const externo = porNome['saída externa, normal'];
    expect(externo.nivel).toBe('R3');
    expect(externo.permitido).toBe(true);
    expect(externo.exigeAprovacao).toBe(true);
    expect(externo.aprovacao.vinculo).toBe('conteudo');
    expect(externo.aprovacao.usoUnico).toBe(true);

    // um sinal aceso sobe exatamente um nível
    const comSinal = porNome['saída externa, destinatário novo'];
    expect(comSinal.nivelBase).toBe('R3');
    expect(comSinal.nivel).toBe('R4');
    expect(comSinal.exigeReautenticacao).toBe(true);
    expect(comSinal.sinaisAcionados).toEqual(['destinatario_novo']);

    // fail closed
    const desconhecida = porNome['ferramenta desconhecida'];
    expect(desconhecida.nivel).toBe('R5');
    expect(desconhecida.permitido).toBe(false);
    expect(desconhecida.motivo).toBe('capacidade sem classificação vale R5');
  });

  /*
   * Os dois casos de R2 do anexo rodam nos DOIS catálogos. Onde não há R2 —
   * politica-root.json desde 10/09/2026 — o degrau entra por um R2 sintético
   * declarado no topo deste arquivo, e não por um `it.skip`: o comportamento do
   * degrau é do motor, não do catálogo, e não pode deixar de ser exercido só
   * porque um catálogo esvaziou. Quantos R2 cada catálogo tem é assunto do
   * teste "o degrau R2, depois da fatia 2.2", logo abaixo.
   */
  const comR2: Politica = ids.interno
    ? pol
    : { ...pol, capacidades: [...pol.capacidades, R2_SINTETICO] };
  const idsComR2 = { externo: ids.externo, interno: ids.interno ?? R2_SINTETICO.id };

  it('R2 é o único nível em que o cliente decide, e conteúdo externo só eleva', () => {
    const porNome = Object.fromEntries(
      casosDeDecisao(comR2, idsComR2).map((c) => [c.nome, c.decisao]),
    );

    const semAprovacao = porNome['registro interno, aprovação desligada'];
    expect(semAprovacao.nivel).toBe('R2');
    expect(semAprovacao.exigeAprovacao).toBe(false);

    const suspeito = porNome['registro interno, fonte não confiável'];
    expect(suspeito.nivel).toBe('R3');
    expect(suspeito.exigeAprovacao).toBe(true);
  });
});

describe('o degrau R2, depois da fatia 2.2', () => {
  /*
   * Consequência direta de fechar os três desfazer pendurados: a base ROOT
   * ficou SEM nenhuma capacidade R2. Não é esquecimento — é o que o catálogo
   * do vault diz hoje, lido com a regra aplicada: os três "criar" que moravam
   * ali prometiam uma volta que ninguém sabe dar.
   *
   * O R2 de verdade vive no delta, e tem uma forma só: alteração que se desfaz
   * com ela mesma (PATCH de status), ou criação cujo desfazer está declarado.
   * Se um dia entrar um R2 legítimo na base ROOT, este teste fica vermelho e
   * obriga a devolver o caso de decisão de R2 ao politica-root.json.
   */
  it('a base ROOT não tem R2, e o delta tem três — todas alterações', () => {
    expect(ROOT.capacidades.filter((c) => c.nivel === 'R2').map((c) => c.id)).toEqual([]);
    const r2 = MKTOS.capacidades.filter((c) => c.nivel === 'R2');
    expect(r2.map((c) => c.id).sort()).toEqual([
      'crm.lead.alterar',
      'operacao.tarefa.alterar',
      'pecas.campanha.alterar',
    ]);
    // A forma do R2 que sobrou: alteração implementada que se desfaz com ela mesma.
    for (const c of r2) {
      expect(c.desfazer, `${c.id} não se desfaz com ela mesma`).toBe(c.id);
      expect(c.rota, `${c.id} sem rota`).toBeTruthy();
    }
  });

  /*
   * A quarta, que saiu do degrau em 10/09/2026. Era a única das quatro que
   * apontava o desfazer para OUTRA capacidade em vez de se desfazer com ela
   * mesma — e essa outra é financeiro.lancamento.excluir, que é R5. O OS nunca
   * executa R5: prepara e entrega a uma pessoa. Mesma promessa vazia dos três
   * "criar" da base ROOT, só que numa rota que existe (POST /finance/
   * transactions) e com ferramenta MCP que um agente chama hoje.
   */
  it('financeiro.lancamento.criar não promete mais um desfazer que é R5', () => {
    const criar = MKTOS.capacidades.find((c) => c.id === 'financeiro.lancamento.criar')!;
    expect(criar.nivel).toBe('R3');
    expect(criar.efeito.reversibilidade).toBe('manual');
    expect(criar.desfazer).toBeUndefined();
    // E o desfazer que ela apontava continua onde estava, em R5.
    expect(MKTOS.capacidades.find((c) => c.id === 'financeiro.lancamento.excluir')!.nivel).toBe('R5');
  });

  it('os três "criar" da base ROOT estão em R3, com reversibilidade manual', () => {
    for (const id of ['clickup.tarefa.criar', 'crm.lead.criar', 'agenda.evento.criar']) {
      const c = ROOT.capacidades.find((x) => x.id === id)!;
      expect(c, `${id} sumiu do catálogo`).toBeTruthy();
      expect(c.nivel, `${id} deveria ser R3`).toBe('R3');
      expect(c.efeito.reversibilidade, `${id} não é automaticamente reversível`).toBe('manual');
      expect(c.desfazer, `${id} voltou a prometer desfazer`).toBeUndefined();
    }
  });
});

/*
 * A trava de reversibilidade conferia uma coisa só: se o id do desfazer existe
 * no catálogo. Existir é o mais barato dos requisitos — passavam quatro formas
 * de prometer uma volta que ninguém dá, e uma delas era o próprio
 * financeiro.lancamento.criar. Cada uma tem um teste aqui.
 */
describe('a trava de reversibilidade', () => {
  const motivos = (capacidades: CapacidadeDoCatalogo[]) =>
    verificarReversibilidade({ capacidades }).map((l) => `${l.id}: ${l.motivo}`);

  it('recusa desfazer que aponta para R5 — o OS nunca executa R5', () => {
    expect(
      motivos([
        cap({ id: 'x.criar', rota: 'POST /x', desfazer: 'x.excluir' }),
        cap({
          id: 'x.excluir',
          nivel: 'R5',
          rota: 'DELETE /x/:id',
          efeito: { ...EFEITO_INTERNO, reversibilidade: 'nenhuma', destruicao: true, sensibilidade: 'restrita' },
        }),
      ]),
    ).toEqual(['x.criar: desfazer-r5']);
  });

  it('recusa desfazer declarado e não implementado — sem rota e sem ferramenta', () => {
    expect(
      motivos([
        cap({ id: 'x.criar', rota: 'POST /x', desfazer: 'x.arquivar' }),
        // declarada no catálogo, inexistente no produto
        cap({ id: 'x.arquivar', efeito: { ...EFEITO_INTERNO, reversibilidade: 'manual' }, nivel: 'R3' }),
      ]),
    ).toEqual(['x.criar: desfazer-nao-implementado']);
  });

  it('recusa autorreferência que não é alteração, e aceita a que é', () => {
    // criar de novo não desfaz uma criação
    expect(
      motivos([cap({ id: 'x.criar', rota: 'POST /x', desfazer: 'x.criar' })]),
    ).toEqual(['x.criar: autorreferencia-invalida']);

    // alterar de novo, com o valor anterior, desfaz — é a forma dos três R2 do delta
    expect(
      motivos([
        cap({ id: 'x.alterar', rota: 'PATCH /x/:id', desfazer: 'x.alterar' }),
      ]),
    ).toEqual([]);

    // e nem a alteração escapa de ter que existir no produto
    expect(motivos([cap({ id: 'x.alterar', desfazer: 'x.alterar' })])).toEqual([
      'x.alterar: desfazer-nao-implementado',
    ]);
  });

  it('recusa ciclo: duas promessas apoiadas uma na outra não aterrissam', () => {
    expect(
      motivos([
        cap({ id: 'a.criar', rota: 'POST /a', desfazer: 'b.criar' }),
        cap({ id: 'b.criar', rota: 'POST /b', desfazer: 'a.criar' }),
      ]),
    ).toEqual(['a.criar: ciclo', 'b.criar: ciclo']);
  });

  it('o caminho do ciclo entra no relatório inteiro, para dar o que consertar', () => {
    const linha = verificarReversibilidade({
      capacidades: [
        cap({ id: 'a.criar', rota: 'POST /a', desfazer: 'b.criar' }),
        cap({ id: 'b.criar', rota: 'POST /b', desfazer: 'c.criar' }),
        cap({ id: 'c.criar', rota: 'POST /c', desfazer: 'a.criar' }),
      ],
    })[0];
    expect(linha.motivo).toBe('ciclo');
    expect(linha.desfazer).toBe('a.criar → b.criar → c.criar → a.criar');
  });

  it('continua pegando os dois formatos antigos', () => {
    expect(motivos([cap({ id: 'x.criar', rota: 'POST /x' })])).toEqual(['x.criar: sem-desfazer']);
    expect(
      motivos([cap({ id: 'x.criar', rota: 'POST /x', desfazer: 'x.nao.existe' })]),
    ).toEqual(['x.criar: desfazer-inexistente']);
  });

  it('não cobra desfazer de quem não escreve fora do OS', () => {
    expect(
      motivos([
        cap({
          id: 'relatorio.gerar',
          nivel: 'R1',
          rota: 'POST /reports',
          efeito: { ...EFEITO_INTERNO, escreveForaDoOS: false, produzArtefato: true },
        }),
      ]),
    ).toEqual([]);
  });

  it('uma cadeia que aterrissa numa alteração é aceita', () => {
    expect(
      motivos([
        cap({ id: 'x.criar', rota: 'POST /x', desfazer: 'x.alterar' }),
        cap({ id: 'x.alterar', rota: 'PATCH /x/:id', desfazer: 'x.alterar' }),
      ]),
    ).toEqual([]);
  });
});

describe('invariantes da escada', () => {
  it('o nível é o gatilho mais alto, nunca a média', () => {
    // reversível + confidencial: o confidencial (R3) manda, não a média com R2
    expect(
      classificar({
        escreveForaDoOS: true,
        produzArtefato: false,
        reversibilidade: 'automatica',
        exposicaoExterna: false,
        impactoFinanceiro: 'nenhum',
        sensibilidade: 'confidencial',
        destruicao: false,
        obrigacaoLegal: false,
      }),
    ).toBe('R3');
  });

  it('as três palavras do R5 levam direto ao R5: apaga, movimenta, emite', () => {
    const base = {
      escreveForaDoOS: true,
      produzArtefato: false,
      reversibilidade: 'automatica' as const,
      exposicaoExterna: false,
      impactoFinanceiro: 'nenhum' as const,
      sensibilidade: 'interna' as const,
      destruicao: false,
      obrigacaoLegal: false,
    };
    expect(classificar({ ...base, destruicao: true })).toBe('R5'); // apaga
    expect(classificar({ ...base, impactoFinanceiro: 'movimento' })).toBe('R5'); // movimenta
    expect(classificar({ ...base, obrigacaoLegal: true })).toBe('R5'); // emite
  });

  it('sinais não acumulam e param em R4', () => {
    const cap: Capacidade = {
      id: 't',
      descricao: 't',
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
    };
    const um = avaliar(cap, { sinais: ['fora_da_janela'] });
    const quatro = avaliar(cap, {
      sinais: ['fora_da_janela', 'volume_atipico', 'erro_recente', 'destinatario_novo'],
    });
    expect(um.nivel).toBe('R3');
    expect(quatro.nivel).toBe('R3'); // quatro sinais não sobem quatro degraus
  });

  it('R5 não é escalonável nem executável — é preparado e devolvido', () => {
    const r5 = MKTOS.capacidades.find((c) => c.id === 'financeiro.pagamento.baixar')!;
    const d = avaliar(r5 as unknown as Capacidade, { sinais: ['volume_atipico'] });
    expect(d.nivel).toBe('R5');
    expect(d.permitido).toBe(false);
    expect(d.exigeMotivo).toBe(true);
    expect(d.motivo).toContain('preparado e encaminhado');
  });

  it('alcance acima de 10 sobe um degrau', () => {
    const e = {
      escreveForaDoOS: true,
      produzArtefato: false,
      reversibilidade: 'automatica' as const,
      exposicaoExterna: false,
      impactoFinanceiro: 'nenhum' as const,
      sensibilidade: 'interna' as const,
      destruicao: false,
      obrigacaoLegal: false,
    };
    expect(classificar({ ...e, alcance: 10 })).toBe('R2');
    expect(classificar({ ...e, alcance: 11 })).toBe('R3');
  });

  it('a validade da aprovação encurta conforme o risco sobe', () => {
    expect(APROVACAO_POR_NIVEL.R2.validadeSegundos).toBe(900);
    expect(APROVACAO_POR_NIVEL.R4.validadeSegundos).toBe(600);
    expect(APROVACAO_POR_NIVEL.R5.validadeSegundos).toBe(300);
    expect(APROVACAO_POR_NIVEL.R4.reautenticacao).toBe(true);
  });
});

describe('herança da política', () => {
  it('o delta herda tudo que não declara', () => {
    expect(MKTOS.niveis).toEqual(ROOT.niveis);
    expect(MKTOS.gatilhos).toEqual(ROOT.gatilhos);
    expect(MKTOS.invariantes).toEqual(ROOT.invariantes);
    expect(MKTOS.limitesPadrao).toEqual(ROOT.limitesPadrao);
  });

  it('capacidade da base que o delta não toca continua valendo', () => {
    const ids = new Set(MKTOS.capacidades.map((c) => c.id));
    expect(ids.has('nfe.emitir')).toBe(true); // só existe na base ROOT
    expect(ids.has('financeiro.pagamento.baixar')).toBe(true); // só no delta
  });

  it('capacidade com o mesmo id: o delta sobrescreve a base', () => {
    const base = ROOT.capacidades.find((c) => c.id === 'whatsapp.mensagem.enviar')!;
    const resolvida = MKTOS.capacidades.find((c) => c.id === 'whatsapp.mensagem.enviar')!;
    const doDelta = DELTA.capacidades.find((c) => c.id === 'whatsapp.mensagem.enviar')!;
    expect(resolvida.descricao).toBe(doDelta.descricao);
    expect(resolvida.descricao).not.toBe(base.descricao);
    expect(resolvida.nivel).toBe(base.nivel); // e o nível continua o mesmo: R3
  });
});

describe('catálogo do marketing-os', () => {
  it('cobre as 36 ferramentas MCP, todas em R0', () => {
    // A 36ª é `comunicacao.agenda.periodo` (list_calendar_range), da agenda da
    // Root (PR #11, 24/09/2026), que chegou sem este número subir.
    // MD9 (25/09/2026): a 36ª leitura, `instagram.comentario.ler`, é da rotina
    // da fila da DM e nasce SEM ferramenta — o que ela devolve é o @ de quem
    // comentou, que vai para a fila e nunca para um modelo.
    // MD11 (25/09/2026): `instagram.regra_de_resposta.pausar` também é R0 sem
    // ferramenta — é o freio da DM automática, clicado por gente na fila.
    const semFerramenta = ['instagram.comentario.ler', 'instagram.regra_de_resposta.pausar'];
    const leituras = DELTA.capacidades.filter((c) => c.nivel === 'R0' && !semFerramenta.includes(c.id));
    expect(leituras).toHaveLength(36);
    for (const id of semFerramenta) expect(DELTA.capacidades.find((c) => c.id === id)?.ferramenta, id).toBeUndefined();
    for (const c of leituras) {
      expect(c.ferramenta, `${c.id} sem nome de ferramenta`).toBeTruthy();
      expect(c.efeito.escreveForaDoOS).toBe(false);
    }
  });

  it('nome de ferramenta é aceito pela API de tool-calling e não se repete', () => {
    const nomes = DELTA.capacidades.map((c) => c.ferramenta).filter(Boolean) as string[];
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const n of nomes) expect(n).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });

  it('só duas capacidades são declaradas sem implementação, e ambas de propósito', () => {
    const semRota = DELTA.capacidades.filter((c) => !c.rota).map((c) => c.id);
    // email.rascunhar: prevista no documento, sem rota neste repo ainda.
    // financeiro.pagamento.baixar: existe SÓ para provar que a régua recusa
    // antes de existir efeito — é o passo 4 do roteiro da demo.
    expect(semRota.sort()).toEqual(['email.rascunhar', 'financeiro.pagamento.baixar']);
  });

  it('toda leitura aponta para o GET que a implementa', () => {
    // A exceção declarada (MD11): pausar a regra da DM é R0 por ser só um freio
    // interno, e não uma leitura — a rota dela é o POST do botão.
    for (const c of DELTA.capacidades.filter((x) => x.nivel === 'R0' && x.id !== 'instagram.regra_de_resposta.pausar')) {
      expect(c.rota, `${c.id} sem rota`).toMatch(/^GET /);
    }
    expect(DELTA.capacidades.find((x) => x.id === 'instagram.regra_de_resposta.pausar')?.rota).toBe('POST /pauta/dm/regras/:itemId/pausar');
  });

  it('a escrita que sai para fora sem volta nunca é menos que R3', () => {
    for (const c of DELTA.capacidades) {
      if (c.efeito.exposicaoExterna || c.efeito.reversibilidade === 'nenhuma') {
        expect(['R3', 'R4', 'R5'], `${c.id} é ${c.nivel}`).toContain(c.nivel);
      }
    }
  });
});

/*
 * MD6 (24/09/2026): a primeira escrita pública automática do OS. O que não pode
 * mudar sem alguém ver: o degrau (R3, e é o efeito que diz, não a vontade), a
 * ausência de `desfazer` (apagar post pela API não existe, e seria R5) e a
 * ausência de `ferramenta` (agente nenhum publica no Instagram da empresa).
 */
describe('instagram.post.publicar (MD6)', () => {
  const c = MKTOS.capacidades.find((x) => x.id === 'instagram.post.publicar');

  it('é R3 pelo efeito, sem desfazer e sem ferramenta', () => {
    expect(c, 'a capacidade sumiu do catálogo').toBeTruthy();
    expect(c!.nivel).toBe('R3');
    expect(classificar(c!.efeito)).toBe('R3');
    expect(c!.efeito).toMatchObject({ escreveForaDoOS: true, exposicaoExterna: true, reversibilidade: 'manual', sensibilidade: 'publica', destruicao: false });
    expect(c!.desfazer).toBeUndefined();
    expect(c!.ferramenta).toBeUndefined();
    expect(c!.rota).toBe('POST /pauta/pecas/:id/publicar-instagram');
  });

  it('com qualquer sinal aceso sobe a R4, nunca desce', () => {
    const cap: Capacidade = { id: c!.id, descricao: c!.descricao, nivel: c!.nivel, efeito: c!.efeito };
    expect(avaliar(cap, {}).nivel).toBe('R3');
    expect(avaliar(cap, { sinais: ['fora_da_janela'] }).nivel).toBe('R4');
  });

  it('o argsSchema é fechado e exige o conteúdo que a aprovação assina', () => {
    const s = c!.argsSchema as { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> };
    expect(s.additionalProperties).toBe(false);
    expect([...s.required].sort()).toEqual(['formato', 'igUserId', 'legenda', 'midias', 'pecaId']);
    expect(Object.keys(s.properties).sort()).toEqual(['agendadaPara', 'formato', 'igUserId', 'legenda', 'midias', 'pecaId']);
    // A mídia que prende a aprovação ao arquivo é conferida na PORTA, item a item.
    expect(s.properties.midias).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: { type: 'object', additionalProperties: false, required: ['chave', 'sha256'], properties: { sha256: { pattern: '^[0-9a-f]{64}$' } } },
    });
  });
});

/*
 * MD7 (24/09/2026): a régua aprende a aprovação de lote com uso contado. O que
 * não pode mudar sem alguém ver: o campo `aprovacao` chega ao runtime (o Zod
 * descartaria em silêncio um campo que o esquema não declara), o modo é enum
 * fechado, o lote só existe com alcance e nunca abaixo do item com sinal, e a
 * invariante 4 diz as duas formas.
 */
describe('aprovação de lote com uso contado (MD7)', () => {
  const lote = MKTOS.capacidades.find((x) => x.id === 'pauta.semana.aprovar');
  const publicar = MKTOS.capacidades.find((x) => x.id === 'instagram.post.publicar');

  const EFEITO_DO_LOTE = {
    escreveForaDoOS: true,
    produzArtefato: false,
    reversibilidade: 'nenhuma',
    exposicaoExterna: true,
    impactoFinanceiro: 'nenhum',
    sensibilidade: 'publica',
    destruicao: false,
    obrigacaoLegal: false,
    alcance: 60,
  } satisfies CapacidadeDoCatalogo['efeito'];

  it('o campo sobrevive a lerPolitica e a lerDelta', () => {
    expect(lote?.aprovacao).toEqual({ modo: 'lote', tetoDeItens: 60, validadeMaximaDias: 8 });
    expect(publicar?.aprovacao).toEqual({ modo: 'sob_lote', lote: 'pauta.semana.aprovar' });
    // Direto no delta, sem a resolução no meio.
    expect(DELTA.capacidades.find((c) => c.id === 'pauta.semana.aprovar')?.aprovacao?.modo).toBe('lote');
    // E numa política inteira lida do zero.
    const bruto = json('politica-root.json');
    bruto.capacidades = [...bruto.capacidades, { ...lote, efeito: EFEITO_DO_LOTE }];
    const lida = lerPolitica(bruto, 'teste');
    expect(lida.capacidades.find((c) => c.id === 'pauta.semana.aprovar')?.aprovacao).toEqual(lote?.aprovacao);
  });

  it('modo desconhecido é recusado, e chave estranha também — nada some calado', () => {
    const comModo = (aprovacao: unknown) => {
      const d = json('politica-marketing-os.json');
      d.capacidades = d.capacidades.map((c: { id: string }) =>
        c.id === 'pauta.semana.aprovar' ? { ...c, aprovacao } : c,
      );
      return () => lerDelta(d, 'teste');
    };
    expect(comModo({ modo: 'alcance', tetoPorDia: 200, validadeMaximaDias: 7 })).toThrow(/aprovacao/);
    expect(comModo({ modo: 'lote', tetoDeItens: 60, validadeMaximaDias: 8, usoUnico: false })).toThrow(/aprovacao/);
    expect(comModo({ modo: 'lote', tetoDeItens: 0, validadeMaximaDias: 8 })).toThrow(/tetoDeItens/);
    expect(comModo({ modo: 'sob_lote' })).toThrow(/lote/);
  });

  it('o catálogo resolvido passa nas três regras do lote', () => {
    const doLote = verificarCatalogo(MKTOS).filter((l) => l.problemas.length);
    expect(doLote).toEqual([]);
  });

  it('lote com alcance até 10 é recusado', () => {
    const pol = {
      capacidades: [
        cap({ id: 'x.lote.aprovar', nivel: 'R3', efeito: { ...EFEITO_DO_LOTE, alcance: 10 }, aprovacao: { modo: 'lote', tetoDeItens: 5, validadeMaximaDias: 1 } }),
      ],
    };
    const [l] = verificarCatalogo(pol);
    expect(l.ok).toBe(false);
    expect(l.problemas.join()).toMatch(/alcance acima de 10/);
  });

  it('lote abaixo do nível do item com um sinal aceso é recusado', () => {
    // O item é R3 (post público) e um sinal aceso o leva a R4.
    const item = cap({
      id: 'x.post.publicar',
      nivel: 'R3',
      efeito: { ...EFEITO_DO_LOTE, alcance: 1, reversibilidade: 'manual' },
      aprovacao: { modo: 'sob_lote', lote: 'x.lote.aprovar' },
    });
    // Lote que a régua deixa em R3: escrita interna reversível (R2) que o alcance sobe um degrau.
    const loteR3 = cap({
      id: 'x.lote.aprovar',
      nivel: 'R3',
      efeito: { ...EFEITO_INTERNO, alcance: 60 },
      aprovacao: { modo: 'lote', tetoDeItens: 5, validadeMaximaDias: 1 },
    });
    expect(classificar(loteR3.efeito)).toBe('R3');
    const doItem = verificarCatalogo({ capacidades: [item, loteR3] }).find((l) => l.id === item.id)!;
    expect(doItem.ok).toBe(false);
    expect(doItem.problemas.join()).toMatch(/é R3 e esta capacidade chega a R4/);

    // O mesmo item sob um lote R4 passa.
    const loteR4 = cap({ id: 'x.lote.aprovar', nivel: 'R4', efeito: EFEITO_DO_LOTE, aprovacao: loteR3.aprovacao });
    expect(verificarCatalogo({ capacidades: [item, loteR4] }).every((l) => l.ok)).toBe(true);
  });

  it('sob_lote que aponta para capacidade inexistente, ou que não é lote, é recusado', () => {
    const item = cap({ id: 'x.post.publicar', nivel: 'R3', efeito: { ...EFEITO_DO_LOTE, alcance: 1, reversibilidade: 'manual' }, aprovacao: { modo: 'sob_lote', lote: 'x.nao.existe' } });
    expect(verificarCatalogo({ capacidades: [item] })[0].problemas.join()).toMatch(/não existe/);
    const comum = cap({ id: 'x.nao.existe', nivel: 'R4', efeito: EFEITO_DO_LOTE });
    expect(verificarCatalogo({ capacidades: [item, comum] })[0].problemas.join()).toMatch(/não declara modo lote/);
  });

  it('pauta.semana.aprovar é R4 pelo alcance: titular, reautenticação, motivo e 600 s', () => {
    expect(lote!.nivel).toBe('R4');
    expect(classificar(lote!.efeito)).toBe('R4');
    const d = avaliar({ id: lote!.id, descricao: lote!.descricao, nivel: lote!.nivel, efeito: lote!.efeito });
    expect(d).toMatchObject({ nivel: 'R4', exigeAprovacao: true, exigeReautenticacao: true, exigeMotivo: true });
    expect(d.aprovacao).toMatchObject({ alcadaMinima: 'titular', validadeSegundos: 600 });
    expect(lote!.ferramenta).toBeUndefined();
    expect((lote!.argsSchema as { properties: { totalDeItens: unknown } }).properties.totalDeItens).toMatchObject({ maximum: 60 });
  });

  it('a publicação continua R3 no caminho de sempre, e o lote R4 cobre ela com sinal', () => {
    expect(publicar!.nivel).toBe('R3');
    const comSinal = avaliar({ id: publicar!.id, descricao: publicar!.descricao, nivel: publicar!.nivel, efeito: publicar!.efeito }, { sinais: ['fora_da_janela'] });
    expect(comSinal.nivel).toBe('R4');
    // O `loteItemId` é da porta, não do conteúdo: o esquema de argumentos não o declara.
    expect(Object.keys((publicar!.argsSchema as { properties: object }).properties)).not.toContain('loteItemId');
  });

  it('a invariante 4 diz as duas formas: uso único ou uso contado com lote', () => {
    expect(ROOT.invariantes[3]).toBe(
      'aprovação é de uso único — ou de uso contado, item a item, quando a capacidade declara lote —, presa ao conteúdo exato e com prazo',
    );
    expect(MKTOS.invariantes).toEqual(ROOT.invariantes);
  });
});

/*
 * MD9 (25/09/2026): a leitura dos comentários para a fila da DM à mão. O que não
 * pode mudar sem alguém ver: é R0 pelo efeito (nada escreve, nada sai), e é
 * R0 de propósito — declarada R1, o sinal da noite ou do volume a subiria a R2,
 * que exige aprovação, e a rotina de 10 em 10 min encheria a fila de pedidos de
 * LER. Não tem ferramenta: o @ que ela devolve não vai a modelo nenhum.
 */
describe('instagram.comentario.ler (MD9)', () => {
  const c = MKTOS.capacidades.find((x) => x.id === 'instagram.comentario.ler');

  it('é R0 pelo efeito, sem ferramenta e sem desfazer, e com sinal aceso não pede aprovação', () => {
    expect(c, 'a capacidade sumiu do catálogo').toBeTruthy();
    expect(c!.nivel).toBe('R0');
    expect(classificar(c!.efeito)).toBe('R0');
    expect(c!.efeito).toMatchObject({ escreveForaDoOS: false, produzArtefato: false, exposicaoExterna: false, sensibilidade: 'interna', destruicao: false });
    expect(c!.ferramenta).toBeUndefined();
    expect(c!.desfazer).toBeUndefined();
    const cap: Capacidade = { id: c!.id, descricao: c!.descricao, nivel: c!.nivel, efeito: c!.efeito };
    const comSinais = avaliar(cap, { sinais: ['fora_da_janela', 'volume_atipico'] });
    expect(comSinais.nivel).toBe('R1');
    expect(comSinais.exigeAprovacao).toBe(false);
    // O contraexemplo que decidiu o degrau: o mesmo efeito com produzArtefato sobe a R2 e pede aprovação.
    const comoR1: Capacidade = { ...cap, nivel: 'R1', efeito: { ...c!.efeito, produzArtefato: true } };
    expect(avaliar(comoR1, { sinais: ['fora_da_janela'] }).exigeAprovacao).toBe(true);
  });

  it('o esquema de argumentos é fechado: a conta e até 30 posts, cada um com a palavra do CTA', () => {
    const s = c!.argsSchema as unknown as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, Record<string, unknown>>;
    };
    expect(s.additionalProperties).toBe(false);
    expect([...s.required].sort()).toEqual(['igUserId', 'midias']);
    expect(s.properties.midias).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: { type: 'object', additionalProperties: false, required: ['pecaId', 'palavra'], properties: { palavra: { pattern: '^[A-Z0-9]{3,20}$' } } },
    });
  });
});

/*
 * MD10 (25/09/2026): o YouTube pela API. O que não pode mudar sem alguém ver:
 * as duas são R3 pelo efeito, com reversibilidade `manual` — `automatica` daria
 * R2, mas desfazer o envio seria apagar o vídeo, que é destruição e R5, então
 * o valor honesto é `manual` —; o envio não expõe (o vídeo é sempre privado) e a
 * publicação expõe; as duas saem só pelo lote da semana (R4), que cobre o sinal
 * aceso; e os argumentos prendem a aprovação ao arquivo (sha256 e tamanho), ao
 * texto, à categoria, à thumb e, na publicação, ao horário.
 */
describe('youtube.video.enviar e youtube.video.publicar (MD10)', () => {
  const enviar = MKTOS.capacidades.find((x) => x.id === 'youtube.video.enviar');
  const publicar = MKTOS.capacidades.find((x) => x.id === 'youtube.video.publicar');
  const lote = MKTOS.capacidades.find((x) => x.id === 'pauta.semana.aprovar');

  it('as duas são R3 pelo efeito, sem ferramenta e sem desfazer; o envio não expõe, a publicação expõe', () => {
    expect(enviar, 'youtube.video.enviar sumiu do catálogo').toBeTruthy();
    expect(publicar, 'youtube.video.publicar sumiu do catálogo').toBeTruthy();
    for (const c of [enviar!, publicar!]) {
      expect(c.nivel).toBe('R3');
      expect(classificar(c.efeito)).toBe('R3');
      expect(c.efeito).toMatchObject({ escreveForaDoOS: true, reversibilidade: 'manual', sensibilidade: 'publica', destruicao: false });
      expect(c.ferramenta).toBeUndefined();
      expect(c.desfazer).toBeUndefined();
      expect(c.aprovacao).toEqual({ modo: 'sob_lote', lote: 'pauta.semana.aprovar' });
    }
    expect(enviar!.efeito.exposicaoExterna).toBe(false);
    expect(publicar!.efeito.exposicaoExterna).toBe(true);
    // O contraexemplo que decidiu a reversibilidade: `automatica` desceria o envio a R2.
    expect(classificar({ ...enviar!.efeito, reversibilidade: 'automatica' })).toBe('R2');
  });

  it('com sinal aceso sobem a R4, e o lote da semana (R4) ainda cobre', () => {
    for (const c of [enviar!, publicar!]) {
      const cap: Capacidade = { id: c.id, descricao: c.descricao, nivel: c.nivel, efeito: c.efeito };
      expect(avaliar(cap, {}).nivel).toBe('R3');
      expect(avaliar(cap, { sinais: ['fora_da_janela'] }).nivel).toBe('R4');
    }
    expect(lote!.nivel).toBe('R4');
  });

  it('os esquemas são fechados; a publicação é o envio mais o horário', () => {
    const e = enviar!.argsSchema as { additionalProperties: boolean; required: string[]; properties: Record<string, Record<string, unknown>> };
    const p = publicar!.argsSchema as typeof e;
    const campos = ['bytes', 'categoria', 'descricao', 'episodioId', 'sha256', 'thumbChave', 'thumbN', 'thumbSha', 'titulo'];
    expect(e.additionalProperties).toBe(false);
    expect([...e.required].sort()).toEqual(campos);
    expect(Object.keys(e.properties).sort()).toEqual(campos);
    expect(p.additionalProperties).toBe(false);
    expect([...p.required].sort()).toEqual([...campos, 'publicarEm'].sort());
    expect(e.properties.sha256).toMatchObject({ pattern: '^[0-9a-f]{64}$' });
    expect(e.properties.thumbSha).toMatchObject({ pattern: '^[0-9a-f]{12}$' });
    expect(e.properties.bytes).toMatchObject({ type: 'integer', minimum: 1 });
    expect(e.properties.thumbN).toMatchObject({ type: 'integer', minimum: 1, maximum: 3 });
  });
});

/*
 * MD11 (25/09/2026): a DM automática sob o lote da semana. O que não pode mudar
 * sem alguém ver: o envio é R3 pelo efeito (sai do OS, sem volta, exposto, a
 * uma pessoa) e sobe a R4 com a procedência externa que o executor sempre
 * marca — e o lote da semana, R4, ainda cobre (a regra do desenho da MC18:
 * a assinatura é ≥ o envio); o envio só sai pelo lote; o esquema prende o
 * texto, o link, o destino e as peças, e deixa de FORA o id do comentário e a
 * pessoa (senão nenhum envio casaria com o item assinado). Pausar é R0, sem
 * aprovação nem com sinal aceso, porque só diminui o alcance.
 */
describe('instagram.resposta_privada.enviar e instagram.regra_de_resposta.pausar (MD11)', () => {
  const enviar = MKTOS.capacidades.find((x) => x.id === 'instagram.resposta_privada.enviar');
  const pausar = MKTOS.capacidades.find((x) => x.id === 'instagram.regra_de_resposta.pausar');
  const lote = MKTOS.capacidades.find((x) => x.id === 'pauta.semana.aprovar');

  it('o envio é R3 pelo efeito, a uma pessoa, sem ferramenta, sem desfazer e só sob o lote da semana', () => {
    expect(enviar, 'instagram.resposta_privada.enviar sumiu do catálogo').toBeTruthy();
    expect(enviar!.nivel).toBe('R3');
    expect(classificar(enviar!.efeito)).toBe('R3');
    expect(enviar!.efeito).toMatchObject({ escreveForaDoOS: true, reversibilidade: 'nenhuma', exposicaoExterna: true, sensibilidade: 'publica', alcance: 1 });
    expect(enviar!.ferramenta).toBeUndefined();
    expect(enviar!.desfazer).toBeUndefined();
    expect(enviar!.aprovacao).toEqual({ modo: 'sob_lote', lote: 'pauta.semana.aprovar' });
    // `restrita` com alcance alto empurraria a R5: é o limite de cima do desenho.
    expect(classificar({ ...enviar!.efeito, sensibilidade: 'restrita', alcance: 200 })).toBe('R5');
  });

  it('com a procedência externa o envio vira R4, e o lote da semana (R4) cobre — nunca o contrário', () => {
    const cap: Capacidade = { id: enviar!.id, descricao: enviar!.descricao, nivel: enviar!.nivel, efeito: enviar!.efeito };
    expect(avaliar(cap, {}).nivel).toBe('R3');
    const comSinal = avaliar(cap, { sinais: ['fonte_nao_confiavel'] });
    expect(comSinal.nivel).toBe('R4');
    expect(comSinal.aprovacao.alcadaMinima).toBe('titular');
    expect(lote!.nivel).toBe('R4');
    expect(verificarCatalogo(MKTOS).find((l) => l.id === enviar!.id)?.problemas).toEqual([]);
  });

  it('o esquema do envio é fechado e não tem lugar para o comentário nem para a pessoa', () => {
    const e = enviar!.argsSchema as { additionalProperties: boolean; required: string[]; properties: Record<string, Record<string, unknown>> };
    const campos = ['bioLinkId', 'destinoAprovado', 'igUserId', 'midias', 'palavra', 'texto'];
    expect(e.additionalProperties).toBe(false);
    expect([...e.required].sort()).toEqual(campos);
    expect(Object.keys(e.properties).sort()).toEqual(campos);
    expect(Object.keys(e.properties).join()).not.toMatch(/comment|pessoa|usuario|loteItemId/i);
    expect(e.properties.palavra).toMatchObject({ pattern: '^[A-Z0-9]{3,20}$' });
    expect(e.properties.midias).toMatchObject({ type: 'array', minItems: 1, maxItems: 6 });
  });

  it('pausar é R0 (interno, só diminui o alcance): nem com sinal aceso pede outra pessoa; o campo não se chama loteItemId (a porta o tomaria como item de lote)', () => {
    expect(pausar, 'instagram.regra_de_resposta.pausar sumiu do catálogo').toBeTruthy();
    expect(pausar!.nivel).toBe('R0');
    expect(classificar(pausar!.efeito)).toBe('R0');
    expect(pausar!.efeito).toMatchObject({ escreveForaDoOS: false, produzArtefato: false, sensibilidade: 'interna' });
    expect(pausar!.aprovacao).toBeUndefined();
    expect(pausar!.ferramenta).toBeUndefined();
    const cap: Capacidade = { id: pausar!.id, descricao: pausar!.descricao, nivel: pausar!.nivel, efeito: pausar!.efeito };
    expect(avaliar(cap, {}).exigeAprovacao).toBe(false);
    // O motivo de não ser R1: com um sinal, R1 viraria R2 e o freio iria para a fila.
    for (const sinal of ['fora_da_janela', 'volume_atipico'] as const) {
      expect(avaliar(cap, { sinais: [sinal] })).toMatchObject({ nivel: 'R1', exigeAprovacao: false });
      expect(avaliar({ ...cap, nivel: 'R1', efeito: { ...cap.efeito, produzArtefato: true } }, { sinais: [sinal] })).toMatchObject({ nivel: 'R2', exigeAprovacao: true });
    }
    const a = pausar!.argsSchema as { required: string[]; properties: Record<string, unknown> };
    expect([...a.required].sort()).toEqual(['motivo', 'regraId']);
    expect(Object.keys(a.properties)).not.toContain('loteItemId');
  });
});
