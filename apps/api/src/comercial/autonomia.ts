import { COMERCIAL_AUTOMACOES, type ComercialAutomacao, type ComercialAutonomia } from '@mktos/shared';

/*
 * A ESCADA DE AUTONOMIA DO COMERCIAL (lane E, fase 2, 13/10/2026) — a parte pura.
 *
 * A escada (mapa, M4) tem quatro degraus por automação:
 *   A0 manual · A1 observa e relata · A2 prepara e a pessoa aprova · A3 executa e a pessoa audita.
 * E um TETO que não muda para ninguém: R3 sai com aprovação, R4 com a titular,
 * R5 nunca. Quem impõe o teto é a porta (`PortaDoOperador`) com a régua do banco.
 *
 * O QUE O NÍVEL FAZ AQUI, E SÓ ISTO
 *
 *   · A0: a automação NÃO RODA. A reação ao fato ou a tarefa do relógio é pulada
 *     e o pulo fica registrado (a linha da reação em `ComercialReacao` com
 *     `resultado.pulada`, o resumo da passagem do relógio). Quem faz é a pessoa,
 *     pelo sistema (as rotas de gente continuam valendo).
 *   · A1, A2 e A3: a automação roda como hoje. O nível acima do vigente NÃO
 *     tira toque nenhum: o que a porta retém continua retido, porque a escada
 *     usa a régua e nunca a substitui. Autonomia só SEGURA.
 *
 * O PADRÃO É A REGRA VIGENTE (`AUTONOMIA_VIGENTE`): o degrau que cada automação
 * já ocupa pelo que a régua lhe permite hoje. Empresa sem nível gravado lê o
 * padrão, e o padrão nunca é A0: senão o comercial pararia sozinho.
 */

/**
 * O degrau de hoje de cada automação, lido da régua (mapa, M4):
 *   · qualificador: pontua e dá dono dentro do OS (R1), roda e a pessoa audita → A3;
 *   · agendador, fupeiro: mandam WhatsApp (R3, sempre com aprovação) → A2;
 *   · leitor de ata: o diagnóstico espera o sócio aprovar (portão de E5) → A2;
 *   · construtor de proposta: publicar é R3 → A2;
 *   · revisor de proposta: só lê e aponta (o laudo) → A1;
 *   · assistente da proposta (revisão E-15): só a frase do sistema vai direto
 *     ao cliente; o texto do modelo espera uma pessoa → A2;
 *   · assinador, cobrador, fechador: R4, o teto nunca é autônomo → A2;
 *   · relator e vigia: leem, resumem e avisam → A1.
 */
export const AUTONOMIA_VIGENTE: Readonly<Record<ComercialAutomacao, ComercialAutonomia>> = Object.freeze({
  qualificador: 'A3',
  agendador: 'A2',
  leitor_de_ata: 'A2',
  construtor_de_proposta: 'A2',
  revisor_de_proposta: 'A1',
  assistente_da_proposta: 'A2',
  fupeiro: 'A2',
  assinador: 'A2',
  cobrador: 'A2',
  fechador: 'A2',
  relator: 'A1',
  vigia: 'A1',
});

/**
 * Que automação cada reação e cada tarefa do relógio É. A chave é o NOME da
 * inscrição (`ReacoesRegistry.inscrever`, `RelogioComercialRegistry.inscrever`).
 *
 * Fora desta tabela ficam, de propósito, as engrenagens da espinha que não são
 * automação da torre: a projeção da ficha, a etapa, a decisão que vence, a sala,
 * e a janela de veto (que só devolve à porta). Segurar
 * uma delas não seria segurar automação, seria quebrar o fio. É o caso da
 * pontuação e do dono (`espinha.entrada`, `espinha.qualificacao`): elas também
 * semeiam o relógio e abrem o ponto zero, e não há rota de gente que as refaça.
 * Do qualificador, A0 segura o que sai da casa: a M1.
 *
 * Reação com mais de uma automação roda só se TODAS puderem: o construtor não
 * publica sem o revisor; a proposta do aceite leva cobrança e contrato juntos.
 */
export const AUTOMACOES_DA_TAREFA: Readonly<Record<string, readonly ComercialAutomacao[]>> = Object.freeze({
  // reações aos fatos
  'whats.m1': ['qualificador'],
  'whats.m2': ['agendador'],
  'inteligencia.diagnostico': ['leitor_de_ata'],
  'inteligencia.rascunho': ['construtor_de_proposta', 'revisor_de_proposta'],
  'inteligencia.proposta': ['construtor_de_proposta', 'revisor_de_proposta'],
  'whats.m4': ['construtor_de_proposta'],
  'inteligencia.duvida': ['assistente_da_proposta'],
  'dinheiro.propor': ['cobrador', 'assinador'],
  'fechamento.talvez': ['fechador'],
  'fechamento.m8': ['fechador'],
  // tarefas do relógio
  'whats.vespera': ['agendador'],
  'whats.fup': ['fupeiro'],
  'inteligencia.publicacao-agendada': ['construtor_de_proposta', 'revisor_de_proposta'],
  'dinheiro.regua': ['cobrador'],
  'dinheiro.repropor': ['cobrador', 'assinador', 'fechador'],
  'inteligencia.vigia': ['vigia'],
  'inteligencia.relator': ['relator'],
});

/**
 * O teto de cada automação pela régua (mapa, M4: "A3 nas ações R0 a R2; de R3
 * para cima sempre com gente"). Quem manda WhatsApp (R3) ou mexe em dinheiro e
 * contrato (R4) para em A2; quem pontua dentro do OS (R1) ou só lê pode ir a A3.
 * O teto não muda o que a porta exige: ele só limita a SUGESTÃO de subir.
 */
export const TETO_DA_REGUA: Readonly<Record<ComercialAutomacao, ComercialAutonomia>> = Object.freeze({
  qualificador: 'A3',
  agendador: 'A2',
  leitor_de_ata: 'A2',
  construtor_de_proposta: 'A2',
  revisor_de_proposta: 'A3',
  // Escreve ao cliente: texto do modelo sempre passa por gente.
  assistente_da_proposta: 'A2',
  fupeiro: 'A2',
  assinador: 'A2',
  cobrador: 'A2',
  fechador: 'A2',
  relator: 'A3',
  vigia: 'A3',
});

const ORDEM: readonly ComercialAutonomia[] = ['A0', 'A1', 'A2', 'A3'];

/**
 * A sugestão de subir um degrau (tela 12: "proposta de subir de degrau depois
 * de um mês sem erro"). Só um degrau por vez, só abaixo do teto, e só com prova:
 * a primeira passagem há pelo menos 30 dias e nenhuma passagem com erro nos
 * últimos 30. Sem histórico, sem sugestão. Quem sobe é gente, pelo PUT da config.
 */
export function degrauSugerido(
  nivel: ComercialAutonomia,
  teto: ComercialAutonomia,
  prova: { passagens30Dias: number; erros30Dias: number; primeiraPassagemEm: Date | null; agora: Date },
): ComercialAutonomia | null {
  const i = ORDEM.indexOf(nivel);
  if (i >= ORDEM.indexOf(teto)) return null;
  if (!prova.primeiraPassagemEm || prova.passagens30Dias === 0 || prova.erros30Dias > 0) return null;
  if (prova.agora.getTime() - prova.primeiraPassagemEm.getTime() < 30 * 86_400_000) return null;
  return ORDEM[i + 1];
}

/** O nível que vale: o gravado, senão o vigente. */
export function nivelDe(gravado: Partial<Record<ComercialAutomacao, ComercialAutonomia>>, automacao: ComercialAutomacao): ComercialAutonomia {
  return gravado[automacao] ?? AUTONOMIA_VIGENTE[automacao];
}

export type VeredictoDaAutonomia = { roda: true } | { roda: false; automacao: ComercialAutomacao; nivel: 'A0'; motivo: string };

/**
 * As tarefas que tratam o A0 por dentro, em vez de serem puladas: a dúvida da
 * sala precisa de resposta, e em A0 ela vai a uma pessoa (a decisão
 * `aprovacao_de_envio`) sem chamar o modelo. Pular deixaria o cliente sem nada.
 */
export const A0_TRATADO_NA_TAREFA: ReadonlySet<string> = new Set(['inteligencia.duvida']);

/** A tarefa `nome` roda com a autonomia gravada? Tarefa fora da tabela sempre roda. */
export function podeRodar(gravado: Partial<Record<ComercialAutomacao, ComercialAutonomia>>, nome: string): VeredictoDaAutonomia {
  if (A0_TRATADO_NA_TAREFA.has(nome)) return { roda: true };
  for (const automacao of AUTOMACOES_DA_TAREFA[nome] ?? []) {
    if (nivelDe(gravado, automacao) === 'A0') {
      return { roda: false, automacao, nivel: 'A0', motivo: `${automacao} em A0 (manual): a automação não roda, a pessoa faz pelo sistema` };
    }
  }
  return { roda: true };
}

/** As tarefas (reações e relógio) de uma automação, para a torre achar a última vez. */
export function tarefasDaAutomacao(automacao: ComercialAutomacao): string[] {
  return Object.entries(AUTOMACOES_DA_TAREFA)
    .filter(([, as]) => as.includes(automacao))
    .map(([n]) => n);
}

export const TODAS_AS_AUTOMACOES: readonly ComercialAutomacao[] = COMERCIAL_AUTOMACOES;
