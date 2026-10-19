'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { API_BASE } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * COFRE DA EMPRESA — senhas, dados e documentos dos sócios.
 *
 * Abre com a senha do cofre (de cada pessoa, não a do login). A sessão do cofre
 * fica só na memória desta aba: recarregar, fechar ou 15 min sem mexer tranca.
 * Os valores aparecem um item por vez, somem sozinhos em 30 s e cada abertura
 * fica no registro de ações.
 */

type Tipo = 'senha' | 'dado' | 'documento';
type Item = {
  id: string; tipo: Tipo; titulo: string; onde: string | null;
  temUsuario: boolean; temSegredo: boolean; temNotas: boolean;
  arquivo: { nome: string | null; tipo: string | null; tamanho: number | null } | null;
  atualizadoEm: string;
};
type Revelado = { id: string; usuario: string | null; segredo: string | null; notas: string | null };
type Estado = { temSenha: boolean; aberto: boolean; bloqueadoAte: string | null; minutosDaSessao: number };

const TIPOS: { k: Tipo | 'todos'; rotulo: string }[] = [
  { k: 'todos', rotulo: 'Tudo' }, { k: 'senha', rotulo: 'Senhas' }, { k: 'dado', rotulo: 'Dados' }, { k: 'documento', rotulo: 'Documentos' },
];
const ICONE: Record<Tipo, keyof typeof Icons> = { senha: 'KeyRound', dado: 'IdCard', documento: 'FileLock' };
const inputCls = 'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim';
const SEGUNDOS_VISIVEL = 30;
const vazio = { tipo: 'senha' as Tipo, titulo: '', onde: '', usuario: '', segredo: '', notas: '' };

export default function CofrePage() {
  const { token, ready, can } = useAuth();
  const podeEditar = can('cofre.editar');
  const [estado, setEstado] = useState<Estado | null>(null);
  const [sessao, setSessao] = useState<string | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [filtro, setFiltro] = useState<Tipo | 'todos'>('todos');
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [revelados, setRevelados] = useState<Record<string, Revelado>>({});
  const [form, setForm] = useState<(typeof vazio & { id?: string }) | null>(null);
  const [trocando, setTrocando] = useState(false);
  const ultimoUso = useRef(Date.now());

  const chamar = useCallback(async <T,>(path: string, init: RequestInit = {}, comSessao = true): Promise<T> => {
    ultimoUso.current = Date.now();
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (comSessao && sessao) headers['x-cofre-sessao'] = sessao;
    if (init.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API_BASE}/cofre-da-empresa${path}`, { ...init, headers, cache: 'no-store' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 423) { setSessao(null); setItens([]); setRevelados({}); }
      // A validação do OS devolve `issues` (campo + motivo) e nenhuma `message`: mostrar o campo, não "Erro 400".
      const issues = Array.isArray(body.issues) ? (body.issues as { path: string; message: string }[]) : [];
      const CAMPO: Record<string, string> = { titulo: 'Título', onde: 'Onde', usuario: 'Usuário', segredo: 'Senha/dado', notas: 'Notas', senhaNova: 'Senha nova', senha: 'Senha', tipo: 'Tipo' };
      const doCampo = issues.map((i) => `${CAMPO[i.path] ?? i.path}: ${i.message}`).join(' · ');
      throw new Error(doCampo || (typeof body.message === 'string' ? body.message : Array.isArray(body.message) ? body.message.join(' ') : `Erro ${res.status}`));
    }
    const tipo = res.headers.get('content-type') ?? '';
    return (tipo.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
  }, [token, sessao]);

  const carregarEstado = useCallback(() => {
    if (!token) return;
    chamar<Estado>('/estado', {}, false).then(setEstado).catch((e) => setErro(e.message));
  }, [token, chamar]);

  const carregarItens = useCallback(() => {
    if (!sessao) return;
    chamar<Item[]>('/itens').then(setItens).catch((e) => setErro(e.message));
  }, [sessao, chamar]);

  useEffect(() => { if (ready) carregarEstado(); }, [ready, carregarEstado]);
  useEffect(() => { carregarItens(); }, [carregarItens]);

  const trancar = useCallback(() => {
    if (sessao) chamar('/trancar', { method: 'POST' }).catch(() => undefined);
    setSessao(null); setItens([]); setRevelados({}); setForm(null);
    carregarEstado();
  }, [sessao, chamar, carregarEstado]);

  // tranca sozinho depois de X min sem uso, e ao sair da página
  useEffect(() => {
    if (!sessao || !estado) return;
    const limite = estado.minutosDaSessao * 60_000;
    const marcar = () => { ultimoUso.current = Date.now(); };
    window.addEventListener('pointerdown', marcar);
    window.addEventListener('keydown', marcar);
    const t = window.setInterval(() => { if (Date.now() - ultimoUso.current > limite) trancar(); }, 15_000);
    return () => { window.clearInterval(t); window.removeEventListener('pointerdown', marcar); window.removeEventListener('keydown', marcar); };
  }, [sessao, estado, trancar]);

  const flash = (m: string) => { setAviso(m); setErro(null); window.setTimeout(() => setAviso(null), 3500); };

  const revelar = (id: string) => {
    chamar<Revelado>(`/itens/${id}/revelar`, { method: 'POST' })
      .then((r) => {
        setRevelados((x) => ({ ...x, [id]: r }));
        window.setTimeout(() => setRevelados((x) => { const y = { ...x }; delete y[id]; return y; }), SEGUNDOS_VISIVEL * 1000);
      })
      .catch((e) => setErro(e.message));
  };
  const copiar = (texto: string, oque: string) => {
    navigator.clipboard.writeText(texto).then(() => flash(`${oque} copiado.`)).catch(() => setErro('Não consegui copiar.'));
  };
  const salvar = async () => {
    if (!form || !form.titulo.trim()) { setErro('Dê um título ao item.'); return; }
    const corpo = {
      tipo: form.tipo, titulo: form.titulo.trim(), onde: form.onde.trim() || null,
      usuario: form.usuario || null, segredo: form.segredo || null, notas: form.notas || null,
    };
    try {
      if (form.id) await chamar(`/itens/${form.id}`, { method: 'PATCH', body: JSON.stringify(corpo) });
      else await chamar('/itens', { method: 'POST', body: JSON.stringify(corpo) });
      setForm(null); flash('Guardado no cofre.'); carregarItens();
    } catch (e) { setErro((e as Error).message); }
  };
  const editar = async (i: Item) => {
    try {
      const r = await chamar<Revelado>(`/itens/${i.id}/revelar`, { method: 'POST' });
      setForm({ id: i.id, tipo: i.tipo, titulo: i.titulo, onde: i.onde ?? '', usuario: r.usuario ?? '', segredo: r.segredo ?? '', notas: r.notas ?? '' });
    } catch (e) { setErro((e as Error).message); }
  };
  const apagar = (i: Item) => {
    if (!window.confirm(`Apagar "${i.titulo}" do cofre? Não dá para desfazer.`)) return;
    chamar(`/itens/${i.id}`, { method: 'DELETE' }).then(() => { flash('Apagado.'); carregarItens(); }).catch((e) => setErro(e.message));
  };
  const enviarArquivo = (i: Item, arquivo: File) => {
    chamar(`/itens/${i.id}/arquivo`, {
      method: 'POST', body: arquivo,
      headers: { 'Content-Type': arquivo.type || 'application/octet-stream', 'x-nome-arquivo': encodeURIComponent(arquivo.name) },
    }).then(() => { flash('Arquivo guardado.'); carregarItens(); }).catch((e) => setErro(e.message));
  };
  const baixarArquivo = (i: Item) => {
    chamar<Blob>(`/itens/${i.id}/arquivo`).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = i.arquivo?.nome ?? 'arquivo'; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }).catch((e) => setErro(e.message));
  };

  if (!ready) return <p className="text-sm text-muted">Carregando…</p>;
  if (!estado) {
    if (!erro) return <p className="text-sm text-muted">Carregando…</p>;
    // 403 logo depois de a permissão entrar: o login carrega as permissões; quem já estava logado precisa entrar de novo.
    return (
      <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-6 text-center text-sm">
        <Icons.LockKeyhole size={28} className="mx-auto mb-2 text-muted" aria-hidden />
        <p className="font-medium">Não foi possível abrir o cofre.</p>
        <p className="mt-1 text-muted">{erro}</p>
        <p className="mt-3 text-muted">Se você acabou de ganhar acesso ao cofre, saia do OS e entre de novo.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[960px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">Cofre da empresa</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Senhas, dados e documentos</h1>
          <p className="mt-1 text-sm text-muted">Só os sócios entram. Cada item abre um por vez, some em {SEGUNDOS_VISIVEL} s e fica registrado quem viu. A IA do OS não lê o cofre.</p>
        </div>
        {sessao && (
          <div className="flex items-center gap-2">
            <button onClick={() => setTrocando(!trocando)} className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-text">Trocar senha do cofre</button>
            <button onClick={trancar} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90">
              <Icons.Lock size={14} aria-hidden /> Trancar
            </button>
          </div>
        )}
      </div>

      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}
      {aviso && <div className="rounded-lg border border-good/30 bg-good/10 px-4 py-2 text-sm text-good">{aviso}</div>}

      {!estado.temSenha && <CriarSenha chamar={chamar} onPronto={() => { flash('Senha do cofre criada. Agora destranque.'); carregarEstado(); }} onErro={setErro} />}
      {estado.temSenha && !sessao && (
        <Destrancar
          bloqueadoAte={estado.bloqueadoAte}
          onAbrir={async (senha) => {
            try {
              const r = await chamar<{ token: string }>('/destrancar', { method: 'POST', body: JSON.stringify({ senha }) }, false);
              setErro(null); setSessao(r.token);
            } catch (e) { setErro((e as Error).message); carregarEstado(); }
          }}
        />
      )}
      {sessao && trocando && <TrocarSenha chamar={chamar} onPronto={() => { setTrocando(false); flash('Senha do cofre trocada. Entre de novo.'); setSessao(null); carregarEstado(); }} onErro={setErro} />}

      {sessao && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {TIPOS.map((t) => (
              <button key={t.k} onClick={() => setFiltro(t.k)} aria-pressed={filtro === t.k}
                className={`rounded-full border px-3 py-1 text-sm ${filtro === t.k ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-text'}`}>
                {t.rotulo}
              </button>
            ))}
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo título ou onde" className="ml-auto w-56 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none" />
            {podeEditar && !form && (
              <button onClick={() => setForm({ ...vazio, tipo: filtro === 'todos' ? 'senha' : filtro })} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90">+ Novo item</button>
            )}
          </div>

          {form && (
            <div className="grid gap-2 rounded-xl border border-brand/30 bg-surface p-4 sm:grid-cols-2">
              <select className={inputCls} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Tipo })}>
                <option value="senha">Senha</option><option value="dado">Dado</option><option value="documento">Documento</option>
              </select>
              <input className={inputCls} placeholder="Título (ex.: Portal da NFS-e)" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
              <input className={inputCls} placeholder="Onde (site, sistema ou local)" value={form.onde} onChange={(e) => setForm({ ...form, onde: e.target.value })} />
              {form.tipo !== 'documento' && <input className={inputCls} placeholder="Usuário / login" autoComplete="off" value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} />}
              {form.tipo === 'senha' && <input className={inputCls} type="password" placeholder="Senha" autoComplete="new-password" value={form.segredo} onChange={(e) => setForm({ ...form, segredo: e.target.value })} />}
              {form.tipo === 'dado' && <textarea className={`${inputCls} sm:col-span-2`} rows={3} placeholder="O dado (ex.: agência e conta, CNPJ, chave Pix)" value={form.segredo} onChange={(e) => setForm({ ...form, segredo: e.target.value })} />}
              <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Notas (opcional)" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
              {form.tipo === 'documento' && <p className="text-[12px] text-muted sm:col-span-2">Salve o item e depois envie o arquivo pelo botão "Enviar arquivo" (até 10 MB).</p>}
              <div className="flex gap-2 sm:col-span-2">
                <button onClick={salvar} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">Guardar</button>
                <button onClick={() => setForm(null)} className="rounded-lg border border-border px-3 py-2 text-sm">Cancelar</button>
              </div>
            </div>
          )}

          <ul className="space-y-2">
            {itens.filter((i) => (filtro === 'todos' || i.tipo === filtro) && `${i.titulo} ${i.onde ?? ''}`.toLowerCase().includes(busca.toLowerCase())).map((i) => {
              const Icon = Icons[ICONE[i.tipo]] as React.ElementType;
              const r = revelados[i.id];
              return (
                <li key={i.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Icon size={18} className="shrink-0 text-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{i.titulo}</div>
                      {i.onde && <div className="truncate text-[12px] text-muted">{i.onde}</div>}
                    </div>
                    {(i.temUsuario || i.temSegredo || i.temNotas) && (
                      <button onClick={() => (r ? setRevelados((x) => { const y = { ...x }; delete y[i.id]; return y; }) : revelar(i.id))} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] hover:bg-surface-2">
                        {r ? <><Icons.EyeOff size={13} aria-hidden /> Esconder</> : <><Icons.Eye size={13} aria-hidden /> Mostrar</>}
                      </button>
                    )}
                    {i.arquivo && <button onClick={() => baixarArquivo(i)} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] hover:bg-surface-2"><Icons.Download size={13} aria-hidden /> {i.arquivo.nome}</button>}
                    {podeEditar && i.tipo === 'documento' && (
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-border px-2 py-1 text-[12px] hover:bg-surface-2">
                        <Icons.Upload size={13} aria-hidden /> {i.arquivo ? 'Trocar arquivo' : 'Enviar arquivo'}
                        <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarArquivo(i, f); e.target.value = ''; }} />
                      </label>
                    )}
                    {podeEditar && (
                      <>
                        <button onClick={() => editar(i)} className="text-[12px] text-muted hover:text-text">editar</button>
                        <button onClick={() => apagar(i)} className="text-[12px] text-muted hover:text-bad">apagar</button>
                      </>
                    )}
                  </div>
                  {r && (
                    <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
                      {r.usuario && <Campo rotulo="Usuário" valor={r.usuario} onCopiar={() => copiar(r.usuario!, 'Usuário')} />}
                      {r.segredo && <Campo rotulo={i.tipo === 'senha' ? 'Senha' : 'Dado'} valor={r.segredo} mono onCopiar={() => copiar(r.segredo!, i.tipo === 'senha' ? 'Senha' : 'Dado')} />}
                      {r.notas && <Campo rotulo="Notas" valor={r.notas} />}
                      <p className="text-[11px] text-muted">Some sozinho em {SEGUNDOS_VISIVEL} s.</p>
                    </dl>
                  )}
                </li>
              );
            })}
            {itens.length === 0 && <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">O cofre está vazio. Comece pelas senhas que hoje vivem no WhatsApp.</li>}
          </ul>
          {podeEditar && <Socios chamar={chamar} onAviso={flash} onErro={setErro} />}
        </>
      )}
    </div>
  );
}

function Campo({ rotulo, valor, mono, onCopiar }: { rotulo: string; valor: string; mono?: boolean; onCopiar?: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-16 shrink-0 text-[12px] text-muted">{rotulo}</dt>
      <dd className={`min-w-0 flex-1 whitespace-pre-wrap break-all ${mono ? 'font-os-mono' : ''}`}>{valor}</dd>
      {onCopiar && <button onClick={onCopiar} className="shrink-0 text-[12px] text-muted hover:text-text"><Icons.Copy size={13} aria-label="Copiar" /></button>}
    </div>
  );
}

function Destrancar({ bloqueadoAte, onAbrir }: { bloqueadoAte: string | null; onAbrir: (senha: string) => Promise<void> }) {
  const [senha, setSenha] = useState('');
  const [indo, setIndo] = useState(false);
  return (
    <form
      onSubmit={async (e) => { e.preventDefault(); if (!senha) return; setIndo(true); await onAbrir(senha); setSenha(''); setIndo(false); }}
      className="mx-auto max-w-sm space-y-3 rounded-xl border border-border bg-surface p-6 text-center"
    >
      <Icons.LockKeyhole size={28} className="mx-auto text-muted" aria-hidden />
      <div className="font-medium">O cofre está trancado</div>
      {bloqueadoAte && <p className="text-sm text-bad">Bloqueado por tentativas erradas até {new Date(bloqueadoAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</p>}
      <input type="password" autoFocus autoComplete="off" placeholder="Senha do cofre" value={senha} onChange={(e) => setSenha(e.target.value)} className={inputCls} />
      <button disabled={indo || !senha} className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50">{indo ? 'Abrindo…' : 'Destrancar'}</button>
      <p className="text-[12px] text-muted">É a senha do cofre, não a do login.</p>
    </form>
  );
}

type Chamar = <T>(path: string, init?: RequestInit, comSessao?: boolean) => Promise<T>;

function CriarSenha({ chamar, onPronto, onErro }: { chamar: Chamar; onPronto: () => void; onErro: (m: string) => void }) {
  const [f, setF] = useState({ login: '', nova: '', conf: '' });
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (f.nova.length < 8) return onErro('A senha do cofre precisa de pelo menos 8 caracteres.');
        if (f.nova !== f.conf) return onErro('As duas senhas do cofre não são iguais.');
        try { await chamar('/senha', { method: 'POST', body: JSON.stringify({ senhaNova: f.nova, ...(f.login ? { senhaDoLogin: f.login } : {}) }) }, false); onPronto(); }
        catch (err) { onErro((err as Error).message); }
      }}
      className="mx-auto max-w-sm space-y-3 rounded-xl border border-border bg-surface p-6"
    >
      <div className="text-center font-medium">Crie a senha do seu cofre</div>
      <p className="text-center text-[12px] text-muted">Ela é sua, diferente da senha do login. Se esquecer, outro sócio zera o seu acesso.</p>
      <p className="text-center text-[12px] text-muted">Entra pelo Google? Deixe o primeiro campo vazio: vale se você entrou no OS nos últimos 10 minutos. Se não, saia e entre de novo.</p>
      <input type="password" autoComplete="current-password" placeholder="Senha do login (vazio se entra pelo Google)" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} className={inputCls} />
      <input type="password" autoComplete="new-password" placeholder="Nova senha do cofre (8+ caracteres)" value={f.nova} onChange={(e) => setF({ ...f, nova: e.target.value })} className={inputCls} />
      <input type="password" autoComplete="new-password" placeholder="Repita a senha do cofre" value={f.conf} onChange={(e) => setF({ ...f, conf: e.target.value })} className={inputCls} />
      <button className="w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90">Criar senha do cofre</button>
    </form>
  );
}

function TrocarSenha({ chamar, onPronto, onErro }: { chamar: Chamar; onPronto: () => void; onErro: (m: string) => void }) {
  const [f, setF] = useState({ atual: '', nova: '', conf: '' });
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (f.nova.length < 8) return onErro('A senha do cofre precisa de pelo menos 8 caracteres.');
        if (f.nova !== f.conf) return onErro('As duas senhas novas não são iguais.');
        try { await chamar('/senha', { method: 'POST', body: JSON.stringify({ senhaNova: f.nova, senhaAtual: f.atual }) }, false); onPronto(); }
        catch (err) { onErro((err as Error).message); }
      }}
      className="grid gap-2 rounded-xl border border-border bg-surface p-4 sm:grid-cols-3"
    >
      <input type="password" autoComplete="current-password" placeholder="Senha atual do cofre" value={f.atual} onChange={(e) => setF({ ...f, atual: e.target.value })} className={inputCls} />
      <input type="password" autoComplete="new-password" placeholder="Nova senha (8+)" value={f.nova} onChange={(e) => setF({ ...f, nova: e.target.value })} className={inputCls} />
      <input type="password" autoComplete="new-password" placeholder="Repita a nova" value={f.conf} onChange={(e) => setF({ ...f, conf: e.target.value })} className={inputCls} />
      <button className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90 sm:col-span-3">Trocar senha do cofre</button>
    </form>
  );
}

type Pessoa = { id: string; nome: string; email: string; temSenha: boolean; eu: boolean };

/** Quem esqueceu a senha do cofre: outro sócio zera, e a pessoa cria uma nova confirmando a do login. */
function Socios({ chamar, onAviso, onErro }: { chamar: Chamar; onAviso: (m: string) => void; onErro: (m: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const carregar = () => chamar<Pessoa[]>('/pessoas').then(setPessoas).catch((e) => onErro((e as Error).message));
  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-sm">
      <button onClick={() => { setAberto(!aberto); if (!aberto) carregar(); }} className="text-[12px] text-muted hover:text-text">
        {aberto ? '▾' : '▸'} Sócios com acesso ao cofre
      </button>
      {aberto && pessoas && (
        <ul className="mt-2 divide-y divide-border">
          {pessoas.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1">{p.nome}{p.eu && <span className="ml-1 text-muted">(você)</span>}<span className="ml-2 text-[12px] text-muted">{p.email}</span></span>
              <span className="text-[12px] text-muted">{p.temSenha ? 'tem senha' : 'ainda sem senha'}</span>
              {!p.eu && p.temSenha && (
                <button
                  onClick={() => {
                    if (!window.confirm(`Zerar a senha do cofre de ${p.nome}? Os itens continuam; ${p.nome} cria uma nova confirmando a senha do login.`)) return;
                    chamar(`/senha/${p.id}`, { method: 'DELETE' }).then(() => { onAviso('Senha zerada.'); carregar(); }).catch((e) => onErro((e as Error).message));
                  }}
                  className="text-[12px] text-muted hover:text-bad"
                >
                  zerar senha
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
