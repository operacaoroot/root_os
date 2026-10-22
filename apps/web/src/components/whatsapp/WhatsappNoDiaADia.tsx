'use client';

/*
 * O WHATSAPP NO DIA A DIA (produção 22C, W4, lane D).
 *
 * Na Visão geral, o cartão "WhatsApp" diz quantas mensagens esperam leitura nas
 * conversas de leads, de clientes e sem vínculo, cada linha abrindo a caixa já
 * filtrada, e quantas conversas ainda não estão ligadas a ninguém (a chamada
 * para ligar). Lê `GET /whatsapp/resumo` (guardado 30 s na API). Tudo zero:
 * uma linha calma. Falhou: o cartão diz que não carregou, sem derrubar o Dia a
 * dia. Só leitura: nada vira tarefa nem pendência.
 */
import { useEffect, useState } from 'react';
import type { FiltroDaCaixa, ResumoDoWhatsapp } from '@mktos/shared';

import { apiGet } from '@/lib/api';
import { Quadro } from '@/components/painel';
import { urlDaCaixa } from './bolha-do-whatsapp';

const LINHAS: { chave: 'leads' | 'clientes' | 'semVinculo'; filtro: FiltroDaCaixa; rotulo: string }[] = [
  { chave: 'leads', filtro: 'leads', rotulo: 'Leads' },
  { chave: 'clientes', filtro: 'clientes', rotulo: 'Clientes' },
  { chave: 'semVinculo', filtro: 'sem_vinculo', rotulo: 'Sem vínculo' },
];

const rotuloDeNaoLidas = (n: number) => (n === 1 ? 'não lida' : 'não lidas');

function hora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

function valido(x: unknown): x is ResumoDoWhatsapp {
  const r = x as ResumoDoWhatsapp | null;
  return !!r && typeof r === 'object' && !!r.naoLidas && typeof r.naoLidas.total === 'number' && typeof r.conversasSemVinculo === 'number';
}

export function WhatsappNoDiaADia({ token }: { token: string | null }) {
  const [r, setR] = useState<ResumoDoWhatsapp | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    Promise.resolve()
      .then(() => apiGet<ResumoDoWhatsapp>('/whatsapp/resumo', token))
      .then((x) => {
        if (!vivo) return;
        if (valido(x)) setR(x);
        else setErro(true);
      })
      .catch(() => {
        if (vivo) setErro(true);
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  const calmo = !!r && r.naoLidas.total === 0 && r.conversasSemVinculo === 0;
  const nota = erro ? 'conversas do número da empresa' : r ? `não lidas por conversa · medido às ${hora(r.geradoEm)}` : 'lendo as conversas';

  return (
    <Quadro className="min-w-0" titulo="WhatsApp" nota={nota}>
      <div data-testid="dia-a-dia-whatsapp">
        {erro && (
          <p data-testid="whatsapp-resumo-erro" className="text-sm text-muted">
            O resumo do WhatsApp não carregou.{' '}
            <a href="/whatsapp" className="underline hover:text-brand">Abrir a caixa</a>
          </p>
        )}
        {!erro && !r && <p className="text-sm text-muted">Carregando.</p>}
        {calmo && (
          <p data-testid="whatsapp-nada-novo" className="text-sm">
            Nada novo no WhatsApp.
          </p>
        )}
        {r && !erro && !calmo && (
          <>
            <ul className="divide-y divide-border text-sm">
              {LINHAS.map(({ chave, filtro, rotulo }) => {
                const n = r.naoLidas[chave];
                return (
                  <li key={chave}>
                    <a
                      href={urlDaCaixa(filtro)}
                      data-testid={`whatsapp-linha-${filtro}`}
                      className="flex min-h-[44px] items-center justify-between gap-3 rounded px-1 py-2 hover:bg-surface-2 md:min-h-0"
                    >
                      <span>{rotulo}</span>
                      <span className={n ? '' : 'text-muted'}>
                        <span className={`com-num ${n ? 'font-semibold' : ''}`}>{n}</span> {rotuloDeNaoLidas(n)}
                        <span aria-hidden className="ml-2 text-muted">→</span>
                      </span>
                    </a>
                  </li>
                );
              })}
              {r.naoLidas.equipe > 0 && (
                <li>
                  <a
                    href={urlDaCaixa('equipe')}
                    data-testid="whatsapp-linha-equipe"
                    className="flex min-h-[44px] items-center justify-between gap-3 rounded px-1 py-2 text-muted hover:bg-surface-2 md:min-h-0"
                  >
                    <span>Equipe</span>
                    <span>
                      <span className="com-num">{r.naoLidas.equipe}</span> {rotuloDeNaoLidas(r.naoLidas.equipe)}
                      <span aria-hidden className="ml-2">→</span>
                    </span>
                  </a>
                </li>
              )}
            </ul>
            {r.conversasSemVinculo > 0 && (
              <a
                href={urlDaCaixa('sem_vinculo')}
                data-testid="whatsapp-sem-vinculo-chamada"
                className="mt-3 flex items-center justify-between gap-3 rounded border border-border px-3 py-2 text-sm hover:border-brand hover:text-brand"
              >
                <span>
                  Conversas sem vínculo: <span className="com-num font-semibold">{r.conversasSemVinculo}</span>
                </span>
                <span className="text-muted">ligar a um lead ou cliente →</span>
              </a>
            )}
          </>
        )}
      </div>
    </Quadro>
  );
}
