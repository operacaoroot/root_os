import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { ActorType } from '@prisma/client';

import { destinoDoHash } from '../approvals/destino-do-mover';
import { RepedidosRegistry, type PedidoRefeito, type PedidoVencido } from '../approvals/repedidos.registry';
import { CAP_COBRANCA, CAP_CONTRATO, DinheiroService } from './dinheiro.service';
import { CAP_FECHAMENTO, FechamentoService } from './fechamento.service';
import { MoverService } from './mover.service';
import { CAPACIDADE_DA_PROPOSTA, PropostaService } from './proposta.service';
import { CAPACIDADE_DA_SALA, SalaVersaoService } from './sala-versao.service';
import { CAPACIDADE_DO_WHATSAPP, WhatsappComercialService } from './whatsapp.service';

/*
 * "PEDIR DE NOVO" NO COMERCIAL (rodada do trabalho T7, 19/10/2026).
 *
 * Cada pedido vencido do comercial volta à fila pelo MESMO caminho que o criou,
 * em nome de quem clicou em /atendimento, e esse caminho relê o conteúdo de
 * agora:
 *
 *   · mover o cartão (superfície do token) → `MoverService.pedir`, que relê a
 *     etapa atual, o destino permitido e os portões. O destino sai do HASH da
 *     vencida (o mesmo que a fila confere), nunca do resumo. O token novo volta
 *     só para quem clicou, que conclui no funil;
 *   · publicar a sala → `SalaVersaoService.publicar`, que remonta a versão
 *     aberta com o derivado de agora;
 *   · publicar a proposta → `PropostaService.repedirLiberacao`, que relê a
 *     versão vigente (versão velha não volta);
 *   · enviar o WhatsApp → `WhatsappComercialService.repedirEnvio`, que relê a
 *     mensagem guardada e o telefone do lead;
 *   · cobrança e contrato → `DinheiroService.proporAceite`, a mesma rota
 *     "propor de novo" que já existia, que relê o aceite;
 *   · fechamento → `FechamentoService.propor`, o "rodar de novo" de sempre.
 *
 * A permissão é a da rota de origem de cada um (`leads.editar`). Nenhum deles
 * reaproveita a aprovação vencida: cada um propõe à porta (ou cria o pedido do
 * token) do zero, e a régua de agora decide o nível.
 */

const PERMISSOES = ['leads.editar'];

/** O lead do pedido: dos argumentos gravados, ou do começo do recurso (`leadId:vN`, `leadId:hash`). */
function leadDoPedido(p: PedidoVencido): string {
  const doArg = p.args && typeof p.args.leadId === 'string' ? p.args.leadId : null;
  const id = doArg ?? p.resourceId.split(':')[0];
  if (!id) throw new ConflictException('O pedido vencido não diz de qual lead era.');
  return id;
}

/** A versão do pedido (`leadId:vN` ou `args.versao`). */
function versaoDoPedido(p: PedidoVencido): number {
  const doArg = p.args && typeof p.args.versao === 'number' ? p.args.versao : null;
  const m = /:v(\d+)$/.exec(p.resourceId);
  const v = doArg ?? (m ? Number(m[1]) : NaN);
  if (!Number.isInteger(v) || v < 1) throw new ConflictException('O pedido vencido não diz qual versão era.');
  return v;
}

@Injectable()
export class RepedidosDoComercial implements OnModuleInit {
  constructor(
    private readonly registro: RepedidosRegistry,
    private readonly mover: MoverService,
    private readonly salas: SalaVersaoService,
    private readonly propostas: PropostaService,
    private readonly whats: WhatsappComercialService,
    private readonly dinheiro: DinheiroService,
    private readonly fechamentos: FechamentoService,
  ) {}

  onModuleInit(): void {
    const quem = 'RepedidosDoComercial';
    this.registro.inscrever('legado:lead', { permissoes: PERMISSOES, repedir: (p) => this.moverDeNovo(p) }, quem);
    this.registro.inscrever(CAPACIDADE_DA_SALA, { permissoes: PERMISSOES, repedir: (p) => this.salaDeNovo(p) }, quem);
    this.registro.inscrever(CAPACIDADE_DA_PROPOSTA, { permissoes: PERMISSOES, repedir: (p) => this.propostaDeNovo(p) }, quem);
    this.registro.inscrever(CAPACIDADE_DO_WHATSAPP, { permissoes: PERMISSOES, repedir: (p) => this.whatsDeNovo(p) }, quem);
    this.registro.inscrever(CAP_COBRANCA, { permissoes: PERMISSOES, repedir: (p) => this.aceiteDeNovo(p, 'cobranca') }, quem);
    this.registro.inscrever(CAP_CONTRATO, { permissoes: PERMISSOES, repedir: (p) => this.aceiteDeNovo(p, 'contrato') }, quem);
    this.registro.inscrever(CAP_FECHAMENTO, { permissoes: PERMISSOES, repedir: (p) => this.fechamentoDeNovo(p) }, quem);
  }

  async moverDeNovo(p: PedidoVencido): Promise<PedidoRefeito> {
    const para = destinoDoHash(p.contentHash);
    if (!para) throw new ConflictException('O pedido vencido não era um mover do funil com destino conferido: peça pelo funil.');
    const pedido = await this.mover.pedir(p.orgId, p.resourceId, { para }, p.quem);
    return {
      approvalId: pedido.approvalId,
      aviso:
        'Pedido de novo, a partir da etapa de agora. Você pediu, então não assina: outra pessoa assina na fila, ' +
        'e depois você conclui no funil, nesta mesma aba.',
      paraQuemPediu: { moverDoFunil: { leadId: p.resourceId, pedido } },
    };
  }

  async salaDeNovo(p: PedidoVencido): Promise<PedidoRefeito> {
    const r = await this.salas.publicar(p.orgId, leadDoPedido(p), { id: p.quem.id });
    if (r.approvalId) return { approvalId: r.approvalId };
    return { approvalId: null, aviso: r.estado === 'publicada' ? 'A régua de hoje deixou publicar sem assinatura: a sala já está no ar.' : undefined };
  }

  async propostaDeNovo(p: PedidoVencido): Promise<PedidoRefeito> {
    const r = await this.propostas.repedirLiberacao(p.orgId, leadDoPedido(p), versaoDoPedido(p), p.approvalId, { id: p.quem.id });
    if (r.estado === 'na_porta' && r.approvalId) return { approvalId: r.approvalId };
    if (r.estado === 'na_fila') return { approvalId: null, aviso: `A v${r.versao} saiu da tabela e foi para Pendências: a decisão é de lá.` };
    if (r.estado === 'publicada') return { approvalId: null, aviso: `A régua de hoje deixou publicar sem assinatura: a v${r.versao} está no ar.` };
    throw new ConflictException(`A v${r.versao} ficou ${r.estado}: nada foi à fila.`);
  }

  async whatsDeNovo(p: PedidoVencido): Promise<PedidoRefeito> {
    const mensagemId = p.args && typeof p.args.mensagemId === 'string' ? p.args.mensagemId : p.resourceId;
    const r = await this.whats.repedirEnvio(p.orgId, mensagemId, p.approvalId, { id: p.quem.id });
    if (r.estado === 'na_fila' && r.approvalId) return { approvalId: r.approvalId };
    if (r.estado === 'em_veto') return { approvalId: null, aviso: 'A mensagem entrou na janela de veto do envio automático: ela sai sozinha se ninguém vetar.' };
    if (r.estado === 'enviada') return { approvalId: null, aviso: 'A régua de hoje deixou enviar sem assinatura: a mensagem já saiu.' };
    throw new ConflictException(`A mensagem ficou ${r.estado}: nada foi à fila.`);
  }

  async aceiteDeNovo(p: PedidoVencido, qual: 'cobranca' | 'contrato'): Promise<PedidoRefeito> {
    const r = await this.dinheiro.proporAceite(p.orgId, leadDoPedido(p), { id: p.quem.id, tipo: ActorType.user });
    if ('pulado' in r) throw new ConflictException(`Nada foi à fila: ${r.pulado}.`);
    const estado = r[qual];
    const outro = qual === 'cobranca' ? r.contrato : r.cobranca;
    const nome = qual === 'cobranca' ? 'A cobrança' : 'O contrato';
    if (estado === 'ja_existe') throw new ConflictException(`${nome} já existe: não há o que pedir.`);
    if (estado === 'na_fila') throw new ConflictException(`${nome} já tem um pedido vivo na fila.`);
    if (estado === 'executada') return { approvalId: null, aviso: `A régua de hoje deixou sair sem assinatura: ${nome.toLowerCase()} já foi feito.` };
    // A ordem de `approvalIds` é a de `proporAceite`: cobrança, depois contrato.
    const id = qual === 'cobranca' ? r.approvalIds[0] : r.approvalIds[r.approvalIds.length - 1];
    if (!id) throw new ConflictException('Nada foi à fila.');
    return {
      approvalId: id,
      aviso:
        outro === 'proposta'
          ? `Pedido de novo, com o aceite de agora. ${qual === 'cobranca' ? 'O contrato' : 'A cobrança'} também estava sem pedido vivo e foi junto. Você pediu, então não assina.`
          : undefined,
    };
  }

  async fechamentoDeNovo(p: PedidoVencido): Promise<PedidoRefeito> {
    const r = await this.fechamentos.propor(p.orgId, leadDoPedido(p), { id: p.quem.id, tipo: ActorType.user });
    if ('pulado' in r) throw new ConflictException(`Nada foi à fila: ${r.pulado}.`);
    if (r.estado === 'na_fila' && r.approvalId) return { approvalId: r.approvalId };
    if (r.estado === 'concluido') throw new ConflictException('O fechamento já foi concluído.');
    return { approvalId: null, aviso: 'A régua de hoje deixou fechar sem assinatura: o fechamento já rodou.' };
  }
}
