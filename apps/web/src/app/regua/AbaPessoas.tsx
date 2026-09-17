'use client';

import { Fragment, useEffect, useState } from 'react';
import { UserPlus, KeyRound, Shield, ChevronDown } from 'lucide-react';
import type { RoleList, UserList, UserRow } from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * QUEM AUTORIZA — a administração de usuários e perfis.
 *
 * Era a tela `/usuarios` inteira e virou uma aba da Régua na reorganização do
 * menu (`/usuarios` → `/regua?aba=pessoas`, em apps/web/rotas-antigas.mjs), pelo
 * motivo que a própria escada dá: de R3 para cima a decisão é de uma PESSOA,
 * com alçada mínima. Quem pode aprovar é parte da régua, não um assunto à parte.
 *
 * O conteúdo é o mesmo de antes, movido sem alteração de lógica.
 */
export function AbaPessoas() {
  const { token, ready, user } = useAuth();
  const [users, setUsers] = useState<UserList | null>(null);
  const [roles, setRoles] = useState<RoleList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // userId em edição de perfis
  const [aviso, setAviso] = useState<string | null>(null); // a mudança foi retida para aprovação

  const load = () => {
    if (!token) return;
    Promise.all([apiGet<UserList>('/users', token), apiGet<RoleList>('/roles', token)])
      .then(([u, r]) => { setUsers(u); setRoles(r); setError(null); })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (!ready || !token) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token]);

  const roleKeys = roles?.items.map((r) => r.key) ?? [];

  /*
   * MUDAR PAPEL, ATIVAÇÃO OU SENHA DE OUTRA PESSOA É R4 E NÃO SAI NO CLIQUE. A
   * API responde 200 com `{status:'aguardando_aprovacao'}`: a mudança está numa
   * fila esperando OUTRA pessoa, com alçada de titular, motivo e reautenticação.
   * Recarregar a lista como se tivesse acontecido seria o sucesso falso que a
   * tela do Google já teve.
   */
  const patch = (id: string, body: Record<string, unknown>) =>
    apiPatch<{ status?: string; mensagem?: string; fila?: string; approvalId?: string }>(
      `/users/${id}`,
      body,
      token,
    )
      .then((r) => {
        if (r && typeof r === 'object' && r.status === 'aguardando_aprovacao') {
          const base = r.mensagem ?? 'A mudança foi para a fila de aprovações e precisa da confirmação de outra pessoa. Nada mudou ainda.';
          setAviso(`⏳ ${base}${r.fila ? ` Fila: ${r.fila}.` : ''}${r.approvalId ? ` (aprovação ${r.approvalId})` : ''}`);
          return;
        }
        setAviso(null);
        load();
      })
      .catch((e) => setError(e.message));

  const resetPassword = (u: UserRow) => {
    const pw = window.prompt(`Nova senha para ${u.email} (mín. 8):`);
    if (!pw) return;
    if (pw.length < 8) { setError('Senha muito curta (mín. 8).'); return; }
    patch(u.id, { password: pw });
  };

  return (
    <div className="space-y-6">
      {aviso && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {aviso}
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{users ? `${users.total} usuário(s)` : 'Carregando…'} · gerencie acessos e perfis.</p>
        </div>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90"
        >
          <UserPlus size={15} /> Novo usuário
        </button>
      </div>

      {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{error}</div>}

      {showNew && (
        <NewUserForm
          roleKeys={roleKeys}
          onCancel={() => setShowNew(false)}
          onCreate={(body) =>
            apiPost('/users', body, token)
              .then(() => { setShowNew(false); load(); })
              .catch((e) => setError(e.message))
          }
        />
      )}

      {/* Tabela de usuários */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">E-mail</th>
                <th className="px-4 py-3 font-medium">Perfis</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Último login</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users?.items.map((u) => (
                <Fragment key={u.id}>
                  <tr className="hover:bg-surface-2">
                    <td className="px-4 py-2.5 font-medium">
                      {u.name}
                      {u.id === user?.id && <span className="ml-2 text-[10px] text-muted">(você)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-muted">{u.email}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <span key={r} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{r}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${u.isActive ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad'}`}>
                        {u.isActive ? 'ativo' : 'inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('pt-BR') : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-2 text-[12px]">
                        <button
                          onClick={() => setEditing(editing === u.id ? null : u.id)}
                          className="inline-flex items-center gap-1 text-brand hover:underline"
                        >
                          <Shield size={12} /> perfis
                        </button>
                        <button onClick={() => resetPassword(u)} className="inline-flex items-center gap-1 text-muted hover:text-text">
                          <KeyRound size={12} /> senha
                        </button>
                        <button
                          onClick={() => patch(u.id, { isActive: !u.isActive })}
                          disabled={u.id === user?.id}
                          title={u.id === user?.id ? 'Você não pode desativar a própria conta' : ''}
                          className={`${u.isActive ? 'text-bad' : 'text-good'} hover:underline disabled:opacity-40 disabled:no-underline`}
                        >
                          {u.isActive ? 'desativar' : 'ativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editing === u.id && (
                    <tr className="bg-surface-2/50">
                      <td colSpan={6} className="px-4 py-3">
                        <RoleEditor
                          allRoles={roleKeys}
                          current={u.roles}
                          onCancel={() => setEditing(null)}
                          onSave={(sel) => patch(u.id, { roles: sel }).then(() => setEditing(null))}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Referência: perfis → permissões */}
      <RolesReference roles={roles} />
    </div>
  );
}

function NewUserForm({
  roleKeys,
  onCreate,
  onCancel,
}: {
  roleKeys: string[];
  onCreate: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const valid = name.length >= 2 && /.+@.+\..+/.test(email) && password.length >= 8 && sel.length >= 1;

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 text-sm font-medium">Novo usuário</div>
      <div className="grid gap-3 md:grid-cols-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome"
          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" type="email"
          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha (mín. 8)" type="password"
          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim" />
      </div>
      <div className="mt-3">
        <div className="mb-1 text-xs text-muted">Perfis</div>
        <RoleCheckboxes all={roleKeys} selected={sel} onChange={setSel} />
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onCreate({ name, email, password, roles: sel })}
          disabled={!valid}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
        >
          Criar
        </button>
        <button onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-text">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function RoleEditor({
  allRoles,
  current,
  onSave,
  onCancel,
}: {
  allRoles: string[];
  current: string[];
  onSave: (sel: string[]) => void;
  onCancel: () => void;
}) {
  const [sel, setSel] = useState<string[]>(current);
  return (
    <div className="space-y-3">
      <RoleCheckboxes all={allRoles} selected={sel} onChange={setSel} />
      <div className="flex gap-2">
        <button
          onClick={() => onSave(sel)}
          disabled={sel.length < 1}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
        >
          Salvar perfis
        </button>
        <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-text">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function RoleCheckboxes({
  all,
  selected,
  onChange,
}: {
  all: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (k: string) =>
    onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  return (
    <div className="flex flex-wrap gap-2">
      {all.map((k) => (
        <button
          key={k}
          onClick={() => toggle(k)}
          className={`rounded-lg border px-2.5 py-1 text-[12px] ${
            selected.includes(k)
              ? 'border-brand-dim bg-brand/15 text-brand'
              : 'border-border text-muted hover:text-text'
          }`}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

function RolesReference({ roles }: { roles: RoleList | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 text-sm font-medium"
      >
        <span className="flex items-center gap-2"><Shield size={15} className="text-brand" /> Perfis e permissões (referência)</span>
        <ChevronDown size={16} className={`text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-5">
          {roles?.items.map((r) => (
            <div key={r.key}>
              <div className="text-sm font-medium">
                {r.name} <span className="text-muted">· {r.key} · {r.userCount} usuário(s)</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.permissions.map((p) => (
                  <span key={p} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
