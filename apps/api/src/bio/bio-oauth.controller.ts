import { Controller, Get, Logger, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BioPlataforma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { cifrar } from '../common/crypto';
import { BioCredenciaisService } from './bio-credenciais.service';
import * as instagram from './plataformas/instagram';
import * as tiktok from './plataformas/tiktok';

/**
 * Callback do OAuth de Instagram/TikTok — PÚBLICO (o browser é redirecionado
 * pela plataforma). O path é `/api/conectar/:plataforma/callback` de propósito:
 * é EXATAMENTE a redirect URI já registrada nos consoles da Meta e do TikTok
 * desde o root-bio standalone. Mudar isso exigiria novo App Review.
 */
@Controller('conectar')
export class BioOauthController {
  private readonly log = new Logger('BioOauth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly credenciais: BioCredenciaisService,
    private readonly audit: AuditService,
  ) {}

  private volta(res: Response, motivo: string) {
    const web = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000';
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
    if (erro) {
      // Usuário clicou "cancelar" na tela da plataforma — não é falha nossa.
      return this.volta(res, erro === 'access_denied' ? 'cancelado' : 'erro');
    }
    if (!codigo || !estado) return this.volta(res, 'erro');

    // O state é uso único e amarra a autorização à org que iniciou o fluxo.
    const registro = await this.prisma.bioOauthState.findUnique({ where: { estado } });
    if (!registro || registro.plataforma !== plataforma || registro.expiraEm < new Date()) {
      return this.volta(res, 'expirado');
    }
    await this.prisma.bioOauthState.delete({ where: { id: registro.id } }).catch(() => undefined);

    const cred = await this.credenciais.resolver(plataforma as BioPlataforma, registro.orgId);
    if (!cred) return this.volta(res, 'sem_credencial');

    try {
      let externalId: string;
      let handle: string;
      let token: string;
      let refresh: string | undefined;
      let expiraEm: Date | undefined;
      let escopos: string | undefined;

      if (plataforma === 'instagram') {
        const t = await instagram.trocarCodigo(codigo, cred);
        const p = await instagram.perfil(t.token);
        // Conta pessoal não tem API desde dez/2024 — recusar cedo, com motivo claro.
        if (p.account_type && !/BUSINESS|CREATOR|MEDIA_CREATOR/i.test(p.account_type)) {
          return this.volta(res, 'conta_pessoal');
        }
        externalId = String(p.user_id);
        handle = p.username;
        token = t.token;
        expiraEm = t.expiraEm;
        escopos = t.escopos;
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

      const dados = {
        handle,
        tokenCifrado: cifrar(token),
        refreshCifrado: refresh ? cifrar(refresh) : null,
        expiraEm,
        escopos,
        status: 'ok' as const,
        ultimoErro: null,
      };

      const conexao = await this.prisma.bioConexao.upsert({
        where: {
          orgId_plataforma_externalId: {
            orgId: registro.orgId,
            plataforma: plataforma as BioPlataforma,
            externalId,
          },
        },
        update: dados,
        create: {
          orgId: registro.orgId,
          plataforma: plataforma as BioPlataforma,
          externalId,
          ...dados,
        },
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
        after: { plataforma, handle },
      });

      return this.volta(res, 'ok');
    } catch (e) {
      this.log.error(`callback ${plataforma} falhou: ${(e as Error).message}`);
      return this.volta(res, 'erro');
    }
  }
}
