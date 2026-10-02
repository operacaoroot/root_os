'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  LEAD_STATUS,
  formatarValorMonetario,
  type LeadCondicoesLeitura,
  type LeadDecisao,
  type LeadEvidencia,
  type LeadPropostaEstado,
  type LeadPropostaLeitura,
} from '@mktos/shared';
import { ErroDaApi, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { StatusChip } from '@/components/StatusChip';

interface LeadDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  score: number | null;
  nextAction: string | null;
  owner: { id: string; name: string } | null;
  origem: { tipo: string; ref: string } | null;
  avisos?: { possivelMesmaPessoa: string[] };
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  landingPage: string | null;
  enteredAt: string;
  source: { name: string } | null;
  campaign: { name: string } | null;
  events: { id: string; type: string; occurredAt: string }[];
}

const ORIGEM_ROTULO: Record<string, string> = {
  clickup: 'ClickUp',
  'pauta-comentario': 'Comentário na Pauta',
  pixel: 'Pixel do site',
  manual: 'Entrada manual',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm">{value ?? '—'}</div>
    </div>
  );
}

export default function LeadDetailPage() {
  const { token, ready, can, user } = useAuth();
  const meuId = user?.id ?? null;
  const params = useParams<{ id: string }>();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    apiGet<LeadDetail>(`/leads/${params.id}`, token).then(setLead).catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (!ready || !token) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, params.id]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft size={15} /> Voltar para leads
      </Link>

      {error && <div className="text-sm text-bad">{error}</div>}
      {!lead && !error && <div className="text-muted">Carregando…</div>}

      {lead && (
        <>
          <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-5">
            <div>
              <h1 className="text-lg font-semibold">{lead.name}</h1>
              <div className="text-sm text-muted">{lead.email}</div>
            </div>
            <div className="flex items-center gap-3">
              <StatusChip status={lead.status} />
              <div className="text-right">
                <div className="text-xs text-muted">Score</div>
                <div className="text-lg font-semibold text-brand">{lead.score ?? '—'}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface p-5 md:grid-cols-3">
            <Field label="Telefone" value={lead.phone} />
            <Field label="Origem" value={lead.source?.name} />
            <Field label="Como entrou" value={lead.origem ? (ORIGEM_ROTULO[lead.origem.tipo] ?? lead.origem.tipo) : null} />
            <Field label="Dono" value={lead.owner?.name ?? 'Sem dono'} />
            <Field label="Campanha" value={lead.campaign?.name} />
            <Field label="UTM source" value={lead.utmSource} />
            <Field label="UTM medium" value={lead.utmMedium} />
            <Field label="UTM campaign" value={lead.utmCampaign} />
            <Field label="Entrada" value={new Date(lead.enteredAt).toLocaleString('pt-BR')} />
          </div>

          {(lead.avisos?.possivelMesmaPessoa.length ?? 0) > 0 && (
            <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
              Possível mesma pessoa em outro comentário:{' '}
              {lead.avisos!.possivelMesmaPessoa.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <Link href={`/leads/${id}`} className="underline">lead {i + 1}</Link>
                </span>
              ))}
              . É só um aviso: nada foi unido.
            </div>
          )}

          {can('leads.editar') && <DonoDoLead lead={lead} token={token} meuId={meuId} podeEscolher={can('admin.usuarios')} onSaved={load} onError={setError} />}

          {can('leads.editar') && (
            <LeadActions
              lead={lead}
              token={token}
              onSaved={load}
              onError={setError}
            />
          )}

          <PropostaEAceite
            leadId={lead.id}
            token={token}
            podeCondicoes={can('tarefas.ver')}
            podeRegistrar={can('leads.editar') && can('tarefas.ver')}
            onChanged={load}
          />

          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Histórico de interações</h2>
            <ol className="space-y-2">
              {lead.events.map((ev) => (
                <li key={ev.id} className="flex items-center gap-3 text-sm">
                  <span className="h-2 w-2 rounded-full bg-brand" />
                  <span className="capitalize">{ev.type}</span>
                  <span className="ml-auto text-xs text-muted">
                    {new Date(ev.occurredAt).toLocaleString('pt-BR')}
                  </span>
                </li>
              ))}
              {lead.events.length === 0 && (
                <li className="text-sm text-muted">Sem interações registradas.</li>
              )}
            </ol>
          </div>

          <p className="text-[11px] text-muted">
            Resumo por IA disponível via Telegram (MCP). Mudanças de etapa entram na timeline e na auditoria.
          </p>
        </>
      )}
    </div>
  );
}

function LeadActions({
  lead,
  token,
  onSaved,
  onError,
}: {
  lead: LeadDetail;
  token: string | null;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [status, setStatus] = useState(lead.status);
  const [nextAction, setNextAction] = useState(lead.nextAction ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = status !== lead.status || nextAction !== (lead.nextAction ?? '');

  const save = () => {
    if (!token || !dirty) return;
    setBusy(true);
    setSaved(false);
    apiPatch('/leads/' + lead.id, { status, nextAction: nextAction.trim() || null }, token)
      .then(() => { setSaved(true); onSaved(); })
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Ações</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted">Etapa</label>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setSaved(false); }}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm capitalize outline-none focus:border-brand-dim"
          >
            {LEAD_STATUS.map((s) => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Próxima ação</label>
          <input
            value={nextAction}
            onChange={(e) => { setNextAction(e.target.value); setSaved(false); }}
            placeholder="ex.: Ligar amanhã 10h"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
        {saved && <span className="text-xs text-good">Salvo ✓</span>}
      </div>
    </div>
  );
}

function DonoDoLead({
  lead,
  token,
  meuId,
  podeEscolher,
  onSaved,
  onError,
}: {
  lead: LeadDetail;
  token: string | null;
  meuId: string | null;
  podeEscolher: boolean;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [usuarios, setUsuarios] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || !podeEscolher) return;
    apiGet<{ items: { id: string; name: string; isActive: boolean }[] }>('/users', token)
      .then((r) => setUsuarios(r.items.filter((u) => u.isActive)))
      .catch(() => setUsuarios([]));
  }, [token, podeEscolher]);

  const trocar = (ownerId: string | null) => {
    if (!token) return;
    setBusy(true);
    apiPut('/leads/' + lead.id + '/dono', { ownerId }, token)
      .then(onSaved)
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-3 font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Dono</h2>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">{lead.owner?.name ?? 'Sem dono'}</span>
        {meuId && lead.owner?.id !== meuId && (
          <button onClick={() => trocar(meuId)} disabled={busy} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50">
            Assumir
          </button>
        )}
        {lead.owner && (
          <button onClick={() => trocar(null)} disabled={busy} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50">
            Tirar o dono
          </button>
        )}
        {podeEscolher && usuarios.length > 0 && (
          <select
            value={lead.owner?.id ?? ''}
            disabled={busy}
            onChange={(e) => e.target.value && trocar(e.target.value)}
            aria-label="Escolher o dono"
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim"
          >
            <option value="">Escolher…</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

const ESTADO_DA_PROPOSTA_ROTULO: Record<LeadPropostaEstado, string> = {
  sem_proposta: 'Sem proposta',
  proposta_registrada: 'Proposta registrada',
  aceite_registrado: 'Aceite registrado',
  recusa_registrada: 'Recusa registrada',
};

const EVIDENCIA_ROTULO: Record<LeadEvidencia['tipo'], string> = {
  link: 'Link',
  arquivo: 'Arquivo (hash)',
  mensagem: 'Mensagem',
};

const campo = 'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim';
const botao = 'rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50';

function valorDaCondicao(tipo: string, valor: string | null): string {
  if (valor === null) return '—';
  if (tipo === 'moeda') return formatarValorMonetario(valor);
  if (tipo === 'data' && /^\d{10,13}$/.test(valor)) return diaDoCard(new Date(Number(valor)).toISOString());
  return valor;
}

function dataCurta(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

/** Início e vencimento do card são dia, não instante: o dia é o do UTC (é o que o Trabalho grava e edita com `slice(0, 10)`), senão 00:00Z mostra o dia anterior no Brasil. */
function diaDoCard(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';
}

/**
 * Proposta e aceite comercial (ROOT-49, C-03). O documento da proposta é um link
 * com o sha256; as condições vêm do card, lidas na hora (e nunca copiadas); o
 * aceite carrega a evidência e o hash das condições que esta tela mostrou.
 * Nada sai do sistema: registrar não envia e-mail, cobrança nem assinatura.
 */
function PropostaEAceite({
  leadId,
  token,
  podeCondicoes,
  podeRegistrar,
  onChanged,
}: {
  leadId: string;
  token: string | null;
  podeCondicoes: boolean;
  podeRegistrar: boolean;
  onChanged: () => void;
}) {
  const [leitura, setLeitura] = useState<LeadPropostaLeitura | null>(null);
  const [cond, setCond] = useState<LeadCondicoesLeitura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cardId, setCardId] = useState('');
  const [url, setUrl] = useState('');
  const [sha, setSha] = useState('');
  const [titulo, setTitulo] = useState('');
  const [decisao, setDecisao] = useState<LeadDecisao>('aceite');
  const [tipo, setTipo] = useState<LeadEvidencia['tipo']>('link');
  const [evLink, setEvLink] = useState('');
  const [evNome, setEvNome] = useState('');
  const [evSha, setEvSha] = useState('');
  const [evTexto, setEvTexto] = useState('');
  const [evCanal, setEvCanal] = useState<'whatsapp' | 'email' | 'reuniao' | 'outro'>('whatsapp');
  const [motivo, setMotivo] = useState('');

  const carregar = async (cardEscolhido?: string) => {
    if (!token) return;
    try {
      setLeitura(await apiGet<LeadPropostaLeitura>(`/leads/${leadId}/proposta`, token));
      if (podeCondicoes) {
        const q = cardEscolhido ? `?cardId=${encodeURIComponent(cardEscolhido)}` : '';
        setCond(await apiGet<LeadCondicoesLeitura>(`/leads/${leadId}/proposta/condicoes${q}`, token));
      }
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar a proposta');
    }
  };

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, leadId, podeCondicoes]);

  const enviar = async (caminho: string, corpo: unknown, depois: string) => {
    if (!token) return;
    setBusy(true);
    setAviso(null);
    try {
      await apiPost(`/leads/${leadId}/${caminho}`, corpo, token);
      setAviso(depois);
      await carregar(cardId.trim() || undefined);
      onChanged();
    } catch (e) {
      // 409: o card mudou desde o que a tela mostrou — relê para a pessoa ver o que vale agora, e só então mostra o motivo (a leitura limpa o erro).
      if (e instanceof ErroDaApi && e.status === 409) await carregar(cardId.trim() || undefined);
      setErro(e instanceof Error ? e.message : 'Erro ao registrar');
    } finally {
      setBusy(false);
    }
  };

  const registrarProposta = () =>
    enviar(
      'proposta',
      {
        documento: { tipo: 'link', url: url.trim(), sha256: sha.trim(), ...(titulo.trim() ? { titulo: titulo.trim() } : {}) },
        ...(cardId.trim() ? { cardId: cardId.trim() } : {}),
      },
      'Proposta registrada. Nada foi enviado ao cliente.',
    );

  const evidencia = (): LeadEvidencia | null => {
    if (tipo === 'link') return evLink.trim() ? { tipo, url: evLink.trim() } : null;
    if (tipo === 'arquivo') return evNome.trim() && evSha.trim() ? { tipo, nome: evNome.trim(), sha256: evSha.trim() } : null;
    return evTexto.trim() ? { tipo, canal: evCanal, texto: evTexto.trim() } : null;
  };

  const registrarDecisao = () => {
    const ev = evidencia();
    if (!ev || !cond?.hash || !cond.condicoes) return;
    void enviar(
      'aceite',
      { decisao, evidencia: ev, condicoesHash: cond.hash, condicoesVistas: cond.condicoes, ...(motivo.trim() ? { motivo: motivo.trim() } : {}) },
      decisao === 'aceite' ? 'Aceite registrado. Nada foi enviado ao cliente.' : 'Recusa registrada.',
    );
  };

  const estado = leitura?.estado ?? 'sem_proposta';
  const temProposta = estado !== 'sem_proposta';
  const decidido = estado === 'aceite_registrado' || estado === 'recusa_registrada';

  return (
    <div className="rounded-xl border border-border bg-surface p-5" aria-label="Proposta e aceite">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-medium text-muted">Proposta e aceite</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs">{ESTADO_DA_PROPOSTA_ROTULO[estado]}</span>
      </div>

      {erro && <div className="mb-3 text-sm text-bad" role="alert">{erro}</div>}
      {aviso && <div className="mb-3 text-sm text-good">{aviso}</div>}

      {leitura?.proposta && (
        <div className="mb-3 text-sm">
          <div className="text-xs text-muted">Documento da proposta</div>
          <a href={leitura.proposta.documento.url} target="_blank" rel="noreferrer noopener" className="underline">
            {leitura.proposta.documento.titulo ?? leitura.proposta.documento.url}
          </a>
          <span className="ml-2 text-xs text-muted">sha256 {leitura.proposta.documento.sha256.slice(0, 12)}… · registrada em {dataCurta(leitura.proposta.registradaEm)}</span>
        </div>
      )}

      {leitura?.decisao && (
        <div className="mb-3 text-sm">
          <div className="text-xs text-muted">{leitura.decisao.decisao === 'aceite' ? 'Aceite' : 'Recusa'} em {dataCurta(leitura.decisao.registradaEm)}</div>
          <div>
            Evidência: {EVIDENCIA_ROTULO[leitura.decisao.evidencia.tipo]}
            {leitura.decisao.motivo ? ` · ${leitura.decisao.motivo}` : ''}
          </div>
        </div>
      )}

      {!podeCondicoes && (
        <div className="mb-3 text-sm text-muted">Você não tem acesso às tarefas, então as condições do card não aparecem aqui.</div>
      )}

      {podeCondicoes && cond && (
        <div className="mb-3 rounded-lg border border-border bg-surface-2 p-3 text-sm">
          <div className="text-xs text-muted">Condições do card{cond.card ? ` · ${cond.card.titulo}` : ''} (lidas agora, não copiadas)</div>
          {cond.condicoes ? (
            <ul className="mt-1 space-y-0.5">
              {cond.condicoes.campos.map((c) => (
                <li key={c.campoId}>{c.nome}: {valorDaCondicao(c.tipo, c.valor)}</li>
              ))}
              <li>Início: {diaDoCard(cond.condicoes.inicio)}</li>
              <li>Vencimento: {diaDoCard(cond.condicoes.vencimento)}</li>
            </ul>
          ) : null}
          {cond.motivo && <div className="mt-1 text-warn">{cond.motivo}</div>}
          {cond.propostaVigente === false && (
            <div className="mt-1 text-warn">O card mudou depois da última proposta. Registre a proposta de novo antes de decidir.</div>
          )}
        </div>
      )}

      {podeRegistrar && podeCondicoes && cond && !cond.card && (
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted" htmlFor="proposta-card">Card comercial (id)</label>
          <div className="flex gap-2">
            <input id="proposta-card" value={cardId} onChange={(e) => setCardId(e.target.value)} className={campo} />
            <button type="button" onClick={() => void carregar(cardId.trim() || undefined)} disabled={busy || !cardId.trim()} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50">
              Ler condições
            </button>
          </div>
        </div>
      )}

      {podeRegistrar && podeCondicoes && (
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{temProposta ? 'Registrar outra proposta' : 'Registrar a proposta'}</h3>
            <div className="grid gap-2 md:grid-cols-2">
              <input aria-label="Link do documento" placeholder="https://… (link do documento)" value={url} onChange={(e) => setUrl(e.target.value)} className={campo} />
              <input aria-label="sha256 do documento" placeholder="sha256 do documento (64 caracteres)" value={sha} onChange={(e) => setSha(e.target.value)} className={campo} />
              <input aria-label="Título da proposta" placeholder="Título (opcional)" value={titulo} onChange={(e) => setTitulo(e.target.value)} className={campo} />
            </div>
            <button type="button" onClick={() => void registrarProposta()} disabled={busy || !url.trim() || !sha.trim() || !cond?.condicoes} className={botao}>
              Registrar proposta
            </button>
          </div>

          {temProposta && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Registrar a decisão do cliente</h3>
              <div className="grid gap-2 md:grid-cols-2">
                <select aria-label="Decisão" value={decisao} onChange={(e) => setDecisao(e.target.value as LeadDecisao)} className={campo}>
                  <option value="aceite">Aceite</option>
                  <option value="recusa">Recusa</option>
                </select>
                <select aria-label="Tipo de evidência" value={tipo} onChange={(e) => setTipo(e.target.value as LeadEvidencia['tipo'])} className={campo}>
                  {(Object.keys(EVIDENCIA_ROTULO) as LeadEvidencia['tipo'][]).map((t) => (
                    <option key={t} value={t}>{EVIDENCIA_ROTULO[t]}</option>
                  ))}
                </select>
                {tipo === 'link' && <input aria-label="Link da evidência" placeholder="https://…" value={evLink} onChange={(e) => setEvLink(e.target.value)} className={campo} />}
                {tipo === 'arquivo' && (
                  <>
                    <input aria-label="Nome do arquivo" placeholder="Nome do arquivo" value={evNome} onChange={(e) => setEvNome(e.target.value)} className={campo} />
                    <input aria-label="sha256 do arquivo" placeholder="sha256 do arquivo" value={evSha} onChange={(e) => setEvSha(e.target.value)} className={campo} />
                  </>
                )}
                {tipo === 'mensagem' && (
                  <>
                    <select aria-label="Canal da mensagem" value={evCanal} onChange={(e) => setEvCanal(e.target.value as typeof evCanal)} className={campo}>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="email">E-mail</option>
                      <option value="reuniao">Reunião</option>
                      <option value="outro">Outro</option>
                    </select>
                    <textarea aria-label="Texto da mensagem" placeholder="Cole a mensagem em que o cliente respondeu" value={evTexto} onChange={(e) => setEvTexto(e.target.value)} className={`${campo} md:col-span-2`} rows={3} />
                  </>
                )}
                <input aria-label="Motivo" placeholder="Observação (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campo} />
              </div>
              <button type="button" onClick={registrarDecisao} disabled={busy || !evidencia() || !cond?.hash || !!cond?.motivo || cond?.propostaVigente === false} className={botao}>
                {decisao === 'aceite' ? 'Registrar aceite' : 'Registrar recusa'}
              </button>
              {decidido && <div className="text-xs text-muted">Já há uma decisão registrada; uma nova fica na linha do tempo ao lado da anterior.</div>}
            </div>
          )}
          <p className="text-[11px] text-muted">Registrar não envia nada ao cliente: sem e-mail, cobrança ou assinatura. Mover o card para fechado também não registra aceite.</p>
        </div>
      )}
    </div>
  );
}
