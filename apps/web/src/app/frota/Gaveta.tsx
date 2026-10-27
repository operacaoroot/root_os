'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { Botao, Chip, inputCls } from '../referencias/ui';
import { Aba, Barra, Estado, Mono, Rotulo, Terminal, Vazio } from './ui';
import { CAMPOS_DA_FICHA, CAMPOS_LGPD, ETAPA, TIPO_DE_EVENTO, dh, haQuanto, type Acesso, type CasaDetalhe, type Ordem } from './tipos';

type AbaDaGaveta = 'resumo' | 'apps' | 'registro' | 'acessos' | 'pendencias' | 'ficha' | 'verificar' | 'ordens';
const ABAS: [AbaDaGaveta, string][] = [
  ['resumo', 'Resumo'], ['apps', 'Apps'], ['registro', 'Registro'], ['acessos', 'Acessos'], ['pendencias', 'Pendências'], ['ficha', 'Ficha e LGPD'], ['verificar', 'Verificar'], ['ordens', 'Ordens'],
];

const ORDEM: Record<string, string> = { revogar_chave: 'revogar chave', desligar_automacao: 'desligar automação', rodar_verificar: 'rodar kit-verificar', pedir_backup: 'pedir backup' };
const TOM_DA_ORDEM: Record<string, 'good' | 'warn' | 'bad' | 'muted'> = { pendente: 'warn', entregue: 'warn', aplicada: 'good', falhou: 'bad', cancelada: 'muted' };

export function Gaveta({
  id,
  token,
  abaInicial = 'resumo',
  podeAgir,
  onFechar,
  onMudou,
  onRevogar,
}: {
  id: string;
  token: string;
  abaInicial?: AbaDaGaveta;
  podeAgir: boolean;
  onFechar: () => void;
  onMudou: () => void;
  onRevogar: (acesso: Acesso, casa: CasaDetalhe) => void;
}) {
  const [aba, setAba] = useState<AbaDaGaveta>(abaInicial);
  const [casa, setCasa] = useState<CasaDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tokenNovo, setTokenNovo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setCasa(await apiGet<CasaDetalhe>(`/frota/casas/${id}`, token));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id, token]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    const t = setInterval(() => { void carregar(); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);
  useEffect(() => {
    const fechar = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [onFechar]);

  const agir = async (fn: () => Promise<unknown>, feito: string) => {
    setAviso(null);
    try {
      await fn();
      setAviso(feito);
      await carregar();
      onMudou();
    } catch (e) {
      setAviso(`Não deu: ${(e as Error).message}`);
    }
  };

  const ordem = (tipo: string, parametros?: Record<string, string>, motivo?: string) =>
    agir(() => apiPost(`/frota/casas/${id}/ordens`, { tipo, parametros, motivo }, token), `Ordem "${ORDEM[tipo]}" enfileirada. A casa puxa no próximo relato (até 5 min).`);

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onFechar} aria-hidden />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[720px] flex-col border-l border-border bg-surface" aria-label="Ficha do servidor">
        <header className="border-b border-border px-5 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-os-mono text-[18px] font-bold tracking-[-0.02em] text-text">{casa?.casa ?? '…'}</h2>
              <p className="mt-0.5 truncate text-[12px] text-muted">{casa ? `${casa.cliente}${casa.dono ? ` · ${casa.dono}` : ''}` : ''}</p>
            </div>
            <button type="button" onClick={onFechar} className="rounded-root border border-border px-2 py-1 font-os-mono text-[11px] text-muted hover:text-text">fechar ✕</button>
          </div>
          {casa && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Estado estado={casa.estado} texto={casa.estadoTexto} />
              <Mono className="text-muted">relato {haQuanto(casa.ultimoRelatoEm)}</Mono>
              <Mono className="text-muted">· {ETAPA[casa.etapa] ?? casa.etapa}</Mono>
            </div>
          )}
          <div className="mt-2 flex gap-0.5 overflow-x-auto" role="tablist">
            {ABAS.map(([k, n]) => (
              <Aba key={k} ativa={aba === k} onClick={() => setAba(k)} contagem={k === 'pendencias' ? casa?.pendencias.filter((p) => p.n !== 'ne').length : k === 'ordens' ? casa?.ordens.filter((o) => o.estado === 'pendente' || o.estado === 'entregue').length : undefined} tom="warn">{n}</Aba>
            ))}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[12.5px]">
          {erro && <p className="mb-3 rounded-root border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">{erro}</p>}
          {aviso && <p className="mb-3 rounded-root border border-border bg-surface-2 px-3 py-2 text-[12px] text-text">{aviso}</p>}
          {!casa ? <p className="text-muted">carregando…</p> : (
            <>
              {aba === 'resumo' && <Resumo casa={casa} />}
              {aba === 'apps' && <Apps casa={casa} />}
              {aba === 'registro' && <Registro casa={casa} />}
              {aba === 'acessos' && <Acessos casa={casa} podeAgir={podeAgir} onRevogar={(a) => onRevogar(a, casa)} />}
              {aba === 'pendencias' && <Pendencias casa={casa} />}
              {aba === 'ficha' && <Ficha casa={casa} token={token} podeAgir={podeAgir} onSalvo={() => agir(async () => undefined, 'Ficha salva.')} />}
              {aba === 'verificar' && (casa.verificar.length ? <Terminal linhas={casa.verificar} /> : <Vazio>Sem saída do kit-verificar: a casa ainda não relatou.</Vazio>)}
              {aba === 'ordens' && (
                <Ordens
                  casa={casa}
                  podeAgir={podeAgir}
                  tokenNovo={tokenNovo}
                  onOrdem={ordem}
                  onCancelar={(o) => agir(() => apiPost(`/frota/ordens/${o.id}/cancelar`, {}, token), 'Ordem cancelada.')}
                  onGirarToken={() => agir(async () => { const r = await apiPost<{ token: string }>(`/frota/casas/${id}/token`, {}, token); setTokenNovo(r.token); }, 'Token trocado. Copie agora: ele não aparece de novo.')}
                  onArquivar={() => agir(() => apiPatch(`/frota/casas/${id}`, { arquivada: true }, token), 'Casa arquivada. Ela sai da frota, o registro fica.')}
                />
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function Campo({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <Rotulo>{k}</Rotulo>
      <span className={`${mono ? 'font-os-mono text-[11.5px]' : 'text-[12.5px]'} break-words text-text`}>{v ?? '—'}</span>
    </div>
  );
}

function Resumo({ casa }: { casa: CasaDetalhe }) {
  const discoTom = (casa.disco ?? 0) >= 85 ? 'bad' : (casa.disco ?? 0) >= 70 ? 'warn' : undefined;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Campo k="responsável na ROOT" v={casa.responsavel} mono={false} />
        <Campo k="provedor" v={casa.provedor} mono={false} />
        <Campo k="hostname · ip" v={`${casa.hostname ?? '—'} · ${casa.ip ?? '—'}`} />
        <Campo k="vpn" v={casa.vpn} />
        <Campo k="sistema" v={casa.sistema} />
        <Campo k="máquina" v={casa.maquina} />
        <Campo k="kit" v={casa.kitVersao ?? 'não instalado'} />
        <Campo k="acesso" v={casa.acesso} />
        <Campo k="sonda" v={casa.sonda ? `${casa.sonda.estado}${casa.sonda.ultima ? ` · ${casa.sonda.ultima}` : ''}` : 'sem sonda'} />
        <Campo k="backup" v={casa.backup?.ultimoOk ? `${dh(casa.backup.ultimoOk)} · ${casa.backup.remoto ? 'local + cópia fora' : 'só local'}` : 'nunca rodou'} />
        <Campo k="apps no ar" v={`${casa.apps.rodando} de ${casa.apps.total}`} />
        <Campo k="pessoas com chave" v={casa.chaves} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div><Rotulo>disco {casa.disco !== null ? `${casa.disco}%` : ''}</Rotulo><Barra pct={casa.disco} tom={discoTom} /></div>
        <div><Rotulo>cpu {casa.cpuPct !== null ? `${casa.cpuPct}%` : ''}</Rotulo><Barra pct={casa.cpuPct} tom={(casa.cpuPct ?? 0) >= 90 ? 'warn' : undefined} /></div>
        <div><Rotulo>memória {casa.memPct !== null ? `${casa.memPct}%` : ''}</Rotulo><Barra pct={casa.memPct} tom={(casa.memPct ?? 0) >= 90 ? 'warn' : undefined} /></div>
      </div>
      {casa.carga && <Mono className="text-muted">carga: {casa.carga.join(' · ')}</Mono>}
      <div>
        <Rotulo>automações no catálogo</Rotulo>
        {casa.timers.length ? (
          <table className="mt-1 w-full text-[12px]">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted"><tr><th className="py-1 pr-3">timer</th><th className="py-1 pr-3">última</th><th className="py-1 pr-3">próxima</th><th className="py-1">estado</th></tr></thead>
            <tbody>{casa.timers.map((t) => (
              <tr key={t.unidade} className="border-t border-border"><td className="py-1 pr-3"><Mono>{t.unidade}</Mono></td><td className="py-1 pr-3"><Mono>{t.ultima ?? '—'}</Mono></td><td className="py-1 pr-3"><Mono>{t.proxima ?? '—'}</Mono></td><td className="py-1"><Chip tone={t.ativo === false ? 'muted' : 'good'}>{t.ativo === false ? 'desligada' : 'ativa'}</Chip></td></tr>
            ))}</tbody>
          </table>
        ) : <Vazio>Nenhum timer relatado.</Vazio>}
      </div>
      {casa.observacoes && <div><Rotulo>observações</Rotulo><p className="whitespace-pre-wrap text-[12.5px] text-text">{casa.observacoes}</p></div>}
    </div>
  );
}

function Apps({ casa }: { casa: CasaDetalhe }) {
  if (!casa.containers.length) return <Vazio>Nenhum container relatado ainda.</Vazio>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[12px]">
        <thead className="text-left text-[10px] uppercase tracking-wide text-muted"><tr><th className="py-1 pr-3">container</th><th className="py-1 pr-3">imagem</th><th className="py-1 pr-3">criado</th><th className="py-1">estado</th></tr></thead>
        <tbody>{casa.containers.map((c) => (
          <tr key={c.nome} className="border-t border-border">
            <td className="py-1.5 pr-3"><Mono className="font-bold">{c.nome}</Mono></td>
            <td className="py-1.5 pr-3"><Mono className="text-muted">{c.imagem}</Mono></td>
            <td className="py-1.5 pr-3"><Mono className="text-muted">{c.criado ?? '—'}</Mono></td>
            <td className="py-1.5"><Chip tone={c.estado === 'running' && c.saude !== 'unhealthy' ? 'good' : 'bad'}>{c.estado === 'running' ? (c.saude === 'unhealthy' ? 'unhealthy' : 'no ar') : c.estado}</Chip></td>
          </tr>
        ))}</tbody>
      </table>
      <p className="mt-2 font-os-mono text-[10px] text-muted">fonte: docker ps com label dono={casa.casa}, pelo kit-relatar</p>
    </div>
  );
}

function Registro({ casa }: { casa: CasaDetalhe }) {
  if (!casa.eventos.length) return <Vazio>Nada registrado ainda.</Vazio>;
  return (
    <div>
      {casa.eventos.map((e) => (
        <div key={e.id} className="grid grid-cols-[92px_1fr] gap-3 border-t border-border py-2 first:border-t-0 first:pt-0">
          <div className="font-os-mono text-[10.5px] leading-[1.5] text-muted">{dh(e.quando)}<br /><span className="text-text">{e.quem}</span></div>
          <div className="min-w-0 text-[12.5px] text-text">{e.acao}<span className="mt-0.5 block font-os-mono text-[10px] text-muted">{e.origem} · {TIPO_DE_EVENTO[e.tipo] ?? e.tipo}</span></div>
        </div>
      ))}
    </div>
  );
}

function Acessos({ casa, podeAgir, onRevogar }: { casa: CasaDetalhe; podeAgir: boolean; onRevogar: (a: Acesso) => void }) {
  if (!casa.acessos.length) return <Vazio>Nenhuma chave relatada. As chaves aparecem no primeiro relato do kit-relatar (authorized_keys).</Vazio>;
  const tom = (a: Acesso): 'good' | 'warn' | 'bad' | 'muted' => (a.estado === 'ativa' ? (/^sem dono/i.test(a.pessoa) ? 'warn' : 'good') : a.estado === 'revogando' ? 'warn' : 'muted');
  const rotulo = (a: Acesso) => (a.estado === 'ativa' ? (/^sem dono/i.test(a.pessoa) ? 'sem dono' : 'ativa') : a.estado);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12px]">
        <thead className="text-left text-[10px] uppercase tracking-wide text-muted"><tr><th className="py-1 pr-3">pessoa</th><th className="py-1 pr-3">chave</th><th className="py-1 pr-3">desde</th><th className="py-1 pr-3">último login</th><th className="py-1 pr-3">por onde</th><th className="py-1 pr-3">estado</th><th className="py-1" /></tr></thead>
        <tbody>{casa.acessos.map((a) => (
          <tr key={a.id} className="border-t border-border">
            <td className="py-1.5 pr-3 text-text">{a.pessoa}</td>
            <td className="py-1.5 pr-3"><Mono className="text-muted">{a.tipo ?? ''} {a.fingerprint ? `…${a.fingerprint.slice(-14)}` : '—'}</Mono></td>
            <td className="py-1.5 pr-3"><Mono>{dh(a.desde)}</Mono></td>
            <td className="py-1.5 pr-3"><Mono>{a.ultimoLogin ? dh(a.ultimoLogin) : 'nunca entrou'}</Mono></td>
            <td className="py-1.5 pr-3 text-muted">{a.via ?? '—'}</td>
            <td className="py-1.5 pr-3"><Chip tone={tom(a)}>{rotulo(a)}</Chip>{a.estado !== 'ativa' && a.revogadoEm && <span className="block font-os-mono text-[10px] text-muted">{dh(a.revogadoEm)}{a.revogadoPor ? ` · ${a.revogadoPor}` : ''}</span>}</td>
            <td className="py-1.5">{podeAgir && a.estado === 'ativa' && a.fingerprint && <Botao tone="bad" onClick={() => onRevogar(a)}>Revogar</Botao>}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="mt-2 font-os-mono text-[10px] text-muted">fonte: comentário e impressão digital de cada linha do authorized_keys. A chave em si nunca sai do servidor.</p>
    </div>
  );
}

function Pendencias({ casa }: { casa: CasaDetalhe }) {
  if (!casa.pendencias.length) return <Vazio>Nada pendente nesta casa.</Vazio>;
  return (
    <div className="space-y-2">
      {casa.pendencias.map((p, i) => (
        <div key={i} className="flex gap-3 rounded-root border border-border bg-surface-2 px-3 py-2">
          <div className="pt-0.5"><Estado estado={p.n} /></div>
          <div className="min-w-0 text-[12.5px] text-text">{p.t}<span className="block font-os-mono text-[10px] text-muted">{p.b}</span></div>
        </div>
      ))}
      <div className="pt-3">
        <Rotulo>políticas nesta casa</Rotulo>
        <div className="mt-1 space-y-1">
          {casa.politicasAvaliadas.map((p) => (
            <div key={p.cod} className="flex items-start gap-2 text-[12px]"><Estado estado={p.estado} /><span className="text-text">P-{p.cod} · {p.nome}<span className="block text-[11px] text-muted">{p.detalhe}</span></span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Ficha({ casa, token, podeAgir, onSalvo }: { casa: CasaDetalhe; token: string; podeAgir: boolean; onSalvo: () => void }) {
  const [ficha, setFicha] = useState<Record<string, string>>({ ...casa.ficha });
  const [lgpd, setLgpd] = useState<Record<string, string>>({ ...casa.lgpd });
  const [cabecalho, setCabecalho] = useState({ cliente: casa.cliente, dono: casa.dono ?? '', responsavel: casa.responsavel ?? '', etapa: casa.etapa, provedor: casa.provedor ?? '', ip: casa.ip ?? '', observacoes: casa.observacoes ?? '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const salvar = async () => {
    setSalvando(true); setErro(null);
    try {
      await apiPatch(`/frota/casas/${casa.id}`, { ...cabecalho, ficha, lgpd }, token);
      onSalvo();
    } catch (e) { setErro((e as Error).message); } finally { setSalvando(false); }
  };
  const campo = (label: string, valor: string, set: (v: string) => void, dica?: string, longo = false) => (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-muted">{label}{dica ? <span className="text-dim"> · {dica}</span> : null}</span>
      {longo ? <textarea className={`${inputCls} min-h-[56px]`} value={valor} onChange={(e) => set(e.target.value)} disabled={!podeAgir} /> : <input className={inputCls} value={valor} onChange={(e) => set(e.target.value)} disabled={!podeAgir} />}
    </label>
  );
  return (
    <div className="space-y-5">
      <div>
        <Rotulo>ficha</Rotulo>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {campo('Cliente', cabecalho.cliente, (v) => setCabecalho({ ...cabecalho, cliente: v }))}
          {campo('Dono (pessoa)', cabecalho.dono, (v) => setCabecalho({ ...cabecalho, dono: v }))}
          {campo('Responsável na ROOT', cabecalho.responsavel, (v) => setCabecalho({ ...cabecalho, responsavel: v }))}
          <label className="block"><span className="mb-0.5 block text-[11px] text-muted">Etapa</span>
            <select className={inputCls} value={cabecalho.etapa} onChange={(e) => setCabecalho({ ...cabecalho, etapa: e.target.value })} disabled={!podeAgir}>
              {Object.entries(ETAPA).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
          {campo('Provedor', cabecalho.provedor, (v) => setCabecalho({ ...cabecalho, provedor: v }), 'e de quem é a conta')}
          {campo('IP público', cabecalho.ip, (v) => setCabecalho({ ...cabecalho, ip: v }))}
          {CAMPOS_DA_FICHA.map((c) => <div key={c.k}>{campo(c.label, ficha[c.k] ?? '', (v) => setFicha({ ...ficha, [c.k]: v }), c.dica)}</div>)}
        </div>
        <div className="mt-2">{campo('Observações', cabecalho.observacoes, (v) => setCabecalho({ ...cabecalho, observacoes: v }), undefined, true)}</div>
      </div>
      <div>
        <Rotulo>registro de tratamento (LGPD)</Rotulo>
        <p className="mb-2 text-[11.5px] text-muted">O cliente é o controlador e a ROOT é a operadora. É o que o cliente mostra se a ANPD perguntar; sai daqui para o relatório dele.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {CAMPOS_LGPD.map((c) => <div key={c.k} className={c.k === 'dados' || c.k === 'ia' ? 'sm:col-span-2' : ''}>{campo(c.label, lgpd[c.k] ?? '', (v) => setLgpd({ ...lgpd, [c.k]: v }), c.dica, c.k === 'dados' || c.k === 'ia')}</div>)}
        </div>
      </div>
      {erro && <p className="text-[12px] text-bad">{erro}</p>}
      {podeAgir && <Botao tone="brand" onClick={salvar} disabled={salvando}>{salvando ? 'salvando…' : 'Salvar ficha'}</Botao>}
    </div>
  );
}

function Ordens({ casa, podeAgir, tokenNovo, onOrdem, onCancelar, onGirarToken, onArquivar }: {
  casa: CasaDetalhe; podeAgir: boolean; tokenNovo: string | null;
  onOrdem: (tipo: string, parametros?: Record<string, string>, motivo?: string) => void;
  onCancelar: (o: Ordem) => void; onGirarToken: () => void; onArquivar: () => void;
}) {
  const [unidade, setUnidade] = useState('');
  const [confirmaArquivar, setConfirmaArquivar] = useState(false);
  const [confirmaToken, setConfirmaToken] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    if (!tokenNovo) return;
    try { await navigator.clipboard.writeText(tokenNovo); setCopiado(true); } catch { setCopiado(false); }
  };
  return (
    <div className="space-y-5">
      {podeAgir && (
        <div>
          <Rotulo>o que a casa pode receber</Rotulo>
          <p className="mb-2 text-[11.5px] text-muted">A ordem entra na fila; o kit-relatar puxa no próximo relato e devolve o resultado aqui. O painel não entra no servidor.</p>
          <div className="flex flex-wrap gap-2">
            <Botao onClick={() => onOrdem('rodar_verificar')}>Rodar kit-verificar agora</Botao>
            <Botao onClick={() => onOrdem('pedir_backup')}>Pedir backup agora</Botao>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block min-w-[220px]"><span className="mb-0.5 block text-[11px] text-muted">Desligar automação (timer)</span>
              <select className={inputCls} value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                <option value="">escolha…</option>
                {casa.timers.filter((t) => t.ativo !== false).map((t) => <option key={t.unidade} value={t.unidade}>{t.unidade}</option>)}
              </select>
            </label>
            <Botao tone="bad" disabled={!unidade} onClick={() => { onOrdem('desligar_automacao', { unidade }, 'desligada pelo painel'); setUnidade(''); }}>Desligar</Botao>
          </div>
        </div>
      )}
      <div>
        <Rotulo>fila e histórico</Rotulo>
        {casa.ordens.length ? (
          <table className="mt-1 w-full text-[12px]">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted"><tr><th className="py-1 pr-3">quando</th><th className="py-1 pr-3">ordem</th><th className="py-1 pr-3">por</th><th className="py-1 pr-3">estado</th><th className="py-1" /></tr></thead>
            <tbody>{casa.ordens.map((o) => (
              <tr key={o.id} className="border-t border-border align-top">
                <td className="py-1.5 pr-3"><Mono>{dh(o.criadaEm)}</Mono></td>
                <td className="py-1.5 pr-3 text-text">{ORDEM[o.tipo] ?? o.tipo}{o.parametros && typeof o.parametros === 'object' && ('pessoa' in o.parametros || 'unidade' in o.parametros) ? <span className="text-muted"> · {String((o.parametros as Record<string, unknown>).pessoa ?? (o.parametros as Record<string, unknown>).unidade)}</span> : null}{o.motivo && <span className="block text-[11px] text-muted">{o.motivo}</span>}{o.resultado?.mensagem && <span className="block font-os-mono text-[10.5px] text-muted">{o.resultado.mensagem}</span>}</td>
                <td className="py-1.5 pr-3 text-muted">{o.criadaPor}</td>
                <td className="py-1.5 pr-3"><Chip tone={TOM_DA_ORDEM[o.estado] ?? 'muted'}>{o.estado}</Chip>{o.concluidaEm && <span className="block font-os-mono text-[10px] text-muted">{dh(o.concluidaEm)}</span>}</td>
                <td className="py-1.5">{podeAgir && o.estado === 'pendente' && <Botao tone="ghost" onClick={() => onCancelar(o)}>cancelar</Botao>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Vazio>Nenhuma ordem ainda.</Vazio>}
      </div>
      {podeAgir && (
        <div className="space-y-3 border-t border-border pt-4">
          <Rotulo>token do relator</Rotulo>
          {tokenNovo ? (
            <div className="rounded-root border border-warn/50 bg-warn/10 p-3">
              <p className="text-[11.5px] text-text">Token novo. Copie agora e grave em <Mono>/etc/kit/maquina.env</Mono> (FROTA_TOKEN) da casa; ele não aparece de novo.</p>
              <div className="mt-2 flex items-center gap-2"><code className="break-all font-os-mono text-[11px] text-text">{tokenNovo}</code><Botao onClick={copiar}>{copiado ? 'copiado' : 'copiar'}</Botao></div>
            </div>
          ) : confirmaToken ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]"><span className="text-muted">O token atual deixa de valer na hora; o relator para até receber o novo.</span><Botao tone="bad" onClick={() => { setConfirmaToken(false); onGirarToken(); }}>Trocar o token</Botao><Botao tone="ghost" onClick={() => setConfirmaToken(false)}>deixar</Botao></div>
          ) : <Botao onClick={() => setConfirmaToken(true)}>Trocar o token do relator</Botao>}
          <Rotulo>arquivar</Rotulo>
          {confirmaArquivar ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]"><span className="text-muted">A casa some da frota; o registro e os acessos ficam guardados.</span><Botao tone="bad" onClick={onArquivar}>Arquivar {casa.casa}</Botao><Botao tone="ghost" onClick={() => setConfirmaArquivar(false)}>deixar</Botao></div>
          ) : <Botao tone="ghost" onClick={() => setConfirmaArquivar(true)}>Arquivar esta casa (fim de contrato)</Botao>}
        </div>
      )}
    </div>
  );
}
