/*
 * O RELATÓRIO DO COMERCIAL: LEITURA E REAÇÃO (rodada da implantação I5, 18/10/2026).
 *
 * O pedido do Rodrigo: "nos relatórios do comercial, quantas vezes a pessoa
 * acessou o link e quais as ideias dela". As fontes são os fatos que já
 * existem: a visita da sala (`sala.visitada`, rodada UX), a leitura por seção e
 * as reações da proposta (`LeadReacao` e os fatos `proposta.lida`,
 * `proposta.reagida`, `proposta.ideia`, `proposta.duvida`, I4). Nenhum número
 * deste bloco é escrito por modelo.
 *
 * O N do "leu sem responder" é [a decidir] pela mesa: 3 é o PROVISÓRIO desta
 * rodada, marcado como tal na tela e no RESULTADO. Ao passar dele, o relógio
 * PREPARA o FUP 1 (o M5, pela fila: humano envia, R3 segue).
 */

/** Provisório: [a decidir] pela mesa (RODADA-IMPLANTACAO, I5). */
export const LEU_SEM_RESPONDER_N = 3;
export const LEU_SEM_RESPONDER_N_PROVISORIO = true;

export type SituacaoDaLeitura =
  | { tipo: 'leu_sem_responder'; acessos: number; fupPreparado: boolean }
  | { tipo: 'respondeu' }
  | { tipo: 'nao_abriu' }
  | { tipo: 'lendo'; acessos: number };

/**
 * A situação acionável de um lead com proposta publicada:
 *  · respondeu (aceite, ajuste, dúvida, ideia ou mensagem depois da publicação);
 *  · não abriu (nenhum acesso com leitura da versão vigente): reenviar?;
 *  · leu N ou mais vezes sem responder: o FUP 1 é preparado;
 *  · lendo (abriu, ainda abaixo do N).
 */
export function situacaoDaLeitura(e: { acessos: number; respondeu: boolean; fupPreparado: boolean }, n = LEU_SEM_RESPONDER_N): SituacaoDaLeitura {
  if (e.respondeu) return { tipo: 'respondeu' };
  if (e.acessos <= 0) return { tipo: 'nao_abriu' };
  if (e.acessos >= n) return { tipo: 'leu_sem_responder', acessos: e.acessos, fupPreparado: e.fupPreparado };
  return { tipo: 'lendo', acessos: e.acessos };
}

export function fraseDaSituacao(s: SituacaoDaLeitura): string {
  switch (s.tipo) {
    case 'respondeu':
      return 'respondeu';
    case 'nao_abriu':
      return 'não abriu · reenviar?';
    case 'leu_sem_responder':
      return `leu ${s.acessos}× sem responder${s.fupPreparado ? ' · FUP 1 preparado' : ' · FUP 1 ainda não preparado'}`;
    case 'lendo':
      return `abriu ${s.acessos}×`;
  }
}

export interface LinhaDeLeitura {
  leadId: string;
  nome: string;
  /** Quando a proposta vigente foi publicada. */
  enviadaEm: string;
  versao: number;
  acessos: number;
  ultimoAcessoEm: string | null;
  /** A seção com mais tempo de leitura, com os segundos. */
  secaoMaisLida: { secao: string; rotulo: string; segundos: number } | null;
  ideias: number;
  situacao: SituacaoDaLeitura;
  frase: string;
}

export interface IdeiaDoCliente {
  id: string;
  leadId: string;
  nome: string;
  secao: string;
  rotuloDaSecao: string;
  tipo: 'ideia' | 'duvida';
  texto: string;
  em: string;
  respondidaEm: string | null;
  tarefaId: string | null;
}

export interface RelatorioDeLeitura {
  periodoDias: number;
  geradoEm: string;
  tiles: { propostasVivas: number; acessosAPropostas: number; visitasAsSalas: number; ideiasRecebidas: number };
  leitura: LinhaDeLeitura[];
  ideias: IdeiaDoCliente[];
  n: { valor: number; provisorio: boolean };
}
