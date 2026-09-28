import type { ReactNode } from 'react';

/*
 * O markdown do roteiro (MC8) virando tela, SEM innerHTML: o texto veio da IA
 * e de quem editou, então cada pedaço vira elemento React e só http(s) vira
 * link. Cobre o que o roteiro usa — títulos, citação, lista, negrito, código e
 * link (entre colchetes, entre <> ou solto) — e trata o resto como texto.
 */

// A URL solta aceita parênteses equilibrados (`…/wiki/GPT_(modelo)`): o link
// da matéria vem do feed como veio. Um `)` sem par fecha a frase, não a URL.
const INLINE =
  /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|<https?:\/\/[^\s>]+>|https?:\/\/(?:[^\s<>()]|\([^\s<>()]*\))+)/gi;

/** Pontuação que encosta no fim da URL solta não é parte dela. */
function separarPontuacao(url: string): [string, string] {
  const m = url.match(/[.,;:!?]+$/);
  return m ? [url.slice(0, -m[0].length), m[0]] : [url, ''];
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="break-words text-brand underline underline-offset-2">
      {children}
    </a>
  );
}

export function inline(texto: string, chave: string): ReactNode[] {
  const out: ReactNode[] = [];
  let ultimo = 0;
  let i = 0;
  for (const m of texto.matchAll(INLINE)) {
    const pedaco = m[0];
    const ini = m.index ?? 0;
    if (ini > ultimo) out.push(texto.slice(ultimo, ini));
    const k = `${chave}-${i++}`;
    if (pedaco.startsWith('**')) {
      out.push(<strong key={k}>{pedaco.slice(2, -2)}</strong>);
    } else if (pedaco.startsWith('`')) {
      out.push(<code key={k} className="rounded bg-surface-2 px-1 font-mono text-[0.9em]">{pedaco.slice(1, -1)}</code>);
    } else if (pedaco.startsWith('[')) {
      const [, rotulo, href] = pedaco.match(/^\[([^\]]+)\]\((.+)\)$/) ?? [];
      out.push(<Link key={k} href={href}>{rotulo}</Link>);
    } else if (pedaco.startsWith('<')) {
      const href = pedaco.slice(1, -1);
      out.push(<Link key={k} href={href}>{href}</Link>);
    } else {
      const [href, resto] = separarPontuacao(pedaco);
      out.push(<Link key={k} href={href}>{href}</Link>);
      if (resto) out.push(resto);
    }
    ultimo = ini + pedaco.length;
  }
  if (ultimo < texto.length) out.push(texto.slice(ultimo));
  return out;
}

type Bloco =
  | { tipo: 'titulo'; nivel: 1 | 2 | 3; texto: string }
  | { tipo: 'citacao'; linhas: string[] }
  | { tipo: 'lista'; itens: string[] }
  | { tipo: 'paragrafo'; linhas: string[] }
  | { tipo: 'regua' };

export function blocosDoMarkdown(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  // O parágrafo aberto recebe a linha seguinte; linha em branco ou outro bloco o fecha.
  let paragrafo: { tipo: 'paragrafo'; linhas: string[] } | null = null;
  const ultimo = () => blocos[blocos.length - 1];
  for (const cru of texto.replace(/\r\n/g, '\n').split('\n')) {
    const linha = cru.trimEnd();
    if (!linha.trim()) {
      paragrafo = null;
      continue;
    }
    const t = linha.match(/^(#{1,3})\s+(.*)$/);
    const c = linha.match(/^\s*>\s?(.*)$/);
    const l = linha.match(/^\s*[-*+]\s+(.*)$/);
    if (t || c || l || /^\s*(-{3,}|\*{3,})\s*$/.test(linha)) paragrafo = null;
    if (t) {
      blocos.push({ tipo: 'titulo', nivel: t[1].length as 1 | 2 | 3, texto: t[2] });
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(linha)) {
      blocos.push({ tipo: 'regua' });
    } else if (c) {
      const u = ultimo();
      if (u?.tipo === 'citacao') u.linhas.push(c[1]);
      else blocos.push({ tipo: 'citacao', linhas: [c[1]] });
    } else if (l) {
      const u = ultimo();
      if (u?.tipo === 'lista') u.itens.push(l[1]);
      else blocos.push({ tipo: 'lista', itens: [l[1]] });
    } else if (paragrafo) {
      paragrafo.linhas.push(linha.trim());
    } else {
      paragrafo = { tipo: 'paragrafo', linhas: [linha.trim()] };
      blocos.push(paragrafo);
    }
  }
  return blocos;
}

/** `grande` é o modo de gravação: fonte que se lê de longe, num segundo monitor. */
export function RoteiroMarkdown({ texto, grande = false }: { texto: string; grande?: boolean }) {
  const blocos = blocosDoMarkdown(texto);
  const tamTitulo = { 1: grande ? 'text-[1.6em]' : 'text-lg', 2: grande ? 'text-[1.3em]' : 'text-base', 3: grande ? 'text-[1.1em]' : 'text-sm' };
  return (
    <div className={grande ? 'space-y-[0.8em] leading-relaxed' : 'space-y-2 text-sm leading-relaxed'}>
      {blocos.map((b, i) => {
        const k = `b${i}`;
        if (b.tipo === 'titulo') {
          const cls = `${tamTitulo[b.nivel]} font-semibold ${b.nivel === 2 ? 'pt-[0.6em]' : ''} break-words`;
          if (b.nivel === 1) return <h1 key={k} className={cls}>{inline(b.texto, k)}</h1>;
          if (b.nivel === 2) return <h2 key={k} className={cls}>{inline(b.texto, k)}</h2>;
          return <h3 key={k} className={cls}>{inline(b.texto, k)}</h3>;
        }
        if (b.tipo === 'citacao') {
          return (
            <blockquote key={k} className="rounded-lg border-l-4 border-warn bg-warn/10 px-[0.8em] py-[0.5em] break-words">
              {b.linhas.map((l, j) => (
                <p key={j}>{inline(l, `${k}-${j}`)}</p>
              ))}
            </blockquote>
          );
        }
        if (b.tipo === 'lista') {
          return (
            <ul key={k} className="list-disc space-y-[0.3em] pl-[1.2em] break-words">
              {b.itens.map((l, j) => (
                <li key={j}>{inline(l, `${k}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        if (b.tipo === 'regua') return <hr key={k} className="border-border" />;
        return (
          <p key={k} className="break-words">
            {b.linhas.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l, `${k}-${j}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
