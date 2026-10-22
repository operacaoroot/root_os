import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CriarLeadDaPropostaSchema,
  PROPOSTA_JA_VINCULADA,
  VincularPropostaSchema,
  type ComoNasceuOVinculo,
  type ResultadoDoVinculo,
  type VinculoDaProposta,
  type VinculosDasPropostas,
} from '@mktos/shared';
import type { ZodType } from 'zod';

import { temPapelDeMaquina } from '../approvals/alcada';
import { lerAprovador } from '../auth/aprovador';
import { leadIdDaEntrada } from '../leads/entrada-de-lead';
import { LeadsService } from '../leads/leads.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { PrismaService } from '../prisma/prisma.service';
import { FichaService } from './ficha.service';
import { MoverService } from './mover.service';

/*
 * A PROPOSTA É DO LEAD (rodada de produção 3, I5, 22/10/2026).
 *
 * A tela Propostas mostra o lead como identidade da linha. A proposta do
 * serviço de propostas (as antigas da ROOT, fora do OS) não tinha vínculo
 * gravado: aqui a PESSOA grava o vínculo, de dois jeitos.
 *
 *   · Vincular a um lead: escolhe um lead da empresa. Vincular de novo ao mesmo
 *     lead não muda nada; a proposta já vinculada a outro lead é 409 com a frase.
 *   · Criar lead: o lead nasce pela MESMA entrada da tela (`LeadsService.entrada`,
 *     origem `manual` com a referência `proposta:<cliente>/<chave>`, a mesma que
 *     a tela usava antes, então o lead criado antes por ela é reaproveitado), ganha
 *     a ficha e vai a Qualificação pelo mover de gente (`MoverService`, o mesmo do
 *     funil, com o fato e a auditoria dele). A proposta fica ligada a ele.
 *
 * Só gente: a conta de máquina cai no `SoGenteGuard` (token) e aqui, na releitura
 * do banco (ativa, desta empresa, com `leads.editar` agora). Cada vínculo novo é
 * uma linha de auditoria. Nada vai à porta: nada sai do OS, nada se apaga.
 */

const RECUSA_DE_MAQUINA = 'Vincular proposta é de gente: conta de serviço (IA) não liga proposta a lead.';

type Quem = { id: string; nome: string | null; papeis: readonly string[]; permissoes: readonly string[] };
type Linha = { proposta: string; leadId: string; como: string; criadoEm: Date };

function paraDto(l: Linha): VinculoDaProposta {
  return { proposta: l.proposta, leadId: l.leadId, como: l.como === 'criada' ? 'criada' : 'vinculada', em: l.criadoEm.toISOString() };
}

function ler<T>(schema: ZodType<T>, corpo: unknown): T {
  const r = schema.safeParse(corpo);
  if (!r.success) throw new BadRequestException({ message: r.error.issues[0]?.message ?? 'Pedido inválido.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  return r.data;
}

/** A referência da entrada do lead criado pela proposta (a mesma que a tela usava antes). */
export function refDaEntradaDaProposta(proposta: string): string {
  return `proposta:${proposta.replace(/^servico:/, '')}`;
}

@Injectable()
export class PropostaDoLeadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly fichas: FichaService,
    private readonly mover: MoverService,
  ) {}

  /** Os vínculos gravados da empresa. Quem vê leads vê a quem cada proposta pertence. */
  async listar(orgId: string): Promise<VinculosDasPropostas> {
    const linhas = await this.prisma.propostaDoLead.findMany({
      where: { orgId },
      orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
      select: { proposta: true, leadId: true, como: true, criadoEm: true },
    });
    return { vinculos: linhas.map(paraDto) };
  }

  /** Gente de verdade, relida no banco: ativa, desta empresa, sem papel de máquina e com `leads.editar` agora. */
  private async exigirGente(orgId: string, quem: Quem): Promise<void> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem vincula precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    await exigirAcessoAtual(this.prisma, orgId, quem.id, ['leads.editar']);
  }

  /** Vincular a proposta a um lead que já existe na empresa. */
  async vincular(orgId: string, corpo: unknown, quem: Quem): Promise<ResultadoDoVinculo> {
    const e = ler(VincularPropostaSchema, corpo);
    await this.exigirGente(orgId, quem);
    const lead = await this.prisma.lead.findFirst({ where: { id: e.leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado nesta empresa.');
    return this.gravar(orgId, e.proposta, e.leadId, 'vinculada', quem.id);
  }

  /**
   * Criar o lead pela proposta: nasce em Qualificação com o nome dado e fica
   * ligado a ela. Repetir não cria outro (a entrada é idempotente pela proposta)
   * e não mexe na etapa de quem já andou.
   */
  async criarLead(orgId: string, corpo: unknown, quem: Quem): Promise<ResultadoDoVinculo> {
    const e = ler(CriarLeadDaPropostaSchema, corpo);
    await this.exigirGente(orgId, quem);
    const origem = { tipo: 'manual' as const, ref: refDaEntradaDaProposta(e.proposta) };
    const ja = await this.prisma.propostaDoLead.findFirst({ where: { orgId, proposta: e.proposta }, select: { proposta: true, leadId: true, como: true, criadoEm: true } });
    if (ja) {
      // Repetir o "Criar lead" da mesma proposta não muda nada; a proposta que já é de outro lead fica com ele.
      if (ja.leadId === leadIdDaEntrada(orgId, origem)) return { vinculo: paraDto(ja), mudou: false, leadCriado: false };
      throw new ConflictException({ message: PROPOSTA_JA_VINCULADA, leadId: ja.leadId });
    }
    const r = await this.leads.entrada({ sub: quem.id, orgId, permissions: [...quem.permissoes] }, { origem, nome: e.nome });
    const ficha = await this.fichas.garantir(orgId, r.id);
    if (ficha.etapa === 'novo_lead') {
      await this.mover.mover(orgId, r.id, { para: 'qualificacao' }, { id: quem.id, nome: quem.nome, papeis: quem.papeis });
    }
    const v = await this.gravar(orgId, e.proposta, r.id, 'criada', quem.id);
    return { ...v, leadCriado: r.criado };
  }

  /**
   * Grava o vínculo com a auditoria, numa transação. Idempotente: o mesmo lead
   * não muda nada; outro lead é 409. A corrida cai no índice único e é relida.
   */
  private async gravar(orgId: string, proposta: string, leadId: string, como: ComoNasceuOVinculo, por: string): Promise<ResultadoDoVinculo> {
    const sel = { proposta: true, leadId: true, como: true, criadoEm: true } as const;
    const decidir = (ja: Linha): ResultadoDoVinculo => {
      if (ja.leadId === leadId) return { vinculo: paraDto(ja), mudou: false };
      throw new ConflictException({ message: PROPOSTA_JA_VINCULADA, leadId: ja.leadId });
    };
    const ja = await this.prisma.propostaDoLead.findFirst({ where: { orgId, proposta }, select: sel });
    if (ja) return decidir(ja);
    try {
      const criado = await this.prisma.$transaction(async (tx) => {
        const v = await tx.propostaDoLead.create({ data: { orgId, proposta, leadId, como, vinculadoPor: por }, select: sel });
        await tx.auditLog.create({
          data: {
            orgId,
            actorId: por,
            action: como === 'criada' ? 'comercial.proposta.lead_criado' : 'comercial.proposta.vinculada',
            entityType: 'lead',
            entityId: leadId,
            after: { proposta, como },
          },
        });
        return v;
      });
      return { vinculo: paraDto(criado), mudou: true };
    } catch (erro) {
      if (!(erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002')) throw erro;
      const venceu = await this.prisma.propostaDoLead.findFirst({ where: { orgId, proposta }, select: sel });
      if (!venceu) throw new ConflictException('Conflito ao vincular a proposta; tente de novo.');
      return decidir(venceu);
    }
  }
}
