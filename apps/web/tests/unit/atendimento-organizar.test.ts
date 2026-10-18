import { describe, expect, it } from 'vitest';
import { fraseDoPedido, trecho } from '@/app/atendimento/frase-do-pedido';
import {
  condicoesDeAssinatura,
  filtroDaQuery,
  grupoDoItem,
  motivoDaEspera,
  nivelEmPalavras,
  organizarFila,
  passoDoItem,
  quemPodeAssinar,
  tipoDoPedido,
} from '@/app/atendimento/organizar-fila';
import type { Fila, ItemDaFila } from '@/app/atendimento/tipos';

/*
 * A FILA LEGÍVEL (rodada do painel P4, 18/10/2026): só forma.
 *
 * Duas funções puras sustentam a tela nova. A frase do pedido ("Enviar
 * WhatsApp para Marina Duarte") sai só do que a listagem já traz, com o caso
 * honesto "Executar <capacidade>" para o que a tabela não conhece. O
 * agrupamento lê os campos que o servidor calculou; nenhuma regra nova, e a
 * prova disso é que "depende de você" com botão de assinar exige exatamente o
 * `euPossoAprovar` do servidor.
 */

const EU: Fila['eu'] = { id: 'u-eu', alcada: 'responsavel', decide: true, decideNestaSessao: true, veConteudo: true };

function item(over: Partial<ItemDaFila> = {}): ItemDaFila {
  return {
    id: 'ap',
    gaveta: 'esperando',
    status: 'pendente',
    nivel: 'R3',
    nivelBase: 'R3',
    resumo: 'x',
    capacidade: 'whatsapp.mensagem.enviar',
    canal: 'whatsapp',
    recurso: { tipo: 'whatsapp.mensagem.enviar', id: 'r' },
    alvo: null,
    agente: null,
    correlationId: null,
    conteudo: {},
    conteudoOculto: false,
    hashDoConteudo: 'h',
    impedimento: null,
    gatilhos: [],
    motivoDaRegua: null,
    exigeReauth: false,
    exigeMotivo: false,
    alcadaMinima: 'responsavel',
    proponente: { id: 'agente', tipo: 'ai', nome: 'curador' },
    propostaEm: '2026-10-18T12:00:00.000Z',
    expiraEm: '2026-10-18T12:15:00.000Z',
    esperandoMs: 60_000,
    decididoPor: null,
    decididoEm: null,
    motivo: null,
    aprovadores: [{ id: 'u-eu', nome: 'Rodrigo', email: 'r@x', alcada: 'responsavel' }],
    euPossoAprovar: true,
    porQueNao: null,
    ...over,
  };
}

/* ------------------------------------------------------- a frase do pedido */

describe('a frase do pedido: verbo + objeto em português', () => {
  const casos: Array<[string, Partial<ItemDaFila>, string]> = [
    ['WhatsApp do comercial para o lead', { capacidade: 'comercial.whatsapp.enviar', conteudo: { leadId: 'l1', destino: 'lead', texto: 'Oi' }, alvo: 'Marina Duarte' }, 'Enviar WhatsApp para Marina Duarte'],
    ['WhatsApp do comercial ao grupo', { capacidade: 'comercial.whatsapp.enviar', conteudo: { destino: 'grupo' }, alvo: 'Construtora Alicerce' }, 'Enviar WhatsApp ao grupo sobre Construtora Alicerce'],
    ['WhatsApp do comercial sem o nome (quem só acompanha)', { capacidade: 'comercial.whatsapp.enviar', conteudo: null, conteudoOculto: true }, 'Enviar WhatsApp para o lead'],
    ['WhatsApp da pauta com título', { conteudo: { titulo: 'Pauta de hoje', corpo: 'x' } }, 'Enviar WhatsApp “Pauta de hoje”'],
    ['WhatsApp sem argumento nenhum', { conteudo: null }, 'Enviar WhatsApp'],
    ['publicar no Instagram', { capacidade: 'instagram.post.publicar', conteudo: { formato: 'carrossel', legenda: 'O preço caiu' } }, 'Publicar no Instagram o carrossel “O preço caiu”'],
    ['lote da semana', { capacidade: 'pauta.semana.aprovar', resumo: 'Semana de ep-12: 4 post(s) no @operacaoroot' }, 'Aprovar a semana do episódio 12'],
    ['lote sem episódio no resumo', { capacidade: 'pauta.semana.aprovar', resumo: 'pauta.semana.aprovar' }, 'Aprovar a semana de posts'],
    [
      'mover no funil (superfície antiga, resumo do servidor)',
      { capacidade: null, conteudo: null, recurso: { tipo: 'lead', id: 'l1' }, resumo: 'Mover Construtora de Alicerce de E5 · Diagnóstico para E6 · Proposta com pendências: x. Pedido por Ana pela tela do funil.' },
      'Mover Construtora de Alicerce para Proposta',
    ],
    ['e-mail', { capacidade: 'email.enviar', conteudo: { para: 'ana@x.com', assunto: 'Contrato' } }, 'Enviar e-mail para ana@x.com: “Contrato”'],
    ['e-mail com vários destinatários', { capacidade: 'email.enviar', conteudo: { para: ['a@x', 'b@x'] } }, 'Enviar e-mail para a@x, b@x'],
    ['evento na agenda', { capacidade: 'agenda.evento.criar', conteudo: { titulo: 'Kickoff' } }, 'Criar evento na agenda “Kickoff”'],
    ['proposta', { capacidade: 'comercial.proposta.publicar', conteudo: { versao: 2 }, alvo: 'Marina Duarte' }, 'Publicar a proposta v2 para Marina Duarte'],
    ['cobrança', { capacidade: 'comercial.cobranca.criar', conteudo: { valorCentavos: 1_199_700, parcelas: 3 }, alvo: 'Marina' }, 'Criar a cobrança de R$ 11.997,00 em 3× para Marina'],
    ['YouTube', { capacidade: 'youtube.video.enviar', conteudo: { titulo: 'Episódio 12' } }, 'Enviar ao YouTube o vídeo “Episódio 12”'],
    ['DM automática', { capacidade: 'instagram.resposta_privada.enviar', conteudo: { palavra: 'AGENTES' } }, 'Responder no direct quem comentar AGENTES'],
    ['superfície antiga sem frase própria usa o resumo do servidor', { capacidade: null, conteudo: null, recurso: { tipo: 'campaign', id: 'c' }, resumo: 'Pausar a campanha de outubro' }, 'Pausar a campanha de outubro'],
    ['capacidade desconhecida: o caso honesto', { capacidade: 'omie.titulo.alterar' }, 'Executar omie.titulo.alterar'],
  ];
  it.each(casos)('%s', (_nome, over, esperado) => {
    expect(fraseDoPedido(item(over))).toBe(esperado);
  });

  it('o trecho longo é cortado sem partir palavra, com reticências', () => {
    const t = trecho('Esta é uma legenda bem comprida que passa do teto de caracteres da linha compacta da fila', 40)!;
    expect(t.endsWith('…”')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(43);
    expect(t).not.toMatch(/\s…/);
  });
});

/* -------------------------------------------------------------- os grupos */

describe('os três grupos, lidos do que o servidor decidiu', () => {
  const POSSO = item({ id: 'posso' });
  const PROPUS = item({
    id: 'propus',
    proponente: { id: 'u-eu', tipo: 'user', nome: 'Rodrigo' },
    aprovadores: [{ id: 'u-ana', nome: 'Ana', email: 'a@x', alcada: 'responsavel' }],
    euPossoAprovar: false,
    porQueNao: 'Você propôs esta ação, e quem propõe não assina.',
  });
  const TITULAR = item({
    id: 'titular',
    nivel: 'R4',
    alcadaMinima: 'titular',
    exigeReauth: true,
    exigeMotivo: true,
    aprovadores: [{ id: 'u-li', nome: 'Lidiane', email: 'l@x', alcada: 'titular' }],
    euPossoAprovar: false,
    porQueNao: 'Esta ação exige alçada "titular" e a sua é "responsavel".',
  });
  const VENCIDA = item({ id: 'vencida', gaveta: 'expirou', euPossoAprovar: false, expiraEm: '2026-10-17T12:00:00.000Z' });
  const RECUSADA = item({ id: 'recusada', gaveta: 'recusada', status: 'rejeitada', euPossoAprovar: false, decididoPor: 'Ana' });
  const IMPEDIDA = item({ id: 'impedida', impedimento: 'argumento fora do formato', euPossoAprovar: false });
  const LIMBO = item({ id: 'limbo', gaveta: 'confirmada', euPossoAprovar: false });

  it('eu posso → depende de você; eu propus e falta titular → outra pessoa; vencida e recusada → histórico', () => {
    expect(grupoDoItem(POSSO, EU)).toBe('voce');
    expect(grupoDoItem(PROPUS, EU)).toBe('outra');
    expect(grupoDoItem(TITULAR, EU)).toBe('outra');
    expect(grupoDoItem(VENCIDA, EU)).toBe('historico');
    expect(grupoDoItem(RECUSADA, EU)).toBe('historico');
  });

  it('o que só sai com a sua recusa também depende de você, sem botão de assinar', () => {
    for (const i of [IMPEDIDA, LIMBO]) {
      expect(grupoDoItem(i, EU)).toBe('voce');
      expect(passoDoItem(i, EU).assinar).toBeNull();
    }
    expect(passoDoItem(LIMBO, EU).recusar).toBe('Recusar e tirar da fila');
    // quem não decide nesta sessão não recusa: o mesmo item espera outra pessoa
    const soVe = { ...EU, decideNestaSessao: false };
    expect(grupoDoItem(IMPEDIDA, soVe)).toBe('outra');
    expect(passoDoItem(IMPEDIDA, soVe).recusar).toBeNull();
  });

  it('o botão de assinar segue SÓ o euPossoAprovar do servidor', () => {
    expect(passoDoItem(POSSO, EU).assinar).toEqual({ fechado: 'Ler e confirmar', aberto: 'Confirmar' });
    expect(passoDoItem({ ...POSSO, alcadaMinima: 'titular' }, EU).assinar?.aberto).toBe('Assinar como titular');
    expect(passoDoItem(PROPUS, EU).assinar).toBeNull();
    expect(passoDoItem(PROPUS, EU).recusar).toBe('Cancelar o que eu propus');
    expect(passoDoItem(TITULAR, EU).assinar).toBeNull();
    expect(passoDoItem(VENCIDA, EU)).toEqual({ assinar: null, recusar: null });
  });

  it('a espera diz o porquê em poucas palavras e quem pode assinar', () => {
    expect(motivoDaEspera(PROPUS, EU)).toBe('Você pediu: assina outra pessoa');
    expect(motivoDaEspera(TITULAR, EU)).toBe('Falta a titular');
    expect(motivoDaEspera(item({ euPossoAprovar: false }), { ...EU, decideNestaSessao: false })).toBe(
      'Seu perfil acompanha, não assina',
    );
    expect(quemPodeAssinar(TITULAR)).toBe('Pode assinar: Lidiane');
    expect(quemPodeAssinar({ aprovadores: [] })).toBe('Ninguém pode assinar hoje');
  });

  it('as condições de assinatura, legíveis antes do clique', () => {
    expect(condicoesDeAssinatura(TITULAR)).toEqual([
      'Alçada titular ou acima',
      'Outra pessoa que não quem pediu (curador)',
      'Sua senha de novo, na hora de assinar',
      'Um motivo escrito (R4 exige)',
    ]);
    expect(nivelEmPalavras('R3')).toBe('R3: pede uma segunda pessoa');
    expect(nivelEmPalavras('R4')).toBe('R4: pede a titular, com senha');
  });

  it('contadores do topo (sem o filtro) e grupos filtrados por tipo', () => {
    const LOTE = item({ id: 'lote', capacidade: 'pauta.semana.aprovar', canal: null, recurso: { tipo: 'pauta.semana.aprovar', id: 'l' }, expiraEm: '2026-10-20T12:00:00.000Z' });
    const fila = {
      agora: '2026-10-18T12:05:00.000Z',
      eu: EU,
      itens: [POSSO, PROPUS, TITULAR, VENCIDA, RECUSADA, LOTE],
    };
    const tudo = organizarFila(fila);
    expect(tudo.grupos.voce.map((i) => i.id)).toEqual(['posso', 'lote']);
    expect(tudo.grupos.outra.map((i) => i.id)).toEqual(['propus', 'titular']);
    expect(tudo.grupos.historico.map((i) => i.id)).toEqual(['vencida', 'recusada']);
    // vence hoje: os vivos com prazo hoje em São Paulo (o lote vence dia 20)
    expect(tudo.contadores).toMatchObject({ voce: 2, vencendoHoje: 3 });
    expect(tudo.contadores.porTipo).toMatchObject({ todos: 6, whatsapp: 5, lote: 1, google: 0 });

    const soLote = organizarFila(fila, 'lote');
    expect(soLote.grupos.voce.map((i) => i.id)).toEqual(['lote']);
    expect(soLote.grupos.outra).toEqual([]);
    expect(soLote.contadores.voce).toBe(2);
  });

  it('o tipo de cada pedido e o filtro da query', () => {
    expect(tipoDoPedido(item({ capacidade: 'instagram.post.publicar', canal: 'instagram' }))).toBe('publicacao');
    expect(tipoDoPedido(item({ capacidade: 'email.enviar', canal: 'google' }))).toBe('google');
    expect(tipoDoPedido(item({ capacidade: null, canal: null, recurso: { tipo: 'lead', id: 'l' } }))).toBe('comercial');
    expect(tipoDoPedido(item({ capacidade: 'comercial.proposta.publicar', canal: null }))).toBe('comercial');
    expect(tipoDoPedido(item({ capacidade: 'comercial.whatsapp.enviar', canal: null }))).toBe('whatsapp');
    expect(tipoDoPedido(item({ capacidade: 'nfe.emitir', canal: null, recurso: { tipo: 'nfe', id: 'n' } }))).toBe('outros');
    expect(filtroDaQuery('?tipo=lote')).toBe('lote');
    expect(filtroDaQuery('?tipo=qualquer')).toBe('todos');
    expect(filtroDaQuery('')).toBe('todos');
  });
});
