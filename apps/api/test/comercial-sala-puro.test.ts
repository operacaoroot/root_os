import { describe, expect, it } from 'vitest';
import { SALA_TOKEN_RE, SalaFormSchema } from '@mktos/shared';

import { horarioOferecido, horariosOferecidos, rotuloDoHorario } from '../src/comercial/agenda-de-homologacao';
import { MENSAGENS } from '../src/comercial/mensagens';
import { TetoPorOrigem } from '../src/comercial/sala.controller';
import { estagioDaSala, projetarSala, type EntradaDaProjecao, type EventoDaSala } from '../src/comercial/sala-projecao';
import {
  cifrarTokenDaSala,
  decifrarTokenDaSala,
  gerarTokenDaSala,
  hashDoTokenDaSala,
  salaAtiva,
  slugDaSala,
  tokenDaSalaBemFormado,
} from '../src/comercial/sala-token';
import { nomeDeReserva, nomeDeTratamento, textoComNome } from '../src/comercial/whatsapp.service';

/*
 * A SALA E O CANAL SEM BANCO (Lane B): o token, a agenda de homologação, a
 * projeção da sala a partir do fio, o texto sem nome inventado e o teto por origem.
 */

describe('o token da sala', () => {
  it('casa o formato do contrato e o banco só vê o hash', () => {
    const { token, hash } = gerarTokenDaSala();
    expect(SALA_TOKEN_RE.test(token)).toBe(true);
    expect(tokenDaSalaBemFormado(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashDoTokenDaSala(token)).toBe(hash);
  });

  it('a cifra abre só com a mesma chave e a mesma sala', () => {
    const { token } = gerarTokenDaSala();
    const pacote = cifrarTokenDaSala(token, 'segredo-de-teste-123456', 'sala-1');
    expect(pacote).not.toContain(token);
    expect(decifrarTokenDaSala(pacote, 'segredo-de-teste-123456', 'sala-1')).toBe(token);
    expect(decifrarTokenDaSala(pacote, 'segredo-de-teste-123456', 'sala-2')).toBeNull();
    expect(decifrarTokenDaSala(pacote, 'outro-segredo-qualquer-99', 'sala-1')).toBeNull();
  });

  it('malformado não chega ao banco; vencida e revogada não são ativas', () => {
    expect(tokenDaSalaBemFormado('curto')).toBe(false);
    expect(tokenDaSalaBemFormado('a'.repeat(43) + '!')).toBe(false);
    const agora = new Date('2026-10-13T12:00:00Z');
    expect(salaAtiva({ validoAte: new Date('2026-10-14T00:00:00Z'), revogadoEm: null }, agora)).toBe(true);
    expect(salaAtiva({ validoAte: new Date('2026-10-13T11:59:59Z'), revogadoEm: null }, agora)).toBe(false);
    expect(salaAtiva({ validoAte: new Date('2026-10-14T00:00:00Z'), revogadoEm: agora }, agora)).toBe(false);
  });

  it('o slug é legível e sem acento', () => {
    expect(slugDaSala('Construtora Alicerce Ltda.')).toBe('construtora-alicerce-ltda');
    expect(slugDaSala('Ótica Vista')).toBe('otica-vista');
    expect(slugDaSala('')).toBe('sala');
  });
});

describe('a agenda de homologação', () => {
  it('seis horários em três dias úteis, 10h e 15h de São Paulo, a partir de amanhã', () => {
    // sexta, 16/10/2026, 12h em São Paulo
    const h = horariosOferecidos(new Date('2026-10-16T15:00:00Z'));
    expect(h).toEqual([
      '2026-10-19T10:00:00-03:00',
      '2026-10-19T15:00:00-03:00',
      '2026-10-20T10:00:00-03:00',
      '2026-10-20T15:00:00-03:00',
      '2026-10-21T10:00:00-03:00',
      '2026-10-21T15:00:00-03:00',
    ]);
    expect(rotuloDoHorario(h[0])).toBe('Seg 19/10 · 10h');
    expect(rotuloDoHorario('2026-10-16T13:00:00Z')).toBe('Sex 16/10 · 10h');
  });

  it('confere o instante, não o texto', () => {
    const h = ['2026-10-19T10:00:00-03:00'];
    expect(horarioOferecido('2026-10-19T13:00:00Z', h)).toBe(true);
    expect(horarioOferecido('2026-10-19T11:00:00-03:00', h)).toBe(false);
    expect(horarioOferecido('lixo', h)).toBe(false);
  });
});

describe('o texto sem nome inventado', () => {
  it('com nome usa o primeiro nome; sem nome tira o vocativo inteiro', () => {
    expect(nomeDeTratamento('Marina Duarte')).toBe('Marina');
    expect(nomeDeTratamento(nomeDeReserva('+55 32 99999-1234'))).toBeNull();
    const com = textoComNome('M1', 'Marina', { linkDaSala: 'http://x/s/abc' });
    expect(com.startsWith('Oi, Marina. Recebemos')).toBe(true);
    const sem = textoComNome('M1', null, { linkDaSala: 'http://x/s/abc' });
    expect(sem.startsWith('Oi. Recebemos')).toBe(true);
    const m3 = textoComNome('M3', null, { horario: 'Seg 19/10 · 10h', linkDaSala: 'http://x' });
    expect(m3.startsWith('A nossa conversa é amanhã')).toBe(true);
    expect(m3).not.toContain('\u0000');
  });

  it('variável que falta não prepara nada', () => {
    expect(() => textoComNome('M4', 'Marina', { linkDaSala: 'http://x' })).toThrow(/validade/);
  });

  it('os oito textos seguem o padrão da casa: sem travessão e sem emoji', () => {
    for (const t of Object.values(MENSAGENS)) {
      expect(t.texto).not.toMatch(/[—–]/);
      expect(t.texto).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('a sala como projeção do fio', () => {
  const t0 = new Date('2026-10-13T12:00:00Z');
  const ev = (type: string, payload: Record<string, unknown>, minutos: number): EventoDaSala => ({ type, payload, occurredAt: new Date(t0.getTime() + minutos * 60_000) });
  const base = (eventos: EventoDaSala[], agora = t0): EntradaDaProjecao => ({
    slug: 'alicerce',
    nomeDoLead: 'Marina Duarte',
    validoAte: new Date('2027-01-11T12:00:00Z'),
    dados: { horariosOferecidos: ['2026-10-14T10:00:00-03:00', '2026-10-14T15:00:00-03:00'] },
    ficha: null,
    eventos,
    cobrancas: [],
    documentos: [],
    agora,
  });
  const form = ev('form.respondido', { sistema: 'Omie', baseOrganizada: true, maiorDor: 'fechamento leva 9 dias', equipeFinanceiro: 3 }, 1);
  const agenda = ev('agenda.escolhida', { horario: '2026-10-14T10:00:00-03:00', oferecidos: [] }, 2);
  const pub = ev(
    'proposta.publicada',
    { versao: 1, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, parcelaCentavos: 399_900, formas: ['pix', 'boleto', 'cartao'], validaAte: '2026-10-24T23:59:00-03:00', dentroDaTabela: true, laudo: { ok: true, apontamentos: [] }, hash: 'h1', alternativa: 'imersao' },
    3000,
  );

  it('sem nada além da chegada: conversa, sem horários (o formulário vem antes)', () => {
    const s = projetarSala(base([ev('lead.chegou', { telefone: '5532', texto: 'oi' }, 0)]));
    expect(s.estagio).toBe('conversa');
    expect(s.conversa.horariosOferecidos).toEqual([]);
    expect(s.planoDeAcao.every((p) => !p.feito)).toBe(true);
    expect(s.estagios.map((e) => e.estado)).toEqual(['atual', 'vem', 'vem', 'vem', 'vem']);
  });

  it('formulário respondido: mostra o que contou e os horários oferecidos', () => {
    const s = projetarSala(base([form]));
    expect(s.conversa.oQueContou).toEqual(['Omie', 'base organizada', 'fechamento leva 9 dias', '3 pessoas no financeiro']);
    expect(s.conversa.horariosOferecidos).toHaveLength(2);
    expect(s.planoDeAcao[0].feito).toBe(true);
  });

  it('horário escolhido some com a lista; passada a conversa, o estágio é diagnóstico', () => {
    const s = projetarSala(base([form, agenda]));
    expect(s.conversa.horario).toBe('2026-10-14T10:00:00-03:00');
    expect(s.conversa.horariosOferecidos).toEqual([]);
    expect(s.estagio).toBe('conversa');
    expect(estagioDaSala(base([form, agenda], new Date('2026-10-14T14:00:00Z')))).toBe('diagnostico');
  });

  it('proposta publicada: oferta do evento, alternativa da tabela, blocos lidos e ajuste pendente', () => {
    const lida = ev('proposta.lida', { versao: 1, bloco: 'recomendada', visita: 1 }, 3001);
    const ajuste = ev('proposta.ajuste_pedido', { versao: 1, pedido: 'desconto de 8%', descontoPct: 8 }, 3002);
    const duvida = ev('proposta.duvida', { versao: 1, pergunta: 'funciona com Omie?', resposta: null }, 3003);
    const diag = ev('diagnostico.pronto', { dores: [{ n: 1, texto: 'fechamento no dia 9', minuto: '04:12' }], objecoes: ['consultoria anterior parou'], produtoSugerido: 'operacao', modelo: 'stub', custoUsd: 0, custoDesconhecido: false, aprovadoEm: '2026-10-13T12:00:00.000Z' }, 2000);
    const s = projetarSala(base([form, agenda, diag, pub, lida, ajuste, duvida]));
    expect(s.estagio).toBe('proposta');
    expect(s.proposta?.recomendada).toMatchObject({ produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3 });
    expect(s.proposta?.alternativa).toMatchObject({ produto: 'imersao', valorCentavos: 297_000, parcelas: 10 });
    expect(s.proposta?.blocosLidos).toEqual(['recomendada']);
    expect(s.proposta?.ajustePendente).toBe(true);
    expect(s.proposta?.ouvimos).toEqual(['fechamento no dia 9']);
    expect(s.proposta?.duvidas).toEqual([{ pergunta: 'funciona com Omie?', resposta: null, em: duvida.occurredAt.toISOString() }]);
    // As objeções são leitura interna: não vão para o lead.
    expect(s.diagnostico?.objecoes).toEqual([]);

    const decidido = ev('decisao.tomada', { decisaoId: 'd1', tipo: 'pedido_de_ajuste', escolha: 'manter', por: 'x', canal: 'tela' }, 3010);
    expect(projetarSala(base([form, agenda, pub, ajuste, decidido])).proposta?.ajustePendente).toBe(false);
  });

  it('sem alternativa nomeada no evento, nenhuma alternativa inventada', () => {
    const p = { ...(pub.payload as Record<string, unknown>) };
    delete p.alternativa;
    const s = projetarSala(base([form, { ...pub, payload: p }]));
    expect(s.proposta?.alternativa).toBeNull();
  });

  it('aceite: contrato, com a cobrança e o documento quando existirem; cliente ativo abre o começo', () => {
    const dados = ev('aceite.dados', { cnpj: '12345678000199', razaoSocial: 'Construtora Alicerce Ltda', endereco: 'Rua A, 1', quemAssina: 'Marina Duarte', email: 'm@a.com' }, 3100);
    const aceita = ev('proposta.aceita', { versao: 1, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, forma: 'pix', hash: 'h1' }, 3101);
    const e = base([form, pub, dados, aceita]);
    const s = projetarSala({
      ...e,
      cobrancas: [{ parcela: 1, estado: 'pendente', valorCentavos: 399_900, linkPagamento: 'http://pague', pixCopiaECola: '000201' }],
      documentos: [{ estado: 'enviado', linkCliente: 'http://assine', assinadoClienteEm: null, assinadoRootEm: null, criadoEm: t0 }],
    });
    expect(s.estagio).toBe('contrato');
    expect(s.aceite).toMatchObject({ produto: 'operacao', forma: 'pix', cobranca: { primeiraParcelaCentavos: 399_900 }, contrato: { linkAssinatura: 'http://assine' } });
    expect(s.comeco).toMatchObject({ grupoCriado: false, kickoffEm: null });
    const ativo = projetarSala(base([form, pub, dados, aceita, ev('cliente.ativo', { chave: 'fech-x-v1' }, 4000)]));
    expect(ativo.estagio).toBe('comeco');
    expect(ativo.estagios.map((x) => x.estado)).toEqual(['passou', 'passou', 'passou', 'passou', 'atual']);
  });
});

describe('o teto por origem', () => {
  it('deixa passar até o teto e recusa depois, por hora', () => {
    const t = new TetoPorOrigem();
    const agora = 1_000_000;
    for (let i = 0; i < 3; i++) expect(t.registrar('1.2.3.4', 3, agora)).toBe(true);
    expect(t.registrar('1.2.3.4', 3, agora)).toBe(false);
    expect(t.registrar('5.6.7.8', 3, agora)).toBe(true);
    expect(t.registrar('1.2.3.4', 3, agora + 3_600_001)).toBe(true);
  });
});

describe('o formulário do contrato', () => {
  it('recusa campo a mais', () => {
    expect(SalaFormSchema.safeParse({ sistema: 'Omie', baseOrganizada: true, maiorDor: 'x', equipeFinanceiro: 3, extra: 1 }).success).toBe(false);
  });
});

describe('o teto na rota anônima da sala', () => {
  it('a 601ª leitura da mesma origem na hora é 429; outra origem segue; o arquivo tem teto próprio', async () => {
    const { SalaController, SALA_TETO_POR_HORA, SALA_TETO_DE_ARQUIVO_POR_HORA } = await import('../src/comercial/sala.controller');
    const svc = { estado: async () => ({ ok: true }), arquivo: async () => ({ ok: true }) };
    const c = new SalaController(svc as never);
    const req = { ip: '10.0.0.1' };
    for (let i = 0; i < SALA_TETO_POR_HORA; i++) await c.estado('t', req);
    expect(() => c.estado('t', req)).toThrow(expect.objectContaining({ status: 429 }));
    await expect(c.estado('t', { ip: '10.0.0.2' })).resolves.toEqual({ ok: true });
    for (let i = 0; i < SALA_TETO_DE_ARQUIVO_POR_HORA; i++) await c.arquivo('t', undefined, { ip: '10.0.0.3' });
    expect(() => c.arquivo('t', undefined, { ip: '10.0.0.3' })).toThrow(expect.objectContaining({ status: 429 }));
  });
});
