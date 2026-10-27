/*
 * Markdown simples e seguro da Memória (portado do ROOT Estúdio): escapa TUDO
 * primeiro e só então aplica a marcação. [[Nota]] vira link interno (data-wiki),
 * #tag vira filtro (data-tag). Nenhum HTML de quem escreveu passa.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inline(raw: string): string {
  const codigos: string[] = [];
  let s = esc(raw).replace(/`([^`]+)`/g, (_, c: string) => {
    codigos.push(c);
    return `\u0000${codigos.length - 1}\u0000`;
  });
  s = s.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, alvo: string, apelido?: string) => `<a href="#" class="memoria-wiki" data-wiki="${alvo.trim()}">${(apelido || alvo).trim()}</a>`);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t: string, u: string) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, p: string, u: string) => `${p}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, (m, sp: string, t: string) => (/^\d+$/.test(t) ? m : `${sp}<a href="#" class="memoria-tag" data-tag="${t.toLowerCase()}">#${t}</a>`));
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codigos[Number(i)]}</code>`);
}

export function markdownDaMemoria(md: string): string {
  const linhas = String(md || '').replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split(/\r?\n/);
  const out: string[] = [];
  let para: string[] = [];
  let lista: { tag: 'ul' | 'ol'; itens: string[] } | null = null;
  let citacao: string[] = [];
  let cerca: string[] | null = null;
  const fecharPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const fecharLista = () => {
    if (lista) out.push(`<${lista.tag}>${lista.itens.map((i) => `<li>${inline(i)}</li>`).join('')}</${lista.tag}>`);
    lista = null;
  };
  const fecharCitacao = () => {
    if (citacao.length) out.push(`<blockquote>${citacao.map(inline).join('<br>')}</blockquote>`);
    citacao = [];
  };
  const fecharTudo = () => {
    fecharPara();
    fecharLista();
    fecharCitacao();
  };
  for (const linha of linhas) {
    if (cerca) {
      if (/^\s*```/.test(linha)) {
        out.push(`<pre><code>${esc(cerca.join('\n'))}</code></pre>`);
        cerca = null;
      } else cerca.push(linha);
      continue;
    }
    if (/^\s*```/.test(linha)) {
      fecharTudo();
      cerca = [];
      continue;
    }
    let m: RegExpExecArray | null;
    if (!linha.trim()) {
      fecharTudo();
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(linha))) {
      fecharTudo();
      const n = Math.min(6, m[1].length + 1);
      out.push(`<h${n}>${inline(m[2])}</h${n}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(linha)) {
      fecharTudo();
      out.push('<hr>');
      continue;
    }
    if ((m = /^\s*>\s?(.*)$/.exec(linha))) {
      fecharPara();
      fecharLista();
      citacao.push(m[1]);
      continue;
    }
    if ((m = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(linha))) {
      fecharPara();
      fecharCitacao();
      if (lista?.tag !== 'ul') {
        fecharLista();
        lista = { tag: 'ul', itens: [] };
      }
      lista.itens.push(m[1]);
      continue;
    }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(linha))) {
      fecharPara();
      fecharCitacao();
      if (lista?.tag !== 'ol') {
        fecharLista();
        lista = { tag: 'ol', itens: [] };
      }
      lista.itens.push(m[1]);
      continue;
    }
    if (lista && /^\s{2,}\S/.test(linha)) {
      const l = lista as { itens: string[] };
      l.itens[l.itens.length - 1] += ' ' + linha.trim();
      continue;
    }
    fecharLista();
    fecharCitacao();
    para.push(linha);
  }
  if (cerca) out.push(`<pre><code>${esc((cerca as string[]).join('\n'))}</code></pre>`);
  fecharTudo();
  return out.join('\n');
}
