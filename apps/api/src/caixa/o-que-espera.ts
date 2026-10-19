import type { Prisma } from '@prisma/client';

/**
 * ============================================================================
 * O QUE ESPERA POR MIM — as regras da caixa pessoal, fatia A7
 * ============================================================================
 *
 * `docs/PLANO-CONTROLE-DE-AGENTES.md`, fatia A7: "o que precisa de mim —
 * aprovações que EU posso assinar, menções e tarefas paradas, num lugar".
 *
 * Este arquivo é a DECISÃO, e ela mora fora do serviço pelo mesmo motivo de
 * `work/checkout-de-tarefa.ts` e de `agents/estado-do-agente.ts`: regra escrita
 * dentro do componente que a desenha é regra que a segunda tela contradiz. Aqui
 * ficam os cortes (o que é "parado"), as identidades pelas quais a caixa procura
 * uma pessoa no quadro, as frases e os tetos. O serviço ao lado só executa.
 *
 * ----------------------------------------------------------------------------
 * A CAIXA NÃO TEM FONTE PRÓPRIA, E NÃO PODE TER
 * ----------------------------------------------------------------------------
 * Não há tabela nova, não há coluna nova e não há caminho de escrita: a caixa é
 * uma LEITURA de `Approval`, `WorkTask` e `WorkComment`. Materializar "o que
 * espera por você" numa tabela seria uma segunda verdade sobre o mesmo fato — o
 * mesmo erro que o ADR-011 evita na memória e que a fatia A3 acabou de pagar nas
 * horas devolvidas, onde duas telas publicavam números contraditórios do mesmo
 * número.
 *
 * A caixa de entrada (rodada do painel P1, 18/10/2026) manteve isto: a aba
 * Atividade LÊ a auditoria que o quadro grava e os comentários, e a única
 * escrita nova é `CaixaVisto`, a marca pessoal de "limpei" (ver o cabeçalho de
 * `caixa-visto.service.ts`). Ela não guarda "o que espera por você": guarda o
 * que cada pessoa já leu, e não muda estado de negócio nenhum.
 *
 * ----------------------------------------------------------------------------
 * O QUE CONTA PARA O CONTADOR, E POR QUÊ SÓ ISSO
 * ----------------------------------------------------------------------------
 * O contador da casca conta o que LIMPA QUANDO VOCÊ AGE: aprovação que você
 * pode assinar (assinou, saiu) e tarefa sua parada (mexeu, saiu). Conversa
 * recente no quadro NÃO entra: não existe estado de lido neste produto, então um
 * comentário nunca sairia da conta — e contador que não zera por ação nenhuma é
 * um número que a pessoa aprende a ignorar na primeira semana.
 */

/* ========================================================================== *
 * OS CORTES — o que é "parado"
 * ========================================================================== */

/**
 * Sem movimento há quantos dias já é parada.
 *
 * Sete dias porque a semana é a unidade do produto (as rotinas são semanais, as
 * horas devolvidas são por semana): tarefa que atravessou uma semana inteira sem
 * ninguém tocar não está em andamento, está esquecida. Constante e não variável
 * de ambiente de propósito — variável nova custa DOIS lugares (o bloco
 * `environment:` do compose e o `.env`) e o container não lê arquivo `.env`.
 */
export const DIAS_SEM_MOVIMENTO = 7;

/**
 * Travada com um agente há quantas horas já é parada.
 *
 * Vinte e quatro horas, e o número não é arbitrário: é o mesmo relógio do
 * rebaixamento por erro (RF-N-07), que deixa o agente 24h sem passar de R1.
 * Abaixo disso a tarefa NÃO está esperando por você — está com o agente, que é
 * exatamente o que o checkout atômico da A4 quis dizer. Acima, ela está presa, e
 * quem solta é gente (qualquer pessoa com `tarefas.editar` solta; ver o
 * cabeçalho de `work/checkout-de-tarefa.ts`).
 */
export const HORAS_PRESA_COM_AGENTE = 24;

/** A janela da conversa recente no quadro. Mesma semana dos outros cortes. */
export const DIAS_DE_CONVERSA = 7;

/* ========================================================================== *
 * OS TETOS — e por que eles se anunciam
 * ========================================================================== */

/**
 * Tetos por eixo. Uma caixa que devolve tudo é uma caixa que um dia devolve
 * trinta mil linhas — e o teto SILENCIOSO é a segunda metade do defeito que a
 * fila de aprovação já pagou: ela mandava `total: itens.length`, o total DEPOIS
 * do corte, e quem lia 100 acreditava que eram 100.
 *
 * Aqui o teto entra no total como PISO: bateu no teto, `totalParcial` fica
 * verdadeiro e a tela (e o contador da casca) dizem "N+".
 */
export const TETO_APROVACOES = 50;
export const TETO_TAREFAS = 50;
export const TETO_CONVERSA = 20;

/** O trecho de comentário que a caixa mostra. O resto se lê no quadro. */
export const TETO_DO_TRECHO = 160;

/* ========================================================================== *
 * POR QUE UM EIXO VEIO VAZIO
 * ========================================================================== */

/**
 * O estado de cada eixo. Vazio por MOTIVO é diferente de vazio por VITÓRIA, e a
 * tela precisa dos dois para não desenhar uma caixa cinza sem explicação —
 * critério da fatia.
 *
 *  · `ok`               — o eixo foi consultado. Lista vazia aqui é vitória;
 *  · `sem_permissao`    — a sessão não carrega a permissão daquele eixo. É
 *                         decisão de papel, não falha (a lição de `/contexto`:
 *                         403 vira "sem permissão", nunca caixa de erro);
 *  · `nao_decide`       — a pessoa acompanha a fila e não decide nela. Permissão
 *                         não é alçada, e esta é a distinção inteira da fatia;
 *  · `modulo_desligado` — a empresa não contratou o módulo dono daquele dado;
 *  · `sem_identidade`   — não há por qual nome procurar a pessoa no quadro;
 *  · `fora_da_casa`     — o token não corresponde a usuário ativo desta empresa.
 */
export const ESTADO_DO_EIXO = {
  ok: 'ok',
  semPermissao: 'sem_permissao',
  naoDecide: 'nao_decide',
  moduloDesligado: 'modulo_desligado',
  semIdentidade: 'sem_identidade',
  foraDaCasa: 'fora_da_casa',
} as const;

export type EstadoDoEixo = (typeof ESTADO_DO_EIXO)[keyof typeof ESTADO_DO_EIXO];

/* ========================================================================== *
 * POR QUE UMA TAREFA ESTÁ PARADA
 * ========================================================================== */

/**
 * Rótulos ESTÁVEIS, minúsculos com sublinhado — a mesma disciplina de
 * `CAUSA_DO_CHECKOUT` na A4 e de `agente_rebaixado` na porta. O rótulo é o que
 * se agrupa num relatório seis meses depois; a frase é o que a pessoa lê e pode
 * mudar sem quebrar contagem nenhuma.
 */
export const MOTIVO_DA_PARADA = {
  prazoVencido: 'prazo_vencido',
  semMovimento: 'sem_movimento',
  presaComAgente: 'presa_com_agente',
} as const;

export type MotivoDaParada = (typeof MOTIVO_DA_PARADA)[keyof typeof MOTIVO_DA_PARADA];

/** A frase da tela, por motivo. Exaustiva sobre o tipo: motivo novo não compila. */
export const FRASE_DO_MOTIVO: Record<MotivoDaParada, string> = {
  prazo_vencido: 'o prazo venceu',
  sem_movimento: `sem movimento há mais de ${DIAS_SEM_MOVIMENTO} dias`,
  presa_com_agente: `travada com um agente há mais de ${HORAS_PRESA_COM_AGENTE}h`,
};

/** O que a decisão precisa saber de uma tarefa. Menos que a linha do banco. */
export interface TarefaParaJulgar {
  dueDate: Date | null;
  updatedAt: Date;
  agenteId: string | null;
  agenteEm: Date | null;
}

/** O instante a partir do qual "sem movimento" começa a valer. */
export function corteSemMovimento(agora: Date): Date {
  return new Date(agora.getTime() - DIAS_SEM_MOVIMENTO * 24 * 60 * 60 * 1000);
}

/** O instante a partir do qual "presa com agente" começa a valer. */
export function cortePresaComAgente(agora: Date): Date {
  return new Date(agora.getTime() - HORAS_PRESA_COM_AGENTE * 60 * 60 * 1000);
}

/** O instante a partir do qual um comentário ainda é conversa recente. */
export function corteDaConversa(agora: Date): Date {
  return new Date(agora.getTime() - DIAS_DE_CONVERSA * 24 * 60 * 60 * 1000);
}

/**
 * Por que ESTA tarefa está parada. Lista vazia = não está, e não entra na caixa.
 *
 * Pode devolver mais de um motivo, e devolver mesmo: uma tarefa com prazo
 * vencido E presa com um agente há dois dias é dois problemas, não um. Mostrar
 * só o primeiro mandaria a pessoa soltar a tarefa e achar que resolveu.
 */
export function motivosDaParada(t: TarefaParaJulgar, agora: Date): MotivoDaParada[] {
  const motivos: MotivoDaParada[] = [];
  if (t.dueDate && t.dueDate < agora) motivos.push(MOTIVO_DA_PARADA.prazoVencido);
  if (t.updatedAt < corteSemMovimento(agora)) motivos.push(MOTIVO_DA_PARADA.semMovimento);
  if (t.agenteId && t.agenteEm && t.agenteEm < cortePresaComAgente(agora)) {
    motivos.push(MOTIVO_DA_PARADA.presaComAgente);
  }
  return motivos;
}

/**
 * As MESMAS três condições, escritas para o banco.
 *
 * Existe porque o corte tem de ir para o `WHERE`, e não para um filtro em
 * memória depois do `take`: filtrar depois faria o teto cortar as 50 primeiras
 * tarefas da pessoa e só então perguntar quais estão paradas — a caixa ficaria
 * vazia para quem tem muito trabalho em andamento, que é justamente quem mais
 * precisa dela.
 *
 * Os limiares saem das MESMAS funções de corte que `motivosDaParada` usa. Se
 * alguém mudar um número aqui e não lá, aparece linha na caixa sem motivo
 * nenhum ao lado — e a suíte cobra as duas pontas contra as mesmas constantes.
 */
export function condicoesDeParada(agora: Date): Prisma.WorkTaskWhereInput[] {
  return [
    { dueDate: { lt: agora } },
    { updatedAt: { lt: corteSemMovimento(agora) } },
    { AND: [{ agenteId: { not: null } }, { agenteEm: { lt: cortePresaComAgente(agora) } }] },
  ];
}

/**
 * O trecho do comentário, com a marca de que foi cortado.
 *
 * O corpo inteiro se lê no quadro, que é onde ele nasceu e onde a permissão dele
 * já é cobrada. Aqui só cabe o suficiente para a pessoa decidir se vale abrir.
 */
export function trechoDoComentario(texto: string): { trecho: string; truncado: boolean } {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (limpo.length <= TETO_DO_TRECHO) return { trecho: limpo, truncado: false };
  return { trecho: `${limpo.slice(0, TETO_DO_TRECHO)}…`, truncado: true };
}

/** Comentário sem ID permanece visível; nome não prova autoria. */
export function ehDeOutraPessoa(
  comentario: { authorId: string | null; authorName: string },
  eu: { id: string; name?: string | null },
): boolean {
  return comentario.authorId !== eu.id;
}
