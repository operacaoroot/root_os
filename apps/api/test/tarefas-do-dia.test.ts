import { describe, expect, it } from 'vitest';
import { RecorrenciaSchema, descreverRecorrencia, equipeDasContas, mesmaTarefa, proximaOcorrencia, naoPareceTarefa, serieTerminou, situacaoDoPrazo, tituloNormalizado } from '@mktos/shared';

describe('tarefas do dia — o que é a mesma tarefa', () => {
  it('título igual com caixa, acento e pontuação diferentes é a MESMA tarefa', () => {
    expect(tituloNormalizado('  Proposta Juma — fazer FUP ')).toBe(tituloNormalizado('proposta juma fazer fup'));
    expect(mesmaTarefa('Fechamento financeiro - ROOT', 'fechamento financeiro root')).toBe('igual');
  });
  it('a maior parte das palavras em comum é PARECIDA (avisa, não recusa)', () => {
    expect(mesmaTarefa('Fazer FUP da proposta Juma', 'Proposta Juma — fazer FUP')).toBe('igual');
    expect(mesmaTarefa('Montar repositório de skills', 'Criar repositório de skills e system prompts')).toBe('parecida');
  });
  it('assuntos diferentes seguem', () => {
    expect(mesmaTarefa('Ligar para o contador', 'Proposta Campo Bom')).toBe('diferente');
    expect(mesmaTarefa('Instalar filtro de linha', 'Ajeitar e limpar sala')).toBe('diferente');
  });
});

describe('tarefas do dia — o que não é tarefa', () => {
  it('empresa | pessoa sem verbo é lead; com verbo é tarefa', () => {
    expect(naoPareceTarefa('MaisQ | Danilo Lourenço')?.tipo).toBe('lead');
    expect(naoPareceTarefa('Juma | Tarcilla — fazer FUP')).toBeNull();
    expect(naoPareceTarefa('Registro de marca | Root')?.tipo).toBe('lead');
  });
  it('peça de conteúdo é post', () => {
    expect(naoPareceTarefa('[ROOT-084] Viu uma ideia no vídeo')?.tipo).toBe('post');
    expect(naoPareceTarefa('Post 187 - Vou fazer 30 anos')?.tipo).toBe('post');
    expect(naoPareceTarefa('Fazer post 1')).toBeNull();
  });
});

describe('tarefas do dia — a régua do prazo', () => {
  const hoje = '2026-10-19'; // segunda
  it('separa atrasada, hoje, próximos 7 dias, mais tarde e sem prazo', () => {
    expect(situacaoDoPrazo('2026-10-16', hoje, false)).toBe('atrasada');
    expect(situacaoDoPrazo('2026-10-19', hoje, false)).toBe('hoje');
    for (const d of ['20', '21', '22', '23', '24', '25', '26']) expect(situacaoDoPrazo(`2026-10-${d}`, hoje, false)).toBe('proximos_7');
    expect(situacaoDoPrazo('2026-10-27', hoje, false)).toBe('mais_tarde');
    expect(situacaoDoPrazo('2027-03-01', hoje, false)).toBe('mais_tarde');
    expect(situacaoDoPrazo(null, hoje, false)).toBe('sem_prazo');
  });
  it('a janela de 7 dias é móvel e atravessa o mês', () => {
    expect(situacaoDoPrazo('2026-11-04', '2026-10-28', false)).toBe('proximos_7');
    expect(situacaoDoPrazo('2026-11-05', '2026-10-28', false)).toBe('mais_tarde');
  });
  it('feita vence o prazo vencido', () => {
    expect(situacaoDoPrazo('2026-10-01', hoje, true)).toBe('feita');
  });
});

describe('tarefas do dia — quem é da equipe', () => {
  const empresa = { nome: 'Marketing OS (root)', slug: 'root' };
  it('a mesma pessoa com duas contas aparece uma vez, na que entrou por último', () => {
    const { pessoas, canonica } = equipeDasContas([
      { id: 'pedro-fullbpo', nome: 'Pedro Magnago', ultimoAcesso: '2026-10-14T10:00:00Z' },
      { id: 'pedro-gmail', nome: 'Pedro Magnago', ultimoAcesso: '2026-10-15T10:00:00Z' },
      { id: 'lucas', nome: 'Lucas Fernandes', ultimoAcesso: '2026-10-19T10:00:00Z' },
    ], empresa);
    expect(pessoas).toEqual([{ id: 'lucas', nome: 'Lucas Fernandes' }, { id: 'pedro-gmail', nome: 'Pedro Magnago' }]);
    expect(canonica.get('pedro-fullbpo')).toBe('pedro-gmail');
  });
  it('a conta com o nome da empresa não é gente', () => {
    const { pessoas, canonica } = equipeDasContas([{ id: 'r', nome: 'Root', ultimoAcesso: null }], empresa);
    expect(pessoas).toEqual([]);
    expect(canonica.has('r')).toBe(false);
  });
});

describe('tarefas que se repetem — o próximo prazo', () => {
  const hoje = '2026-10-19'; // segunda
  it('todo dia e a cada N dias contam a partir do prazo (ou de hoje, se o prazo passou)', () => {
    expect(proximaOcorrencia({ tipo: 'diaria' }, '2026-10-22', hoje)).toBe('2026-10-23');
    expect(proximaOcorrencia({ tipo: 'diaria' }, '2026-10-10', hoje)).toBe('2026-10-20');
    expect(proximaOcorrencia({ tipo: 'intervalo', dias: 3 }, null, hoje)).toBe('2026-10-22');
  });
  it('toda semana vai para o próximo dia marcado', () => {
    expect(proximaOcorrencia({ tipo: 'semanal', dias: [1, 3] }, '2026-10-19', hoje)).toBe('2026-10-21');
    expect(proximaOcorrencia({ tipo: 'semanal', dias: [1] }, '2026-10-19', hoje)).toBe('2026-10-26');
    expect(proximaOcorrencia({ tipo: 'semanal', dias: [1, 2, 3, 4, 5] }, '2026-10-23', hoje)).toBe('2026-10-26');
  });
  it('todo mês cai no dia escolhido, e no último dia quando o mês é curto', () => {
    expect(proximaOcorrencia({ tipo: 'mensal', dia: 5 }, '2026-10-05', '2026-10-05')).toBe('2026-11-05');
    expect(proximaOcorrencia({ tipo: 'mensal', dia: 25 }, '2026-10-19', hoje)).toBe('2026-10-25');
    expect(proximaOcorrencia({ tipo: 'mensal', dia: 31 }, '2027-01-31', '2027-01-31')).toBe('2027-02-28');
    expect(proximaOcorrencia({ tipo: 'mensal', dia: 10 }, '2026-12-10', '2026-12-10')).toBe('2027-01-10');
  });
  it('o nome da regra é o que a tela mostra', () => {
    expect(descreverRecorrencia({ tipo: 'semanal', dias: [5, 1, 2, 3, 4] })).toBe('Dias úteis');
    expect(descreverRecorrencia({ tipo: 'semanal', dias: [1, 4] })).toBe('Toda semana: segunda, quinta');
    expect(descreverRecorrencia({ tipo: 'mensal', dia: 5 })).toBe('Todo mês, dia 5');
  });
});

/* Layout 26/10 (P-18): o "Personalizar" — a cada N semanas/meses e o fim da série. */
describe('tarefas que se repetem — personalizar', () => {
  const hoje = '2026-10-19'; // segunda
  it('regra gravada antes (sem os campos novos) continua valendo igual', () => {
    for (const antiga of [{ tipo: 'diaria' }, { tipo: 'semanal', dias: [1, 3] }, { tipo: 'mensal', dia: 5 }, { tipo: 'intervalo', dias: 3 }]) {
      const lida = RecorrenciaSchema.parse(antiga);
      expect(lida).toEqual(antiga);
      expect(serieTerminou(lida, '2099-12-31')).toBe(false);
    }
    // intervalo 1 é o mesmo que não ter intervalo
    expect(proximaOcorrencia({ tipo: 'semanal', dias: [1], intervalo: 1 }, '2026-10-19', hoje)).toBe('2026-10-26');
    expect(proximaOcorrencia({ tipo: 'mensal', dia: 5, intervalo: 1 }, '2026-10-05', '2026-10-05')).toBe('2026-11-05');
  });
  it('a cada N semanas: os dias que faltam na semana; depois, N semanas à frente', () => {
    // segunda e quarta, a cada 2 semanas: da segunda vai para a quarta da mesma semana
    expect(proximaOcorrencia({ tipo: 'semanal', dias: [1, 3], intervalo: 2 }, '2026-10-19', hoje)).toBe('2026-10-21');
    // da quarta (último dia marcado) pula para a segunda de duas semanas depois
    expect(proximaOcorrencia({ tipo: 'semanal', dias: [3, 1], intervalo: 2 }, '2026-10-21', hoje)).toBe('2026-11-02');
    // só segunda, a cada 3 semanas
    expect(proximaOcorrencia({ tipo: 'semanal', dias: [1], intervalo: 3 }, '2026-10-19', hoje)).toBe('2026-11-09');
    // domingo, a cada 2 semanas, a partir de um sábado (a semana vai de domingo a sábado: o domingo dela foi 18/10)
    expect(proximaOcorrencia({ tipo: 'semanal', dias: [0], intervalo: 2 }, '2026-10-24', hoje)).toBe('2026-11-01');
  });
  it('a cada N meses: o dia escolhido N meses depois, virando o ano e no mês curto', () => {
    expect(proximaOcorrencia({ tipo: 'mensal', dia: 5, intervalo: 3 }, '2026-10-05', '2026-10-05')).toBe('2027-01-05');
    expect(proximaOcorrencia({ tipo: 'mensal', dia: 10, intervalo: 2 }, '2026-12-10', '2026-12-10')).toBe('2027-02-10');
    expect(proximaOcorrencia({ tipo: 'mensal', dia: 31, intervalo: 1 }, '2027-01-31', '2027-01-31')).toBe('2027-02-28');
    expect(proximaOcorrencia({ tipo: 'mensal', dia: 31, intervalo: 2 }, '2026-12-31', '2026-12-31')).toBe('2027-02-28');
    expect(proximaOcorrencia({ tipo: 'mensal', dia: 1, intervalo: 12 }, '2026-10-01', '2026-10-01')).toBe('2027-10-01');
    // o dia ainda não chegou neste mês: fica neste mês
    expect(proximaOcorrencia({ tipo: 'mensal', dia: 25, intervalo: 2 }, '2026-10-19', hoje)).toBe('2026-10-25');
  });
  it('o fim da série: a próxima depois do último dia não nasce', () => {
    const r = RecorrenciaSchema.parse({ tipo: 'intervalo', dias: 7, ate: '2026-10-31' });
    expect(serieTerminou(r, proximaOcorrencia(r, '2026-10-20', hoje))).toBe(false); // 27/10
    expect(serieTerminou(r, proximaOcorrencia(r, '2026-10-27', hoje))).toBe(true); // 03/11
    expect(serieTerminou(r, '2026-10-31')).toBe(false); // o próprio último dia ainda vale
    expect(RecorrenciaSchema.safeParse({ tipo: 'diaria', ate: '31/10/2026' }).success).toBe(false);
    expect(RecorrenciaSchema.safeParse({ tipo: 'semanal', dias: [1], intervalo: 0 }).success).toBe(false);
  });
  it('o nome da regra diz o intervalo e o fim', () => {
    expect(descreverRecorrencia({ tipo: 'semanal', dias: [3, 1], intervalo: 2 })).toBe('A cada 2 semanas: segunda, quarta');
    expect(descreverRecorrencia({ tipo: 'mensal', dia: 5, intervalo: 3 })).toBe('A cada 3 meses, dia 5');
    expect(descreverRecorrencia({ tipo: 'intervalo', dias: 10, ate: '2026-12-31' })).toBe('A cada 10 dias, até 31/12/2026');
    expect(descreverRecorrencia({ tipo: 'semanal', dias: [1, 2, 3, 4, 5], ate: '2027-01-15' })).toBe('Dias úteis, até 15/01/2027');
  });
});
