import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { avaliar, classificar, APROVACAO_POR_NIVEL, type Capacidade } from '../src/escada.js';
import { lerPolitica, lerDelta, resolverPolitica } from '../src/esquema.js';
import { verificarCatalogo, casosDeDecisao } from '../src/verificacao.js';

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

describe.each([
  ['politica-root.json', ROOT, { externo: 'whatsapp.mensagem.enviar', interno: 'clickup.tarefa.criar' }],
  ['politica-marketing-os.json', MKTOS, { externo: 'whatsapp.mensagem.enviar', interno: 'operacao.tarefa.alterar' }],
])('%s', (_nome, pol, ids) => {
  it('todo nível declarado é o que a régua calcula do efeito', () => {
    const linhas = verificarCatalogo(pol);
    const falhas = linhas.filter((l) => !l.ok);
    expect(
      falhas.map((f) => `${f.id}: declarado=${f.declarado} calculado=${f.calculado}`),
    ).toEqual([]);
    expect(linhas.length).toBeGreaterThan(0);
  });

  it('não repete id de capacidade', () => {
    const ids2 = pol.capacidades.map((c) => c.id);
    expect(new Set(ids2).size).toBe(ids2.length);
  });

  /*
   * ACHADO NO ANEXO NORMATIVO, 28/08/2026 — não é typo, é uma lacuna sistemática.
   *
   * O R2 se define como "cria ou altera um registro interno que o próprio OS
   * consegue desfazer", e as TRÊS capacidades R2 do politica-root.json nomeiam
   * o desfazer — clickup.tarefa.excluir, crm.lead.arquivar, agenda.evento.excluir.
   * Nenhuma das três está declarada no catálogo. O nível que sustenta a promessa
   * de reversibilidade aponta para capacidades que não existem.
   *
   * Não corrigi em silêncio: politica-root.json é cópia byte a byte de
   * HANDOFF-DEV/anexos e mexer nele é mexer no documento normativo. Fica
   * declarado aqui, com o motivo. Um desfazer pendurado NOVO reprova.
   */
  const DESFAZER_PENDURADO = new Set([
    'clickup.tarefa.criar',
    'crm.lead.criar',
    'agenda.evento.criar',
  ]);

  it('capacidade com desfazer aponta para capacidade que existe', () => {
    const conhecidas = new Set(pol.capacidades.map((c) => c.id));
    const pendurados = pol.capacidades
      .filter((c) => c.desfazer && !conhecidas.has(c.desfazer))
      .map((c) => c.id);
    expect(pendurados.filter((id) => !DESFAZER_PENDURADO.has(id))).toEqual([]);
  });

  it('a lacuna do anexo não cresce: o delta daqui não pendura desfazer novo', () => {
    const conhecidas = new Set(DELTA.capacidades.map((c) => c.id));
    const pendurados = DELTA.capacidades
      .filter((c) => c.desfazer && !conhecidas.has(c.desfazer))
      .map((c) => `${c.id} → ${c.desfazer}`);
    expect(pendurados).toEqual([]);
  });

  it('os cinco casos de decisão do anexo se comportam como o documento manda', () => {
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

    // R2 é o único nível em que o cliente decide
    const semAprovacao = porNome['registro interno, aprovação desligada'];
    expect(semAprovacao.nivel).toBe('R2');
    expect(semAprovacao.exigeAprovacao).toBe(false);

    // conteúdo externo só eleva
    const suspeito = porNome['registro interno, fonte não confiável'];
    expect(suspeito.nivel).toBe('R3');
    expect(suspeito.exigeAprovacao).toBe(true);

    // fail closed
    const desconhecida = porNome['ferramenta desconhecida'];
    expect(desconhecida.nivel).toBe('R5');
    expect(desconhecida.permitido).toBe(false);
    expect(desconhecida.motivo).toBe('capacidade sem classificação vale R5');
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
  it('cobre as 35 ferramentas MCP, todas em R0', () => {
    const leituras = DELTA.capacidades.filter((c) => c.nivel === 'R0');
    expect(leituras).toHaveLength(35);
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
    for (const c of DELTA.capacidades.filter((x) => x.nivel === 'R0')) {
      expect(c.rota, `${c.id} sem rota`).toMatch(/^GET /);
    }
  });

  it('a escrita que sai para fora sem volta nunca é menos que R3', () => {
    for (const c of DELTA.capacidades) {
      if (c.efeito.exposicaoExterna || c.efeito.reversibilidade === 'nenhuma') {
        expect(['R3', 'R4', 'R5'], `${c.id} é ${c.nivel}`).toContain(c.nivel);
      }
    }
  });
});
