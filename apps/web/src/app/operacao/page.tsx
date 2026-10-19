'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { OperacaoPainelConteudo, OperacaoPainelResposta } from '@mktos/shared';
import { ErroDaApi, apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card, Chip } from '../referencias/ui';
import { ROTULO_DO_ESTADO, TOM_DO_ESTADO, atrasado, data, diasEntre, hoje, reais } from './formato';

/*
 * ============================================================================
 * OPERAÇÃO DA ROOT — a rodada semanal do painel, em tela
 * ============================================================================
 *
 * Tela da ROOT (sessão da plataforma), como Propostas: a API recusa qualquer
 * outra sessão com 403 e esta tela explica em vez de quebrar. Só leitura: a
 * rodada é escrita pela rotina `painel-root-semanal` (script
 * `importar-painel-operacao`), a partir de `Root/11-operacao/painel-root.md`.
 * Marcar algo como feito é na nota; a rodada seguinte traz.
 */

const BASE = '/tenants/plataforma/operacao/painel';
const ORDEM_DO_ESTADO = { erro: 0, atencao: 1, neutro: 2, ok: 3 } as const;
const COR_DO_PONTO = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', muted: 'bg-muted' } as const;

type Conteudo = OperacaoPainelConteudo;

export default function Operacao() {
  const { token, ready } = useAuth();
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [dados, setDados] = useState<OperacaoPainelResposta | null>(null);
  const [rodada, setRodada] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      await apiGet<{ plataforma: true }>('/tenants/plataforma/quem-sou', token);
      setAutorizado(true);
      const caminho = rodada ? `${BASE}?rodada=${encodeURIComponent(rodada)}` : BASE;
      setDados(await apiGet<OperacaoPainelResposta>(caminho, token));
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 403) setAutorizado(false);
      else setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [token, rodada]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  if (!ready || (carregando && !dados)) return <Aviso>carregando…</Aviso>;

  if (autorizado === false) {
    return (
      <Aviso>
        <p className="text-[12px] text-text">Esta área é da ROOT.</p>
        <p className="mt-2 text-[11.5px] leading-[1.6] text-muted">
          O painel da operação é visto pela sessão de quem opera a plataforma.
        </p>
      </Aviso>
    );
  }

  const c = dados?.conteudo ?? null;
  const ehAUltima = !!dados?.rodada && dados.rodada === dados.rodadas[0];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-os-mono text-[13px] font-bold tracking-[-0.01em] text-text">Operação da Root</h1>
          <p className="mt-1 max-w-[720px] text-[11.5px] leading-[1.6] text-muted">
            {c
              ? `Rodada de ${data(c.rodadaEm)}${c.proximaEm ? ` · próxima em ${data(c.proximaEm)}` : ''}.`
              : 'O que foi feito, o que falta, o que cobrar e o que decidir, cliente a cliente.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dados && dados.rodadas.length > 1 && (
            <select
              aria-label="rodada"
              value={dados.rodada ?? ''}
              onChange={(e) => setRodada(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 font-os-mono text-[11px] outline-none focus:border-brand-dim"
            >
              {dados.rodadas.map((r) => (
                <option key={r} value={r}>
                  {data(r)}
                </option>
              ))}
            </select>
          )}
          <Botao tone="ghost" onClick={() => void carregar()}>
            recarregar
          </Botao>
        </div>
      </header>

      {erro && <div className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-[11.5px] text-bad">{erro}</div>}

      {!dados?.rodada ? (
        !erro && (
          <Card>
            <p className="text-[11.5px] leading-[1.6] text-muted">
              Nenhuma rodada importada ainda. A rotina <span className="font-os-mono">painel-root-semanal</span> roda
              às segundas, às 8h, e cada rodada aparece aqui quando é importada.
            </p>
          </Card>
        )
      ) : !c ? (
        <Card>
          <p className="text-[11.5px] leading-[1.6] text-muted">
            A rodada de {data(dados.rodada)} foi importada num formato que esta tela não sabe desenhar. Reimporte a
            rodada com a versão atual do script.
          </p>
        </Card>
      ) : (
        <Painel c={c} referencia={ehAUltima ? hoje() : c.rodadaEm} importadaEm={dados.importadaEm} />
      )}
    </div>
  );
}

function Painel({ c, referencia, importadaEm }: { c: Conteudo; referencia: string; importadaEm: string | null }) {
  const somaFechado = c.dinheiro.fechado.reduce((n, f) => n + f.valorCentavos, 0);
  const confirmados = c.dinheiro.fechado.filter((f) => f.confirmado);
  const somaConfirmada = confirmados.reduce((n, f) => n + f.valorCentavos, 0);
  const somaEmAberto = c.dinheiro.emAberto.reduce((n, f) => n + f.valorCentavos, 0);
  const comAlerta = c.clientes.filter((x) => x.estado === 'erro' || x.estado === 'atencao').length;
  const travados = c.clientes.filter((x) => x.estado === 'erro').length;
  const itens = c.ondas.flatMap((o) => o.itens);
  const feitos = itens.filter((i) => i.feito).length;
  const vencidos = itens.filter((i) => atrasado(i.prazo, i.feito, referencia)).length;
  const pendentes = c.decisoes.filter((d) => !d.decidida);
  const clientes = [...c.clientes].sort((a, b) => ORDEM_DO_ESTADO[a.estado] - ORDEM_DO_ESTADO[b.estado]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Indicador
          label="fechado"
          valor={reais(somaFechado)}
          nota={
            confirmados.length === 0
              ? 'nenhum recebimento confirmado'
              : `${reais(somaConfirmada)} confirmado`
          }
          tom={confirmados.length < c.dinheiro.fechado.length ? 'warn' : 'muted'}
        />
        <Indicador
          label="em aberto"
          valor={reais(somaEmAberto)}
          nota={`${c.dinheiro.emAberto.length} proposta(s)${c.dinheiro.emAberto.some((e) => e.estimado) ? ', com estimativa' : ''}`}
        />
        <Indicador
          label="clientes com alerta"
          valor={`${comAlerta} de ${c.clientes.length}`}
          nota={`${travados} travado(s)`}
          tom={travados > 0 ? 'bad' : 'muted'}
        />
        <Indicador
          label="itens das ondas"
          valor={`${feitos}/${itens.length}`}
          nota={`${vencidos} vencido(s)`}
          tom={vencidos > 0 ? 'bad' : 'muted'}
        />
      </div>

      {pendentes.length > 0 && (
        <section className="rounded-xl border border-warn/40 bg-warn/5 p-5">
          <h2 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-warn">
            decidir · {pendentes.length}
          </h2>
          <ul className="mt-3 space-y-2">
            {pendentes.map((d) => (
              <li key={d.texto} className="flex gap-2.5 text-[12.5px] leading-[1.55] text-text">
                <Ponto tom="warn" />
                <span>{d.texto}</span>
              </li>
            ))}
          </ul>
          {c.decisoes.length > pendentes.length && (
            <p className="mt-3 text-[10.5px] text-muted">
              {c.decisoes.length - pendentes.length} já decidida(s) nesta rodada.
            </p>
          )}
        </section>
      )}

      {c.mudancas.length > 0 && (
        <Card titulo="o que mudou desde a rodada anterior">
          <Lista itens={c.mudancas} />
        </Card>
      )}

      <Card titulo="ondas">
        <div className="space-y-5">
          {c.ondas.map((o) => {
            const feitosDaOnda = o.itens.filter((i) => i.feito).length;
            return (
              <details key={o.numero} open={o.prazo !== null} className="group">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-[13px] font-semibold text-text">
                      <span className="mr-1.5 font-os-mono text-muted">{o.numero}</span>
                      {o.titulo}
                    </h3>
                    <span className="shrink-0 font-os-mono text-[10.5px] text-muted">
                      {feitosDaOnda}/{o.itens.length}
                      {o.prazo && ` · até ${data(o.prazo, true)}`}
                    </span>
                  </div>
                  <Barra valor={feitosDaOnda} total={o.itens.length} />
                </summary>
                <ul className="mt-2 divide-y divide-border">
                  {o.itens.map((i) => {
                    const vencido = atrasado(i.prazo, i.feito, referencia);
                    return (
                      <li key={i.texto} className="flex gap-3 py-2.5">
                        <Marca feito={i.feito} />
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-[12.5px] leading-[1.55] ${i.feito ? 'text-muted line-through' : 'text-text'}`}
                          >
                            {i.texto}
                          </p>
                          {i.detalhe && <p className="mt-0.5 text-[11px] leading-[1.55] text-muted">{i.detalhe}</p>}
                          {(i.cliente || i.prazo) && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {i.cliente && <Chip>{i.cliente}</Chip>}
                              {i.prazo && (
                                <Chip tone={vencido ? 'bad' : 'muted'}>
                                  {vencido ? 'venceu em ' : 'até '}
                                  {data(i.prazo, true)}
                                </Chip>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      </Card>

      <Card titulo={`clientes · ${c.clientes.length}`}>
        <div className="grid gap-3 md:grid-cols-2">
          {clientes.map((x) => (
            <Cliente key={x.chave} cliente={x} />
          ))}
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card titulo={`fechado · ${reais(somaFechado)}`}>
          <ul className="divide-y divide-border">
            {c.dinheiro.fechado.map((f) => (
              <li key={f.cliente} className="py-2.5">
                <LinhaDeValor nome={f.cliente} valor={f.valorTexto} />
                <p className="mt-0.5 text-[11px] leading-[1.55] text-muted">{f.recebimento}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Chip tone={f.confirmado ? 'good' : 'warn'}>{f.confirmado ? 'recebido' : 'não confirmado'}</Chip>
                  <span className="text-[10.5px] text-muted">{f.fonte}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card titulo={`em aberto · ${reais(somaEmAberto)}`}>
          <ul className="divide-y divide-border">
            {c.dinheiro.emAberto.map((e) => (
              <li key={e.cliente} className="py-2.5">
                <LinhaDeValor nome={e.cliente} valor={e.valorTexto} />
                <p className="mt-0.5 text-[11px] leading-[1.55] text-muted">{e.situacao}</p>
                {e.estimado && (
                  <div className="mt-1.5">
                    <Chip tone="warn">estimado</Chip>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {c.leads.length > 0 && (
        <Card titulo={`leads parados · ${c.leads.length}`}>
          <ul className="divide-y divide-border">
            {[...c.leads]
              .map((l) => ({ ...l, dias: l.ultimoMovimento ? diasEntre(l.ultimoMovimento, c.rodadaEm) : null }))
              .sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1))
              .map((l) => (
                <li key={l.nome} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] font-semibold text-text">{l.nome}</span>
                    <Chip tone={l.dias !== null && l.dias >= 14 ? 'warn' : 'muted'}>
                      {l.dias === null ? 'sem data' : `${l.dias} dia(s) parado`}
                    </Chip>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-[1.55] text-muted">{l.falta}</p>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {c.interno.length > 0 && (
          <Card titulo="interno">
            <Lista itens={c.interno} />
          </Card>
        )}
        {c.padrao.length > 0 && (
          <Card titulo="o padrão">
            <Lista itens={c.padrao} />
          </Card>
        )}
      </div>

      {c.tamanho.length > 0 && <Tamanho grupos={c.tamanho} />}

      <Card titulo="fontes e lacunas">
        <div className="flex flex-wrap gap-1.5">
          {c.fontes.map((f) => (
            <Chip key={f}>{f}</Chip>
          ))}
        </div>
        {c.lacunas.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {c.lacunas.map((l) => (
              <li key={l} className="flex gap-2.5 text-[11.5px] leading-[1.55] text-muted">
                <Ponto tom="warn" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 font-os-mono text-[10.5px] leading-[1.6] text-muted">
          nota: {c.notaFonte}
          {importadaEm && ` · importada em ${new Date(importadaEm).toLocaleString('pt-BR')}`}
        </p>
      </Card>
    </>
  );
}

function Cliente({ cliente: x }: { cliente: Conteudo['clientes'][number] }) {
  const tom = TOM_DO_ESTADO[x.estado];
  const abertos = x.fazer.filter((f) => !f.feito).length;
  return (
    <article className="rounded-lg border border-border bg-bg2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-text">{x.nome}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {x.contato} · {x.valorTexto}
          </p>
        </div>
        <Chip tone={tom}>{ROTULO_DO_ESTADO[x.estado]}</Chip>
      </div>
      <p className="mt-2 text-[12px] leading-[1.55] text-text">{x.motivo}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip>fazer {abertos}</Chip>
        <Chip>cobrar {x.cobrar.length}</Chip>
        <Chip>decidir {x.decidir.length}</Chip>
        <Chip>feito {x.feito.length}</Chip>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer font-os-mono text-[10.5px] text-muted hover:text-text">ver detalhes</summary>
        <div className="mt-3 space-y-3">
          {x.fazer.length > 0 && (
            <Bloco titulo="fazer">
              <ul className="space-y-1.5">
                {x.fazer.map((f) => (
                  <li key={f.texto} className="flex gap-2.5">
                    <Marca feito={f.feito} />
                    <span className={f.feito ? 'text-muted line-through' : ''}>{f.texto}</span>
                  </li>
                ))}
              </ul>
            </Bloco>
          )}
          {x.cobrar.length > 0 && (
            <Bloco titulo="cobrar">
              <Lista itens={x.cobrar} />
            </Bloco>
          )}
          {x.decidir.length > 0 && (
            <Bloco titulo="decidir">
              <Lista itens={x.decidir} />
            </Bloco>
          )}
          {x.feito.length > 0 && (
            <Bloco titulo="feito">
              <Lista itens={x.feito} />
            </Bloco>
          )}
        </div>
      </details>
    </article>
  );
}

function Tamanho({ grupos }: { grupos: Conteudo['tamanho'] }) {
  const maior = Math.max(1, ...grupos.map((g) => g.brutas));
  const brutas = grupos.reduce((n, g) => n + g.brutas, 0);
  const acionaveis = grupos.reduce((n, g) => n + g.acionaveis, 0);
  return (
    <Card titulo={`tamanho real · ${acionaveis} acionáveis de ${brutas} brutas`}>
      <div className="space-y-1.5">
        {grupos.map((g) => (
          <div key={g.grupo} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-[11.5px]">
            <span className="truncate text-muted" title={g.grupo}>
              {g.grupo}
            </span>
            <span className="relative h-1.5 overflow-hidden rounded bg-surface-2">
              <span
                className="absolute inset-y-0 left-0 bg-muted/50"
                style={{ width: `${Math.round((g.brutas / maior) * 100)}%` }}
              />
              <span
                className="absolute inset-y-0 left-0 bg-text"
                style={{ width: `${Math.round((g.acionaveis / maior) * 100)}%` }}
              />
            </span>
            <span className="text-right font-os-mono text-muted">
              <span className="text-text">{g.acionaveis}</span>/{g.brutas}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10.5px] leading-[1.6] text-muted">
        Barra cheia: acionáveis. Barra clara: total bruto, com referência, duplicata e checklist.
      </p>
    </Card>
  );
}

function Indicador({
  label,
  valor,
  nota,
  tom = 'muted',
}: {
  label: string;
  valor: string;
  nota: string;
  tom?: 'warn' | 'bad' | 'muted';
}) {
  const cor = { warn: 'text-warn', bad: 'text-bad', muted: 'text-muted' }[tom];
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums md:text-2xl">{valor}</p>
      <p className={`mt-1 text-[10.5px] leading-[1.4] ${cor}`}>{nota}</p>
    </div>
  );
}

function LinhaDeValor({ nome, valor }: { nome: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12.5px] font-semibold text-text">{nome}</span>
      <span className="text-right font-os-mono text-[11.5px] text-text">{valor}</span>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="text-[11.5px] leading-[1.55] text-text">
      <h4 className="mb-1.5 font-os-mono text-[10px] uppercase tracking-[0.14em] text-muted">{titulo}</h4>
      {children}
    </div>
  );
}

function Lista({ itens }: { itens: string[] }) {
  return (
    <ul className="space-y-1.5 text-[11.5px] leading-[1.55] text-text">
      {itens.map((t) => (
        <li key={t} className="flex gap-2.5">
          <Ponto tom="muted" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function Ponto({ tom }: { tom: keyof typeof COR_DO_PONTO }) {
  return <span aria-hidden className={`mt-[0.45em] h-1.5 w-1.5 shrink-0 rounded-full ${COR_DO_PONTO[tom]}`} />;
}

function Marca({ feito }: { feito: boolean }) {
  return (
    <span
      role="img"
      aria-label={feito ? 'feito' : 'a fazer'}
      className={`mt-[0.2em] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
        feito ? 'border-good bg-good text-bg' : 'border-border'
      }`}
    >
      {feito && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
    </span>
  );
}

function Barra({ valor, total }: { valor: number; total: number }) {
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={valor}
      className="mt-2 block h-1.5 overflow-hidden rounded bg-surface-2"
    >
      <span className="block h-full bg-good" style={{ width: `${total ? Math.round((valor / total) * 100) : 0}%` }} />
    </span>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[520px] border border-border bg-bg2 p-6 font-os-mono text-[11px] text-muted">
      {children}
    </div>
  );
}
