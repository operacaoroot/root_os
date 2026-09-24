import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { apelidoDoEpisodio } from '@mktos/shared';
import type {
  PautaRodadaDetalhe,
  PautaRodadaList,
  PautaRotinaInput,
  PautaRotinaList,
  PautaRotinaUpdateInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RodadaService } from './rodada.service';
import { semPai } from './episodio';
import { lerCandidatos } from './curadoria-da-rodada';
import { ehPecaDaSemana, motivoParaNaoAprovarDaSemana } from './derivacao-do-episodio';
import { proximaOcorrencia, validarCron } from './cron';
import { agendadorDeRotinasDePe } from '../routines/sinal-do-agendador';

/*
 * "O GATILHO ESTÁ MESMO DE PÉ?" — a resposta que a tela de Pauta mostra.
 *
 * Ela lia só `PAUTA_CRON`, e isso PASSOU A MENTIR na fatia 5.1: o relógio mudou
 * de dono, e quem desliga o agendador inteiro agora é `ROTINAS_CRON=off`. Com a
 * nova desligada e a antiga no padrão, a tela dizia "ativo" e nada disparava —
 * a pior forma de mentir, porque manda quem lê procurar o defeito em outro
 * lugar.
 *
 * São TRÊS condições, e a terceira não é variável nenhuma: o módulo de rotinas
 * precisa estar montado neste processo. Hoje a API nem sobe sem ele (a sentinela
 * em `scheduler.service.ts` lança), mas perguntar aqui custa uma linha e é o que
 * mantém esta resposta verdadeira se a trava um dia mudar.
 *
 * O sinal é um módulo simples, e não um provider, de propósito: `RoutinesModule`
 * importa `PautaModule` para alcançar o `RodadaService`, então injetar o
 * agendador aqui fecharia um ciclo de módulos por causa de um booleano. Ver
 * `routines/sinal-do-agendador.ts`.
 */
export function gatilhoDaPautaDePe(): boolean {
  if (!agendadorDeRotinasDePe()) return false;
  if ((process.env.ROTINAS_CRON ?? 'on') === 'off') return false;
  return (process.env.PAUTA_CRON ?? 'on') !== 'off';
}

// CRUD das rotinas e leitura das rodadas/peças. O disparo automático mora no
// agendador de rotinas (`src/routines/rotinas.scheduler.ts`); aqui fica o que a
// tela usa.
@Injectable()
export class RotinaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rodadas: RodadaService,
  ) {}

  private assertCron(cron: string, tz: string): void {
    const v = validarCron(cron);
    if (!v.ok) throw new BadRequestException(`Cron inválido: ${v.erro}`);
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      throw new BadRequestException(`Fuso inválido: "${tz}".`);
    }
  }

  async listar(orgId: string): Promise<PautaRotinaList> {
    const rows = await this.prisma.pautaRotina.findMany({
      where: { orgId },
      orderBy: { criadaEm: 'desc' },
      include: { _count: { select: { rodadas: true } } },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        nome: r.nome,
        cron: r.cron,
        tz: r.tz,
        ativo: r.ativo,
        horas: ((r.config ?? {}) as { horas?: number }).horas ?? 72,
        ultimoRun: r.ultimoRun?.toISOString() ?? null,
        ultimoStatus: r.ultimoStatus,
        proximoRun: r.proximoRun?.toISOString() ?? null,
        rodadas: r._count.rodadas,
      })),
      // A tela mostra se o gatilho está mesmo de pé no processo — as três
      // condições, não só a variável antiga. Ver `gatilhoDaPautaDePe` acima.
      cronAtivo: gatilhoDaPautaDePe(),
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async criar(orgId: string, actorId: string, input: PautaRotinaInput) {
    this.assertCron(input.cron, input.tz ?? 'America/Sao_Paulo');
    const tz = input.tz ?? 'America/Sao_Paulo';
    const r = await this.prisma.pautaRotina.create({
      data: {
        orgId,
        slug: input.slug,
        nome: input.nome,
        cron: input.cron,
        tz,
        ativo: input.ativo ?? true,
        config: {
          horas: input.horas ?? 72,
          coletarAntes: input.coletarAntes ?? true,
          ...(input.origens ? { origens: input.origens } : {}),
        },
        proximoRun: proximaOcorrencia(input.cron, tz, new Date()),
      },
    });
    await this.audit.log({
      orgId, actorId, action: 'pauta.rotina_criada', entityType: 'pauta_rotina', entityId: r.id,
      after: { slug: r.slug, cron: r.cron, tz: r.tz },
    });
    return { ok: true, id: r.id, proximoRun: r.proximoRun?.toISOString() ?? null };
  }

  async atualizar(orgId: string, id: string, actorId: string, patch: PautaRotinaUpdateInput) {
    const atual = await this.prisma.pautaRotina.findFirst({ where: { id, orgId } });
    if (!atual) throw new NotFoundException('Rotina não encontrada');

    const cron = patch.cron ?? atual.cron;
    const tz = patch.tz ?? atual.tz;
    if (patch.cron || patch.tz) this.assertCron(cron, tz);

    const cfgAtual = (atual.config ?? {}) as { horas?: number; coletarAntes?: boolean; origens?: string[] };
    const origens = patch.origens ?? cfgAtual.origens;
    const r = await this.prisma.pautaRotina.update({
      where: { id },
      data: {
        ...(patch.nome !== undefined ? { nome: patch.nome } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        cron,
        tz,
        ...(patch.ativo !== undefined ? { ativo: patch.ativo } : {}),
        config: {
          horas: patch.horas ?? cfgAtual.horas ?? 72,
          coletarAntes: patch.coletarAntes ?? cfgAtual.coletarAntes ?? true,
          ...(origens ? { origens } : {}),
        },
        proximoRun: proximaOcorrencia(cron, tz, new Date()),
      },
    });
    await this.audit.log({
      orgId, actorId, action: 'pauta.rotina_editada', entityType: 'pauta_rotina', entityId: id,
      before: { cron: atual.cron, ativo: atual.ativo },
      after: { cron: r.cron, ativo: r.ativo },
    });
    return { ok: true, proximoRun: r.proximoRun?.toISOString() ?? null };
  }

  async remover(orgId: string, id: string, actorId: string) {
    const r = await this.prisma.pautaRotina.findFirst({ where: { id, orgId } });
    if (!r) throw new NotFoundException('Rotina não encontrada');
    await this.prisma.pautaRotina.delete({ where: { id } });
    await this.audit.log({
      orgId, actorId, action: 'pauta.rotina_removida', entityType: 'pauta_rotina', entityId: id,
      before: { slug: r.slug },
    });
    return { ok: true };
  }

  /** Dispara a rotina na hora, sem esperar o cron. */
  async rodarAgora(orgId: string, id: string, actorId: string) {
    const r = await this.prisma.pautaRotina.findFirst({ where: { id, orgId } });
    if (!r) throw new NotFoundException('Rotina não encontrada');
    const cfg = (r.config ?? {}) as { horas?: number; coletarAntes?: boolean; origens?: unknown };

    if (cfg.coletarAntes !== false) await this.rodadas.coletarFeeds(orgId, actorId, cfg.origens);
    const rodada = await this.rodadas.gerar(orgId, actorId, {
      rotinaId: r.id,
      horas: cfg.horas ?? 72,
      origens: cfg.origens,
    });

    await this.prisma.pautaRotina.update({
      where: { id },
      data: { ultimoRun: new Date(), ultimoStatus: `manual: rodada ${rodada.id.slice(0, 8)}` },
    });
    return { ok: true, rodadaId: rodada.id };
  }

  // ---------- rodadas ----------

  async listarRodadas(orgId: string, limite = 30): Promise<PautaRodadaList> {
    const rows = await this.prisma.pautaRodada.findMany({
      where: { orgId },
      orderBy: { criadaEm: 'desc' },
      take: Math.min(Math.max(limite, 1), 100),
      include: {
        _count: { select: { pecas: true } },
        rotina: { select: { nome: true } },
        episodio: { select: { id: true, numero: true, status: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        status: r.status,
        rotina: r.rotina?.nome ?? null,
        itens: Array.isArray(r.itens) ? (r.itens as unknown[]).length : 0,
        marcados:
          r.status === 'aguardando_curadoria' && Array.isArray(r.itens)
            ? (r.itens as Array<{ marcado?: unknown }>).filter((i) => i?.marcado === true).length
            : 0,
        pecas: r._count.pecas,
        provider: r.provider,
        model: r.model,
        erro: r.erro,
        janelaIni: r.janelaIni.toISOString(),
        janelaFim: r.janelaFim.toISOString(),
        criadaEm: r.criadaEm.toISOString(),
        episodio: r.episodio ?? null,
      })),
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async obterRodada(orgId: string, id: string): Promise<PautaRodadaDetalhe> {
    const r = await this.prisma.pautaRodada.findFirst({
      where: { id, orgId },
      include: {
        pecas: { orderBy: { criadaEm: 'asc' } },
        rotina: { select: { nome: true } },
        episodio: { select: { id: true, numero: true, status: true } },
      },
    });
    if (!r) throw new NotFoundException('Rodada não encontrada');
    return {
      id: r.id,
      titulo: r.titulo,
      status: r.status,
      rotina: r.rotina?.nome ?? null,
      corpo: r.corpo,
      // Em curadoria, o candidato gravado antes da regra única ganha na leitura a
      // marca `semLinkPublico`: a tela mostra "só contexto" e não o permalink.
      itens: (r.status === 'aguardando_curadoria'
        ? lerCandidatos(r.itens)
        : (r.itens ?? [])) as unknown as PautaRodadaDetalhe['itens'],
      fichasUsadas: r.fichasUsadas.length,
      provider: r.provider,
      model: r.model,
      erro: r.erro,
      janelaIni: r.janelaIni.toISOString(),
      janelaFim: r.janelaFim.toISOString(),
      criadaEm: r.criadaEm.toISOString(),
      pecas: r.pecas.map((p) => ({
        id: p.id,
        canal: p.canal,
        formato: p.formato,
        titulo: p.titulo,
        corpo: p.corpo,
        meta: (p.meta ?? {}) as Record<string, unknown>,
        status: p.status,
        externalId: p.externalId,
        bioLinkId: p.bioLinkId,
        erro: p.erro,
        publicadaEm: p.publicadaEm?.toISOString() ?? null,
      })),
      episodio: r.episodio ?? null,
    };
  }

  async removerRodada(orgId: string, id: string, actorId: string) {
    const r = await this.prisma.pautaRodada.findFirst({
      where: { id, orgId },
      include: { episodio: { select: { numero: true } } },
    });
    if (!r) throw new NotFoundException('Rodada não encontrada');
    // A FK do episódio é RESTRICT: sem esta recusa, o banco devolveria 500.
    if (r.episodio) {
      throw new ConflictException(
        `Esta rodada já é o episódio ${apelidoDoEpisodio(r.episodio.numero)} — ela carrega o roteiro e a mídia, e não se apaga.`,
      );
    }
    try {
      await this.prisma.pautaRodada.delete({ where: { id } });
    } catch (e) {
      // O episódio nasceu entre a leitura acima e o delete.
      if (semPai(e)) throw new ConflictException('Esta rodada acabou de virar episódio — ela não se apaga.');
      throw e;
    }
    await this.audit.log({
      orgId, actorId, action: 'pauta.rodada_removida', entityType: 'pauta_rodada', entityId: id,
    });
    return { ok: true };
  }

  async editarPeca(
    orgId: string,
    id: string,
    actorId: string,
    patch: { titulo?: string; corpo?: string; status?: string },
  ) {
    const p = await this.prisma.pautaPeca.findFirst({ where: { id, orgId } });
    if (!p) throw new NotFoundException('Peça não encontrada');
    if (p.status === 'publicada') throw new BadRequestException('Peça já publicada — não dá para editar.');
    if (patch.status && !['rascunho', 'aprovada', 'descartada'].includes(patch.status)) {
      throw new BadRequestException('Status inválido (publicar é pelo endpoint /publicar).');
    }
    // A peça da semana (MC15) edita o texto só pelo PUT dela: lá o CTA da
    // legenda se refaz, o render velho cai e a aprovada volta ao rascunho.
    if ((patch.titulo !== undefined || patch.corpo !== undefined) && ehPecaDaSemana(p.meta)) {
      throw new BadRequestException(
        `Esta peça é da semana de posts do episódio: edite o texto na aba Episódios (PUT /pauta/pecas/${id}/semana). Aqui só muda o status.`,
      );
    }
    if (patch.status === 'aprovada' && ehPecaDaSemana(p.meta)) {
      const motivo = motivoParaNaoAprovarDaSemana(p.formato, p.meta);
      if (motivo) throw new BadRequestException(motivo);
    }

    const atualizada = await this.prisma.pautaPeca.update({
      where: { id },
      data: {
        ...(patch.titulo !== undefined ? { titulo: patch.titulo.slice(0, 200) } : {}),
        ...(patch.corpo !== undefined ? { corpo: patch.corpo } : {}),
        ...(patch.status ? { status: patch.status as 'rascunho' | 'aprovada' | 'descartada' } : {}),
        // O slot da semana (MC16) é da peça aprovada: saindo dela, sai da agenda.
        ...(patch.status && patch.status !== 'aprovada' ? { agendadaPara: null } : {}),
        // O slot proposto (MD1) nunca vira agenda por aqui; a descartada o devolve à grade.
        ...(patch.status === 'descartada' ? { slotProposto: null } : {}),
      },
    });
    await this.audit.log({
      orgId, actorId, action: 'pauta.peca_editada', entityType: 'pauta_peca', entityId: id,
      before: { status: p.status, ...(p.agendadaPara ? { agendadaPara: p.agendadaPara.toISOString() } : {}) },
      after: { status: atualizada.status, ...(p.agendadaPara && !atualizada.agendadaPara ? { saiuDaAgenda: true } : {}) },
    });
    return { ok: true, status: atualizada.status };
  }
}
