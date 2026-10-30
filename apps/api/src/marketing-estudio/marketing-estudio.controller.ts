import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  GerarPostSchema,
  MemoriaCapturaSchema,
  MemoriaDestinoSchema,
  MemoriaNotaCriarSchema,
  MemoriaNotaSalvarSchema,
  ReguaReferenciaSchema,
  ReguaSalvarSchema,
  TriagemDecisaoSchema,
  TriagemMontarSchema,
  TriagemRelerSchema,
  vaiParaIdeias,
  type MemoriaNota,
} from '@mktos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { MemoriaDoMarketingService } from './memoria-do-marketing.service';
import { TriagemService } from './triagem.service';
import { ReguasService } from './reguas.service';
import { ImportacaoDaComunidadeService } from './importacao-da-comunidade.service';
import { detectarFonte } from './deteccao-de-fonte';

// Marketing no jeito do ROOT Estúdio (26/10/2026): Memória, Triagem de ideias e Formatos.
// Mesmas permissões da Máquina: ver = pauta.ver, mexer = pauta.editar. Rotas fixas antes das com `:id`.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing/estudio')
export class MarketingEstudioController {
  constructor(
    private readonly memoria: MemoriaDoMarketingService,
    private readonly triagem: TriagemService,
    private readonly reguas: ReguasService,
    private readonly importacao: ImportacaoDaComunidadeService,
  ) {}

  // ---------- Memória ----------

  @Get('memoria')
  @RequirePermissions('pauta.ver')
  painel(
    @CurrentUser() u: JwtUser,
    @Query('q') q?: string,
    @Query('tag') tag?: string,
    @Query('pasta') pasta?: string,
    @Query('destino') destino?: string,
    @Query('assunto') assunto?: string,
  ) {
    return this.memoria.painel(u.orgId, { q, tag, pasta, destino, assunto });
  }

  @Get('memoria/grafo')
  @RequirePermissions('pauta.ver')
  grafo(@CurrentUser() u: JwtUser) {
    return this.memoria.grafo(u.orgId);
  }

  @Post('memoria/captura')
  @RequirePermissions('pauta.editar')
  capturar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.memoria.capturar(u.orgId, MemoriaCapturaSchema.parse(body).texto, 'app', u.name ?? u.sub);
  }

  @Post('memoria/drive/sincronizar')
  @RequirePermissions('pauta.editar')
  sincronizarDrive(@CurrentUser() u: JwtUser) {
    return this.memoria.sincronizarDrive(u.orgId);
  }

  @Post('memoria/notas')
  @RequirePermissions('pauta.editar')
  criarNota(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.memoria.criar(u.orgId, u.name ?? u.sub, MemoriaNotaCriarSchema.parse(body));
  }

  @Get('memoria/notas/:id')
  @RequirePermissions('pauta.ver')
  nota(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.memoria.nota(u.orgId, id);
  }

  @Put('memoria/notas/:id')
  @RequirePermissions('pauta.editar')
  salvarNota(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.memoria.salvar(u.orgId, id, MemoriaNotaSalvarSchema.parse(body));
  }

  @Delete('memoria/notas/:id')
  @RequirePermissions('pauta.editar')
  apagarNota(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.memoria.apagar(u.orgId, id);
  }

  @Post('memoria/notas/:id/tentar')
  @RequirePermissions('pauta.editar')
  tentar(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.memoria.tentarDeNovo(u.orgId, id);
  }

  // Para onde a nota vai: Ideia de conteúdo, Referência externa, as duas, ou de volta para decidir.
  // Mandar para Ideias já cria o card (com a IA quando ela responde). `comIa`: a IA escreveu (true),
  // o card saiu do resumo da nota (false), o card já existia ou a nota não foi para Ideias (null).
  @Post('memoria/notas/:id/destino')
  @HttpCode(200)
  @RequirePermissions('pauta.editar')
  async destino(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<{ nota: MemoriaNota; comIa: boolean | null }> {
    const nota = await this.memoria.decidir(u.orgId, id, u.name ?? u.sub, MemoriaDestinoSchema.parse(body));
    if (!vaiParaIdeias(nota.destino)) return { nota, comIa: null };
    const card = await this.triagem.cardDaNota(u.orgId, id);
    return { nota: { ...nota, ideia: { id: card.id, status: card.status } }, comIa: card.comIa };
  }

  // ---------- Triagem ----------

  @Get('triagem')
  @RequirePermissions('pauta.ver')
  triagemPainel(@CurrentUser() u: JwtUser) {
    return this.triagem.painel(u.orgId);
  }

  // O uso do mês no Apify (créditos grátis), para o cantinho da Memória e de Fontes.
  @Get('apify/uso')
  @RequirePermissions('pauta.ver')
  usoDoApify() {
    return this.memoria.usoDoApify();
  }

  // ---------- Fontes (o cadastro é o da Pauta: /pauta/fontes) ----------

  @Post('fontes/detectar')
  @HttpCode(200)
  @RequirePermissions('pauta.editar')
  detectar(@Body() body: { url?: string; nome?: string }) {
    return detectarFonte(String(body?.url ?? ''), body?.nome ? String(body.nome).slice(0, 120) : undefined);
  }

  @Get('fontes/pesos')
  @RequirePermissions('pauta.ver')
  pesos(@CurrentUser() u: JwtUser) {
    return this.triagem.pesosDasFontes(u.orgId);
  }

  @Get('triagem/base')
  @RequirePermissions('pauta.ver')
  base(@CurrentUser() u: JwtUser, @Query('q') q?: string, @Query('origem') origem?: string) {
    return this.triagem.base(u.orgId, q ?? '', origem ?? '');
  }

  @Post('triagem/montar')
  @HttpCode(200)
  @RequirePermissions('pauta.editar')
  montar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.triagem.montar(u.orgId, TriagemMontarSchema.parse(body ?? {}).quantas);
  }

  // Ver todas: os cards de um status (nova, aprovada, recusada, descartada_ia), sem a ordem de um por vez.
  @Get('triagem/todas')
  @RequirePermissions('pauta.ver')
  todas(@CurrentUser() u: JwtUser, @Query('status') status?: string) {
    return this.triagem.todas(u.orgId, status ?? 'nova');
  }

  // Reler com a IA: os cards pedidos ou, sem ids, todos os que nasceram com a IA fora do ar.
  @Post('triagem/reler')
  @HttpCode(200)
  @RequirePermissions('pauta.editar')
  reler(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.triagem.reler(u.orgId, TriagemRelerSchema.parse(body ?? {}).ids);
  }

  @Post('triagem/:id/decisao')
  @HttpCode(200)
  @RequirePermissions('pauta.editar')
  decidir(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.triagem.decidir(u.orgId, id, u.name ?? u.sub, TriagemDecisaoSchema.parse(body));
  }

  @Post('triagem/:id/desfazer')
  @HttpCode(200)
  @RequirePermissions('pauta.editar')
  desfazer(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.triagem.desfazer(u.orgId, id, u.name ?? u.sub);
  }

  // ---------- Formatos e geração ----------

  @Get('formatos')
  @RequirePermissions('pauta.ver')
  formatos(@CurrentUser() u: JwtUser) {
    return this.reguas.listar(u.orgId);
  }

  @Put('formatos/:formato')
  @RequirePermissions('pauta.editar')
  salvarRegua(@CurrentUser() u: JwtUser, @Param('formato') formato: string, @Body() body: unknown) {
    return this.reguas.salvar(u.orgId, formato, ReguaSalvarSchema.parse(body));
  }

  @Post('formatos/:formato/referencias')
  @RequirePermissions('pauta.editar')
  referencia(@CurrentUser() u: JwtUser, @Param('formato') formato: string, @Body() body: unknown) {
    return this.reguas.adicionarReferencia(u.orgId, formato, ReguaReferenciaSchema.parse(body));
  }

  @Delete('formatos/:formato/referencias/:ref')
  @RequirePermissions('pauta.editar')
  tirarReferencia(@CurrentUser() u: JwtUser, @Param('formato') formato: string, @Param('ref', ParseUUIDPipe) ref: string) {
    return this.reguas.removerReferencia(u.orgId, formato, ref);
  }

  @Post('formatos/:formato/extrair')
  @HttpCode(200)
  @RequirePermissions('pauta.editar')
  extrair(@CurrentUser() u: JwtUser, @Param('formato') formato: string) {
    return this.reguas.extrair(u.orgId, formato);
  }

  @Post('posts/:id/gerar')
  @HttpCode(200)
  @RequirePermissions('pauta.editar')
  gerar(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.reguas.gerarPost(u.orgId, id, u.name ?? u.sub, GerarPostSchema.parse(body ?? {}).instrucao);
  }

  @Post('comunidade/importar')
  @HttpCode(200)
  @RequirePermissions('pauta.editar')
  async importar(@CurrentUser() u: JwtUser) {
    const r = await this.reguas.importarComunidade(u.orgId, u.name ?? u.sub);
    // A primeira importação pela tela liga a de hora em hora (só cria se faltar; pausa em /rotinas).
    await this.importacao.garantirRotina(u.orgId);
    return r;
  }
}
