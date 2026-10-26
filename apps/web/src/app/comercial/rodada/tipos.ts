/*
 * Layout 26/10: a resposta de `GET /comercial/rodada-da-semana`, espelho de
 * `apps/api/src/comercial/rodada/rodada-da-semana.ts` (RodadaDaSemanaResposta).
 * Valores em reais; datas em ISO; `semana.de`/`ate` em AAAA-MM-DD de São Paulo.
 */
export interface RodadaDaSemana {
  semana: { de: string; ate: string; anterior: string; proxima: string | null; atual: boolean };
  geradoEm: string;
  entraram: { leadId: string; nome: string; etapa: string; canal: string | null; em: string }[];
  movimentos: { leadId: string; nome: string; de: string; para: string; aMao: boolean; por: string | null; em: string }[];
  fechados: { leadId: string; nome: string; valor: number | null; produto: string | null; em: string }[];
  valorFechado: number;
  propostas: { leadId: string; nome: string; versao: number | null; valor: number | null; em: string }[];
  saidas: {
    leadId: string;
    nome: string;
    saida: string;
    motivo: string;
    detalhe: string | null;
    voltaEm: string | null;
    por: string | null;
    em: string;
  }[];
  tarefasAtrasadas: { id: string; titulo: string; prazo: string | null; pessoa: string | null; lead: { id: string; nome: string } | null }[];
  negociacao: { total: number; abertos: number; pagante: number | null; semCaixa: number | null };
}
