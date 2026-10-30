'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  SOCIOS_DA_AGENDA,
  type BloqueioFixo,
  type FeriadoDaAgenda,
  type RegraDaPessoa,
  type RegraEmTexto,
  type RegrasDaAgenda,
  type RitoDaAgenda,
  type SocioDaAgenda,
} from '@mktos/shared';

import { apiGet, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  DIAS_CURTOS,
  POLITICA_DO_RITO,
  ehHora,
  hojeEmSaoPaulo,
  nomesDosFacultativos,
  proximosFeriados,
  quandoDoRito,
  textoDosBloqueios,
} from './regras-formato';

/*
 * A ABA REGRAS (agenda v2, 29/10/2026, lane G2) — desenho `Regras`.
 *
 * `GET /agenda/regras`: a régua de cada sócio, os ritos da casa, a nomenclatura,
 * os feriados e as regras em frase. Ver é de quem vê a agenda; editar só aparece
 * com `podeEditar` (a permissão `agenda.regras`, dos sócios), e toda escrita vai
 * à API, que confere a permissão no banco e audita. Nada aqui apaga: feriado e
 * regra em frase se desligam.
 *
 * As regras em frase são guardadas e listadas; a régua não as interpreta (quem as
 * lê é o vigia AG-01).
 */

const cartao = 'flex flex-col gap-2.5 rounded-[3px] border border-border bg-surface px-[18px] py-4';
const linha = 'flex items-center justify-between gap-2.5 border-t border-border pt-2 text-[13px]';
const valor = 'rounded-[3px] border border-border bg-bg px-2 py-[3px] font-os-mono text-xs text-text';
const rotulo = 'font-os-mono text-[10px] uppercase tracking-[2px] text-muted';
const campo = 'rounded-[3px] border border-border bg-bg px-2 py-1 font-os-mono text-xs text-text outline-none focus:border-brand-dim';
const botao = 'rounded-[3px] border border-border bg-bg px-3 py-1.5 text-[13px] text-text hover:border-brand-dim disabled:opacity-50';
const primario = 'rounded-[3px] border border-brand bg-brand px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-brand/90 disabled:opacity-50';

function Selo({ ligado, sim, nao }: { ligado: boolean; sim: string; nao: string }) {
  return (
    <span
      className={`rounded-[3px] px-2 py-[3px] font-os-mono text-[10px] font-bold tracking-[1px] ${ligado ? 'bg-brand text-ink' : 'border border-border-strong text-muted'}`}
    >
      {ligado ? sim : nao}
    </span>
  );
}

/** O selo que vira botão para quem pode editar. */
function Alternar({ ligado, sim, nao, podeEditar, aoTrocar, rotuloAcessivel }: {
  ligado: boolean; sim: string; nao: string; podeEditar: boolean; aoTrocar: () => void; rotuloAcessivel: string;
}) {
  if (!podeEditar) return <Selo ligado={ligado} sim={sim} nao={nao} />;
  return (
    <button type="button" onClick={aoTrocar} aria-pressed={ligado} aria-label={rotuloAcessivel} title={ligado ? 'Clique para desligar' : 'Clique para ligar'}>
      <Selo ligado={ligado} sim={sim} nao={nao} />
    </button>
  );
}

type Erro = string | null;

/* --------------------------------------------------------------- a régua de um sócio */

function CartaoDaPessoa({ p, podeEditar, token, aoSalvar }: { p: RegraDaPessoa; podeEditar: boolean; token: string | null; aoSalvar: (p: RegraDaPessoa) => void }) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(p);
  const [erro, setErro] = useState<Erro>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setRascunho(p), [p]);

  const salvar = () => {
    if (!ehHora(rascunho.janela.inicio) || !ehHora(rascunho.janela.fim) || rascunho.janela.inicio >= rascunho.janela.fim) {
      setErro('A janela vai de HH:MM a HH:MM, com o fim depois do começo.');
      return;
    }
    setSalvando(true);
    setErro(null);
    apiPut<RegraDaPessoa>(
      `/agenda/regras/pessoa/${encodeURIComponent(p.id)}`,
      {
        area: rascunho.area?.trim() || null,
        janela: rascunho.janela,
        intervaloMin: rascunho.intervaloMin,
        trajetoMin: rascunho.trajetoMin,
        tetoPorDia: rascunho.tetoPorDia,
        bloqueiosFixos: rascunho.bloqueiosFixos.map((b) => ({ diaDaSemana: b.diaDaSemana, inicio: b.inicio, fim: b.fim || null })),
        emailPessoal: rascunho.emailPessoal?.trim() || null,
        fechadoLigado: rascunho.fechadoLigado,
        substituto: rascunho.substituto,
      },
      token,
    )
      .then((novo) => { aoSalvar(novo); setEditando(false); })
      .catch((e: Error) => setErro(e.message))
      .finally(() => setSalvando(false));
  };

  const num = (k: 'intervaloMin' | 'trajetoMin' | 'tetoPorDia', max: number) => (
    <input
      type="number"
      min={0}
      max={max}
      className={`${campo} w-20 text-right`}
      value={rascunho[k]}
      aria-label={k}
      onChange={(e) => setRascunho({ ...rascunho, [k]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) })}
    />
  );

  const bloqueio = (i: number, b: BloqueioFixo) => (
    <div key={i} className="flex flex-wrap items-center gap-1">
      <select className={campo} value={b.diaDaSemana} aria-label="dia do bloqueio" onChange={(e) => trocarBloqueio(i, { ...b, diaDaSemana: Number(e.target.value) })}>
        {DIAS_CURTOS.map((d, n) => <option key={d} value={n}>{d}</option>)}
      </select>
      <input type="time" className={campo} value={b.inicio} aria-label="início do bloqueio" onChange={(e) => trocarBloqueio(i, { ...b, inicio: e.target.value })} />
      <input type="time" className={campo} value={b.fim ?? ''} aria-label="fim do bloqueio" onChange={(e) => trocarBloqueio(i, { ...b, fim: e.target.value || null })} />
      <button type="button" className="text-xs text-muted hover:text-text" onClick={() => setRascunho({ ...rascunho, bloqueiosFixos: rascunho.bloqueiosFixos.filter((_, n) => n !== i) })}>tirar</button>
    </div>
  );
  const trocarBloqueio = (i: number, b: BloqueioFixo) =>
    setRascunho({ ...rascunho, bloqueiosFixos: rascunho.bloqueiosFixos.map((x, n) => (n === i ? b : x)) });

  return (
    <section className={cartao} data-regra-pessoa={p.nome}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[17px] font-bold">{p.nome}</span>
        {editando ? (
          <input className={`${campo} w-44`} value={rascunho.area ?? ''} aria-label="área" onChange={(e) => setRascunho({ ...rascunho, area: e.target.value })} />
        ) : (
          <span className="font-os-mono text-[11px] text-muted">{p.area ?? ''}</span>
        )}
      </div>
      <div className={linha}>
        <span>Janela de trabalho</span>
        {editando ? (
          <span className="flex items-center gap-1">
            <input type="time" className={campo} value={rascunho.janela.inicio} aria-label="início da janela" onChange={(e) => setRascunho({ ...rascunho, janela: { ...rascunho.janela, inicio: e.target.value } })} />
            <span className="text-xs text-muted">a</span>
            <input type="time" className={campo} value={rascunho.janela.fim} aria-label="fim da janela" onChange={(e) => setRascunho({ ...rascunho, janela: { ...rascunho.janela, fim: e.target.value } })} />
          </span>
        ) : (
          <span className={valor}>{p.janela.inicio} a {p.janela.fim}</span>
        )}
      </div>
      <div className={linha}><span>Intervalo entre reuniões</span>{editando ? num('intervaloMin', 240) : <span className={valor}>{p.intervaloMin} min</span>}</div>
      <div className={linha}><span>Trajeto antes de presencial</span>{editando ? num('trajetoMin', 480) : <span className={valor}>{p.trajetoMin} min</span>}</div>
      <div className={linha}><span>Máximo de reuniões por dia</span>{editando ? num('tetoPorDia', 30) : <span className={valor}>{p.tetoPorDia}</span>}</div>
      <div className={linha}>
        <span>Agenda pessoal como Fechado</span>
        {editando ? (
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={rascunho.fechadoLigado} onChange={(e) => setRascunho({ ...rascunho, fechadoLigado: e.target.checked })} /> ligada
          </label>
        ) : (
          <Selo ligado={p.fechadoLigado} sim="LIGADA" nao="A LIGAR" />
        )}
      </div>
      {editando ? (
        <div className={linha}>
          <span>E-mail da agenda pessoal</span>
          <input type="email" className={`${campo} w-48`} placeholder="só livre/ocupado" value={rascunho.emailPessoal ?? ''} aria-label="e-mail da agenda pessoal" onChange={(e) => setRascunho({ ...rascunho, emailPessoal: e.target.value })} />
        </div>
      ) : (
        p.fechadoLigado && !p.emailPessoal && (
          <p className="text-[11px] text-warn">Ligada, mas sem o e-mail da agenda pessoal: nada é lido até um sócio cadastrar.</p>
        )
      )}
      <div className={linha}>
        <span>Bloqueio fixo</span>
        {editando ? (
          <span className="flex flex-col items-end gap-1">
            {rascunho.bloqueiosFixos.map((b, i) => bloqueio(i, b))}
            <button type="button" className="text-xs text-brand" onClick={() => setRascunho({ ...rascunho, bloqueiosFixos: [...rascunho.bloqueiosFixos, { diaDaSemana: 1, inicio: '12:00', fim: '13:00' }] })}>
              + bloqueio
            </button>
          </span>
        ) : (
          <span className={valor}>{textoDosBloqueios(p.bloqueiosFixos)}</span>
        )}
      </div>
      <div className={linha}>
        <span>Substituto quando Fora</span>
        {editando ? (
          <select className={campo} value={rascunho.substituto ?? ''} aria-label="substituto" onChange={(e) => setRascunho({ ...rascunho, substituto: (e.target.value || null) as SocioDaAgenda | null })}>
            <option value="">ninguém</option>
            {SOCIOS_DA_AGENDA.filter((s) => s !== p.nome).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <span className={valor}>{p.substituto ?? 'ninguém'}</span>
        )}
      </div>
      <div className={linha}>
        <span>E-mail no OS (convite)</span>
        {p.email ? <span className="font-os-mono text-[11px] text-muted">{p.email}</span> : <span className="font-os-mono text-[11px] text-warn">sem e-mail na Equipe</span>}
      </div>
      {podeEditar && (
        <div className="flex gap-2 pt-1">
          {editando ? (
            <>
              <button type="button" className={primario} onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
              <button type="button" className={botao} onClick={() => { setRascunho(p); setEditando(false); setErro(null); }}>Cancelar</button>
            </>
          ) : (
            <button type="button" className={botao} onClick={() => setEditando(true)}>Editar {p.nome}</button>
          )}
        </div>
      )}
      {erro && <p className="text-xs text-mag" role="alert">{erro}</p>}
    </section>
  );
}

/* --------------------------------------------------------------- os ritos */

function LinhaDoRito({ r, podeEditar, token, aoSalvar }: { r: RitoDaAgenda; podeEditar: boolean; token: string | null; aoSalvar: (r: RitoDaAgenda) => void }) {
  const [editando, setEditando] = useState(false);
  const [inicio, setInicio] = useState(r.inicio ?? '');
  const [erro, setErro] = useState<Erro>(null);
  const salvar = (corpo: Record<string, unknown>) =>
    apiPut<RitoDaAgenda>(`/agenda/ritos/${encodeURIComponent(r.id)}`, corpo, token)
      .then((novo) => { aoSalvar(novo); setEditando(false); setErro(null); })
      .catch((e: Error) => setErro(e.message));
  return (
    <tr data-rito={r.nome} className={r.ligado ? '' : 'opacity-60'}>
      <td className="border-t border-border px-2 py-[7px] align-top text-[12.5px]">
        {r.nome}
        {r.aDecidir && <span className="ml-1.5 font-os-mono text-[10px] text-warn" title="Horário semeado sem fonte que o confirme">[a decidir]</span>}
        {erro && <span className="block text-[11px] text-mag" role="alert">{erro}</span>}
      </td>
      <td className="border-t border-border px-2 py-[7px] align-top font-os-mono text-[12.5px]">
        {editando ? (
          <span className="flex items-center gap-1">
            <input type="time" className={campo} value={inicio} aria-label={`horário de ${r.nome}`} onChange={(e) => setInicio(e.target.value)} />
            <button type="button" className="text-xs text-brand" onClick={() => salvar({ inicio: inicio || null })}>salvar</button>
          </span>
        ) : (
          <span>{quandoDoRito(r)}</span>
        )}
      </td>
      <td className="border-t border-border px-2 py-[7px] align-top text-[12.5px]">{r.quem}</td>
      <td className="border-t border-border px-2 py-[7px] align-top text-[12.5px]">
        {podeEditar ? (
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" className="underline decoration-dotted" onClick={() => salvar({ politica: r.politica === 'bloqueia' ? 'pergunta' : 'bloqueia' })} title="Trocar entre perguntar antes e bloquear">
              {POLITICA_DO_RITO[r.politica]}
            </button>
            <button type="button" className="text-xs text-muted hover:text-text" onClick={() => salvar({ ligado: !r.ligado })}>{r.ligado ? 'desligar' : 'ligar'}</button>
            {!editando && r.inicio !== null && <button type="button" className="text-xs text-muted hover:text-text" onClick={() => setEditando(true)}>horário</button>}
          </span>
        ) : (
          <span>{r.ligado ? POLITICA_DO_RITO[r.politica] : 'desligado'}</span>
        )}
      </td>
    </tr>
  );
}

/* --------------------------------------------------------------- a aba */

const NOMENCLATURA: Array<[string, string, boolean]> = [
  ['Cliente', 'Reunião Online|Presencial - Cliente - Responsável', false],
  ['Interna', 'Reunião Interna - Sócio ou Todos', false],
  ['Bloqueio', 'Fechado Nome', true],
  ['Ausência', 'Nome Fora - motivo', true],
  ['Pessoal', 'Pessoal - Nome', true],
];

export function AbaRegras() {
  const { token, ready } = useAuth();
  const [regras, setRegras] = useState<RegrasDaAgenda | null>(null);
  const [erro, setErro] = useState<Erro>(null);
  const [aviso, setAviso] = useState<Erro>(null);
  const [novaFrase, setNovaFrase] = useState('');
  const [novaCidade, setNovaCidade] = useState({ data: '', nome: '', cidade: '' });
  const [abrirCidade, setAbrirCidade] = useState(false);

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<RegrasDaAgenda>('/agenda/regras', token).then((r) => { setRegras(r); setErro(null); }).catch((e: Error) => setErro(e.message));
  }, [token]);
  useEffect(() => { if (ready && token) carregar(); }, [ready, token, carregar]);

  if (erro) return <p className="text-sm text-mag" role="alert">{erro}</p>;
  if (!regras) return <p className="text-sm text-muted">Lendo as regras…</p>;

  const pode = regras.podeEditar;
  const trocar = <T extends { id: string }>(lista: T[], novo: T) => lista.map((x) => (x.id === novo.id ? novo : x));
  const falhou = (e: Error) => setAviso(e.message);

  const facultativos = regras.feriados.filter((f) => f.tipo === 'facultativo');
  const facultativosLigados = facultativos.some((f) => f.ligado);
  const municipais = regras.feriados.filter((f) => f.tipo === 'municipal');

  const alternarFacultativos = () => {
    setAviso(null);
    Promise.all(facultativos.map((f) => apiPut<FeriadoDaAgenda>(`/agenda/feriados/${encodeURIComponent(f.id)}`, { ligado: !facultativosLigados }, token)))
      .then((novos) => setRegras((r) => (r ? { ...r, feriados: novos.reduce((l, n) => trocar(l, n), r.feriados) } : r)))
      .catch(falhou);
  };

  const alternarFeriado = (f: FeriadoDaAgenda) =>
    apiPut<FeriadoDaAgenda>(`/agenda/feriados/${encodeURIComponent(f.id)}`, { ligado: !f.ligado }, token)
      .then((n) => setRegras((r) => (r ? { ...r, feriados: trocar(r.feriados, n) } : r)))
      .catch(falhou);

  const adicionarCidade = () => {
    setAviso(null);
    apiPost<FeriadoDaAgenda>('/agenda/feriados', { data: novaCidade.data, nome: novaCidade.nome.trim(), cidade: novaCidade.cidade.trim() }, token)
      .then((f) => {
        setRegras((r) => (r ? { ...r, feriados: [...r.feriados.filter((x) => x.id !== f.id), f].sort((a, b) => a.data.localeCompare(b.data)) } : r));
        setNovaCidade({ data: '', nome: '', cidade: '' });
        setAbrirCidade(false);
      })
      .catch(falhou);
  };

  const alternarTexto = (t: RegraEmTexto) =>
    apiPut<RegraEmTexto>(`/agenda/regras-texto/${encodeURIComponent(t.id)}`, { ligada: !t.ligada }, token)
      .then((n) => setRegras((r) => (r ? { ...r, textos: trocar(r.textos, n) } : r)))
      .catch(falhou);

  const criarTexto = () =>
    apiPost<RegraEmTexto>('/agenda/regras-texto', { frase: novaFrase.trim() }, token)
      .then((n) => { setRegras((r) => (r ? { ...r, textos: [...r.textos, n] } : r)); setNovaFrase(''); })
      .catch(falhou);

  const proximos = proximosFeriados(regras.feriados, hojeEmSaoPaulo());

  return (
    <div className="font-central-sans flex flex-col gap-5" data-aba-regras="">
      <div>
        <div className="font-os-mono text-[10px] font-bold uppercase tracking-[4px] text-mag">// regras · só sócios editam</div>
        <h2 className="mt-1 text-[28px] font-bold leading-tight tracking-[-1px]">
          A régua que roda <span className="text-brand">antes de qualquer marcação.</span>
        </h2>
        <p className="mt-1.5 max-w-[760px] text-sm text-muted">
          Vale para a tela, o celular, o link do cliente, o WhatsApp e os agentes. Quem marca vê o semáforo; ninguém precisa decorar regra.
        </p>
        {!pode && <p className="mt-1 text-xs text-muted">Você vê as regras; editar é dos sócios (permissão de regras da agenda).</p>}
        {aviso && <p className="mt-1 text-xs text-mag" role="alert">{aviso}</p>}
      </div>

      {regras.pessoas.length === 0 ? (
        <p className="text-sm text-muted">Esta empresa não tem regras de agenda: elas nascem só na empresa da casa.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {regras.pessoas.map((p) => (
            <CartaoDaPessoa key={p.id} p={p} podeEditar={pode} token={token} aoSalvar={(n) => setRegras((r) => (r ? { ...r, pessoas: trocar(r.pessoas, n) } : r))} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={cartao}>
          <span className={rotulo}>Ritos da casa</span>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  {['Rito', 'Quando', 'Quem', 'Se alguém marca em cima'].map((h) => (
                    <th key={h} className="px-2 pb-1 font-os-mono text-[10px] font-medium uppercase tracking-[2px] text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {regras.ritos.map((r) => (
                  <LinhaDoRito key={r.id} r={r} podeEditar={pode} token={token} aoSalvar={(n) => setRegras((x) => (x ? { ...x, ritos: trocar(x.ritos, n) } : x))} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={cartao}>
          <span className={rotulo}>Nomenclatura · o título nasce sozinho</span>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                {['Tipo', 'Forma', ''].map((h, i) => (
                  <th key={i} className="px-2 pb-1 font-os-mono text-[10px] font-medium uppercase tracking-[2px] text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOMENCLATURA.map(([tipo, forma, novo]) => (
                <tr key={tipo}>
                  <td className="border-t border-border px-2 py-[7px] text-[12.5px]">{tipo}</td>
                  <td className="border-t border-border px-2 py-[7px] font-os-mono text-[12.5px]">{forma}</td>
                  <td className={`border-t border-border px-2 py-[7px] font-os-mono text-[12.5px] ${novo ? 'text-warn' : 'text-muted'}`}>{novo ? 'novo' : 'já vale'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={cartao} data-feriados="">
          <span className={rotulo}>Feriados</span>
          <div className="flex items-center justify-between gap-2.5 text-[13px]">
            <span>Nacionais</span>
            <Selo ligado sim="FECHAM A AGENDA" nao="" />
          </div>
          {facultativos.length > 0 && (
            <div className={linha}>
              <span>Facultativos ({nomesDosFacultativos(regras.feriados)})</span>
              <Alternar ligado={facultativosLigados} sim="SÓ AVISAM" nao="DESLIGADOS" podeEditar={pode} aoTrocar={alternarFacultativos} rotuloAcessivel="facultativos" />
            </div>
          )}
          <div className={linha}>
            <span>Municipais</span>
            {pode ? (
              <button type="button" className={valor} onClick={() => setAbrirCidade((v) => !v)}>adicionar cidade…</button>
            ) : (
              <span className={valor}>{municipais.length ? `${municipais.length} cadastrado(s)` : 'nenhum'}</span>
            )}
          </div>
          {abrirCidade && pode && (
            <div className="flex flex-wrap items-center gap-1.5" data-nova-cidade="">
              <input type="date" className={campo} value={novaCidade.data} aria-label="data do feriado municipal" onChange={(e) => setNovaCidade({ ...novaCidade, data: e.target.value })} />
              <input className={campo} placeholder="nome do feriado" value={novaCidade.nome} aria-label="nome do feriado municipal" onChange={(e) => setNovaCidade({ ...novaCidade, nome: e.target.value })} />
              <input className={campo} placeholder="cidade" value={novaCidade.cidade} aria-label="cidade" onChange={(e) => setNovaCidade({ ...novaCidade, cidade: e.target.value })} />
              <button type="button" className={primario} disabled={!novaCidade.data || novaCidade.nome.trim().length < 2 || novaCidade.cidade.trim().length < 2} onClick={adicionarCidade}>Adicionar</button>
            </div>
          )}
          {municipais.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span><span className="font-os-mono">{f.data.slice(8, 10)}/{f.data.slice(5, 7)}/{f.data.slice(0, 4)}</span> {f.nome} · {f.cidade}</span>
              <Alternar ligado={f.ligado} sim="FECHA" nao="DESLIGADO" podeEditar={pode} aoTrocar={() => alternarFeriado(f)} rotuloAcessivel={`feriado ${f.nome}`} />
            </div>
          ))}
          <div className={linha}>
            <span>Próximo</span>
            <span className="font-os-mono text-xs">{proximos.length ? proximos.join(' · ') : 'nenhum cadastrado'}</span>
          </div>
        </section>

        <section className={cartao} data-regras-em-frase="">
          <span className={rotulo}>Regras em frase · o agente lê e a régua aplica</span>
          {regras.textos.length === 0 && <p className="text-[13px] text-muted">Nenhuma regra em frase.</p>}
          {regras.textos.map((t, i) => (
            <div key={t.id} className={i === 0 ? 'flex items-center justify-between gap-2.5 text-[13px]' : linha}>
              <span>{t.frase}</span>
              <Alternar ligado={t.ligada} sim="LIGADA" nao="DESLIGADA" podeEditar={pode} aoTrocar={() => alternarTexto(t)} rotuloAcessivel={t.frase} />
            </div>
          ))}
          <p className="text-[11px] text-dim">A régua não interpreta frase: o vigia da agenda lê estas regras.</p>
          {pode && (
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${campo} min-w-0 flex-1`} placeholder="Nova regra em uma frase" value={novaFrase} aria-label="nova regra em frase" onChange={(e) => setNovaFrase(e.target.value)} />
              <button type="button" className={botao} onClick={criarTexto} disabled={novaFrase.trim().length < 3}>+ Nova regra</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
