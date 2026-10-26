import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  TrabAtaAceitarSchema,
  TrabAtaColarSchema,
  TrabAtaDrivePastaSchema,
  TrabAtaFiltrosSchema,
  TrabAtaLigarSchema,
  lerRefDaAta,
  type TrabAtaFiltros,
} from '@mktos/shared';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { AtasDoGranolaService } from './atas-do-granola.service';
import { AtasService, type AcessoAsAtas, type QuemDecide } from './atas.service';
import { DriveDasAtasService } from './fonte-do-drive';
import { LigacoesDasAtasService } from './ligacoes-das-atas.service';
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
 * AS FONTES E A BUSCA (produção 21, P7, 21/10/2026): `GET /trabalho/atas`
 * aceita `?q=&de=&ate=&tipo=&fonte=` e junta vault, coladas, Granola (cada
 * reunião é uma TRANSCRIÇÃO, `granola:<id>`) e a pasta do Google Drive
 * (`drive:<id>`). O Drive é lido PELA PORTA (`contexto.arquivo.listar` e
 * `contexto.arquivo.ler`, R0) e pede `drive.ver`, como toda leitura do Drive
 * na API; escolher a pasta (`PUT drive`) escreve nota da memória e pede
 * `tarefas.editar` + `obsidian.editar` + `drive.ver`. Gerar a ata de uma
 * transcrição do Drive (`POST drive/:id/ata`) pede o mesmo que a do Granola,
 * mais `drive.ver`.
 *
 * AS REUNIÕES DO GRANOLA (rodada da interface, 20/10/2026), as mesmas regras:
 *   · ver a lista é `tarefas.ver` (a lista só diz título, data, participantes
 *     e o cliente reconhecido);
 *   · gerar a ata escreve NOTA DA MEMÓRIA, então pede o que colar pede
 *     (`tarefas.editar` + `obsidian.editar`), pelo guarda de gente;
 *   · "Reprocessar" (`POST :ref/reprocessar`) é `tarefas.editar`; quando a ata
 *     veio do Granola ele reescreve a nota, e aí `obsidian.editar` é conferido
 *     aqui, porque a rota serve às duas fontes.
 *
 * Layout 26/10: A ATA LIGADA A UM LEAD OU A UM CLIENTE (`LigacoesDasAtasService`).
 *   · a lista e a ata aberta trazem `ligadaA`;
 *   · `GET ligadas?lead=|cliente=` é `tarefas.ver` (o painel do lead e a ficha
 *     do cliente leem daqui; vault e Drive só para quem os lê);
 *   · `GET alvos?tipo=lead|cliente&q=` é a busca: lead pede também `leads.ver`;
 *   · `PUT :ref/ligacao` é `tarefas.editar`, pelo guarda de gente. Não é o
 *     `ata.chegou` do comercial: nenhuma reação roda.
 */
const RECUSA_SEM_EDITAR_MEMORIA = 'Reprocessar uma ata do Granola reescreve a nota da memória, e isso pede a permissão "obsidian.editar".';
const acessoDe = (u: JwtUser): AcessoAsAtas => ({
  vault: (u.permissions ?? []).includes('obsidian.ver'),
  drive: (u.permissions ?? []).includes('drive.ver'),
  actorId: u.sub,
});
const RECUSA_SEM_DRIVE = 'Ler o Google Drive pede a permissão "drive.ver", que o seu perfil não tem.';
const quemE = (u: JwtUser): QuemDecide => ({ id: u.sub, papeis: u.roles ?? [] });

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/atas')
export class AtasController {
  constructor(
    private readonly atas: AtasService,
    private readonly doGranola: AtasDoGranolaService,
    private readonly drive: DriveDasAtasService,
    private readonly ligacoes: LigacoesDasAtasService,
  ) {}

  @Get()
  @RequirePermissions('tarefas.ver')
  async listar(@CurrentUser() u: JwtUser, @Query() query: Record<string, unknown>) {
    const filtros = TrabAtaFiltrosSchema.parse(query ?? {}) as TrabAtaFiltros;
    // As reuniões do Granola só são pedidas quando a busca pode trazê-las (transcrição do Granola).
    const comGranola = (!filtros.fonte || filtros.fonte === 'granola') && (!filtros.tipo || filtros.tipo === 'transcricao');
    const granola = comGranola ? await this.doGranola.reunioes(u.orgId) : null;
    const lista = await this.atas.listar(u.orgId, acessoDe(u), filtros, { granola });
    // Layout 26/10: cada ata diz a que lead e a que cliente está ligada.
    return { ...lista, atas: await this.ligacoes.anotar(u.orgId, lista.atas) };
  }

  /** Layout 26/10: as atas ligadas a um lead (`?lead=`) ou a um cliente (`?cliente=`). */
  @Get('ligadas')
  @RequirePermissions('tarefas.ver')
  ligadas(@CurrentUser() u: JwtUser, @Query('lead') lead?: string, @Query('cliente') cliente?: string) {
    return this.ligacoes.ligadas(u.orgId, { leadId: lead || null, clienteId: cliente || null }, acessoDe(u));
  }

  /** Layout 26/10: a busca de lead ou cliente para ligar a ata. */
  @Get('alvos')
  @RequirePermissions('tarefas.ver')
  alvos(@CurrentUser() u: JwtUser, @Query('tipo') tipo?: string, @Query('q') q?: string) {
    const t = tipo === 'lead' ? 'lead' : 'cliente';
    return this.ligacoes.candidatos(u.orgId, t, q, (u.permissions ?? []).includes('leads.ver'));
  }

  /** A pasta do Google Drive das atas (P7): qual é e se quem pede pode ler o Drive. */
  @Get('drive')
  @RequirePermissions('tarefas.ver')
  pastaDoDrive(@CurrentUser() u: JwtUser) {
    return this.drive.estado(u.orgId, acessoDe(u).drive === true);
  }

  /** Escolhe a pasta (link ou id colado) ou a tira (`pasta: null`). Nota da memória, pelo `MemoriaService`. */
  @Put('drive')
  @UseGuards(SoGenteNasAtasGuard)
  @RequirePermissions('tarefas.editar', 'obsidian.editar', 'drive.ver')
  async escolherPastaDoDrive(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    const { pasta } = TrabAtaDrivePastaSchema.parse(body ?? {});
    await this.atas.exigirGente(u.orgId, quemE(u));
    return this.drive.configurar(u.orgId, u.sub, pasta);
  }

  /** Gera a ata de uma TRANSCRIÇÃO da pasta do Drive: o mesmo pedido da do Granola. */
  @Post('drive/:id/ata')
  @UseGuards(SoGenteNasAtasGuard)
  @RequirePermissions('tarefas.editar', 'obsidian.editar', 'drive.ver')
  gerarAtaDoDrive(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.doGranola.gerarAtaDoDrive(u.orgId, quemE(u), id, acessoDe(u));
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
  async ler(@CurrentUser() u: JwtUser, @Param('ref') ref: string) {
    // A transcrição de uma reunião do Granola é lida agora pelo conector e não fica guardada.
    const lida = lerRefDaAta(ref);
    const ata = lida?.fonte === 'granola' ? await this.doGranola.lerTranscricao(u.orgId, lida.id) : await this.atas.ler(u.orgId, ref, acessoDe(u));
    return (await this.ligacoes.anotar(u.orgId, [ata]))[0];
  }

  /** Layout 26/10: liga a ata a um lead e/ou a um cliente (`null` desliga). Só a ligação: nenhuma reação. */
  @Put(':ref/ligacao')
  @UseGuards(SoGenteNasAtasGuard)
  @RequirePermissions('tarefas.editar')
  ligar(@CurrentUser() u: JwtUser, @Param('ref') ref: string, @Body() body: unknown) {
    const input = TrabAtaLigarSchema.parse(body ?? {});
    return this.ligacoes.ligar(u.orgId, quemE(u), ref, input, { ...acessoDe(u), leads: (u.permissions ?? []).includes('leads.ver') });
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
    // A ata que o OS escreveu de uma transcrição do Drive: puxa de novo do Drive (P7).
    if (ata.fonte === 'drive' && ata.driveId && lerRefDaAta(ref)?.fonte === 'colada') {
      if (!(u.permissions ?? []).includes('obsidian.editar')) throw new ForbiddenException(RECUSA_SEM_EDITAR_MEMORIA);
      if (!acessoDe(u).drive) throw new ForbiddenException(RECUSA_SEM_DRIVE);
      return { origem: 'drive' as const, ...(await this.doGranola.gerarAtaDoDrive(u.orgId, quemE(u), ata.driveId, acessoDe(u))) };
    }
    return { origem: 'ata' as const, ...(await this.atas.gerar(u.orgId, quemE(u), ref, acessoDe(u))) };
  }
}
