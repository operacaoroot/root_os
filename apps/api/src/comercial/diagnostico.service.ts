import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { temPapelDeMaquina } from '../approvals/alcada';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { comProcedencia, type ProcedenciaDaChamada } from '../llm/procedencia';
import { AtaInvalidaError, conferirAta } from '../onboarding/trilho/leitor-de-ata';
import { PrismaService } from '../prisma/prisma.service';
import { tirarAtaEmTransito } from './ata-em-transito';
import { hashDoConteudo, type PayloadDe } from './eventos';
import { FioService, ReacoesRegistry } from './fio.service';
import { interpretarDiagnostico, promptDoDiagnostico, RespostaIlegivelError, type LeituraDoDiagnostico } from './inteligencia-prompts';
import { produtoAlvo } from './pontuacao';
import { REGRA_DO_PRODUTO } from './proposta-construtor';

/*
 * O LEITOR DE ATA DO COMERCIAL: a ata da sessão vira diagnóstico (lane E, 13/10/2026).
 *
 * C04, E5: "o agente leitor de ata transforma a gravação em diagnóstico: dores
 * com minuto e trecho". É uma REAÇÃO a `ata.chegou` (`inteligencia.diagnostico`):
 * o texto chega pela memória do processo (`ata-em-transito.ts`), nunca pelo
 * banco; o modelo aponta dores e objeções citando o trecho; o parser confere
 * cada trecho contra a ata com a mesma regra do leitor do onboarding e o
 * minuto sai da linha da ata. O resultado é o fato `diagnostico.pronto`.
 *
 * O PRODUTO SUGERIDO é regra da casa, não opinião do modelo (`REGRA_DO_PRODUTO`):
 * base organizada e sistema = Operação; sem base = Imersão. Provisória.
 *
 * O PORTÃO DE E5 pede o diagnóstico APROVADO POR SÓCIO. Aprovar (`aprovar`) é
 * o mesmo fato gravado de novo com outra chave e `aprovadoEm`/`aprovadoPor`
 * (o combinado com a lane A). É um toque humano, e é ele que solta a proposta.
 *
 * JSON ilegível do modelo NÃO grava nada: a reação devolve o erro (a linha da
 * reação fica `erro`), e a rota de refazer responde 503.
 */

export const REACAO_DO_DIAGNOSTICO = 'inteligencia.diagnostico';

export interface ResultadoDoDiagnostico {
  estado: 'gravado' | 'sem_texto' | 'repetido';
  eventoId: string | null;
  dores: number;
  objecoes: number;
  avisos: string[];
  procedencia: ProcedenciaDaChamada | null;
}

@Injectable()
export class DiagnosticoService implements OnModuleInit {
  private readonly log = new Logger('ComercialDiagnostico');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly reacoes: ReacoesRegistry,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  onModuleInit(): void {
    this.inscrever();
  }

  /** Separado para a suíte montar à mão. */
  inscrever(): void {
    this.reacoes.inscrever('ata.chegou', REACAO_DO_DIAGNOSTICO, async (ev) => {
      const texto = tirarAtaEmTransito(ev.orgId, ev.leadId, ev.payload.hash);
      if (texto === null) {
        // O processo caiu entre gravar e reagir, ou a ata veio de fora da rota. Não é erro de
        // reação (repetir não traz o texto de volta): fica registrado, e refazer é subir de novo.
        return { estado: 'sem_texto', aviso: 'o texto da ata não está mais na memória do processo; refaça pela rota de diagnóstico com o texto' };
      }
      return this.gerar(ev.orgId, ev.leadId, texto, { ataHash: ev.payload.hash });
    });
  }

  /** Lê a ata e grava `diagnostico.pronto`. Lança `RespostaIlegivelError` sem gravar nada. */
  async gerar(orgId: string, leadId: string, ataBruta: string, opcoes: { ataHash?: string } = {}): Promise<ResultadoDoDiagnostico> {
    let ata: string;
    try {
      ata = conferirAta(ataBruta);
    } catch (e) {
      if (e instanceof AtaInvalidaError) throw new BadRequestException(e.message);
      throw e;
    }
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { empresa: true, sistemaErp: true, baseDados: true } });

    const { system, user } = promptDoDiagnostico({ empresa: ficha?.empresa ?? lead.name, ata });
    const { resultado: saida, procedencia } = await comProcedencia(() => this.llm.complete({ funcao: 'CO-03', system, user, orgId, maxTokens: 4_000 }));
    const leitura: LeituraDoDiagnostico = interpretarDiagnostico(saida, ata);
    for (const a of leitura.avisos) this.log.warn(`diagnóstico do lead ${leadId}: ${a}`);

    const ataHash = opcoes.ataHash ?? hashDoConteudo(ata);
    const prov = procedencia ?? { provider: this.llm.name, modelo: this.llm.model, custoUsd: 0, custoDesconhecido: true, caiuNoStub: false, aviso: null };
    const payload: PayloadDe<'diagnostico.pronto'> & Record<string, unknown> = {
      dores: leitura.dores,
      objecoes: leitura.objecoes,
      produtoSugerido: produtoAlvo({ sistemaErp: ficha?.sistemaErp ?? null, baseDados: ficha?.baseDados ?? null }),
      modelo: prov.modelo,
      custoUsd: prov.custoUsd,
      custoDesconhecido: prov.custoDesconhecido,
      aprovadoEm: null,
      aprovadoPor: null,
      // Acréscimos da lane E (livres no payload): o que a tela 06 mostra além das dores.
      objecoesComTrecho: leitura.objecoesComTrecho,
      avisos: leitura.avisos,
      regraDoProduto: REGRA_DO_PRODUTO,
      ataHash,
      provider: prov.provider,
      caiuNoStub: prov.caiuNoStub,
      avisoDoModelo: prov.aviso,
    };
    const chave = `${ataHash}:${hashDoConteudo({ dores: leitura.dores, objecoes: leitura.objecoes })}`;
    const ev = await this.fio.registrar(orgId, leadId, 'diagnostico.pronto', chave, payload as PayloadDe<'diagnostico.pronto'>);
    return {
      estado: ev.novo ? 'gravado' : 'repetido',
      eventoId: ev.eventoId,
      dores: leitura.dores.length,
      objecoes: leitura.objecoes.length,
      avisos: leitura.avisos,
      procedencia: prov,
    };
  }

  /** A rota de refazer: o mesmo `gerar`, com o 503 quando o modelo devolve o que não se lê. */
  async refazer(orgId: string, leadId: string, corpo: unknown): Promise<ResultadoDoDiagnostico> {
    const texto = corpo && typeof corpo === 'object' ? (corpo as { texto?: unknown }).texto : undefined;
    if (typeof texto !== 'string' || !texto.trim()) {
      throw new BadRequestException('Mande o texto da ata em "texto": a transcrição não fica guardada no OS, só o hash.');
    }
    try {
      return await this.gerar(orgId, leadId, texto);
    } catch (e) {
      if (e instanceof RespostaIlegivelError) throw new ServiceUnavailableException(`${e.message}. Nada foi gravado.`);
      throw e;
    }
  }

  /** O diagnóstico vigente (o último `diagnostico.pronto`), aprovado ou não. */
  async vigente(orgId: string, leadId: string): Promise<{ eventoId: string; em: Date; payload: Record<string, unknown> } | null> {
    const ev = await this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'diagnostico.pronto' }, orderBy: { occurredAt: 'desc' } });
    return ev ? { eventoId: ev.id, em: ev.occurredAt, payload: (ev.payload ?? {}) as Record<string, unknown> } : null;
  }

  /**
   * O sócio aprova o diagnóstico (portão de E5): o mesmo fato, de novo, com
   * `aprovadoEm`. Aprovar o já aprovado é 409.
   *
   * Revisão E-4/C-8: o portão é decisão de mesa. A rota pede
   * `aprovacoes.decidir`, conta de máquina é recusada aqui (403) e a pessoa
   * aprova o diagnóstico que LEU: `eventoLido` diferente do vigente é 409
   * (alguém refez enquanto ela lia).
   */
  async aprovar(
    orgId: string,
    leadId: string,
    quem: { id: string; nome: string | null; papeis?: readonly string[] },
    eventoLido: string,
    agora = new Date(),
  ): Promise<{ eventoId: string; novo: boolean }> {
    if (temPapelDeMaquina(quem.papeis ?? [])) throw new ForbiddenException('Conta de serviço não aprova o diagnóstico: o portão é de uma pessoa da mesa.');
    if (typeof eventoLido !== 'string' || !eventoLido.trim()) {
      throw new BadRequestException('Mande em "eventoId" o diagnóstico que você leu.');
    }
    const d = await this.vigente(orgId, leadId);
    if (!d) throw new NotFoundException('O lead ainda não tem diagnóstico.');
    if (d.payload.aprovadoEm) throw new ConflictException(`O diagnóstico já foi aprovado em ${String(d.payload.aprovadoEm)}.`);
    if (d.eventoId !== eventoLido) {
      throw new ConflictException('O diagnóstico mudou depois que você abriu a tela. Leia a versão nova antes de aprovar.');
    }
    const payload = { ...d.payload, aprovadoEm: agora.toISOString(), aprovadoPor: quem.nome ?? quem.id, aprovadoPorId: quem.id, aprovaOEvento: d.eventoId };
    return this.fio.registrar(orgId, leadId, 'diagnostico.pronto', `aprovado:${d.eventoId}`, payload as unknown as PayloadDe<'diagnostico.pronto'>, { em: agora });
  }

  /** Para a tela: as reações do leitor (sem texto, erro) do lead. */
  async reacoesDoLeitor(orgId: string, leadId: string) {
    return this.prisma.comercialReacao.findMany({
      where: { orgId, leadId, reacao: REACAO_DO_DIAGNOSTICO },
      orderBy: { criadoEm: 'desc' },
      take: 5,
      select: { estado: true, resultado: true, erro: true, criadoEm: true },
    }) as Promise<{ estado: string; resultado: Prisma.JsonValue; erro: string | null; criadoEm: Date }[]>;
  }
}
