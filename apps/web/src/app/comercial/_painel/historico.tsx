'use client';

/*
 * O HISTÓRICO DA ENTIDADE no comercial (leva 5, L2/L4, 27/10/2026).
 *
 * O componente é do agente do L2 (`components/historico/HistoricoDaEntidade`):
 * lê `GET /audit?entidade=<id>&tipo=<entityType>&limit=100` e mostra quem,
 * quando, antes e depois. O comercial o importa só por aqui, para o painel do
 * lead e o menu do lead terem UM ponto de entrada (e a suíte do comercial
 * trocar o módulo por um dublê num lugar só).
 *
 * O AuditLog do comercial grava `entityType: 'lead'` com `entityId: <leadId>`
 * (mover à mão, ficha, e-mail, nota do fio, vínculo da proposta): é esse o par
 * que o Histórico do lead abre.
 */
export { HistoricoDaEntidade } from '@/components/historico/HistoricoDaEntidade';

export interface PropsDoHistorico {
  entityId: string;
  entityType?: string;
  titulo?: string;
  aberto: boolean;
  onFechar: () => void;
}

/** O tipo da entidade que o comercial audita: o lead. */
export const TIPO_DA_ENTIDADE_DO_LEAD = 'lead';
