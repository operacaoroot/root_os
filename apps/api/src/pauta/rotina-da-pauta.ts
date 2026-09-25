import type { PautaRotinaDaPauta } from '@mktos/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { estadoDispara, silencioDoTiqueDaPauta } from '../routines/rotina.tipos';

/**
 * A rotina da pauta de um tipo como a tela precisa dela, na mesma leitura do
 * encadeamento (MD1): a mais antiga do tipo, ativa, num estado que dispara e
 * com o tique ligado neste servidor. Falhar aqui não derruba a tela: sem
 * resposta, nada é dito.
 */
export async function rotinaDaPauta(prisma: PrismaService, orgId: string, tipo: string): Promise<PautaRotinaDaPauta | undefined> {
  try {
    const rotina = await prisma.rotina.findFirst({
      where: { orgId, tipo },
      orderBy: { criadaEm: 'asc' },
      select: { nome: true, ativo: true, estado: true },
    });
    const calada = rotina ? silencioDoTiqueDaPauta() : null;
    return {
      existe: !!rotina,
      dispara: !!rotina && rotina.ativo && estadoDispara(rotina.estado) && !calada,
      nome: rotina?.nome ?? null,
      calada,
    };
  } catch {
    return undefined;
  }
}
