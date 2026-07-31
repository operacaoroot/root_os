import { Injectable } from '@nestjs/common';
import { BioPlataforma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { cifrar, decifrar } from '../common/crypto';

export type Credencial = { appId: string; secret: string; origem: 'perfil' | 'global' | 'ambiente' };

/** Credenciais dos apps de plataforma (Instagram/TikTok), preenchidas pela tela. */
@Injectable()
export class BioCredenciaisService {
  constructor(private readonly prisma: PrismaService) {}

  /** Fallback de ambiente — para quem já tinha env configurado na VPS. */
  private doAmbiente(plataforma: BioPlataforma): Credencial | null {
    const appId =
      plataforma === 'instagram' ? process.env.INSTAGRAM_APP_ID : process.env.TIKTOK_CLIENT_KEY;
    const secret =
      plataforma === 'instagram'
        ? process.env.INSTAGRAM_APP_SECRET
        : process.env.TIKTOK_CLIENT_SECRET;
    if (!appId || !secret) return null;
    return { appId, secret, origem: 'ambiente' };
  }

  /**
   * Ordem: credencial do próprio perfil → credencial global da Root → ambiente.
   * Assim o normal é todo mundo usar o app da Root, e quem tiver motivo pra usar
   * o próprio app sobrescreve sem afetar ninguém.
   */
  async resolver(plataforma: BioPlataforma, orgId?: string): Promise<Credencial | null> {
    if (orgId) {
      const doPerfil = await this.prisma.bioCredencialApp.findFirst({ where: { plataforma, orgId } });
      if (doPerfil) {
        return { appId: doPerfil.appId, secret: decifrar(doPerfil.segredoCifrado), origem: 'perfil' };
      }
    }

    const global = await this.prisma.bioCredencialApp.findFirst({
      where: { plataforma, orgId: null },
    });
    if (global) {
      return { appId: global.appId, secret: decifrar(global.segredoCifrado), origem: 'global' };
    }

    return this.doAmbiente(plataforma);
  }

  async salvar(
    plataforma: BioPlataforma,
    orgId: string | null,
    appId: string,
    secret: string,
    quem: string,
  ): Promise<void> {
    const existente = await this.prisma.bioCredencialApp.findFirst({ where: { plataforma, orgId } });
    const dados = {
      appId: appId.trim(),
      segredoCifrado: cifrar(secret.trim()),
      atualizadaPor: quem,
    };

    if (existente) {
      await this.prisma.bioCredencialApp.update({ where: { id: existente.id }, data: dados });
    } else {
      await this.prisma.bioCredencialApp.create({ data: { plataforma, orgId, ...dados } });
    }
  }

  async remover(plataforma: BioPlataforma, orgId: string | null): Promise<void> {
    await this.prisma.bioCredencialApp.deleteMany({ where: { plataforma, orgId } });
  }

  /** Para a tela: o que está configurado, sem devolver segredo nenhum. */
  async estado(orgId?: string) {
    const linhas = await this.prisma.bioCredencialApp.findMany({
      where: { OR: [{ orgId: null }, ...(orgId ? [{ orgId }] : [])] },
      select: { plataforma: true, orgId: true, appId: true, atualizadaEm: true },
    });

    const ler = (plataforma: BioPlataforma) => {
      const doPerfil = linhas.find((l) => l.plataforma === plataforma && l.orgId);
      const global = linhas.find((l) => l.plataforma === plataforma && !l.orgId);
      const escolhida = doPerfil ?? global;
      const ambiente = this.doAmbiente(plataforma);
      return {
        plataforma,
        configurada: !!escolhida || !!ambiente,
        origem: doPerfil ? 'perfil' : global ? 'global' : ambiente ? 'ambiente' : null,
        // Só o prefixo: suficiente pra conferir se é o app certo, inútil pra copiar.
        appIdParcial: escolhida ? `${escolhida.appId.slice(0, 6)}…` : ambiente ? 'via ambiente' : null,
        atualizadaEm: escolhida?.atualizadaEm ?? null,
        temGlobal: !!global,
        temDoPerfil: !!doPerfil,
      };
    };

    return {
      items: [ler(BioPlataforma.instagram), ler(BioPlataforma.tiktok)],
      total: 2,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }
}
