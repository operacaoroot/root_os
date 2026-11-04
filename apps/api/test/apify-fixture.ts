import { comContextoDaEmpresaResolvida } from '../src/prisma/contexto-de-plataforma';
import type { PrismaService } from '../src/prisma/prisma.service';

export const ORG_APIFY_TESTE = 'org-a6-padrao';

export const bancoApifyDaCasa = {
  org: {
    findFirst: async ({ where }: { where: { id: string; slug: string } }) =>
      where.id === ORG_APIFY_TESTE && where.slug === 'root' ? { id: ORG_APIFY_TESTE } : null,
  },
} as unknown as PrismaService;

export function naCasaApify<T>(fn: () => Promise<T>): Promise<T> {
  return comContextoDaEmpresaResolvida(ORG_APIFY_TESTE, fn);
}
