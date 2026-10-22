'use client';

/*
 * O RELÓGIO DO ONBOARDING NO DIA A DIA (rodada de produção 2, M1, S5, 22/10/2026).
 *
 * "O relógio grava a pendência no trilho, mas quem não abre o trilho não vê." Na
 * Visão geral, o cartão "Implantação" lê o que já existe (`GET /trabalho/
 * implantacao/resumo`: a regra do relógio sobre os trilhos e a próxima reunião
 * da Agenda) e diz quantos clientes estão sem próximo passo, com passo vencido e
 * sem reunião marcada. Cada linha leva à Implantação já filtrada. Sem pendência,
 * "Implantação em dia". Não roda o relógio e não escreve nada.
 */
import { useEffect, useState } from 'react';
import {
  AGENDA_INDISPONIVEL, AGENDA_SEM_PERMISSAO, PENDENCIAS_DA_IMPLANTACAO, ROTULO_DA_PENDENCIA_DA_IMPLANTACAO,
  type ResumoDaImplantacao,
} from '@mktos/shared';

import { apiGet } from '@/lib/api';
import { Quadro } from '@/components/painel';
import { urlDaPendencia } from '@/components/trabalho/PendenciaDaImplantacao';

export function ImplantacaoNoDiaADia({ token }: { token: string | null }) {
  const [r, setR] = useState<ResumoDaImplantacao | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    apiGet<ResumoDaImplantacao>('/trabalho/implantacao/resumo', token)
      .then((x) => { if (!vivo) return; if (x && typeof x === 'object') setR(x); else setErro(true); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [token]);

  if (erro) return null;
  // A empresa sem a lista da implantação (ou uma resposta sem as pendências) não tem o que mostrar aqui.
  if (r && (r.cartoes == null || !r.pendencias)) return null;
  const linhas = r ? PENDENCIAS_DA_IMPLANTACAO.map((p) => ({ p, n: r.pendencias[p]?.length ?? 0 })) : [];
  const agendaFora = !!r && r.agenda !== 'ok';
  const emDia = !!r && linhas.every((l) => l.n === 0) && !agendaFora;

  return (
    <Quadro className="min-w-0" titulo="Implantação" nota={r ? `${r.cartoes} ${r.cartoes === 1 ? 'cliente em implantação' : 'clientes em implantação'} · clique numa linha` : 'lendo os trilhos e a agenda'}>
      <div data-testid="dia-a-dia-implantacao">
        {!r && <p className="text-sm text-muted">Carregando.</p>}
        {emDia && <p data-testid="implantacao-em-dia" className="text-sm">Implantação em dia.</p>}
        {r && !emDia && (
          <ul className="divide-y divide-border text-sm">
            {linhas.map(({ p, n }) => {
              if (p === 'sem-reuniao' && agendaFora) {
                return (
                  <li key={p} data-testid={`implantacao-linha-${p}`} className="flex items-center justify-between gap-3 py-2 text-muted">
                    <span>Reunião marcada: {r.agenda === 'sem-permissao' ? AGENDA_SEM_PERMISSAO.toLowerCase() : AGENDA_INDISPONIVEL.toLowerCase()}</span>
                  </li>
                );
              }
              if (n === 0) return null;
              const rotulo = ROTULO_DA_PENDENCIA_DA_IMPLANTACAO[p];
              return (
                <li key={p}>
                  <a
                    href={urlDaPendencia(p)}
                    data-testid={`implantacao-linha-${p}`}
                    className="flex min-h-[44px] items-center justify-between gap-3 rounded px-1 py-2 hover:bg-surface-2 md:min-h-0"
                  >
                    <span><span className={`com-num font-semibold ${p === 'passo-vencido' ? 'text-bad' : ''}`}>{n}</span> {n === 1 ? rotulo.um : rotulo.varios}</span>
                    <span aria-hidden className="text-muted">ver →</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Quadro>
  );
}
