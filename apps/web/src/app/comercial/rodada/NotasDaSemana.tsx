'use client';

import { useEffect, useState } from 'react';
import type { OperacaoPainelResposta } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useEhPlataforma } from '@/lib/plataforma';

/*
 * Layout 26/10: AS NOTAS DA SEMANA, TEXTO ESCRITO À MÃO.
 *
 * Até 26/10/2026 a Rodada da semana era inteira a nota `11-operacao/painel-root.md`
 * importada (a tela `/operacao`). Os números agora saem do banco; da nota fica só o
 * que é texto (o que decidir, o que mudou, o interno e o padrão), num bloco à parte,
 * fechado, dizendo de onde vem. Nenhum valor nem contagem da nota aparece aqui.
 * Só a sessão da plataforma (a ROOT) tem a nota; para as outras o bloco não existe.
 */
export function NotasDaSemana() {
  const { token } = useAuth();
  const ehPlataforma = useEhPlataforma();
  const [notas, setNotas] = useState<OperacaoPainelResposta | null>(null);

  useEffect(() => {
    if (!token || !ehPlataforma) return;
    let vivo = true;
    apiGet<OperacaoPainelResposta>('/tenants/plataforma/operacao/painel', token)
      .then((r) => vivo && setNotas(r))
      .catch(() => vivo && setNotas(null));
    return () => {
      vivo = false;
    };
  }, [token, ehPlataforma]);

  const c = notas?.conteudo;
  if (!ehPlataforma || !c) return null;
  const decidir = c.decisoes.filter((d) => !d.decidida).map((d) => d.texto);
  const blocos = [
    { titulo: 'O que decidir', itens: decidir },
    { titulo: 'O que mudou', itens: c.mudancas },
    { titulo: 'Interno', itens: c.interno },
    { titulo: 'O padrão', itens: c.padrao },
  ].filter((b) => b.itens.length > 0);
  if (blocos.length === 0) return null;

  return (
    <details className="rounded-md border border-dashed border-border bg-surface px-5 py-4">
      <summary className="cursor-pointer list-none">
        <span className="text-[1.05rem] font-semibold">Notas da semana</span>
        <span className="ml-2 text-sm text-muted">
          texto escrito à mão (painel-root.md), não contado pelo sistema
          {notas?.rodada ? ` · nota de ${notas.rodada.slice(0, 10).split('-').reverse().join('/')}` : ''}
        </span>
      </summary>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        {blocos.map((b) => (
          <div key={b.titulo}>
            <h3 className="com-rotulo">{b.titulo}</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {b.itens.map((t) => (
                <li key={t} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-muted" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
