/*
 * O estado do painel do lead na URL e as datas curtas do comercial (lane UX).
 */
import { describe, expect, it } from 'vitest';

import { ABAS_DO_PAINEL, abaDaUrl, abasNaTela, destinoDaRotaAntiga, lerPainel, linkDoWhatsApp, urlComPainel, urlSemPainel } from '@/app/comercial/_painel/estado';
import { chavesLegiveis, comNivelExplicado, prazoEmPalavras, quandoCurtoSP } from '@/lib/cockpit';

describe('estado do painel na query', () => {
  it('lê lead e aba; aba desconhecida (e o Fio de antes) vira a Geral; sem lead ou com id torto, fechado', () => {
    // Leva 5 (L4): a Geral é a primeira tela; Dinheiro e Sessão ainda abrem por link direto.
    expect(lerPainel('?lead=abc-123&aba=dinheiro')).toEqual({ leadId: 'abc-123', aba: 'dinheiro' });
    expect(lerPainel('?lead=abc&aba=qualquer')).toEqual({ leadId: 'abc', aba: 'geral' });
    expect(lerPainel('?lead=abc&aba=fio')).toEqual({ leadId: 'abc', aba: 'geral' });
    expect(lerPainel('?lead=abc')).toEqual({ leadId: 'abc', aba: 'geral' });
    expect(lerPainel('?lead=abc&aba=pendencias')).toEqual({ leadId: 'abc', aba: 'pendencias' });
    expect(lerPainel('?aba=fio')).toBeNull();
    expect(lerPainel('?lead=../../x')).toBeNull();
    expect(lerPainel(`?lead=${'a'.repeat(65)}`)).toBeNull();
  });

  it('o campo a focar viaja na query, só com chave limpa; trocar de aba o apaga', () => {
    expect(lerPainel('?lead=abc&aba=geral&campo=telefone')).toEqual({ leadId: 'abc', aba: 'geral', campo: 'telefone' });
    expect(lerPainel('?lead=abc&aba=geral&campo=<x>')).toEqual({ leadId: 'abc', aba: 'geral' });
    expect(urlComPainel('/comercial/funil', '', 'l1', 'geral', 'valorNegociado')).toBe('/comercial/funil?lead=l1&aba=geral&campo=valorNegociado');
    expect(urlComPainel('/comercial/funil', '?lead=l1&aba=geral&campo=telefone', 'l1', 'sala')).toBe('/comercial/funil?lead=l1&aba=sala');
    expect(urlSemPainel('/comercial/funil', '?lead=l1&aba=geral&campo=telefone')).toBe('/comercial/funil');
  });

  it('a fila de abas: as quatro da leva 5 mais a Área do cliente (leva A, 30/10/2026), e a antiga aberta por link (desfazer = devolver os nomes a ABAS_DO_PAINEL)', () => {
    expect([...ABAS_DO_PAINEL]).toEqual(['geral', 'pendencias', 'sala', 'area', 'whatsapp']);
    expect(abasNaTela('sala')).toEqual(['geral', 'pendencias', 'sala', 'area', 'whatsapp']);
    expect(abasNaTela('area')).toEqual(['geral', 'pendencias', 'sala', 'area', 'whatsapp']);
    expect(abasNaTela('dinheiro')).toEqual(['geral', 'pendencias', 'sala', 'area', 'whatsapp', 'dinheiro']);
    expect(abaDaUrl('fio')).toBe('geral');
    expect(abaDaUrl('sessao')).toBe('sessao');
    expect(abaDaUrl(null)).toBe('geral');
  });

  it('abrir e fechar preservam o resto da query (o filtro da tela de trás)', () => {
    expect(urlComPainel('/comercial/funil', '?filtro=parados', 'l1', 'sessao')).toBe('/comercial/funil?filtro=parados&lead=l1&aba=sessao');
    expect(urlComPainel('/comercial', '?lead=l0&aba=fio', 'l1', 'decisoes')).toBe('/comercial?lead=l1&aba=decisoes');
    expect(urlSemPainel('/comercial/funil', '?filtro=parados&lead=l1&aba=sessao')).toBe('/comercial/funil?filtro=parados');
    expect(urlSemPainel('/comercial', '?lead=l1&aba=fio')).toBe('/comercial');
  });

  it('as rotas antigas vão para a tela de fundo com o painel na aba certa', () => {
    expect(destinoDaRotaAntiga('fio', 'l1')).toBe('/comercial/funil?lead=l1&aba=geral');
    expect(destinoDaRotaAntiga('sessao', 'l1')).toBe('/comercial/funil?lead=l1&aba=sessao');
    expect(destinoDaRotaAntiga('fechamento', 'l1')).toBe('/comercial/funil?lead=l1&aba=dinheiro');
    expect(destinoDaRotaAntiga('contrato', 'l1')).toBe('/comercial/contratos?lead=l1&aba=dinheiro');
  });

  it('o WhatsApp sai do telefone; sem dígitos suficientes, nada', () => {
    expect(linkDoWhatsApp('(32) 99999-0001')).toBe('https://wa.me/5532999990001');
    expect(linkDoWhatsApp('+55 32 99999-0001')).toBe('https://wa.me/5532999990001');
    expect(linkDoWhatsApp('123')).toBeNull();
    expect(linkDoWhatsApp(null)).toBeNull();
  });
});

describe('datas e prazos do comercial (§4.2)', () => {
  it('data e hora como "qui 15/10 · 10h", em São Paulo', () => {
    expect(quandoCurtoSP('2026-10-15T13:00:00.000Z')).toBe('qui 15/10 · 10h');
    expect(quandoCurtoSP('2026-10-15T13:30:00.000Z')).toBe('qui 15/10 · 10h30');
    expect(quandoCurtoSP(null)).toBe('');
  });

  it('prazos em palavras, e a sentinela de "sem prazo" nunca vira milhões de dias', () => {
    const agora = new Date('2026-10-13T12:00:00.000Z'); // 09h em São Paulo
    expect(prazoEmPalavras('2026-10-13T16:00:00.000Z', agora)).toBe('em 4 h');
    expect(prazoEmPalavras('2026-10-13T21:00:00.000Z', agora)).toBe('vence hoje 18h');
    expect(prazoEmPalavras('2026-10-14T12:00:00.000Z', agora)).toBe('vence amanhã 9h');
    expect(prazoEmPalavras('2026-10-16T13:00:00.000Z', agora)).toBe('vence sex 16/10 · 10h');
    expect(prazoEmPalavras('2026-10-13T10:00:00.000Z', agora)).toBe('venceu há 2 h');
    expect(prazoEmPalavras('9999-12-31T23:59:59.000Z', agora)).toBe('sem prazo');
  });
});

describe('o nível da régua com o que ele pede (§4.5)', () => {
  it('R3 e R4 vindos da API ganham a explicação, uma vez só', () => {
    expect(comNivelExplicado('nova versão da proposta com este desconto, à liberação (R3)')).toBe('nova versão da proposta com este desconto, à liberação (R3: pede uma segunda pessoa)');
    expect(comNivelExplicado('a cobrança vai à porta, R4')).toBe('a cobrança vai à porta, R4 (pede a titular, com senha)');
    expect(comNivelExplicado(comNivelExplicado('à liberação (R3)'))).toBe('à liberação (R3: pede uma segunda pessoa)');
    expect(comNivelExplicado('nada muda')).toBe('nada muda');
  });
});

describe('chave de sistema vira o nome da casa no fio (§4.5)', () => {
  it('etapa, tipo de decisão e o resto em snake_case', () => {
    expect(chavesLegiveis('follow_up → contrato · proposta aceita')).toBe('Follow-up → Contrato · proposta aceita');
    expect(chavesLegiveis('decisão aberta: pedido_de_ajuste')).toBe('decisão aberta: pedido de ajuste');
    expect(chavesLegiveis('fechamento · kit_e_trilho: criado')).toBe('fechamento · kit e trilho: criado');
    expect(chavesLegiveis('novo_lead → qualificacao')).toBe('Novo lead → Qualificação');
    expect(chavesLegiveis('proposta → follow_up · proposta lida')).toBe('Proposta → Follow-up · proposta lida');
    expect(chavesLegiveis('link https://x.com/a_b_c fica')).toBe('link https://x.com/a_b_c fica');
  });
});
