import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ContextKind, ContextSource } from '@prisma/client';
import { z } from 'zod';
import { MemoriaService } from './memoria.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * ============================================================================
 * A MEMÓRIA, PELA TELA — RF-M-01, RF-M-06
 * ============================================================================
 *
 * AS PERMISSÕES SÃO AS QUE JÁ EXISTEM (`obsidian.ver` / `obsidian.editar`), e
 * isso é decisão, não preguiça. Permissão nova neste repositório exige um
 * ritual de três passos — construir o pacote compartilhado, sincronizar o
 * catálogo e todo mundo sair e entrar de novo — e o comando de sincronização NÃO
 * é aditivo: ele revoga vínculo feito à mão fora da tabela do código. A memória
 * é a mesma base de conhecimento que aquelas duas permissões já governam, agora
 * versionada; separá-las em `memoria.*` criaria uma permissão que ninguém tem no
 * dia seguinte ao deploy, e a tela de Contexto (`/contexto`, em
 * `packages/shared/src/nav.ts`) já exige `obsidian.ver`.
 *
 * NADA AQUI É ESCRITA NO MUNDO DE FORA: criar, alterar e arquivar nota mexem só
 * no banco desta empresa. Não é ação de conector e por isso não passa pela porta
 * — a porta classifica o que a empresa faz sobre o mundo por meio de um
 * terceiro. O que estas rotas produzem é EVENTO NO RASTRO, que é a exigência
 * que de fato se aplica a elas.
 */

const ProcedenciaSchema = z.nativeEnum(ContextSource);
const NaturezaSchema = z.nativeEnum(ContextKind);

const CriarSchema = z
  .object({
    chave: z.string().min(1).max(400),
    kind: NaturezaSchema.optional(),
    title: z.string().min(1).max(400),
    body: z.string().min(1),
    tags: z.array(z.string().min(1)).max(50).optional(),
    // OBRIGATÓRIA, e o schema é o primeiro lugar que cobra (RF-M-02). Nota sem
    // procedência é nota que não sustenta resposta nenhuma.
    sourceType: ProcedenciaSchema,
    sourceRef: z.string().max(1000).nullish(),
    validFrom: z.coerce.date().nullish(),
    validUntil: z.coerce.date().nullish(),
    confidence: z.number().min(0).max(1).optional(),
    motivo: z.string().max(2000).nullish(),
  })
  .strict();

const AlterarSchema = z
  .object({
    kind: NaturezaSchema.optional(),
    title: z.string().min(1).max(400).optional(),
    body: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).max(50).optional(),
    sourceType: ProcedenciaSchema.optional(),
    sourceRef: z.string().max(1000).nullish(),
    validFrom: z.coerce.date().nullish(),
    validUntil: z.coerce.date().nullish(),
    confidence: z.number().min(0).max(1).optional(),
    motivo: z.string().max(2000).nullish(),
  })
  .strict();

const PromoverSchema = z
  .object({
    chave: z.string().min(1).max(400),
    kind: NaturezaSchema.optional(),
    title: z.string().min(1).max(400),
    body: z.string().min(1),
    tags: z.array(z.string().min(1)).max(50).optional(),
    /** A sessão de onde a resposta saiu — é ela que vira a procedência. */
    sessionId: z.string().max(200).nullish(),
    motivo: z.string().max(2000).nullish(),
  })
  .strict();

const MotivoSchema = z.object({ motivo: z.string().max(2000).nullish() }).strict();

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('memoria')
export class MemoriaController {
  constructor(private readonly memoria: MemoriaService) {}

  @Get()
  @RequirePermissions('obsidian.ver')
  listar(
    @CurrentUser() user: JwtUser,
    @Query('kind') kind?: string,
    @Query('arquivadas') arquivadas?: string,
  ) {
    const natureza = NaturezaSchema.safeParse(kind);
    return this.memoria.listar(user.orgId, {
      kind: natureza.success ? natureza.data : undefined,
      incluirArquivadas: arquivadas === '1' || arquivadas === 'true',
    });
  }

  /**
   * Busca TEXTUAL pela tela.
   *
   * Sem vetor de propósito: quem tem a chave do fornecedor de embedding é o
   * conector, e esta rota não vai atrás dele. A busca semântica sobre a memória
   * entra pelo caminho do agente, que já tem o vetor da pergunta em mãos — ver
   * `MemoriaService.buscar`.
   */
  @Get('buscar')
  @RequirePermissions('obsidian.ver')
  buscar(@CurrentUser() user: JwtUser, @Query('q') q?: string, @Query('limite') limite?: string) {
    return this.memoria.buscar(user.orgId, q ?? '', limite ? Number(limite) : 8);
  }

  /**
   * A INTEGRIDADE DA MEMÓRIA — versão por versão, contra o RASTRO.
   *
   * É o argumento do ADR-011 virando código. O ADR recusou o desenho
   * alternativo ("documento com histórico") alegando, entre outras coisas, que
   * ele não é à prova de adulteração; enquanto nada comparasse a versão com o
   * evento, o desenho escolhido não era melhor nisso, e uma alteração direta na
   * linha de versão passava tão despercebida quanto passaria lá.
   *
   * `auditoria.ver` E NÃO `obsidian.ver`: a pergunta é de auditoria, é a mesma
   * de `GET /audit/verificar`, e a resposta não carrega conteúdo de nota
   * nenhuma — só identificadores, hashes e diagnósticos.
   *
   * ELA DEVERIA SER CHAMADA POR `GET /audit/verificar`, para que exista UM lugar
   * onde se pergunta "o rastro fecha?". Está registrado em FORA DO ESCOPO no
   * relatório da fatia: `src/audit/` e `src/gateway/` não pertencem a ela e
   * outro agente escreve nos arquivos vizinhos neste momento.
   */
  @Get('integridade')
  @RequirePermissions('auditoria.ver')
  integridade(@CurrentUser() user: JwtUser) {
    return this.memoria.conferirElos(user.orgId);
  }

  /*
   * `:id` FICA DEPOIS DAS ROTAS DE NOME FIXO. Nest casa na ordem de declaração:
   * acima de `buscar` e `integridade`, este `@Get(':id')` engoliria as duas e a
   * resposta seria "Nota não encontrada" para uma rota que existe.
   */
  @Get(':id')
  @RequirePermissions('obsidian.ver')
  async obter(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    const nota = await this.memoria.obter(user.orgId, id);
    if (!nota) throw new NotFoundException('Nota não encontrada.');
    return nota;
  }

  /** O HISTÓRICO DE VERSÕES — o que RF-M-01 chama de "contexto versionado". */
  @Get(':id/versoes')
  @RequirePermissions('obsidian.ver')
  historico(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.memoria.historico(user.orgId, id);
  }

  @Post()
  @RequirePermissions('obsidian.editar')
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const dados = CriarSchema.parse(body);
    return this.memoria.criar(user.orgId, dados);
  }

  /** RF-M-06: a resposta vira nota permanente com um gesto. */
  @Post('promover')
  @RequirePermissions('obsidian.editar')
  promover(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const dados = PromoverSchema.parse(body);
    return this.memoria.promover(user.orgId, dados);
  }

  @Patch(':id')
  @RequirePermissions('obsidian.editar')
  alterar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const dados = AlterarSchema.parse(body);
    return this.memoria.alterar(user.orgId, id, dados);
  }

  /*
   * ARQUIVAR, e não `DELETE` (ADR-011). O verbo da rota diz o que acontece:
   * `DELETE /memoria/:id` prometeria uma exclusão que não existe, e alguém
   * acabaria implementando a promessa.
   */
  @Post(':id/arquivar')
  @RequirePermissions('obsidian.editar')
  arquivar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { motivo } = MotivoSchema.parse(body ?? {});
    return this.memoria.arquivar(user.orgId, id, motivo);
  }

  @Post(':id/restaurar')
  @RequirePermissions('obsidian.editar')
  restaurar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { motivo } = MotivoSchema.parse(body ?? {});
    return this.memoria.restaurar(user.orgId, id, motivo);
  }
}
