/**
 * O CONTRATO DO COCKPIT DO LEAD (Lane 0 da passagem, 13/10/2026) — a parte pura.
 *
 * Três coisas que não podem mudar sem alguém ver:
 *   1. o catálogo de eventos é fechado e todo tipo tem fonte e resumo;
 *   2. o id de um evento é DERIVADO: o mesmo fato cai no mesmo id;
 *   3. o portão recusa com a lista exata do que falta, não pula etapa e não
 *      volta — e a tabela de preço de 04/10 fecha as parcelas.
 *
 * Sem banco e sem Nest.
 */
import { describe, expect, it } from 'vitest';

import {
  COMERCIAL_ESTAGIOS,
  COMERCIAL_ETAPAS,
  COMERCIAL_EVENTOS,
  COMERCIAL_ROTULO_DA_ETAPA,
  LEAD_STATUS_DA_ETAPA,
  TABELA_DE_PRECO,
  TABELA_DE_PRECO_DATA,
  formatarReais,
  parcelasFecham,
  precoNaTabela,
  proximaEtapa,
  SalaFormSchema,
  ComercialConfigSchema,
} from '@mktos/shared';

import {
  FONTE_DO_EVENTO,
  canonico,
  diaRelativo,
  eventoIdComercial,
  leadIdDoTelefone,
  linhasDoFio,
  montarEvento,
  normalizarTelefone,
  reacaoId,
  resumoDoEvento,
} from '../src/comercial/eventos';
import {
  PORTOES_DA_ETAPA,
  avancar,
  avancarDepoisDaSessao,
  etapaDeVolta,
  faltaParaSair,
  podeSair,
  portoesDaEtapa,
  type EstadoParaPortao,
} from '../src/comercial/portoes';

const ORG = 'org-a';
const LEAD = 'lead-1';

describe('o contrato compartilhado', () => {
  it('as 9 etapas e as 4 saídas formam o enum, todas com rótulo e status derivado', () => {
    expect(COMERCIAL_ETAPAS).toHaveLength(9);
    expect(COMERCIAL_ESTAGIOS).toHaveLength(13);
    for (const e of COMERCIAL_ESTAGIOS) {
      expect(COMERCIAL_ROTULO_DA_ETAPA[e], e).toBeTruthy();
      expect(['novo', 'qualificado', 'oportunidade', 'reuniao', 'proposta', 'ganho', 'perdido'], e).toContain(LEAD_STATUS_DA_ETAPA[e]);
    }
    expect(LEAD_STATUS_DA_ETAPA.fechado).toBe('ganho');
    expect(LEAD_STATUS_DA_ETAPA.novo_lead).toBe('novo');
    expect(proximaEtapa('fechado')).toBeNull();
    expect(proximaEtapa('sessao')).toBe('diagnostico');
  });

  it('a tabela de 04/10: Imersão 10×297 e Operação 3×3.999 fecham o total; kit e turma ficam [a decidir]', () => {
    expect(TABELA_DE_PRECO_DATA).toBe('2026-10-04');
    const im = TABELA_DE_PRECO.imersao!;
    const op = TABELA_DE_PRECO.operacao!;
    expect(im.valorCentavos).toBe(297_000);
    expect(parcelasFecham(im.valorCentavos, im.parcelas, im.parcelaCentavos)).toBe(true);
    expect(im.formas).toEqual(['cartao']);
    expect(op.valorCentavos).toBe(1_199_700);
    expect(parcelasFecham(op.valorCentavos, op.parcelas, op.parcelaCentavos)).toBe(true);
    expect(op.formas).toEqual(['pix', 'boleto', 'cartao']);
    expect(TABELA_DE_PRECO.kit).toBeNull();
    expect(TABELA_DE_PRECO.turma).toBeNull();
    expect(precoNaTabela('operacao', 1_199_700)).toBe(true);
    expect(precoNaTabela('operacao', 1_103_700)).toBe(false);
    expect(precoNaTabela('kit', 1)).toBe(false);
    expect(parcelasFecham(1_199_700, 3, 399_800)).toBe(false);
    expect(formatarReais(1_199_700)).toBe('R$ 11.997,00');
    expect(formatarReais(29_700)).toBe('R$ 297,00');
  });

  it('os schemas públicos são fechados (strict): campo estranho é recusado', () => {
    expect(SalaFormSchema.safeParse({ sistema: 'Omie', baseOrganizada: true, maiorDor: 'fechamento em 9 dias', equipeFinanceiro: 3 }).success).toBe(true);
    expect(SalaFormSchema.safeParse({ sistema: 'Omie', baseOrganizada: true, maiorDor: 'x', equipeFinanceiro: 3, extra: 1 }).success).toBe(false);
    expect(ComercialConfigSchema.safeParse({ envioAutomatico: true, janelaDeVetoMinutos: 30 }).success).toBe(true);
    expect(ComercialConfigSchema.safeParse({ autonomia: { qualificador: 'A9' } }).success).toBe(false);
  });
});

describe('o fio do lead: eventos com id derivado', () => {
  it('todo tipo do catálogo tem fonte e resumo que não é o próprio tipo', () => {
    for (const t of COMERCIAL_EVENTOS) {
      expect(FONTE_DO_EVENTO[t], t).toBeTruthy();
      const { fonte, resumo } = resumoDoEvento(t, {});
      expect(fonte).toBe(FONTE_DO_EVENTO[t]);
      expect(resumo, t).not.toBe(t);
      expect(resumo.length, t).toBeGreaterThan(3);
    }
  });

  it('o mesmo fato cai no mesmo id; outra chave, outro id; outra empresa, outro id', () => {
    const a = eventoIdComercial(ORG, LEAD, 'whats.recebida', 'msg-1');
    expect(a).toBe(eventoIdComercial(ORG, LEAD, 'whats.recebida', 'msg-1'));
    expect(a).not.toBe(eventoIdComercial(ORG, LEAD, 'whats.recebida', 'msg-2'));
    expect(a).not.toBe(eventoIdComercial('org-b', LEAD, 'whats.recebida', 'msg-1'));
    expect(a).not.toBe(eventoIdComercial(ORG, LEAD, 'whats.enviada', 'msg-1'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(reacaoId('ev', 'abrir-sala')).toBe(reacaoId('ev', 'abrir-sala'));
    expect(reacaoId('ev', 'abrir-sala')).not.toBe(reacaoId('ev', 'pontuar'));
  });

  it('o telefone é normalizado antes de virar identidade do lead', () => {
    expect(normalizarTelefone('(32) 99999-0000')).toBe('5532999990000');
    expect(normalizarTelefone('+55 32 99999-0000')).toBe('5532999990000');
    expect(leadIdDoTelefone(ORG, '(32) 99999-0000')).toBe(leadIdDoTelefone(ORG, '5532999990000'));
    expect(leadIdDoTelefone(ORG, '5532999990000')).not.toBe(leadIdDoTelefone(ORG, '5532999990001'));
  });

  it('o JSON canônico ignora a ordem das chaves e o undefined', () => {
    expect(canonico({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe(canonico({ a: [2, { c: 3 }], b: 1 }));
  });

  it('montarEvento devolve o evento pronto para gravar, com o payload tipado', () => {
    const ev = montarEvento(ORG, LEAD, 'proposta.publicada', 'v1', {
      versao: 1, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, parcelaCentavos: 399_900, formas: ['pix'],
      validaAte: null, dentroDaTabela: true, laudo: { ok: true, apontamentos: [] }, hash: 'h',
    });
    expect(ev.id).toBe(eventoIdComercial(ORG, LEAD, 'proposta.publicada', 'v1'));
    expect(resumoDoEvento(ev.type, ev.payload).resumo).toContain('v1 publicada na sala (dentro da tabela) · R$ 11.997,00');
  });

  it('o fio sai em ordem, com o dia relativo à entrada e a fonte de cada linha', () => {
    const entrada = new Date('2026-10-13T12:12:00Z');
    const linhas = linhasDoFio(
      [
        { id: 'b', type: 'form.respondido', payload: { sistema: 'Omie', baseOrganizada: true, maiorDor: 'x', equipeFinanceiro: 3 }, occurredAt: new Date('2026-10-13T12:31:00Z') },
        { id: 'a', type: 'lead.chegou', payload: { telefone: '55', texto: 'Vi o vídeo', palavraChave: 'FECHAMENTO' }, occurredAt: entrada },
        { id: 'c', type: 'entrada', payload: {}, occurredAt: new Date('2026-10-16T13:00:00Z') },
      ],
      entrada,
    );
    expect(linhas.map((l) => l.eventoId)).toEqual(['a', 'b', 'c']);
    expect(linhas[0]).toMatchObject({ dia: 1, fonte: 'whats' });
    expect(linhas[0].resumo).toContain('palavra-chave FECHAMENTO');
    expect(linhas[1]).toMatchObject({ dia: 1, fonte: 'form' });
    expect(linhas[2]).toMatchObject({ dia: 4, fonte: 'sistema', resumo: 'entrada registrada' });
    expect(diaRelativo(entrada, new Date('2026-10-13T23:59:00Z'))).toBe(1);
  });
});

describe('os portões (C04/C07)', () => {
  const base: EstadoParaPortao = { etapa: 'novo_lead' };

  it('E1 recusa com a lista exata do que falta, escrita para a tela', () => {
    expect(faltaParaSair(base)).toEqual([
      'nome do contato',
      'WhatsApp do contato',
      'canal de entrada',
      'perfil P1, P2 ou P3 pontuado',
      'dono do lead',
    ]);
    const quase: EstadoParaPortao = { ...base, nome: 'Marina', telefone: '55', canal: 'indicacao', perfil: 'P2', donoId: 'u1' };
    expect(faltaParaSair(quase)).toEqual(['origem da indicação (canal = indicação)']);
    expect(avancar({ ...quase, origemIndicacao: 'Douglas' })).toMatchObject({ ok: true, de: 'novo_lead', para: 'qualificacao', faltando: [] });
  });

  it('não pula etapa, não volta e saída não avança', () => {
    const pronto: EstadoParaPortao = { etapa: 'novo_lead', nome: 'M', telefone: '55', canal: 'site', perfil: 'P2', donoId: 'u' };
    const pulo = avancar(pronto, 'sessao');
    expect(pulo.ok).toBe(false);
    expect(pulo.faltando[0]).toMatch(/não se pula etapa/);
    expect(pulo.faltando[0]).toContain('E2 · Qualificação');
    const volta = avancar({ etapa: 'proposta' }, 'sessao');
    expect(volta.ok).toBe(false);
    expect(volta.faltando[0]).toMatch(/não é avanço/);
    const saida = avancar({ etapa: 'geladeira' });
    expect(saida.ok).toBe(false);
    expect(saida.faltando[0]).toMatch(/lead em saída/);
    expect(avancar({ etapa: 'fechado' })).toMatchObject({ ok: false, para: null, faltando: ['negócio fechado é etapa final'] });
  });

  it('cada etapa ativa tem os portões da C07, e a tela os lê um a um', () => {
    expect(PORTOES_DA_ETAPA.qualificacao.map((p) => p.chave)).toEqual(['perfil_confirmado', 'sistema', 'base', 'produto_alvo']);
    expect(PORTOES_DA_ETAPA.proposta.map((p) => p.chave)).toEqual(['produto', 'valor', 'parcelas', 'quadro_de_custos', 'validade', 'laudo']);
    expect(PORTOES_DA_ETAPA.contrato.map((p) => p.chave)).toEqual(['cnpj', 'endereco', 'quem_assina', 'assinado_cliente', 'assinado_root', 'cobranca']);
    const na = portoesDaEtapa({ etapa: 'qualificacao', perfil: 'P2', sistemaErp: 'Omie', baseDados: false });
    expect(na.map((p) => [p.chave, p.cumprido])).toEqual([
      ['perfil_confirmado', true],
      ['sistema', true],
      ['base', true],
      ['produto_alvo', false],
    ]);
    expect(portoesDaEtapa({ etapa: 'perdido' })).toEqual([]);
  });

  it('a rota depois da sessão: diagnóstico por padrão, proposta direta pula o diagnóstico de propósito', () => {
    const semRota = avancarDepoisDaSessao({ etapa: 'sessao', ataHash: 'h', socioDaConta: 'rodrigo' });
    expect(semRota.ok).toBe(false);
    expect(semRota.faltando).toEqual(['rota definida (diagnóstico ou proposta direta)']);
    expect(avancarDepoisDaSessao({ etapa: 'sessao', ataHash: 'h', rota: 'diagnostico', socioDaConta: 'r' })).toMatchObject({ ok: true, para: 'diagnostico' });
    expect(avancarDepoisDaSessao({ etapa: 'sessao', ataHash: 'h', rota: 'proposta_direta', socioDaConta: 'r' })).toMatchObject({ ok: true, para: 'proposta' });
    // fora da sessão, é o avanço comum
    expect(avancarDepoisDaSessao({ etapa: 'diagnostico', diagnosticoAprovadoEm: 'x' })).toMatchObject({ ok: true, para: 'proposta' });
  });

  it('a proposta só sai com preço, parcelas, quadro de custos, validade e laudo limpo', () => {
    const p: EstadoParaPortao = { etapa: 'proposta', produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, quadroDeCustos: true, validade: '2026-10-24', laudoDoRevisorOk: false };
    expect(faltaParaSair(p)).toEqual(['laudo do revisor limpo']);
    expect(avancar({ ...p, laudoDoRevisorOk: true })).toMatchObject({ ok: true, para: 'follow_up' });
  });

  it('saída: de etapa ativa sempre; de fechado nunca; da geladeira pode mudar; a volta é para a etapa de antes', () => {
    expect(podeSair('proposta', 'geladeira')).toEqual({ ok: true, motivo: null });
    expect(podeSair('fechado', 'perdido').ok).toBe(false);
    expect(podeSair('perdido', 'geladeira').ok).toBe(false);
    expect(podeSair('geladeira', 'perdido').ok).toBe(true);
    expect(podeSair('proposta', 'sessao' as never).ok).toBe(false);
    expect(etapaDeVolta('proposta')).toBe('proposta');
    expect(etapaDeVolta(null)).toBe('qualificacao');
    expect(etapaDeVolta('perdido')).toBe('qualificacao');
  });
});
