/*
 * Lane P6: as contas da tela de atendimento do WhatsApp (busca, filtros,
 * prévia, corte da mensagem comprida e a marca local de "nova").
 */
import { describe, expect, it } from 'vitest';

import {
  completarVisto,
  etapasPresentes,
  filtrarConversas,
  horaDaLista,
  normalizarBusca,
  previaDaMensagem,
  rotuloDaEtapa,
  temNovidade,
  textoRecolhido,
  vistoInicial,
  type LeadDaLista,
} from '@/lib/atendimento-whats';

const L = (x: Partial<LeadDaLista> & { leadId: string }): LeadDaLista => ({ nome: x.leadId, telefone: null, etapa: null, ultimaEm: null, naFila: 0, ...x });

const LEADS: LeadDaLista[] = [
  L({ leadId: 'a', nome: 'João da Padaria', telefone: '5532999990001', etapa: 'novo_lead', ultimaEm: '2026-10-18T10:00:00Z', naFila: 2 }),
  L({ leadId: 'b', nome: 'Ana Contábil', telefone: '5532988880002', etapa: 'proposta', ultimaEm: '2026-10-18T12:00:00Z' }),
  L({ leadId: 'c', nome: 'Sem hora', etapa: 'novo_lead' }),
];

describe('filtrarConversas', () => {
  it('a conversa mais recente sobe; sem hora vai para o fim', () => {
    expect(filtrarConversas(LEADS, {}).map((l) => l.leadId)).toEqual(['b', 'a', 'c']);
  });

  it('busca sem acento casa o nome; dígitos casam o telefone', () => {
    expect(filtrarConversas(LEADS, { busca: 'joao' }).map((l) => l.leadId)).toEqual(['a']);
    expect(filtrarConversas(LEADS, { busca: '(32) 98888' }).map((l) => l.leadId)).toEqual(['b']);
    expect(filtrarConversas(LEADS, { busca: 'ninguém' })).toEqual([]);
  });

  it('filtra por etapa e por estado da fila', () => {
    expect(filtrarConversas(LEADS, { etapa: 'novo_lead' }).map((l) => l.leadId)).toEqual(['a', 'c']);
    expect(filtrarConversas(LEADS, { estado: 'na_fila' }).map((l) => l.leadId)).toEqual(['a']);
    expect(filtrarConversas(LEADS, { estado: 'sem_fila' }).map((l) => l.leadId)).toEqual(['b', 'c']);
  });

  it('as etapas do seletor vêm na ordem do funil, sem repetir', () => {
    expect(etapasPresentes(LEADS)).toEqual(['novo_lead', 'proposta']);
    expect(rotuloDaEtapa('proposta')).toBe('E6 · Proposta');
    expect(rotuloDaEtapa(null)).toBe('sem etapa');
  });

  it('normalizarBusca tira acento e caixa', () => {
    expect(normalizarBusca('  ÁRVORE Ção ')).toBe('arvore cao');
  });
});

describe('prévia e mensagem comprida', () => {
  it('a prévia é uma linha, cortada com reticências, e diz quando é a casa que fala', () => {
    const longa = `linha um\n\nlinha dois ${'x'.repeat(300)}`;
    const p = previaDaMensagem({ direcao: 'saida', texto: longa });
    expect(p.startsWith('casa: linha um linha dois')).toBe(true);
    expect(p.endsWith('…')).toBe(true);
    expect(p).not.toContain('\n');
    expect(previaDaMensagem({ direcao: 'entrada', texto: 'oi' })).toBe('oi');
    expect(previaDaMensagem(null)).toBe('');
  });

  it('mensagem de 2.000 caracteres aparece cortada; curta, inteira', () => {
    const r = textoRecolhido('a'.repeat(2000));
    expect(r.cortado).toBe(true);
    expect(r.texto.length).toBeLessThan(800);
    expect(textoRecolhido('curta')).toEqual({ texto: 'curta', cortado: false });
  });
});

describe('a marca de nova', () => {
  it('na primeira visita nada é novo; o que mexe depois de visto é', () => {
    const v = vistoInicial(LEADS);
    expect(LEADS.some((l) => temNovidade(l, v))).toBe(false);
    expect(temNovidade({ leadId: 'a', ultimaEm: '2026-10-18T10:05:00Z' }, v)).toBe(true);
    expect(temNovidade({ leadId: 'a', ultimaEm: '2026-10-18T10:00:00Z' }, null)).toBe(false);
  });

  it('quem entra na lista depois começa como visto, sem trocar o objeto quando nada muda', () => {
    const v = vistoInicial(LEADS);
    expect(completarVisto(v, LEADS)).toBe(v);
    const novo = completarVisto(v, [...LEADS, L({ leadId: 'd', ultimaEm: '2026-10-18T13:00:00Z' })]);
    expect(novo.d).toBe('2026-10-18T13:00:00Z');
  });

  it('a hora da lista é HH:MM hoje e DD/MM nos outros dias, em São Paulo', () => {
    const agora = new Date('2026-10-18T20:00:00Z');
    expect(horaDaLista('2026-10-18T13:05:00Z', agora)).toBe('10:05');
    expect(horaDaLista('2026-10-15T13:05:00Z', agora)).toBe('15/10');
    expect(horaDaLista(null, agora)).toBe('');
  });
});
