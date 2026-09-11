import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SessionCanal } from '@prisma/client';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { AgentsService } from './agents.service';
import { AgentRuntime } from './agent-runtime.service';
import { SessionService } from './session.service';

const PedidoSchema = z.object({
  pedido: z.string().min(1).max(4000),
  canal: z.nativeEnum(SessionCanal).default(SessionCanal.web),
  canalRef: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

/*
 * QUEM PODE FAZER UM AGENTE RODAR (RF-G-03 · LLM06 · fatia 0.3a).
 *
 * `mcp.executar` sozinho não serve de trava: ele está no perfil `ia_servico`,
 * que o próprio catálogo descreve como "só leitura (menor privilégio)", e
 * também no `ia_acao`. Ou seja, a conta de serviço da IA podia disparar um
 * agente — e um agente alcança a porta, que alcança conector.
 *
 * Enquanto não existir uma permissão dedicada (`agentes.executar` em
 * packages/shared/src/permissions.ts, que é decisão humana e mora fora desta
 * fatia), a trava é a mesma que o resto do código já usa para superfície de
 * administrador: `admin.usuarios` — hoje só o perfil `admin_master`. As rotas
 * de LEITURA seguem em `mcp.ver`: elas não fazem nada acontecer, e fechá-las
 * cegaria o painel sem fechar buraco nenhum.
 *
 * O guarda exige TODAS as permissões da lista (PermissionsGuard usa `every`),
 * então isto é interseção, não alternativa.
 */
const EXECUTAR_AGENTE = ['mcp.executar', 'admin.usuarios'] as const;

/** Declarar a linha de base é escrita na configuração do agente, não execução. */
const CONFIGURAR_AGENTE = ['automacoes.executar', 'admin.usuarios'] as const;

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class AgentsController {
  constructor(
    private readonly agentes: AgentsService,
    private readonly runtime: AgentRuntime,
    private readonly sessoes: SessionService,
  ) {}

  @Get('agents')
  @RequirePermissions('mcp.ver')
  roster(@CurrentUser() user: JwtUser) {
    return this.agentes.roster(user.orgId);
  }

  @Get('agents/:slug')
  @RequirePermissions('mcp.ver')
  detalhe(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.agentes.detalhe(user.orgId, slug);
  }

  @Post('agents/:slug/linha-de-base')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  linhaDeBase(
    @CurrentUser() user: JwtUser,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    const { minutos } = z.object({ minutos: z.number().int().positive() }).parse(body);
    return this.agentes.declararLinhaDeBase(user.orgId, slug, minutos, user.sub);
  }

  /*
   * O PROCEDIMENTO (RF-N-01, RF-N-02) — os sete campos, com formato fixo.
   *
   * A validação e a gravação existiam desde a fatia 5.2 e ficaram SEM ROTA: o
   * arquivo era vetado para ela (alterado na onda 1, e a onda 10 volta aqui), e
   * duas mãos no mesmo controller custam mais do que uma tela em desvio por uma
   * onda. Consequência medida enquanto isso: o botão de salvar devolvia "não
   * encontrado" e a tela precisou aprender a distinguir a frase do roteador do
   * 404 legítimo (`apps/web/src/app/agentes/rota-ausente.ts`).
   *
   * PUT e não POST: o procedimento é UM por agente e a gravação o substitui
   * inteiro — `salvarSop` faz `upsert` na chave `agentId`. Mandar o mesmo corpo
   * duas vezes deixa o mesmo estado (a versão sobe, que é o registro de quem
   * mexeu, não um segundo procedimento).
   *
   * PERMISSÃO: `CONFIGURAR_AGENTE`, a mesma da linha de base — escrever o método
   * de operação da empresa é configuração do agente, não execução dele. Nenhuma
   * chave nova entra: as duas já estão no catálogo, e por isso esta ligação NÃO
   * pede o ritual de três passos (construir o pacote, sincronizar o catálogo,
   * todo mundo sair e entrar).
   *
   * O corpo não é validado aqui de propósito: quem valida é `validarProcedimento`
   * (`agents/sop.ts`), que devolve os sete campos faltantes de uma vez e recusa
   * cabeçalho fixo contrabandeado em campo livre. Um Zod a mais nesta camada
   * duplicaria a regra e um dia divergiria dela.
   */
  @Put('agents/:slug/sop')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  salvarSop(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    return this.agentes.salvarSop(user.orgId, slug, body, user.sub);
  }

  /*
   * A IDENTIFICAÇÃO do agente: nome, missão, pilar e dono — e SÓ.
   *
   * A lista branca mora no serviço (`AgenteIdentidadeSchema`), com o motivo de
   * cada campo que ficou de fora: capacidade e autonomia são a declaração de
   * menor privilégio, contexto fixo vira regra da casa no prompt, teto e modelo
   * são da fatia do custo, e cron/estado são da tela de rotinas. Aqui só se liga
   * o caminho; alargar o que entra é editar aquele schema, onde a decisão está
   * escrita.
   *
   * PATCH e não PUT: o schema é `.partial()`, o corpo é um subconjunto dos
   * campos e o que não vem não muda.
   */
  @Patch('agents/:slug')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  atualizar(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    return this.agentes.atualizar(user.orgId, slug, body, user.sub);
  }

  /*
   * O ORGANOGRAMA (RF-N-06) — gente e agentes lado a lado, por pilar.
   *
   * `dashboard.ver`, e não `mcp.ver` nem `admin.usuarios`: esta é a tela mais
   * aberta das três que mostram gente, e é o que o menu já declara para ela
   * (`packages/shared/src/nav.ts`). Duas permissões diferentes para a mesma tela
   * é o defeito que a fila de aprovação já pagou uma vez — item aparecendo para
   * um público e API respondendo a outro.
   *
   * Fora de `agents/` no caminho porque a resposta não é sobre agentes: é sobre
   * a organização. `/agents` continua sendo o roster.
   */
  @Get('organograma')
  @RequirePermissions('dashboard.ver')
  organograma(@CurrentUser() user: JwtUser) {
    return this.agentes.organograma(user.orgId);
  }

  @Post('agents/:slug/executar')
  @RequirePermissions(...EXECUTAR_AGENTE)
  async executar(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    const input = PedidoSchema.parse(body);
    const resumo = await this.runtime.executar({
      orgId: user.orgId,
      agentSlug: slug,
      canal: input.canal,
      canalRef: input.canalRef,
      sessionId: input.sessionId,
      pedido: input.pedido,
      solicitanteId: user.sub,
      solicitanteRotulo: user.name ?? user.sub,
    });

    /*
     * TETO DE CUSTO DE IA DA EMPRESA ESTOURADO (RF-G-05): 429, e não 200 nem 500.
     *
     * Até 11/09/2026 a exceção do teto escapava do laço e chegava aqui crua: o
     * operador via "erro interno do servidor", sem o motivo, e a sessão ficava
     * pendurada. O laço passou a encerrar a sessão como `recusada` com o motivo;
     * falta a rota DIZER o que aconteceu.
     *
     * 429 porque a semântica é essa: a cota do período acabou e volta sozinha na
     * virada do dia — é a mesma família de "tente de novo mais tarde", e é o que
     * o front precisa para mostrar o aviso certo em vez da tela de erro. 402
     * (pagamento) diria que falta dinheiro no provedor, que é outra coisa; 403
     * diria que falta permissão, que também é outra.
     *
     * O corpo leva a sessão: ela EXISTE, está gravada e é auditável — quem
     * recebe o erro precisa conseguir abrir o traço do que já tinha rodado.
     */
    if (resumo.recusaDeTeto) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'teto_de_custo_de_ia',
          message: resumo.recusaDeTeto.motivo,
          sessionId: resumo.sessionId,
          status: resumo.status,
          dia: resumo.recusaDeTeto.dia,
          causa: resumo.recusaDeTeto.causa,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return resumo;
  }

  /*
   * O mesmo pedido, respondendo em pedaços.
   *
   * SSE e não WebSocket: o tráfego é de mão única. E com effort alto o primeiro
   * token demora dezenas de segundos — sem streaming a tela fica muda o tempo
   * todo e parece travada.
   *
   * POST que responde text/event-stream porque EventSource não manda header, e
   * token em query string é dado sensível em URL. O front lê com fetch +
   * ReadableStream.
   */
  @Post('agents/:slug/stream')
  @RequirePermissions(...EXECUTAR_AGENTE)
  async stream(
    @CurrentUser() user: JwtUser,
    @Param('slug') slug: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const input = PedidoSchema.parse(body);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // O proxy do Next bufferiza por padrão e o stream chegaria de uma vez só.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const manda = (e: unknown) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };

    try {
      await this.runtime.executar({
        orgId: user.orgId,
        agentSlug: slug,
        canal: input.canal,
        canalRef: input.canalRef,
        sessionId: input.sessionId,
        pedido: input.pedido,
        solicitanteId: user.sub,
        solicitanteRotulo: user.name ?? user.sub,
        onEvento: manda,
      });
    } catch (e) {
      manda({ t: 'erro', mensagem: (e as Error).message });
    } finally {
      res.end();
    }
  }

  @Get('sessions')
  @RequirePermissions('mcp.ver')
  listar(
    @CurrentUser() user: JwtUser,
    @Query('canal') canal?: string,
    @Query('agente') agente?: string,
    @Query('limit') limit?: string,
  ) {
    const canalValido =
      canal && (Object.values(SessionCanal) as string[]).includes(canal)
        ? (canal as SessionCanal)
        : undefined;
    return this.sessoes.listar(user.orgId, {
      canal: canalValido,
      agentSlug: agente,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('sessions/:id')
  @RequirePermissions('mcp.ver')
  traco(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.sessoes.traco(user.orgId, id);
  }
}
