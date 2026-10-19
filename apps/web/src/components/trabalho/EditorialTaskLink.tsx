'use client';
import { useAuth } from '@/lib/auth';
export function EditorialTaskLink({ taskId }: { taskId: string }) {
  const { can } = useAuth();
  return can('pauta.ver') && can('tarefas.ver') ? <a href={'/pauta/producao?taskId=' + encodeURIComponent(taskId)} className="block text-sm text-brand underline">Abrir material e Produção</a> : null;
}
