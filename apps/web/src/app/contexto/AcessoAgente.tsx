'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type TokenRow = {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
};

type GrantRow = {
  id: string;
  sourceType: string;
  sourceRef: string;
  field: string;
  provider: string;
  consentVersion: string;
  consentText: string;
  revokedAt: string | null;
};

const CAMPOS = ['sourceRef', 'title', 'body', 'tags', 'kind', 'confidence', 'validFrom', 'validUntil'];
type FonteDisponivel = { sourceType: string; sourceRef: string | null; title: string };
const DECLARACAO_DE_SAIDA = 'Autorizo que o conteúdo deste campo possa sair da VPS para o provedor de IA do agente contratado (por exemplo, Anthropic/Claude), para consultas de memória autorizadas enquanto esta concessão estiver ativa; posso revogá-la no painel. A revogação não recolhe conteúdo já enviado ao provedor.';

/**
 * Gestão humana da ponte de memória do agente.
 *
 * O valor secreto devolvido na emissão vive somente em `segredoNovo`: não há
 * localStorage, cookie, URL ou tentativa de recuperação depois que a pessoa
 * fecha o aviso. A concessão é uma ação separada e nunca é criada ao emitir.
 */
export function AcessoAgente({ fontes }: { fontes: FonteDisponivel[] }) {
  const { token, can } = useAuth();
  const tokenAtualRef = useRef(token);
  if (tokenAtualRef.current !== token) tokenAtualRef.current = token;
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [nome, setNome] = useState('');
  const [validadeDias, setValidadeDias] = useState('30');
  const [segredoNovo, setSegredoNovo] = useState<string | null>(null);
  const [segredoTokenId, setSegredoTokenId] = useState<string | null>(null);
  const [fonteSelecionada, setFonteSelecionada] = useState('');
  const [field, setField] = useState('title');
  const [consentVersion, setConsentVersion] = useState('adr-015-v1');
  const [consentNota, setConsentNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!token) return;
    const tokenDaCarga = token;
    apiGet<TokenRow[]>('/auth/agent-tokens', token).then((dados) => {
      if (tokenAtualRef.current === tokenDaCarga) setTokens(dados);
    }).catch((e: Error) => {
      if (tokenAtualRef.current === tokenDaCarga) setNotice(e.message);
    });
    if (can('admin.permissoes')) {
      apiGet<GrantRow[]>('/memoria/grants', token).then((dados) => {
        if (tokenAtualRef.current === tokenDaCarga) setGrants(dados);
      }).catch((e: Error) => {
        if (tokenAtualRef.current === tokenDaCarga) setNotice(e.message);
      });
    }
  }, [token, can]);

  useEffect(() => carregar(), [carregar]);
  useEffect(() => {
    setSegredoNovo(null);
    setSegredoTokenId(null);
    setTokens([]);
    setGrants([]);
  }, [token]);

  const fontesComReferencia = fontes.filter((fonte): fonte is FonteDisponivel & { sourceRef: string } => Boolean(fonte.sourceRef));
  const fonteAtual = fontesComReferencia.find((fonte) => `${fonte.sourceType}\u0000${fonte.sourceRef}` === fonteSelecionada) ?? fontesComReferencia[0];
  const sourceType = fonteAtual?.sourceType ?? '';
  const sourceRef = fonteAtual?.sourceRef ?? '';

  async function emitir() {
    if (!token || !nome.trim()) return;
    const tokenDaEmissao = token;
    setBusy(true);
    setNotice(null);
    try {
      const result = await apiPost<{ token: string; id: string }>('/auth/agent-tokens', {
        name: nome.trim(),
        scopes: ['memoria.buscar', 'memoria.ler'],
        validadeDias: Number(validadeDias),
      }, token);
      if (tokenAtualRef.current !== tokenDaEmissao) return;
      setSegredoNovo(result.token);
      setSegredoTokenId(result.id);
      setNome('');
      carregar();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Não foi possível emitir o token.');
    } finally {
      setBusy(false);
    }
  }

  async function revogarToken(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      await apiPost(`/auth/agent-tokens/${encodeURIComponent(id)}/revogar`, {}, token);
      if (id === segredoTokenId) {
        setSegredoNovo(null);
        setSegredoTokenId(null);
      }
      carregar();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Não foi possível revogar o token.');
    } finally {
      setBusy(false);
    }
  }

  async function conceder() {
    if (!token || !sourceType || !sourceRef) return;
    setBusy(true);
    setNotice(null);
    try {
      await apiPost('/memoria/grants', {
        sourceType,
        sourceRef: sourceRef.trim(),
        field,
        provider: 'agente_externo',
        consentVersion: consentVersion.trim(),
        consentText: `${DECLARACAO_DE_SAIDA}${consentNota.trim() ? ` Observação: ${consentNota.trim()}` : ''}`,
      }, token);
      setFonteSelecionada('');
      carregar();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Não foi possível conceder a fonte.');
    } finally {
      setBusy(false);
    }
  }

  async function revogarGrant(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      await apiPost(`/memoria/grants/${encodeURIComponent(id)}/revogar`, {}, token);
      carregar();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Não foi possível revogar a concessão.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) return null;

  return (
    <section className="space-y-4 rounded-root border border-border bg-surface p-4" aria-labelledby="acesso-agente-titulo">
      <div>
        <h2 id="acesso-agente-titulo" className="text-sm font-semibold">Acesso de agente à memória</h2>
        <p className="mt-1 text-xs text-muted">Tokens são individuais. Emitir um token não concede nenhuma fonte; cada fonte e campo precisam de consentimento separado.</p>
      </div>

      {notice && <p role="alert" className="text-xs text-bad">{notice}</p>}

      {segredoNovo && (
        <div className="rounded-root border border-warn/40 bg-warn/10 p-3 text-xs">
          <p className="font-semibold">Segredo exibido uma única vez</p>
          <p className="mt-1 break-all font-mono">{segredoNovo}</p>
          <button type="button" className="mt-2 rounded-root border border-border px-2 py-1" onClick={() => setSegredoNovo(null)}>
            Já guardei; ocultar
          </button>
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-[1fr,120px,auto]">
        <label className="text-xs text-muted">Nome do token<input className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5 text-sm" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <label className="text-xs text-muted">Validade (dias)<input className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5 text-sm" type="number" min="1" max="30" value={validadeDias} onChange={(e) => setValidadeDias(e.target.value)} /></label>
        <button type="button" disabled={busy || !nome.trim()} onClick={emitir} className="self-end rounded-root bg-brand px-3 py-2 text-sm text-white disabled:opacity-50">Emitir token</button>
      </div>

      <div className="space-y-2">
        {tokens.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-root border border-border px-3 py-2 text-xs">
            <span><strong>{item.name}</strong> · {item.scopes.join(', ')} · expira {new Date(item.expiresAt).toLocaleDateString()}</span>
            {item.revokedAt ? <span className="text-muted">revogado</span> : <button type="button" disabled={busy} onClick={() => revogarToken(item.id)} className="text-bad">Revogar</button>}
          </div>
        ))}
      </div>

      {can('admin.permissoes') && (
        <div className="space-y-3 border-t border-border pt-3">
          <div>
            <h3 className="text-sm font-semibold">Consentimento por fonte e campo</h3>
            <p className="mt-1 text-xs text-muted">Destino fixo desta fatia: <code>agente_externo</code>. A referência é literal, sem curingas.</p>
            <p className="mt-1 rounded-root border border-warn/40 bg-warn/10 p-2 text-xs">{DECLARACAO_DE_SAIDA}</p>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr,140px]">
            <label className="text-xs text-muted">Fonte existente e referência exata<select className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5 text-sm" value={fonteSelecionada || (fonteAtual ? `${fonteAtual.sourceType}\u0000${fonteAtual.sourceRef}` : '')} onChange={(e) => setFonteSelecionada(e.target.value)} disabled={fontesComReferencia.length === 0}><option value="">{fontesComReferencia.length ? 'Selecione uma nota...' : 'Nenhuma memória com referência carregada'}</option>{fontesComReferencia.map((fonte) => <option key={`${fonte.sourceType}\u0000${fonte.sourceRef}`} value={`${fonte.sourceType}\u0000${fonte.sourceRef}`}>{fonte.sourceType}:{fonte.sourceRef} · {fonte.title}</option>)}</select></label>
            <label className="text-xs text-muted">Campo<select className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5 text-sm" value={field} onChange={(e) => setField(e.target.value)}>{CAMPOS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </div>
          <div className="grid gap-2 md:grid-cols-[180px,1fr,auto]">
            <label className="text-xs text-muted">Versão do consentimento<input className="mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5 text-sm" value={consentVersion} onChange={(e) => setConsentVersion(e.target.value)} /></label>
            <label className="text-xs text-muted">Observação opcional<textarea className="mt-1 min-h-9 w-full rounded-root border border-border bg-surface-2 px-2 py-1.5 text-sm" value={consentNota} onChange={(e) => setConsentNota(e.target.value)} placeholder="A declaração fixa acima sempre será auditada." /></label>
            <button type="button" disabled={busy || !sourceType || !sourceRef} onClick={conceder} className="self-end rounded-root border border-border px-3 py-2 text-sm disabled:opacity-50">Conceder campo</button>
          </div>
          <div className="space-y-2">
            {grants.map((grant) => (
              <div key={grant.id} className="flex flex-wrap items-center justify-between gap-2 rounded-root border border-border px-3 py-2 text-xs">
                <span><strong>{grant.sourceType}:{grant.sourceRef}</strong> · {grant.field} · {grant.provider}</span>
                {grant.revokedAt ? <span className="text-muted">revogado</span> : <button type="button" disabled={busy} onClick={() => revogarGrant(grant.id)} className="text-bad">Revogar</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
