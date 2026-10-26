import { describe, expect, it } from 'vitest';
import type { MensagemDaCaixa } from '@mktos/shared';

import {
  CHIPS_DA_CAIXA,
  duracaoLegivel,
  enderecoDaCaixa,
  estadoDoEndereco,
  horaDaLista,
  horaDoBalao,
  juntarMensagens,
  previaDaLista,
  razaoParaNaoResponder,
  rotaDaConversa,
  rotaDaLista,
  rotuloDoDia,
  tamanhoLegivel,
  textoEnviavel,
} from '@/lib/caixa-whatsapp';

/* As regras puras da caixa de WhatsApp (produção 22C, W2). Tudo fictício. */

const AGORA = new Date('2026-10-22T15:00:00.000Z'); // 12:00 em São Paulo

describe('caixa de WhatsApp: hora em São Paulo', () => {
  it('hoje é HH:mm, ontem é "ontem", antes é dd/mm, sempre no fuso de São Paulo', () => {
    expect(horaDaLista('2026-10-22T13:05:00.000Z', AGORA)).toBe('10:05');
    // 01:30 UTC do dia 22 ainda é dia 21 em São Paulo (22:30).
    expect(horaDaLista('2026-10-22T01:30:00.000Z', AGORA)).toBe('ontem');
    expect(horaDaLista('2026-10-19T12:00:00.000Z', AGORA)).toBe('19/10');
    expect(horaDaLista(null, AGORA)).toBe('');
    expect(horaDaLista('torto', AGORA)).toBe('');
    expect(horaDoBalao('2026-10-22T02:59:00.000Z')).toBe('23:59');
  });

  it('o separador de dia diz Hoje, Ontem ou a data', () => {
    expect(rotuloDoDia('2026-10-22', AGORA)).toBe('Hoje');
    expect(rotuloDoDia('2026-10-21', AGORA)).toBe('Ontem');
    expect(rotuloDoDia('2026-09-03', AGORA)).toBe('03/09/2026');
  });
});

describe('caixa de WhatsApp: prévia da lista', () => {
  const base = { texto: 'Bom dia, tudo certo?', tipo: 'conversation', deMim: false, remetenteNome: 'Pessoa Ficticia', timestamp: AGORA.toISOString() };
  it('texto, "Você: " quando é da casa, o nome de quem escreveu no grupo', () => {
    expect(previaDaLista(base, false)).toBe('Bom dia, tudo certo?');
    expect(previaDaLista(base, true)).toBe('Pessoa Ficticia: Bom dia, tudo certo?');
    expect(previaDaLista({ ...base, deMim: true }, true)).toBe('Você: Bom dia, tudo certo?');
    expect(previaDaLista({ ...base, texto: 'linha 1\nlinha 2' }, false)).toBe('linha 1 linha 2');
  });

  it('mídia sem texto vira "📎 <tipo>"; outro tipo sem texto, o rótulo; sem mensagem, a frase', () => {
    expect(previaDaLista({ ...base, texto: null, tipo: 'image' }, false)).toBe('📎 imagem');
    expect(previaDaLista({ ...base, texto: null, tipo: 'audio', deMim: true }, false)).toBe('Você: 📎 áudio');
    expect(previaDaLista({ ...base, texto: null, tipo: 'document' }, true)).toBe('Pessoa Ficticia: 📎 documento');
    expect(previaDaLista({ ...base, texto: null, tipo: 'protocolo' }, false)).toBe('aviso do WhatsApp');
    expect(previaDaLista({ ...base, texto: 'legenda da foto', tipo: 'image' }, false)).toBe('legenda da foto');
    expect(previaDaLista(null, false)).toBe('Sem mensagens ainda');
  });

  it('tamanho e duração legíveis', () => {
    expect(tamanhoLegivel(512)).toBe('512 B');
    expect(tamanhoLegivel(2048)).toBe('2 KB');
    expect(tamanhoLegivel(1_572_864)).toBe('1,5 MB');
    expect(tamanhoLegivel(null)).toBe('');
    expect(duracaoLegivel(42)).toBe('0:42');
    expect(duracaoLegivel(725)).toBe('12:05');
  });
});

describe('caixa de WhatsApp: o endereço e as rotas', () => {
  it('lê filtro, busca e conversa do endereço; filtro desconhecido vira Todas; id torto é ignorado', () => {
    expect(estadoDoEndereco('?filtro=leads&conversa=abc-123&q=loja')).toEqual({ filtro: 'leads', q: 'loja', conversa: 'abc-123' });
    expect(estadoDoEndereco('?filtro=inventado')).toEqual({ filtro: 'todas', q: '', conversa: null });
    expect(estadoDoEndereco('?conversa=../x')).toMatchObject({ conversa: null });
  });

  it('monta o endereço que o Dia a dia usa e as rotas da API', () => {
    expect(enderecoDaCaixa()).toBe('/whatsapp');
    expect(enderecoDaCaixa({ filtro: 'leads' })).toBe('/whatsapp?filtro=leads');
    expect(enderecoDaCaixa({ filtro: 'sem_vinculo' })).toBe('/whatsapp?filtro=sem_vinculo');
    expect(enderecoDaCaixa({ filtro: 'todas', q: ' loja ', conversa: 'c1' })).toBe('/whatsapp?q=loja&conversa=c1');
    expect(rotaDaLista({ filtro: 'todas', q: '' })).toBe('/whatsapp/conversas');
    expect(rotaDaLista({ filtro: 'grupos', q: 'a b' }, 100)).toBe('/whatsapp/conversas?filtro=grupos&q=a+b&limite=100');
    expect(rotaDaConversa('c1')).toBe('/whatsapp/conversas/c1?limite=50');
    expect(rotaDaConversa('c1', { timestamp: '2026-10-22T10:00:00.000Z', id: 'm1' })).toBe(
      '/whatsapp/conversas/c1?antesDe=2026-10-22T10%3A00%3A00.000Z&antesDeId=m1&limite=50',
    );
  });

  it('os chips na ordem da tela, com Arquivadas no fim', () => {
    expect([...CHIPS_DA_CAIXA]).toEqual(['todas', 'leads', 'clientes', 'grupos', 'sem_vinculo', 'equipe', 'comunidade', 'arquivadas']);
  });
});

describe('caixa de WhatsApp: a resposta', () => {
  it('a razão de não responder: sem permissão, arquivada; senão, null', () => {
    expect(razaoParaNaoResponder({ arquivada: false }, false)).toMatch(/permissão/);
    expect(razaoParaNaoResponder({ arquivada: true }, true)).toMatch(/arquivada/);
    expect(razaoParaNaoResponder({ arquivada: false }, true)).toBeNull();
  });

  it('o texto enviável: nem vazio nem acima de 4000', () => {
    expect(textoEnviavel('  ')).toBe(false);
    expect(textoEnviavel('oi')).toBe(true);
    expect(textoEnviavel('x'.repeat(4000))).toBe(true);
    expect(textoEnviavel('x'.repeat(4001))).toBe(false);
  });

  it('juntar as páginas não repete e mantém a ordem', () => {
    const m = (id: string, ts: string) => ({ id, timestamp: ts }) as MensagemDaCaixa;
    const a = [m('b', '2026-10-22T10:00:00.000Z'), m('c', '2026-10-22T10:01:00.000Z')];
    const b = [m('a', '2026-10-22T09:00:00.000Z'), m('b', '2026-10-22T10:00:00.000Z'), m('a2', '2026-10-22T10:00:00.000Z')];
    expect(juntarMensagens(a, b).map((x) => x.id)).toEqual(['a', 'a2', 'b', 'c']);
  });
});
