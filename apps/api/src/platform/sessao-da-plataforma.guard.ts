import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
/*
 * A CONSTANTE VEM DE `tenants/provisionar.ts`, E É A QUE JÁ EXISTIA.
 *
 * `SLUG_DA_PLATAFORMA` vale `'root'` e é usada pelo provisionamento, pelo
 * comando de terminal e pela lista de identificadores reservados do cadastro.
 * A primeira versão desta fatia declarou uma homônima em `./plataforma` valendo
 * `'plataforma'` — e aí a empresa que provisiona não abria o console, a que
 * abriria o console não existia, e `plataforma` seguia livre para qualquer um
 * pegar no cadastro anônimo. Importar a que existe é o conserto; declarar outra
 * é reescrever o que já existe, que o 06-ESTADO-DA-BASE proíbe.
 */
import { SLUG_DA_PLATAFORMA } from '../tenants/provisionar';

/*
 * ============================================================================
 * ESTA SESSÃO É DA PLATAFORMA? — o guarda do console (RF-B-02)
 * ============================================================================
 *
 * A pergunta é uma só: a empresa DESTA sessão é a empresa da plataforma?
 *
 * E a consulta que responde é deliberadamente estreita:
 *
 *     findFirst({ where: { id: <a empresa da sessão>, slug: SLUG_DA_PLATAFORMA } })
 *
 * Repare que ela filtra pelo id DA PRÓPRIA SESSÃO. Não é detalhe de estilo: é o
 * que faz este guarda ser incapaz de enxergar outra empresa, com ou sem policy
 * de linha. Uma versão "mais simples" — procurar a Org pelo slug da
 * plataforma e comparar o id em memória — leria uma linha de OUTRA empresa e dependeria de o
 * `===` seguinte estar certo. Esta pergunta ou devolve a própria linha ou não
 * devolve nada.
 *
 * E ela é compatível com o isolamento por linha sem exceção nenhuma: a policy de
 * `Org` (migration do isolamento, bloco 3.2) libera `"id" = app_org_atual()`, que
 * é exatamente o que este `where` pede.
 *
 * POR QUE NÃO É UMA PERMISSÃO NOVA
 * Permissão nova exige o ritual de três passos (`packages/shared/src/permissions.ts`)
 * e o comando de sincronizar REVOGA vínculo feito à mão — quer dizer, uma chave
 * nova que ninguém semeou deixaria o console inalcançável para todo mundo, em
 * silêncio. Mais: permissão é atributo de PAPEL dentro de uma empresa, e "ser a
 * plataforma" não é papel, é identidade da empresa. Um admin de cliente com o
 * papel mais alto continua não sendo a plataforma.
 *
 * O CACHE, E POR QUE ELE É CURTO
 * A resposta muda quando alguém troca o slug de uma empresa, o que não acontece.
 * Mesmo assim o cache tem prazo: cache sem prazo em decisão de acesso é a forma
 * clássica de uma revogação não chegar. Sessenta segundos é o mesmo valor que o
 * RASTRO usa para a retenção por empresa, e pelo mesmo motivo — a API roda em
 * mais de um processo.
 */

const TTL_MS = 60_000;

interface Lembranca {
  ehPlataforma: boolean;
  ate: number;
}

@Injectable()
export class SessaoDaPlataformaGuard implements CanActivate {
  private readonly lembradas = new Map<string, Lembranca>();

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const orgId: string | undefined = req.user?.orgId;
    // Sem empresa na sessão não há o que conferir. `JwtAuthGuard` roda antes e
    // já teria recusado; a recusa aqui é a rede, e ela fecha, nunca abre.
    if (!orgId) throw new ForbiddenException(RECUSA);

    if (!(await this.ehAEmpresaDaPlataforma(orgId))) throw new ForbiddenException(RECUSA);
    return true;
  }

  /** Exposto para a suíte poder medir a decisão sem montar um ExecutionContext. */
  async ehAEmpresaDaPlataforma(orgId: string): Promise<boolean> {
    const agora = Date.now();
    const lembrada = this.lembradas.get(orgId);
    if (lembrada && lembrada.ate > agora) return lembrada.ehPlataforma;

    const linha = await this.prisma.org.findFirst({
      where: { id: orgId, slug: SLUG_DA_PLATAFORMA },
      select: { id: true },
    });
    const ehPlataforma = linha !== null;
    this.lembradas.set(orgId, { ehPlataforma, ate: agora + TTL_MS });
    return ehPlataforma;
  }

  /** Só para a suíte: esquece o que foi decidido. */
  esquecer(): void {
    this.lembradas.clear();
  }
}

/*
 * A MESMA FRASE PARA "NÃO É A PLATAFORMA" E PARA "SEM EMPRESA".
 *
 * Quem chega aqui sem ser da plataforma não precisa aprender, pela resposta, que
 * existe uma empresa com slug especial e que a diferença entre os dois casos é
 * outra. É a mesma escolha do `JwtAuthGuard`, que responde "Token inválido" para
 * token de outro tipo.
 */
const RECUSA = 'Esta área é do console da plataforma.';
