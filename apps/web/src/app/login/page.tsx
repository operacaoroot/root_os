'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE, apiGet } from '@/lib/api';

const ERROS: Record<string, string> = {
  'nao-autorizado': 'Esta conta Google não tem acesso ao ROOT OS.',
  'estado-invalido': 'O pedido de login expirou. Clique em entrar de novo.',
  falhou: 'Não deu para entrar com o Google. Tente de novo.',
};

/** Logo do Google (inline: sem chamar host externo). */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-6.8 5.3C7.9 41 15.4 46 24 46" />
      <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4v-.3l-6.8-5.3-.2.1C2.9 17 2 20.4 2 24s.9 7 2.5 10z" />
      <path fill="#EA4335" d="M24 10.6c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.4 29.9 2 24 2 15.4 2 7.9 7 4.5 14l7 5.4c1.8-5.3 6.7-8.8 12.5-8.8" />
    </svg>
  );
}

export default function LoginPage() {
  const { login, loginWithToken, user, ready } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('admin@marketing-os.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleOn, setGoogleOn] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const voltaTratada = useRef(false);

  // Volta do Google: token no fragmento (#token=…) ou erro na query (?erro=…).
  useEffect(() => {
    if (voltaTratada.current) return;
    voltaTratada.current = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const t = hash.get('token');
    if (t) {
      window.history.replaceState(null, '', window.location.pathname);
      setLoading(true);
      loginWithToken(t)
        .then(() => router.replace('/painel'))
        .catch((err) => setError((err as Error).message))
        .finally(() => setLoading(false));
      return;
    }
    const erro = new URLSearchParams(window.location.search).get('erro');
    if (erro) {
      setError(ERROS[erro] ?? 'Não deu para entrar com o Google.');
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [loginWithToken, router]);

  useEffect(() => {
    apiGet<{ disponivel: boolean }>('/auth/google/disponivel')
      .then((r) => setGoogleOn(r.disponivel))
      .catch(() => setGoogleOn(false));
  }, []);

  useEffect(() => {
    if (ready && user) router.replace('/painel');
  }, [ready, user, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      router.replace('/painel');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    // data-os-app aqui também: o login é superfície do painel, não é
    // pública como /central ou /b. Sem isso a tela ficava na fonte do
    // sistema enquanto o resto do painel já estava em Space Grotesk.
    <div data-os-app className="grid min-h-screen place-items-center bg-bg p-6">
      <div className="w-full max-w-sm">
        {/* Mesma marca do protótipo (root-os.html): o "R" com o glitch de canais
            e o nome do sistema. O ícone de foguete saiu junto com o nome antigo. */}
        <div className="mb-6 flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-11 w-11 place-items-center rounded-root border border-brand/30 bg-brand/10 text-[22px] font-extrabold italic leading-none tracking-[-0.05em] text-brand"
            style={{ transform: 'skewX(-10deg)', textShadow: 'var(--os-logo-shadow, none)' }}
          >
            R
          </span>
          <div className="font-os-mono">
            <div className="text-[15px] font-bold tracking-[-0.02em]">ROOT OS</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
              a central de contexto
            </div>
          </div>
        </div>

        {/* Pessoa entra pelo Google. E-mail+senha fica como saída de emergência —
            contas de serviço (mcp@, ia-acao@) seguem usando a API de senha. */}
        <div className="space-y-4 rounded-xl border border-border bg-surface p-6">
          {googleOn && (
            <a
              href={`${API_BASE}/auth/google/start`}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-bg py-2.5 text-sm font-medium transition hover:border-brand"
            >
              <GoogleG />
              Entrar com o Google
            </a>
          )}

          {error && <div className="text-sm text-bad">{error}</div>}

          {googleOn && !mostrarSenha && (
            <button
              type="button"
              onClick={() => setMostrarSenha(true)}
              className="w-full text-center text-[11px] text-muted underline-offset-2 hover:underline"
            >
              Entrar com e-mail e senha
            </button>
          )}

          {(!googleOn || mostrarSenha) && (
            <form onSubmit={submit} className="space-y-4">
              {googleOn && (
                <div className="flex items-center gap-3 text-[11px] text-muted">
                  <div className="h-px flex-1 bg-border" />
                  acesso de emergência
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs text-muted">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Senha</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-brand py-2 text-sm font-medium text-ink transition hover:bg-brand/90 disabled:opacity-60"
              >
                {loading ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
