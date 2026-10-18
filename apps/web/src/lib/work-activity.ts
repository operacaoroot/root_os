import type { TrabAtividadeDto } from '@mktos/shared';

function etapaDoRegistro(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!('status' in value) || typeof value.status !== 'string' || !value.status.trim()) return null;
  return value.status;
}

/** Mostra a mudança registrada; não reconstrói etapas a partir do estado atual. */
export function resumirAtividade(a: Pick<TrabAtividadeDto, 'action' | 'before' | 'after'>): string {
  if (a.action !== 'work.task.update') return a.action;
  const anterior = etapaDoRegistro(a.before);
  const nova = etapaDoRegistro(a.after);
  return anterior && nova && anterior !== nova ? `Etapa: ${anterior} → ${nova}` : a.action;
}
