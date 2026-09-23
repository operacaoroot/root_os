'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiGet, apiPost, apiUpload } from '@/lib/api';
import type { EstadoDoLink, ItemDoLink, RetratoDoTrilho } from '../../onboarding/tipos';

/*
 * O LINK DO CLIENTE — a superfície pública do onboarding, no celular.
 *
 * Sem login (a rota está em `PUBLICAS` do AppShell): o token na URL é a
 * credencial. Quatro blocos, na ordem do desenho de 23/09: o que já ficou
 * resolvido na conversa (confirmar em um minuto), o que só o cliente sabe
 * (texto ou áudio), pessoas e acessos, o primeiro resultado. Termina no
 * retrato — o OS lendo de volta o que entendeu, com a origem de cada parte.
 *
 * O estado é o da API a cada resposta; nada de progresso no navegador (o link
 * guarda de onde parou porque o banco guarda). O nome de quem responde fica
 * no `localStorage` só para não perguntar de novo.
 */

const CHAVE_DO_NOME = 'onb_nome';

export default function LinkPage() {
  const { token } = useParams<{ token: string }>();
  const [estado, setEstado] = useState<EstadoDoLink | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [nomeOk, setNomeOk] = useState(false);
  const [retrato, setRetrato] = useState<RetratoDoTrilho | null>(null);
  const [mensagemFinal, setMensagemFinal] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const base = `/tenants/onboarding/link/${token}`;

  const carregar = useCallback(() => {
    apiGet<EstadoDoLink>(base).then(setEstado).catch((e: Error) => setErro(e.message));
  }, [base]);

  useEffect(() => {
    carregar();
    try {
      const n = localStorage.getItem(CHAVE_DO_NOME);
      if (n) {
        setNome(n);
        setNomeOk(true);
      }
    } catch {
      /* navegador sem storage: pergunta o nome de novo */
    }
  }, [carregar]);

  useEffect(() => {
    if (estado?.concluido && estado.blocos === 'BCD' && !retrato) {
      apiGet<RetratoDoTrilho>(`${base}/retrato`).then(setRetrato).catch(() => undefined);
    }
  }, [estado, base, retrato]);

  async function agir<T>(chave: string, fn: () => Promise<T>): Promise<T | undefined> {
    setErro(null);
    setOcupado(chave);
    try {
      const r = await fn();
      return r;
    } catch (e) {
      setErro((e as Error).message);
      return undefined;
    } finally {
      setOcupado(null);
    }
  }

  const guardarNome = () => {
    const n = nome.trim();
    if (n.length < 2) return;
    try {
      localStorage.setItem(CHAVE_DO_NOME, n);
    } catch {
      /* sem storage, segue */
    }
    setNomeOk(true);
  };

  if (erro && !estado) {
    return (
      <Casca>
        <Marca />
        <div className="rounded-xl border border-border bg-surface p-5 text-sm">
          <p className="font-medium">Este link não está disponível.</p>
          <p className="mt-1 text-muted">Ele pode ter vencido ou sido substituído. Peça um novo no grupo com a Root.</p>
        </div>
      </Casca>
    );
  }
  if (!estado) return <Casca><Marca /><p className="text-sm text-muted">carregando…</p></Casca>;

  if (!nomeOk) {
    return (
      <Casca>
        <Marca />
        <div className="rounded-xl border border-border bg-surface p-5">
          <h1 className="text-[16px] font-bold">Onboarding da {estado.cliente}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            {estado.blocos === 'A'
              ? 'Cinco perguntas, uns 5 minutos. Com elas a gente chega na reunião falando da sua empresa, e não de IA em geral.'
              : 'Parte já veio do que você disse na conversa — é só confirmar. O resto você responde por texto ou áudio. Uns 8 minutos, e pode parar e voltar.'}
          </p>
          <label className="mt-4 block text-xs text-muted">Quem está respondendo?</label>
          <input className={INPUT} value={nome} onChange={(e) => setNome(e.target.value)} placeholder={estado.contatoNome ?? 'seu nome'} onKeyDown={(e) => e.key === 'Enter' && guardarNome()} />
          <button type="button" onClick={guardarNome} disabled={nome.trim().length < 2} className={BOTAO_PRIMARIO}>Começar</button>
        </div>
      </Casca>
    );
  }

  if (estado.concluido || mensagemFinal) {
    return (
      <Casca largura="max-w-[640px]">
        <Marca />
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">{estado.cliente}</p>
          <h1 className="mt-1 text-[16px] font-bold">{mensagemFinal ?? 'Onboarding concluído.'}</h1>
          {retrato && (
            <div className="mt-4 space-y-3">
              <p className="text-[12px] text-muted">Cada parte diz de onde veio. Se algo estiver errado, responda no grupo: corrigir substitui, não duplica.</p>
              {retrato.partes.map((p) => (
                <div key={p.temaId} className="rounded-lg border border-border bg-surface-2 p-3 text-[13.5px] leading-relaxed">
                  <span className="font-semibold">{p.titulo}.</span> {p.texto}
                  <div className="mt-1 font-os-mono text-[10.5px] text-muted">{p.fonte}</div>
                </div>
              ))}
              {retrato.pendentes.length > 0 && <p className="text-[12px] text-warn">Ainda sem resposta: {retrato.pendentes.join(', ')}.</p>}
              <div className="rounded-lg border border-brand/40 bg-brand/10 p-3">
                <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">A sua primeira pergunta</p>
                {retrato.primeiraPergunta.pergunta && <p className="mt-1 font-medium">“{retrato.primeiraPergunta.pergunta}”</p>}
                <p className="mt-1 text-[13px] text-muted">{retrato.primeiraPergunta.resposta}</p>
              </div>
            </div>
          )}
        </div>
      </Casca>
    );
  }

  const blocos = ['A', 'B', 'C', 'D'].map((b) => ({ b, itens: estado.itens.filter((i) => i.bloco === b) })).filter((x) => x.itens.length);
  const feitos = estado.progresso.confirmados + estado.progresso.respondidos;
  const pct = Math.round((feitos / Math.max(1, estado.progresso.total)) * 100);

  return (
    <Casca largura="max-w-[640px]">
      <Marca />
      <div className="sticky top-0 z-10 -mx-2 mb-4 rounded-xl border border-border bg-surface p-3">
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="font-medium">{estado.cliente}</span>
          <span className="text-muted">{feitos} de {estado.progresso.total} · válido até {new Date(estado.validoAte).toLocaleDateString('pt-BR')}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
        {estado.progresso.obrigatoriosFaltando.length > 0 && <p className="mt-1 text-[11px] text-muted">Faltam: {estado.progresso.obrigatoriosFaltando.join(', ')}</p>}
      </div>

      {erro && <p className="mb-3 rounded-lg border border-bad/40 bg-bad/10 p-2 text-[13px] text-bad">{erro}</p>}

      {blocos.map(({ b, itens }) => (
        <section key={b} className="mb-6">
          <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">Bloco {b}</p>
          <h2 className="text-[17px] font-bold">{itens[0].blocoRotulo}</h2>
          <p className="mb-2 text-[12px] text-muted">
            {b === 'A' ? 'Cinco perguntas rápidas.' : b === 'B' ? 'O que já ficou resolvido na conversa aparece para confirmar. O resto, você responde.' : b === 'C' ? 'Não chegamos a falar disto. Escreva ou grave um áudio.' : 'Duas pessoas, sempre: quem propõe não aprova. E o número de partida, para medir depois.'}
          </p>
          <div className="space-y-3">
            {itens.map((i) => (
              <ItemCard key={i.temaId} i={i} base={base} nome={nome} ocupado={ocupado} agir={agir} onMudou={setEstado} />
            ))}
          </div>
        </section>
      ))}

      <div className="mb-8 space-y-2">
        <button
          type="button"
          disabled={estado.progresso.obrigatoriosFaltando.length > 0 || ocupado === 'concluir'}
          onClick={() => agir('concluir', () => apiPost<{ retrato: RetratoDoTrilho | null; mensagem: string }>(`${base}/concluir`, { nome })).then((r) => { if (r) { setRetrato(r.retrato); setMensagemFinal(r.mensagem); } })}
          className={BOTAO_PRIMARIO}
        >
          {estado.blocos === 'A' ? 'Concluir' : 'Concluir e ver o que o OS entendeu →'}
        </button>
        <p className="text-center text-[11px] text-muted">Pode fechar e voltar depois: o link guarda de onde parou. Senha, token e dado bancário nunca entram por aqui.</p>
      </div>
    </Casca>
  );
}

// ---------------------------------------------------------------------------

type Agir = <T>(chave: string, fn: () => Promise<T>) => Promise<T | undefined>;

function ItemCard({ i, base, nome, ocupado, agir, onMudou }: { i: ItemDoLink; base: string; nome: string; ocupado: string | null; agir: Agir; onMudou: (e: EstadoDoLink) => void }) {
  const [corrigindo, setCorrigindo] = useState(false);
  const [texto, setTexto] = useState('');
  const [gravando, setGravando] = useState(false);
  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const rota = `${base}/itens/${i.temaId}`;
  const chave = `item-${i.temaId}`;

  const confirmar = () => agir(chave, () => apiPost<EstadoDoLink>(`${rota}/confirmar`, { nome })).then((e) => e && onMudou(e));
  const corrigir = () => agir(chave, () => apiPost<EstadoDoLink>(`${rota}/corrigir`, { texto, nome })).then((e) => { if (e) { onMudou(e); setCorrigindo(false); setTexto(''); } });
  const responder = (t: string) => agir(chave, () => apiPost<EstadoDoLink>(`${rota}/responder`, { texto: t, nome })).then((e) => { if (e) { onMudou(e); setTexto(''); } });

  async function alternarGravacao() {
    if (gravando) {
      gravador.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      pedacos.current = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) pedacos.current.push(ev.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        const tipo = rec.mimeType || 'audio/webm';
        const blob = new Blob(pedacos.current, { type: tipo });
        if (blob.size < 1000) return;
        const arquivo = new File([blob], `resposta.${tipo.includes('mp4') ? 'm4a' : 'webm'}`, { type: tipo });
        const r = await agir(chave, () => apiUpload<{ texto: string; estado: EstadoDoLink }>(`${rota}/audio?nome=${encodeURIComponent(nome)}`, arquivo));
        if (r) onMudou(r.estado);
      };
      gravador.current = rec;
      rec.start();
      setGravando(true);
    } catch {
      setGravando(false);
    }
  }

  const rodape = i.fonte ? <div className="font-os-mono text-[10.5px] text-muted">{i.fonte}</div> : null;

  return (
    <div className={`rounded-xl border p-4 ${i.modo === 'feito' ? 'border-brand/40' : 'border-border'} bg-surface`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{i.titulo}</div>
        <div className="font-os-mono text-[10px] text-muted">{i.obrigatorio ? 'obrigatório' : 'opcional'}</div>
      </div>

      {i.modo === 'feito' && (
        <div className="mt-2">
          <p className="text-[14px] leading-relaxed">{i.textoFinal}</p>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-brand">✓ {i.status === 'confirmado' ? 'Confirmado' : i.status === 'corrigido' ? 'Corrigido' : i.respondidoVia === 'audio' ? 'Respondido por áudio' : 'Respondido'}</div>
          {rodape}
        </div>
      )}

      {i.modo === 'confirmar' && (
        <div className="mt-2">
          <p className="text-[14px] leading-relaxed">{i.interpretado ? 'Entendemos que: ' : ''}{i.proposta}</p>
          {rodape}
          {corrigindo ? (
            <div className="mt-2 space-y-2">
              <textarea className={INPUT} rows={3} placeholder="Escreva só a correção." value={texto} onChange={(e) => setTexto(e.target.value)} />
              <div className="flex gap-2">
                <button type="button" className={BOTAO_PRIMARIO} disabled={!texto.trim() || ocupado === chave} onClick={corrigir}>Salvar correção</button>
                <button type="button" className={BOTAO} onClick={() => setCorrigindo(false)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button type="button" className={BOTAO_PRIMARIO} disabled={ocupado === chave} onClick={confirmar}>Confirmar</button>
              <button type="button" className={BOTAO} onClick={() => setCorrigindo(true)}>Corrigir</button>
            </div>
          )}
        </div>
      )}

      {i.modo === 'responder' && (
        <div className="mt-2">
          <p className="text-[15px] font-medium leading-snug">{i.pergunta}</p>
          <p className="mt-1 text-[12px] text-muted">{i.aprofundar}</p>
          {i.formato === 'escolha' && i.opcoes ? (
            <div className="mt-3 grid gap-2">
              {i.opcoes.map((o) => (
                <button key={o} type="button" disabled={ocupado === chave} onClick={() => responder(o)} className="rounded-lg border border-border bg-surface-2 px-3 py-3 text-left text-[14px] hover:border-brand">{o}</button>
              ))}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <textarea className={INPUT} rows={4} placeholder="Escreva aqui…" value={texto} onChange={(e) => setTexto(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BOTAO_PRIMARIO} disabled={!texto.trim() || ocupado === chave} onClick={() => responder(texto)}>Enviar</button>
                <button type="button" className={gravando ? BOTAO_GRAVANDO : BOTAO} disabled={ocupado === chave && !gravando} onClick={alternarGravacao} aria-label={gravando ? 'Parar gravação' : 'Gravar áudio'}>
                  {gravando ? '■ Gravando… toque para parar' : ocupado === chave ? 'transcrevendo…' : '● Prefere falar? Gravar áudio'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const INPUT = 'w-full rounded-lg border border-border bg-bg px-3 py-2 text-[14px] outline-none focus:border-brand';
const BOTAO_PRIMARIO = 'w-full rounded-lg bg-brand px-4 py-3 text-[14px] font-semibold text-ink transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto';
const BOTAO = 'rounded-lg border border-border px-4 py-3 text-[14px] transition hover:border-brand disabled:opacity-50';
const BOTAO_GRAVANDO = 'rounded-lg border border-bad bg-bad/10 px-4 py-3 text-[14px] text-bad';

function Casca({ children, largura = 'max-w-sm' }: { children: React.ReactNode; largura?: string }) {
  return (
    <div data-os-app className="grid min-h-screen place-items-start justify-center bg-bg p-4">
      <div className={`w-full ${largura} py-6`}>{children}</div>
    </div>
  );
}

function Marca() {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span aria-hidden className="grid h-10 w-10 place-items-center rounded-root border border-brand/30 bg-brand/10 text-[20px] font-extrabold italic leading-none tracking-[-0.05em] text-brand" style={{ transform: 'skewX(-10deg)', textShadow: 'var(--os-logo-shadow, none)' }}>R</span>
      <div className="font-os-mono">
        <div className="text-[14px] font-bold tracking-[-0.02em]">ROOT</div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">onboarding</div>
      </div>
    </div>
  );
}
