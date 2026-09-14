import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { LinhaDoTempoResposta } from '@mktos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { LinhaDoTempoService } from './linha-do-tempo.service';
import {
  CursorInvalidoError,
  FiltroInvalidoError,
  chaveDeFiltro,
  decodificarCursor,
  familiaDeFiltro,
  limiteDaPagina,
} from './narrativa';

/**
 * `GET /api/linha-do-tempo` — a história desta empresa, em ordem.
 *
 * ---------------------------------------------------------------------------
 * A PERMISSÃO É `auditoria.ver`, A MESMA DO RASTRO — e é decisão, não atalho
 * ---------------------------------------------------------------------------
 * As duas telas leem o MESMO fato: quem pode ver o rastro pode ver a linha dele.
 * Uma chave própria daria a chance de alguém ver a narrativa sem poder conferir
 * a prova, o que é pior dos dois lados — e permissão nova custa os três passos
 * (build do shared, `db:sync-permissions` não-aditivo, todo mundo sai e entra)
 * para comprar exatamente nada.
 *
 * O caminho inverso — abrir mais do que o rastro abre — está fechado por
 * desenho: esta rota devolve MENOS que `/rastro`, nunca mais. Nada de conteúdo
 * sai por aqui (ver o cabeçalho de `narrativa.ts`).
 *
 * ---------------------------------------------------------------------------
 * PREFIXO PRÓPRIO, E ELE PRECISA ESTAR DECLARADO
 * ---------------------------------------------------------------------------
 * `linha-do-tempo` é prefixo NOVO, e prefixo não declarado em
 * `src/tenants/modulos.ts` LANÇA em tempo de execução — foi assim que as
 * famílias `memoria` e `rotinas` nasceram quebradas inteiras. Está declarado em
 * `PREFIXOS_DA_ESPINHA`: o controle de agentes não desliga por contrato, pela
 * mesma razão de `rotinas` e `organograma` — um cliente que pudesse desligar a
 * leitura do rastro ficaria com agentes agindo e nenhuma tela para vê-los.
 *
 * Não entrou sob `audit` justamente para ser desligável e observável por conta
 * própria no gate: rota de leitura pesada compartilhando prefixo com a rota que
 * CONFIGURA retenção confunde quem lê o mapa de rotas.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('linha-do-tempo')
export class LinhaDoTempoController {
  constructor(private readonly svc: LinhaDoTempoService) {}

  /*
   * A VALIDAÇÃO DA ENTRADA RECUSA, NÃO CONSERTA.
   *
   * Cursor torto, tipo inexistente e família inventada viram 400 com a frase
   * dizendo o que fazer. A tentação é cair para a primeira página ou ignorar o
   * filtro — e as duas devolvem 200 com uma lista que não é a que foi pedida,
   * que na tela do rastro significa alguém concluindo "não aconteceu nada".
   */
  @Get()
  @RequirePermissions('auditoria.ver')
  async listar(
    @CurrentUser() user: JwtUser,
    @Query('limite') limite?: string,
    @Query('cursor') cursor?: string,
    @Query('agente') agente?: string,
    @Query('tipo') tipo?: string,
    @Query('familia') familia?: string,
  ): Promise<LinhaDoTempoResposta> {
    try {
      return await this.svc.listar({
        orgId: user.orgId,
        limite: limiteDaPagina(limite),
        antesDe: cursor ? decodificarCursor(cursor) : undefined,
        agente: chaveDeFiltro(agente),
        tipo: chaveDeFiltro(tipo),
        familia: familiaDeFiltro(familia),
      });
    } catch (e) {
      if (e instanceof CursorInvalidoError || e instanceof FiltroInvalidoError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }
}
