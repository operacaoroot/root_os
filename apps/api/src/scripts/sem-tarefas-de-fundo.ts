/*
 * DESLIGA AS TAREFAS DE FUNDO ANTES DE O NEST SUBIR (rodada de produção 1, 21/10/2026).
 *
 * Um script que sobe o `AppModule` inteiro sobe junto o agendador de rotinas e os
 * laços de sincronismo (bio, ClickUp, banco, Obsidian). Rodando ao lado da API no
 * mesmo banco, eles disparariam rotina, mensagem ou cobrança em nome do script. Este
 * módulo é o PRIMEIRO import do script e força os interruptores que já existem para
 * "desligado": nada roda além do que o próprio script chama.
 *
 * Força, não sugere: um `ROTINAS_CRON=on` herdado do ambiente do container não vale aqui.
 */
const DESLIGADO: Record<string, string> = {
  ROTINAS_CRON: 'off',
  PAUTA_CRON: 'off',
  BIO_BRIDGE_INTERVAL_MIN: '0',
  BIO_SYNC_INTERVAL_MIN: '0',
  PLUGGY_SYNC_INTERVAL_MIN: '0',
  ASAAS_SYNC_INTERVAL_MIN: '0',
  CLICKUP_SYNC_INTERVAL_MIN: '0',
  OBSIDIAN_REINDEX_MIN: '0',
};
for (const [k, v] of Object.entries(DESLIGADO)) process.env[k] = v;

export const TAREFAS_DE_FUNDO_DESLIGADAS = Object.keys(DESLIGADO);
