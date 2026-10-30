'use client';

import { useState } from 'react';
import { Botao, Card, Chip } from '../referencias/ui';
import { Mono, Rotulo, Vazio } from './ui';
import { d, type CasaDetalhe, type CasaResumo, type FaseDaJornada, type JornadaCompleta, type LinhaDoQuadro, type Resumo, type Situacao } from './tipos';

/*
 * JORNADA — em que ponto do backlog do kit cada casa está, o que anda e o que
 * está parado esperando quem. A fonte é o servidor: `notas/BACKLOG.md` da casa,
 * mexido pelo `kit-jornada`, cruzado com o que o próprio servidor prova, e
 * trazido pelo relator a cada 5 min. A tela só lê; marcar é no servidor.
 */

const MARCA: Record<Situacao, string> = { feito: '☑', regrediu: '✗', esperando: '⧗', andamento: '◐', afazer: '☐', na: '⊘' };
const COR: Record<Situacao, string> = { feito: 'text-good', regrediu: 'text-bad', esperando: 'text-warn', andamento: 'text-brand', afazer: 'text-muted', na: 'text-muted' };
const NOME: Record<Situacao, string> = { feito: 'feito', regrediu: 'regrediu', esperando: 'esperando', andamento: 'em andamento', afazer: 'a fazer', na: 'não se aplica' };

/** As dez fases numa faixa: cheia = fase completa, contorno = fase atual, ponto = algo parado ali. */
export function Trilha({ fases, faseAtual }: { fases: FaseDaJornada[]; faseAtual: number | null }) {
  return (
    <div className="flex gap-0.5" aria-label="trilha das fases">
      {fases.map((f) => {
        const pct = f.conta ? Math.round((100 * f.feito) / f.conta) : 100;
        const atual = f.n === faseAtual;
        return (
          <div
            key={f.n}
            title={`Fase ${f.n} · ${f.nome}: ${f.feito} de ${f.conta}${f.esperando ? ` · ${f.esperando} esperando` : ''}${f.regrediu ? ` · ${f.regrediu} regrediu` : ''}`}
            className={`relative h-2.5 flex-1 overflow-hidden rounded-[2px] border bg-surface-2 ${atual ? 'border-brand' : 'border-border'}`}
          >
            <div className={`h-full ${f.regrediu ? 'bg-bad' : pct === 100 ? 'bg-good' : 'bg-muted'}`} style={{ width: `${pct}%` }} />
            {(f.esperando > 0 || f.regrediu > 0) && <span className={`absolute right-0.5 top-0.5 h-1 w-1 rounded-full ${f.regrediu ? 'bg-bad' : 'bg-warn'}`} />}
          </div>
        );
      })}
    </div>
  );
}

/** Uma linha curta para cartão e tabela. */
export function JornadaCurta({ c }: { c: CasaResumo }) {
  const j = c.jornada;
  if (!j) return <Mono className="text-muted">sem jornada</Mono>;
  return (
    <div className="min-w-[150px] space-y-1">
      <Trilha fases={j.fases} faseAtual={j.faseAtual} />
      <Mono className={j.regrediu.length ? 'text-bad' : 'text-text'}>
        {j.pct}% · fase {j.faseAtual ?? '—'}
        {j.esperando ? <span className="text-warn"> · {j.esperando} esperando</span> : null}
        {j.regrediu.length ? ` · ${j.regrediu.length} regrediu` : ''}
      </Mono>
    </div>
  );
}

/* ------------------------------------------------------- vista da frota */

const COLUNAS: { k: keyof Resumo['jornada']; titulo: string; vazio: string }[] = [
  { k: 'regrediu', titulo: 'regrediu', vazio: 'Nada que estava feito deixou de passar na prova.' },
  { k: 'cliente', titulo: 'esperando o cliente', vazio: 'Nada parado no cliente.' },
  { k: 'root', titulo: 'esperando a ROOT', vazio: 'Nada parado com a ROOT.' },
  { k: 'terceiro', titulo: 'esperando terceiro', vazio: 'Nada parado em terceiro.' },
  { k: 'andamento', titulo: 'em andamento', vazio: 'Nada marcado como em andamento.' },
];

export function JornadaView({ resumo, abrir }: { resumo: Resumo; abrir: (id: string) => void }) {
  const casas = [...resumo.casas].sort((a, b) => (a.jornada?.pct ?? -1) - (b.jornada?.pct ?? -1));
  const semJornada = casas.filter((c) => !c.jornada && c.etapa !== 'pre').length;
  return (
    <div className="space-y-4">
      <p className="max-w-[760px] text-[11.5px] leading-[1.6] text-muted">
        Cada casa relata a própria jornada: o backlog do kit (fases 0 a 9) com a situação marcada no servidor por <Mono>kit-jornada marcar</Mono> e o que o servidor prova sozinho.
        Item que estava feito e perdeu a prova aparece como <span className="text-bad">regrediu</span>.
      </p>
      <Card titulo="casas, da menos adiantada para a mais">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12px]">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted">
              <tr>{['casa', 'trilha (fases 0 a 9)', 'feito', 'fase atual', 'próximo passo', 'parado'].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {casas.map((c) => {
                const j = c.jornada;
                return (
                  <tr key={c.id} onClick={() => abrir(c.id)} className="cursor-pointer border-t border-border align-top hover:bg-surface-2">
                    <td className="px-2 py-2"><Mono className="font-bold">{c.casa}</Mono><span className="block text-[11px] text-muted">{c.cliente}</span></td>
                    <td className="w-[220px] px-2 py-2">{j ? <Trilha fases={j.fases} faseAtual={j.faseAtual} /> : <Mono className="text-muted">sem jornada</Mono>}</td>
                    <td className="px-2 py-2"><Mono>{j ? `${j.pct}%` : '—'}</Mono><span className="block font-os-mono text-[10px] text-muted">{j ? `${j.feitos} de ${j.validos}` : ''}</span></td>
                    <td className="px-2 py-2 text-text">{j?.faseNome ? <>{j.faseAtual} · {j.faseNome}</> : '—'}</td>
                    <td className="px-2 py-2 text-text">{j?.proximo[0] ? <><Mono className="mr-1 text-muted">{j.proximo[0].id}</Mono>{j.proximo[0].item}</> : '—'}</td>
                    <td className="px-2 py-2">
                      {j ? (
                        <div className="flex flex-wrap gap-1">
                          {j.regrediu.length > 0 && <Chip tone="bad">{j.regrediu.length} regrediu</Chip>}
                          {j.porQuem.cliente > 0 && <Chip tone="warn">{j.porQuem.cliente} cliente</Chip>}
                          {j.porQuem.root > 0 && <Chip tone="warn">{j.porQuem.root} ROOT</Chip>}
                          {j.porQuem.terceiro > 0 && <Chip tone="warn">{j.porQuem.terceiro} terceiro</Chip>}
                          {!j.regrediu.length && !j.esperando && <Mono className="text-muted">nada</Mono>}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {semJornada > 0 && (
          <p className="mt-3 text-[11.5px] text-muted">
            {semJornada} casa(s) ainda sem jornada: o kit delas é anterior à jornada. Na estação, <Mono>ferramentas/enviar-kit.sh &lt;casa&gt;</Mono>; no servidor, <Mono>bash /opt/kit-instalacao-vps/etapas/09-relator.sh</Mono> (cria a nota e liga o <Mono>kit-jornada</Mono>).
          </p>
        )}
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {COLUNAS.map((col) => {
          const linhas = resumo.jornada?.[col.k] ?? [];
          return (
            <Card key={col.k} titulo={`${col.titulo} · ${linhas.length}`}>
              {linhas.length ? (
                <div className="space-y-2">
                  {linhas.map((l) => <CartaoDoItem key={`${l.casaId}-${l.id}`} l={l} onClick={() => abrir(l.casaId)} />)}
                </div>
              ) : <Vazio>{col.vazio}</Vazio>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CartaoDoItem({ l, onClick }: { l: LinhaDoQuadro; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="block w-full rounded-root border border-border bg-surface-2 px-2.5 py-2 text-left hover:border-brand/40">
      <span className="block font-os-mono text-[10.5px] text-brand">{l.casa} · {l.id}</span>
      <span className="block text-[12px] leading-[1.45] text-text">{l.item}</span>
      {(l.espera || l.quando) && <span className="block font-os-mono text-[10px] text-warn">{l.espera ? `por ${l.espera}` : ''}{l.quando ? ` desde ${d(l.quando)}` : ''}</span>}
      {l.autoTexto && <span className="block font-os-mono text-[10px] text-bad">{l.autoTexto}</span>}
      {l.nota && <span className="block text-[11px] text-muted">{l.nota}</span>}
    </button>
  );
}

/* ------------------------------------------------------- aba da gaveta */

export function JornadaDaCasa({ casa }: { casa: CasaDetalhe }) {
  const j: JornadaCompleta | null = casa.jornadaCompleta;
  const [abertas, setAbertas] = useState<Set<number> | null>(null);
  if (!j) {
    return (
      <Vazio>
        Esta casa ainda não relata a jornada: o kit dela é anterior. Na estação, <Mono>ferramentas/enviar-kit.sh {casa.casa}</Mono>; no servidor, <Mono>bash /opt/kit-instalacao-vps/etapas/09-relator.sh</Mono>. A jornada chega no relato seguinte.
      </Vazio>
    );
  }
  const interessa = (n: number) => n === j.faseAtual || j.itens.some((i) => i.fase === n && (i.situacao === 'esperando' || i.situacao === 'regrediu' || i.situacao === 'andamento'));
  const aberta = (n: number) => (abertas ? abertas.has(n) : interessa(n));
  const alternar = (n: number) => {
    const atual = new Set(abertas ?? j.fases.filter((f) => interessa(f.n)).map((f) => f.n));
    if (atual.has(n)) atual.delete(n); else atual.add(n);
    setAbertas(atual);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Mono className="text-[14px] font-bold text-text">{j.pct}%</Mono>
        <span className="text-muted">feito · fase atual {j.faseAtual ?? '—'}</span>
        {!j.arquivo && <Chip tone="warn">sem notas/BACKLOG.md: só o que o servidor prova</Chip>}
        <Mono className="ml-auto text-muted">kit {j.kit ?? '?'}</Mono>
      </div>
      <p className="text-[11.5px] leading-[1.6] text-muted">
        Para mudar uma situação, no servidor: <Mono>kit-jornada marcar &lt;ID&gt; feito|andamento|esperando &lt;quem&gt;|nao-se-aplica &quot;nota&quot;</Mono>. Chega aqui no próximo relato.
      </p>
      {j.fases.map((f) => {
        const itens = j.itens.filter((i) => i.fase === f.n);
        const conta = f.total - f.na;
        return (
          <div key={f.n} className={`rounded-root border ${f.n === j.faseAtual ? 'border-brand/50' : 'border-border'} bg-surface-2`}>
            <button type="button" onClick={() => alternar(f.n)} aria-expanded={aberta(f.n)} className="flex w-full items-center gap-3 px-3 py-2 text-left">
              <Mono className="w-[16px] text-muted">{aberta(f.n) ? '▾' : '▸'}</Mono>
              <span className="flex-1 text-[12.5px] text-text">Fase {f.n} · {f.nome}</span>
              <Mono className={f.feito === conta ? 'text-good' : 'text-muted'}>{f.feito}/{conta}</Mono>
            </button>
            {aberta(f.n) && (
              <div className="border-t border-border px-3 py-2">
                {itens.map((i) => (
                  <div key={i.id} className="grid grid-cols-[18px_44px_1fr] gap-2 border-t border-border/60 py-1.5 first:border-t-0">
                    <span className={`font-os-mono text-[12px] ${COR[i.situacao]}`} title={NOME[i.situacao]}>{MARCA[i.situacao]}</span>
                    <Mono className="text-muted">{i.id}</Mono>
                    <div className="min-w-0">
                      <span className={`text-[12px] ${i.situacao === 'na' ? 'text-muted line-through' : 'text-text'}`}>{i.item}</span>
                      <span className="block font-os-mono text-[10px] text-muted">
                        {i.quem ?? ''}
                        {i.situacao === 'esperando' && <span className="text-warn"> · esperando {i.espera ?? '?'}{i.quando ? ` desde ${d(i.quando)}` : ''}</span>}
                        {i.autoTexto && <span className={i.auto === 'falha' ? 'text-bad' : 'text-good'}> · {i.auto === 'falha' ? 'prova falhou: ' : 'provado: '}{i.autoTexto}</span>}
                        {i.projeto && <span> · do projeto</span>}
                      </span>
                      {i.nota && <span className="block text-[11px] text-muted">{i.nota}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Rotulo>legenda</Rotulo>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted">
        {(Object.keys(MARCA) as Situacao[]).map((s) => <span key={s}><span className={COR[s]}>{MARCA[s]}</span> {NOME[s]}</span>)}
      </div>
      {abertas && <Botao onClick={() => setAbertas(null)}>Voltar ao que interessa</Botao>}
    </div>
  );
}
