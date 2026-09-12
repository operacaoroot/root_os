'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { apiGet, apiPost } from '@/lib/api';

/* ==========================================================================
 * O DEGRAU DE ENTRADA — uma tela só, dois lados (RF-O-01, RF-O-02, RF-M-05)
 * ==========================================================================
 *
 * SEM SESSÃO, ela é o cadastro. COM SESSÃO, ela é a carga guiada do contexto.
 * É a mesma URL de propósito: quem se cadastrou entra pelo login com a conta
 * Google e volta para cá, e a tela continua de onde parou — sem "link do
 * convite", sem token no e-mail, sem ninguém da ROOT mandando nada.
 *
 * O ESTADO NÃO MORA AQUI. `GET /api/tenants/onboarding/estado` o deriva do
 * banco a cada chamada (`onboarding/passos.ts`): a empresa existe, o conector
 * está autorizado, o tema virou nota, o retrato foi escrito. Guardar progresso
 * no navegador faria a tela mentir para quem trocasse de máquina no meio.
 *
 * ----------------------------------------------------------------------------
 * ESTA ROTA É PÚBLICA, E A DECLARAÇÃO MORA EM OUTRO ARQUIVO
 * ----------------------------------------------------------------------------
 * `apps/web/src/components/AppShell.tsx` redireciona para `/login` tudo que não
 * está em `PUBLICAS`, e `/entrar` está lá desde a correção desta fatia — uma
 * edição de uma linha naquela lista, porque o arquivo é disputado por outra
 * fatia desta onda.
 *
 * SEM AQUELA ENTRADA o lado de CADASTRO é inalcançável: o visitante anônimo é
 * mandado para o login, que é justamente o que ele não tem. O lado da CARGA,
 * que é autenticado, continuaria funcionando — e é por isso que o defeito
 * passava despercebido em quem testa já logado.
 *
 * `apps/api/test/onboarding.test.ts` lê aquela lista e cobra `/entrar` nela.
 */

interface Tema {
  id: string;
  titulo: string;
  pergunta: string;
  obrigatorio: boolean;
  especie: string;
}

interface Pergunta {
  temaId: string;
  pergunta: string;
  modo: 'abrir' | 'aprofundar';
  titulo: string;
  obrigatorio: boolean;
  ordem: number;
  total: number;
}

interface Passo {
  passo: string;
  situacao: 'pronto' | 'pendente' | 'opcional-pendente';
  texto: string;
}

interface Fonte {
  chave?: string;
  rotulo?: string;
  oQueTraz?: string;
}

interface Estado {
  empresa: { nome: string; slug: string };
  passos: Passo[];
  atual: string | null;
  concluida: boolean;
  carga: {
    respondidos: string[];
    faltando: string[];
    rasos: string[];
    proxima: Pergunta | null;
    pronta: boolean;
    totalDeTemas: number;
  };
  fontesConectadas: string[];
  fontes: Fonte[];
}

interface FonteDoRetrato {
  tipo: string;
  titulo: string;
  ref: string;
  procedencia: string;
}

interface Retrato {
  texto: string;
  fontes: FonteDoRetrato[];
  pendentes: string[];
}

interface RespostaLivre {
  resposta: string;
  fontes: { tipo: string; titulo?: string; ref?: string }[];
  procedencia: { tem: boolean; aviso: string | null };
}

export default function EntrarPage() {
  const { user, token, ready } = useAuth();
  if (!ready) return <Casca>carregando…</Casca>;
  return user && token ? <Carga token={token} /> : <Cadastro />;
}

/* -------------------------------------------------------------- o cadastro */

function Cadastro() {
  const [empresa, setEmpresa] = useState('');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await apiPost<{ proximoPasso: string }>('/tenants/onboarding/cadastro', {
        empresa,
        nome,
        email,
      });
      setPronto(r.proximoPasso);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (pronto) {
    return (
      <Casca>
        <Marca />
        <div className="rounded-xl border border-border bg-surface p-6">
          <h1 className="text-[15px] font-bold tracking-[-0.02em]">Conta criada</h1>
          <p className="mt-2 text-[12.5px] leading-[1.7] text-muted">{pronto}</p>
          <a
            href="/login"
            className="mt-5 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink transition hover:bg-brand/90"
          >
            Ir para o login
          </a>
        </div>
      </Casca>
    );
  }

  return (
    <Casca>
      <Marca />
      <form onSubmit={enviar} className="space-y-4 rounded-xl border border-border bg-surface p-6">
        <div>
          <h1 className="text-[15px] font-bold tracking-[-0.02em]">Criar a conta da sua empresa</h1>
          <p className="mt-1 text-[11.5px] leading-[1.6] text-muted">
            Três campos. Depois você entra com a conta Google desse e-mail e o OS conduz o resto —
            ninguém da ROOT preenche nada por você.
          </p>
        </div>

        <Campo rotulo="Nome da empresa" valor={empresa} onChange={setEmpresa} minLength={2} />
        <Campo rotulo="Seu nome" valor={nome} onChange={setNome} minLength={2} />
        <Campo rotulo="Seu e-mail" valor={email} onChange={setEmail} tipo="email" />

        {erro && <div className="text-sm text-bad">{erro}</div>}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-lg bg-brand py-2 text-sm font-medium text-ink transition hover:bg-brand/90 disabled:opacity-60"
        >
          {enviando ? 'Criando…' : 'Criar conta'}
        </button>

        <p className="text-[11px] text-muted">
          Já tem conta?{' '}
          <a href="/login" className="underline underline-offset-2">
            entrar
          </a>
        </p>
      </form>
    </Casca>
  );
}

/* ----------------------------------------------------------- a carga guiada */

function Carga({ token }: { token: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [roteiro, setRoteiro] = useState<Tema[]>([]);
  const [resposta, setResposta] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [retrato, setRetrato] = useState<Retrato | null>(null);
  const [pergunta, setPergunta] = useState('');
  const [livre, setLivre] = useState<RespostaLivre | null>(null);

  const recarregar = useCallback(async () => {
    const e = await apiGet<Estado>('/tenants/onboarding/estado', token);
    setEstado(e);
  }, [token]);

  useEffect(() => {
    recarregar().catch((e) => setErro((e as Error).message));
    apiGet<{ temas: Tema[] }>('/tenants/onboarding/roteiro', token)
      .then((r) => setRoteiro(r.temas))
      .catch(() => setRoteiro([]));
  }, [recarregar, token]);

  async function responder(e: FormEvent) {
    e.preventDefault();
    const tema = estado?.carga.proxima?.temaId;
    if (!tema) return;
    setErro(null);
    setOcupado(true);
    try {
      const r = await apiPost<{ estado: Estado }>(
        '/tenants/onboarding/carga/resposta',
        { tema, resposta },
        token,
      );
      setEstado(r.estado);
      setResposta('');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function fechar() {
    setErro(null);
    setOcupado(true);
    try {
      setRetrato(await apiPost<Retrato>('/tenants/onboarding/carga/fechar', {}, token));
      await recarregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function perguntar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      setLivre(
        await apiPost<RespostaLivre>(
          '/tenants/onboarding/primeira-pergunta',
          { pergunta },
          token,
        ),
      );
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!estado) return <Casca>{erro ?? 'carregando…'}</Casca>;

  const proxima = estado.carga.proxima;

  return (
    <Casca largura="max-w-[720px]">
      <Marca />

      <div className="mb-5 rounded-xl border border-border bg-surface p-5">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
          {estado.empresa.nome}
        </div>
        <ol className="mt-3 space-y-2">
          {estado.passos.map((p) => (
            <li key={p.passo} className="flex gap-3 text-[12px] leading-[1.6]">
              <span
                aria-hidden
                className={
                  p.situacao === 'pronto'
                    ? 'text-brand'
                    : p.situacao === 'opcional-pendente'
                      ? 'text-muted'
                      : 'text-text'
                }
              >
                {p.situacao === 'pronto' ? '●' : '○'}
              </span>
              <span className={p.situacao === 'pronto' ? 'text-muted' : 'text-text'}>{p.texto}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Conectar fonte é OPCIONAL e está aqui como convite, não como pedágio.
          A autorização em si é a rota que já existe (`/integrations/:chave/autorizacao`),
          e ela acontece na conta do próprio cliente. */}
      {estado.fontes?.length > 0 && (
        <div className="mb-5 rounded-xl border border-border bg-bg2 p-5">
          <div className="text-[12px] font-bold">Conectar as suas fontes (opcional)</div>
          <ul className="mt-2 space-y-1.5">
            {estado.fontes.map((f) => (
              <li key={f.chave} className="text-[11.5px] leading-[1.6] text-muted">
                <span className="text-text">{f.rotulo}</span> — {f.oQueTraz}
                {estado.fontesConectadas.includes(f.chave ?? '') && (
                  <span className="ml-2 text-brand">conectado</span>
                )}
              </li>
            ))}
          </ul>
          <a
            href="/conexoes"
            className="mt-3 inline-block border border-border px-3 py-[6px] text-[10px] uppercase tracking-[0.12em] text-muted hover:border-border-strong hover:text-text"
          >
            abrir Conexões
          </a>
        </div>
      )}

      {proxima && (
        <form onSubmit={responder} className="mb-5 rounded-xl border border-border bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
              {proxima.modo === 'aprofundar' ? 'vamos um pouco mais fundo' : proxima.titulo}
            </div>
            <div className="text-[10px] text-muted">
              {proxima.ordem} de {proxima.total}
            </div>
          </div>
          <p className="mt-2 text-[13.5px] leading-[1.7]">{proxima.pergunta}</p>
          <textarea
            value={resposta}
            onChange={(e) => setResposta(e.target.value)}
            rows={5}
            required
            className="mt-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
            placeholder="Responda como você falaria. O OS organiza o resto."
          />
          <button
            type="submit"
            disabled={ocupado}
            className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink transition hover:bg-brand/90 disabled:opacity-60"
          >
            {ocupado ? 'Guardando…' : 'Responder'}
          </button>
        </form>
      )}

      {estado.carga.pronta && !retrato && (
        <div className="mb-5 rounded-xl border border-border bg-surface p-5">
          <div className="text-[12px] font-bold">O contexto obrigatório está carregado.</div>
          <p className="mt-1 text-[11.5px] leading-[1.6] text-muted">
            Peça ao OS para ler de volta o que ele entendeu. Cada parte vem com a nota de onde saiu.
          </p>
          <button
            onClick={fechar}
            disabled={ocupado}
            className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink transition hover:bg-brand/90 disabled:opacity-60"
          >
            {ocupado ? 'Lendo…' : 'Ler de volta'}
          </button>
        </div>
      )}

      {retrato && (
        <div className="mb-5 rounded-xl border border-brand/40 bg-surface p-5">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
            a primeira resposta
          </div>
          <pre className="mt-2 whitespace-pre-wrap font-os-mono text-[12px] leading-[1.75]">
            {retrato.texto}
          </pre>
          <div className="mt-4 border-t border-border pt-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
              fontes desta resposta
            </div>
            <ul className="mt-1.5 space-y-1">
              {retrato.fontes.map((f) => (
                <li key={f.ref} className="text-[11px] text-muted">
                  {f.titulo} · <span className="text-text">{f.ref}</span> ({f.procedencia})
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {estado.concluida && (
        <form onSubmit={perguntar} className="mb-5 rounded-xl border border-border bg-surface p-5">
          <div className="text-[12px] font-bold">Agora pergunte alguma coisa</div>
          <p className="mt-1 text-[11.5px] leading-[1.6] text-muted">
            O assistente responde a partir do que você carregou — e esta tela mostra, sem enfeite, se
            a resposta veio com fonte ou não.
          </p>
          <input
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            required
            minLength={3}
            className="mt-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
            placeholder="Ex.: qual é a regra de desconto aqui?"
          />
          <button
            type="submit"
            disabled={ocupado}
            className="mt-3 rounded-lg border border-border px-4 py-2 text-sm transition hover:border-brand disabled:opacity-60"
          >
            {ocupado ? 'Perguntando…' : 'Perguntar'}
          </button>

          {livre && (
            <div className="mt-4 border-t border-border pt-3">
              <pre className="whitespace-pre-wrap font-os-mono text-[12px] leading-[1.75]">
                {livre.resposta}
              </pre>
              {livre.procedencia.tem ? (
                <ul className="mt-2 space-y-1">
                  {livre.fontes.map((f, i) => (
                    <li key={`${f.ref ?? f.titulo}-${i}`} className="text-[11px] text-muted">
                      {f.tipo} · {f.titulo ?? f.ref}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[11.5px] leading-[1.6] text-bad">
                  {livre.procedencia.aviso}
                </p>
              )}
            </div>
          )}
        </form>
      )}

      {erro && <div className="text-sm text-bad">{erro}</div>}

      {estado.concluida && (
        <a
          href="/painel"
          className="inline-block border border-border px-3 py-[6px] text-[10px] uppercase tracking-[0.12em] text-muted hover:border-border-strong hover:text-text"
        >
          ir para o console
        </a>
      )}
    </Casca>
  );
}

/* ------------------------------------------------------------------ pedaços */

function Casca({
  children,
  largura = 'max-w-sm',
}: {
  children: React.ReactNode;
  largura?: string;
}) {
  return (
    <div data-os-app className="grid min-h-screen place-items-start justify-center bg-bg p-6">
      <div className={`w-full ${largura} py-8`}>{children}</div>
    </div>
  );
}

function Marca() {
  return (
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
  );
}

function Campo({
  rotulo,
  valor,
  onChange,
  tipo = 'text',
  minLength,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  tipo?: string;
  minLength?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted">{rotulo}</label>
      <input
        type={tipo}
        value={valor}
        minLength={minLength}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
        required
      />
    </div>
  );
}
