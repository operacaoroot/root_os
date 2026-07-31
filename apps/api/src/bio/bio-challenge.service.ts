import { Injectable, NotFoundException } from '@nestjs/common';
import { BioPlataforma } from '@prisma/client';
import type { BioChallengeAccountInput, BioChallengeInput, BioPublicDesafio } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DIA = 86_400_000;

export interface EstadoDesafio {
  id: string;
  titulo: string;
  contagem: number;
  meta: number;
  inicio: Date;
  fim: Date;
  diaAtual: number;
  diasTotais: number;
  diasRestantes: number;
  progresso: number; // 0–100, da meta
  esperado: number; // quantos posts deveria ter hoje, no ritmo linear
  saldo: number; // contagem - esperado. positivo = adiantado
  porDia: number; // quanto precisa por dia pra fechar
  encerrado: boolean;
  contas: {
    id: string;
    plataforma: string;
    handle: string;
    modo: string;
    status: string;
    conexaoId: string | null;
    ultimaColeta: Date | null;
    ultimoErro: string | null;
    contagem: number;
  }[];
}

@Injectable()
export class BioChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private diasEntre(a: Date, b: Date) {
    return Math.max(1, Math.round((b.getTime() - a.getTime()) / DIA));
  }

  /**
   * Contagem por conta: preferimos COUNT dos posts que guardamos (fonte da
   * verdade nossa). Se a conta ainda não tem post gravado — caso do modo manual —
   * caímos no último snapshot bom.
   */
  private async contagemPorConta(contaId: string, inicio: Date, fim: Date) {
    const posts = await this.prisma.bioChallengePost.count({
      where: { contaId, sumiuEm: null, publicadoEm: { gte: inicio, lte: fim } },
    });
    if (posts > 0) return posts;

    const snap = await this.prisma.bioChallengeSnapshot.findFirst({
      where: { contaId, ok: true },
      orderBy: { coletadoEm: 'desc' },
    });
    return snap?.countNaJanela ?? 0;
  }

  async estado(pageId: string): Promise<EstadoDesafio | null> {
    const desafio = await this.prisma.bioChallenge.findFirst({
      where: { pageId },
      include: { contas: true },
      orderBy: { criadoEm: 'desc' },
    });
    if (!desafio) return null;

    const contas = await Promise.all(
      desafio.contas.map(async (c) => ({
        id: c.id,
        plataforma: c.plataforma as string,
        handle: c.handle,
        modo: c.modo as string,
        status: c.status as string,
        conexaoId: c.conexaoId,
        ultimaColeta: c.ultimaColeta,
        ultimoErro: c.ultimoErro,
        contagem: await this.contagemPorConta(c.id, desafio.inicio, desafio.fim),
      })),
    );

    const contagem = contas.reduce((s, c) => s + c.contagem, 0);
    const agora = new Date();
    const diasTotais = this.diasEntre(desafio.inicio, desafio.fim);
    const decorridos = Math.round((agora.getTime() - desafio.inicio.getTime()) / DIA);
    const diaAtual = Math.min(Math.max(decorridos + 1, 1), diasTotais);
    const diasRestantes = Math.max(0, diasTotais - diaAtual);
    const encerrado = agora > desafio.fim;

    const esperado = Math.round((desafio.metaPosts * diaAtual) / diasTotais);
    const faltam = Math.max(0, desafio.metaPosts - contagem);

    return {
      id: desafio.id,
      titulo: desafio.titulo,
      contagem,
      meta: desafio.metaPosts,
      inicio: desafio.inicio,
      fim: desafio.fim,
      diaAtual,
      diasTotais,
      diasRestantes,
      progresso: Math.min(100, Math.round((contagem / Math.max(1, desafio.metaPosts)) * 1000) / 10),
      esperado,
      saldo: contagem - esperado,
      porDia: diasRestantes > 0 ? Math.ceil(faltam / diasRestantes) : faltam,
      encerrado,
      contas,
    };
  }

  /** Recorte do estado que a página pública exibe (sem dados de conta/erro). */
  async estadoPublico(pageId: string): Promise<BioPublicDesafio | null> {
    const desafio = await this.prisma.bioChallenge.findFirst({
      where: { pageId, exibir: true },
      orderBy: { criadoEm: 'desc' },
    });
    if (!desafio) return null;

    const e = await this.estado(pageId);
    if (!e || e.id !== desafio.id) return null;

    return {
      titulo: e.titulo,
      feitos: e.contagem,
      meta: e.meta,
      diaAtual: e.diaAtual,
      totalDias: e.diasTotais,
      pctFeito: e.progresso,
      pctTempo: Math.round((e.diaAtual / e.diasTotais) * 1000) / 10,
      ritmoNecessario: e.porDia,
      saldo: e.saldo,
    };
  }

  private async pageDaOrg(orgId: string, pageId: string) {
    const page = await this.prisma.bioPage.findFirst({ where: { id: pageId, orgId } });
    if (!page) throw new NotFoundException('página não encontrada');
    return page;
  }

  private async desafioDaOrg(orgId: string, challengeId: string) {
    const d = await this.prisma.bioChallenge.findFirst({ where: { id: challengeId, orgId } });
    if (!d) throw new NotFoundException('desafio não encontrado');
    return d;
  }

  async salvar(orgId: string, input: BioChallengeInput, actorId: string) {
    await this.pageDaOrg(orgId, input.pageId);
    const dados = {
      titulo: input.titulo,
      inicio: new Date(input.inicio),
      fim: new Date(input.fim),
      metaPosts: input.metaPosts,
      exibir: input.exibir,
    };

    const desafio = input.id
      ? await this.prisma.bioChallenge.update({
          where: { id: (await this.desafioDaOrg(orgId, input.id)).id },
          data: dados,
        })
      : await this.prisma.bioChallenge.create({
          data: { orgId, pageId: input.pageId, ...dados },
        });

    await this.audit.log({
      orgId,
      actorId,
      action: input.id ? 'bio.challenge_update' : 'bio.challenge_create',
      entityType: 'BioChallenge',
      entityId: desafio.id,
      after: dados as never,
    });
    return desafio;
  }

  async adicionarConta(orgId: string, input: BioChallengeAccountInput, actorId: string) {
    await this.desafioDaOrg(orgId, input.challengeId);
    const handle = input.handle.trim().replace(/^@/, '').toLowerCase();

    // Se já existe conexão OAuth para esse @, a conta nasce conectada.
    const conexao = input.conexaoId
      ? await this.prisma.bioConexao.findFirst({ where: { id: input.conexaoId, orgId } })
      : await this.prisma.bioConexao.findFirst({
          where: { orgId, plataforma: input.plataforma as BioPlataforma, handle },
        });

    const conta = await this.prisma.bioChallengeAccount.upsert({
      where: {
        challengeId_plataforma_handle: {
          challengeId: input.challengeId,
          plataforma: input.plataforma as BioPlataforma,
          handle,
        },
      },
      update: {
        modo: conexao ? 'conectado' : input.modo,
        conexaoId: conexao?.id ?? null,
        baselineCount: input.baselineCount,
      },
      create: {
        challengeId: input.challengeId,
        plataforma: input.plataforma as BioPlataforma,
        handle,
        modo: conexao ? 'conectado' : input.modo,
        conexaoId: conexao?.id ?? null,
        baselineCount: input.baselineCount,
        baselineEm: input.baselineCount > 0 ? new Date() : null,
      },
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'bio.challenge_account_add',
      entityType: 'BioChallengeAccount',
      entityId: conta.id,
      after: { plataforma: conta.plataforma, handle: conta.handle, modo: conta.modo },
    });
    return conta;
  }

  async contaDaOrg(orgId: string, contaId: string) {
    const conta = await this.prisma.bioChallengeAccount.findFirst({
      where: { id: contaId, challenge: { orgId } },
      include: { challenge: true },
    });
    if (!conta) throw new NotFoundException('conta não encontrada');
    return conta;
  }

  async removerConta(orgId: string, contaId: string, actorId: string) {
    const conta = await this.contaDaOrg(orgId, contaId);
    await this.prisma.bioChallengeAccount.delete({ where: { id: conta.id } });
    await this.audit.log({
      orgId,
      actorId,
      action: 'bio.challenge_account_remove',
      entityType: 'BioChallengeAccount',
      entityId: contaId,
      before: { plataforma: conta.plataforma, handle: conta.handle },
    });
    return { ok: true };
  }

  /** Contagem manual entra como snapshot. Append-only: nunca sobrescreve o anterior. */
  async contagemManual(orgId: string, contaId: string, contagem: number, actorId: string) {
    const conta = await this.contaDaOrg(orgId, contaId);
    const snap = await this.prisma.bioChallengeSnapshot.create({
      data: { contaId: conta.id, countNaJanela: contagem, ok: true, bruto: { origem: 'manual' } },
    });
    await this.prisma.bioChallengeAccount.update({
      where: { id: conta.id },
      data: { ultimaColeta: new Date(), status: 'ok', ultimoErro: null },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'bio.challenge_manual_count',
      entityType: 'BioChallengeAccount',
      entityId: conta.id,
      after: { contagem },
    });
    return snap;
  }
}
