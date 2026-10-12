'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * A troca da própria senha dentro do painel do Totem. Na instância do Sr.
 * aGranel a tela /config da ROOT redireciona para o painel (AppShell), e sem
 * esta página quem recebeu a senha inicial não teria onde trocá-la. A rota é a
 * do painel do Totem, porque os papéis de loja não têm acesso à /config; ela
 * confere a senha atual do mesmo jeito.
 */

const MINIMO = 8;

export default function MinhaContaPage() {
  const { user, token } = useAuth();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const diferentes = repetida.length > 0 && nova !== repetida;
  const pronto = !!token && atual.length > 0 && nova.length >= MINIMO && nova === repetida && !salvando;

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!pronto) return;
    setSalvando(true);
    setAviso(null);
    apiPost('/totem-gestao/minha-conta/senha', { currentPassword: atual, newPassword: nova }, token)
      .then(() => {
        setAviso({ ok: true, texto: 'Senha trocada. Use a nova no próximo acesso.' });
        setAtual('');
        setNova('');
        setRepetida('');
      })
      .catch((erro: Error) => setAviso({ ok: false, texto: erro.message }))
      .finally(() => setSalvando(false));
  }

  return (
    <div className="max-w-md space-y-4">
      <div>
        <div className="text-[16px] font-semibold text-text">{user?.name}</div>
        <div className="text-[14px] text-muted">{user?.email}</div>
      </div>

      <form onSubmit={salvar} className="sg-cartao space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-text">
          <KeyRound size={18} aria-hidden />
          Trocar a senha
        </h2>
        <label className="block space-y-1.5">
          <span className="block text-[14px] text-muted">Senha atual</span>
          <input
            type="password"
            autoComplete="current-password"
            className="sg-campo w-full"
            value={atual}
            onChange={(e) => setAtual(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-[14px] text-muted">Nova senha, com pelo menos {MINIMO} caracteres</span>
          <input
            type="password"
            autoComplete="new-password"
            className="sg-campo w-full"
            value={nova}
            onChange={(e) => setNova(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-[14px] text-muted">Repita a nova senha</span>
          <input
            type="password"
            autoComplete="new-password"
            className="sg-campo w-full"
            value={repetida}
            aria-invalid={diferentes || undefined}
            onChange={(e) => setRepetida(e.target.value)}
          />
        </label>
        {diferentes && <p className="text-[14px] text-bad">As duas senhas novas não são iguais.</p>}
        <button type="submit" disabled={!pronto} className="sg-btn sg-btn-primario w-full">
          {salvando ? 'Salvando…' : 'Salvar a nova senha'}
        </button>
        {aviso && (
          <p role="status" className={`text-[14px] ${aviso.ok ? 'text-good' : 'text-bad'}`}>
            {aviso.texto}
          </p>
        )}
      </form>
    </div>
  );
}
