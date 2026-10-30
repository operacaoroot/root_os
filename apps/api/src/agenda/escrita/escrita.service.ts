import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  lerCompromisso,
  montarTituloDeCompromisso,
  type CompromissoProposto,
  type LinhaDoHistorico,
  type PedidoDeEscrita,
  type ResultadoDaEscrita,
  type ResultadoDaRegua,
  type SocioDaAgenda,
} from '@mktos/shared';

import { temPapelDeMaquina } from '../../approvals/alcada';
import { lerAprovador } from '../../auth/aprovador';
import { PortaDoOperador, type AcaoRetida } from '../../gateway/porta-do-operador.service';
import { PolicyService } from '../../policy/policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EspelhoService } from '../espelho/espelho.service';
import { ReguaService } from '../regua/regua.service';
import {
  CAPACIDADES_DO_HISTORICO,
  CAMPOS_DO_TITULO,
  PedidoDeEscritaSchema,
  chamadaDoPedido,
  desfazerDaEscrita,
  eventoIdDaChave,
  linhaDoHistorico,
  tipoComMeet,
  tipoQueSeMarcaDe,
  type ChamadaRegistrada,
} from './escrita-pura';

/*
 * A ESCRITA NO GOOGLE PELA PORTA (agenda v2, 29/10/2026, lane G4, decisão 2).
 *
 * Todo pedido (marcar, alterar, cancelar, desmarcar, reabrir) passa pela régua
 * (vermelho sem `forcado` não sai: nada vai à porta) e vai à `PortaDoOperador`
 * com a capacidade do catálogo. `naTela: true` só quando quem pediu é GENTE,
 * relida aqui no banco (ativa, desta empresa, sem papel de máquina): é o único
 * caso em que a porta lê a `aprovacaoR2Ligada` da empresa (e ela confere de
 * novo). Agente, rotina, WhatsApp e link público chamam sem `naTela` e R2
 * continua retido.
 *
 * O que saiu é refletido no espelho na hora (`EspelhoService.refletir`), e o
 * resultado traz o pedido que DESFAZ: marcar → desmarcar; alterar → alterar com
 * antes e depois trocados; cancelar e desmarcar → reabrir (R3: esse não sai no
 * clique, nunca). O histórico é lido do registro da porta (`ToolCall`), sem
 * tabela nova.
 */
export interface QuemPedeAEscrita {
  orgId: string;
  /** `user` na tela; `system` no link público e nas rotinas; `ai` no agente. */
  actorType: 'user' | 'ai' | 'system';
  actorId: string | null;
  agentSlug?: string | null;
  /** Só o controlador da tela, depois de conferir no banco que é gente. */
  naTela?: boolean;
}

const RECUSA_DA_REGUA = 'A régua deu vermelho para este horário. Escolha outro, ou marque assim mesmo dizendo por quê. Nada foi enviado.';

const VERBO_FEITO: Record<PedidoDeEscrita['acao'], string> = {
  marcar: 'Marcado',
  alterar: 'Alterado',
  cancelar: 'Cancelado',
  desmarcar: 'Desmarcado',
  reabrir: 'Reaberto',
};

/** A chave do desfazer, derivada (o mesmo clique repetido manda a mesma chave). */
export function chaveDerivada(semente: string): string {
  const h = createHash('sha256').update(`mktos-desfazer:${semente}`, 'utf8').digest('hex');
  // hex é subconjunto de base32hex (0-9 a-f): cabe no padrão da chave.
  return h.slice(0, 32);
}

const normalizar = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

@Injectable()
export class EscritaDaAgendaService {
  private readonly log = new Logger('EscritaDaAgenda');

  constructor(
    private readonly prisma: PrismaService,
    private readonly porta: PortaDoOperador,
    private readonly regua: ReguaService,
    private readonly espelho: EspelhoService,
    private readonly policy: PolicyService,
  ) {}

  /** Gente de verdade, relida no banco: existe nesta empresa, ativa, sem papel de máquina. */
  async ehGente(orgId: string, actorId: string | null | undefined): Promise<boolean> {
    if (!actorId) return false;
    const pessoa = await lerAprovador(this.prisma, actorId, orgId);
    return !!pessoa && pessoa.ativo && !temPapelDeMaquina(pessoa.papeis);
  }

  async executar(quem: QuemPedeAEscrita, pedidoBruto: PedidoDeEscrita | unknown): Promise<ResultadoDaEscrita> {
    const lido = PedidoDeEscritaSchema.safeParse(pedidoBruto);
    if (!lido.success) {
      throw new BadRequestException({
        message: 'Pedido de escrita inválido.',
        erros: lido.error.issues.map((i) => `${i.path.join('.') || 'pedido'}: ${i.message}`),
      });
    }
    const pedido = lido.data as PedidoDeEscrita;
    const { orgId } = quem;

    // O título do marcar sai da gramática: o erro dela é 400 antes de qualquer outra coisa.
    if (pedido.acao === 'marcar') {
      try {
        montarTituloDeCompromisso(pedido.compromisso);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      if (Date.parse(pedido.compromisso.fim) <= Date.parse(pedido.compromisso.inicio)) {
        throw new BadRequestException('O compromisso tem de terminar depois de começar.');
      }
    }

    // A régua. Vermelho sem `forcado`: nada vai à porta.
    const proposta = this.propostaDaRegua(pedido);
    let regua: ResultadoDaRegua | undefined;
    if (proposta) {
      regua = await this.regua.avaliar(orgId, proposta);
      const forcado = pedido.acao === 'marcar' || pedido.acao === 'alterar' ? pedido.forcado : undefined;
      if (regua.cor === 'vermelho' && !forcado) {
        return {
          status: 'recusado',
          nivel: this.nivelDe(orgId, pedido),
          eventoId: this.alvoDe(orgId, pedido),
          approvalId: null,
          precisaDeOutraPessoa: false,
          mensagem: RECUSA_DA_REGUA,
          desfazer: null,
          regua,
        };
      }
    }

    // Os e-mails dos responsáveis, da Equipe (só cliente e interna os convidam).
    let semEmail: SocioDaAgenda[] = [];
    let daEquipe: string[] = [];
    if (pedido.acao === 'marcar' && tipoComMeet(pedido.compromisso.tipo)) {
      const r = await this.emailsDaEquipe(orgId, pedido.compromisso.responsaveis);
      daEquipe = r.emails;
      semEmail = r.semEmail;
    }

    const chamada = chamadaDoPedido(pedido, daEquipe);
    const naTela = quem.naTela === true && quem.actorType === 'user' && (await this.ehGente(orgId, quem.actorId));
    const actorType = quem.actorType === 'user' ? ActorType.user : quem.actorType === 'ai' ? ActorType.ai : ActorType.system;

    let r: unknown;
    try {
      r = await this.porta.executar({
        orgId,
        actorId: quem.actorId ?? quem.agentSlug ?? 'sistema',
        actorType,
        capabilityId: chamada.capacidade,
        args: chamada.args,
        resource: chamada.resource,
        ...(naTela ? { naTela: true } : {}),
      });
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() < 500) {
        const corpo = e.getResponse();
        const mensagem = typeof corpo === 'string' ? corpo : String((corpo as { message?: unknown }).message ?? e.message);
        return {
          status: 'recusado',
          nivel: this.nivelDe(orgId, pedido),
          eventoId: this.alvoDe(orgId, pedido),
          approvalId: null,
          precisaDeOutraPessoa: false,
          mensagem,
          desfazer: null,
          ...(regua ? { regua } : {}),
          ...(semEmail.length ? { responsaveisSemEmail: semEmail } : {}),
        };
      }
      throw e;
    }

    const retida = r as Partial<AcaoRetida>;
    if (retida && retida.status === 'aguardando_aprovacao') {
      const dePessoa = quem.actorType === 'user';
      return {
        status: 'aguardando_aprovacao',
        nivel: retida.nivel ?? this.nivelDe(orgId, pedido),
        eventoId: this.alvoDe(orgId, pedido),
        approvalId: retida.approvalId ?? null,
        precisaDeOutraPessoa: dePessoa,
        mensagem: dePessoa
          ? (retida.mensagem ?? 'Ficou na fila de aprovações: outra pessoa com alçada confirma.')
          : 'Ficou na fila de aprovações: uma pessoa da casa confirma.',
        desfazer: null,
        ...(regua ? { regua } : {}),
        ...(semEmail.length ? { responsaveisSemEmail: semEmail } : {}),
      };
    }

    // Executado: o efeito devolveu o evento como o Google o gravou.
    const feito = (r ?? {}) as { id?: string | null; titulo?: string | null; evento?: unknown; anterior?: never; depois?: never };
    if (feito.evento) {
      try {
        await this.espelho.refletir(orgId, feito.evento);
      } catch (e) {
        // O Google já mudou: o espelho alcança na próxima sincronia.
        this.log.warn(`espelho não refletiu a escrita (${(e as Error).message}); a sincronia alcança`);
      }
    }
    const desfazer = desfazerDaEscrita(pedido, feito, orgId, chaveDerivada(`${orgId}:${pedido.chave}`));
    const titulo = feito.titulo ?? null;
    return {
      status: 'executado',
      nivel: this.nivelDe(orgId, pedido),
      eventoId: feito.id ?? this.alvoDe(orgId, pedido),
      approvalId: null,
      precisaDeOutraPessoa: false,
      mensagem: `${VERBO_FEITO[pedido.acao]} na agenda${titulo ? `: ${titulo}` : ''}.`,
      desfazer,
      ...(regua ? { regua } : {}),
      ...(semEmail.length ? { responsaveisSemEmail: semEmail } : {}),
    };
  }

  /** O compromisso que a régua avalia. Nulo = o pedido não muda horário nem gente (sem régua). */
  private propostaDaRegua(pedido: PedidoDeEscrita): CompromissoProposto | null {
    if (pedido.acao === 'marcar') {
      const c = pedido.compromisso;
      return { tipo: c.tipo, modalidade: c.modalidade, responsaveis: c.responsaveis, inicio: c.inicio, fim: c.fim };
    }
    if (pedido.acao !== 'alterar') return null;
    const d = pedido.depois;
    const mexe = d.inicio !== undefined || d.fim !== undefined || CAMPOS_DO_TITULO.some((k) => d[k] !== undefined);
    if (!mexe) return null;
    const leitura = lerCompromisso(pedido.antes.titulo);
    const tipo = d.tipo ?? tipoQueSeMarcaDe(leitura.tipo);
    const responsaveis = d.responsaveis ?? leitura.responsaveis;
    if (!tipo || !responsaveis.length) return null;
    return {
      tipo,
      modalidade: d.modalidade ?? leitura.modalidade ?? null,
      responsaveis,
      inicio: d.inicio ?? pedido.antes.inicio,
      fim: d.fim ?? pedido.antes.fim,
      ignorarEventoId: pedido.eventoId,
    };
  }

  private alvoDe(orgId: string, pedido: PedidoDeEscrita): string | null {
    return pedido.acao === 'marcar' ? eventoIdDaChave(orgId, pedido.chave) : pedido.eventoId;
  }

  private nivelDe(orgId: string, pedido: PedidoDeEscrita): string {
    return this.policy.simular(orgId, chamadaDoPedido(pedido).capacidade).nivel;
  }

  /**
   * Os e-mails dos sócios na Equipe (usuário ativo do OS cujo primeiro nome é o
   * do sócio, sem papel de máquina). Dois candidatos ou nenhum = sem e-mail: o
   * convite segue sem ele e a resposta (e os Relatórios) dizem quem ficou de fora.
   */
  async emailsDaEquipe(orgId: string, socios: readonly SocioDaAgenda[]): Promise<{ emails: string[]; semEmail: SocioDaAgenda[] }> {
    const gente = await this.prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { name: true, email: true, roles: { select: { key: true } } },
    });
    const pessoas = gente.filter((u) => !temPapelDeMaquina(u.roles.map((r) => r.key)));
    const emails: string[] = [];
    const semEmail: SocioDaAgenda[] = [];
    for (const s of [...new Set(socios)]) {
      const candidatos = pessoas.filter((u) => normalizar(u.name).split(/\s+/)[0] === normalizar(s) && u.email);
      if (candidatos.length === 1) emails.push(candidatos[0].email.toLowerCase());
      else semEmail.push(s);
    }
    return { emails, semEmail };
  }

  /* -------------------------------------------------------------------------
   * O histórico
   * ----------------------------------------------------------------------- */

  async historico(orgId: string, opcoes: { eventoId?: string | null; limite?: number } = {}): Promise<LinhaDoHistorico[]> {
    const limite = Math.min(Math.max(Math.trunc(opcoes.limite ?? 30) || 30, 1), 200);
    const chamadas = await this.prisma.toolCall.findMany({
      where: { orgId, capabilityId: { in: CAPACIDADES_DO_HISTORICO } },
      orderBy: { criadoEm: 'desc' },
      take: opcoes.eventoId ? 500 : limite,
      select: { id: true, criadoEm: true, capabilityId: true, actorId: true, agentSlug: true, status: true, args: true, resultado: true },
    });
    const ids = [...new Set(chamadas.map((c) => c.actorId).filter((x): x is string => !!x))];
    const usuarios = ids.length
      ? await this.prisma.user.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const nomes = new Map(usuarios.map((u) => [u.id, u.name.split(/\s+/)[0] ?? u.name]));
    const nome = (actorId: string | null, agentSlug: string | null): string | null => {
      if (actorId && nomes.has(actorId)) return nomes.get(actorId)!;
      const quem = agentSlug ?? actorId;
      if (quem === 'link-de-escolha') return 'Link de escolha';
      if (quem === 'vigia-da-agenda') return 'Vigia da agenda';
      return quem ?? null;
    };

    const linhas: LinhaDoHistorico[] = [];
    const comVolta = new Set<string>();
    for (const c of chamadas as ChamadaRegistrada[]) {
      const l = linhaDoHistorico(c, orgId, nome);
      if (!l) continue;
      if (opcoes.eventoId && l.eventoId !== opcoes.eventoId) continue;
      if (l.desfazer) {
        // Só a escrita MAIS RECENTE de cada evento oferece desfazer: a de antes já foi passada por cima.
        const chave = l.eventoId ?? l.id;
        if (comVolta.has(chave)) l.desfazer = null;
        else l.desfazer = { ...l.desfazer, chave: chaveDerivada(l.id) } as PedidoDeEscrita;
      }
      if (l.status === 'executado') comVolta.add(l.eventoId ?? l.id);
      linhas.push(l);
      if (linhas.length >= limite) break;
    }
    return linhas;
  }

  /** A aprovação de R2 da empresa, para o cartão de Configurações (só leitura). */
  async aprovacaoR2(orgId: string): Promise<{ ligada: boolean; desde: string | null; versao: number | null; assinadoPor: string | null; motivo: string | null }> {
    const e = await this.policy.estadoDaAprovacaoR2(orgId);
    const autor = e.autorId
      ? await this.prisma.user.findFirst({ where: { orgId, id: e.autorId }, select: { name: true } })
      : null;
    return { ligada: e.ligada, desde: e.desde, versao: e.versao, assinadoPor: autor?.name ?? null, motivo: e.motivo };
  }
}
