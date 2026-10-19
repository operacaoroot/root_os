import { describe, expect, it } from 'vitest';
import { mesmaTarefa, naoPareceTarefa, situacaoDoPrazo, tituloNormalizado } from '@mktos/shared';

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
  it('separa atrasada, hoje, até domingo, depois e sem prazo', () => {
    expect(situacaoDoPrazo('2026-10-16', hoje, false)).toBe('atrasada');
    expect(situacaoDoPrazo('2026-10-19', hoje, false)).toBe('hoje');
    expect(situacaoDoPrazo('2026-10-25', hoje, false)).toBe('semana');
    expect(situacaoDoPrazo('2026-10-26', hoje, false)).toBe('depois');
    expect(situacaoDoPrazo(null, hoje, false)).toBe('sem_prazo');
  });
  it('feita vence o prazo vencido', () => {
    expect(situacaoDoPrazo('2026-10-01', hoje, true)).toBe('feita');
  });
  it('no domingo, "até domingo" é só o próprio dia', () => {
    expect(situacaoDoPrazo('2026-10-26', '2026-10-25', false)).toBe('depois');
  });
});
