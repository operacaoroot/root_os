'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Rocket } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login, user, ready } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('admin@marketing-os.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace('/');
  }, [ready, user, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      router.replace('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-bg p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand/20 text-brand">
            <Rocket size={22} />
          </div>
          <div>
            <div className="text-lg font-semibold">Marketing OS</div>
            <div className="text-xs text-muted">Sistema Operacional de Marketing · root</div>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-border bg-surface p-6"
        >
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
              placeholder="admin12345 (dev)"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
              required
            />
          </div>

          {error && <div className="text-sm text-bad">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>

          <p className="text-center text-[11px] text-muted">
            Dev: admin@marketing-os.local / admin12345
          </p>
        </form>
      </div>
    </div>
  );
}
