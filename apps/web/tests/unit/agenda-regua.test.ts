import { describe, expect, it } from 'vitest';
import {
  avaliarNaRegua,
  feriadosDoAno,
  horariosLivres,
  lerCompromisso,
  proximoDiaUtil,
  ritosDoDia,
  sugerirHorarios,
  type CompromissoProposto,
  type EventoDaAgenda,
  type FeriadoDaAgenda,
  type RegraDaPessoa,
  type RegrasDaAgenda,
  type RitoDaAgenda,
} from '@mktos/shared';

/*
 * A RÉGUA DA AGENDA (agenda v2, 29/10/2026, lane G2): o motor puro, regra por
 * regra e nas combinações. Tudo no fuso de São Paulo (UTC-3, sem horário de
 * verão). Novembro de 2026: seg 02/11 é Finados, qua 04/11, qui 05/11, o
 * primeiro sábado é 07/11. Dados fictícios.
 */

const rodrigo: RegraDaPessoa = {
  id: 'r-rodrigo', nome: 'Rodrigo', area: 'onboarding e contrato', email: 'rodrigo@casa.teste',
  janela: { inicio: '08:00', fim: '19:00' }, intervaloMin: 15, trajetoMin: 30, tetoPorDia: 5,
  bloqueiosFixos: [{ diaDaSemana: 4, inicio: '19:00', fim: null }],
  emailPessoal: 'rodrigo.pessoal@pessoal.teste', fechadoLigado: true, substituto: 'Lucas',
};
const lucas: RegraDaPessoa = {
  id: 'r-lucas', nome: 'Lucas', area: 'marca e marketing', email: 'lucas@casa.teste',
  janela: { inicio: '09:00', fim: '18:00' }, intervaloMin: 15, trajetoMin: 30, tetoPorDia: 4,
  bloqueiosFixos: [], emailPessoal: 'lucas.pessoal@pessoal.teste', fechadoLigado: false, substituto: 'Rodrigo',
};
const pedro: RegraDaPessoa = {
  id: 'r-pedro', nome: 'Pedro', area: 'FinOps', email: null,
  janela: { inicio: '08:30', fim: '18:00' }, intervaloMin: 10, trajetoMin: 30, tetoPorDia: 5,
  bloqueiosFixos: [], emailPessoal: null, fechadoLigado: false, substituto: 'Rodrigo',
};

const rito = (over: Partial<RitoDaAgenda>): RitoDaAgenda => ({
  id: 'rito', nome: 'rito', titulo: 'Reunião Interna - Todos', diaDaSemana: 2, ordinalNoMes: null,
  inicio: '08:00', duracaoMin: 60, quem: 'Todos', politica: 'pergunta', ligado: true, aDecidir: false, ...over,
});
const RITOS: RitoDaAgenda[] = [
  rito({ id: 'terca', nome: 'Reunião Interna - Todos (pauta da semana)' }),
  rito({ id: 'quinta', nome: 'Reunião Interna - Todos (estrutura fixa)', diaDaSemana: 4, inicio: '19:30', duracaoMin: 90, politica: 'bloqueia' }),
  rito({ id: 'sabado', nome: 'Sábado da Root', titulo: 'Sábado da Root', diaDaSemana: 6, ordinalNoMes: 1, inicio: null, duracaoMin: 1440, politica: 'bloqueia' }),
];

const FERIADOS: FeriadoDaAgenda[] = [2026, 2027].flatMap((ano) =>
  feriadosDoAno(ano).map((f, i) => ({
    id: `f-${ano}-${i}`, data: f.dia, nome: f.nome,
    tipo: f.nome === 'Carnaval' || f.nome === 'Corpus Christi' ? 'facultativo' : 'nacional',
    cidade: null, ligado: !(f.nome === 'Carnaval' || f.nome === 'Corpus Christi'),
  })) as FeriadoDaAgenda[],
);

const regras = (over: Partial<Pick<RegrasDaAgenda, 'pessoas' | 'ritos' | 'feriados'>> = {}) => ({
  pessoas: [rodrigo, lucas, pedro], ritos: RITOS, feriados: FERIADOS, ...over,
});

const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`).toISOString();

const ev = (id: string, titulo: string | null, dia: string, de: string, ate: string, over: Partial<EventoDaAgenda> = {}): EventoDaAgenda => ({
  id, agenda: 'primary', origem: 'google', titulo, inicio: sp(dia, de), fim: sp(dia, ate), diaInteiro: false,
  local: null, meet: null, convidados: [], organizador: null, organizadorEhAgenda: true, status: 'confirmado',
  atualizadoNoGoogle: null, serieId: null, criadoPeloOs: false, link: null,
  leitura: lerCompromisso(titulo, FERIADOS.map((f) => f.nome)), ...over,
});

const diaInteiro = (id: string, titulo: string, dia: string, ateDia: string, over: Partial<EventoDaAgenda> = {}): EventoDaAgenda => ({
  ...ev(id, titulo, dia, '00:00', '00:00'), inicio: dia, fim: ateDia, diaInteiro: true, ...over,
});

const proposta = (dia: string, de: string, ate: string, over: Partial<CompromissoProposto> = {}): CompromissoProposto => ({
  tipo: 'cliente', modalidade: 'online', responsaveis: ['Rodrigo'], inicio: sp(dia, de), fim: sp(dia, ate), ...over,
});

const avaliar = (p: CompromissoProposto, eventos: EventoDaAgenda[] = [], r = regras(), agora?: Date) =>
  avaliarNaRegua({ eventos, regras: r, proposta: p, ...(agora ? { agora } : {}) });

const regrasDe = (res: ReturnType<typeof avaliarNaRegua>, nivel?: string) =>
  res.itens.filter((i) => !nivel || i.nivel === nivel).map((i) => i.regra);

describe('a régua: verde', () => {
  it('agenda vazia, dentro da janela: verde, com "livre" e o Meet da online', () => {
    const r = avaliar(proposta('2026-11-04', '15:00', '16:00'));
    expect(r.cor).toBe('verde');
    expect(r.itens.map((i) => i.frase)).toEqual(['Rodrigo livre das 15:00 às 16:00', 'Meet nasce junto']);
  });

  it('presencial não promete Meet', () => {
    const r = avaliar(proposta('2026-11-04', '15:00', '16:00', { modalidade: 'presencial' }));
    expect(r.cor).toBe('verde');
    expect(regrasDe(r)).toEqual(['livre']);
  });

  it('fim antes do início é recusado', () => {
    expect(avaliar(proposta('2026-11-04', '16:00', '15:00')).cor).toBe('vermelho');
  });
});

describe('janela de trabalho', () => {
  it('Lucas começa às 09:00: 08:00 é atenção', () => {
    const r = avaliar(proposta('2026-11-04', '08:00', '09:00', { responsaveis: ['Lucas'] }));
    expect(r.cor).toBe('amarelo');
    expect(r.itens.find((i) => i.regra === 'janela')?.frase).toBe('Fora da janela de trabalho de Lucas (09:00 às 18:00).');
  });

  it('passar do fim da janela também é atenção', () => {
    expect(avaliar(proposta('2026-11-04', '17:30', '18:30', { responsaveis: ['Pedro'] })).cor).toBe('amarelo');
  });

  it('fim de semana não é dia útil', () => {
    const r = avaliar(proposta('2026-11-14', '10:00', '11:00'));
    expect(r.itens.some((i) => i.regra === 'janela' && i.frase === 'sáb 14/11 não é dia útil.')).toBe(true);
  });

  it('o que já passou é bloqueio', () => {
    const r = avaliar(proposta('2026-11-04', '10:00', '11:00'), [], regras(), new Date(sp('2026-11-04', '12:00')));
    expect(r.cor).toBe('vermelho');
    expect(r.itens[0].frase).toBe('Esse horário já passou.');
  });
});

describe('intervalo mínimo', () => {
  const antes = [ev('a', 'Reunião Online - Promedical - Rodrigo', '2026-11-04', '09:00', '10:00')];

  it('colado na reunião anterior: atenção', () => {
    const r = avaliar(proposta('2026-11-04', '10:05', '11:00'), antes);
    expect(r.cor).toBe('amarelo');
    expect(r.itens.find((i) => i.regra === 'intervalo')?.frase).toBe('Sem os 15 min de intervalo depois de Reunião Online - Promedical - Rodrigo.');
  });

  it('com os 15 min: verde', () => {
    expect(avaliar(proposta('2026-11-04', '10:15', '11:00'), antes).cor).toBe('verde');
  });

  it('vale também antes da reunião seguinte', () => {
    const r = avaliar(proposta('2026-11-04', '08:00', '08:55'), antes);
    expect(r.itens.find((i) => i.regra === 'intervalo')?.frase).toContain('antes de');
  });

  it('cada sócio tem o seu: Pedro pede 10 min', () => {
    const doPedro = [ev('p', 'Reunião Online - Acme - Pedro', '2026-11-04', '09:00', '10:00')];
    expect(avaliar(proposta('2026-11-04', '10:10', '11:00', { responsaveis: ['Pedro'] }), doPedro).cor).toBe('verde');
    expect(avaliar(proposta('2026-11-04', '10:05', '11:00', { responsaveis: ['Pedro'] }), doPedro).cor).toBe('amarelo');
  });
});

describe('trajeto antes de presencial', () => {
  const antes = [ev('a', 'Reunião Online - Promedical - Rodrigo', '2026-11-04', '09:00', '10:00')];

  it('presencial 15 min depois de outra reunião: falta o trajeto', () => {
    const r = avaliar(proposta('2026-11-04', '10:15', '11:00', { modalidade: 'presencial' }), antes);
    expect(r.cor).toBe('amarelo');
    expect(regrasDe(r, 'atencao')).toEqual(['trajeto']);
    expect(r.itens.find((i) => i.regra === 'trajeto')?.frase).toBe(
      'Falta o trajeto de 30 min antes da presencial (depois de Reunião Online - Promedical - Rodrigo).',
    );
  });

  it('com 30 min: verde', () => {
    expect(avaliar(proposta('2026-11-04', '10:30', '11:00', { modalidade: 'presencial' }), antes).cor).toBe('verde');
  });

  it('online colada ANTES de uma presencial também tira o trajeto dela', () => {
    const depois = [ev('b', 'Reunião Presencial - Custeio - Rodrigo', '2026-11-04', '11:00', '12:00')];
    const r = avaliar(proposta('2026-11-04', '10:00', '10:45'), depois);
    expect(r.itens.find((i) => i.regra === 'trajeto')?.frase).toBe(
      'Falta o trajeto de 30 min antes de Reunião Presencial - Custeio - Rodrigo (presencial).',
    );
  });
});

describe('teto de reuniões no dia', () => {
  const tres = ['08:00', '10:00', '12:00'].map((h, i) =>
    ev(`t${i}`, `Reunião Online - Cliente ${i} - Rodrigo`, '2026-11-04', h, `${String(Number(h.slice(0, 2)) + 1).padStart(2, '0')}:00`),
  );

  it('a 4ª do Rodrigo (limite 5) é atenção, como no desenho', () => {
    const r = avaliar(proposta('2026-11-04', '15:00', '16:00'), tres);
    expect(r.cor).toBe('amarelo');
    expect(r.itens.map((i) => i.frase)).toContain('4ª reunião do Rodrigo no dia (limite 5)');
    expect(r.itens.map((i) => i.frase)).toContain('Rodrigo livre das 15:00 às 16:00');
  });

  it('a 3ª ainda é verde', () => {
    expect(avaliar(proposta('2026-11-04', '15:00', '16:00'), tres.slice(0, 2)).cor).toBe('verde');
  });

  it('passar do teto é bloqueio', () => {
    const cinco = [...tres, ev('t3', 'Reunião Interna - Rodrigo', '2026-11-04', '14:00', '14:30'), ev('t4', 'Reunião Online - X - Rodrigo', '2026-11-04', '17:00', '17:30')];
    const r = avaliar(proposta('2026-11-04', '15:00', '16:00'), cinco);
    expect(r.cor).toBe('vermelho');
    expect(r.itens.find((i) => i.regra === 'teto')?.frase).toBe('6ª reunião do Rodrigo no dia (limite 5)');
  });

  it('bloqueio e pessoal não contam como reunião', () => {
    const r = avaliar(proposta('2026-11-04', '15:00', '16:00'), [ev('f', 'Fechado Rodrigo', '2026-11-04', '08:00', '09:00'), ev('p', 'Pessoal - Rodrigo', '2026-11-04', '10:00', '11:00')]);
    expect(r.cor).toBe('verde');
  });
});

describe('bloqueio fixo', () => {
  it('quinta a partir de 19:00 fecha o Rodrigo', () => {
    const r = avaliar(proposta('2026-11-05', '18:30', '19:15'));
    expect(r.cor).toBe('vermelho');
    expect(r.itens.find((i) => i.regra === 'bloqueio_fixo')?.frase).toBe('Rodrigo tem bloqueio fixo qui a partir de 19:00.');
  });

  it('outro dia da semana, no mesmo horário, não', () => {
    expect(regrasDe(avaliar(proposta('2026-11-04', '18:30', '19:15')))).not.toContain('bloqueio_fixo');
  });
});

describe('Fechado', () => {
  const pessoal = ev('fb-1', null, '2026-11-04', '14:00', '15:00', {
    origem: 'livre_ocupado', agenda: 'rodrigo.pessoal@pessoal.teste', organizadorEhAgenda: false,
    leitura: { tipo: 'fechado', modalidade: null, cliente: null, responsaveis: ['Rodrigo'], motivo: null, feriado: null },
  });

  it('a agenda pessoal ocupada conta como ocupado', () => {
    const r = avaliar(proposta('2026-11-04', '14:30', '15:30'), [pessoal]);
    expect(r.cor).toBe('vermelho');
    expect(r.itens[0].frase).toBe('Rodrigo está Fechado das 14:00 às 15:00 (agenda pessoal).');
  });

  it('o Fechado da agenda pessoal só conta com "agenda pessoal como Fechado" ligada', () => {
    const desligado = { ...rodrigo, fechadoLigado: false };
    expect(avaliar(proposta('2026-11-04', '14:30', '15:30'), [pessoal], regras({ pessoas: [desligado, lucas, pedro] })).cor).toBe('verde');
  });

  it('o "Fechado Rodrigo" escrito na agenda da casa também conta', () => {
    const r = avaliar(proposta('2026-11-04', '14:30', '15:30'), [ev('f', 'Fechado Rodrigo', '2026-11-04', '14:00', '15:00')]);
    expect(regrasDe(r, 'bloqueio')).toEqual(['fechado']);
  });

  it('Fechado contra Fechado não é choque', () => {
    const r = avaliar(proposta('2026-11-04', '14:30', '15:30', { tipo: 'bloqueio', modalidade: null }), [pessoal]);
    expect(r.cor).toBe('verde');
  });

  it('pessoal contra Fechado também não', () => {
    expect(avaliar(proposta('2026-11-04', '14:30', '15:30', { tipo: 'pessoal', modalidade: null }), [pessoal]).cor).toBe('verde');
  });
});

describe('Fora', () => {
  const fora = diaInteiro('fora', 'Pedro Fora - viagem', '2026-11-05', '2026-11-06');

  it('fecha a agenda do dia da pessoa, com o motivo e o substituto', () => {
    const r = avaliar(proposta('2026-11-05', '10:00', '11:00', { responsaveis: ['Pedro'] }), [fora]);
    expect(r.cor).toBe('vermelho');
    expect(r.itens[0].frase).toBe('Pedro está Fora nesse dia (viagem). Substituto: Rodrigo.');
  });

  it('Fora parcial também fecha o dia', () => {
    const parcial = ev('fp', 'Pedro Fora - médico', '2026-11-05', '14:00', '16:00');
    expect(avaliar(proposta('2026-11-05', '09:00', '10:00', { responsaveis: ['Pedro'] }), [parcial]).cor).toBe('vermelho');
  });

  it('no dia seguinte, livre', () => {
    expect(avaliar(proposta('2026-11-06', '10:00', '11:00', { responsaveis: ['Pedro'] }), [fora]).cor).toBe('verde');
  });

  it('não fecha a agenda de outro sócio', () => {
    expect(avaliar(proposta('2026-11-05', '10:00', '11:00', { responsaveis: ['Lucas'] }), [fora]).cor).toBe('verde');
  });

  it('marcar Fora em dia com reunião avisa', () => {
    const reuniao = ev('r', 'Reunião Online - Acme - Pedro', '2026-11-05', '10:00', '11:00');
    const r = avaliar({ tipo: 'fora', responsaveis: ['Pedro'], inicio: '2026-11-05T03:00:00.000Z', fim: '2026-11-06T03:00:00.000Z' }, [reuniao]);
    expect(r.cor).toBe('amarelo');
    expect(r.itens.find((i) => i.regra === 'fora')?.frase).toBe('Pedro tem 1 reunião nesse período.');
  });
});

describe('feriados', () => {
  it('nacional fecha a agenda', () => {
    const r = avaliar(proposta('2026-11-02', '10:00', '11:00'));
    expect(r.cor).toBe('vermelho');
    expect(r.itens[0].frase).toBe('Feriado: Finados (seg 02/11). Agenda fechada.');
  });

  it('facultativo nasce desligado e não pesa', () => {
    expect(avaliar(proposta('2027-02-08', '10:00', '11:00')).cor).toBe('verde');
  });

  it('facultativo ligado só avisa', () => {
    const ligado = FERIADOS.map((f) => (f.nome === 'Carnaval' ? { ...f, ligado: true } : f));
    const r = avaliar(proposta('2027-02-08', '10:00', '11:00'), [], regras({ feriados: ligado }));
    expect(r.cor).toBe('amarelo');
    expect(regrasDe(r, 'atencao')).toEqual(['feriado_facultativo']);
  });

  it('municipal cadastrado fecha, com a cidade; desligado não', () => {
    const jf: FeriadoDaAgenda = { id: 'm', data: '2026-11-04', nome: 'Aniversário da cidade', tipo: 'municipal', cidade: 'Juiz de Fora', ligado: true };
    const r = avaliar(proposta('2026-11-04', '10:00', '11:00'), [], regras({ feriados: [...FERIADOS, jf] }));
    expect(r.cor).toBe('vermelho');
    expect(r.itens[0].frase).toBe('Feriado em Juiz de Fora: Aniversário da cidade (qua 04/11). Agenda fechada.');
    expect(avaliar(proposta('2026-11-04', '10:00', '11:00'), [], regras({ feriados: [...FERIADOS, { ...jf, ligado: false }] })).cor).toBe('verde');
  });

  it('bloqueio e Fora no feriado não pedem nada', () => {
    expect(avaliar(proposta('2026-11-02', '10:00', '11:00', { tipo: 'bloqueio', modalidade: null })).cor).toBe('verde');
  });
});

describe('ritos protegidos', () => {
  it('em cima da terça (pergunta) é atenção, para cada um dos três', () => {
    for (const s of ['Rodrigo', 'Lucas', 'Pedro'] as const) {
      const r = avaliar(proposta('2026-11-03', '08:30', '09:30', { responsaveis: [s] }));
      expect(r.cor).toBe('amarelo');
      expect(r.itens.find((i) => i.regra === 'rito')?.frase).toBe('Em cima do rito: Reunião Interna - Todos (pauta da semana) (ter 03/11 08:00).');
    }
  });

  it('em cima da quinta (bloqueia) é bloqueio', () => {
    const r = avaliar(proposta('2026-11-05', '19:30', '20:00', { responsaveis: ['Lucas'] }));
    expect(r.cor).toBe('vermelho');
    expect(regrasDe(r, 'bloqueio')).toEqual(['rito']);
  });

  it('o primeiro sábado bloqueia o dia inteiro; o segundo, não', () => {
    expect(regrasDe(avaliar(proposta('2026-11-07', '15:00', '16:00')), 'bloqueio')).toContain('rito');
    expect(regrasDe(avaliar(proposta('2026-11-14', '15:00', '16:00')))).not.toContain('rito');
  });

  it('rito desligado não pesa', () => {
    const r = avaliar(proposta('2026-11-03', '08:30', '09:30'), [], regras({ ritos: RITOS.map((x) => ({ ...x, ligado: false })) }));
    expect(r.cor).toBe('verde');
  });

  it('o evento do próprio rito na agenda não vira choque em dobro', () => {
    const evento = ev('rt', 'Reunião Interna - Todos', '2026-11-03', '08:00', '09:00');
    const r = avaliar(proposta('2026-11-03', '08:30', '09:30'), [evento]);
    expect(regrasDe(r)).not.toContain('choque');
    expect(r.cor).toBe('amarelo');
  });

  it('marcar o próprio rito no horário dele não acusa o rito', () => {
    const r = avaliar(proposta('2026-11-03', '08:00', '09:00', { tipo: 'interna', responsaveis: ['Rodrigo', 'Lucas', 'Pedro'] }));
    expect(regrasDe(r)).not.toContain('rito');
  });

  it('ritosDoDia respeita o ordinal no mês', () => {
    expect(ritosDoDia('2026-11-07', RITOS).map((o) => o.rito.id)).toEqual(['sabado']);
    expect(ritosDoDia('2026-11-14', RITOS)).toEqual([]);
  });
});

describe('a mesma pessoa em dois lugares', () => {
  const promedical = ev('pm', 'Reunião Online - Promedical - Rodrigo', '2026-11-04', '09:00', '10:00');

  it('choque é bloqueio', () => {
    const r = avaliar(proposta('2026-11-04', '09:30', '10:30'), [promedical]);
    expect(r.cor).toBe('vermelho');
    expect(r.itens[0]).toMatchObject({
      nivel: 'bloqueio', regra: 'choque', pessoa: 'Rodrigo', eventoId: 'pm',
      frase: 'Rodrigo já tem Reunião Online - Promedical - Rodrigo das 09:00 às 10:00.',
    });
    expect(regrasDe(r)).not.toContain('livre');
  });

  it('o próprio evento fica fora da conta (editar, arrastar, esticar)', () => {
    expect(avaliar(proposta('2026-11-04', '09:30', '10:30', { ignorarEventoId: 'pm' }), [promedical]).cor).toBe('verde');
  });

  it('cancelado não conta', () => {
    expect(avaliar(proposta('2026-11-04', '09:30', '10:30'), [{ ...promedical, status: 'cancelado' }]).cor).toBe('verde');
  });

  it('outro sócio no mesmo horário não é choque', () => {
    expect(avaliar(proposta('2026-11-04', '09:30', '10:30', { responsaveis: ['Lucas'] }), [promedical]).cor).toBe('verde');
  });

  it('a interna de Todos ocupa os três', () => {
    const todos = ev('it', 'Reunião Interna - Todos', '2026-11-04', '11:00', '12:00');
    expect(avaliar(proposta('2026-11-04', '11:00', '11:30', { responsaveis: ['Pedro'] }), [todos]).cor).toBe('vermelho');
  });

  it('o e-mail do sócio entre os convidados também ocupa; recusado, não', () => {
    const convite = ev('cv', 'call com fornecedor', '2026-11-04', '16:00', '17:00', {
      convidados: [{ email: 'lucas@casa.teste', resposta: 'aceito' }],
    });
    expect(avaliar(proposta('2026-11-04', '16:00', '16:30', { responsaveis: ['Lucas'] }), [convite]).cor).toBe('vermelho');
    const recusou = { ...convite, convidados: [{ email: 'lucas@casa.teste', resposta: 'recusado' as const }] };
    expect(avaliar(proposta('2026-11-04', '16:00', '16:30', { responsaveis: ['Lucas'] }), [recusou]).cor).toBe('verde');
  });

  it('dois sócios: um livre e outro em choque, o livre aparece', () => {
    const r = avaliar(proposta('2026-11-04', '09:30', '10:30', { responsaveis: ['Rodrigo', 'Lucas'] }), [promedical]);
    expect(r.cor).toBe('vermelho');
    expect(r.itens.find((i) => i.regra === 'livre')?.frase).toBe('Lucas livre das 09:30 às 10:30');
  });
});

describe('combinações', () => {
  it('bloqueio vence atenção: vermelho, com os dois itens, bloqueio primeiro', () => {
    const r = avaliar(proposta('2026-11-03', '08:30', '09:30'), [ev('x', 'Reunião Online - Acme - Rodrigo', '2026-11-03', '09:00', '10:00')]);
    expect(r.cor).toBe('vermelho');
    expect(r.itens.map((i) => i.nivel)).toEqual(['bloqueio', 'atencao', 'ok']);
  });

  it('feriado nacional em cima do rito: vermelho pelo feriado', () => {
    const r = avaliar(proposta('2026-11-02', '08:00', '09:00', { responsaveis: ['Lucas'] }));
    expect(r.cor).toBe('vermelho');
    expect(regrasDe(r)).toContain('feriado');
  });

  it('presencial fora da janela e sem trajeto: duas atenções, amarelo', () => {
    const r = avaliar(
      proposta('2026-11-04', '18:15', '19:15', { modalidade: 'presencial', responsaveis: ['Lucas'] }),
      [ev('a', 'Reunião Online - Acme - Lucas', '2026-11-04', '17:00', '18:00')],
    );
    expect(r.cor).toBe('amarelo');
    expect(regrasDe(r, 'atencao').sort()).toEqual(['janela', 'trajeto']);
  });
});

describe('sugerirHorarios', () => {
  const eventos = [ev('a', 'Reunião Online - Acme - Rodrigo', '2026-11-04', '09:00', '10:00')];

  it('devolve os próximos verdes, em ordem, respeitando o intervalo', () => {
    const s = sugerirHorarios({
      eventos, regras: regras(),
      base: { tipo: 'cliente', modalidade: 'online', responsaveis: ['Rodrigo'], duracaoMin: 60 },
      aPartirDe: new Date(sp('2026-11-04', '09:00')),
    });
    expect(s.map((h) => h.inicio)).toEqual([sp('2026-11-04', '10:30'), sp('2026-11-04', '11:00'), sp('2026-11-04', '11:30')]);
  });

  it('pula o feriado e o fim de semana', () => {
    const s = sugerirHorarios({
      eventos: [], regras: regras(), limite: 1,
      base: { tipo: 'cliente', modalidade: 'online', responsaveis: ['Rodrigo'], duracaoMin: 60 },
      aPartirDe: new Date(sp('2026-10-31', '10:00')),
    });
    // sáb 31/10, dom 01/11, Finados seg 02/11; ter 03/11 08:00 cai no rito da terça.
    expect(s).toEqual([{ inicio: sp('2026-11-03', '09:00'), fim: sp('2026-11-03', '10:00') }]);
  });

  it('o próprio evento fica fora da conta ao empurrar', () => {
    const s = sugerirHorarios({
      eventos, regras: regras(), limite: 1,
      base: { tipo: 'cliente', modalidade: 'online', responsaveis: ['Rodrigo'], duracaoMin: 60, ignorarEventoId: 'a' },
      aPartirDe: new Date(sp('2026-11-04', '09:00')),
    });
    expect(s[0].inicio).toBe(sp('2026-11-04', '09:00'));
  });

  it('proximoDiaUtil pula fim de semana e feriado', () => {
    expect(proximoDiaUtil('2026-10-30', FERIADOS)).toBe('2026-11-03');
  });
});

describe('horariosLivres (o link público)', () => {
  const eventos = [ev('a', 'Reunião Online - Segredo do Cliente - Lucas', '2026-11-04', '10:00', '11:00')];
  const livres = (over: Partial<Parameters<typeof horariosLivres>[0]> = {}) =>
    horariosLivres({
      eventos, regras: regras(), socio: 'Lucas', tipo: 'cliente', modalidade: 'online', duracaoMin: 60,
      de: '2026-11-04', ate: '2026-11-09', agora: new Date(sp('2026-11-04', '08:00')), ...over,
    });

  it('só dias úteis, manhã antes das 12:00 e tarde, só verdes', () => {
    const d = livres();
    expect(d.map((x) => x.dia)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09']);
    expect(d[0].manha).toEqual(['11:30']);
    expect(d[0].tarde[0]).toBe('12:00');
    expect(d[0].tarde.at(-1)).toBe('17:00');
  });

  it('nunca devolve título nem quem', () => {
    const texto = JSON.stringify(livres());
    expect(texto).not.toContain('Segredo');
    expect(texto).not.toContain('Lucas');
    expect(Object.keys(livres()[0]).sort()).toEqual(['dia', 'manha', 'tarde']);
  });

  it('só depois de agora', () => {
    const d = livres({ agora: new Date(sp('2026-11-04', '15:10')) });
    expect(d[0].manha).toEqual([]);
    expect(d[0].tarde[0]).toBe('15:30');
  });

  it('dia de feriado não aparece', () => {
    expect(livres({ de: '2026-11-02', ate: '2026-11-02', agora: new Date(sp('2026-11-01', '08:00')) })).toEqual([]);
  });

  it('intervalo invertido devolve nada', () => {
    expect(livres({ de: '2026-11-09', ate: '2026-11-04' })).toEqual([]);
  });
});
