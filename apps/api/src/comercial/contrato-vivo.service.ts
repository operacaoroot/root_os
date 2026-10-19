import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { classificar, type Efeito } from '@mktos/policy';
import {
  TABELA_DE_PRECO, type ComercialProduto, type ContratoEncerrarInput, type ContratoVivo, type SituacaoDoContrato,
} from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { DecisoesService } from './decisoes.service';
import { hojeEmSP } from './dinheiro.service';
import { FioService } from './fio.service';
import { saudeDoLead } from './proxima-acao';
import { RelogioComercialRegistry } from './relogio.registry';

/*
 * O CONTRATO VIVO E A RÉGUA DE COBRANÇA (lane D, 13/10/2026) — tela 11.
 *
 * O contrato não some depois de assinado: vira parcelas, régua de cobrança,
 * entregas, saúde e marcos. Tudo aqui é LEITURA do que já está no banco, mais
 * duas tarefas do relógio comercial (`RelogioComercialRegistry`):
 *
 *   · `dinheiro.regua`: para cada parcela em aberto, os avisos D-3, D0, D+1,
 *     D+5 e D+10 (`parcela.vence`; do D+1 em diante também `parcela.atrasada`).
 *     D+10 abre uma decisão na fila (`excecao_do_vigia`, padrão "aguardar").
 *     A chave do fato é `(parcela, aviso)`: a mesma passagem, ou a seguinte no
 *     mesmo dia, não repete. Passagem perdida não perde o aviso: vale o degrau
 *     mais recente já alcançado e ainda não dado.
 *   · `dinheiro.marcos`: `dia_15_indicacao` (15 dias depois do cliente ativo)
 *     e `d_30_continuidade` (30 dias antes do último vencimento), uma vez cada.
 *
 * OS TEXTOS DOS AVISOS AO CLIENTE (lembrete, novo Pix) NÃO existem entre M1 e
 * M8: são [a decidir] pela mesa. A régua grava o fato e a fila mostra; nenhuma
 * mensagem é inventada.
 */

const DIA_MS = 86_400_000;

/*
 * ENCERRAR O CONTRATO À MÃO (rodada do trabalho T8, 19/10/2026). O Rodrigo
 * decidiu: alguém da casa move o contrato para concluído ou desativado quando
 * ele termina. O nível sai do EFEITO pela escada (`classificar`): a escrita fica
 * dentro do OS (um fato no fio e uma linha na auditoria), não cancela cobrança
 * no Asaas, não manda nada para fora, então dá R0. Escrita interna com R0/R1 é
 * gate de papel (`leads.editar`) com auditoria, como o Trabalho. Se um dia o
 * efeito mudar (por exemplo, passar a cancelar a cobrança), a conta sobe sozinha
 * e esta rota recusa até a capacidade entrar pelo catálogo.
 */
export const EFEITO_DE_ENCERRAR_CONTRATO: Efeito = {
  escreveForaDoOS: false,
  produzArtefato: false,
  reversibilidade: 'automatica',
  exposicaoExterna: false,
  impactoFinanceiro: 'nenhum',
  sensibilidade: 'interna',
  destruicao: false,
  obrigacaoLegal: false,
};

const PAPEIS_DE_MAQUINA = ['ia_servico', 'ia_acao'];

/** Ativos primeiro, depois em implantação, e concluídos e desativados sempre por último. */
const ORDEM_DA_SITUACAO: Record<SituacaoDoContrato, number> = { ativo: 0, em_implantacao: 1, concluido: 2, desativado: 3 };
export function ordenarContratos(lista: ContratoVivo[]): ContratoVivo[] {
  return [...lista].sort((a, b) => ORDEM_DA_SITUACAO[a.situacao] - ORDEM_DA_SITUACAO[b.situacao] || a.cliente.localeCompare(b.cliente, 'pt-BR'));
}
export const AVISOS_DA_REGUA = [
  { aviso: 'D-3', dia: -3 },
  { aviso: 'D0', dia: 0 },
  { aviso: 'D+1', dia: 1 },
  { aviso: 'D+5', dia: 5 },
  { aviso: 'D+10', dia: 10 },
] as const;
export type AvisoDaRegua = (typeof AVISOS_DA_REGUA)[number]['aviso'];

export const TEXTO_DA_REGUA = [
  'D-3: aviso antes do vencimento',
  'D0: aviso no dia',
  'D+1: lembrete',
  'D+5: novo Pix',
  'D+10: vai para a fila de decisões',
];

/** Dias corridos entre duas datas AAAA-MM-DD (b - a), pelo calendário, sem fuso. */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA_MS);
}

/**
 * O aviso devido hoje para uma parcela em aberto: o degrau mais recente já
 * alcançado. `null` antes do D-3. Quem decide se já foi dado é a chave do fato.
 */
export function avisoDevido(vence: string, hoje: string): { aviso: AvisoDaRegua; dias: number } | null {
  const dias = diasEntre(vence, hoje);
  let devido: AvisoDaRegua | null = null;
  for (const a of AVISOS_DA_REGUA) if (dias >= a.dia) devido = a.aviso;
  return devido ? { aviso: devido, dias } : null;
}

export function estadoDaParcela(vence: string, pagaEm: Date | null, hoje: string): 'paga' | 'pendente' | 'atrasada' {
  if (pagaEm) return 'paga';
  return diasEntre(vence, hoje) > 0 ? 'atrasada' : 'pendente';
}

function diaSP(d: Date): string {
  return hojeEmSP(d);
}

@Injectable()
export class ContratoVivoService implements OnModuleInit {
  private readonly log = new Logger('ComercialContratoVivo');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly relogio: RelogioComercialRegistry,
    private readonly decisoes: DecisoesService,
  ) {}

  onModuleInit(): void {
    this.relogio.inscrever('dinheiro.regua', (orgId, agora) => this.regua(orgId, agora));
    this.relogio.inscrever('dinheiro.marcos', (orgId, agora) => this.marcos(orgId, agora));
  }

  // -------------------------------------------------------------------------
  // O relógio
  // -------------------------------------------------------------------------

  async regua(orgId: string, agora: Date): Promise<{ avisos: number; decisoes: number }> {
    const hoje = diaSP(agora);
    const abertas = await this.prisma.comercialCobranca.findMany({
      where: { orgId, pagaEm: null, vence: { lte: new Date(agora.getTime() + 4 * DIA_MS) } },
      orderBy: { vence: 'asc' },
      take: 500,
    });
    let avisos = 0;
    let decisoes = 0;
    // T1b: de quem fechou FORA do sistema a 1ª parcela vence no 1º vencimento declarado, não no dia do aceite na sala.
    const leadsDaPrimeira = [...new Set(abertas.filter((c) => c.parcela === 1).map((c) => c.leadId))];
    const foraDoSistema = new Set(
      leadsDaPrimeira.length
        ? (await this.prisma.leadEvent.findMany({ where: { orgId, leadId: { in: leadsDaPrimeira }, type: 'aceite.declarado' }, select: { leadId: true }, distinct: ['leadId'] })).map((e) => e.leadId)
        : [],
    );
    for (const c of abertas) {
      const vence = diaSP(c.vence);
      const devido = avisoDevido(vence, hoje);
      if (!devido) continue;
      // A 1ª parcela vence no dia do aceite e é paga ali, na sala: aviso antes ou no dia seria ruído. A régua dela começa no D+1.
      // A de quem fechou fora não passa pela sala: a régua dela é a das outras parcelas (D-3, D0, D+1...).
      if (c.parcela === 1 && devido.dias < 1 && !foraDoSistema.has(c.leadId)) continue;
      try {
        const chave = `${c.externoId}:${devido.aviso}`;
        const r = await this.fio.registrar(orgId, c.leadId, 'parcela.vence', chave, { parcela: c.parcela, vence, aviso: devido.aviso }, { em: agora });
        if (!r.novo) continue;
        avisos++;
        if (devido.dias >= 1) {
          await this.fio.registrar(orgId, c.leadId, 'parcela.atrasada', chave, { parcela: c.parcela, vence, dias: devido.dias }, { em: agora });
        }
        await this.prisma.comercialCobranca.update({ where: { id: c.id }, data: { ultimoAviso: devido.aviso, ...(devido.dias >= 1 ? { estado: 'atrasada' } : {}) } });
        if (devido.aviso === 'D+10') {
          const d = await this.decisoes.abrir({
            orgId,
            leadId: c.leadId,
            tipo: 'excecao_do_vigia',
            titulo: `Parcela ${c.parcela}/${c.parcelas} atrasada há ${devido.dias} dias`,
            contexto: `Venceu em ${vence} e não caiu. A régua já avisou em D-3, D0, D+1 e D+5. Os textos de cobrança ao cliente são [a decidir].`,
            opcoes: [
              { chave: 'aguardar', rotulo: 'Aguardar', efeito: 'nada sai; a parcela segue aberta' },
              { chave: 'conversar', rotulo: 'Conversar com o cliente', efeito: 'o sócio da conta liga' },
            ],
            padrao: 'aguardar',
            chave: `regua:${c.externoId}:D+10`,
            dados: { cobrancaId: c.id, externoId: c.externoId, parcela: c.parcela },
            agora,
          });
          if (d.nova) decisoes++;
        }
      } catch (e) {
        this.log.warn(`régua da parcela ${c.externoId}: ${(e as Error).message}`);
      }
    }
    return { avisos, decisoes };
  }

  async marcos(orgId: string, agora: Date): Promise<{ marcos: number }> {
    // O fato `cliente.ativo` é a fonte (a ficha é projeção dele e pode atrasar).
    const ativos = await this.prisma.leadEvent.findMany({ where: { type: 'cliente.ativo', lead: { orgId } }, orderBy: { occurredAt: 'asc' }, select: { leadId: true, occurredAt: true } });
    const fichas = [...new Map(ativos.map((e) => [e.leadId, { leadId: e.leadId, clienteAtivoEm: e.occurredAt as Date | null }])).values()];
    let n = 0;
    for (const f of fichas) {
      const marcos = await this.marcosDoLead(f.leadId, f.clienteAtivoEm);
      for (const m of marcos) {
        if (!m.quando || m.feito || new Date(m.quando).getTime() > agora.getTime()) continue;
        if (m.chave !== 'dia_15_indicacao' && m.chave !== 'd_30_continuidade') continue;
        const r = await this.fio.registrar(orgId, f.leadId, 'marco.contrato', m.chave, { marco: m.chave, quando: m.quando }, { em: agora });
        if (r.novo) n++;
      }
    }
    return { marcos: n };
  }

  private async marcosDoLead(leadId: string, clienteAtivoEm: Date | null): Promise<ContratoVivo['marcos']> {
    const [ultima, feitos] = await Promise.all([
      this.prisma.comercialCobranca.findFirst({ where: { leadId }, orderBy: { vence: 'desc' }, select: { vence: true } }),
      this.prisma.leadEvent.findMany({ where: { leadId, type: 'marco.contrato' }, select: { payload: true } }),
    ]);
    const jaFeitos = new Set(feitos.map((e) => String(((e.payload ?? {}) as Record<string, unknown>).marco ?? '')));
    const dia15 = clienteAtivoEm ? new Date(clienteAtivoEm.getTime() + 15 * DIA_MS).toISOString() : null;
    const d30 = ultima ? new Date(ultima.vence.getTime() - 30 * DIA_MS).toISOString() : null;
    return [
      { chave: 'dia_15_indicacao', rotulo: 'dia 15: pedido de indicação, depois do primeiro valor', quando: dia15, feito: jaFeitos.has('dia_15_indicacao') },
      { chave: 'd_30_continuidade', rotulo: 'D-30: conversa de continuidade com números do período', quando: d30, feito: jaFeitos.has('d_30_continuidade') },
    ];
  }

  // -------------------------------------------------------------------------
  // Leitura (tela 11)
  // -------------------------------------------------------------------------

  async doLead(orgId: string, leadId: string, agora: Date = new Date()): Promise<ContratoVivo> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const [ficha, cobrancas, marcoValor, fim] = await Promise.all([
      this.prisma.comercialFicha.findUnique({ where: { leadId } }),
      this.prisma.comercialCobranca.findMany({ where: { leadId }, orderBy: { parcela: 'asc' } }),
      this.prisma.leadEvent.findFirst({ where: { leadId, type: 'marco.contrato', payload: { path: ['marco'], equals: 'primeiro_valor' } }, select: { occurredAt: true } }),
      this.prisma.leadEvent.findFirst({ where: { leadId, type: { in: ['contrato.concluido', 'contrato.desativado'] } }, orderBy: { occurredAt: 'desc' }, select: { type: true, payload: true, occurredAt: true } }),
    ]);
    // "Em implantação" (só informativo): ativo com o card da implantação aberto (não arquivado, etapa não fechada).
    const card = ficha?.cardId
      ? await this.prisma.workTask.findFirst({ where: { id: ficha.cardId, orgId }, select: { archived: true, status: { select: { type: true } } } })
      : null;
    const fimP = (fim?.payload ?? {}) as Record<string, unknown>;
    const encerramento = fim
      ? {
        situacao: (fim.type === 'contrato.concluido' ? 'concluido' : 'desativado') as 'concluido' | 'desativado',
        motivo: String(fimP.motivo ?? ''),
        em: fim.occurredAt.toISOString(),
        por: typeof fimP.porNome === 'string' ? fimP.porNome : null,
        parcelasEmAberto: Number(fimP.parcelasEmAberto ?? 0),
      }
      : null;
    const situacao: SituacaoDoContrato = encerramento
      ? encerramento.situacao
      : card && !card.archived && card.status.type !== 'closed' ? 'em_implantacao' : 'ativo';
    const hoje = diaSP(agora);
    const trilho = ficha?.trilhoId ? await this.prisma.onboardingTrilho.findFirst({ where: { id: ficha.trilhoId, orgId }, select: { fase: true } }) : null;
    const fases = ['qualificar', 'diagnostico', 'contrato', 'imersao', 'operacao'];
    const valorCentavos = ficha?.valorCentavos ?? cobrancas.reduce((s, c) => s + c.valorCentavos, 0);
    return {
      leadId,
      cliente: ficha?.empresa ?? lead.name,
      produto: (ficha?.produto && ficha.produto in TABELA_DE_PRECO ? ficha.produto : null) as ComercialProduto | null,
      valorCentavos,
      descontoPct: ficha?.descontoPct != null ? Number(ficha.descontoPct) : null,
      parcelas: cobrancas.map((c) => ({
        n: c.parcela,
        total: c.parcelas,
        valorCentavos: c.valorCentavos,
        vence: diaSP(c.vence),
        estado: estadoDaParcela(diaSP(c.vence), c.pagaEm, hoje),
        pagaEm: c.pagaEm?.toISOString() ?? null,
        aviso: c.ultimoAviso,
      })),
      reguaDeCobranca: TEXTO_DA_REGUA,
      entregas: [
        { texto: 'trilho de implantação aberto', feito: !!ficha?.trilhoId },
        { texto: 'grupo do cliente criado', feito: !!ficha?.grupoJid },
        { texto: 'kickoff marcado', feito: !!ficha?.kickoffEm },
      ],
      primeiroValorEm: marcoValor?.occurredAt.toISOString() ?? null,
      // C-7: nenhum código escreve a saúde; até a fórmula existir ([a decidir]), a mesma leitura do funil.
      saude: saudeDoLead(),
      faseDaImplantacao: trilho ? { atual: Math.max(1, fases.indexOf(trilho.fase) + 1), total: 5 } : null,
      marcos: await this.marcosDoLead(leadId, ficha?.clienteAtivoEm ?? (await this.prisma.leadEvent.findFirst({ where: { leadId, type: 'cliente.ativo' }, select: { occurredAt: true } }))?.occurredAt ?? null),
      // C-17: nada conta aditivo ainda; nulo em vez de um zero com cara de medido.
      aditivos: null,
      situacao,
      encerramento,
      cnpj: ficha?.cnpj ?? null,
      socioDaConta: ficha?.socioDaConta ?? null,
    };
  }

  async lista(orgId: string, agora: Date = new Date()): Promise<ContratoVivo[]> {
    const ativos = await this.prisma.leadEvent.findMany({ where: { type: 'cliente.ativo', lead: { orgId } }, orderBy: { occurredAt: 'desc' }, select: { leadId: true }, take: 200 });
    const out: ContratoVivo[] = [];
    for (const leadId of new Set(ativos.map((e) => e.leadId))) out.push(await this.doLead(orgId, leadId, agora));
    return ordenarContratos(out);
  }

  /**
   * Concluir ou desativar à mão (T8), com motivo. Parcela em aberto no Asaas
   * AVISA e pede ciência explícita; a cobrança NÃO é cancelada (fica [a decidir]
   * pela mesa). Vai ao fio (`contrato.concluido`/`contrato.desativado`, uma vez
   * por contrato) e à auditoria (`comercial.contrato.encerrado`).
   */
  async encerrar(orgId: string, leadId: string, quem: { id: string; papeis: readonly string[] }, input: ContratoEncerrarInput, agora: Date = new Date()): Promise<ContratoVivo> {
    if (quem.papeis.some((p) => PAPEIS_DE_MAQUINA.includes(p))) throw new ForbiddenException('Conta de máquina não encerra contrato: quem decide é gente da casa.');
    const nivel = classificar(EFEITO_DE_ENCERRAR_CONTRATO);
    if (nivel !== 'R0' && nivel !== 'R1') throw new ForbiddenException(`Encerrar contrato ficou ${nivel} pela escada: precisa de capacidade no catálogo antes de valer.`);
    const pessoa = await this.prisma.user.findFirst({ where: { id: quem.id, orgId, isActive: true }, select: { id: true, name: true } });
    if (!pessoa) throw new ForbiddenException('Só gente ativa da empresa encerra contrato.');
    const ativo = await this.prisma.leadEvent.findFirst({ where: { leadId, type: 'cliente.ativo', lead: { orgId } }, select: { id: true } });
    if (!ativo) throw new NotFoundException('Contrato vivo não encontrado.');
    const atual = await this.doLead(orgId, leadId, agora);
    if (atual.encerramento) {
      throw new ConflictException(`Este contrato já está ${atual.encerramento.situacao === 'concluido' ? 'concluído' : 'desativado'} desde ${atual.encerramento.em.slice(0, 10)}.`);
    }
    const emAberto = atual.parcelas.filter((p) => p.estado !== 'paga').length;
    if (emAberto > 0 && !input.cienteDasParcelas) {
      throw new BadRequestException(`Há ${emAberto} parcela(s) em aberto no Asaas. Encerrar não cancela a cobrança (isso é decisão da mesa). Confirme que viu para seguir.`);
    }
    const tipo = input.situacao === 'concluido' ? 'contrato.concluido' : 'contrato.desativado';
    const r = await this.fio.registrar(orgId, leadId, tipo, 'encerramento', {
      motivo: input.motivo, por: pessoa.id, porNome: pessoa.name, parcelasEmAberto: emAberto, nivel,
    }, { em: agora });
    if (!r.novo) throw new ConflictException('Este contrato já foi encerrado.');
    await this.prisma.auditLog.create({
      data: {
        orgId, actorType: ActorType.user, actorId: pessoa.id, action: 'comercial.contrato.encerrado', entityType: 'lead', entityId: leadId,
        before: { situacao: atual.situacao } as Prisma.InputJsonValue,
        after: { situacao: input.situacao, parcelasEmAberto: emAberto, nivel, eventoId: r.eventoId } as Prisma.InputJsonValue,
      },
    });
    this.log.log(`contrato do lead ${leadId} ${input.situacao} (${nivel}), ${emAberto} parcela(s) em aberto`);
    return this.doLead(orgId, leadId, agora);
  }
}
