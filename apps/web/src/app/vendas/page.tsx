'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Activity, Code2 } from 'lucide-react';

export default function VendasPage() {
  const [origin, setOrigin] = useState('https://SEU-HOST');
  useEffect(() => setOrigin(window.location.origin), []);
  const snippet = `<script async src="${origin}/pixel.js"></script>`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Páginas de vendas</h1>
        <p className="text-sm text-muted">
          Cada página de vendas carrega o <code className="text-text">pixel.js</code> do Marketing OS.
          Todo tráfego e conversão vira evento no painel{' '}
          <Link href="/pixels" className="text-brand hover:underline">Pixels e eventos</Link>.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Página demo (self-hosted) */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity size={16} className="text-brand" /> Página de vendas demo
          </div>
          <p className="mt-2 text-sm text-muted">
            Página fictícia servida pelo próprio Marketing OS para provar o loop: carrega o pixel,
            dispara <code>page_view</code> e tem botões que emitem <code>purchase</code>, <code>lead</code>{' '}
            e <code>cta_click</code>.
          </p>
          <div className="mt-4 flex gap-2">
            <Link
              href="/demo-vendas.html"
              target="_blank"
              className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Abrir demo <ExternalLink size={14} />
            </Link>
            <Link
              href="/pixels"
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text"
            >
              Ver eventos
            </Link>
          </div>
        </div>

        {/* Instalar em páginas reais */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Code2 size={16} className="text-brand" /> Instalar numa página real
          </div>
          <p className="mt-2 text-sm text-muted">
            Cole o snippet antes do <code>{'</head>'}</code> de qualquer landing (Hotmart, Webflow,
            WordPress, Next…). O endpoint é público e idempotente.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-surface-2 p-3 text-[12px] text-text">
            {snippet}
          </pre>
          <p className="mt-2 text-[11px] text-muted">
            Conversão: <code>mktos.track(&apos;purchase&apos;, {'{ value: 497 }'})</code>. UTMs na URL
            são capturadas automaticamente.
          </p>
        </div>
      </div>

      <p className="text-[11px] text-muted">
        Fase 2 — MVP. Próximo: múltiplas páginas com chave de pixel por página/domínio e resolução de org
        (hoje resolve a org <code>root</code>).
      </p>
    </div>
  );
}
