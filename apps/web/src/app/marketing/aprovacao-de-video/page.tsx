'use client';

import { useEffect, useRef } from 'react';

/*
 * Marketing › PRODUÇÃO › Aprovação de vídeo (28/10/2026, pedido do Lucas: a ferramenta da
 * produtora, "Aprovação de vídeo.html", dentro do OS). Depois de gravar e editar, ele abre o
 * vídeo aqui, pausa, marca células da grade e escreve o pedido; "Copiar apontamentos" gera o
 * Markdown (tempo + células + % do quadro) que ele cola no Claude para editar.
 * O vídeo abre pelo seletor de arquivo (URL de objeto local): nada sobe para o servidor.
 * Os apontamentos ficam no localStorage do navegador, por nome de arquivo. Mesmo código da
 * página original; só o visual usa os tokens do OS.
 */

const CSS = `
.aprov{--ac:rgb(var(--os-ac));--mu:rgb(var(--os-tx2));--ln:rgb(var(--os-line-strong));color:rgb(var(--os-tx));font-size:14px}
.aprov *{box-sizing:border-box}
.aprov .topo{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.aprov button,.aprov select,.aprov input[type=file]{font:inherit;color:rgb(var(--os-tx));background:rgb(var(--os-s2));border:1px solid var(--ln);border-radius:6px;padding:6px 10px;cursor:pointer}
.aprov button.pri{background:var(--ac);border-color:var(--ac);color:rgb(var(--os-ac-ink))}
.aprov main{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px}
@media(max-width:900px){.aprov main{grid-template-columns:1fr}}
.aprov #stage{position:relative;background:#000;border-radius:8px;overflow:hidden;align-self:start}
.aprov video{display:block;width:100%;max-height:72vh;object-fit:contain}
.aprov #grid{position:absolute;display:none;grid-gap:0;touch-action:none}
.aprov #grid.on{display:grid}
.aprov #grid div{border:1px solid rgba(255,255,255,.18);user-select:none}
.aprov #grid div.sel{background:rgb(var(--os-ac) / .45);border-color:var(--ac)}
.aprov #grid div.old{background:rgb(var(--os-mag) / .3)}
.aprov .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
.aprov #tc{font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;color:var(--mu);margin-left:auto}
.aprov aside{background:rgb(var(--os-s1));border:1px solid rgb(var(--os-line));border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px}
.aprov textarea{width:100%;min-height:70px;font:inherit;color:rgb(var(--os-tx));background:rgb(var(--os-bg));border:1px solid var(--ln);border-radius:6px;padding:8px}
.aprov .hint{color:var(--mu);font-size:12px}
.aprov hr{border:0;border-top:1px solid rgb(var(--os-line));width:100%;margin:0}
.aprov #notes{display:flex;flex-direction:column;gap:8px;max-height:45vh;overflow:auto}
.aprov .n{background:rgb(var(--os-bg));border:1px solid rgb(var(--os-line));border-radius:6px;padding:8px;cursor:pointer}
.aprov .n b{color:var(--ac);font-family:var(--font-mono,monospace)}.aprov .n .t{color:var(--mu);font-size:12px}.aprov .n button{float:right;padding:2px 6px;font-size:12px}
`;

export default function AprovacaoDeVideoPage() {
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => (raiz.current ? montar(raiz.current) : undefined), []);
  return (
    <div className="aprov" ref={raiz}>
      <style>{CSS}</style>
      <div className="topo">
        <input type="file" id="file" accept="video/*" />
        <label className="hint">
          Grade{' '}
          <select id="gs" defaultValue="6x4">
            <option value="3x2">3×2</option>
            <option value="4x3">4×3</option>
            <option value="6x4">6×4</option>
            <option value="8x6">8×6</option>
            <option value="12x8">12×8</option>
            <option value="16x9">16×9</option>
          </select>
        </label>
        <span className="hint">O vídeo abre só no seu navegador; nada sobe para o servidor.</span>
      </div>
      <main>
        <section>
          <div id="stage">
            <video id="v" playsInline />
            <div id="grid" />
          </div>
          <div className="bar">
            <button id="pp">▶ Play</button>
            <button id="fb">◀ quadro</button>
            <button id="ff">quadro ▶</button>
            <span className="hint">Pause para marcar. Arraste na grade para selecionar várias células.</span>
            <span id="tc">00:00.00</span>
          </div>
        </section>
        <aside>
          <select id="kind">
            <option>Alterar</option>
            <option>Adicionar</option>
            <option>Remover</option>
            <option>Cortar</option>
          </select>
          <textarea id="txt" placeholder="O que fazer neste ponto? Ex.: colocar a palavra-chave aqui, ao lado da cabeça" />
          <button className="pri" id="add">Salvar apontamento</button>
          <div className="hint" id="selinfo">Nenhuma célula selecionada (vale para o quadro inteiro).</div>
          <hr />
          <div id="notes" />
          <button id="copy">Copiar apontamentos para o Claude</button>
          <button id="save">Baixar .md</button>
          <hr />
          <div className="hint" id="loteinfo">Lote: nenhum vídeo aberto.</div>
          <button id="copylote">Copiar o lote para o Claude</button>
          <button id="limparlote">Limpar o lote</button>
        </aside>
      </main>
    </div>
  );
}

interface Nota { t: number; kind: string; txt: string; cells: string[]; grid: string; area: string }

/** O script da página original, preso à raiz da tela; devolve a limpeza dos ouvintes globais. */
function montar(root: HTMLElement): () => void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const v = $<HTMLVideoElement>('v'), grid = $('grid');
  let C = 6, R = 4, notes: Nota[] = [], name = 'video', drag: { on: boolean } | null = null, url = '';
  const sel = new Set<string>(), fps = 29.97;
  const COLS = 'ABCDEFGHIJKLMNOP';
  const fmt = (t: number) => { const m = Math.floor(t / 60), s = (t % 60).toFixed(2).padStart(5, '0'); return `${String(m).padStart(2, '0')}:${s}`; };
  /*
   * ID do vídeo (28/10/2026, pedido do Lucas: ligar o apontamento ao arquivo certo do Drive, em lote):
   * nome + tamanho em bytes + duração. Os apontamentos ficam por nome + tamanho; o lote guarda,
   * nesta aba, cada vídeo aberto, para copiar os apontamentos de todos de uma vez.
   */
  let size = 0, dur = 0;
  interface Video { name: string; size: number; dur: number }
  const LOTE = 'aprov_lote';
  const lerLote = (): Video[] => { try { return JSON.parse(sessionStorage.getItem(LOTE) || '[]'); } catch { return []; } };
  const gravarLote = (l: Video[]) => { try { sessionStorage.setItem(LOTE, JSON.stringify(l)); } catch { /* sem armazenamento */ } mostrarLote(); };
  const chave = (n: string, s: number) => 'aprov_' + n + '_' + s;
  const key = () => chave(name, size);
  const mb = (s: number) => (s / 1048576).toFixed(1).replace('.', ',') + ' MB';
  const idDe = (x: Video) => `${x.name} · ${mb(x.size)} (${x.size} bytes)${x.dur ? ' · ' + fmt(x.dur) : ''}`;
  const notasDe = (x: Video): Nota[] => {
    try { return JSON.parse(localStorage.getItem(chave(x.name, x.size)) || localStorage.getItem('aprov_' + x.name) || '[]'); } catch { return []; }
  };
  const load = () => { notes = notasDe({ name, size, dur }); draw(); };
  function mostrarLote() {
    const l = lerLote();
    $('loteinfo').textContent = l.length ? `Lote: ${l.length} vídeo(s) · ${l.map((x) => `${x.name} (${notasDe(x).length})`).join(', ')}` : 'Lote: nenhum vídeo aberto.';
  }
  const noLote = () => { const l = lerLote().filter((x) => !(x.name === name && x.size === size)); l.push({ name, size, dur }); gravarLote(l); };
  const store = () => { try { localStorage.setItem(key(), JSON.stringify(notes)); } catch { /* sem armazenamento */ } };
  $<HTMLInputElement>('file').onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    name = f.name; size = f.size; dur = 0; if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(f); v.src = url; load(); noLote();
  };
  v.addEventListener('loadedmetadata', () => { if (Number.isFinite(v.duration)) { dur = v.duration; noLote(); } });
  $<HTMLSelectElement>('gs').onchange = (e) => { [C, R] = (e.target as HTMLSelectElement).value.split('x').map(Number); sel.clear(); build(); };
  function place() { // grade só sobre a área real da imagem (sem as faixas pretas)
    const W = v.clientWidth, H = v.clientHeight, ar = (v.videoWidth || 16) / (v.videoHeight || 9);
    let w = W, h = W / ar; if (h > H) { h = H; w = H * ar; }
    Object.assign(grid.style, { left: (W - w) / 2 + 'px', top: (H - h) / 2 + 'px', width: w + 'px', height: h + 'px',
      gridTemplateColumns: `repeat(${C},1fr)`, gridTemplateRows: `repeat(${R},1fr)` });
  }
  function build() { grid.innerHTML = ''; for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const d = document.createElement('div'); d.dataset.k = COLS[c] + (r + 1); grid.appendChild(d); } place(); paint(); }
  function paint() {
    const old = new Set(notes.filter((n) => Math.abs(n.t - v.currentTime) < 0.05 && n.grid === C + 'x' + R).flatMap((n) => n.cells));
    for (const d of Array.from(grid.children) as HTMLElement[]) { d.classList.toggle('sel', sel.has(d.dataset.k!)); d.classList.toggle('old', old.has(d.dataset.k!)); }
    $('selinfo').textContent = sel.size ? `Selecionado: ${area()}` : 'Nenhuma célula selecionada (vale para o quadro inteiro).';
  }
  function area() {
    if (!sel.size) return 'quadro inteiro';
    const cs = [...sel].map((k) => [COLS.indexOf(k[0]), +k.slice(1) - 1]);
    const x0 = Math.min(...cs.map((c) => c[0])), x1 = Math.max(...cs.map((c) => c[0])), y0 = Math.min(...cs.map((c) => c[1])), y1 = Math.max(...cs.map((c) => c[1]));
    const p = (a: number, n: number) => Math.round((a / n) * 100);
    return `${COLS[x0]}${y0 + 1}–${COLS[x1]}${y1 + 1} (x ${p(x0, C)}–${p(x1 + 1, C)}%, y ${p(y0, R)}–${p(y1 + 1, R)}% do quadro)`;
  }
  const tog = (d: HTMLElement) => { if (drag!.on) sel.add(d.dataset.k!); else sel.delete(d.dataset.k!); paint(); };
  grid.addEventListener('pointerdown', (e) => {
    const d = (e.target as HTMLElement).closest<HTMLElement>('[data-k]'); if (!d) return;
    grid.setPointerCapture(e.pointerId); drag = { on: !sel.has(d.dataset.k!) }; tog(d);
  });
  grid.addEventListener('pointermove', (e) => { if (!drag) return; const d = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null; if (d?.dataset?.k) tog(d); });
  const soltar = () => { drag = null; };
  const sync = () => { grid.classList.toggle('on', v.paused && !!v.src); $('pp').textContent = v.paused ? '▶ Play' : '❚❚ Pause'; place(); paint(); };
  v.onpause = v.onplay = v.onloadedmetadata = v.onseeked = sync;
  v.ontimeupdate = () => { $('tc').textContent = fmt(v.currentTime); };
  $('pp').onclick = () => { if (v.paused) void v.play(); else v.pause(); };
  $('fb').onclick = () => { v.pause(); v.currentTime = Math.max(0, v.currentTime - 1 / fps); };
  $('ff').onclick = () => { v.pause(); v.currentTime += 1 / fps; };
  const tecla = (e: KeyboardEvent) => {
    const alvo = (e.target as HTMLElement).tagName;
    if (alvo === 'TEXTAREA' || alvo === 'INPUT' || alvo === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); $('pp').click(); }
    if (e.key === 'ArrowLeft') $('fb').click();
    if (e.key === 'ArrowRight') $('ff').click();
  };
  const txt = $<HTMLTextAreaElement>('txt');
  $('add').onclick = () => {
    const t = txt.value.trim(); if (!t || !v.src) return;
    notes.push({ t: +v.currentTime.toFixed(3), kind: $<HTMLSelectElement>('kind').value, txt: t, cells: [...sel], grid: C + 'x' + R, area: area() });
    notes.sort((a, b) => a.t - b.t); sel.clear(); txt.value = ''; store(); draw(); paint(); mostrarLote();
  };
  function draw() {
    const lista = $('notes'); lista.innerHTML = '';
    notes.forEach((n, i) => {
      const d = document.createElement('div'); d.className = 'n';
      d.innerHTML = `<button>✕</button><b>${fmt(n.t)}</b> · ${n.kind}<div></div><div class="t"></div>`;
      d.children[2].textContent = n.txt; d.children[3].textContent = n.area;
      d.onclick = (e) => { if ((e.target as HTMLElement).tagName === 'BUTTON') { notes.splice(i, 1); store(); draw(); mostrarLote(); return; } v.pause(); v.currentTime = n.t; };
      lista.appendChild(d);
    });
  }
  const LEGENDA = 'Grade: colunas A… (esquerda→direita), linhas 1… (cima→baixo); a grade de cada apontamento vem entre colchetes.';
  const blocoDe = (x: Video, ns: Nota[], nivel: string) => `${nivel} Apontamentos — ${x.name}\nID do vídeo: ${idDe(x)}\n\n` +
    (ns.length ? ns.map((n, i) => `${i + 1}. **${fmt(n.t)}** — ${n.kind}: ${n.txt}\n   Local: ${n.area} [grade ${n.grid}]`).join('\n') : '(sem apontamentos: aprovado)');
  const md = () => blocoDe({ name, size, dur }, notes, '#') + '\n\n' + LEGENDA;
  const mdLote = () => {
    const l = lerLote();
    return `# Lote de aprovação — ${l.length} vídeo(s)\nAche cada arquivo no Drive pelo nome e confira tamanho em bytes e duração do ID.\n${LEGENDA}\n\n` +
      l.map((x) => blocoDe(x, notasDe(x), '##')).join('\n\n');
  };
  const copiar = (b: HTMLElement, texto: () => string, rotulo: string) => async () => {
    try { await navigator.clipboard.writeText(texto()); b.textContent = 'Copiado ✓'; } catch { prompt('Copie:', texto()); }
    setTimeout(() => { b.textContent = rotulo; }, 1500);
  };
  $('copy').onclick = copiar($('copy'), md, 'Copiar apontamentos para o Claude');
  $('copylote').onclick = copiar($('copylote'), mdLote, 'Copiar o lote para o Claude');
  $('limparlote').onclick = () => gravarLote([]);
  mostrarLote();
  $('save').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md()], { type: 'text/markdown' }));
    a.download = name.replace(/\.[^.]+$/, '') + ' - apontamentos.md'; a.click();
  };
  addEventListener('pointerup', soltar); addEventListener('resize', place); addEventListener('keydown', tecla);
  build();
  return () => { removeEventListener('pointerup', soltar); removeEventListener('resize', place); removeEventListener('keydown', tecla); if (url) URL.revokeObjectURL(url); };
}
