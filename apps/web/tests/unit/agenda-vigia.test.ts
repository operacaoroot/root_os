import { describe, expect, it } from 'vitest';
import type { ForaDoPadraoDaAgenda, ItemForaDoPadrao } from '@mktos/shared';

import { acaoDoItem, mensagemDoPedido, rotuloDaProposta, situacaoDoItem, textoDoSelo } from '@/app/agenda/fora-do-padrao';
import { foraDoPadraoNaTela, tomDoEvento, type EventoDaAgenda } from '@/app/agenda/tipos';

/*
 * O VIGIA DA AGENDA NA TELA (AG-01, rodada dos agentes, 21/10/2026).
 *
 * Três frases que esta suíte prende: o selo não diz zero quando não sabe; a
 * correção não sai no clique (vai à fila, e a tela diz quem confirma); e a tela
 * usa a MESMA régua do vigia para dizer o que está fora — compromisso que não é
 * reunião não fica âmbar.
 */

const item = (over: Partial<ItemForaDoPadrao> = {}): ItemForaDoPadrao => ({
  eventoId: 'ev1',
  tituloAtual: 'Call com a Andrade',
  inicio: '2026-10-23T13:00:00.000Z',
  estado: 'proposta',
  problemas: ['o título não segue nenhuma das duas formas da casa'],
  tituloProposto: 'Reunião Online - Andrade Peças - Pedro',
  adicionarMeet: false,
  origem: 'modelo',
  aprovacao: null,
  pendencia: null,
  atualizadoEm: '2026-10-22T17:00:00.000Z',
  ...over,
});

const dados = (itens: ItemForaDoPadrao[]): ForaDoPadraoDaAgenda => ({ itens, total: itens.length, ultimaPassagemEm: null, rotina: null });

describe('o selo "N fora do padrão"', () => {
  it('conta o que o vigia achou', () => {
    expect(textoDoSelo(dados([item(), item({ eventoId: 'ev2' })]))).toBe('2 fora do padrão');
    expect(textoDoSelo(dados([item()]))).toBe('1 fora do padrão');
  });

  it('não sabe → não desenha (nunca "0"); zero de verdade também não', () => {
    expect(textoDoSelo(null)).toBeNull();
    expect(textoDoSelo(undefined)).toBeNull();
    expect(textoDoSelo([] as unknown as ForaDoPadraoDaAgenda)).toBeNull();
    expect(textoDoSelo(dados([]))).toBeNull();
  });
});

describe('cada linha: o que diz e o que oferece', () => {
  it('a proposta mostra o Meet que a correção acrescenta', () => {
    expect(rotuloDaProposta(item({ adicionarMeet: true }))).toBe('Reunião Online - Andrade Peças - Pedro + Meet');
    expect(rotuloDaProposta(item({ tituloProposto: null }))).toBeNull();
  });

  it('proposta sem aprovação: "Aprovar aqui" para quem pode marcar reunião; nada para quem não pode', () => {
    expect(acaoDoItem(item(), true)).toEqual({ tipo: 'pedir', rotulo: 'Aprovar aqui' });
    expect(acaoDoItem(item(), false)).toMatchObject({ tipo: 'nenhuma' });
    expect(acaoDoItem(item({ aprovacao: { id: 'a1', status: 'expirada', expiraEm: '', propostaPor: 'vigia' } }), true)).toMatchObject({ tipo: 'pedir' });
  });

  it('aprovação viva na fila: o lugar de confirmar é a fila, não outro pedido', () => {
    const viva = item({ aprovacao: { id: 'a1', status: 'pendente', expiraEm: '', propostaPor: 'vigia' } });
    expect(acaoDoItem(viva, true)).toEqual({ tipo: 'fila', rotulo: 'Abrir na fila de aprovações', href: '/atendimento' });
    expect(situacaoDoItem(viva)).toMatch(/proposta pelo vigia: qualquer pessoa com alçada confirma/);
    const dePessoa = item({ aprovacao: { id: 'a2', status: 'pendente', expiraEm: '', propostaPor: 'pessoa' } });
    expect(situacaoDoItem(dePessoa)).toMatch(/OUTRA pessoa/);
  });

  it('pendência: responder aqui; vencida e recusada dizem o que houve', () => {
    expect(acaoDoItem(item({ estado: 'pendencia', tituloProposto: null, pendencia: { id: 'p1', opcoes: [] } }), true)).toEqual({ tipo: 'responder' });
    expect(situacaoDoItem(item({ estado: 'pendencia' }))).toBe('O vigia não teve proposta segura: qual é o cliente?');
    expect(situacaoDoItem(item({ aprovacao: { id: 'a', status: 'expirada', expiraEm: '', propostaPor: 'vigia' } }))).toMatch(/venceu/);
    expect(situacaoDoItem(item({ aprovacao: { id: 'a', status: 'rejeitada', expiraEm: '', propostaPor: 'vigia' } }))).toMatch(/recusada/);
  });

  it('depois do clique: a correção NÃO sai no clique, e a tela diz quem confirma', () => {
    expect(mensagemDoPedido({ status: 'aguardando_aprovacao', precisaDeOutraPessoa: true })).toMatch(/OUTRA pessoa.*Nada mudou na agenda/);
    expect(mensagemDoPedido({ status: 'aguardando_aprovacao', jaNaFila: true, precisaDeOutraPessoa: false })).toMatch(/vigia já pôs.*confirme lá/);
    expect(mensagemDoPedido({ ok: true } as never)).toBe('Corrigido na agenda.');
  });
});

describe('a tela usa a régua do vigia para dizer o que está fora', () => {
  const ev = (over: Partial<EventoDaAgenda>): EventoDaAgenda => ({
    id: 'x',
    title: 'Reunião Online - Andrade Peças - Pedro',
    reuniao: { tipo: 'cliente', modalidade: 'online', cliente: 'Andrade Peças', responsavel: 'Pedro' },
    start: '2026-10-23T13:00:00.000Z',
    end: null,
    diaInteiro: false,
    location: null,
    description: null,
    link: null,
    meet: 'https://meet.exemplo/x',
    status: 'confirmed',
    organizador: 'root@casa.teste',
    attendees: ['root@casa.teste', 'joao@andrade.teste'],
    ...over,
  });

  it('no padrão: a cor da natureza; online sem Meet: âmbar', () => {
    expect(foraDoPadraoNaTela(ev({}))).toBe(false);
    expect(tomDoEvento(ev({}))).toBe('brand');
    expect(tomDoEvento(ev({ meet: null }))).toBe('warn');
  });

  it('bloqueio pessoal e lembrete sem convidado: neutros, não "fora do padrão"', () => {
    const bloqueio = ev({ title: 'Bloqueio: almoço', reuniao: null, meet: null, attendees: [] });
    expect(foraDoPadraoNaTela(bloqueio)).toBe(false);
    expect(tomDoEvento(bloqueio)).toBe('muted');
  });

  it('reunião com título torto: âmbar', () => {
    const torta = ev({ title: 'Call com a Andrade', reuniao: null });
    expect(foraDoPadraoNaTela(torta)).toBe(true);
    expect(tomDoEvento(torta)).toBe('warn');
  });
});
