import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TrackEventSchema } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from './events.service';
import { PixelTenantService, chaveDoPixel } from './pixel-tenant.service';
import { comTenantPublico } from '../common/tenant-publico';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * Ingestão de eventos do pixel (público) + leitura agregada (autenticada).
 * Ver docs/ARCHITECTURE.md §5.
 *
 * A empresa do evento é resolvida pela CHAVE DO PIXEL (`PixelTenantService`) e
 * publicada no contexto de execução antes de qualquer escrita — o `slug: 'root'`
 * fixo que ficava aqui era a dívida que a fatia 1.4 pagou (RF-T-04).
 *
 * A ROTA ANÔNIMA RESPONDE SEMPRE A MESMA COISA — e isto é conserto de furo
 * A primeira versão desta fatia devolvia `{ ok: false, reason: 'org' }` quando a
 * chave não resolvia e `{ ok: true }` quando resolvia. São duas respostas
 * distinguíveis numa rota que qualquer pessoa chama sem credencial: dá para
 * varrer chaves até uma responder diferente, e nesse momento a pessoa sabe que
 * aquela empresa existe — e cada acerto JÁ É UMA ESCRITA na conta dela.
 *
 * Agora a resposta é uma constante. Quem chama é um pixel: ele não tem o que
 * fazer com a diferença, não a lê e não a mostra a ninguém. Quem precisa da
 * diferença é o operador, e ele a tem no inventário de recusas que o
 * `PixelTenantService` mantém e registra em resumo periódico.
 *
 * O QUE AINDA DISTINGUE — declarado, porque fingir que não existe é pior: o
 * TEMPO. Chave conhecida e chave desconhecida entram as duas na memória curta,
 * mas a PRIMEIRA de cada vai ao banco, e um adversário paciente mede isso. Fechar
 * esse canal é assunto do teto de taxa por chave, que vem com o `PixelSite` (ver
 * `pixel-tenant.service.ts`).
 */

/**
 * A resposta da ingestão. UMA, para qualquer desfecho — ver o cabeçalho.
 *
 * `Object.freeze` porque ela é devolvida por referência em toda requisição: um
 * dia alguém escreve `resposta.reason = …` num caminho de erro e a constante
 * vira variável global, com o valor do pedido anterior vazando para o seguinte.
 */
const RESPOSTA_DA_INGESTAO = Object.freeze({ ok: true });

@Controller('events')
export class EventsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: EventsService,
    private readonly tenants: PixelTenantService,
  ) {}

  // --- Ingestão (público, sem auth: o pixel roda no browser do visitante) ---
  @Post('track')
  async track(@Body() body: unknown, @Query('k') k?: unknown) {
    const e = TrackEventSchema.parse(body);
    /*
     * A chave sai do objeto VALIDADO. `TrackEventSchema` é um `z.object` sem
     * `passthrough` e, enquanto `pixel_key` não estava declarado nele, ele
     * DESCARTAVA o campo em silêncio — por isso esta linha lia o corpo cru. O
     * campo entrou no schema (como `z.unknown()`, para que chave com lixo não
     * vire 400 nesta rota anônima: ver o comentário lá) e a leitura voltou para
     * onde devia estar.
     *
     * `k` entra como `unknown` de propósito: com `?k=a&k=b` o Express entrega
     * uma LISTA, e tipá-la como `string` faria o TypeScript acreditar numa coisa
     * que o Express não promete. Quem decide o que é chave é `chaveDoPixel`.
     */
    const alvo = await this.tenants.resolver(chaveDoPixel(e, k));
    // Sem empresa resolvida não se grava — e a resposta é a mesma de sempre.
    if (!alvo) return RESPOSTA_DA_INGESTAO;

    await comTenantPublico(alvo.orgId, async () => {
      // dedup por event_id (idempotência)
      await this.prisma.pixelEvent.upsert({
        where: { eventId: e.event_id },
        update: {},
        create: {
          orgId: alvo.orgId,
          eventId: e.event_id,
          sessionId: e.session_id,
          anonymousId: e.anonymous_id,
          eventName: e.event_name,
          url: e.url,
          referrer: e.referrer,
          utmSource: e.utm_source,
          utmMedium: e.utm_medium,
          utmCampaign: e.utm_campaign,
          utmContent: e.utm_content,
          utmTerm: e.utm_term,
          device: e.device,
          value: e.value != null ? e.value.toString() : null,
          metadata: e.metadata ? (e.metadata as Prisma.InputJsonValue) : undefined,
          occurredAt: e.ts ? new Date(e.ts) : undefined,
        },
      });
    });
    return RESPOSTA_DA_INGESTAO;
  }

  // --- Leitura (painel /pixels e MCP) — read-only, exige dashboard.ver ---
  @Get('summary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('dashboard.ver')
  summary(@CurrentUser() user: JwtUser, @Query('days') days?: string) {
    return this.svc.summary(user.orgId, days ? Number(days) : 7);
  }

  @Get('recent')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('dashboard.ver')
  recent(@CurrentUser() user: JwtUser, @Query('limit') limit?: string) {
    return this.svc.recent(user.orgId, limit ? Number(limit) : 50);
  }
}
