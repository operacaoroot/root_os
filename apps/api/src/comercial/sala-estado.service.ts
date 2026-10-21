import { CanActivate, ConflictException, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalState } from '@prisma/client';
import type { EntregaDoLinkDaSala, EstadoDaSalaNoPainel, LinkDaSalaCopiado, MarcoDaSala } from '@mktos/shared';

import { temPapelDeMaquina } from '../approvals/alcada';
import { AuditService } from '../audit/audit.service';
import { lerAprovador } from '../auth/aprovador';
import type { JwtUser } from '../auth/current-user.decorator';
import { FILA_DE_APROVACAO } from '../gateway/fila-de-aprovacao';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { PrismaService } from '../prisma/prisma.service';
import { SalaService } from './sala.service';
import { MARCADOR_DO_LINK_DA_SALA, salaAtiva, segredoDoAmbiente } from './sala-token';

/*
 * QUANDO A SALA ENTRA (rodada de produção 1, P9, 21/10/2026).
 *
 * "Por que a sala não está funcionando na construção do lead; em que momento
 * ela entra." A resposta é a linha do tempo REAL da sala deste lead, lida do
 * que está gravado e nunca inventada:
 *   · CRIADA: a `SalaDoCliente` e o fato `sala.aberta`; "por qual fato" é a
 *     reação `sala.abrir` ao `lead.chegou` (a tabela `ComercialReacao`);
 *   · LINK ENTREGUE: a mensagem de saída ao lead que carrega o MARCADOR do link
 *     (o texto gravado nunca tem o link em claro, B-1). Enviada por um provedor
 *     de verdade = entregue; enviada pelo `simulado` = "não entregue: WhatsApp
 *     simulado", porque o simulado não manda nada a ninguém;
 *   · VERSÃO PUBLICADA e VERSÃO NA PORTA: `SalaVersao` e a aprovação dela (viva
 *     ou vencida), com o caminho de Aprovações;
 *   · ÚLTIMA VISITA: `SalaDoCliente.ultimoAcessoEm` e `acessos` (só gente; a
 *     pré-visualização de link não conta, B-11).
 *
 * COPIAR O LINK é a única saída do link em claro fora do envio. Só gente com
 * `leads.editar` (o guarda pelo token, o serviço relê no banco), e a auditoria
 * `sala.link.copiado` diz quem e quando, nunca o token. A resposta não passa
 * por log nenhum (o interceptor de contexto não grava corpo de resposta).
 */

export const RECUSA_DE_MAQUINA_NA_SALA = 'Copiar o link da sala é de gente: conta de serviço (IA) não recebe o link do cliente.';

/** Conta de máquina não copia o link (pelo token, antes do serviço). O serviço confere de novo pelo banco. */
@Injectable()
export class SoGenteNaSalaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) throw new ForbiddenException(RECUSA_DE_MAQUINA_NA_SALA);
    return true;
  }
}

const PROVEDORES: Record<string, string> = {
  simulado: 'WhatsApp simulado',
  evolution: 'Evolution',
  digisac: 'DigiSac',
  meta: 'WhatsApp Cloud (Meta)',
};
const nomeDoProvedor = (p: string | null | undefined): string => (p ? (PROVEDORES[p] ?? p) : 'provedor desconhecido');

function nomeDaMensagem(template: string | null): string {
  if (template === 'M1') return 'a primeira mensagem (M1)';
  return template ? `a mensagem ${template}` : 'uma mensagem escrita à mão';
}

const PENDENTES = new Set(['rascunho', 'na_fila', 'em_veto', 'enviando']);
const ESTADO_PENDENTE: Record<string, string> = {
  rascunho: 'em rascunho',
  na_fila: 'esperando liberação em Aprovações',
  em_veto: 'na janela de veto',
  enviando: 'saindo agora',
};

interface MensagemDoLink {
  id: string;
  template: string | null;
  provedor: string;
  estado: string;
  enviadaEm: Date | null;
  criadoEm: Date;
}

/** Como o link chegou ao cliente, pela primeira mensagem que conta (função pura, testada à parte). */
export function entregaDoLink(mensagens: MensagemDoLink[]): { entrega: EntregaDoLinkDaSala; marco: MarcoDaSala } {
  const enviadas = mensagens.filter((m) => m.estado === 'enviada');
  const real = enviadas.find((m) => m.provedor !== 'simulado');
  if (real) {
    return {
      entrega: 'entregue',
      marco: {
        tipo: 'link',
        rotulo: 'Link entregue ao cliente',
        em: (real.enviadaEm ?? real.criadoEm).toISOString(),
        detalhe: `Por ${nomeDaMensagem(real.template)}, pelo ${nomeDoProvedor(real.provedor)}.`,
        tom: 'bom',
      },
    };
  }
  const simulada = enviadas[0];
  if (simulada) {
    return {
      entrega: 'simulado',
      marco: {
        tipo: 'link',
        rotulo: 'Não entregue: WhatsApp simulado',
        em: (simulada.enviadaEm ?? simulada.criadoEm).toISOString(),
        detalhe: `${nomeDaMensagem(simulada.template)[0].toUpperCase()}${nomeDaMensagem(simulada.template).slice(1)} saiu pelo provedor simulado: o cliente não recebeu nada. Copie o link e mande por outro canal.`,
        tom: 'alerta',
      },
    };
  }
  const pendente = mensagens.find((m) => PENDENTES.has(m.estado));
  if (pendente) {
    return {
      entrega: 'preparado',
      marco: {
        tipo: 'link',
        rotulo: 'Link preparado, ainda não saiu',
        em: pendente.criadoEm.toISOString(),
        detalhe: `Está em ${nomeDaMensagem(pendente.template)}, ${ESTADO_PENDENTE[pendente.estado] ?? pendente.estado}.`,
        tom: 'alerta',
        link: pendente.estado === 'na_fila' ? FILA_DE_APROVACAO : null,
      },
    };
  }
  const falhou = mensagens.find((m) => m.estado === 'falhou');
  if (falhou) {
    return {
      entrega: 'falhou',
      marco: {
        tipo: 'link',
        rotulo: 'O envio do link falhou',
        em: falhou.criadoEm.toISOString(),
        detalhe: `${nomeDaMensagem(falhou.template)[0].toUpperCase()}${nomeDaMensagem(falhou.template).slice(1)} não saiu pelo ${nomeDoProvedor(falhou.provedor)}. Veja o motivo na aba Fio.`,
        tom: 'ruim',
      },
    };
  }
  return {
    entrega: 'nao_preparado',
    marco: {
      tipo: 'link',
      rotulo: 'Link ainda não enviado',
      em: null,
      detalhe: 'Nenhuma mensagem ao cliente levou o link da sala até agora.',
      tom: 'neutro',
    },
  };
}

@Injectable()
export class SalaEstadoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sala: SalaService,
    private readonly audit: AuditService,
  ) {}

  async estado(orgId: string, leadId: string, agora: Date = new Date()): Promise<EstadoDaSalaNoPainel> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const sala = await this.prisma.salaDoCliente.findFirst({
      where: { leadId, orgId },
      select: { id: true, criadoEm: true, validoAte: true, revogadoEm: true, acessos: true, ultimoAcessoEm: true, tokenCifrado: true },
    });
    if (!sala) {
      return {
        leadId,
        temSala: false,
        ativa: false,
        validaAte: null,
        entrega: 'sem_sala',
        linkDisponivel: false,
        marcos: [
          {
            tipo: 'criada',
            rotulo: 'Sala ainda não criada',
            em: null,
            detalhe: 'Ela nasce quando o lead entra pelo fio (o fato "lead.chegou").',
            tom: 'neutro',
          },
        ],
      };
    }

    const [aberta, reacao, mensagens, publicada, aberto] = await Promise.all([
      this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'sala.aberta' }, orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }),
      this.prisma.comercialReacao.findFirst({ where: { leadId, orgId, reacao: 'sala.abrir' }, orderBy: { criadoEm: 'asc' }, select: { eventoId: true } }),
      this.prisma.comercialMensagem.findMany({
        where: { leadId, orgId, direcao: 'saida', destino: 'lead', texto: { contains: MARCADOR_DO_LINK_DA_SALA } },
        orderBy: { criadoEm: 'asc' },
        take: 50,
        select: { id: true, template: true, provedor: true, estado: true, enviadaEm: true, criadoEm: true },
      }),
      this.prisma.salaVersao.findFirst({ where: { leadId, orgId, estado: 'publicada' }, orderBy: { numero: 'desc' }, select: { numero: true, publicadaEm: true, atualizadoEm: true, publicadaPor: true } }),
      this.prisma.salaVersao.findFirst({ where: { leadId, orgId, estado: { in: ['rascunho', 'na_porta'] } }, select: { numero: true, estado: true, approvalId: true, atualizadoEm: true } }),
    ]);
    const chegada = reacao
      ? await this.prisma.leadEvent.findFirst({ where: { id: reacao.eventoId, orgId }, select: { type: true, occurredAt: true } })
      : null;

    const marcos: MarcoDaSala[] = [];
    marcos.push({
      tipo: 'criada',
      rotulo: 'Sala criada',
      em: (aberta?.occurredAt ?? sala.criadoEm).toISOString(),
      detalhe: chegada
        ? `Na chegada do lead (o fato "${chegada.type}").`
        : 'Fora da chegada do lead: o OS abriu a sala ao preparar uma mensagem ou a agenda.',
      tom: 'bom',
    });

    const { entrega, marco } = entregaDoLink(mensagens);
    marcos.push(marco);

    if (publicada) {
      const quem = publicada.publicadaPor
        ? await this.prisma.user.findFirst({ where: { id: publicada.publicadaPor, orgId }, select: { name: true } })
        : null;
      marcos.push({
        tipo: 'publicada',
        rotulo: `Versão ${publicada.numero} publicada`,
        em: (publicada.publicadaEm ?? publicada.atualizadoEm).toISOString(),
        detalhe: quem?.name ? `Liberada por ${quem.name}. É o que o cliente vê agora.` : 'É o que o cliente vê agora.',
        tom: 'bom',
      });
    } else {
      marcos.push({
        tipo: 'publicada',
        rotulo: 'Nenhuma versão publicada',
        em: null,
        detalhe: 'O cliente vê a sala sem o quadro de implantação.',
        tom: 'neutro',
      });
    }

    if (aberto?.estado === 'na_porta' && aberto.approvalId) {
      const aprovacao = await this.prisma.approval.findFirst({ where: { id: aberto.approvalId, orgId }, select: { status: true, expiraEm: true, criadoEm: true } });
      const viva = aprovacao && (aprovacao.status === ApprovalState.confirmada || (aprovacao.status === ApprovalState.pendente && aprovacao.expiraEm > agora));
      marcos.push(
        viva
          ? {
              tipo: 'na_porta',
              rotulo: `Versão ${aberto.numero} esperando outra pessoa`,
              em: (aprovacao?.criadoEm ?? aberto.atualizadoEm).toISOString(),
              detalhe: 'Ela só aparece para o cliente depois que outra pessoa liberar em Aprovações.',
              tom: 'alerta',
              link: FILA_DE_APROVACAO,
            }
          : {
              tipo: 'na_porta',
              rotulo: `O pedido da versão ${aberto.numero} não vale mais`,
              em: (aprovacao?.criadoEm ?? aberto.atualizadoEm).toISOString(),
              detalhe: 'Venceu ou foi recusado em Aprovações. Publique de novo para pedir a liberação.',
              tom: 'ruim',
            },
      );
    } else if (aberto?.estado === 'rascunho') {
      marcos.push({
        tipo: 'na_porta',
        rotulo: `Versão ${aberto.numero} em rascunho`,
        em: aberto.atualizadoEm.toISOString(),
        detalhe: 'Ainda não foi pedida a liberação. O cliente não vê o rascunho.',
        tom: 'neutro',
      });
    }

    marcos.push(
      sala.ultimoAcessoEm
        ? {
            tipo: 'visita',
            rotulo: 'Última visita do cliente',
            em: sala.ultimoAcessoEm.toISOString(),
            detalhe: sala.acessos === 1 ? 'Uma visita até agora.' : `${sala.acessos} visitas até agora.`,
            tom: 'bom',
          }
        : { tipo: 'visita', rotulo: 'O cliente ainda não abriu a sala', em: null, detalhe: 'Pré-visualização de link no WhatsApp não conta como visita.', tom: 'neutro' },
    );

    const ativa = salaAtiva(sala, agora);
    if (!ativa) {
      marcos.push({
        tipo: 'validade',
        rotulo: sala.revogadoEm ? 'Sala revogada' : 'Sala vencida',
        em: (sala.revogadoEm ?? sala.validoAte).toISOString(),
        detalhe: 'O link não abre mais para o cliente.',
        tom: 'ruim',
      });
    }

    return {
      leadId,
      temSala: true,
      ativa,
      validaAte: sala.validoAte.toISOString(),
      entrega,
      linkDisponivel: ativa && !!sala.tokenCifrado && !!segredoDoAmbiente(),
      marcos,
    };
  }

  /**
   * "Copiar link da sala": o link em claro, SÓ nesta resposta. Gente relida no
   * banco (ativa, desta empresa, sem papel de máquina e com `leads.editar`
   * agora), sala ativa, e a auditoria diz quem e quando, sem o token.
   */
  async copiarLink(orgId: string, leadId: string, quem: { id: string; papeis: readonly string[] }): Promise<LinkDaSalaCopiado> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA_NA_SALA);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem copia o link precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA_NA_SALA);
    await exigirAcessoAtual(this.prisma, orgId, quem.id, ['leads.editar']);

    const sala = await this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId }, select: { id: true, validoAte: true, revogadoEm: true } });
    if (!sala) throw new NotFoundException('Este lead ainda não tem sala: ela nasce quando o lead entra.');
    if (!salaAtiva(sala)) throw new ConflictException('A sala deste lead venceu ou foi revogada: o link não abre mais.');
    const link = await this.sala.linkDoLead(orgId, leadId);
    if (!link) throw new ConflictException('O link desta sala não pode ser reescrito agora (falta a chave de cifra do ambiente).');

    await this.audit.log({
      orgId,
      actorId: quem.id,
      action: 'sala.link.copiado',
      entityType: 'sala_do_cliente',
      entityId: sala.id,
      // Quem e quando (o registro já leva a hora). Nunca o token nem o link.
      after: { leadId, validaAte: sala.validoAte.toISOString() },
    });
    return { link, validaAte: sala.validoAte.toISOString() };
  }
}
