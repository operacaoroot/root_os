import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';

import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { ESPINHA, NIVEIS, PERFIS, ROTULO_DO_BLOCO, ROTULO_DO_NIVEL } from './espinha';
import { ORDEM_DAS_FASES, ROTULO_DA_FASE } from './fases';
import { LeituraDaAtaService, type FonteDaAta } from './leitura-da-ata.service';
import { REGUA_DO_LINK, SemDataError } from './mensagens';
import { RECEITAS } from './receitas';
import { MARCOS_MANUAIS, TrilhoService, type Quem } from './trilho.service';

/* ==========================================================================
 * A BANCADA — as rotas autenticadas do trilho
 * ==========================================================================
 *
 * Sob `tenants`, como a entrada: o onboarding fala do sistema e da esteira,
 * não de um módulo de negócio contratável, e o prefixo já é espinha do OS —
 * nenhuma linha em `modulos.ts`. As permissões são as da esteira de clientes
 * (`tarefas.ver` / `tarefas.editar`): quem move cartão na esteira é quem
 * opera o trilho.
 *
 * As rotas que chamam MODELO (ata, dossiê, roteiro) pedem `tarefas.editar` e
 * gastam em nome da empresa e do agente — o envelope do teto recusa quando o
 * dia fechou. Não há rota que mande WhatsApp: as mensagens saem prontas para
 * copiar.
 */

const DataOuVazio = z.string().trim().max(40).nullish();
const TextoCurto = z.string().trim().max(200).nullish();

const NovoTrilhoSchema = z.object({
  cliente: z.string().trim().min(2).max(120),
  contatoNome: TextoCurto,
  contatoWhatsapp: TextoCurto,
  contatoEmail: z.string().trim().email().max(200).nullish(),
  perfil: z.enum(PERFIS as [string, ...string[]]).nullish(),
  nivel: z.enum(NIVEIS as [string, ...string[]]).nullish(),
  receita: z.string().trim().max(80).nullish(),
  conduzidoPor: TextoCurto,
  implantadoPor: TextoCurto,
  reuniaoEm: DataOuVazio,
  cardId: z.string().uuid().nullish(),
  observacoes: z.string().trim().max(4000).nullish(),
});

const PessoaSchema = z
  .object({ nome: z.string().trim().min(1).max(120), papel: z.string().trim().max(120).optional(), contato: z.string().trim().max(200).optional() })
  .strict();

const PortoesSchema = z
  .object({
    triagemRespondidaEm: DataOuVazio,
    propostaEnviadaEm: DataOuVazio,
    entradaCompensadaEm: DataOuVazio,
    dupla: z.object({ donoPerguntas: PessoaSchema.optional(), guardiaoAcesso: PessoaSchema.optional() }).optional(),
    linhaDeBase: z
      .object({
        metrica: z.string().trim().min(1).max(200),
        valor: z.number().finite(),
        unidade: z.string().trim().max(40).optional(),
        medidoEm: z.string().trim().min(4).max(40),
        quemMediu: z.string().trim().min(1).max(120),
      })
      .optional(),
    ambienteOkEm: DataOuVazio,
    criterioDeSaida: z.object({ atingidoEm: z.string().trim().min(4).max(40), evidencia: z.string().trim().min(3).max(2000) }).optional(),
    medicaoDia30: z.object({ valor: z.number().finite(), medidoEm: z.string().trim().min(4).max(40), quemMediu: z.string().trim().min(1).max(120) }).optional(),
    antesDepois: z.object({ antes: z.number().finite(), depois: z.number().finite(), unidade: z.string().trim().max(40).optional(), registradoEm: z.string().trim().min(4).max(40) }).optional(),
    caseEm: DataOuVazio,
    mensalidadePropostaEm: DataOuVazio,
  })
  .partial();

const PatchSchema = NovoTrilhoSchema.partial().extend({
  kickoffEm: DataOuVazio,
  imersaoEm: DataOuVazio,
  grupoJid: z.string().trim().max(80).nullish(),
  empresaId: z.string().trim().max(80).nullish(),
  proximoPasso: z.string().trim().max(500).nullish(),
  proximoPassoDono: TextoCurto,
  proximoPassoEm: DataOuVazio,
  portoes: PortoesSchema.optional(),
});

const DecisaoSchema = z.object({
  decisao: z.enum(['aprovar', 'descartar', 'editar', 'desfazer']),
  texto: z.string().max(4000).nullish(),
});

const TextoSchema = z.object({ texto: z.string().min(1).max(4000) });

const AtaSchema = z.object({
  fonte: z.discriminatedUnion('tipo', [
    // O corpo JSON da API tem teto de 100 kB (express). Texto maior vai por `ata/arquivo`.
    z.object({ tipo: z.literal('texto'), texto: z.string().min(1).max(90_000), referencia: z.string().max(300).nullish() }),
    z.object({ tipo: z.literal('link'), url: z.string().trim().url().max(2000) }),
  ]),
  kickoffEm: DataOuVazio,
});

const DossieSchema = z.object({ fontePublica: z.string().max(40_000).nullish() });

const ConviteSchema = z.object({ blocos: z.enum(['A', 'BCD']) });

const BoasVindasSchema = z.object({
  passos: z.array(z.object({ texto: z.string().trim().min(2).max(300), data: z.string().trim().min(4).max(40).nullable(), dono: z.string().trim().max(120).nullish() })).min(1).max(12),
  root: z.array(z.string().trim().min(1).max(120)).min(1).max(5),
});

/**
 * Marco escrito por gente: tipo de uma LISTA FECHADA e `dados` só com
 * chaves-valor de texto. Tipo do sistema (`fase.avancou`, `dossie.gerado`…)
 * ou `dados` livres seriam forjar o que o código fez.
 */
const MarcoSchema = z.object({
  tipo: z.enum(MARCOS_MANUAIS as [string, ...string[]]),
  texto: z.string().trim().min(2).max(1000),
  dados: z.record(z.string().max(500)).optional(),
});

const MotivoSchema = z.object({ motivo: z.string().trim().min(4).max(1000) });

function quemDe(user: JwtUser): Quem {
  return { id: user.sub, nome: user.name || user.email || user.sub };
}

@Controller('tenants/onboarding/trilhos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TrilhosController {
  constructor(
    private readonly trilhos: TrilhoService,
    private readonly leitura: LeituraDaAtaService,
  ) {}

  // ------------------------------------------------------------ leituras

  /** `?cardId=` devolve só o trilho pendurado naquele cartão da esteira. */
  @Get()
  @RequirePermissions('tarefas.ver')
  listar(@CurrentUser() user: JwtUser, @Query('cardId') cardId?: string) {
    const filtro = typeof cardId === 'string' && /^[0-9a-f-]{36}$/i.test(cardId) ? { cardId } : {};
    return this.trilhos.listar(user.orgId, filtro);
  }

  @Get('pendencias')
  @RequirePermissions('tarefas.ver')
  pendencias(@CurrentUser() user: JwtUser) {
    return this.trilhos.pendencias(user.orgId);
  }

  /** O dado versionado que a tela precisa: espinha, fases, níveis, receitas, régua. */
  @Get('espinha')
  @RequirePermissions('tarefas.ver')
  espinha() {
    return {
      temas: ESPINHA.map((t) => ({
        id: t.id,
        bloco: t.bloco,
        blocoRotulo: ROTULO_DO_BLOCO[t.bloco],
        titulo: t.titulo,
        pergunta: t.pergunta,
        aprofundar: t.aprofundar,
        obrigatorio: t.obrigatorio,
        niveis: t.niveis ?? null,
        formato: t.formato,
        opcoes: t.opcoes ?? null,
      })),
      fases: ORDEM_DAS_FASES.map((f) => ({ fase: f, rotulo: ROTULO_DA_FASE[f] })),
      niveis: NIVEIS.map((n) => ({ nivel: n, rotulo: ROTULO_DO_NIVEL[n] })),
      perfis: PERFIS,
      receitas: RECEITAS,
      regua: REGUA_DO_LINK,
    };
  }

  @Get(':id')
  @RequirePermissions('tarefas.ver')
  obter(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.trilhos.obter(user.orgId, id);
  }

  @Get(':id/roteiro')
  @RequirePermissions('tarefas.ver')
  roteiro(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.trilhos.roteiro(user.orgId, id);
  }

  @Get(':id/folha')
  @RequirePermissions('tarefas.ver')
  folha(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.trilhos.folhaDeReuniao(user.orgId, id);
  }

  @Get(':id/retrato')
  @RequirePermissions('tarefas.ver')
  retrato(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.trilhos.retrato(user.orgId, id);
  }

  @Get(':id/convites/:conviteId/mensagens')
  @RequirePermissions('tarefas.ver')
  mensagens(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('conviteId') conviteId: string) {
    return this.trilhos.mensagensDoConvite(user.orgId, id, conviteId);
  }

  // ------------------------------------------------------------ escritas

  @Post()
  @RequirePermissions('tarefas.editar')
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.trilhos.criar(user.orgId, NovoTrilhoSchema.parse(body), quemDe(user));
  }

  @Patch(':id')
  @RequirePermissions('tarefas.editar')
  atualizar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.trilhos.atualizar(user.orgId, id, PatchSchema.parse(body), quemDe(user));
  }

  @Post(':id/avancar')
  @RequirePermissions('tarefas.editar')
  avancar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.trilhos.avancar(user.orgId, id, quemDe(user));
  }

  @Post(':id/encerrar')
  @RequirePermissions('tarefas.editar')
  encerrar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.trilhos.encerrar(user.orgId, id, MotivoSchema.parse(body).motivo, quemDe(user));
  }

  @Post(':id/itens/:temaId/decisao')
  @RequirePermissions('tarefas.editar')
  decidir(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('temaId') temaId: string, @Body() body: unknown) {
    const { decisao, texto } = DecisaoSchema.parse(body);
    return this.trilhos.decidirItem(user.orgId, id, temaId, decisao, texto ?? null, quemDe(user));
  }

  @Put(':id/itens/:temaId')
  @RequirePermissions('tarefas.editar')
  escrever(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('temaId') temaId: string, @Body() body: unknown) {
    return this.trilhos.escreverItem(user.orgId, id, temaId, TextoSchema.parse(body).texto, quemDe(user));
  }

  /** A ata como texto colado ou link. PDF e arquivo vão por `ata/arquivo`. */
  @Post(':id/ata')
  @RequirePermissions('tarefas.editar')
  ata(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { fonte, kickoffEm } = AtaSchema.parse(body);
    return this.leitura.lerAta(user.orgId, id, fonte as FonteDaAta, quemDe(user), kickoffEm ?? null);
  }

  /** A ata como arquivo: `.txt`/`.md` (lido como texto) ou `.pdf` (o modelo lê). */
  @Post(':id/ata/arquivo')
  @RequirePermissions('tarefas.editar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  ataArquivo(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { kickoffEm?: string },
    @Query('kickoffEm') kickoffDaQuery?: string,
  ) {
    if (!file) throw new BadRequestException('nenhum arquivo enviado (campo "file").');
    const nome = file.originalname || 'ata';
    const ehPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(nome);
    const fonte: FonteDaAta = ehPdf
      ? { tipo: 'pdf', base64: file.buffer.toString('base64'), nome }
      : { tipo: 'texto', texto: file.buffer.toString('utf8'), referencia: nome };
    // O multipart do navegador não leva JSON: a data vem na query (ou no campo, se alguém mandar).
    const bruto = kickoffDaQuery ?? body?.kickoffEm;
    const kickoffEm = typeof bruto === 'string' && bruto.trim() ? bruto.trim() : null;
    return this.leitura.lerAta(user.orgId, id, fonte, quemDe(user), kickoffEm);
  }

  @Post(':id/dossie')
  @RequirePermissions('tarefas.editar')
  dossie(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.leitura.gerarDossie(user.orgId, id, DossieSchema.parse(body ?? {}).fontePublica ?? null, quemDe(user));
  }

  @Post(':id/roteiro/personalizar')
  @RequirePermissions('tarefas.editar')
  personalizar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.leitura.personalizarRoteiro(user.orgId, id, quemDe(user));
  }

  @Post(':id/convites')
  @RequirePermissions('tarefas.editar')
  convite(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.trilhos.gerarConvite(user.orgId, id, ConviteSchema.parse(body).blocos, quemDe(user));
  }

  @Post(':id/convites/:conviteId/enviado')
  @RequirePermissions('tarefas.editar')
  enviado(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('conviteId') conviteId: string) {
    return this.trilhos.marcarEnviado(user.orgId, id, conviteId, quemDe(user));
  }

  @Post(':id/convites/:conviteId/revogar')
  @RequirePermissions('tarefas.editar')
  async revogar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('conviteId') conviteId: string) {
    await this.trilhos.revogarConvite(user.orgId, id, conviteId, quemDe(user));
    return { ok: true };
  }

  @Post(':id/boas-vindas')
  @RequirePermissions('tarefas.ver')
  async boasVindas(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { passos, root } = BoasVindasSchema.parse(body);
    const t = await this.trilhos.exigirTrilho(user.orgId, id);
    try {
      return { texto: this.trilhos.boasVindas(t, passos, root) };
    } catch (e) {
      if (e instanceof SemDataError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Post(':id/empresa')
  @RequirePermissions('tarefas.editar', 'admin.usuarios')
  provisionar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.trilhos.provisionarEmpresa(user.orgId, id, quemDe(user));
  }

  @Post(':id/memoria')
  @RequirePermissions('tarefas.editar')
  memoria(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.trilhos.carregarMemoria(user.orgId, id, quemDe(user));
  }

  /** Um marco escrito por gente: check semanal feito, dia 1 da imersão, retrospectiva… */
  @Post(':id/marcos')
  @RequirePermissions('tarefas.editar')
  async marco(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { tipo, texto, dados } = MarcoSchema.parse(body);
    await this.trilhos.exigirTrilho(user.orgId, id);
    await this.trilhos.marco(user.orgId, id, tipo, texto, dados ?? {}, quemDe(user));
    return { ok: true };
  }
}
