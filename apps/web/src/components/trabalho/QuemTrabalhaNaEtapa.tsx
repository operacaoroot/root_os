'use client';

/*
 * QUEM TRABALHA NESTA ETAPA (rodada de produção 1, 21/10/2026): "criamos um kanban e toda
 * uma estrutura, com agentes específicos, e nada aparece". No painel do card com trilho,
 * só para ler: os agentes do roster do onboarding (leitor de ata, pesquisador de conta,
 * roteirista do kickoff) e o relógio, cada um com o último fato neste cliente e o que vai
 * fazer. A rota é `GET /tenants/onboarding/trilhos/:id/quem-trabalha` (`tarefas.ver`).
 *
 * Rodada dos agentes (21/10/2026): o nome, o "para que serve", o estado declarado e o
 * modelo vêm do cadastro único (IM-01, IM-02, IM-03, IM-05 e IM-07, o montador do kit),
 * e no fim da seção mora o kit com a pasta do cliente (`KitDaImplantacao`).
 */
import { useEffect, useState } from 'react';
import type { QuemTrabalhaNaEtapa as Dados } from '@mktos/shared';

import { apiGet } from '@/lib/api';
import { diaCurto, instanteComSemana } from '@/lib/datas-do-cartao';
import { KitDaImplantacao } from './KitDaImplantacao';

/** `claude-sonnet-5-5` → `Sonnet 5.5`. */
function rotuloDoModelo(modelo: string | null | undefined, esforco: string | null | undefined): string | null {
  if (!modelo) return null;
  const m = /claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(modelo);
  const nome = m ? `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : modelo;
  return esforco ? `${nome} · ${esforco}` : nome;
}

const ROTULO_DO_ESTADO: Record<Dados['agentes'][number]['estado'], string> = {
  ativo: 'ativo', pausado: 'pausado', planejado: 'planejado', encerrado: 'encerrado', ausente: 'não semeado',
};

function Fato({ fato }: { fato: { texto: string; em: string } | null }) {
  if (!fato) return <p className="text-muted">Nada feito neste cliente ainda.</p>;
  return (
    <p className="break-words">
      <span className="font-os-mono text-[10.5px] text-muted" title={instanteComSemana(fato.em) ?? undefined}>{diaCurto(fato.em)}</span> {fato.texto}
    </p>
  );
}

export function QuemTrabalhaNaEtapa({ trilhoId, token }: { trilhoId: string; token: string | null }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    setErro(false);
    apiGet<Dados>(`/tenants/onboarding/trilhos/${encodeURIComponent(trilhoId)}/quem-trabalha`, token)
      .then((d) => { if (vivo) setDados(d); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [trilhoId, token]);

  return (
    <section aria-label="Quem trabalha nesta etapa" data-testid="quem-trabalha" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px]">
      <h3 className="font-os-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Quem trabalha nesta etapa{dados ? ` · ${dados.faseRotulo}` : ''}</h3>
      {erro && <p className="mt-1 text-muted">Não deu para ler os agentes agora. Abra o trilho para ver os marcos.</p>}
      {!erro && !dados && <p className="mt-1 text-muted">Carregando.</p>}
      {dados && (
        <ul className="mt-1.5 space-y-2">
          {dados.agentes.map((a) => (
            <li key={a.slug} data-testid={`quem-trabalha-${a.slug}`}>
              <p className="flex flex-wrap items-center gap-1.5">
                <span aria-hidden className="grid h-5 w-5 place-items-center rounded bg-brand/10 font-os-mono text-[9.5px] text-brand">{a.iniciais}</span>
                <span className="font-semibold">{a.nome}</span>
                <span className={`rounded border px-1 font-os-mono text-[10px] ${a.estado === 'ativo' ? 'border-brand/40 text-brand' : 'border-border text-muted'}`}>{ROTULO_DO_ESTADO[a.estado]}</span>
                {a.funcao && <span className="font-os-mono text-[10px] text-muted">{a.funcao}</span>}
                {rotuloDoModelo(a.modelo, a.esforco) && <span className="font-os-mono text-[10px] text-muted" data-testid={`quem-trabalha-modelo-${a.slug}`}>{rotuloDoModelo(a.modelo, a.esforco)}</span>}
              </p>
              <div className="ml-6 mt-0.5 space-y-0.5">
                {a.paraQueServe && <p className="text-muted">{a.paraQueServe}</p>}
                <Fato fato={a.ultimoFato} />
                <p className="text-muted">{a.oQueVaiFazer}</p>
              </div>
            </li>
          ))}
          <li data-testid="quem-trabalha-relogio">
            <p className="flex flex-wrap items-center gap-1.5">
              <span aria-hidden className="grid h-5 w-5 place-items-center rounded bg-brand/10 font-os-mono text-[9.5px] text-brand">RO</span>
              <span className="font-semibold">{dados.relogio.nome}</span>
              <span className={`rounded border px-1 font-os-mono text-[10px] ${dados.relogio.ligado ? 'border-brand/40 text-brand' : 'border-border text-muted'}`}>{dados.relogio.ligado ? 'ligado' : 'desligado'}</span>
            </p>
            <div className="ml-6 mt-0.5 space-y-0.5">
              <Fato fato={dados.relogio.ultimoFato} />
              {!dados.relogio.ligado ? (
                <p className="text-muted">Desligado: não lembra nem cobra nada até alguém ligar em Rotinas.</p>
              ) : dados.relogio.vaiFazer.length ? (
                <>
                  <p className="text-muted">
                    Na próxima passagem{dados.relogio.proximaPassagemEm ? ` (${instanteComSemana(dados.relogio.proximaPassagemEm)})` : ''} registra, sem mandar mensagem:
                  </p>
                  <ul className="list-disc pl-4">
                    {dados.relogio.vaiFazer.map((t) => <li key={t} className="break-words">{t}</li>)}
                  </ul>
                </>
              ) : (
                <p className="text-muted">Nada pendente para este cliente na próxima passagem{dados.relogio.proximaPassagemEm ? ` (${instanteComSemana(dados.relogio.proximaPassagemEm)})` : ''}.</p>
              )}
            </div>
          </li>
        </ul>
      )}
      <KitDaImplantacao trilhoId={trilhoId} token={token} />
    </section>
  );
}
