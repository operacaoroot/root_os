import { Injectable, Logger } from '@nestjs/common';
import type { ComercialEvento } from '@mktos/shared';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { montarEvento, reacaoId, type PayloadDe } from './eventos';

/*
 * O FIO DO LEAD — o ÚNICO caminho de escrita de um fato do comercial (orquestrador, 13/10/2026).
 *
 * Toda lane grava fato por aqui: a sala, o simulador, os webhooks do Asaas e da
 * ZapSign, o relógio, o fechamento, a inteligência. `registrar` grava o
 * `LeadEvent` com id DERIVADO da chave do fato (`eventos.ts`) e, só quando o
 * evento é novo, roda as reações inscritas para aquele tipo. O mesmo fato
 * repetido (webhook reentregue, clique duplo, passagem do relógio de novo) cai
 * no mesmo id e não reage duas vezes.
 *
 * AS REAÇÕES SE INSCREVEM POR REGISTRO (`ReacoesRegistry`), não por import: a
 * espinha (lane A) inscreve as reações K02 que movem etapa e abrem decisão; a
 * sala (B), o dinheiro (D) e a inteligência (E) inscrevem as suas no
 * `onModuleInit` dos próprios serviços. Cada reação é idempotente por
 * `(eventoId, reacao)` na tabela `ComercialReacao`: a linha é a trava, gravada
 * ANTES de rodar; quem perde a corrida não roda.
 *
 * Reação que lança NÃO desfaz o evento (o fato aconteceu): a linha fica
 * `erro` com a mensagem, e o relógio pode tentar de novo pelo
 * `reexecutarPendentes`. Uma reação pode gravar outros eventos pelo próprio
 * `registrar` — é assim que o fio encadeia (form.respondido → lead.pontuado →
 * etapa.mudou).
 */

export interface EventoGravado<T extends ComercialEvento = ComercialEvento> {
  eventoId: string;
  orgId: string;
  leadId: string;
  type: T;
  payload: PayloadDe<T>;
  em: Date;
}

export type Reacao<T extends ComercialEvento = ComercialEvento> = (evento: EventoGravado<T>) => Promise<unknown>;

interface Inscricao {
  nome: string;
  fn: Reacao;
}

/**
 * A guarda da autonomia (lane E, fase 2): antes de rodar uma reação, pergunta se
 * a automação dela está em A0. Instalada por `AutonomiaService`; sem ela (a suíte
 * que monta à mão), tudo roda como antes. Ela só SEGURA: nunca faz rodar o que
 * não rodaria.
 */
export type GuardaDaAutonomia = (orgId: string, nome: string) => Promise<{ roda: true } | { roda: false; automacao: string; nivel: string; motivo: string }>;

@Injectable()
export class ReacoesRegistry {
  private readonly porTipo = new Map<string, Inscricao[]>();
  private guardaInstalada: GuardaDaAutonomia | null = null;

  /** Instala a guarda da autonomia (uma só por processo). */
  definirGuarda(fn: GuardaDaAutonomia): void {
    this.guardaInstalada = fn;
  }

  get guarda(): GuardaDaAutonomia | null {
    return this.guardaInstalada;
  }

  /** Inscreve uma reação. Mesmo nome no mesmo tipo duas vezes é erro de fiação. */
  inscrever<T extends ComercialEvento>(type: T, nome: string, fn: Reacao<T>): void {
    const lista = this.porTipo.get(type) ?? [];
    if (lista.some((i) => i.nome === nome)) throw new Error(`Reação "${nome}" já inscrita para ${type}.`);
    lista.push({ nome, fn: fn as Reacao });
    this.porTipo.set(type, lista);
  }

  doTipo(type: string): readonly Inscricao[] {
    return this.porTipo.get(type) ?? [];
  }

  inscritas(): { type: string; nome: string }[] {
    return [...this.porTipo.entries()].flatMap(([type, l]) => l.map((i) => ({ type, nome: i.nome })));
  }
}

export interface OpcoesDoRegistro {
  /** Quando o fato aconteceu (o pagamento do webhook, o horário da passagem). Padrão: agora. */
  em?: Date;
  /** Não rodar reações (seed e reconstrução do fio). */
  semReacoes?: boolean;
}

@Injectable()
export class FioService {
  private readonly log = new Logger('ComercialFio');

  constructor(
    private readonly prisma: PrismaService,
    private readonly reacoes: ReacoesRegistry,
  ) {}

  /**
   * Grava um fato do comercial. `chave` é a identidade do fato (ver
   * `eventoIdComercial`). Devolve o id e se o evento é novo.
   */
  async registrar<T extends ComercialEvento>(
    orgId: string,
    leadId: string,
    type: T,
    chave: string,
    payload: PayloadDe<T>,
    opcoes: OpcoesDoRegistro = {},
  ): Promise<{ eventoId: string; novo: boolean }> {
    const evento = montarEvento(orgId, leadId, type, chave, payload, opcoes.em);
    const em = opcoes.em ?? new Date();
    const r = await this.prisma.leadEvent.createMany({
      data: [
        {
          id: evento.id,
          leadId,
          type,
          payload: payload as unknown as Prisma.InputJsonValue,
          occurredAt: em,
        },
      ],
      skipDuplicates: true,
    });
    const novo = r.count === 1;
    if (novo && !opcoes.semReacoes) {
      await this.reagir({ eventoId: evento.id, orgId, leadId, type, payload, em });
    }
    return { eventoId: evento.id, novo };
  }

  /** Roda as reações inscritas para o evento, cada uma no máximo uma vez. */
  async reagir(evento: EventoGravado): Promise<void> {
    for (const { nome, fn } of this.reacoes.doTipo(evento.type)) {
      const id = reacaoId(evento.eventoId, nome);
      const trava = await this.prisma.comercialReacao.createMany({
        data: [{ id, leadId: evento.leadId, eventoId: evento.eventoId, reacao: nome, estado: 'em_curso' }],
        skipDuplicates: true,
      });
      if (trava.count === 0) continue;
      const veredicto = this.reacoes.guarda ? await this.reacoes.guarda(evento.orgId, nome) : { roda: true as const };
      if (!veredicto.roda) {
        // A0: a automação não roda, e o pulo fica escrito na própria linha da reação.
        await this.prisma.comercialReacao.update({
          where: { id },
          data: { estado: 'ok', resultado: { pulada: true, automacao: veredicto.automacao, nivel: veredicto.nivel, motivo: veredicto.motivo }, erro: null },
        });
        continue;
      }
      await this.rodar(id, nome, fn, evento);
    }
  }

  /** Reações que ficaram `erro` ou `em_curso` (processo caiu no meio): o relógio chama. */
  async reexecutarPendentes(orgId: string, antesDe: Date, limite = 50): Promise<number> {
    const pendentes = await this.prisma.comercialReacao.findMany({
      where: { orgId, estado: { in: ['erro', 'em_curso'] }, criadoEm: { lt: antesDe } },
      orderBy: { criadoEm: 'asc' },
      take: limite,
    });
    let feitas = 0;
    for (const p of pendentes) {
      const ev = await this.prisma.leadEvent.findFirst({ where: { id: p.eventoId } });
      const insc = ev ? this.reacoes.doTipo(ev.type).find((i) => i.nome === p.reacao) : undefined;
      if (!ev || !insc) continue;
      const tomada = await this.prisma.comercialReacao.updateMany({
        where: { id: p.id, estado: p.estado, criadoEm: p.criadoEm },
        data: { estado: 'em_curso', criadoEm: new Date() },
      });
      if (tomada.count === 0) continue;
      await this.rodar(p.id, p.reacao, insc.fn, {
        eventoId: ev.id,
        orgId,
        leadId: ev.leadId,
        type: ev.type as ComercialEvento,
        payload: ev.payload as never,
        em: ev.occurredAt,
      });
      feitas++;
    }
    return feitas;
  }

  private async rodar(id: string, nome: string, fn: Reacao, evento: EventoGravado): Promise<void> {
    try {
      const resultado = await fn(evento);
      await this.prisma.comercialReacao.update({
        where: { id },
        data: { estado: 'ok', resultado: resultado == null ? Prisma.JsonNull : (resultado as Prisma.InputJsonValue), erro: null },
      });
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      this.log.warn(`reação ${nome} sobre ${evento.type} (${evento.eventoId}) falhou: ${msg}`);
      await this.prisma.comercialReacao.update({ where: { id }, data: { estado: 'erro', erro: msg.slice(0, 2000) } });
    }
  }
}
