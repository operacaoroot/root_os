'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

type Estado = { cliente: string; expiraEm: string; podeEnviar: boolean };
const vazio = { titulo: '', usuario: '', segredo: '', notas: '' };
const campo = 'mt-1 w-full rounded-lg border border-border bg-surface px-3 py-3 text-base text-text outline-none focus:border-brand';

export default function EntregarAcessos() {
  const token = useRef('');
  const pendente = useRef<(typeof vazio & { token: string; envioId: string }) | null>(null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState('');
  const [recibo, setRecibo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [incerto, setIncerto] = useState(false);
  const [encerrado, setEncerrado] = useState(false);

  useEffect(() => {
    // Somente memória da aba. Retira o token do endereço e do histórico atual.
    // O ref mantém o valor na dupla execução de effects do modo estrito.
    if (!token.current) token.current = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    if (!token.current) { setErro('Abra o link completo que recebeu da ROOT.'); return; }
    const ctrl = new AbortController();
    fetch('/api/cofre-da-empresa/receber/estado', { method: 'POST', cache: 'no-store', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.current }), signal: ctrl.signal })
      .then(async (r) => { if (!r.ok) throw new Error(r.status === 404 ? 'Este link expirou ou foi encerrado. Peça um novo link à ROOT.' : 'Não foi possível abrir o formulário. Reabra o link e tente novamente.'); return r.json(); })
      .then((r: Estado) => { setEstado(r); setEncerrado(!r.podeEnviar); })
      .catch((e) => { if (e.name !== 'AbortError') setErro(e.message); });
    return () => ctrl.abort();
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando || encerrado) return;
    if (!pendente.current) pendente.current = { ...form, token: token.current, envioId: crypto.randomUUID() };
    setEnviando(true); setErro(''); setRecibo('');
    try {
      const r = await fetch('/api/cofre-da-empresa/receber/itens', { method: 'POST', cache: 'no-store', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pendente.current), signal: AbortSignal.timeout(20_000) });
      if (!r.ok) {
        if (r.status >= 500) throw new Error('sem-confirmacao');
        if (r.status === 429) {
          setIncerto(true); setErro('Muitas tentativas. Aguarde uma hora e use “Confirmar envio” para conferir o mesmo pedido.');
          return;
        }
        pendente.current = null; setIncerto(false);
        if (r.status === 404) { setEncerrado(true); setForm(vazio); throw new Error('Este link expirou ou foi encerrado. Peça um novo link à ROOT.'); }
        throw new Error('Confira os campos. Se o erro continuar, peça outro link à ROOT.');
      }
      const result = await r.json();
      if (result.ok !== true || typeof result.recibo !== 'string') throw new Error('sem-confirmacao');
      setRecibo(result.recibo); setForm(vazio); setIncerto(false); pendente.current = null;
    } catch (e) {
      if (pendente.current) {
        setIncerto(true); setErro('A confirmação não chegou. Use “Confirmar envio” para conferir o mesmo envio sem duplicar.');
      } else setErro((e as Error).message);
    } finally { setEnviando(false); }
  }

  return <main className="min-h-screen bg-bg px-5 py-10 text-text sm:py-16">
    <div className="mx-auto max-w-lg">
      <p className="mb-8 font-mono text-sm font-bold tracking-widest">ROOT</p>
      <h1 className="text-2xl font-semibold">Enviar acessos{estado ? ` · ${estado.cliente}` : ''}</h1>
      <p className="mt-3 text-sm text-muted">Envie um acesso por vez. Somente a equipe autorizada da ROOT poderá consultar o que você enviar.</p>
      {estado && <p className="mt-2 text-sm text-muted">Link válido até {new Date(estado.expiraEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília). Os acessos ficam guardados até o encerramento do trabalho.</p>}
      {erro && <p role="alert" className="mt-5 rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm">{erro}</p>}
      {recibo && <div role="status" className="mt-5 rounded-lg border border-good/40 bg-good/10 p-4 text-sm">
        <p className="font-medium">Acesso recebido pela ROOT.</p><p className="mt-1">Você pode enviar o próximo acesso abaixo.</p>
        <p className="mt-2 break-all font-mono text-xs">Recibo: {recibo}</p>
      </div>}
      {!estado && !erro && <p className="mt-6" role="status">Abrindo formulário…</p>}
      {encerrado && <p className="mt-5">Este formulário não aceita novos envios. Peça outro link à ROOT.</p>}
      {estado && !encerrado && <form onSubmit={enviar} className="mt-6 space-y-4" autoComplete="off">
        <fieldset disabled={enviando || incerto} className="space-y-4 disabled:opacity-70">
          <label className="block text-sm font-medium">Sistema ou serviço
            <input required maxLength={80} className={campo} placeholder="Ex.: ERP, hospedagem ou e-mail" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
          </label>
          <label className="block text-sm font-medium">Usuário ou e-mail de acesso
            <input maxLength={300} className={campo} autoCapitalize="none" spellCheck={false} value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} />
          </label>
          <label className="block text-sm font-medium">Senha ou chave de acesso
            <input required type="password" maxLength={5000} autoComplete="new-password" className={campo} value={form.segredo} onChange={(e) => setForm({ ...form, segredo: e.target.value })} />
          </label>
          <label className="block text-sm font-medium">Endereço do sistema e observações (opcional)
            <textarea rows={3} maxLength={5000} className={campo} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </label>
        </fieldset>
        <button disabled={enviando} className="w-full rounded-lg bg-brand px-4 py-3 font-medium text-ink disabled:opacity-60">
          {enviando ? 'Enviando…' : incerto ? 'Confirmar envio' : 'Enviar para a ROOT'}
        </button>
      </form>}
      <p className="mt-7 text-xs text-muted">Este link permite apenas o envio. Não dá acesso ao cofre nem mostra as credenciais já entregues.</p>
    </div>
  </main>;
}
