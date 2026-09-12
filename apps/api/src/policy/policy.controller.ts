import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { ReguaService } from './regua.service';
import { PedidoDeSimulacaoSchema } from './simulador';

/*
 * A RÉGUA VISTA DE FORA — a API da tela `/regua` (RF-P-09, RF-B-01).
 *
 * PAINEL DE LEITURA PEDE PERMISSÃO DE VER, NÃO DE ADMINISTRAR.
 * Estas duas rotas nasceram exigindo `admin.usuarios`, herdada da tela de
 * usuários que virou a aba "Quem autoriza". Era restritivo demais e quebrava o
 * critério da própria fatia: `admin.usuarios` só existe no perfil Admin Master
 * — nem o Diretor tem —, e o critério fala em "um operador submete uma ação
 * hipotética". Nenhum operador conseguia.
 *
 * A convenção do resto da API é a permissão de VER do assunto da tela:
 * `auditoria.ver` no rastro, `relatorios.ver` nos relatórios, `mcp.ver` nos
 * agentes, nas sessões e nas ferramentas. O assunto da Régua é exatamente esse
 * último eixo — qual agente pode usar qual capacidade, em que degrau —, então
 * ela usa `mcp.ver`, que Gestor e Analista já têm. Nenhuma permissão nova foi
 * inventada: chave nova é decisão do Pedro, e está registrada no relatório.
 *
 * A ABA "QUEM AUTORIZA" NÃO AFROUXOU JUNTO. Ela lê `GET /api/users` e
 * `GET /api/roles`, e as quatro rotas de `users.controller.ts` continuam
 * exigindo `admin.usuarios`. Quem entra na Régua com `mcp.ver` vê a régua
 * inteira e recebe 403 naquela aba — por isso a tela esconde o botão dela para
 * quem não tem a permissão, em vez de oferecer uma porta que não abre.
 *
 * NENHUMA DESTAS ROTAS AGE. `GET` lê a política; `POST /policy/simular` é uma
 * pergunta — apesar do verbo, que é POST só porque o pedido tem corpo grande
 * demais para query string. Ela não cria aprovação, não chama efeito e não
 * grava decisão. Daí o `@HttpCode(200)`: 201 diria que alguma coisa foi criada,
 * e nada foi.
 *
 * O PREFIXO `policy` É ESPINHA DO OS, e agora está declarado em
 * `src/tenants/modulos.ts` (`PREFIXOS_DA_ESPINHA`). A régua não desliga para
 * empresa nenhuma — como `auth`, `audit` e `approvals` —, mas o que ela MOSTRA
 * é filtrado pelos módulos contratados: ver `ReguaService.politicaVisivel()`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class PolicyController {
  constructor(private readonly regua: ReguaService) {}

  /** Tudo o que a tela mostra: níveis, sinais, catálogo e sobrescritas. */
  @Get('policy/regua')
  @RequirePermissions('mcp.ver')
  painel(@CurrentUser() user: JwtUser) {
    return this.regua.painel(user.orgId);
  }

  /** A ação hipotética. Responde; não faz. */
  @Post('policy/simular')
  @HttpCode(200)
  @RequirePermissions('mcp.ver')
  simular(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const pedido = PedidoDeSimulacaoSchema.parse(body);
    return this.regua.simular(user.orgId, pedido, user.sub);
  }
}
