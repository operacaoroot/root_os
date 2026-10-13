import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { TABELA_DE_PRECO, type ComercialProduto, type ContratoVivo } from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { DecisoesService } from './decisoes.service';
import { hojeEmSP } from './dinheiro.service';
import { FioService } from './fio.service';
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
    for (const c of abertas) {
      const vence = diaSP(c.vence);
      const devido = avisoDevido(vence, hoje);
      if (!devido) continue;
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
    const fichas = await this.prisma.comercialFicha.findMany({ where: { orgId, clienteAtivoEm: { not: null } }, select: { leadId: true, clienteAtivoEm: true } });
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
    const [ficha, cobrancas, marcoValor] = await Promise.all([
      this.prisma.comercialFicha.findUnique({ where: { leadId } }),
      this.prisma.comercialCobranca.findMany({ where: { leadId }, orderBy: { parcela: 'asc' } }),
      this.prisma.leadEvent.findFirst({ where: { leadId, type: 'marco.contrato', payload: { path: ['marco'], equals: 'primeiro_valor' } }, select: { occurredAt: true } }),
    ]);
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
      saude: ficha?.saude ?? null,
      faseDaImplantacao: trilho ? { atual: Math.max(1, fases.indexOf(trilho.fase) + 1), total: 5 } : null,
      marcos: await this.marcosDoLead(leadId, ficha?.clienteAtivoEm ?? null),
      aditivos: 0,
    };
  }

  async lista(orgId: string, agora: Date = new Date()): Promise<ContratoVivo[]> {
    const fichas = await this.prisma.comercialFicha.findMany({ where: { orgId, clienteAtivoEm: { not: null } }, orderBy: { clienteAtivoEm: 'desc' }, select: { leadId: true }, take: 200 });
    const out: ContratoVivo[] = [];
    for (const f of fichas) out.push(await this.doLead(orgId, f.leadId, agora));
    return out;
  }
}
