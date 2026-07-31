import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { cifrar, decifrar, temChaveDeCriptografia } from '../common/crypto';
import { BioCredenciaisService } from './bio-credenciais.service';
import * as instagram from './plataformas/instagram';
import * as tiktok from './plataformas/tiktok';

const RENOVAR_ANTES_DE_DIAS = 10;

export interface ResultadoSync {
  contaId: string;
  ok: boolean;
  novos?: number;
  total?: number;
  erro?: string;
}

@Injectable()
export class BioSyncService implements OnModuleInit {
  private readonly log = new Logger('BioSync');

  constructor(
    private readonly prisma: PrismaService,
    private readonly credenciais: BioCredenciaisService,
  ) {}

  // Sync AGENDADO (in-process), no padrão dos outros conectores da casa.
  // BIO_SYNC_INTERVAL_MIN (default 360; 0 desliga). Primeira ~25s após o boot.
  // Além de atualizar o número, é o que mantém o token do Instagram vivo — ele
  // morre de vez se ficar 60 dias sem uso.
  onModuleInit(): void {
    if (!temChaveDeCriptografia()) {
      this.log.warn('ENCRYPTION_KEY ausente — sync do bio desligado');
      return;
    }
    const min = Number(process.env.BIO_SYNC_INTERVAL_MIN ?? 360);
    if (!(min > 0)) return;

    const run = async () => {
      try {
        const r = await this.sincronizarTudo();
        const ok = r.filter((x) => x.ok).length;
        if (r.length) this.log.log(`sync agendado: ${ok}/${r.length} conta(s) ok`);
      } catch (e) {
        this.log.warn(`sync agendado falhou: ${(e as Error).message}`);
      }
    };
    setTimeout(run, 25_000);
    setInterval(run, min * 60_000);
    this.log.log(`Bio sync agendado a cada ${min} min`);
  }

  /**
   * Devolve um token válido, renovando se estiver perto de vencer.
   */
  private async tokenValido(conexao: {
    id: string;
    orgId: string;
    plataforma: string;
    tokenCifrado: string;
    refreshCifrado: string | null;
    expiraEm: Date | null;
  }): Promise<string> {
    const token = decifrar(conexao.tokenCifrado);
    const vencePerto =
      conexao.expiraEm &&
      conexao.expiraEm.getTime() - Date.now() < RENOVAR_ANTES_DE_DIAS * 86_400_000;

    if (!vencePerto) return token;

    if (conexao.plataforma === 'instagram') {
      // A renovação do Instagram usa só o token — não precisa da credencial do app.
      const novo = await instagram.renovar(token);
      await this.prisma.bioConexao.update({
        where: { id: conexao.id },
        data: { tokenCifrado: cifrar(novo.token), expiraEm: novo.expiraEm },
      });
      return novo.token;
    }

    if (conexao.refreshCifrado) {
      const cred = await this.credenciais.resolver('tiktok', conexao.orgId);
      if (!cred) throw new Error('credencial do app TikTok não configurada');
      const novo = await tiktok.renovar(decifrar(conexao.refreshCifrado), cred);
      await this.prisma.bioConexao.update({
        where: { id: conexao.id },
        data: {
          tokenCifrado: cifrar(novo.token),
          refreshCifrado: novo.refresh ? cifrar(novo.refresh) : conexao.refreshCifrado,
          expiraEm: novo.expiraEm,
        },
      });
      return novo.token;
    }

    return token;
  }

  /**
   * Puxa os posts da janela do desafio e grava UM REGISTRO POR POST.
   * A contagem vira COUNT nosso: post apagado não zera o histórico em silêncio,
   * indisponibilidade da API não vira buraco, e dá pra mostrar a timeline depois.
   */
  async sincronizarConta(contaId: string): Promise<ResultadoSync> {
    const conta = await this.prisma.bioChallengeAccount.findUnique({
      where: { id: contaId },
      include: { challenge: true, conexao: true },
    });
    if (!conta) return { contaId, ok: false, erro: 'conta não encontrada' };
    if (!conta.conexao) return { contaId, ok: false, erro: 'conta sem conexão — modo manual' };

    try {
      const token = await this.tokenValido(conta.conexao);
      const desde = conta.challenge.inicio;

      const posts =
        conta.plataforma === 'instagram'
          ? await instagram.midiasDesde(token, desde)
          : await tiktok.videosDesde(token, desde);

      const dentro = posts.filter(
        (p) => p.publicadoEm >= desde && p.publicadoEm <= conta.challenge.fim,
      );

      const jaConhecidos = new Set(
        (
          await this.prisma.bioChallengePost.findMany({
            where: { contaId, externalId: { in: dentro.map((p) => p.externalId) } },
            select: { externalId: true },
          })
        ).map((p) => p.externalId),
      );
      const novos = dentro.filter((p) => !jaConhecidos.has(p.externalId)).length;

      for (const p of dentro) {
        await this.prisma.bioChallengePost.upsert({
          where: { contaId_externalId: { contaId, externalId: p.externalId } },
          update: { vistoEm: new Date(), sumiuEm: null },
          create: {
            contaId,
            externalId: p.externalId,
            publicadoEm: p.publicadoEm,
            permalink: p.permalink,
            tipo: 'tipo' in p ? (p as { tipo?: string }).tipo : undefined,
          },
        });
      }

      // Post que sumiu da API fica marcado, não é apagado: o histórico é nosso.
      const vistosAgora = new Set(dentro.map((p) => p.externalId));
      const guardados = await this.prisma.bioChallengePost.findMany({
        where: { contaId, sumiuEm: null },
        select: { id: true, externalId: true },
      });
      const sumidos = guardados.filter((g) => !vistosAgora.has(g.externalId)).map((g) => g.id);
      if (sumidos.length > 0) {
        await this.prisma.bioChallengePost.updateMany({
          where: { id: { in: sumidos } },
          data: { sumiuEm: new Date() },
        });
      }

      const total = await this.prisma.bioChallengePost.count({ where: { contaId, sumiuEm: null } });

      await this.prisma.bioChallengeSnapshot.create({
        data: {
          contaId,
          countNaJanela: total,
          ok: true,
          bruto: { origem: conta.plataforma, coletados: dentro.length, sumidos: sumidos.length },
        },
      });
      await this.prisma.bioChallengeAccount.update({
        where: { id: contaId },
        data: { ultimaColeta: new Date(), status: 'ok', ultimoErro: null },
      });

      return { contaId, ok: true, novos, total };
    } catch (erro) {
      const msg = String(erro).slice(0, 400);
      const expirado = /oauth|token|401|expired/i.test(msg);

      await this.prisma.bioChallengeSnapshot.create({
        data: { contaId, ok: false, erro: msg, bruto: { origem: conta.plataforma } },
      });
      await this.prisma.bioChallengeAccount.update({
        where: { id: contaId },
        data: { status: expirado ? 'token_expirado' : 'erro', ultimoErro: msg },
      });
      if (expirado && conta.conexaoId) {
        await this.prisma.bioConexao.update({
          where: { id: conta.conexaoId },
          data: { status: 'token_expirado', ultimoErro: msg },
        });
      }

      this.log.error(`sync da conta ${contaId} falhou: ${msg}`);
      return { contaId, ok: false, erro: msg };
    }
  }

  /** Todas as contas conectadas de desafios vigentes (opcionalmente de uma org). */
  async sincronizarTudo(orgId?: string): Promise<ResultadoSync[]> {
    const contas = await this.prisma.bioChallengeAccount.findMany({
      where: {
        conexaoId: { not: null },
        challenge: { fim: { gte: new Date() }, ...(orgId ? { orgId } : {}) },
      },
      select: { id: true },
    });
    const resultados: ResultadoSync[] = [];
    for (const c of contas) resultados.push(await this.sincronizarConta(c.id));
    return resultados;
  }
}
