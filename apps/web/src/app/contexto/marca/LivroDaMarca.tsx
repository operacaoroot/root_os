'use client';

import { useState, type ReactNode } from 'react';
import { BookOpen, Download, Palette, Type, Quote, FileText } from 'lucide-react';
import { BrandbookDocumentoSchema, type BrandbookDocumento } from '@mktos/shared';
import { baixarArquivo } from '@/lib/baixar';
import { contraste, coresDaAmostra, htmlDoBrandbook, nomeDoArquivo } from './brandbook-formulario';

export interface PropsDoLivro {
  documento: BrandbookDocumento;
  origem: string;
  versao?: string | number | null;
  hash?: string | null;
  onUsarBase?: () => void;
  fonteCompleta?: string;
}

export function LivroDaMarca({ documento: d, origem, versao, hash, onUsarBase, fonteCompleta }: PropsDoLivro) {
  const [erro, setErro] = useState<string | null>(null);
  const cores = coresDaAmostra(d);
  const legivel = cores && contraste(cores.fundo, cores.texto) >= 4.5;
  const logo = d.visual.logoDataUrl && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(d.visual.logoDataUrl) ? d.visual.logoDataUrl : null;
  function exportar(tipo: 'json' | 'html') {
    setErro(null);
    try {
      const documento = BrandbookDocumentoSchema.parse(d);
      const conteudo = tipo === 'json' ? JSON.stringify(documento, null, 2) : htmlDoBrandbook(documento, origem);
      baixarArquivo(`${nomeDoArquivo(documento)}.${tipo}`, new Blob([conteudo], { type: tipo === 'json' ? 'application/json;charset=utf-8' : 'text/html;charset=utf-8' }));
    } catch (e) {
      setErro((e as Error).message);
    }
  }
  return <article className="overflow-hidden border border-border bg-surface" aria-label="Livro da marca">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5 sm:p-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-os-mono text-[10px] uppercase tracking-[0.15em] text-muted"><BookOpen size={14} /> Livro da marca</div>
        <p className="mt-2 text-xs text-muted">{origem}{versao ? ` · versão ${versao}` : ''}</p>
        <h2 className="mt-3 break-words text-2xl font-semibold tracking-tight">{d.identidade.nome || 'Nome não preenchido'}</h2>
        <p className="mt-1 text-sm text-muted">{[d.identidade.handle, d.identidade.nicho].filter(Boolean).join(' · ') || 'Identificação não preenchida'}</p>
        {hash && <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Conferir origem</summary><p className="mt-1 break-all font-os-mono">sha256: {hash}</p></details>}
      </div>
      <div className="flex flex-wrap gap-2">
        {onUsarBase && <button type="button" onClick={onUsarBase} className="min-h-11 border border-brand-dim px-3 text-sm text-brand hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-brand">Usar como base</button>}
        <button type="button" onClick={() => exportar('json')} className="inline-flex min-h-11 items-center gap-2 border border-border px-3 text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"><Download size={14} /> JSON</button>
        <button type="button" onClick={() => exportar('html')} className="inline-flex min-h-11 items-center gap-2 border border-border px-3 text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"><Download size={14} /> HTML</button>
        {fonteCompleta && <button type="button" onClick={() => {
          try { baixarArquivo(`${nomeDoArquivo(d)}-fonte.md`, new Blob([fonteCompleta], { type: 'text/markdown;charset=utf-8' })); }
          catch (e) { setErro((e as Error).message); }
        }} className="inline-flex min-h-11 items-center gap-2 border border-border px-3 text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"><Download size={14} /> Fonte MD</button>}
      </div>
    </header>
    {erro && <p role="alert" className="border-b border-bad/40 p-4 text-sm text-bad">{erro}</p>}
    <div className="grid lg:grid-cols-2">
      <div className="min-w-0 space-y-6 p-5 sm:p-6 lg:border-r lg:border-border">
        <Secao titulo="Identidade" icone={<BookOpen size={15} />}>
          {logo ? <div className="mb-4 inline-flex min-h-20 items-center border border-border bg-surface-2 p-4"><img src={logo} alt={`Logo de ${d.identidade.nome || 'marca'}`} className="max-h-28 max-w-full object-contain" /></div> : <Vazio>Logo não definido</Vazio>}
          <Texto titulo="Descrição" texto={d.identidade.descricao} />
          <Texto titulo="Assinatura" texto={d.identidade.assinatura} />
          <Texto titulo="Posicionamento" texto={d.respostas.posicionamento} />
          <Texto titulo="Diferencial e promessa" texto={d.respostas.diferencialPromessa} />
        </Secao>
        <Secao titulo="Público" icone={<Quote size={15} />}>
          <Texto titulo="Cliente ideal" texto={d.respostas.clienteIdeal} />
          <Texto titulo="Dor" texto={d.respostas.dor} />
          <Texto titulo="Desejo" texto={d.respostas.desejo} />
          {d.personas.length ? d.personas.map((p, i) => <Texto key={i} titulo={p.nome || `Persona ${i + 1}`} texto={p.descricao} />) : <Vazio>Personas não preenchidas</Vazio>}
        </Secao>
        <Secao titulo="Voz" icone={<Quote size={15} />}>
          <Texto titulo="Tom de voz" texto={d.respostas.tomDeVoz} />
          <Texto titulo="Descrição da voz" texto={d.voz.descricao} />
          <div className="space-y-3">
            {d.voz.eixos.length ? d.voz.eixos.map((e, i) => <div key={i}>
              <div className="flex items-center justify-between gap-2 text-xs text-muted"><span>{e.de || 'Polo inicial'}</span><span>{e.valor === null ? 'Não definido' : `${e.valor}/100`}</span><span>{e.para || 'Polo final'}</span></div>
              <div className="relative mt-2 h-1 border border-border bg-surface-2">{e.valor !== null && <span className="absolute -top-1 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-brand" style={{ left: `${Math.max(0, Math.min(100, e.valor))}%` }} />}</div>
            </div>) : <Vazio>Eixos não definidos</Vazio>}
          </div>
          <Palavras titulo="Palavras que entram" palavras={d.voz.permitidas} />
          <Palavras titulo="Palavras a evitar" palavras={d.voz.evitar} />
        </Secao>
      </div>
      <div className="min-w-0 space-y-6 border-t border-border p-5 sm:p-6 lg:border-t-0">
        <Secao titulo="Cor e tipografia" icone={<Palette size={15} />}>
          <div className="grid gap-3 sm:grid-cols-2">
            {d.visual.cores.length ? d.visual.cores.map((c, i) => <div key={i} className="overflow-hidden border border-border">
              <div className="h-16 border-b border-border" style={{ backgroundColor: /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(c.hex) ? c.hex : undefined }} />
              <div className="p-3"><p className="text-sm">{c.papel || 'Papel não definido'}</p><p className="mt-1 font-os-mono text-xs text-muted">{c.hex || 'Cor não definida'}</p></div>
            </div>) : <Vazio>Paleta não definida</Vazio>}
          </div>
          <div className="space-y-2">
            {d.visual.fontes.length ? d.visual.fontes.map((f, i) => <div key={i} className="flex items-start gap-3 border-b border-border pb-2"><Type size={16} className="mt-1 shrink-0 text-muted" /><div><p className="text-xs text-muted">{f.papel || 'Uso não definido'}</p><p className="text-base">{f.familia || 'Fonte não definida'}</p></div></div>) : <Vazio>Tipografia não definida</Vazio>}
          </div>
          <p className="text-xs text-muted">Os nomes das fontes são registrados no livro. Esta tela não baixa fontes externas.</p>
        </Secao>
        <Secao titulo="Assinatura visual" icone={<Palette size={15} />}>
          <Texto titulo="Regras de uso" texto={d.visual.regras} />
          <Texto titulo="Texturas e fundos" texto={d.visual.texturas} />
          <Texto titulo="Tratamento de capa" texto={d.visual.capas} />
        </Secao>
        <Secao titulo="Pilares e modelos de peça" icone={<FileText size={15} />}>
          {d.pilares.length ? d.pilares.map((p, i) => <Texto key={i} titulo={p.nome || `Pilar ${i + 1}`} texto={[p.cor, p.descricao].filter(Boolean).join(' · ')} />) : <Vazio>Pilares não preenchidos</Vazio>}
          {d.modelos.length ? d.modelos.map((m, i) => <Texto key={i} titulo={m.nome || `Modelo ${i + 1}`} texto={m.estrutura} />) : <Vazio>Modelos não preenchidos</Vazio>}
        </Secao>
        <Secao titulo="Amostra de aplicação" icone={<FileText size={15} />}>
          {cores && legivel ? <div className="border p-5" style={{ backgroundColor: cores.fundo, color: cores.texto, borderColor: cores.acento }}>
            <p className="text-xs uppercase tracking-wider">{d.identidade.nome || 'Marca'}</p>
            <p className="mt-3 text-xl font-semibold">{d.identidade.assinatura || d.respostas.posicionamento || 'Assinatura não preenchida'}</p>
            <p className="mt-2 text-sm">{d.identidade.descricao || 'Descrição não preenchida'}</p>
            <div className="mt-4 h-1 w-12" style={{ backgroundColor: cores.acento }} />
          </div> : <Vazio>{cores ? 'A combinação de fundo e texto ainda não tem contraste de 4,5:1.' : 'Defina cores de fundo, texto e primária para mostrar a amostra.'}</Vazio>}
          <p className="text-xs text-muted">Amostra local com as cores e o texto registrados. Regras de textura e capa ficam descritas acima.</p>
        </Secao>
      </div>
    </div>
    <div className="space-y-4 border-t border-border p-5 sm:p-6">
      {fonteCompleta && <details><summary className="cursor-pointer text-sm font-medium">Documento fonte completo</summary><p className="mt-3 max-h-[36rem] overflow-auto whitespace-pre-wrap break-words text-sm text-muted">{fonteCompleta}</p></details>}
      <details><summary className="cursor-pointer text-sm font-medium">Perfil para a Pauta</summary><p className="mt-3 whitespace-pre-wrap text-sm text-muted">{d.perfilParaPauta || 'Não preenchido'}</p></details>
      <details><summary className="cursor-pointer text-sm font-medium">Material de origem</summary><div className="mt-3 space-y-2 text-sm text-muted"><p>{d.origem.tipo}{d.origem.arquivoNome ? ` · ${d.origem.arquivoNome}` : ''}</p>{d.origem.url && <p className="break-all">{d.origem.url}</p>}<p className="max-h-64 overflow-auto whitespace-pre-wrap">{d.origem.texto || 'Texto de referência não preenchido'}</p></div></details>
    </div>
  </article>;
}

function Secao({ titulo, icone, children }: { titulo: string; icone: ReactNode; children: ReactNode }) {
  return <section className="space-y-4"><h3 className="flex items-center gap-2 font-os-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{icone}{titulo}</h3>{children}</section>;
}
function Texto({ titulo, texto }: { titulo: string; texto: string }) {
  return <div><h4 className="text-xs font-medium text-muted">{titulo}</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm">{texto || <span className="text-muted">Não preenchido</span>}</p></div>;
}
function Vazio({ children }: { children: ReactNode }) { return <p className="text-sm text-muted">{children}</p>; }
function Palavras({ titulo, palavras }: { titulo: string; palavras: string[] }) {
  return <div><h4 className="mb-2 text-xs font-medium text-muted">{titulo}</h4><div className="flex flex-wrap gap-2">{palavras.length ? palavras.map((p, i) => <span key={i} className="border border-border px-2 py-1 text-xs">{p}</span>) : <Vazio>Não preenchidas</Vazio>}</div></div>;
}
