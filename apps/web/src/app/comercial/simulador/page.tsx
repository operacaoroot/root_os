'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { CelularDaMesa, CelularDoLead, ListaDeCelulares, MensagemNoCelular } from '@mktos/shared';

import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dataHora, explicarEstado, soDigitos } from '@/lib/sala-do-cliente';

/*
 * O SIMULADOR DE WHATSAPP — os celulares do lead e da mesa (telas 01 e 09), Lane B.
 *
 * Provedor `simulado`: nada sai da máquina. À esquerda, os leads com conversa
 * e o "novo lead" (o primeiro oi do Instagram ou do link da bio). No meio, o
 * celular do lead: o que a casa mandou (com formulário e botões renderizados)
 * e o que ele responde. À direita, o celular da mesa: as decisões abertas com
 * os botões e as mensagens esperando o toque de liberar.
 *
 * NADA AQUI É ATALHO DA RÉGUA. Mensagem da casa é a capacidade
 * `comercial.whatsapp.enviar` (R3): ela só aparece "entregue" no celular do
 * lead depois que OUTRA pessoa confirma na fila. O botão "liberar envio" da
 * mesa é a mesma confirmação de `/atendimento`, com a mesma alçada.
 */

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
const INPUT = `w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] outline-none focus:border-brand ${FOCO}`;
const BOTAO = `rounded-lg border border-border px-3 py-1.5 text-[12.5px] transition hover:border-brand disabled:opacity-50 ${FOCO}`;
const BOTAO_PRIMARIO = `rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-ink transition hover:bg-brand/90 disabled:opacity-50 ${FOCO}`;
const ROTULO = 'font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted';

export default function SimuladorPage() {
  const { token, ready } = useAuth();
  const [lista, setLista] = useState<ListaDeCelulares | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [conversa, setConversa] = useState<CelularDoLead | null>(null);
  const [mesa, setMesa] = useState<CelularDaMesa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const [l, m] = await Promise.all([apiGet<ListaDeCelulares>('/comercial/simulador/celulares', token), apiGet<CelularDaMesa>('/comercial/simulador/mesa', token)]);
      setLista(l);
      setMesa(m);
      if (leadId) setConversa(await apiGet<CelularDoLead>(`/comercial/simulador/lead/${leadId}`, token));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token, leadId]);

  useEffect(() => {
    if (!ready || !token) return;
    void carregar();
    const t = setInterval(() => void carregar(), 4000);
    return () => clearInterval(t);
  }, [ready, token, carregar]);

  async function agir(fn: () => Promise<unknown>, ok?: string) {
    setAviso(null);
    try {
      await fn();
      if (ok) setAviso(ok);
      await carregar();
    } catch (e) {
      setAviso((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <p className="text-sm text-muted">
          Os celulares simulados do comercial. Provedor: <span className="font-os-mono">{lista?.provedor ?? '…'}</span>. Nada sai da máquina; toda mensagem da casa passa pela fila de aprovação antes de aparecer como entregue.
        </p>
        {erro && <p role="alert" className="mt-2 text-[13px] text-bad">{erro}</p>}
        {aviso && <p role="status" className="mt-2 text-[13px]">{aviso}</p>}
      </header>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        <aside className="space-y-3">
          <NovoLead aoEntrar={(id) => agir(async () => { setLeadId(id); }, 'Lead entrou. A M1 foi preparada e está na fila.')} token={token} />
          <section className="rounded-xl border border-border bg-surface p-3">
            <h2 className={ROTULO}>leads com conversa</h2>
            <ul className="mt-2 space-y-1">
              {(lista?.leads ?? []).map((l) => (
                <li key={l.leadId}>
                  <button type="button" onClick={() => { setLeadId(l.leadId); setConversa(null); }} className={`w-full rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-2 ${leadId === l.leadId ? 'bg-brand/10' : ''} ${FOCO}`}>
                    <span className="font-semibold">{l.nome}</span>
                    <span className="block font-os-mono text-[10.5px] text-muted">{l.telefone ?? ''} {l.etapa ? `· ${l.etapa}` : ''} {l.naFila ? `· ${l.naFila} na fila` : ''}</span>
                  </button>
                </li>
              ))}
              {lista && !lista.leads.length && <li className="text-[12.5px] text-muted">Nenhum lead ainda. Comece pelo novo lead acima.</li>}
            </ul>
          </section>
        </aside>

        <Celular titulo={conversa ? conversa.nome : 'celular do lead'} subtitulo={conversa?.telefone ?? 'escolha um lead'}>
          {conversa ? <ConversaDoLead c={conversa} token={token} agir={agir} /> : <p className="p-4 text-[12.5px] text-muted">Escolha um lead à esquerda.</p>}
        </Celular>

        <Celular titulo="Vigia Root" subtitulo="WhatsApp interno da mesa">
          {mesa ? <CelularDaMesaView mesa={mesa} token={token} agir={agir} /> : <p className="p-4 text-[12.5px] text-muted">carregando…</p>}
        </Celular>
      </div>
    </div>
  );
}

type Agir = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

function Celular({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-[420px] flex-col overflow-hidden rounded-[24px] border border-border bg-bg shadow-sm">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-3">
        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-brand/15 text-[13px] font-bold text-brand">{titulo.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold">{titulo}</div>
          <div className="truncate font-os-mono text-[10.5px] text-muted">{subtitulo}</div>
        </div>
      </div>
      <div className="flex max-h-[70vh] min-h-[420px] flex-col">{children}</div>
    </section>
  );
}

function NovoLead({ token, aoEntrar }: { token: string | null; aoEntrar: (leadId: string) => void }) {
  const [telefone, setTelefone] = useState('');
  const [nome, setNome] = useState('');
  const [texto, setTexto] = useState('Oi! Vi o vídeo do fechamento do mês em 1 dia. Funciona com Omie?');
  const [palavra, setPalavra] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <form
      className="space-y-2 rounded-xl border border-border bg-surface p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        setErro(null);
        try {
          const r = await apiPost<{ leadId: string }>('/comercial/simulador/entrada', { telefone: soDigitos(telefone), texto: texto.trim(), ...(nome.trim() ? { nome: nome.trim() } : {}), ...(palavra.trim() ? { palavraChave: palavra.trim() } : {}) }, token);
          aoEntrar(r.leadId);
          setTelefone('');
          setNome('');
        } catch (err) {
          setErro((err as Error).message);
        } finally {
          setEnviando(false);
        }
      }}
    >
      <h2 className={ROTULO}>novo lead</h2>
      <input className={INPUT} placeholder="telefone com DDD" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} aria-label="telefone" />
      <input className={INPUT} placeholder="nome (opcional)" value={nome} onChange={(e) => setNome(e.target.value)} aria-label="nome" />
      <input className={INPUT} placeholder="palavra-chave (opcional)" value={palavra} onChange={(e) => setPalavra(e.target.value)} aria-label="palavra-chave" />
      <textarea className={INPUT} rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="primeira mensagem" />
      <button type="submit" disabled={enviando || soDigitos(telefone).length < 10 || !texto.trim()} className={`${BOTAO_PRIMARIO} w-full`}>
        {enviando ? 'enviando…' : 'mandar o primeiro oi'}
      </button>
      {erro && <p role="alert" className="text-[12px] text-bad">{erro}</p>}
    </form>
  );
}

function ConversaDoLead({ c, token, agir }: { c: CelularDoLead; token: string | null; agir: Agir }) {
  const [texto, setTexto] = useState('');
  const base = `/comercial/simulador/lead/${c.leadId}/responder`;
  return (
    <>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {c.linkDaSala && (
          <p className="text-center font-os-mono text-[10.5px] text-muted">
            sala: <a href={c.linkDaSala} target="_blank" rel="noreferrer" className="underline underline-offset-2">abrir</a>
          </p>
        )}
        {c.mensagens.map((m) => (
          <div key={m.id}>
            <Bolha m={m} aoResponderForm={(f) => agir(() => apiPost(base, { formulario: f }, token), 'Formulário respondido.')} aoTocar={(chave) => agir(() => apiPost(base, { botao: chave }, token), 'Horário escolhido.')} />
            {m.template === 'M6' && m.estado === 'rascunho' && <Novidade id={m.id} token={token} agir={agir} />}
          </div>
        ))}
      </div>
      <form
        className="flex gap-2 border-t border-border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!texto.trim()) return;
          void agir(() => apiPost(base, { texto: texto.trim() }, token));
          setTexto('');
        }}
      >
        <input className={INPUT} placeholder="o lead escreve…" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="mensagem do lead" />
        <button type="submit" className={BOTAO_PRIMARIO} disabled={!texto.trim()}>enviar</button>
      </form>
    </>
  );
}

function Bolha({ m, aoResponderForm, aoTocar }: { m: MensagemNoCelular; aoResponderForm: (f: Record<string, unknown>) => void; aoTocar: (chave: string) => void }) {
  const doLead = m.direcao === 'entrada';
  const entregue = m.estado === 'enviada';
  return (
    <div className={`flex ${doLead ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] ${doLead ? 'bg-brand/15' : 'border border-border bg-surface'} ${!doLead && !entregue ? 'border-dashed opacity-70' : ''}`}>
        {m.template && <div className="font-os-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">{m.template}</div>}
        <p className="whitespace-pre-wrap">{m.texto}</p>
        {m.interativo?.formulario && <FormularioNaConversa campos={m.interativo.formulario.campos} ativo={entregue} aoEnviar={aoResponderForm} />}
        {m.interativo?.botoes && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.interativo.botoes.map((b) => (
              <button key={b.chave} type="button" disabled={!entregue} onClick={() => aoTocar(b.chave)} className={BOTAO}>{b.rotulo}</button>
            ))}
          </div>
        )}
        <div className="mt-1 flex items-center justify-between gap-2 font-os-mono text-[9.5px] text-muted">
          <span>{dataHora(m.enviadaEm ?? m.em)}</span>
          {!doLead && <span className={entregue ? 'text-brand' : m.estado === 'falhou' ? 'text-bad' : ''}>{explicarEstado(m.estado, m.vetoAte)}</span>}
        </div>
        {m.estado === 'falhou' && m.erro && <p className="mt-1 text-[11px] text-bad">{m.erro}</p>}
        {m.estado === 'rascunho' && m.erro && <p className="mt-1 text-[11px] text-muted">{m.erro}</p>}
      </div>
    </div>
  );
}

function FormularioNaConversa({ campos, ativo, aoEnviar }: { campos: { chave: string; rotulo: string; tipo: string }[]; ativo: boolean; aoEnviar: (f: Record<string, unknown>) => void }) {
  const [v, setV] = useState<Record<string, string>>({});
  const pronto = campos.every((c) => (v[c.chave] ?? '').trim() !== '');
  return (
    <form
      className="mt-2 space-y-1.5 rounded-lg border border-border bg-bg p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f: Record<string, unknown> = {};
        for (const c of campos) {
          const x = (v[c.chave] ?? '').trim();
          f[c.chave] = c.tipo === 'sim_nao' ? x === 'sim' : c.tipo === 'numero' ? Number(x) : x;
        }
        aoEnviar(f);
      }}
    >
      {campos.map((c) => (
        <label key={c.chave} className="block text-[12px]">
          {c.rotulo}
          {c.tipo === 'sim_nao' ? (
            <select className={`${INPUT} mt-0.5 py-1`} disabled={!ativo} value={v[c.chave] ?? ''} onChange={(e) => setV((o) => ({ ...o, [c.chave]: e.target.value }))}>
              <option value="">escolha</option>
              <option value="sim">sim</option>
              <option value="nao">não</option>
            </select>
          ) : (
            <input className={`${INPUT} mt-0.5 py-1`} disabled={!ativo} inputMode={c.tipo === 'numero' ? 'numeric' : undefined} value={v[c.chave] ?? ''} onChange={(e) => setV((o) => ({ ...o, [c.chave]: c.tipo === 'numero' ? soDigitos(e.target.value) : e.target.value }))} />
          )}
        </label>
      ))}
      <button type="submit" disabled={!ativo || !pronto} className={`${BOTAO_PRIMARIO} w-full`}>{ativo ? 'enviar respostas' : 'chega quando a mensagem for liberada'}</button>
    </form>
  );
}

function CelularDaMesaView({ mesa, token, agir }: { mesa: CelularDaMesa; token: string | null; agir: Agir }) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3">
      {mesa.decisoes.map((d) => (
        <div key={d.id} className="rounded-2xl border border-border bg-surface px-3 py-2 text-[13px]">
          <div className="font-os-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">decisão · {d.leadNome}</div>
          <p className="font-semibold">{d.titulo}</p>
          <p className="text-muted">{d.contexto}</p>
          <p className="mt-1 text-[11.5px] text-muted">Padrão se ninguém responder até {dataHora(d.expiraEm)}: {d.opcoes.find((o) => o.chave === d.padrao)?.rotulo ?? d.padrao}.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.opcoes.map((o) => (
              <button key={o.chave} type="button" title={o.efeito} onClick={() => agir(() => apiPost('/comercial/simulador/mesa/responder', { decisaoId: d.id, escolha: o.chave }, token), `Decidido: ${o.rotulo}.`)} className={o.chave === d.padrao ? BOTAO_PRIMARIO : BOTAO}>
                {o.rotulo}
              </button>
            ))}
          </div>
        </div>
      ))}

      {mesa.mensagensNaFila.map((m) => (
        <div key={m.id} className="rounded-2xl border border-border bg-surface px-3 py-2 text-[13px]">
          <div className="font-os-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">{m.template ?? 'mensagem'} para {m.leadNome}</div>
          <p className="whitespace-pre-wrap">{m.texto}</p>
          <p className="mt-1 text-[11.5px] text-muted">{explicarEstado(m.estado, m.vetoAte)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.estado === 'na_fila' && m.approvalId && (
              <>
                <button type="button" onClick={() => agir(() => apiPost(`/approvals/${m.approvalId}/confirm`, {}, token), 'Envio liberado.')} className={BOTAO_PRIMARIO}>liberar envio</button>
                <Link href="/atendimento" className={BOTAO}>abrir na fila</Link>
              </>
            )}
            {m.estado === 'em_veto' && (
              <button type="button" onClick={() => agir(() => apiPost(`/comercial/simulador/mensagens/${m.id}/vetar`, {}, token), 'Vetada: não sai.')} className={BOTAO}>VETO</button>
            )}
          </div>
        </div>
      ))}

      {!mesa.decisoes.length && !mesa.mensagensNaFila.length && <p className="text-[12.5px] text-muted">Nada esperando a mesa agora.</p>}
    </div>
  );
}

/** O M6 só sai com uma novidade concreta escrita (C08: nunca só cobrança). */
function Novidade({ id, token, agir }: { id: string; token: string | null; agir: Agir }) {
  const [texto, setTexto] = useState('');
  return (
    <form
      className="ml-2 mt-1 flex max-w-[85%] gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void agir(() => apiPost(`/comercial/simulador/mensagens/${id}/novidade`, { novidade: texto.trim() }, token), 'M6 completo: foi para a fila.');
      }}
    >
      <input className={INPUT} placeholder="a novidade concreta (caso, prazo, vaga)" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="novidade do M6" />
      <button type="submit" disabled={texto.trim().length < 10} className={BOTAO_PRIMARIO}>completar</button>
    </form>
  );
}
