import { Body, Controller, ForbiddenException, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { TrabAtaAceitarSchema, TrabAtaColarSchema } from '@mktos/shared';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { AtasDoGranolaService } from './atas-do-granola.service';
import { AtasService, type AcessoAsAtas, type QuemDecide } from './atas.service';
import { SoGenteNasAtasGuard } from './so-gente-nas-atas.guard';

/*
 * O BANCO DE ATAS DO TRABALHO (rodada do painel P3, 18/10/2026).
 *
 * O prefixo é `trabalho/atas`: o primeiro segmento é `trabalho`, e é ele que o
 * gate de módulos confere (`tenants/modulos.ts`). Nenhum prefixo novo.
 *
 * Permissões, todas que já existiam e nenhuma nova (revisão PA-2, 18/10/2026:
 * o banco de atas não pode ALARGAR acesso):
 *   · ler a lista, uma ata e as sugestões é `tarefas.ver`. As atas DO VAULT (e
 *     as sugestões tiradas delas) pedem também `obsidian.ver`, a permissão que
 *     lê o vault em toda a API: sem ela, a lista traz só as coladas e diz por quê;
 *   · colar uma ata escreve NOTA DA MEMÓRIA, e pede o que o `POST /memoria`
 *     pede (`obsidian.editar`), além de `tarefas.editar`;
 *   · pedir a leitura, aceitar e descartar é `tarefas.editar`: aceitar é criar
 *     uma tarefa pelo `WorkService`, o caminho do botão "Nova tarefa".
 *
 * GENTE, NÃO MÁQUINA (PA-3): toda escrita passa pelo `SoGenteNasAtasGuard`
 * (o token) e o serviço relê o banco. Nada passa pela porta: é escrita
 * interna, sem efeito externo, como o resto do Trabalho.
 *
 * O corpo de `POST /trabalho/atas` aceita até o teto do schema (200 mil
 * caracteres) pelo parser grande de `common/corpo-da-midia.ts`, só nessa rota
 * e só com sessão válida (PA-6).
 *
 * A ORDEM DOS MÉTODOS IMPORTA: `sugestoes` e `granola` vêm antes de `:ref`,
 * senão o `GET :ref` os engoliria.
 *
 * AS REUNIÕES DO GRANOLA (rodada da interface, 20/10/2026), as mesmas regras:
 *   · ver a lista é `tarefas.ver` (a lista só diz título, data, participantes
 *     e o cliente reconhecido);
 *   · gerar a ata escreve NOTA DA MEMÓRIA, então pede o que colar pede
 *     (`tarefas.editar` + `obsidian.editar`), pelo guarda de gente;
 *   · "Reprocessar" (`POST :ref/reprocessar`) é `tarefas.editar`; quando a ata
 *     veio do Granola ele reescreve a nota, e aí `obsidian.editar` é conferido
 *     aqui, porque a rota serve às duas fontes.
 */
const RECUSA_SEM_EDITAR_MEMORIA = 'Reprocessar uma ata do Granola reescreve a nota da memória, e isso pede a permissão "obsidian.editar".';
const acessoDe = (u: JwtUser): AcessoAsAtas => ({ vault: (u.permissions ?? []).includes('obsidian.ver') });
const quemE = (u: JwtUser): QuemDecide => ({ id: u.sub, papeis: u.roles ?? [] });

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/atas')
export class AtasController {
  constructor(
    private readonly atas: AtasService,
    private readonly doGranola: AtasDoGranolaService,
  ) {}

  @Get()
  @RequirePermissions('tarefas.ver')
  listar(@CurrentUser() u: JwtUser) {
    return this.atas.listar(u.orgId, acessoDe(u));
  }

  @Post()
  @UseGuards(SoGenteNasAtasGuard)
  @RequirePermissions('tarefas.editar', 'obsidian.editar')
  colar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.atas.colar(u.orgId, quemE(u), TrabAtaColarSchema.parse(body));
  }

  @Get('sugestoes')
  @RequirePermissions('tarefas.ver')
  sugestoes(@CurrentUser() u: JwtUser, @Query('ata') ata?: string, @Query('estado') estado?: string) {
    return this.atas.sugestoes(u.orgId, { ata, estado }, acessoDe(u));
  }

  @Post('sugestoes/:id/aceitar')
  @UseGuards(SoGenteNasAtasGuard)
  @RequirePermissions('tarefas.editar')
  aceitar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.atas.aceitar(u.orgId, quemE(u), id, TrabAtaAceitarSchema.parse(body ?? {}), acessoDe(u));
  }

  @Post('sugestoes/:id/descartar')
  @UseGuards(SoGenteNasAtasGuard)
  @RequirePermissions('tarefas.editar')
  descartar(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.atas.descartar(u.orgId, quemE(u), id, acessoDe(u));
  }

  @Get('granola')
  @RequirePermissions('tarefas.ver')
  reunioesDoGranola(@CurrentUser() u: JwtUser) {
    return this.doGranola.reunioes(u.orgId);
  }

  @Post('granola/:id/ata')
  @UseGuards(SoGenteNasAtasGuard)
  @RequirePermissions('tarefas.editar', 'obsidian.editar')
  gerarAtaDoGranola(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.doGranola.gerarAta(u.orgId, quemE(u), id);
  }

  @Get(':ref')
  @RequirePermissions('tarefas.ver')
  ler(@CurrentUser() u: JwtUser, @Param('ref') ref: string) {
    return this.atas.ler(u.orgId, ref, acessoDe(u));
  }

  @Post(':ref/sugestoes')
  @UseGuards(SoGenteNasAtasGuard)
  @RequirePermissions('tarefas.editar')
  gerar(@CurrentUser() u: JwtUser, @Param('ref') ref: string) {
    return this.atas.gerar(u.orgId, quemE(u), ref, acessoDe(u));
  }

  /**
   * "Reprocessar sugestões": da TRANSCRIÇÃO, quando a ata veio do Granola (puxa
   * de novo, e a ata ganha versão nova); da própria ata, quando foi colada ou
   * está no vault (o mesmo "Sugerir tarefas").
   */
  @Post(':ref/reprocessar')
  @UseGuards(SoGenteNasAtasGuard)
  @RequirePermissions('tarefas.editar')
  async reprocessar(@CurrentUser() u: JwtUser, @Param('ref') ref: string) {
    const ata = await this.atas.exigirAta(u.orgId, ref, acessoDe(u));
    if (ata.granolaId) {
      if (!(u.permissions ?? []).includes('obsidian.editar')) throw new ForbiddenException(RECUSA_SEM_EDITAR_MEMORIA);
      return { origem: 'granola' as const, ...(await this.doGranola.reprocessar(u.orgId, quemE(u), ata.granolaId)) };
    }
    return { origem: 'ata' as const, ...(await this.atas.gerar(u.orgId, quemE(u), ref, acessoDe(u))) };
  }
}
