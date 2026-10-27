'use client';

import { useMemo, useState } from 'react';
import type { MaquinaPost } from '@mktos/shared';
import { MaquinaPagina } from '@/components/maquina/MaquinaPagina';
import { dataCurta, hojeSP } from '@/components/maquina/pecas';
import { Numero, Quadro } from '@/components/painel';

/*
 * Marketing › ANÁLISE: como renderam os posts postados no mês, com os números
 * preenchidos no próprio post (janela do post › Números do post). A frase do
 * topo responde a pergunta; os números vêm depois.
 */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeDoMes = (m: string) => `${MESES[Number(m.slice(5)) - 1]}/${m.slice(0, 4)}`;
const n = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');
const interacoes = (p: MaquinaPost) =>
  (p.metricas.curtidas ?? 0) + (p.metricas.comentarios ?? 0) + (p.metricas.compartilhamentos ?? 0) + (p.metricas.salvamentos ?? 0);
const medido = (p: MaquinaPost) => Object.keys(p.metricas).length > 0;

function Barras({ itens, onAbrir }: { itens: { id?: string; rotulo: string; valor: number; nota: string }[]; onAbrir?: (id: string) => void }) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <ul className="space-y-1.5">
      {itens.map((i) => (
        <li key={i.id ?? i.rotulo}>
          <button
            disabled={!i.id || !onAbrir}
            onClick={() => i.id && onAbrir?.(i.id)}
            className="grid w-full grid-cols-[minmax(0,14rem)_1fr_5rem] items-center gap-3 rounded px-1 py-0.5 text-left text-sm hover:bg-surface-2 disabled:hover:bg-transparent"
          >
            <span className="truncate">{i.rotulo}</span>
            <span className="h-2.5 rounded-sm bg-surface-2">
              <span className="block h-full rounded-sm bg-brand" style={{ width: `${(i.valor / max) * 100}%` }} />
            </span>
            <span className="com-num text-right text-muted">{i.nota}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function AnalisePage() {
  const [mes, setMes] = useState(() => hojeSP().slice(0, 7));
  return (
    <MaquinaPagina titulo="Análise">
      {({ painel, abrir }) => <Analise mes={mes} setMes={setMes} posts={painel.posts} pilares={painel.pilares} abrir={abrir} />}
    </MaquinaPagina>
  );
}

function Analise(props: {
  mes: string;
  setMes: (m: string) => void;
  posts: MaquinaPost[];
  pilares: { chave: string; nome: string }[];
  abrir: (id: string) => void;
}) {
  const { mes, posts } = props;
  const meses = useMemo(() => {
    const s = new Set(posts.filter((p) => p.etapa === 'publicado' && p.data).map((p) => p.data!.slice(0, 7)));
    s.add(hojeSP().slice(0, 7));
    return [...s].sort().reverse();
  }, [posts]);
  const doMes = posts.filter((p) => p.etapa === 'publicado' && p.data?.startsWith(mes)).sort((a, b) => a.data!.localeCompare(b.data!));
  const comNumero = doMes.filter(medido);
  const soma = (k: keyof MaquinaPost['metricas']) => comNumero.reduce((t, p) => t + (p.metricas[k] ?? 0), 0);
  const views = soma('visualizacoes');
  const alcance = soma('alcance');
  const media = (v: number) => (comNumero.length ? v / comNumero.length : 0);
  const melhor = [...comNumero].sort((a, b) => (b.metricas.visualizacoes ?? 0) - (a.metricas.visualizacoes ?? 0))[0];
  const nomeDoPilar = new Map(props.pilares.map((p) => [p.chave, p.nome]));
  const porPilar = [...new Set(comNumero.map((p) => p.pilar))].map((pilar) => {
    const ps = comNumero.filter((p) => p.pilar === pilar);
    const v = ps.reduce((t, p) => t + (p.metricas.visualizacoes ?? 0), 0) / ps.length;
    return { rotulo: nomeDoPilar.get(pilar) ?? (pilar || 'sem pilar'), valor: v, nota: n(v) };
  });

  const frase = !doMes.length
    ? `Nenhum post foi ao ar em ${nomeDoMes(mes)}.`
    : !comNumero.length
      ? `${doMes.length} ${doMes.length === 1 ? 'post foi' : 'posts foram'} ao ar em ${nomeDoMes(mes)}, nenhum com números ainda. Abra o post e preencha “Números do post”.`
      : `${doMes.length} ${doMes.length === 1 ? 'post foi' : 'posts foram'} ao ar em ${nomeDoMes(mes)}, com ${n(media(views))} visualizações por post. O que mais rendeu: “${melhor.titulo}”.`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mes}
          onChange={(e) => props.setMes(e.target.value)}
          className="rounded border border-border bg-surface px-2.5 py-1.5 text-sm"
          aria-label="Mês"
        >
          {meses.map((m) => (
            <option key={m} value={m}>
              {nomeDoMes(m)}
            </option>
          ))}
        </select>
      </div>
      <p className="max-w-3xl text-[1.25rem] font-medium leading-snug">{frase}</p>

      {comNumero.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Quadro titulo="Alcance">
              <div className="grid grid-cols-2 gap-2">
                <Numero rotulo="Views por post" valor={n(media(views))} tamanho="medio" />
                <Numero rotulo="Contas por post" valor={n(media(alcance))} tamanho="medio" />
              </div>
            </Quadro>
            <Quadro titulo="Engajamento">
              <div className="grid grid-cols-2 gap-2">
                <Numero rotulo="Interações por post" valor={n(media(comNumero.reduce((t, p) => t + interacoes(p), 0)))} tamanho="medio" />
                <Numero rotulo="Salvamento" valor={pct(soma('salvamentos'), alcance)} nota="do alcance" tamanho="medio" />
              </div>
            </Quadro>
            <Quadro titulo="Crescimento">
              <div className="grid grid-cols-2 gap-2">
                <Numero rotulo="Novos seguidores" valor={n(soma('novosSeguidores'))} tamanho="medio" />
                <Numero rotulo="Visita → seguidor" valor={pct(soma('novosSeguidores'), soma('visitasPerfil'))} tamanho="medio" />
              </div>
            </Quadro>
          </div>

          <Quadro titulo="Visualizações por post" nota="Clique no post para abrir.">
            <Barras
              onAbrir={props.abrir}
              itens={comNumero
                .map((p) => ({ id: p.id, rotulo: p.numero ? `${p.numero} · ${p.titulo}` : p.titulo, valor: p.metricas.visualizacoes ?? 0, nota: n(p.metricas.visualizacoes ?? 0) }))
                .sort((a, b) => b.valor - a.valor)}
            />
          </Quadro>
          {porPilar.length > 1 && (
            <Quadro titulo="Visualizações por pilar" nota="Média por post.">
              <Barras itens={porPilar.sort((a, b) => b.valor - a.valor)} />
            </Quadro>
          )}
        </>
      )}

      {doMes.length > 0 && (
        <Quadro titulo="Posts do mês">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  {['Dia', 'Post', 'Formato', 'Views', 'Alcance', 'Interações', 'Salv.', 'Seguidores'].map((h) => (
                    <th key={h} className="com-rotulo pb-2 pr-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doMes.map((p) => (
                  <tr key={p.id} onClick={() => props.abrir(p.id)} className="cursor-pointer border-t border-border hover:bg-surface-2">
                    <td className="py-1.5 pr-3 font-os-mono text-xs">{dataCurta(p.data)}</td>
                    <td className="max-w-[18rem] truncate py-1.5 pr-3">{p.titulo}</td>
                    <td className="py-1.5 pr-3 text-muted">{p.formato}</td>
                    {medido(p) ? (
                      <>
                        <td className="com-num py-1.5 pr-3">{n(p.metricas.visualizacoes ?? 0)}</td>
                        <td className="com-num py-1.5 pr-3">{n(p.metricas.alcance ?? 0)}</td>
                        <td className="com-num py-1.5 pr-3">{n(interacoes(p))}</td>
                        <td className="com-num py-1.5 pr-3">{n(p.metricas.salvamentos ?? 0)}</td>
                        <td className="com-num py-1.5 pr-3">{n(p.metricas.novosSeguidores ?? 0)}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="py-1.5 text-xs text-dim">
                        sem números ainda
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Quadro>
      )}
    </div>
  );
}
