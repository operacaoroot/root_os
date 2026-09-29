import Link from 'next/link';
import { ArrowLeft, Terminal } from 'lucide-react';
import { NAV, SECOES } from '@mktos/shared';

/*
 * Onde caem os módulos que estão no menu mas ainda não têm tela: /documentos,
 * /ia, /automacoes, /whatsapp e /mcp. Não é erro nem 404 — a rota, a permissão
 * e o lugar na navegação já existem; falta o conector. Diz isso na voz do
 * protótipo: sem ícone de obra, sem "em breve", com a fase e o caminho.
 */
export default async function ModulePlaceholder({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const href = '/' + (slug?.[0] ?? '');
  const item = NAV.find((n) => n.href === href);
  const secao = SECOES.find((s) => s.key === item?.secao);

  return (
    <div className="mx-auto max-w-xl pt-6">
      <div className="rounded-root border border-border bg-surface p-6 font-os-mono">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted">
          <Terminal size={13} className="text-brand" />
          {secao?.label ?? 'módulo'} · {item?.estado === 'parcial' ? 'parcial' : 'sem tela'}
        </div>

        <p className="mt-4 text-[13px] leading-[1.7] text-text">
          {item?.key === 'fluxos' ? (
            <>Processos estão em preparação. Esta rota ainda não oferece um editor nem executa processos.</>
          ) : (
            <><span className="text-brand">{item?.label ?? href}</span> já existe como rota,
            permissão e lugar no menu. A tela ainda não entrega todas as funções.</>
          )}
        </p>

        <p className="mt-3 text-[11px] leading-[1.7] text-muted">
          {item?.parcial ?? 'A tela ainda não foi construída.'} Até lá esta rota responde,
          respeita a permissão e não inventa número.
        </p>

        <div className="mt-5 border-t border-border pt-4 text-[10px] uppercase tracking-[0.16em] text-muted">
          rota <span className="text-text">{href}</span>
          {item && (
            <>
              {' · '}exige <span className="text-text">{item.permission}</span>
            </>
          )}
        </div>
      </div>

      <Link
        href="/painel"
        className="mt-4 inline-flex items-center gap-1 rounded-root border border-border px-4 py-2 font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text"
      >
        <ArrowLeft size={13} /> voltar à visão geral
      </Link>
    </div>
  );
}
