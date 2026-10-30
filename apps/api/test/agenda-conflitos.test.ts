import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PROPRIEDADES_DO_OS,
  feriadosDoAno,
  lerCompromisso,
  type CartaoDeConflito,
  type EventoDaAgenda,
  type FeriadoDaAgenda,
  type RegraDaPessoa,
  type RespostaDoEspelho,
  type RitoDaAgenda,
} from '@mktos/shared';

import type { PrismaService } from '../src/prisma/prisma.service';
import type { EspelhoService } from '../src/agenda/espelho/espelho.service';
import { chaveDoPedido, contarConflitos, montarConflitos, type EntradaDosConflitos } from '../src/agenda/regua/conflitos';
import { ConflitosService } from '../src/agenda/regua/conflitos.service';
import { montarRelatorio } from '../src/agenda/regua/relatorios';
import { ReguaService } from '../src/agenda/regua/regua.service';
import { OPCAO_NAO_E_REUNIAO } from '../src/agenda/vigia-da-agenda';
import { SLUG_DA_ROTINA_DO_VIGIA } from '../src/agenda/vigia-da-agenda.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * OS CONFLITOS E OS RELATÓRIOS DA AGENDA (agenda v2, 29/10/2026, lane G5).
 *
 * A parte pura com um retrato de novembro de 2026 (seg 02/11 Finados, qua 04/11,
 * qui 05/11), e o serviço contra o banco de teste com um dublê do espelho e as
 * linhas do vigia AG-01. Dados fictícios.
 */

const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`).toISOString();
const AGORA = new Date(sp('2026-10-29', '14:00'));

const FERIADOS: FeriadoDaAgenda[] = [2026, 2027].flatMap((ano) =>
  feriadosDoAno(ano).map((f, i) => ({
    id: `f${ano}${i}`, data: f.dia, nome: f.nome,
    tipo: (f.nome === 'Carnaval' || f.nome === 'Corpus Christi' ? 'facultativo' : 'nacional') as FeriadoDaAgenda['tipo'],
    cidade: null, ligado: !(f.nome === 'Carnaval' || f.nome === 'Corpus Christi'),
  })),
);

const pessoa = (nome: RegraDaPessoa['nome'], over: Partial<RegraDaPessoa>): RegraDaPessoa => ({
  id: `r-${nome}`, nome, area: null, email: `${nome.toLowerCase()}@casa.teste`, janela: { inicio: '08:00', fim: '18:00' },
  intervaloMin: 15, trajetoMin: 30, tetoPorDia: 5, bloqueiosFixos: [], emailPessoal: null, fechadoLigado: false, substituto: null, ...over,
});
const PESSOAS: RegraDaPessoa[] = [
  pessoa('Rodrigo', { janela: { inicio: '08:00', fim: '19:00' }, bloqueiosFixos: [{ diaDaSemana: 4, inicio: '19:00', fim: null }], substituto: 'Lucas' }),
  pessoa('Lucas', { janela: { inicio: '09:00', fim: '18:00' }, tetoPorDia: 4, substituto: 'Rodrigo' }),
  pessoa('Pedro', { janela: { inicio: '08:30', fim: '18:00' }, intervaloMin: 10, substituto: 'Rodrigo', email: null }),
];
const RITOS: RitoDaAgenda[] = [
  { id: 'terca', nome: 'Reunião Interna - Todos (pauta da semana)', titulo: 'Reunião Interna - Todos', diaDaSemana: 2, ordinalNoMes: null, inicio: '08:00', duracaoMin: 60, quem: 'Todos', politica: 'pergunta', ligado: true, aDecidir: true },
  { id: 'quinta', nome: 'Reunião Interna - Todos (estrutura fixa)', titulo: 'Reunião Interna - Todos', diaDaSemana: 4, ordinalNoMes: null, inicio: '19:30', duracaoMin: 90, quem: 'Todos', politica: 'bloqueia', ligado: true, aDecidir: false },
];

const ev = (id: string, titulo: string, dia: string, de: string, ate: string, over: Partial<EventoDaAgenda> = {}): EventoDaAgenda => ({
  id, agenda: 'primary', origem: 'google', titulo, inicio: sp(dia, de), fim: sp(dia, ate), diaInteiro: false,
  local: null, meet: 'https://meet.google.com/aaa-bbbb-ccc', convidados: [], organizador: null, organizadorEhAgenda: true, status: 'confirmado',
  atualizadoNoGoogle: null, serieId: null, criadoPeloOs: false, link: null, leitura: lerCompromisso(titulo), ...over,
});

const EVENTOS: EventoDaAgenda[] = [
  // Choque: o Rodrigo em dois lugares na quarta 04/11 às 09:00.
  ev('a-promedical', 'Reunião Online - Promedical - Rodrigo', '2026-11-04', '09:00', '10:00'),
  ev('b-campobom', 'Reunião Online - Campo Bom - Rodrigo', '2026-11-04', '09:00', '10:00'),
  // Sem Meet: a online de cliente sem link.
  ev('c-cultural', 'Reunião Online - Cultural Clube - Lucas', '2026-11-05', '10:00', '11:00', { meet: null }),
  // Rito sem gente: o Pedro Fora na quinta do rito, e a ocorrência do rito na agenda.
  { ...ev('d-fora', 'Pedro Fora - viagem', '2026-11-05', '00:00', '00:00', { meet: null }), inicio: '2026-11-05', fim: '2026-11-06', diaInteiro: true },
  ev('e-rito', 'Reunião Interna - Todos', '2026-11-05', '19:30', '21:00', { serieId: 'serie-quinta' }),
  // Feriado: reunião em Finados.
  ev('f-finados', 'Reunião Online - Acme - Pedro', '2026-11-02', '10:00', '11:00'),
  // Trajeto: presencial do Lucas colada na anterior.
  ev('g-anterior', 'Reunião Online - Alfa - Lucas', '2026-11-03', '15:00', '16:00'),
  ev('h-custeio', 'Reunião Presencial - Custeio - Lucas', '2026-11-03', '16:00', '17:00', { meet: null }),
];

const entrada = (over: Partial<EntradaDosConflitos> = {}): EntradaDosConflitos => ({
  orgId: 'org-x', eventos: EVENTOS, regras: { pessoas: PESSOAS, ritos: RITOS, feriados: FERIADOS }, agora: AGORA, dias: 60, ...over,
});

const doTipo = (cs: CartaoDeConflito[], tipo: CartaoDeConflito['tipo']) => cs.filter((c) => c.tipo === tipo);

describe('os conflitos (parte pura)', () => {
  const cartoes = montarConflitos(entrada());

  it('choque: um cartão para o par, com os consertos do desenho', () => {
    const [c] = doTipo(cartoes, 'choque');
    expect(doTipo(cartoes, 'choque')).toHaveLength(1);
    expect(c.titulo).toBe('Rodrigo está em dois lugares ao mesmo tempo');
    expect(c.eventos.map((e) => e.id).sort()).toEqual(['a-promedical', 'b-campobom']);
    expect(c.acoes.map((a) => a.rotulo)).toEqual([
      'Empurrar Campo Bom para 10:30',
      'Passar Campo Bom para o Lucas (livre)',
      'Remarcar…',
      'Marcar como confirmado com o cliente',
    ]);
    const empurrar = c.acoes[0].pedido!;
    expect(empurrar).toMatchObject({
      acao: 'alterar', eventoId: 'b-campobom',
      antes: { titulo: 'Reunião Online - Campo Bom - Rodrigo', inicio: sp('2026-11-04', '09:00'), meet: true },
      depois: { inicio: sp('2026-11-04', '10:30'), fim: sp('2026-11-04', '11:30') },
    });
    expect(c.acoes[1].pedido).toMatchObject({ acao: 'alterar', depois: { responsaveis: ['Lucas'] } });
    expect(c.acoes[2].pedido).toBeNull();
    expect(c.acoes[3].pedido).toMatchObject({ acao: 'alterar', depois: { confirmadoComCliente: true } });
    expect(c.confirmado).toBe(false);
  });

  it('as chaves são base32hex, determinísticas e uma por ação', () => {
    const chaves = cartoes.flatMap((c) => c.acoes.map((a) => a.pedido?.chave).filter((x): x is string => !!x));
    expect(chaves.length).toBeGreaterThan(5);
    for (const k of chaves) expect(k).toMatch(/^[a-v0-9]{10,64}$/);
    expect(new Set(chaves).size).toBe(chaves.length);
    const de_novo = montarConflitos(entrada()).flatMap((c) => c.acoes.map((a) => a.pedido?.chave).filter(Boolean));
    expect(de_novo).toEqual(chaves);
    expect(chaveDoPedido('a', 1)).not.toBe(chaveDoPedido('a', 2));
    // A chave é da empresa também.
    const outra = montarConflitos(entrada({ orgId: 'org-y' })).flatMap((c) => c.acoes.map((a) => a.pedido?.chave).filter(Boolean));
    expect(outra[0]).not.toBe(chaves[0]);
  });

  it('online sem Meet: criar o Meet ou trocar para presencial', () => {
    const [c] = doTipo(cartoes, 'sem_meet');
    expect(c.eventos[0].id).toBe('c-cultural');
    expect(c.acoes.map((a) => [a.rotulo, a.pedido && a.pedido.acao === 'alterar' ? a.pedido.depois : null])).toEqual([
      ['Criar o Meet e avisar o cliente', { criarMeet: true }],
      ['Trocar para presencial', { modalidade: 'presencial' }],
    ]);
  });

  it('rito sem gente: Pedro Fora na quinta, com "pular esta ocorrência"', () => {
    const c = doTipo(cartoes, 'rito').find((x) => x.id.startsWith('rito-sem-gente'))!;
    expect(c.titulo).toBe('Pedro Fora no dia do rito');
    expect(c.frase).toBe('Reunião Interna - Todos (estrutura fixa), qui 05/11 19:30: Pedro está Fora (viagem).');
    expect(c.acoes.map((a) => a.rotulo)).toEqual(['Manter sem o Pedro', 'Pular esta ocorrência']);
    expect(c.acoes[1].pedido).toMatchObject({ acao: 'cancelar', eventoId: 'e-rito', motivo: 'ocorrência pulada', avisar: true });
  });

  it('o evento do próprio rito não vira conflito de janela nem de bloqueio fixo', () => {
    expect(cartoes.some((c) => c.tipo === 'janela' && c.eventos.some((e) => e.id === 'e-rito'))).toBe(false);
  });

  it('feriado: levar para o dia útil seguinte, mesmo horário', () => {
    const [c] = doTipo(cartoes, 'feriado');
    expect(c.frase).toBe('Feriado: Finados (seg 02/11). Agenda fechada.');
    expect(c.acoes[0].rotulo).toBe('Levar para ter 03/11, mesmo horário');
    expect(c.acoes[0].pedido).toMatchObject({ depois: { inicio: sp('2026-11-03', '10:00'), fim: sp('2026-11-03', '11:00') } });
  });

  it('trajeto: um cartão só, na presencial, com empurrar e trocar para online', () => {
    const js = doTipo(cartoes, 'janela');
    const c = js.find((x) => x.eventos[0].id === 'h-custeio')!;
    expect(js.some((x) => x.eventos[0].id === 'g-anterior')).toBe(false);
    expect(c.frase).toContain('Falta o trajeto de 30 min antes da presencial');
    expect(c.acoes.map((a) => a.rotulo)).toEqual(['Empurrar Custeio para 16:30', 'Trocar para online', 'Remarcar…', 'Deixar assim']);
    expect(c.acoes[1].pedido).toMatchObject({ depois: { modalidade: 'online', criarMeet: true } });
  });

  it('ordem por urgência e contagem por tipo', () => {
    expect(cartoes.map((c) => c.urgencia)).toEqual([...cartoes.map((c) => c.urgencia)].sort((a, b) => a - b));
    expect(cartoes[0].tipo).toBe('feriado');
    const n = contarConflitos(cartoes);
    expect(n.tudo).toBe(cartoes.length);
    expect(n.choque).toBe(1);
    expect(n.sem_meet).toBe(1);
  });

  it('confirmado com o cliente: continua na lista, sem alarme e no fim', () => {
    const props = new Map([['b-campobom', { [PROPRIEDADES_DO_OS.confirmadoComCliente]: '1' }]]);
    const cs = montarConflitos(entrada({ propriedades: props }));
    const c = doTipo(cs, 'choque')[0];
    expect(c.confirmado).toBe(true);
    expect(c.acoes.some((a) => a.tipo === 'confirmado_com_cliente')).toBe(false);
    expect(cs[cs.length - 1].id).toBe(c.id);
  });

  it('teto: um cartão por pessoa e dia, mexendo na última', () => {
    const cinco = ['09:00', '10:30', '12:00', '13:30', '15:00'].map((h, i) =>
      ev(`t${i}`, `Reunião Online - Cliente ${i} - Lucas`, '2026-11-10', h, `${String(Number(h.slice(0, 2)) + 1).padStart(2, '0')}:${h.slice(3)}`),
    );
    const cs = doTipo(montarConflitos(entrada({ eventos: cinco })), 'teto');
    expect(cs).toHaveLength(1);
    expect(cs[0].frase).toBe('5 reuniões do Lucas no dia (limite 4)');
    expect(cs[0].acoes.find((a) => a.tipo === 'empurrar')?.pedido).toMatchObject({ eventoId: 't4' });
  });

  it('séries: a mesma falta numa série vira um cartão só', () => {
    const serie = ['2026-11-11', '2026-11-18', '2026-11-25'].map((d, i) =>
      ev(`s${i}`, 'Reunião Online - Semanal - Rodrigo', d, '11:00', '12:00', { meet: null, serieId: 'serie-semanal' }),
    );
    const cs = doTipo(montarConflitos(entrada({ eventos: serie })), 'sem_meet');
    expect(cs).toHaveLength(1);
    expect(cs[0].eventos).toHaveLength(3);
    expect(cs[0].frase).toContain('Repete na série: 3 ocorrências.');
  });

  it('o vigia: aplicar título e "não é reunião" pela rota do vigia; sem Meet não duplica', () => {
    const cs = montarConflitos(
      entrada({
        vigia: [
          {
            eventoId: 'c-cultural', tituloAtual: 'call com cliente novo', inicio: sp('2026-11-05', '10:00'), estado: 'proposta',
            problemas: ['o título não está no padrão'], tituloProposto: 'Reunião Online - Juma - Lucas', adicionarMeet: true,
            pendenciaId: 'pend-1', opcaoNaoEReuniao: OPCAO_NAO_E_REUNIAO,
          },
        ],
      }),
    );
    const c = doTipo(cs, 'padrao')[0];
    expect(c.titulo).toBe('"call com cliente novo"');
    expect(c.frase).toContain('proposta: Reunião Online - Juma - Lucas + link do Meet');
    expect(c.pessoas).toEqual(['Lucas']);
    expect(c.acoes[0]).toMatchObject({ tipo: 'aplicar_titulo', pedido: null, rota: { metodo: 'POST', caminho: '/agenda/padronizar/c-cultural' } });
    expect(c.acoes[1]).toMatchObject({ tipo: 'nao_e_reuniao', rota: { caminho: '/pendencias/pend-1/responder', corpo: { escolha: 'nao-e-reuniao' } } });
    expect(doTipo(cs, 'sem_meet')).toHaveLength(0);
  });

  it('nada no passado nem depois do horizonte', () => {
    const fora = [ev('old', 'Reunião Online - Velho - Rodrigo', '2026-10-28', '09:00', '10:00', { meet: null }), ev('far', 'Reunião Online - Longe - Rodrigo', '2027-02-01', '09:00', '10:00', { meet: null })];
    expect(montarConflitos(entrada({ eventos: fora }))).toEqual([]);
  });
});

describe('o relatório (parte pura)', () => {
  it('por sócio, por tipo, sem Meet, sem e-mail, marcados assim mesmo e criados direto no Google', () => {
    const forcado = ev('z', 'Reunião Online - Zeta - Rodrigo', '2026-11-04', '09:00', '10:00', {
      criadoPeloOs: true, atualizadoNoGoogle: '2026-11-01T12:00:00.000Z',
      propriedades: { [PROPRIEDADES_DO_OS.criadoPeloOs]: '1', [PROPRIEDADES_DO_OS.forcado]: 'cliente só podia nesse horário', [PROPRIEDADES_DO_OS.pedidoPor]: 'u1' },
    });
    const r = montarRelatorio({ de: '2026-11-01', ate: '2026-11-30', eventos: [...EVENTOS, forcado, { ...EVENTOS[0], id: 'cancelado', status: 'cancelado' }], pessoas: PESSOAS, nomes: new Map([['u1', 'Rodrigo Teste']]) });
    expect(r.porSocio.find((s) => s.socio === 'Rodrigo')).toMatchObject({ total: 4, porTipo: { cliente: 3, interna: 1 } });
    expect(r.porTipo).toMatchObject({ cliente: 7, interna: 1, fora: 1 });
    expect(r.semMeet.map((x) => x.id)).toEqual(['c-cultural']);
    expect(r.responsavelSemEmail).toEqual(['Pedro']);
    expect(r.marcadosAssimMesmo).toEqual([
      { eventoId: 'z', titulo: 'Reunião Online - Zeta - Rodrigo', inicio: forcado.inicio, motivo: 'cliente só podia nesse horário', quem: 'Rodrigo Teste', quando: '2026-11-01T12:00:00.000Z' },
    ]);
    expect(r.criadosDiretoNoGoogle).toBe(EVENTOS.length);
  });
});

/* ------------------------------------------------------------------ o serviço, contra o banco */

const URL = process.env.TEST_DATABASE_URL;
const comBanco = !!URL;
if (comBanco) exigirBancoDescartavel(URL!, 'ESCREVE nele (regras e conferências da agenda)');

describe.skipIf(!comBanco)('o serviço dos conflitos (banco de teste, dublê do espelho)', () => {
  const MARCA = `cf${Date.now().toString(36).slice(-6)}`;
  const CASA = `org-conflitos-${MARCA}`;
  const OUTRA = `org-conflitos-outra-${MARCA}`;
  let prisma: PrismaClient;
  let svc: ConflitosService;
  const espelho = {
    periodo: async (orgId: string): Promise<RespostaDoEspelho> => ({
      eventos: orgId === CASA ? EVENTOS.map(({ propriedades: _p, ...e }) => e) : [],
      sincronia: { ultimaPassagem: null, erro: null, atrasada: false },
      fonte: 'espelho',
    }),
  } as unknown as EspelhoService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    for (const id of [CASA, OUTRA]) await prisma.org.create({ data: { id, name: id, slug: id } });
    const regua = new ReguaService(prisma as unknown as PrismaService, espelho);
    vi.spyOn(regua as unknown as { ehDaCasa: (o: string) => Promise<boolean> }, 'ehDaCasa').mockImplementation(async (o) => o === CASA);
    svc = new ConflitosService(prisma as unknown as PrismaService, regua);
    // O vigia: uma proposta com pendência que oferece "não é reunião".
    const pend = await prisma.pendencia.create({
      data: {
        orgId: CASA, funcao: 'AG-01', tipo: 'agenda.padrao', chave: `agenda:${MARCA}`, titulo: 'qual é o cliente?',
        opcoes: [{ chave: 'c1', rotulo: 'Juma' }, { chave: OPCAO_NAO_E_REUNIAO, rotulo: 'Não é reunião' }],
      },
    });
    await prisma.agendaConferencia.create({
      data: {
        orgId: CASA, eventoId: 'v-call', tituloLido: 'call com cliente novo', assinatura: 'x', inicio: new Date(sp('2026-11-04', '15:00')),
        estado: 'pendencia', problemas: ['o título não está no padrão'], pendenciaId: pend.id,
      },
    });
    await prisma.agendaConferencia.create({
      data: { orgId: CASA, eventoId: 'v-resolvido', tituloLido: 'já resolvido', assinatura: 'y', estado: 'resolvido' },
    });
    await prisma.rotina.create({
      data: { orgId: CASA, slug: SLUG_DA_ROTINA_DO_VIGIA, nome: 'Vigia', tipo: 'agenda.vigia', cron: '*/15 * * * *', tz: 'America/Sao_Paulo', ultimaExecucaoEm: new Date(sp('2026-10-29', '14:15')) },
    });
    // O "confirmado com o cliente" só na coluna do espelho (o evento não trouxe as propriedades).
    await prisma.agendaEvento.create({
      data: {
        orgId: CASA, agenda: 'primary', googleId: 'b-campobom', titulo: 'Reunião Online - Campo Bom - Rodrigo',
        inicio: new Date(sp('2026-11-04', '09:00')), fim: new Date(sp('2026-11-04', '10:00')),
        propriedades: { [PROPRIEDADES_DO_OS.confirmadoComCliente]: '1' },
      },
    });
  });

  afterAll(async () => {
    for (const orgId of [CASA, OUTRA]) {
      await prisma.agendaEvento.deleteMany({ where: { orgId } });
      await prisma.agendaConferencia.deleteMany({ where: { orgId } });
      await prisma.pendencia.deleteMany({ where: { orgId } });
      await prisma.rotina.deleteMany({ where: { orgId } });
      await prisma.agendaRegraPessoa.deleteMany({ where: { orgId } });
      await prisma.agendaRito.deleteMany({ where: { orgId } });
      await prisma.feriado.deleteMany({ where: { orgId } });
      await prisma.agendaRegraTexto.deleteMany({ where: { orgId } });
      await prisma.org.deleteMany({ where: { id: orgId } });
    }
    await prisma.$disconnect();
  });

  it('junta o motor e o vigia, com o selo da última passagem', async () => {
    const r = await svc.conflitos(CASA, { dias: 60 }, AGORA);
    expect(r.vigiaPassouEm).toBe(new Date(sp('2026-10-29', '14:15')).toISOString());
    const padrao = r.cartoes.filter((c) => c.tipo === 'padrao');
    expect(padrao).toHaveLength(1);
    expect(padrao[0].acoes.map((a) => a.tipo)).toEqual(['nao_e_reuniao']);
    expect(r.contagem.tudo).toBe(r.cartoes.length);
    // A semente da casa (rito da quinta) e o Fora do Pedro.
    expect(r.cartoes.some((c) => c.id.startsWith('rito-sem-gente'))).toBe(true);
  });

  it('lê o "confirmado" da coluna do espelho quando o evento não traz', async () => {
    const r = await svc.conflitos(CASA, { dias: 60 }, AGORA);
    expect(r.cartoes.find((c) => c.tipo === 'choque')?.confirmado).toBe(true);
  });

  it('filtra por tipo (a contagem continua de tudo) e por sócio', async () => {
    const r = await svc.conflitos(CASA, { dias: 60, tipo: 'sem_meet' }, AGORA);
    expect(r.cartoes.every((c) => c.tipo === 'sem_meet')).toBe(true);
    expect(r.contagem.tudo).toBeGreaterThan(r.cartoes.length);
    const doPedro = await svc.conflitos(CASA, { dias: 60, socio: 'Pedro' }, AGORA);
    expect(doPedro.cartoes.length).toBeGreaterThan(0);
    expect(doPedro.cartoes.every((c) => c.pessoas.includes('Pedro'))).toBe(true);
  });

  it('isolamento: a outra empresa não vê nada da casa', async () => {
    const r = await svc.conflitos(OUTRA, { dias: 60 }, AGORA);
    expect(r).toEqual({ cartoes: [], vigiaPassouEm: null, contagem: contarConflitos([]) });
    const rel = await svc.relatorios(OUTRA, { de: '2026-11-01', ate: '2026-11-30' }, AGORA);
    expect(rel.porTipo).toEqual({});
    expect(rel.responsavelSemEmail).toEqual([]);
  });

  it('relatório: o período padrão é o mês corrente; os sem e-mail vêm da semente', async () => {
    const rel = await svc.relatorios(CASA, {}, AGORA);
    expect([rel.de, rel.ate]).toEqual(['2026-10-01', '2026-10-31']);
    const nov = await svc.relatorios(CASA, { de: '2026-11-01', ate: '2026-11-30' }, AGORA);
    // A Equipe desta empresa de teste não tem usuário: os três sem e-mail.
    expect(nov.responsavelSemEmail).toEqual(['Rodrigo', 'Lucas', 'Pedro']);
    expect(nov.semMeet.map((x) => x.id)).toEqual(['c-cultural']);
  });
});
