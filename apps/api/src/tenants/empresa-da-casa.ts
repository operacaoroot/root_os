import type { PrismaService } from '../prisma/prisma.service';
import { SLUG_DA_PLATAFORMA } from './provisionar';

/**
 * A EMPRESA É A DA CASA? — uma consulta, um lugar (revisão adversarial de 21/10/2026).
 *
 * Era o `ehDaCasa` privado do `ObsidianService` (a vault é da casa, e só ela a
 * reindexa); o vigia da agenda passou a precisar da MESMA pergunta (a agenda
 * que ele lê é a da conta Google da casa), e duas cópias de uma trava é uma
 * trava que um dia diverge.
 *
 * A pergunta é a do `SessaoDaPlataformaGuard`: o id da PRÓPRIA empresa e o slug
 * fixo na mesma consulta, que devolve a própria linha ou nada e não enxerga
 * outra empresa, com ou sem policy de linha.
 */
export async function ehEmpresaDaCasa(prisma: Pick<PrismaService, 'org'>, orgId: string): Promise<boolean> {
  if (!orgId) return false;
  const daCasa = await prisma.org.findFirst({
    where: { id: orgId, slug: SLUG_DA_PLATAFORMA },
    select: { id: true },
  });
  return Boolean(daCasa);
}
