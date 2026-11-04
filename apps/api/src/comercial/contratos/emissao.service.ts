import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import type { ContratoNaFicha } from '@mktos/shared';

import { FILA_DE_APROVACAO } from '../../gateway/fila-de-aprovacao';
import { PortaDoOperador } from '../../gateway/porta-do-operador.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContratoDaRootService } from '../contrato-da-root/contrato-da-root.service';
import { PdfComLacunaError, type PdfGerado } from '../contrato-da-root/pdf-do-contrato';
import { CAP_CONTRATO, DinheiroService } from '../dinheiro.service';
import { PORTA_DE_ASSINATURA, type PortaDeAssinatura } from '../portas/assinatura.port';
import { ContratosService, type QuemNoContrato } from './contratos.service';
import { aindaNaoEnviado, lerIdDoContrato } from './contratos-puro';
import { entradaDoRegistro, montarPdfDoRegistro, SemMinutaError } from './documento-do-registro';
import { assinaturaDaEntrada, camposEscritos, preencherRegistro } from './emissao-puro';
import { EfeitoComercialEscopoService } from '../../clientes-escopo/efeito-comercial-escopo.service';

/*
 * A EMISSÃO DO CONTRATO (Contratos, F2, 02/11/2026): minuta aprovada → PDF → pedido de envio pela porta.
 *
 *   · `gerarMinuta`: o molde da modalidade (a nota `comercial.contrato.modelo` na frente, quando existe) com o aceite,
 *     os campos do contrato e `faturaPor`. Sem IA, sai o preenchimento do sistema. Campo faltando é lacuna.
 *   · `previa`: o PDF de agora, sem gravar nada. Lacuna é 409 com a lista.
 *   · `proporEnvio`: recalcula, recusa com a lista do que falta, congela o estado com o hash do PDF e propõe
 *     `comercial.contrato.enviar` em nome de quem clicou (R4: fica retida, e quem clicou não assina).
 *
 * NADA SAI DAQUI PARA A ZAPSIGN. Quem chama `criarDocumento` é o efeito, em `DinheiroService.efeitoDoRegistro`, que
 * regera o PDF e confere o hash assinado.
 */
@Injectable()
export class EmissaoDoContratoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contratos: ContratosService,
    private readonly raiz: ContratoDaRootService,
    private readonly dinheiro: DinheiroService,
    private readonly operador: PortaDoOperador,
    @Inject(PORTA_DE_ASSINATURA) private readonly assinatura: PortaDeAssinatura,
    @Optional() private readonly escopo?: EfeitoComercialEscopoService,
  ) {}

  private registro(orgId: string, id: string) {
    return this.prisma.comercialContrato.findFirst({ where: { id, orgId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } });
  }

  /** Gera e vincula. Depois de enviado, a minuta não muda mais (`vincularMinuta` recusa). */
  async gerarMinuta(orgId: string, id: string, quem: QuemNoContrato, agora: Date = new Date()): Promise<ContratoNaFicha> {
    const pessoa = await this.contratos.exigirGente(orgId, quem);
    const assumido = await this.contratos.registroParaAgir(orgId, id, pessoa);
    if (!aindaNaoEnviado(assumido.estado)) throw new ConflictException('A minuta só muda antes de o contrato ir para assinatura.');
    const c = (await this.registro(orgId, assumido.id))!;
    const aceite = await this.dinheiro.aceiteParaContrato(orgId, c.leadId);
    const entrada = await entradaDoRegistro(this.prisma, orgId, c, aceite);
    const m = await this.raiz.gerarDoRegistro(orgId, c.leadId, aceite, { id: pessoa.id, nome: pessoa.nome }, { id: c.id, entrada });
    const anteriores = c.dadosDoContrato && typeof c.dadosDoContrato === 'object' && !Array.isArray(c.dadosDoContrato) ? (c.dadosDoContrato as Record<string, unknown>) : {};
    // Minuta nova desfaz o congelado do pedido anterior: aquele hash não vale mais.
    const { congelado: _congelado, ...semCongelado } = anteriores;
    await this.contratos.vincularMinuta(
      orgId,
      c.id,
      {
        minutaId: m.documentoId,
        hash: m.hash,
        por: pessoa.nome,
        dados: {
          ...semCongelado,
          lacunas: m.lacunas.length,
          minuta: {
            base: m.base,
            origem: m.origem,
            geradaEm: m.geradaEm,
            avisos: [...m.avisos, ...preencherRegistro(entrada).avisos.filter((a) => !m.avisos.includes(a))],
            entrada: assinaturaDaEntrada({ modalidade: c.modalidade, faturaPor: c.faturaPor, campos: camposEscritos(c.dadosDoContrato) }),
          },
        } as Prisma.InputJsonValue,
      },
      agora,
    );
    return this.contratos.ficha(orgId, c.id, agora);
  }

  async revisar(orgId: string, id: string, quem: QuemNoContrato, agora: Date = new Date()): Promise<ContratoNaFicha> {
    const pessoa = await this.contratos.exigirGente(orgId, quem);
    const c = await this.contratos.registroParaAgir(orgId, id, pessoa);
    if (!c.minutaId) throw new ConflictException('Este contrato ainda não tem minuta: gere a minuta primeiro.');
    await this.raiz.revisarDoRegistro(orgId, c.leadId, c.minutaId, await this.dinheiro.aceiteParaContrato(orgId, c.leadId), c.tipo);
    return this.contratos.ficha(orgId, c.id, agora);
  }

  /** O PDF de agora, ou a recusa em forma de 409 (`faltando` é o que a tela lista). */
  private async pdfDeAgora(orgId: string, id: string, leadId: string): Promise<PdfGerado> {
    const aceite = await this.dinheiro.aceiteParaContrato(orgId, leadId);
    try {
      return (await montarPdfDoRegistro(this.prisma, orgId, id, aceite)).pdf;
    } catch (e) {
      if (e instanceof PdfComLacunaError) {
        throw new ConflictException({ message: 'O PDF não sai enquanto houver lacuna.', faltando: e.lacunas.map((l) => `Preencher a lacuna: ${l}.`) });
      }
      if (e instanceof SemMinutaError) throw new ConflictException({ message: e.message, faltando: ['A minuta do contrato.'] });
      throw e;
    }
  }

  async previa(orgId: string, id: string): Promise<PdfGerado> {
    const alvo = lerIdDoContrato(id);
    if (alvo.tipo !== 'registro') throw new ConflictException({ message: 'Este contrato ainda não tem minuta: gere a minuta primeiro.', faltando: ['A minuta do contrato.'] });
    const c = await this.registro(orgId, alvo.id);
    if (!c) throw new NotFoundException('Contrato não encontrado.');
    return this.pdfDeAgora(orgId, c.id, c.leadId);
  }

  /** Recalcula tudo, congela e propõe à porta. Quem clicou é o proponente: R4 pede outra pessoa titular, com a senha. */
  async proporEnvio(orgId: string, id: string, quem: QuemNoContrato, agora: Date = new Date()): Promise<unknown> {
    const pessoa = await this.contratos.exigirGente(orgId, quem);
    const alvo = lerIdDoContrato(id);
    if (alvo.tipo !== 'registro') throw new ConflictException('Este contrato ainda não tem minuta: crie o contrato e gere a minuta antes.');
    if (!this.assinatura.configurada()) throw new ServiceUnavailableException('A ZapSign não tem token nesta instância: nada sai para assinatura. Quem contrata o plano de API são os sócios.');
    const c = await this.registro(orgId, alvo.id);
    if (!c) throw new NotFoundException('Contrato não encontrado.');
    if(!this.escopo) throw new ForbiddenException('A autorização da emissão está indisponível.');
    const clienteId=await this.escopo.clienteDoLead(orgId,c.leadId);
    if(c.partnerId!==clienteId) throw new ConflictException('O cliente do contrato mudou.');
    const conferir=async()=>{
      if(await this.escopo!.clienteDoLead(orgId,c.leadId)!==clienteId) throw new ConflictException('O cliente do contrato mudou.');
      await this.escopo!.exigirPessoa(orgId,pessoa.id,clienteId);
    };
    await conferir();
    if (!aindaNaoEnviado(c.estado)) throw new ConflictException('Este contrato já foi para assinatura ou terminou: não há o que enviar.');

    const ficha = await this.contratos.ficha(orgId, c.id, agora);
    if (ficha.faltaParaEnviar.length) throw new ConflictException({ message: 'Ainda falta o que está na lista para pedir a aprovação.', faltando: ficha.faltaParaEnviar });
    const aceite = await this.dinheiro.aceiteParaContrato(orgId, c.leadId);
    // `versao` é mínimo 1 no esquema da capacidade: sem aceite, o pedido nem seria válido. A ficha já recusou; aqui é a tranca.
    if (!aceite || aceite.versao < 1) throw new ConflictException('Este contrato não tem proposta aceita: a aprovação do envio prende a versão aceita. Registre o aceite antes de enviar.');
    const cliente = c.signatarios.find((s) => s.papel === 'cliente');
    if (!cliente) throw new ConflictException('Falta quem assina pelo cliente.');

    const { hash, paginas } = await this.pdfDeAgora(orgId, c.id, c.leadId);
    await conferir();
    const recurso = `${c.id}:${hash.slice(0, 16)}`;
    const viva = await this.dinheiro.aprovacaoViva(orgId, CAP_CONTRATO, recurso, agora);
    // O segundo clique responde como o primeiro. Conteúdo diferente é outro recurso: o pedido velho cai no hash do efeito.
    if (viva) {
      const ap=await this.prisma.approval.findFirst({where:{id:viva.id,orgId,propostoPorId:pessoa.id,propostoPorTipo:ActorType.user},select:{toolCallId:true}});
      const tc=ap?.toolCallId ? await this.prisma.toolCall.findFirst({where:{id:ap.toolCallId,orgId,approvalId:viva.id},select:{args:true}}) : null;
      const a=tc?.args as Record<string,unknown>|null;
      const origem=a?.origemCliente as Record<string,unknown>|null;
      if(!a || a.clienteId!==clienteId || !origem || origem.versao!==1 || origem.clienteId!==clienteId) throw new ConflictException('Já há outra proposta de envio para este contrato.');
      await conferir();
      return { status: 'aguardando_aprovacao', approvalId: viva.id, jaNaFila: true, precisaDeOutraPessoa: true, fila: FILA_DE_APROVACAO, mensagem: 'Este pedido já está na fila, esperando outra pessoa titular.' };
    }

    const dados = c.dadosDoContrato && typeof c.dadosDoContrato === 'object' && !Array.isArray(c.dadosDoContrato) ? (c.dadosDoContrato as Record<string, unknown>) : {};
    const congelado = {
      hashDoPdf: hash,
      paginas,
      versao: aceite.versao,
      minutaId: c.minutaId,
      modalidade: c.modalidade,
      faturaPor: c.faturaPor,
      signatarios: c.signatarios.map((s) => ({ ordem: s.ordem, papel: s.papel, nome: s.nome, email: s.email })),
      em: agora.toISOString(),
      por: pessoa.id,
    };
    await this.prisma.$transaction(async (tx) => {
      await this.contratos.cadeado(tx, orgId, c.leadId);
      if(await this.escopo!.clienteDoLead(orgId,c.leadId,tx)!==clienteId) throw new ConflictException('O cliente do contrato mudou.');
      await conferir();
      const n = await tx.comercialContrato.updateMany({
        where: { id: c.id,orgId,partnerId:clienteId,estado: c.estado, documentoId: null,atualizadoEm:c.atualizadoEm },
        data: { hashDoConteudo: hash, dadosDoContrato: { ...dados, congelado } as Prisma.InputJsonValue },
      });
      if (!n.count) throw new ConflictException('O contrato mudou agora há pouco. Recarregue antes de pedir.');
      await this.contratos.auditar(tx, orgId, pessoa.id, 'comercial.contrato.envio_pedido', c.id, { hashDoConteudo: c.hashDoConteudo }, { hashDoPdf: hash, versao: aceite.versao, paginas, signatarios: c.signatarios.length });
    });
    await conferir();
    return this.operador.executar({
      orgId,
      actorId: pessoa.id,
      actorType: ActorType.user,
      capabilityId: CAP_CONTRATO,
      args: { leadId: c.leadId, clienteId, origemCliente:{versao:1,clienteId}, versao: aceite.versao, hash, signatarioEmail: cliente.email, contratoId: c.id },
      resource: { type: 'comercial.contrato', id: recurso },
    });
  }
}
