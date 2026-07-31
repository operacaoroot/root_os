import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { BioPageView } from '@/components/BioPageView';
import { buscarPaginaPublica, registrarPageview } from '@/lib/bio-api';
import { COOKIE_VISITANTE } from '@/middleware';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const CAPTURAR = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'ttclid',
  'gclid',
];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const dados = await buscarPaginaPublica(handle);
  if (!dados) return { title: 'Não encontrado' };
  return {
    title: dados.titulo,
    description: dados.subtitulo ?? undefined,
    openGraph: {
      title: dados.titulo,
      description: dados.subtitulo ?? undefined,
      images: dados.avatarUrl ? [dados.avatarUrl] : undefined,
    },
  };
}

export default async function PaginaPublicaDaBio({ params, searchParams }: Props) {
  const { handle } = await params;
  const dados = await buscarPaginaPublica(handle);
  if (!dados) notFound();

  const [jar, cabecalhos, sp] = await Promise.all([cookies(), headers(), searchParams]);
  const rid = jar.get(COOKIE_VISITANTE)?.value;
  if (rid) {
    const capturados: Record<string, string> = {};
    for (const chave of CAPTURAR) {
      const v = sp[chave];
      if (typeof v === 'string') capturados[chave] = v.slice(0, 300);
    }
    registrarPageview({
      handle: dados.handle,
      rid,
      url: `/${dados.handle}`,
      referrer: cabecalhos.get('referer'),
      userAgent: cabecalhos.get('user-agent'),
      params: capturados,
    });
  }

  return <BioPageView dados={dados} />;
}
