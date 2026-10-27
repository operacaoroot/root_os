'use client';

import { useState } from 'react';
import { metaDoMes, type MaquinaPost } from '@mktos/shared';
import { MaquinaPagina } from '@/components/maquina/MaquinaPagina';
import { DIAS_DA_SEMANA, Kanban, ListaDePosts, SeletorDeVisao, btn, hojeSP, useVisao } from '@/components/maquina/pecas';

/*
 * Marketing › CALENDÁRIO: o mês começando na segunda. Arrastar o post entre dias
 * muda a data; soltar em "A agendar" tira a data. O "+" do dia cria o post já
 * agendado. Os dias da cadência ficam marcados e dizem quantos posts o mês pede.
 */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function diasDaGrade(mes: string): string[] {
  const [a, m] = mes.split('-').map(Number);
  const primeiro = new Date(Date.UTC(a, m - 1, 1, 12));
  const recuo = (primeiro.getUTCDay() + 6) % 7; // segunda = 0
  const d = new Date(primeiro);
  d.setUTCDate(d.getUTCDate() - recuo);
  const out: string[] = [];
  do {
    for (let i = 0; i < 7; i++) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
  } while (d.getUTCMonth() === m - 1);
  return out;
}

function somarMes(mes: string, n: number) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default function CalendarioPage() {
  const [mes, setMes] = useState(() => hojeSP().slice(0, 7));
  const [visao, setVisao] = useVisao('calendario', 'calendario');
  const [arrastado, setArrastado] = useState<string | null>(null);
  const hoje = hojeSP();

  return (
    <MaquinaPagina
      titulo="Calendário de conteúdo"
      acoes={
        <SeletorDeVisao
          visao={visao}
          onTrocar={setVisao}
          opcoes={[
            { v: 'calendario', rotulo: 'Calendário' },
            { v: 'lista', rotulo: 'Lista' },
            { v: 'kanban', rotulo: 'Kanban' },
          ]}
        />
      }
    >
      {({ m, painel, abrir, novo, levar }) => {
        const ordenados = [...painel.posts].sort((a, b) => a.ordem - b.ordem);
        if (visao === 'kanban') return <Kanban m={m} posts={ordenados} onAbrir={abrir} levar={levar} />;

        const noCalendario = ordenados.filter((p) => p.data && (p.etapa === 'agendado' || p.etapa === 'publicado'));
        const doMes = noCalendario.filter((p) => p.data!.startsWith(mes)).sort((a, b) => a.data!.localeCompare(b.data!));
        const aAgendar = ordenados.filter((p) => p.etapa === 'a_agendar');
        const meta = metaDoMes(painel.cadencia, mes);
        const porDia = new Map<string, MaquinaPost[]>();
        for (const p of noCalendario) porDia.set(p.data!, [...(porDia.get(p.data!) ?? []), p]);

        const soltarNoDia = (dia: string) => {
          if (arrastado) void m.mudarData(arrastado, dia);
          setArrastado(null);
        };
        const cabecalho = (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button className={btn} onClick={() => setMes(somarMes(mes, -1))} aria-label="Mês anterior">
                ‹
              </button>
              <h2 className="min-w-[10rem] text-center text-lg font-semibold capitalize">
                {MESES[Number(mes.slice(5)) - 1]} {mes.slice(0, 4)}
              </h2>
              <button className={btn} onClick={() => setMes(somarMes(mes, 1))} aria-label="Próximo mês">
                ›
              </button>
              <button className={btn} onClick={() => setMes(hoje.slice(0, 7))}>
                Hoje
              </button>
            </div>
            <div className="text-sm text-muted">
              <span className="com-num font-semibold text-text">{doMes.length}</span> de{' '}
              <span className="com-num">{meta}</span> posts no mês
            </div>
          </div>
        );

        if (visao === 'lista') {
          return (
            <div className="space-y-4">
              {cabecalho}
              <ListaDePosts m={m} posts={doMes} onAbrir={abrir} levar={levar} vazio="Nada agendado neste mês." />
            </div>
          );
        }

        return (
          <div className="space-y-4">
            {cabecalho}
            <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
              <div className="overflow-x-auto">
                <div className="grid min-w-[44rem] grid-cols-7 overflow-hidden rounded-md border border-border bg-border/60 [gap:1px]">
                  {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d, i) => {
                    const diaJs = (i + 1) % 7;
                    const ligado = painel.cadencia.includes(diaJs);
                    return (
                      <button
                        key={d}
                        disabled={!m.editavel}
                        title={ligado ? 'Dia da cadência (clique para tirar)' : 'Clique para postar neste dia da semana'}
                        onClick={() =>
                          void m.salvarCadencia(ligado ? painel.cadencia.filter((x) => x !== diaJs) : [...painel.cadencia, diaJs])
                        }
                        className={`bg-surface-2 py-1.5 text-center font-os-mono text-[0.65rem] uppercase tracking-[0.1em] ${
                          ligado ? 'text-brand' : 'text-dim'
                        }`}
                      >
                        {d}
                        {ligado && ' ●'}
                      </button>
                    );
                  })}
                  {diasDaGrade(mes).map((dia) => {
                    const foraDoMes = !dia.startsWith(mes);
                    const dJs = new Date(`${dia}T12:00:00Z`).getUTCDay();
                    const cadencia = painel.cadencia.includes(dJs);
                    const posts = porDia.get(dia) ?? [];
                    return (
                      <div
                        key={dia}
                        onDragOver={(e) => m.editavel && e.preventDefault()}
                        onDrop={() => soltarNoDia(dia)}
                        className={`group min-h-[6.5rem] p-1.5 ${foraDoMes ? 'bg-surface-2/60' : 'bg-surface'} ${
                          dia === hoje ? 'outline outline-2 -outline-offset-2 outline-brand' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`font-os-mono text-xs ${foraDoMes ? 'text-dim' : cadencia ? 'text-brand' : 'text-muted'}`}>
                            {Number(dia.slice(8))}
                          </span>
                          {m.editavel && (
                            <button
                              onClick={() => novo({ etapa: dia < hoje ? 'publicado' : 'agendado', data: dia })}
                              className="px-1 text-dim opacity-0 hover:text-brand group-hover:opacity-100"
                              aria-label={`Novo post em ${dia}`}
                            >
                              +
                            </button>
                          )}
                        </div>
                        <div className="mt-1 space-y-1">
                          {posts.map((p) => (
                            <button
                              key={p.id}
                              draggable={m.editavel}
                              onDragStart={() => setArrastado(p.id)}
                              onClick={() => abrir(p.id)}
                              title={p.titulo}
                              className={`block w-full truncate rounded-sm border-l-[3px] px-1.5 py-0.5 text-left text-xs ${
                                p.etapa === 'publicado' ? 'border-brand bg-brand/20' : 'border-brand bg-surface-2'
                              }`}
                            >
                              {p.numero && <span className="font-os-mono text-[0.6rem] text-muted">{p.numero} </span>}
                              {p.titulo}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
                  <span>
                    <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border-l-[3px] border-brand bg-surface-2 align-middle" />
                    agendado
                  </span>
                  <span>
                    <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border-l-[3px] border-brand bg-brand/20 align-middle" />
                    postado
                  </span>
                  <span>
                    <span className="mr-1 text-brand">●</span>dia da cadência ({painel.cadencia.map((d) => DIAS_DA_SEMANA[d]).join(', ') || 'nenhum'})
                  </span>
                </div>
              </div>

              <aside
                onDragOver={(e) => m.editavel && e.preventDefault()}
                onDrop={() => {
                  if (arrastado) void m.mudarData(arrastado, null);
                  setArrastado(null);
                }}
                className="h-fit rounded-md border border-border bg-surface-2 p-3"
              >
                <div className="flex items-baseline justify-between">
                  <span className="com-rotulo">A agendar</span>
                  <span className="com-num text-sm text-muted">{aAgendar.length}</span>
                </div>
                <p className="mt-1 text-xs text-muted">Arraste para um dia do calendário.</p>
                <div className="mt-2 space-y-1.5">
                  {aAgendar.map((p) => (
                    <button
                      key={p.id}
                      draggable={m.editavel}
                      onDragStart={() => setArrastado(p.id)}
                      onClick={() => abrir(p.id)}
                      className="block w-full rounded border border-border bg-surface p-2 text-left text-sm hover:border-brand-dim"
                    >
                      {p.numero && <div className="font-os-mono text-[0.6rem] text-muted">{p.numero}</div>}
                      {p.titulo}
                    </button>
                  ))}
                  {!aAgendar.length && <p className="text-xs text-dim">Nenhum post pronto sem data.</p>}
                </div>
              </aside>
            </div>
          </div>
        );
      }}
    </MaquinaPagina>
  );
}
