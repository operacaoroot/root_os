import { Controller, Get, Logger, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BioFinalidade, BioPlataforma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { cifrar } from '../common/crypto';
import { comTenantPublico, resolverTenantDoEstadoBio } from '../common/tenant-publico';
import { BioCredenciaisService } from './bio-credenciais.service';
import { estadoBemFormado, finalidadeDaConexao } from './finalidade-da-conexao';
import * as instagram from './plataformas/instagram';
import * as tiktok from './plataformas/tiktok';

/**
 * Callback do OAuth de Instagram/TikTok — PÚBLICO (o browser é redirecionado
 * pela plataforma). O path é `/api/conectar/:plataforma/callback` de propósito:
 * é EXATAMENTE a redirect URI já registrada nos consoles da Meta e do TikTok
 * desde o root-bio standalone. Mudá-la obriga a recadastrar nos dois consoles
 * e a refazer toda conexão; a pesquisa da onda D não achou fonte de que exija
 * App Review novo (docs/especificacoes/MD-onda-d-automacao.md).
 *
 * A conta de publicação (MD5) volta pelo MESMO endereço: a finalidade viaja no
 * `state`, e o retorno vai para a aba Semana da Pauta em vez da bio.
 */
@Controller('conectar')
export class BioOauthController {
  private readonly log = new Logger('BioOauth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly credenciais: BioCredenciaisService,
    private readonly audit: AuditService,
  ) {}

  private volta(res: Response, motivo: string, finalidade: BioFinalidade = 'bio') {
    const web = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000';
    if (finalidade === 'publicacao') return res.redirect(`${web}/pauta?aba=semana&conexao=${motivo}`);
    return res.redirect(`${web}/bio?conexao=${motivo}`);
  }

  @Get(':plataforma/callback')
  async callback(
    @Param('plataforma') plataforma: string,
    @Query('code') codigo: string,
    @Query('state') estado: string,
    @Query('error') erro: string,
    @Res() res: Response,
  ) {
    if (plataforma !== 'instagram' && plataforma !== 'tiktok') return this.volta(res, 'erro');
    // O state vem de fora: fora do formato que a rota gera, nem chega ao banco.
    const estadoValido = estadoBemFormado(estado);
    if (!estadoValido) return this.volta(res, erro ? (erro === 'access_denied' ? 'cancelado' : 'erro') : 'expirado');
    if (!erro && !codigo) return this.volta(res, 'erro');
    if (!erro && (typeof codigo !== 'string' || codigo.length > 2048)) return this.volta(res, 'expirado');
    const endereco = await resolverTenantDoEstadoBio(this.prisma, estado);
    if (!endereco) return this.volta(res, 'expirado');
    return comTenantPublico(endereco.orgId, async () => {
      const registro = await this.prisma.bioOauthState.findFirst({ where: { id: endereco.id, orgId: endereco.orgId, estado } });
      if (!registro) return this.volta(res, 'expirado');
      // Consumir também cancelamento/vencimento. Somente o vencedor pode chamar o provedor.
      const { count } = await this.prisma.bioOauthState.deleteMany({
        where: { id: registro.id, orgId: endereco.orgId, estado, plataforma: registro.plataforma, expiraEm: registro.expiraEm },
      });
      if (count !== 1 || registro.plataforma !== plataforma || registro.expiraEm <= new Date()) {
        return this.volta(res, 'expirado', registro.finalidade);
      }
      if (erro) return this.volta(res, erro === 'access_denied' ? 'cancelado' : 'erro', registro.finalidade);
      const pedida = registro.finalidade;

      const cred = await this.credenciais.resolver(plataforma as BioPlataforma, registro.orgId);
      if (!cred) return this.volta(res, 'sem_credencial', pedida);

      try {
        let externalId: string;
        let handle: string;
        let token: string;
        let refresh: string | undefined;
        let expiraEm: Date | undefined;
        let escopos: string | undefined;
        let concedidos: string[] | null = null;

        if (plataforma === 'instagram') {
          const t = await instagram.trocarCodigo(codigo, cred);
          const p = await instagram.perfil(t.token);
          // Conta pessoal não tem API desde dez/2024 — recusar cedo, com motivo claro.
          if (p.account_type && !/BUSINESS|CREATOR|MEDIA_CREATOR/i.test(p.account_type)) {
            return this.volta(res, 'conta_pessoal', pedida);
          }
          externalId = String(p.user_id);
          handle = p.username;
          token = t.token;
          expiraEm = t.expiraEm;
          concedidos = t.concedidos;
          // Sem a lista da Meta, a bio presume o que pediu (como sempre fez); a
          // publicação não presume nada — ver `finalidadeDaConexao`.
          escopos = (t.concedidos ?? instagram.ESCOPOS).join(',');
        } else {
          const t = await tiktok.trocarCodigo(codigo, registro.verifier ?? '', cred);
          const p = await tiktok.perfil(t.token);
          externalId = t.externalId ?? p.externalId;
          handle = p.handle;
          token = t.token;
          refresh = t.refresh;
          expiraEm = t.expiraEm;
          escopos = t.escopos;
        }

        const chave = {
          orgId: registro.orgId,
          plataforma: plataforma as BioPlataforma,
          externalId,
        };
        const anterior = await this.prisma.bioConexao.findUnique({
          where: { orgId_plataforma_externalId: chave },
          select: { finalidade: true },
        });
        const { finalidade, aviso } =
          plataforma === 'instagram'
            ? finalidadeDaConexao({ pedida, anterior: anterior?.finalidade ?? null, concedidos })
            : { finalidade: 'bio' as const, aviso: null };
        if (aviso === 'publicacao_mantida') {
          await this.audit.log({
            orgId: registro.orgId,
            action: 'bio.conexao_mantida',
            entityType: 'BioConexao',
            entityId: externalId,
            after: { plataforma, handle, finalidadePedida: pedida, motivo: 'a conta de publicação não muda pela bio' },
          });
          return this.volta(res, aviso, pedida);
        }

        const dados = {
          handle,
          tokenCifrado: cifrar(token),
          refreshCifrado: refresh ? cifrar(refresh) : null,
          expiraEm,
          escopos,
          finalidade,
          status: 'ok' as const,
          ultimoErro: null,
        };

        // Uma conta de publicação por empresa e plataforma: a que existia, de
        // outro @, volta a ser só da bio na mesma transação. O índice único
        // parcial segura duas autorizações simultâneas.
        const { conexao, rebaixadas } = await this.prisma.$transaction(async (tx) => {
          const trocadas =
            finalidade === 'publicacao'
              ? await tx.bioConexao.findMany({
                  where: {
                    orgId: registro.orgId,
                    plataforma: plataforma as BioPlataforma,
                    finalidade: 'publicacao',
                    NOT: { externalId },
                  },
                  select: { id: true, handle: true },
                })
              : [];
          if (trocadas.length) {
            await tx.bioConexao.updateMany({
              where: { id: { in: trocadas.map((t) => t.id) } },
              data: { finalidade: 'bio' },
            });
          }
          const gravada = await tx.bioConexao.upsert({
            where: { orgId_plataforma_externalId: chave },
            update: dados,
            create: { ...chave, ...dados },
          });
          return { conexao: gravada, rebaixadas: trocadas.map((t) => t.handle) };
        });

        // Liga automaticamente às contas do desafio que já apontam pra esse @.
        await this.prisma.bioChallengeAccount.updateMany({
          where: {
            plataforma: plataforma as BioPlataforma,
            challenge: { orgId: registro.orgId },
            OR: [{ handle: handle.toLowerCase() }, { conexaoId: conexao.id }],
          },
          data: { conexaoId: conexao.id, modo: 'conectado', externalId, status: 'ok' },
        });

        await this.audit.log({
          orgId: registro.orgId,
          action: 'bio.conexao_create',
          entityType: 'BioConexao',
          entityId: conexao.id,
          before: anterior ? { finalidade: anterior.finalidade } : undefined,
          after: {
            plataforma,
            handle,
            finalidadePedida: pedida,
            finalidade,
            escopos: escopos ?? null,
            ...(rebaixadas.length ? { deixaramDePublicar: rebaixadas } : {}),
          },
        });

        return this.volta(res, aviso ?? 'ok', pedida);
      } catch (e) {
        this.log.error(`callback ${plataforma} falhou: ${(e as Error).message}`);
        return this.volta(res, 'erro', pedida);
      }
    });
  }
}
