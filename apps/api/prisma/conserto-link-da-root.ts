import { PrismaClient } from '@prisma/client';

import { cifrarLinkDaRoot, decifrarLinkDaRoot, linkDaRootCifrado } from '../src/comercial/link-da-root';
import { segredoDoAmbiente } from '../src/comercial/sala-token';

/*
 * CONSERTO D-1 DA REVISÃO (13/10/2026) · o link de assinar pela Root gravado em claro.
 *
 * `ComercialDocumento.linkRoot` guardava o link da ZapSign que assina o contrato
 * PELA ROOT. O código novo guarda só a cifra (`src/comercial/link-da-root.ts`).
 * Este script cifra, no lugar, o que já estava em claro. Nenhuma linha é
 * apagada; idempotente (o que já é cifra fica como está).
 *
 * A chave é a `ENCRYPTION_KEY` do ambiente, e TEM de ser a mesma da API que vai
 * decifrar (no Docker da homologação, a do `homolog/.env.homolog`). Sem ela o
 * script recusa: cifrar com outra chave tornaria o link ilegível.
 *
 *   DATABASE_URL=... ENCRYPTION_KEY=... pnpm --filter @mktos/api db:conserto:link-da-root
 */

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const segredo = segredoDoAmbiente();
  if (!segredo) throw new Error('ENCRYPTION_KEY ausente: nada foi cifrado (a chave tem de ser a mesma da API)');
  const banco = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? '')?.[1] ?? '(desconhecido)';
  const docs = await prisma.comercialDocumento.findMany({ where: { linkRoot: { not: null } }, select: { id: true, linkRoot: true } });
  let cifrados = 0;
  let jaCifrados = 0;
  for (const d of docs) {
    if (linkDaRootCifrado(d.linkRoot)) {
      jaCifrados++;
      continue;
    }
    const cifra = cifrarLinkDaRoot(d.linkRoot!, segredo, d.id);
    if (decifrarLinkDaRoot(cifra, segredo, d.id) !== d.linkRoot) throw new Error(`a cifra de ${d.id} não volta ao link: parei`);
    const r = await prisma.comercialDocumento.updateMany({ where: { id: d.id, linkRoot: d.linkRoot }, data: { linkRoot: cifra } });
    cifrados += r.count;
  }
  const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "ComercialDocumento" WHERE "linkRoot" ~ '^https?://'`);
  console.log(`banco: ${banco} · documentos com link da Root: ${docs.length} · cifrados agora: ${cifrados} · já cifrados: ${jaCifrados} · em claro depois: ${Number(n)}`);
  if (Number(n) > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
