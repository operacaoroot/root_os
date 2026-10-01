'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErroDaApi, apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card, Chip, Kpi } from '../referencias/ui';
import {
  ETAPAS,
  quando,
  tempo,
  type DetalheDaProposta,
  type ListaDePropostas,
  type PropostaNaLista,
} from './tipos';

/*
 * ============================================================================
 * PROPOSTAS COMERCIAIS — quem recebeu, quem leu e quem quer pagar
 * ============================================================================
 *
 * Tela da ROOT (sessão da plataforma), não de cliente: a API recusa qualquer
 * outra sessão com 403 e esta tela explica em vez de quebrar — o mesmo desenho
 * do console da plataforma. Só leitura: as páginas e o rastreio moram no serviço
 * de propostas (proposta.operacaoroot.com); o pagamento confirmado mora no Asaas.
 *
 * Sem item de menu, como o console: o endereço /propostas é digitado. O menu é
 * filtrado por permissão, não por "ser a plataforma", e um item aqui apareceria
 * no menu de toda empresa cliente.
 */

const BASE = '/tenants/plataforma/propostas';
const TOM_DA_ETAPA = ['muted', 'muted', 'warn', 'good'] as const;

export default function Propostas() {
  const { token, ready } = useAuth();
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [dados, setDados] = useState<ListaDePropostas | null>(null);
  const [selecionada, setSelecionada] = useState<PropostaNaLista | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheDaProposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      await apiGet<{ plataforma: true }>('/tenants/plataforma/quem-sou', token);
      setAutorizado(true);
      const d = await apiGet<ListaDePropostas>(BASE, token);
      setDados(d);
      setSelecionada((atual) => d.propostas.find((p) => p.chave === atual?.chave) ?? d.propostas[0] ?? null);
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 403) setAutorizado(false);
      else setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  useEffect(() => {
    if (!token || !selecionada) return;
    let vivo = true;
    setDetalhe(null);
    apiGet<DetalheDaProposta>(`${BASE}/${selecionada.cliente}/${selecionada.chave}`, token)
      .then((d) => vivo && setDetalhe(d))
      .catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [token, selecionada]);

  if (!ready || (carregando && !dados)) return <Aviso>carregando…</Aviso>;

  if (autorizado === false) {
    return (
      <Aviso>
        <p className="text-[12px] text-text">Esta área é da ROOT.</p>
        <p className="mt-2 text-[11.5px] leading-[1.6] text-muted">
          As propostas comerciais são vistas pela sessão de quem opera a plataforma.
        </p>
      </Aviso>
    );
  }

  const propostas = dados?.propostas ?? [];
  const conta = (n: number) => propostas.filter((p) => p.etapa >= n).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-os-mono text-[13px] font-bold tracking-[-0.01em] text-text">Propostas</h1>
        <p className="mt-1 max-w-[720px] text-[11.5px] leading-[1.6] text-muted">
          Quem recebeu, quem leu e quem quer pagar. Visitas de aparelhos da equipe não contam; o
          pagamento confirmado aparece no Asaas, no link de cada proposta.
        </p>
      </header>

      {erro && (
        <div className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-[11.5px] text-bad">{erro}</div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="propostas" valor={propostas.length} />
        <Kpi label="abertas" valor={conta(1)} />
        <Kpi label="leram o investimento" valor={conta(2)} />
        <Kpi label="clicaram em pagar" valor={conta(3)} />
      </div>

      <Card
        titulo="clientes"
        acao={
          <Botao tone="ghost" onClick={() => void carregar()}>
            recarregar
          </Botao>
        }
      >
        {propostas.length === 0 ? (
          <p className="text-[11.5px] leading-[1.6] text-muted">
            Nenhuma proposta publicada ainda. Cada proposta nova sai do modelo padrão e aparece aqui
            sozinha quando é publicada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[11.5px]">
              <thead className="font-os-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                <tr>
                  <th className="py-2">cliente</th>
                  <th>situação</th>
                  <th className="text-right">aberturas</th>
                  <th className="text-right">pessoas</th>
                  <th className="text-right">última atividade</th>
                </tr>
              </thead>
              <tbody>
                {propostas.map((p) => {
                  const ativa = p.chave === selecionada?.chave;
                  return (
                    <tr
                      key={p.chave}
                      onClick={() => setSelecionada(p)}
                      className={`cursor-pointer border-t border-border ${ativa ? 'bg-surface-2' : 'hover:bg-surface-2/60'}`}
                    >
                      <td className="py-3 pr-3">
                        <p className="font-semibold text-text">{p.titulo}</p>
                        <p className="mt-0.5 font-os-mono text-[10px] text-muted">
                          {p.link.replace(/^https?:\/\//, '')}
                        </p>
                      </td>
                      <td>
                        <Chip tone={TOM_DA_ETAPA[p.etapa] ?? 'muted'}>{p.estado}</Chip>
                      </td>
                      <td className="text-right font-os-mono">{p.aberturas}</td>
                      <td className="text-right font-os-mono">{p.pessoas}</td>
                      <td className="text-right text-muted">{quando(p.ultimaAtividade)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selecionada && <Detalhe proposta={selecionada} detalhe={detalhe} />}

      {dados && (
        <Card titulo={`aparelhos da equipe · ${dados.aparelhosDaEquipe.length}`}>
          {dados.aparelhosDaEquipe.length === 0 ? (
            <p className="text-[11.5px] text-muted">Nenhum aparelho cadastrado ainda.</p>
          ) : (
            <ul className="space-y-1.5 text-[11.5px]">
              {dados.aparelhosDaEquipe.map((a) => (
                <li key={`${a.nome}-${a.desde}`} className="flex flex-wrap gap-x-3 text-muted">
                  <span className="font-semibold text-text">{a.nome}</span>
                  <span>
                    {a.aparelho}
                    {a.descricao ? ` · ${a.descricao}` : ''}
                  </span>
                  <span>desde {quando(a.desde)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function Detalhe({ proposta, detalhe }: { proposta: PropostaNaLista; detalhe: DetalheDaProposta | null }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = () => {
    void navigator.clipboard
      .writeText(proposta.link)
      .then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1600);
      })
      .catch(() => setCopiado(false));
  };
  const maxMs = Math.max(1, ...(detalhe?.tempoPorParte.map((t) => t.ms) ?? [1]));

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-text">{proposta.titulo}</h2>
          <p className="mt-1 font-os-mono text-[10.5px] text-muted">{proposta.link.replace(/^https?:\/\//, '')}</p>
        </div>
        <div className="flex gap-2">
          <Botao tone="ghost" onClick={copiar}>
            {copiado ? 'link copiado' : 'copiar link'}
          </Botao>
          <a
            href={`${proposta.link}?equipe=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-3 py-1.5 text-[11.5px] text-text hover:border-brand"
          >
            abrir proposta
          </a>
        </div>
      </div>

      <ol className="mt-5 grid grid-cols-2 gap-1.5 md:grid-cols-5">
        {[...ETAPAS, 'Pago'].map((nome, i) => {
          const cumprida = i === 0 || (i <= 3 && proposta.etapa >= i);
          const pago = i === 4;
          return (
            <li
              key={nome}
              className={`rounded-md px-2 py-2 text-center text-[11px] ${
                cumprida ? 'bg-good/15 text-good' : 'bg-surface-2 text-muted'
              }`}
              title={pago ? 'O pagamento confirmado é conferido no Asaas, no link da proposta.' : undefined}
            >
              {nome}
              {pago && <span className="block text-[10px]">confira no Asaas</span>}
            </li>
          );
        })}
      </ol>

      {!detalhe ? (
        <p className="mt-5 text-[11.5px] text-muted">carregando o detalhe…</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="aberturas" valor={detalhe.aberturas} />
            <Kpi label="pessoas" valor={detalhe.pessoas} />
            <Kpi label="tempo de leitura" valor={detalhe.aberturas ? tempo(detalhe.tempoTotalMs) : '–'} />
            <Kpi label="mais vista" valor={detalhe.maisVista ?? '–'} />
          </div>

          {detalhe.tempoPorParte.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">tempo por parte</h3>
              <div className="space-y-1.5">
                {detalhe.tempoPorParte.map((t) => (
                  <div key={t.id} className="grid grid-cols-[9rem_minmax(0,1fr)_6rem] items-center gap-3 text-[11.5px]">
                    <span className={t.nome === detalhe.maisVista ? 'font-semibold text-text' : 'text-muted'}>{t.nome}</span>
                    <span className="h-1.5 overflow-hidden rounded bg-surface-2">
                      <span
                        className={`block h-full ${t.nome === detalhe.maisVista ? 'bg-text' : 'bg-muted'}`}
                        style={{ width: `${Math.round((t.ms / maxMs) * 100)}%` }}
                      />
                    </span>
                    <span className="text-right font-os-mono text-muted">{tempo(t.ms)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6">
            <h3 className="mb-2 font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">visitas</h3>
            {detalhe.visitas.length === 0 ? (
              <p className="text-[11.5px] text-muted">Ainda não abriu.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-[11.5px]">
                  <thead className="font-os-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                    <tr>
                      <th className="py-2">quando</th>
                      <th>quem</th>
                      <th>aparelho</th>
                      <th>tempo</th>
                      <th>leu até</th>
                      <th>pagar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhe.visitas.map((v, i) => (
                      <tr key={`${v.quando}-${i}`} className="border-t border-border text-muted">
                        <td className="py-2">{quando(v.quando)}</td>
                        <td className="text-text">pessoa {v.pessoa}</td>
                        <td>
                          {v.aparelho}
                          {v.descricao ? ` · ${v.descricao}` : ''}
                        </td>
                        <td className="font-os-mono">{tempo(v.tempoMs)}</td>
                        <td>{v.leuAte}</td>
                        <td className={v.clicouEmPagar ? 'text-good' : ''}>{v.clicouEmPagar ? 'clicou' : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[10.5px] leading-[1.6] text-muted">
              &quot;Pessoa&quot; é cada navegador diferente. Uma parte conta como vista com 2 s ou mais na tela.
              {detalhe.visitasDaEquipeIgnoradas > 0 &&
                ` ${detalhe.visitasDaEquipeIgnoradas} abertura(s) da equipe foram ignoradas.`}
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[520px] border border-border bg-bg2 p-6 font-os-mono text-[11px] text-muted">
      {children}
    </div>
  );
}
