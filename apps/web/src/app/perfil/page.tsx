'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  lerWhatsappBr,
  rotuloDoAniversario,
  type CampoDoPerfil,
  type PerfilDaPessoa,
} from '@mktos/shared';
import { apiDelete, apiGet, apiPut, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { esquecerAvatares, useAvatares } from '@/lib/avatares';
import { recusaDoArquivo, reduzirFoto } from '@/lib/reduzir-foto';
import { AvatarDaPessoa } from '@/components/AvatarDaPessoa';

/*
 * O PERFIL (produção 22B, I6) — `/perfil` e `/perfil?pessoa=<id>`.
 *
 * A pessoa edita o próprio cadastro: foto, apelido, cargo, cidade, fuso, data
 * de nascimento, telefone, WhatsApp e o nome como está no vault. Quem tem
 * `admin.usuarios` escolhe outra pessoa e edita o dela. A API relê os papéis e
 * recusa o resto; esta tela só não oferece o que não vai passar.
 *
 * A foto é reduzida AQUI, num canvas, para um JPEG quadrado de 256 px antes de
 * sair (o servidor não redimensiona e confere tipo, lado e tamanho pelos
 * bytes). O WhatsApp é o mesmo da Equipe (a identidade do canal de aprovação),
 * salvo pela mesma rota.
 */

const INP = 'mt-1 w-full rounded-root border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none focus:border-brand disabled:opacity-60';
const ROTULO = 'block font-os-mono text-[10px] uppercase tracking-[0.12em] text-muted';

const FUSOS_COMUNS = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Cuiaba',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Rio_Branco',
  'America/Noronha',
  'Europe/Lisbon',
  'America/New_York',
];

type Form = Record<CampoDoPerfil, string>;

const doPerfil = (p: PerfilDaPessoa): Form => ({
  apelido: p.apelido ?? '',
  cargo: p.cargo ?? '',
  cidade: p.cidade ?? '',
  fuso: p.fuso ?? '',
  dataNascimento: p.dataNascimento ?? '',
  telefone: p.telefone ?? '',
  nomeNoVault: p.nomeNoVault ?? '',
});

function lerPessoaDaUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('pessoa');
  return v && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null;
}

export default function PerfilPage() {
  const { token, user, ready, can } = useAuth();
  const [pessoaId, setPessoaId] = useState<string | null>(null);
  const [perfil, setPerfil] = useState<PerfilDaPessoa | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [whats, setWhats] = useState('');
  const arquivo = useRef<HTMLInputElement | null>(null);
  const admin = can('admin.usuarios');
  const pessoas = useAvatares(admin ? token : null);

  useEffect(() => {
    setPessoaId(lerPessoaDaUrl());
  }, []);

  const alvo = pessoaId && pessoaId !== user?.id ? pessoaId : null;

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const p = await apiGet<PerfilDaPessoa>(alvo ? `/perfil/${encodeURIComponent(alvo)}` : '/perfil', token);
      setPerfil(p);
      setForm(doPerfil(p));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token, alvo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function trocarPessoa(id: string) {
    const url = new URL(window.location.href);
    if (id && id !== user?.id) url.searchParams.set('pessoa', id);
    else url.searchParams.delete('pessoa');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
    setAviso(null);
    setPessoaId(id || null);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!perfil || !form) return;
    const original = doPerfil(perfil);
    const mudou = (Object.keys(form) as CampoDoPerfil[]).filter((c) => form[c].trim() !== original[c].trim());
    if (!mudou.length) {
      setAviso('Nada mudou.');
      return;
    }
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const corpo: Record<string, string | null> = { esperado: perfil.atualizadoEm };
      for (const c of mudou) corpo[c] = form[c].trim() || null;
      const p = await apiPut<PerfilDaPessoa>(`/perfil/${encodeURIComponent(perfil.id)}`, corpo, token);
      setPerfil(p);
      setForm(doPerfil(p));
      esquecerAvatares();
      setAviso('Perfil salvo.');
    } catch (e2) {
      setErro((e2 as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function enviarFoto(f: File) {
    if (!perfil) return;
    const recusa = recusaDoArquivo(f);
    if (recusa) {
      setErro(recusa);
      return;
    }
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const reduzida = await reduzirFoto(f);
      const p = await apiUpload<PerfilDaPessoa>(`/perfil/${encodeURIComponent(perfil.id)}/foto`, reduzida, token);
      setPerfil(p);
      esquecerAvatares();
      setAviso('Foto trocada.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
      if (arquivo.current) arquivo.current.value = '';
    }
  }

  async function tirarFoto() {
    if (!perfil) return;
    setSalvando(true);
    setErro(null);
    try {
      const p = await apiDelete<PerfilDaPessoa>(`/perfil/${encodeURIComponent(perfil.id)}/foto`, token);
      setPerfil(p);
      esquecerAvatares();
      setAviso('Foto retirada. Ela fica guardada, fora de uso.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function salvarWhatsapp(numero: string | null) {
    if (!perfil) return;
    if (numero !== null) {
      const l = lerWhatsappBr(numero);
      if (!l.ok) {
        setErro(l.motivo);
        return;
      }
    }
    setSalvando(true);
    setErro(null);
    try {
      await apiPut(`/organograma/pessoas/${encodeURIComponent(perfil.id)}/whatsapp`, { numero }, token);
      setWhats('');
      await carregar();
      setAviso(numero ? 'WhatsApp salvo.' : 'WhatsApp removido.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (!ready) return <p className="text-sm text-muted">Carregando sessão…</p>;
  if (!token || !user) return <p className="text-sm text-muted">Entre para ver o seu perfil.</p>;

  const pode = !!perfil?.podeEditar;
  const campo = (c: CampoDoPerfil) => ({
    value: form?.[c] ?? '',
    disabled: !pode || salvando,
    onChange: (e: { target: { value: string } }) => setForm((f) => (f ? { ...f, [c]: e.target.value } : f)),
  });

  return (
    <div className="mx-auto max-w-[880px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {perfil?.proprio === false ? 'O cadastro desta pessoa.' : 'O seu cadastro. A equipe vê o nome, a foto, o cargo e o aniversário (só dia e mês).'}
        </p>
        {admin && pessoas && pessoas.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-muted">
            Editar o perfil de
            <select
              aria-label="Editar o perfil de"
              value={perfil?.id ?? ''}
              onChange={(e) => trocarPessoa(e.target.value)}
              className="rounded-root border border-border bg-bg px-2 py-1 text-xs text-text"
            >
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>{p.id === user.id ? `${p.nome} (você)` : p.nome}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {erro && <p role="alert" className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erro}</p>}
      {aviso && <p role="status" className="rounded-root border border-border bg-surface-2 p-3 text-sm text-text">{aviso}</p>}
      {!perfil && !erro && <p className="text-sm text-muted">Carregando…</p>}

      {perfil && form && (
        <>
          <section aria-label="Foto" className="flex flex-wrap items-center gap-4 rounded-root border border-border bg-surface p-4">
            <AvatarDaPessoa nome={perfil.nome} fotoUrl={perfil.foto?.url ?? null} tamanho="gg" />
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="text-lg font-medium text-text">{perfil.nome}</h2>
              <p className="font-os-mono text-[10px] text-muted">
                {perfil.email}
                {perfil.aniversario && ` · aniversário ${rotuloDoAniversario(perfil.aniversario)}`}
              </p>
              {pode && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    ref={arquivo}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label="Escolher foto"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void enviarFoto(f);
                    }}
                  />
                  <button
                    type="button"
                    disabled={salvando}
                    onClick={() => arquivo.current?.click()}
                    className="rounded-root bg-brand px-3 py-1.5 font-os-mono text-[10px] uppercase text-ink disabled:opacity-50"
                  >
                    {perfil.foto ? 'trocar foto' : 'enviar foto'}
                  </button>
                  {perfil.foto && (
                    <button type="button" disabled={salvando} onClick={() => void tirarFoto()} className="font-os-mono text-[10px] uppercase text-muted hover:text-text">
                      tirar foto
                    </button>
                  )}
                  <span className="font-os-mono text-[9.5px] text-dim">JPG, PNG ou WebP até 2 MB. A tela recorta o quadrado do centro e reduz para 256 px.</span>
                </div>
              )}
            </div>
          </section>

          <form onSubmit={salvar} aria-label="Cadastro" className="grid gap-4 rounded-root border border-border bg-surface p-4 md:grid-cols-2">
            <label className={ROTULO}>
              Apelido
              <input {...campo('apelido')} maxLength={40} className={INP} />
            </label>
            <label className={ROTULO}>
              Cargo ou função
              <input {...campo('cargo')} maxLength={80} className={INP} />
            </label>
            <label className={ROTULO}>
              Cidade
              <input {...campo('cidade')} maxLength={80} className={INP} />
            </label>
            <label className={ROTULO}>
              Fuso
              <input {...campo('fuso')} list="fusos-comuns" maxLength={64} placeholder="America/Sao_Paulo" className={INP} />
              <datalist id="fusos-comuns">
                {FUSOS_COMUNS.map((f) => <option key={f} value={f} />)}
              </datalist>
            </label>
            {(perfil.proprio || perfil.podeEditar) && (
              <>
                <div>
                  <label className={ROTULO}>
                    Data de nascimento
                    <input {...campo('dataNascimento')} type="date" aria-describedby="ajuda-nascimento" className={INP} />
                  </label>
                  <span id="ajuda-nascimento" className="mt-1 block text-[11px] text-dim">A equipe vê só o dia e o mês.</span>
                </div>
                <label className={ROTULO}>
                  Telefone
                  <input {...campo('telefone')} maxLength={40} inputMode="tel" className={INP} />
                </label>
              </>
            )}
            <div className="md:col-span-2">
              <label className={ROTULO}>
                Nome no vault da Root
                <input {...campo('nomeNoVault')} maxLength={80} aria-describedby="ajuda-nome-no-vault" className={INP} />
              </label>
              <span id="ajuda-nome-no-vault" className="mt-1 block text-[11px] text-dim">
                O nome como está nas notas da Governança: é por ele que a Equipe mostra o que você conduz e as funções de que é dona.
                {perfil.vault.disponivel && perfil.vault.socios.length > 0 && ` No vault: ${perfil.vault.socios.join(', ')}.`}
                {!perfil.vault.disponivel && perfil.vault.frase && ` ${perfil.vault.frase}`}
              </span>
              {pode && !form.nomeNoVault && perfil.vault.sugestao && (
                <button
                  type="button"
                  onClick={() => setForm((f) => (f ? { ...f, nomeNoVault: perfil.vault.sugestao ?? '' } : f))}
                  className="mt-1 font-os-mono text-[10px] normal-case text-brand underline"
                >
                  usar a sugestão: {perfil.vault.sugestao}
                </button>
              )}
            </div>
            {pode && (
              <div className="md:col-span-2">
                <button type="submit" disabled={salvando} className="rounded-root bg-brand px-4 py-2 font-os-mono text-[10px] uppercase text-ink disabled:opacity-50">
                  salvar
                </button>
              </div>
            )}
          </form>

          <section aria-label="WhatsApp" className="space-y-2 rounded-root border border-border bg-surface p-4">
            <h2 className={ROTULO}>WhatsApp</h2>
            <p className="text-sm text-text">
              {perfil.whatsapp.cadastrado ? perfil.whatsapp.numero ?? perfil.whatsapp.final : <span className="text-warn">sem número</span>}
            </p>
            <p className="font-os-mono text-[9.5px] text-dim">É o mesmo número da Equipe: o canal de aprovação reconhece você por ele.</p>
            {pode && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Novo WhatsApp"
                  value={whats}
                  onChange={(e) => setWhats(e.target.value)}
                  placeholder="+55 (32) 99999-8888"
                  className="w-[200px] rounded-root border border-border bg-bg px-2 py-1 font-os-mono text-xs text-text outline-none focus:border-brand"
                />
                <button
                  type="button"
                  disabled={salvando || !whats.trim()}
                  onClick={() => void salvarWhatsapp(whats)}
                  className="rounded-root border border-border px-2 py-1 font-os-mono text-[10px] uppercase text-text disabled:opacity-50"
                >
                  salvar número
                </button>
                {perfil.whatsapp.cadastrado && (
                  <button type="button" disabled={salvando} onClick={() => void salvarWhatsapp(null)} className="font-os-mono text-[10px] uppercase text-muted hover:text-text">
                    remover número
                  </button>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
