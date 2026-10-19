// Default relativo (/api) → o Next faz proxy p/ a API (ver next.config.mjs).
// Funciona em localhost, LAN e túnel, sem CORS nem URL fixa no build.
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/**
 * O CÓDIGO da recusa de conector desligado (RF-G-06).
 *
 * Cópia do valor que a API declara em `apps/api/src/integrations/conectores.ts`.
 * Não é importável: o pacote compartilhado não expõe nada da porta, e criar essa
 * dependência só por uma string custaria mais do que a duplicação. O que amarra
 * os dois lados é um caso de teste em cada suíte, e o valor é uma constante
 * congelada — se um dia mudar, é mudança de contrato e merece as duas edições.
 */
export const CODIGO_CONECTOR_DESLIGADO = 'conector_desligado';

/**
 * O CÓDIGO da recusa por assinatura suspensa (RF-O-03).
 *
 * Mesma decisão de duplicação da linha acima: cópia do valor que a API declara
 * em `apps/api/src/billing/assinatura.ts` (`CODIGO_ASSINATURA_SUSPENSA`), com um
 * caso de teste em cada suíte amarrando os dois lados.
 *
 * ELE EXISTE PORQUE O SUSPENSO NÃO CHEGAVA NA TELA DE SUSPENSÃO. A API devolvia
 * 403 com este código em toda rota do produto, e o web não sabia lê-lo: quem
 * entrava suspenso caía no painel, via caixa vermelha em cada bloco, e só achava
 * `/assinatura` digitando o endereço. O precedente de como resolver já estava
 * aqui ao lado, no conector desligado: a API diz o código, o web reconhece pelo
 * CONTRATO e não por substring de frase em português — que quebra em silêncio na
 * primeira reescrita do texto.
 */
export const CODIGO_ASSINATURA_SUSPENSA = 'assinatura_suspensa';

/**
 * Erro de API que PRESERVA o código e o status, além da frase.
 *
 * Um `Error` cru só levava a mensagem, e a tela ficava com duas opções ruins:
 * mostrar mais uma caixa vermelha genérica, ou reconhecer a recusa por
 * substring da frase em português — que quebra em silêncio na primeira
 * reescrita do texto. Com o código, a tela decide pelo contrato.
 */
export class ErroDaApi extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codigo: string | null = null,
    /** O que a API listou além da frase (`faltando`, `erros`): o que falta para passar. */
    readonly detalhes: string[] = [],
  ) {
    super(message);
    this.name = 'ErroDaApi';
  }
}

/** É a recusa de conector desligado? A pergunta que a tela faz. */
export function ehConectorDesligado(e: unknown): e is ErroDaApi {
  return e instanceof ErroDaApi && e.codigo === CODIGO_CONECTOR_DESLIGADO;
}

/**
 * É a recusa por assinatura suspensa? A pergunta que a casca faz.
 *
 * Quem a usa é o `AppShell`, para mandar o suspenso à tela que explica o
 * bloqueio em vez de deixá-lo numa tela cheia de erro sem causa aparente.
 */
export function ehAssinaturaSuspensa(e: unknown): e is ErroDaApi {
  return e instanceof ErroDaApi && e.codigo === CODIGO_ASSINATURA_SUSPENSA;
}

/**
 * Traduz o corpo de uma resposta de erro no `ErroDaApi` que a tela recebe.
 *
 * Separado de `handle` para poder ser testado sem `fetch`: é aqui que mora a
 * ordem de precedência entre `issues`, `message` e `error`, e essa ordem já
 * escondeu qual campo reprovou uma vez.
 */
export function erroDaResposta(body: Record<string, unknown>, status: number): ErroDaApi {
  // O ZodExceptionFilter responde {error:'ValidationError', issues:[{path,message}]}
  // e NÃO manda `message` — sem desdobrar o issues a tela mostrava só o rótulo
  // genérico, escondendo qual campo reprovou.
  const issues: string = Array.isArray(body.issues)
    ? body.issues
        .map((i: { path?: string; message?: string }) =>
          [i.path, i.message].filter(Boolean).join(': '),
        )
        .filter(Boolean)
        .join(' · ')
    : '';
  // `message` pode vir como lista (ValidationPipe do Nest manda um array de
  // frases). Juntar é o que o `new Error(array)` antigo fazia por acidente, via
  // coerção — aqui é explícito, e com separador legível.
  const mensagem = Array.isArray(body.message)
    ? body.message.filter((m) => typeof m === 'string').join(' · ')
    : typeof body.message === 'string'
      ? body.message
      : '';
  const texto =
    issues || mensagem || (typeof body.error === 'string' ? body.error : '') || `Erro ${status}`;
  const detalhes = [body.faltando, body.erros]
    .flatMap((l) => (Array.isArray(l) ? l : []))
    .filter((x): x is string => typeof x === 'string' && x.length > 0);
  return new ErroDaApi(texto, status, typeof body.error === 'string' ? body.error : null, detalhes);
}

type ObservadorDeSessao = (tokenRecusado: string) => void;
const observadoresDeSessao = new Set<ObservadorDeSessao>();
/** Tokens circulam apenas entre os helpers e o provider em memória. */
export function observarSessaoRecusada(observar: ObservadorDeSessao): () => void {
  observadoresDeSessao.add(observar);
  return () => { observadoresDeSessao.delete(observar); };
}
function conferirRecusaDaSessao(status: number, body: Record<string, unknown>, path: string, token?: string | null) {
  if (status !== 401 || !token || path.split('?')[0] === '/auth/login') return;
  // Outras recusas 401 (senha de confirmação ou credencial de provedor) não
  // invalidam a sessão ROOT. Estas mensagens são emitidas pelo JwtAuthGuard.
  if (path.split('?')[0] !== '/auth/me' && !['Token inválido', 'Sem token', 'Sessão sem empresa'].includes(String(body.message ?? ''))) return;
  for (const observar of observadoresDeSessao) observar(token);
}

async function handle<T>(res: Response, path: string, token?: string | null): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    conferirRecusaDaSessao(res.status, body as Record<string, unknown>, path, token);
    throw erroDaResposta(body as Record<string, unknown>, res.status);
  }
  return res.json();
}

export function apiGet<T>(path: string, token?: string | null): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  }).then((r) => handle<T>(r, path, token));
}

/**
 * GET que responde texto (markdown, csv). O token vai no cabeçalho, como nos
 * outros: um `<a href>` direto não levaria o `Authorization`.
 */
export async function apiTexto(path: string, token?: string | null): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    conferirRecusaDaSessao(res.status, body as Record<string, unknown>, path, token);
    throw erroDaResposta(body as Record<string, unknown>, res.status);
  }
  return res.text();
}

/** GET que responde binário (a imagem de uma thumb), com o token no cabeçalho. */
export async function apiBlob(path: string, token?: string | null): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    conferirRecusaDaSessao(res.status, body as Record<string, unknown>, path, token);
    throw erroDaResposta(body as Record<string, unknown>, res.status);
  }
  return res.blob();
}

export function apiPost<T>(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r, path, token));
}

/**
 * Upload de arquivo. Sem `Content-Type` de propósito: o browser precisa montar
 * o boundary do multipart sozinho — definir o header à mão quebra o parse.
 */
export function apiUpload<T>(
  path: string,
  arquivo: File,
  token?: string | null,
  campo = 'file',
): Promise<T> {
  const form = new FormData();
  form.append(campo, arquivo);
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  }).then((r) => handle<T>(r, path, token));
}

export function apiPatch<T>(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r, path, token));
}

export function apiDelete<T>(path: string, token?: string | null): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then((r) => handle<T>(r, path, token));
}

export function apiPut<T>(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r, path, token));
}

/**
 * POST que responde `text/event-stream`, lido pedaço a pedaço.
 *
 * `fetch` + ReadableStream, e não `EventSource`: o EventSource não manda
 * header, e token em query string é dado sensível dentro de URL — que fica em
 * log de proxy, em histórico e no Referer.
 *
 * Devolve uma função de cancelamento: sair da tela no meio de uma resposta
 * precisa abortar a requisição, senão o laço do agente continua rodando (e
 * gastando) para ninguém.
 */
export function apiStream<E>(
  path: string,
  body: unknown,
  token: string | null | undefined,
  onEvento: (e: E) => void,
): { pronto: Promise<void>; cancelar: () => void } {
  const ctrl = new AbortController();

  const pronto = (async () => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const erro = await res.json().catch(() => ({}));
      conferirRecusaDaSessao(res.status, erro, path, token);
      throw erroDaResposta(erro, res.status);
    }

    const leitor = res.body.getReader();
    const dec = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      // Um evento SSE termina em linha em branco. Sem esperar por ela, um
      // JSON partido no meio do chunk quebraria o parse.
      const partes = buffer.split('\n\n');
      buffer = partes.pop() ?? '';
      for (const p of partes) {
        const linha = p.split('\n').find((l) => l.startsWith('data: '));
        if (!linha) continue;
        try {
          onEvento(JSON.parse(linha.slice(6)) as E);
        } catch {
          /* evento malformado não derruba o stream */
        }
      }
    }
  })();

  return { pronto, cancelar: () => ctrl.abort() };
}
