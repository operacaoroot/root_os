'use client';

import { useAuth } from '@/lib/auth';
import { ResumoDeTarefas } from '@/components/tarefas/TarefasDoDia';

/*
 * VISÃO GERAL DA EMPRESA (19/10/2026): o resumo em gráfico das tarefas de todas
 * as áreas — o que está aberto, atrasado e com quem —, no padrão dos painéis do
 * Comercial (um acento só, todo número leva à lista filtrada).
 *
 * Os cartões de antes (leads, vendas, receita, CPL, campanhas) saíram: liam a
 * tabela antiga de leads, que só tem os leads de exemplo da instalação, e
 * publicavam número que ninguém usa. Os números do comercial e do financeiro
 * moram nos painéis deles.
 */
export default function VisaoGeralPage() {
  const { can } = useAuth();
  return (
    <div className="com-tema mx-auto max-w-[1240px] space-y-5 text-text">
      {can('tarefas.ver') ? <ResumoDeTarefas /> : <p className="text-muted">Sem acesso às tarefas.</p>}
    </div>
  );
}
