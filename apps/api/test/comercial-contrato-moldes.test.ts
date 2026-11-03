import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contarMarcas } from '../src/comercial/contrato-da-root/minuta';
import { CAMPOS_DA_QUALIFICACAO, DATA_DO_MOLDE, camposDoTexto, moldeDoContrato } from '../src/comercial/contrato-da-root/moldes-do-contrato';
import { centavosDoValor, preencherMolde } from '../src/comercial/contrato-da-root/preencher-molde';

/*
 * Os moldes e o preenchimento, sem banco. Os esperados em `fixtures/contrato-moldes/` são a
 * saída de verdade do `preencher.py` da skill root-contrato sobre os exemplos fictícios dela.
 */

type Modalidade = 'implantacao' | 'continuidade';

interface Fixture {
  aceite: Record<string, unknown>;
  contratada: Record<string, unknown>;
  paragrafos: string[];
  lacunas: string[];
}

function fixture(m: Modalidade): Fixture {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', 'contrato-moldes', `exemplo-${m}.json`), 'utf8')) as Fixture;
}

/** O texto preenchido como parágrafos planos, para comparar com os do .docx. */
function paragrafosPlanos(texto: string): string[] {
  return texto
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.replace(/^(?:# |### |- )/, '').replace(/\*\*/g, '').trim());
}

/** Os parágrafos do .docx sem o que o texto não traz: o rótulo da qualificação e os blocos de assinatura. */
function esperadoDoScript(paragrafos: string[]): string[] {
  const fim = paragrafos.findIndex((p) => p.startsWith('Juiz de Fora/MG, na data'));
  return paragrafos
    .slice(0, fim + 1)
    .filter((p) => p !== 'QUALIFICAÇÃO DAS PARTES')
    .map((p) => p.replace(/\[\[(?:preencher: )?([^\]]+)\]\]/g, '⟦lacuna: $1⟧'));
}

describe('os moldes como dado versionado', () => {
  it('a catraca do texto: mudar cláusula é decisão, e este hash muda junto', () => {
    const hash = (m: Modalidade) => createHash('sha256').update(moldeDoContrato(m).texto).digest('hex');
    expect(hash('implantacao')).toBe('983ac2b2f2024065ee201a291b8b77fda1b9f40c3c0e1604df66e45cf6e43b5c');
    expect(hash('continuidade')).toBe('0b09be3014e3792f294ad16be2b75acc326005b183a669aa466c103bee38e301');
  });

  it('cada molde tem o título certo, a data e doze cláusulas', () => {
    const imp = moldeDoContrato('implantacao');
    const con = moldeDoContrato('continuidade');
    expect(imp.titulo).toBe('CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE IMPLANTAÇÃO E ACOMPANHAMENTO');
    expect(con.titulo).toBe('CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE CONSULTORIA E ACOMPANHAMENTO');
    expect(imp.texto.startsWith(`# ${imp.titulo}\n`)).toBe(true);
    expect(con.texto.startsWith(`# ${con.titulo}\n`)).toBe(true);
    expect(imp.data).toBe(DATA_DO_MOLDE);
    for (const m of [imp, con]) expect(m.texto.match(/^### CLÁUSULA /gm)).toHaveLength(12);
  });

  it('não traz dado de cliente nem da contratada: nem CNPJ, nem CPF, nem testemunha', () => {
    for (const m of ['implantacao', 'continuidade'] as const) {
      const { texto } = moldeDoContrato(m);
      expect(texto).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
      expect(texto).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
      expect(texto).not.toMatch(/@/);
      expect(texto).not.toMatch(/\bLTDA\b/i);
      expect(texto).not.toMatch(/testemunha/i);
      expect(texto).not.toContain('—');
    }
  });

  it('lista os campos de cada molde com tipo e formato', () => {
    const { campos } = moldeDoContrato('implantacao');
    expect(campos).toContainEqual({ nome: 'valor_total', tipo: 'texto', formato: 'reais' });
    expect(campos).toContainEqual({ nome: 'entregas', tipo: 'lista', formato: null });
    expect(campos).toContainEqual({ nome: 'credito_continuidade', tipo: 'opcional', formato: null });
    expect(campos).toContainEqual({ nome: 'prazo_implantacao_dias', tipo: 'texto', formato: 'ordinal' });
    expect(moldeDoContrato('continuidade').campos).toContainEqual({ nome: 'duracao_encontro_horas', tipo: 'texto', formato: 'num_f' });
    expect(CAMPOS_DA_QUALIFICACAO).toContain('contratante_tipo');
  });

  it('modalidade desconhecida lança', () => {
    expect(() => moldeDoContrato('outra' as Modalidade)).toThrow(/desconhecida/);
  });
});

describe('o preenchimento bate com o preencher.py', () => {
  for (const m of ['implantacao', 'continuidade'] as const) {
    it(`${m}: parágrafo por parágrafo, e as mesmas lacunas`, () => {
      const f = fixture(m);
      const { texto, lacunas } = preencherMolde(moldeDoContrato(m).texto, { ...f.contratada, ...f.aceite });
      expect(paragrafosPlanos(texto)).toEqual(esperadoDoScript(f.paragrafos));
      expect(lacunas).toEqual(f.lacunas.map((l) => l.replace(/\[\[(?:preencher: )?([^\]]+)\]\]/, '$1')));
    });
  }

  it('implantação: lista expandida, letras refeitas, valor com extenso e ordinal', () => {
    const f = fixture('implantacao');
    const { texto, lacunas, avisos } = preencherMolde(moldeDoContrato('implantacao').texto, { ...f.contratada, ...f.aceite });
    expect(lacunas).toEqual([]);
    expect(avisos).toEqual([]);
    expect(texto).toContain('- (c) **autonomia:** o treinamento da pessoa indicada pela CONTRATANTE para cuidar do ambiente e o manual do ambiente.');
    expect(texto).toContain('- (b) **painel:** o painel com os indicadores combinados na proposta; e');
    expect(texto).toContain('R$ 9.000,00 (nove mil reais)');
    expect(texto).toContain('vencerá no 30º (trigésimo) dia');
    expect(texto).toContain('CONTRATANTE: **EMPRESA EXEMPLO LTDA**, inscrita no CNPJ');
    expect(texto).toContain('(doravante “CONTRATANTE” ou “Exemplo”)');
    // A exclusão da proposta vem antes das fixas, que ganham a letra seguinte.
    expect(texto).toContain('- (a) a análise financeira e a reestruturação da CONTRATANTE;\n- (b) a configuração');
    expect(texto).toContain('4.6. Se as partes celebrarem');
  });

  it('continuidade em pessoa física no masculino: concordância e lacunas à vista', () => {
    const f = fixture('continuidade');
    const { texto, lacunas, avisos } = preencherMolde(moldeDoContrato('continuidade').texto, { ...f.contratada, ...f.aceite });
    expect(lacunas).toEqual(['estado civil', 'nome do sócio que conduz']);
    expect(texto).toContain('o CONTRATANTE');
    expect(texto).not.toMatch(/\b(?:a|à|da|pela|na) CONTRATANTE/);
    expect(texto).toContain('o CONTRATANTE figura como controlador e');
    expect(texto).toContain('propriedade exclusiva deste.');
    expect(texto).toContain('2 (duas) horas');
    expect(texto).toContain('4 (quatro) parcelas');
    expect(avisos.join()).toMatch(/concordância/);
  });
});

describe('as regras do preenchimento', () => {
  const molde = (t: string) => t;
  const lacunasDoTexto = (t: string) => contarMarcas(t).lacunas;

  it('campo sem valor vira a marca da minuta, nunca texto inventado', () => {
    const { texto, lacunas } = preencherMolde(molde('A [[x]], B [[y|reais]], C [[z]].'), { x: '', z: null });
    expect(texto).toBe('A ⟦lacuna: x⟧, B ⟦lacuna: y⟧, C ⟦lacuna: z⟧.');
    expect(contarMarcas(texto).lacunas).toEqual(['x', 'y', 'z']);
    // A lista traz também o que falta nos blocos de assinatura.
    expect(lacunas.slice(0, 3)).toEqual(['x', 'y', 'z']);
    expect(lacunas).toContain('contratada_nome');
  });

  it('o molde inteiro sem dado nenhum: tudo lacuna, nada de [[ sobrando', () => {
    for (const m of ['implantacao', 'continuidade'] as const) {
      const r = preencherMolde(moldeDoContrato(m).texto, {});
      expect(r.texto).not.toContain('[[');
      expect(r.lacunas).toContain('valor_total');
      expect(r.lacunas).toContain('contratada_nome');
      expect(contarMarcas(r.texto).lacunas.length).toBeGreaterThan(5);
    }
  });

  it('os formatos numéricos', () => {
    const f = (t: string, c: Record<string, unknown>) => preencherMolde(t, c).texto;
    expect(f('[[v|reais]]', { v: 2500.5 })).toBe('R$ 2.500,50 (dois mil e quinhentos reais e cinquenta centavos)');
    expect(f('[[v|reais]]', { v: '3.970,00' })).toBe('R$ 3.970,00 (três mil novecentos e setenta reais)');
    expect(f('[[v|num]]', { v: 30 })).toBe('30 (trinta)');
    expect(f('[[v|num_f]]', { v: 2 })).toBe('2 (duas)');
    expect(f('[[v|num_f]]', { v: 200 })).toBe('200 (duzentas)');
    expect(f('[[v|num_f]]', { v: 1 })).toBe('1 (uma)');
    expect(f('[[v|num_f]]', { v: 2221 })).toBe('2221 (duas mil duzentas e vinte e uma)');
    expect(f('[[v|num_f]]', { v: 2_000_002 })).toBe('2000002 (dois milhões e duas)');
    expect(f('[[v|ordinal]]', { v: 30 })).toBe('30º (trigésimo)');
    expect(f('[[v|ordinal]]', { v: 121 })).toBe('121º (centésimo vigésimo primeiro)');
  });

  it('valor mal formado vira lacuna com aviso', () => {
    const r = preencherMolde('[[a|reais]] e [[b|num]] e [[c|ordinal]]', { a: 'muito', b: 2.5, c: 1000 });
    expect(lacunasDoTexto(r.texto)).toEqual(['a', 'b', 'c']);
    expect(r.avisos).toHaveLength(3);
    expect(() => centavosDoValor('-5')).toThrow();
    expect(centavosDoValor('R$ 1.234.567,89')).toBe(123456789);
    expect(centavosDoValor('1.000')).toBe(100000);
  });

  it('|apelido: vazio some, ausente é lacuna', () => {
    expect(preencherMolde('“X”[[n|apelido]].', { n: 'Curto' }).texto).toBe('“X” ou “Curto”.');
    expect(preencherMolde('“X”[[n|apelido]].', { n: '' }).texto).toBe('“X”.');
    expect(lacunasDoTexto(preencherMolde('“X”[[n|apelido]].', {}).texto)).toEqual(['n']);
  });

  it('[[opcional:x]]: true mantém, false tira a linha, ausente fica lacuna', () => {
    const t = 'antes\n\n4.6. [[opcional:c]]Texto do crédito.\n\ndepois';
    expect(preencherMolde(t, { c: true }).texto).toBe('antes\n\n4.6. Texto do crédito.\n\ndepois');
    expect(preencherMolde(t, { c: false }).texto).toBe('antes\n\ndepois');
    expect(preencherMolde(t, {}).texto).toContain('4.6. ⟦lacuna: c⟧Texto');
    expect(lacunasDoTexto(preencherMolde(t, {}).texto)).toEqual(['c']);
  });

  it('[[lista:x]]: pontuação do grupo, letras refeitas, vazia some, sem lista é lacuna', () => {
    const t = '2.1. Itens:\n\n- (a) [[lista:x]]\n- (b) fixa um;\n- (c) fixa dois.\n\n3.1. Outro:\n\n- (a) só;';
    const com = preencherMolde(t, { x: ['um', { titulo: 'dois:', texto: 'corpo;' }] }).texto;
    expect(com).toContain('- (a) um;\n- (b) **dois:** corpo;\n- (c) fixa um;\n- (d) fixa dois.');
    expect(com).toContain('3.1. Outro:\n\n- (a) só;');
    expect(preencherMolde(t, { x: [] }).texto).toContain('2.1. Itens:\n\n- (a) fixa um;\n- (b) fixa dois.');
    expect(lacunasDoTexto(preencherMolde(t, {}).texto)).toEqual(['x']);
    const fecha = preencherMolde('1.2. Lista:\n\n- (a) [[lista:x]]\n\n1.3. Depois.', { x: ['um', 'dois', 'três'] }).texto;
    expect(fecha).toContain('- (a) um;\n- (b) dois; e\n- (c) três.');
  });

  it('valor não forja marca nem campo: entra numa passada só, em uma linha', () => {
    const r = preencherMolde('[[a]] / [[b]]\n\n- (a) [[lista:c]]', {
      a: '⟦inserido: falso⟧ [[segredo]]\n### CLÁUSULA FALSA',
      b: '[[preencher: quem conduz]]',
      c: ['[[segredo]]'],
      segredo: 'não pode aparecer',
    });
    expect(r.texto).not.toContain('não pode aparecer');
    expect(r.texto).not.toContain('⟦inserido');
    expect(r.texto).not.toContain('\n###');
    expect(lacunasDoTexto(r.texto)).toEqual(['segredo', 'quem conduz', 'segredo']);
  });

  it('a contratada do contrato vence a do aceite, e vazia ali é lacuna', () => {
    const aceite = { contratada_nome: 'DO ACEITE', contratada_pix: 'pix-do-aceite' };
    const r = preencherMolde('[[contratada_nome]] [[contratada_pix]]', aceite, { contratada: { nome: 'DO CONTRATO', pix: null } });
    expect(r.texto).toBe('DO CONTRATO ⟦lacuna: contratada_pix⟧');
    expect(camposDoTexto('[[contratada_pix]]')[0].nome).toBe('contratada_pix');
  });

  it('confere as somas e só avisa', () => {
    const r = preencherMolde('x', { valor_total: 100, valor_entrada: 50, valor_saldo: 40, numero_parcelas: 3, valor_parcela: 10 });
    expect(r.avisos.join('\n')).toMatch(/soma não fecha/);
    expect(r.avisos.join('\n')).toMatch(/parcelas não fecham/);
  });

  it('qualificação: PJ com representante, PF com o que falta como lacuna, chave com _ ignorada', () => {
    const pj = preencherMolde('[[contratante_qualificacao]]', {
      _x: 'ignorado',
      contratante_tipo: 'PJ',
      contratante_documento: '00.000.000/0001-00',
      contratante_endereco: 'Largo X, nº 1',
      contratante_email: 'a@b.invalid',
      contratante_representante: 'FULANA',
      contratante_representante_cpf: '000.000.000-00',
      contratante_representante_genero: 'f',
    }).texto;
    expect(pj).toBe('inscrita no CNPJ sob o nº 00.000.000/0001-00, com sede no Largo X, nº 1, e-mail a@b.invalid, neste ato representada por sua sócia-administradora, **FULANA**, inscrita no CPF sob o nº 000.000.000-00');
    const pf = preencherMolde('[[contratante_qualificacao]]', { contratante_tipo: 'PF' });
    expect(pf.lacunas).toEqual(['nacionalidade', 'estado civil', 'profissão', 'CPF', 'endereço completo com CEP', 'e-mail do contratante', 'contratada_nome', 'contratada_documento', 'contratante_nome']);
  });

  it('os blocos de assinatura: um por parte, ou um por signatário quando o contrato diz quem assina', () => {
    const c = { contratada_nome: 'ROOT TESTE', contratada_documento: 'CNPJ 1', contratante_nome: 'CLIENTE', contratante_tipo: 'PJ', contratante_documento: '2', contratante_representante: 'FULANO' };
    expect(preencherMolde('x', c).signatarios).toEqual([
      { nome: 'ROOT TESTE', linhas: ['CNPJ 1', 'CONTRATADA'] },
      { nome: 'CLIENTE', linhas: ['CONTRATANTE', 'FULANO', 'CNPJ 2'] },
    ]);
    const conjunta = preencherMolde('x', c, {
      signatarios: [
        { nome: 'SÓCIA UM', papel: 'root' },
        { nome: 'SÓCIO DOIS', papel: 'root' },
        { nome: 'FULANO', papel: 'cliente' },
      ],
    }).signatarios;
    expect(conjunta.map((s) => s.nome)).toEqual(['SÓCIA UM', 'SÓCIO DOIS', 'FULANO']);
    expect(conjunta[1].linhas).toEqual(['CONTRATADA', 'ROOT TESTE', 'CNPJ 1']);
    expect(preencherMolde('x', {}).lacunas).toContain('contratada_documento');
  });
});
