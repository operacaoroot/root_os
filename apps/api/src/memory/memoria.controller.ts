import {
  Body,
  Controller,
  ForbiddenException,
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
import { ehChaveDaVault } from './procedencia';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcessoAtualGuard } from './acesso-atual.guard';
import { ContextoTrabalhoService } from './contexto-trabalho.service';
import { BRANDBOOK_CHAVE, ContextoTarefaCreateSchema } from '@mktos/shared';
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
    acessoRestrito: z.boolean().optional(),
    leitores: z.array(z.string().uuid()).max(100).optional(),
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
    acessoRestrito: z.boolean().optional(),
    leitores: z.array(z.string().uuid()).max(100).optional(),
    validFrom: z.coerce.date().nullish(),
    validUntil: z.coerce.date().nullish(),
    confidence: z.number().min(0).max(1).optional(),
    motivo: z.string().max(2000).nullish(),
    versaoEsperada: z.number().int().min(1).optional(),
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

/*
 * ============================================================================
 * A COLEÇÃO `vault:` É DA PROJEÇÃO — e a recusa mora AQUI, na borda (R-5)
 * ============================================================================
 *
 * Duas regras de C19-06, e as duas são recusas para GENTE:
 *
 *  · E4 da ROOT-05-REV (regra 2): nota da vault não se altera, não se arquiva
 *    e não se restaura pela tela. Arquivar pela tela durava meia hora — a volta
 *    seguinte da projeção restaurava com "o arquivo voltou a existir na vault" —
 *    e alterar era desfeito do mesmo jeito. A fonte da nota é a base, pelo git.
 *  · Reserva do prefixo (regra 3): criar ou promover com chave `vault:…`, criar
 *    com origem `vault` e trocar a origem para `vault` são recusados. Uma nota
 *    digitada assim seria alterada pela projeção, se o arquivo existisse, ou
 *    arquivada como órfã, se não existisse.
 *
 * NÃO EM `MemoriaService`, de propósito: é por ele que a projeção cria, altera,
 * restaura e arquiva item `vault:` a cada volta, e é com ele que a suíte da
 * memória monta notas da vault. A recusa no serviço quebraria os dois; aqui ela
 * alcança exatamente quem a regra quer alcançar — a requisição de uma pessoa.
 */
const FRASE_DA_VAULT =
  'Esta nota vem da vault da casa (a root-base) e só a projeção mexe nela. Edite o arquivo na ' +
  'base, pelo git: a memória acompanha na volta seguinte, e o que a projeção fez fica no recibo ' +
  'da vault (evento memoria.vault.recibo no RASTRO).';

const FRASE_DO_PREFIXO =
  'A chave "vault:" e a origem "vault" são reservadas à projeção da vault da casa: uma nota ' +
  'digitada com elas seria alterada ou arquivada pela volta seguinte. Use outra chave e outra ' +
  'origem (operador, upload, promocao ou conector).';

@UseGuards(JwtAuthGuard, AcessoAtualGuard)
@Controller('memoria')
export class MemoriaController {
  constructor(private readonly memoria: MemoriaService, private readonly trabalho: ContextoTrabalhoService) {}

  /** A nota existe e é da vault? Então a pessoa não mexe nela (E4). Inexistente segue para o 404 do serviço. */
  private async exigirForaDaVault(orgId: string, id: string, solicitanteId: string): Promise<void> {
    const nota = await this.memoria.obter(orgId, id, solicitanteId);
    if (!nota) throw new NotFoundException('Nota não encontrada.');
    if (nota.chave === BRANDBOOK_CHAVE) throw new ForbiddenException('Altere o livro da marca pelo criador do brandbook.');
    if (nota && (ehChaveDaVault(nota.chave) || nota.sourceType === ContextSource.vault)) {
      throw new ForbiddenException(FRASE_DA_VAULT);
    }
  }

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
    }, user.sub);
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
    return this.memoria.buscar(user.orgId, q ?? '', limite ? Number(limite) : 8, undefined, user.sub);
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
    const nota = await this.memoria.obter(user.orgId, id, user.sub);
    if (!nota) throw new NotFoundException('Nota não encontrada.');
    return nota;
  }

  /** O HISTÓRICO DE VERSÕES — o que RF-M-01 chama de "contexto versionado". */
  @Get(':id/versoes')
  @RequirePermissions('obsidian.ver')
  historico(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.memoria.historico(user.orgId, id, user.sub);
  }

  @Get(':id/tarefas/pedidos/:requestId')
  @RequirePermissions('obsidian.ver', 'tarefas.ver')
  pedidoDeTarefa(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('requestId') requestId: string) {
    return this.trabalho.porPedido(user.orgId, user.sub, id, requestId);
  }

  @Post(':id/tarefas')
  @RequirePermissions('obsidian.ver', 'tarefas.editar')
  criarTarefaDaVersao(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.trabalho.criar(user.orgId, user.sub, id, ContextoTarefaCreateSchema.parse(body));
  }

  @Post()
  @RequirePermissions('obsidian.editar')
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const dados = CriarSchema.parse(body);
    if (dados.chave.trim() === BRANDBOOK_CHAVE) throw new ForbiddenException('Crie o livro da marca pelo criador do brandbook.');
    if (ehChaveDaVault(dados.chave) || dados.sourceType === ContextSource.vault) {
      throw new ForbiddenException(FRASE_DO_PREFIXO);
    }
    return this.memoria.criar(user.orgId, dados);
  }

  /** RF-M-06: a resposta vira nota permanente com um gesto. */
  @Post('promover')
  @RequirePermissions('obsidian.editar')
  promover(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const dados = PromoverSchema.parse(body);
    if (dados.chave.trim() === BRANDBOOK_CHAVE) throw new ForbiddenException('Crie o livro da marca pelo criador do brandbook.');
    if (ehChaveDaVault(dados.chave)) throw new ForbiddenException(FRASE_DO_PREFIXO);
    return this.memoria.promover(user.orgId, dados);
  }

  @Patch(':id')
  @RequirePermissions('obsidian.editar')
  async alterar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const dados = AlterarSchema.parse(body);
    await this.exigirForaDaVault(user.orgId, id, user.sub);
    if (dados.sourceType === ContextSource.vault) throw new ForbiddenException(FRASE_DO_PREFIXO);
    return this.memoria.alterar(user.orgId, id, dados);
  }

  /*
   * ARQUIVAR, e não `DELETE` (ADR-011). O verbo da rota diz o que acontece:
   * `DELETE /memoria/:id` prometeria uma exclusão que não existe, e alguém
   * acabaria implementando a promessa.
   */
  @Post(':id/arquivar')
  @RequirePermissions('obsidian.editar')
  async arquivar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { motivo } = MotivoSchema.parse(body ?? {});
    await this.exigirForaDaVault(user.orgId, id, user.sub);
    return this.memoria.arquivar(user.orgId, id, motivo);
  }

  @Post(':id/restaurar')
  @RequirePermissions('obsidian.editar')
  async restaurar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { motivo } = MotivoSchema.parse(body ?? {});
    await this.exigirForaDaVault(user.orgId, id, user.sub);
    return this.memoria.restaurar(user.orgId, id, motivo);
  }
}
