import { describe, expect, it } from 'vitest';

import { textoDoPdf } from '../src/google/texto-do-pdf';
import { gerarPdfDoContrato } from '../src/comercial/contrato-da-root/pdf-do-contrato';
import { regrasDoRevisor } from '../src/comercial/contrato-da-root/revisor';
import {
  apontamentosGraves,
  assinaturaDaEntrada,
  camposDoAceite,
  camposEscritos,
  camposParaATela,
  contratadaDoContrato,
  juntarCampos,
  mantemAsClausulas,
  moldeDoFilho,
  pedidoDoPdf,
  preencherRegistro,
  referenciaAoPai,
  rodapeDaContratada,
  textoDaProposta,
  type AceiteParaEmissao,
  type EntradaDoPreenchimento,
} from '../src/comercial/contratos/emissao-puro';

/* A emissão sem banco: de onde vem cada campo, o que vira lacuna, o texto de aditivo e distrato e o PDF determinístico. */

const ACEITE: AceiteParaEmissao = { versao: 2, produto: 'operacao', valorCentavos: 1_200_000, parcelas: 3, dados: { cnpj: '12345678000190', razaoSocial: 'Padaria Modelo Ltda', endereco: 'Rua A, 1', quemAssina: 'Carla Dias', email: 'carla@padaria.test' } };

const COMPLETOS = {
  objeto_implantacao: 'um sistema de pedidos',
  entregas: ['a base de consulta', 'a rotina diária'],
  prazo_implantacao_dias: '60',
  numero_encontros: '8',
  periodicidade_encontros: 'semanais',
  pauta_encontros: ['o contexto', 'a base'],
  prazo_acompanhamento_dias: '30',
  exclusoes: ['a contabilidade'],
  data_primeiro_encontro: '10/11/2026',
  valor_entrada: '6.000,00',
  valor_saldo: '6.000,00',
  credito_continuidade: 'nao',
  acessos_contratante: 'ao sistema de gestão',
  participantes_encontros: 'seu sócio-administrador',
  contratada_nome: 'CONTRATADA EXEMPLO LTDA',
  contratada_qualificacao: 'sociedade limitada de exemplo',
  contratada_pix: 'pix@exemplo.test',
  contratante_representante_cpf: '123.456.789-00',
};

const entrada = (over: Partial<EntradaDoPreenchimento> = {}): EntradaDoPreenchimento => ({
  tipo: 'contrato',
  modalidade: 'implantacao',
  faturaPor: '11.111.111/0001-11',
  dados: { campos: COMPLETOS },
  vigenciaFim: null,
  aceite: ACEITE,
  signatarios: [{ nome: 'Carla Dias', papel: 'cliente', ordem: 1 }, { nome: 'Titular', papel: 'root', ordem: 2 }],
  ...over,
});

describe('os campos do molde', () => {
  it('o aceite diz quem é a parte e o total; entrada e saldo não estão nele', () => {
    const c = camposDoAceite(ACEITE);
    expect(c).toMatchObject({ contratante_tipo: 'PJ', contratante_nome: 'Padaria Modelo Ltda', contratante_documento: '12.345.678/0001-90', contratante_representante: 'Carla Dias', valor_total: 12_000 });
    expect(c.valor_entrada).toBeUndefined();
    expect(camposDoAceite(null)).toEqual({});
    expect(camposDoAceite({ ...ACEITE, dados: { ...ACEITE.dados, cnpj: '12345678900' } })).toMatchObject({ contratante_tipo: 'PF' });
  });

  it('o aceite manda: escrever por cima do valor da proposta não vale. "[a decidir]" do fechado fora não é endereço', () => {
    const c = juntarCampos({ ...ACEITE, dados: { ...ACEITE.dados, endereco: '[a decidir]' } }, { valor_total: '1,00', contratante_endereco: 'Rua B', credito_continuidade: 'sim' });
    expect(c.valor_total).toBe(12_000);
    expect(c.contratante_endereco).toBe('Rua B');
    expect(c.credito_continuidade).toBe(true);
    expect(juntarCampos(null, { credito_continuidade: 'nao' }).credito_continuidade).toBe(false);
  });

  it('o que está no dadosDoContrato sem ser campo não entra', () => {
    expect(camposEscritos({ campos: { a: 'x', b: ['y', ''], c: 1, d: '  ' }, motivo: 'z' })).toEqual({ a: 'x', b: ['y'] });
    expect(camposEscritos(null)).toEqual({});
    expect(camposEscritos({ campos: ['x'] })).toEqual({});
  });

  it('o CNPJ que fatura vira o documento da contratada; texto livre fica como está', () => {
    expect(contratadaDoContrato('11111111000111', {}).documento).toBe('CNPJ 11.111.111/0001-11');
    expect(contratadaDoContrato('11.111.111/0001-11', {}).documento).toBe('CNPJ 11.111.111/0001-11');
    expect(contratadaDoContrato('MEI do sócio', {}).documento).toBe('MEI do sócio');
    expect(contratadaDoContrato(null, {}).documento).toBeNull();
    expect(rodapeDaContratada(null, {})).toContain('⟦lacuna: contratada_documento⟧');
  });

  it('a tela mostra de onde cada campo vem', () => {
    const campos = camposParaATela(entrada({ dados: {} }));
    const de = (n: string) => campos.find((c) => c.nome === n);
    expect(de('valor_total')).toMatchObject({ fonte: 'aceite', valor: 'R$ 12.000,00' });
    expect(de('entregas')).toMatchObject({ fonte: 'falta', tipo: 'lista', valor: null });
    expect(de('credito_continuidade')).toMatchObject({ tipo: 'opcional', fonte: 'falta' });
    expect(de('contratante_apelido')?.fonte).toBe('contrato');
    expect(de('contratante_qualificacao')).toBeUndefined();
    expect(de('contratada_documento')).toBeUndefined();
    expect(camposParaATela(entrada({ dados: { campos: { entregas: ['a'] } } })).find((c) => c.nome === 'entregas')).toMatchObject({ fonte: 'contrato', valor: ['a'] });
  });
});

describe('o preenchimento', () => {
  it('sem dado nenhum, tudo vira lacuna e nada é inventado', () => {
    const r = preencherRegistro(entrada({ aceite: null, dados: {}, faturaPor: null, signatarios: [] }));
    expect(r.base).toBe('molde');
    expect(r.lacunas).toEqual(expect.arrayContaining(['contratante_nome', 'valor_total', 'objeto_implantacao', 'contratada_nome']));
  });

  it('completo, não sobra lacuna, e as duas modalidades têm texto próprio', () => {
    const r = preencherRegistro(entrada());
    expect(r.lacunas).toEqual([]);
    expect(r.texto).toContain('R$ 12.000,00 (doze mil reais)');
    expect(r.texto).not.toContain('Se as partes celebrarem contrato de continuidade');
    expect(r.signatarios.map((s) => s.nome)).toEqual(['Carla Dias', 'Titular']);
    expect(preencherRegistro(entrada({ modalidade: 'continuidade', dados: {} })).texto).toContain('CONSULTORIA E ACOMPANHAMENTO');
  });

  it('o revisor não acusa o molde preenchido: nenhum apontamento grave, e o CPF de quem representa não é "documento divergente"', () => {
    const r = preencherRegistro(entrada());
    const a = regrasDoRevisor(r.texto, { razaoSocial: ACEITE.dados.razaoSocial, cnpj: ACEITE.dados.cnpj, valorCentavos: ACEITE.valorCentavos, parcelas: 3, parcelaCentavos: 400_000, ultimaParcelaCentavos: 400_000 });
    expect(apontamentosGraves(a)).toEqual([]);
    expect(r.texto).toContain('123.456.789-00');
  });

  it('grave é crítica ou alta; a lacuna já tem linha própria no que falta', () => {
    const g = apontamentosGraves([
      { gravidade: 'alta', regra: 'lacuna_aberta', titulo: 'a', trecho: null, detalhe: '', origem: 'regra' },
      { gravidade: 'critica', regra: 'valor_por_extenso', titulo: 'b', trecho: null, detalhe: '', origem: 'regra' },
      { gravidade: 'media', regra: 'valor_da_proposta', titulo: 'c', trecho: null, detalhe: '', origem: 'regra' },
    ]);
    expect(g.map((x) => x.titulo)).toEqual(['b']);
  });

  it('a minuta fica velha quando muda modalidade, CNPJ ou campo; a ordem das chaves não conta', () => {
    const a = assinaturaDaEntrada({ modalidade: 'implantacao', faturaPor: 'x', campos: { a: '1', b: '2' } });
    expect(assinaturaDaEntrada({ modalidade: 'implantacao', faturaPor: ' x ', campos: { b: '2', a: '1' } })).toBe(a);
    expect(assinaturaDaEntrada({ modalidade: 'continuidade', faturaPor: 'x', campos: { a: '1', b: '2' } })).not.toBe(a);
    expect(assinaturaDaEntrada({ modalidade: 'implantacao', faturaPor: 'y', campos: { a: '1', b: '2' } })).not.toBe(a);
    expect(assinaturaDaEntrada({ modalidade: 'implantacao', faturaPor: 'x', campos: { a: '9', b: '2' } })).not.toBe(a);
  });
});

describe('a IA não mexe no molde', () => {
  const base = 'Primeira frase longa do molde ⟦lacuna: foro⟧ e a segunda frase longa do molde.\nTerceira parte do texto.';
  it('trocar a marca é permitido; mudar, tirar ou inverter trecho, não', () => {
    expect(mantemAsClausulas(base, base)).toBe(true);
    expect(mantemAsClausulas(base.replace('⟦lacuna: foro⟧', '⟦inserido: Juiz de Fora⟧'), base)).toBe(true);
    expect(mantemAsClausulas(base.replace('segunda frase', 'outra frase'), base)).toBe(false);
    expect(mantemAsClausulas(base.replace('Terceira parte do texto.', ''), base)).toBe(false);
    expect(mantemAsClausulas('Terceira parte do texto. Primeira frase longa do molde e a segunda frase longa do molde.', base)).toBe(false);
  });
});

describe('aditivo e distrato', () => {
  const pai = { numero: 'R-1', modalidade: 'implantacao', assinadoEm: new Date('2026-10-05T12:00:00Z'), hash: 'a'.repeat(64) };

  it('a referência ao pai só diz o que está gravado', () => {
    expect(referenciaAoPai(pai)).toBe(`Contrato de Prestação de Serviços de implantação e acompanhamento, nº R-1, assinado em 05/10/2026, documento de código ${'a'.repeat(12)}`);
    expect(referenciaAoPai({ numero: null, modalidade: null, assinadoEm: null, hash: null })).toBe('Contrato de Prestação de Serviços');
  });

  it('o aditivo traz as partes, a referência, o que muda e a frase final, e cláusula nenhuma além disso', () => {
    const e = entrada({ tipo: 'aditivo', pai, camposDoPai: COMPLETOS, dados: { mudancas: 'Valor: R$ 13.000,00\nVigência até 30/06/2027', motivo: 'motivo interno do pedido' } });
    const r = preencherRegistro(e);
    expect(r.base).toBe('texto_simples');
    expect(r.lacunas).toEqual([]);
    expect(r.texto).toContain('CONTRATADA: **CONTRATADA EXEMPLO LTDA**');
    expect(r.texto).toContain('**Padaria Modelo Ltda**');
    expect(r.texto).toContain('nº R-1');
    expect(r.texto).toContain('(a) Valor: R$ 13.000,00;');
    expect(r.texto).toContain('(b) Vigência até 30/06/2027.');
    expect(r.texto).toContain('As demais cláusulas seguem válidas.');
    expect(r.texto).not.toContain('motivo interno');
    expect(moldeDoFilho('aditivo')).not.toMatch(/multa|foro|rescis/i);
  });

  it('aditivo sem o que muda e distrato sem data ficam com lacuna', () => {
    expect(preencherRegistro(entrada({ tipo: 'aditivo', pai, camposDoPai: COMPLETOS, dados: {} })).lacunas).toContain('mudancas');
    expect(preencherRegistro(entrada({ tipo: 'distrato', pai, camposDoPai: COMPLETOS, dados: {} })).lacunas).toContain('data_de_encerramento');
    const d = preencherRegistro(entrada({ tipo: 'distrato', pai, camposDoPai: COMPLETOS, dados: {}, vigenciaFim: new Date('2026-12-31T00:00:00Z') }));
    expect(d.lacunas).toEqual([]);
    expect(d.texto).toContain('última data de vigência em 31/12/2026');
  });
});

describe('a proposta como parte final', () => {
  const publicada = { versao: 2, hash: 'b'.repeat(64), formas: ['pix', 'boleto'], validaAte: '2026-11-30', ouvimos: ['O fechamento atrasa [[campo]]', 'Falta ⟦lacuna: x⟧ dado'], comoEDiferente: 'Fica no ambiente da empresa' };

  it('sai só do que a versão aceita diz, sem forjar marca', () => {
    const t = textoDaProposta(publicada, ACEITE)!;
    expect(t).toContain('Proposta versão 2');
    expect(t).toContain('R$ 12.000,00 em 3 parcela(s) de R$ 4.000,00');
    expect(t).toContain('Fica no ambiente da empresa');
    expect(t).not.toMatch(/⟦|\[\[/);
  });

  it('sem a publicada daquela versão, não há anexo', () => {
    expect(textoDaProposta(null, ACEITE)).toBeNull();
    expect(textoDaProposta({ ...publicada, versao: 1 }, ACEITE)).toBeNull();
  });
});

describe('o PDF do registro', () => {
  it('os mesmos insumos dão os mesmos bytes; mudar quem assina ou quem fatura muda o hash', () => {
    const e = entrada();
    const texto = preencherRegistro(e).texto;
    const um = gerarPdfDoContrato(pedidoDoPdf(texto, e, 'Proposta versão 2.'));
    const dois = gerarPdfDoContrato(pedidoDoPdf(texto, e, 'Proposta versão 2.'));
    expect(dois.hash).toBe(um.hash);
    expect(gerarPdfDoContrato(pedidoDoPdf(texto, entrada({ faturaPor: '22.222.222/0001-22' }), 'Proposta versão 2.')).hash).not.toBe(um.hash);
    expect(gerarPdfDoContrato(pedidoDoPdf(texto, entrada({ signatarios: [{ nome: 'Outra Pessoa', papel: 'cliente', ordem: 1 }, { nome: 'Titular', papel: 'root', ordem: 2 }] }), 'Proposta versão 2.')).hash).not.toBe(um.hash);
    expect(gerarPdfDoContrato(pedidoDoPdf(texto, e, null)).hash).not.toBe(um.hash);
  });

  it('o anexo e o rodapé estão no arquivo; dado da contratada faltando recusa', () => {
    const e = entrada();
    const g = gerarPdfDoContrato(pedidoDoPdf(preencherRegistro(e).texto, e, 'Proposta versão 2, conteúdo guardado.'));
    const lido = textoDoPdf(g.pdf);
    expect(lido).toContain('ANEXO: PROPOSTA ACEITA');
    expect(lido).toContain('Proposta versão 2, conteúdo guardado.');
    expect(lido).toContain('CONTRATADA EXEMPLO LTDA');
    const sem = entrada({ dados: { campos: { ...COMPLETOS, contratada_nome: '' } } });
    expect(() => gerarPdfDoContrato(pedidoDoPdf(preencherRegistro(entrada()).texto, sem, null))).toThrow(/contratada_nome/);
  });
});
