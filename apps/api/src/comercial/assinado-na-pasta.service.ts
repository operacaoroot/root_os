import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { SUBPASTA_DO_CONTRATO } from '@mktos/shared';

import { ARQUIVISTA_DO_CLIENTE, type ArquivistaDoClientePort, type ResultadoDoArquivo } from '../clientes/portas';
import { PrismaService } from '../prisma/prisma.service';
import { FioService, ReacoesRegistry } from './fio.service';
import { PORTA_DE_ASSINATURA, type PortaDeAssinatura } from './portas/assinatura.port';

/*
 * O CONTRATO ASSINADO NA PASTA DO CLIENTE (rodada dos agentes, 21/10/2026, CO-08 Assinador).
 *
 * Quando o webhook da ZapSign diz que as duas partes assinaram, o dinheiro grava
 * `contrato.assinado` e a URL do provedor fica no `ComercialDocumento.pdfUrl`,
 * como antes. Esta reação faz a CÓPIA: o conector baixa o PDF assinado (relendo
 * o documento no provedor, nunca pela URL do corpo do webhook) e entrega ao
 * arquivista do cliente (`ARQUIVISTA_DO_CLIENTE`, lane do Drive), com a
 * subpasta já decidida (`02-contrato`) e a origem `contrato-assinado`. Quem
 * escreve no Drive é o arquivista, pela porta (`drive.arquivo.enviar`, R3).
 *
 * NADA AQUI DERRUBA NADA: o arquivista "ainda não ligado", o Drive fora do ar,
 * o provedor sem PDF ou um arquivo que não é PDF viram o fato
 * `documento.na_pasta` com o estado e o motivo, no fio do lead. A reação não
 * lança: o fechamento, que espera as duas assinaturas, não depende da cópia.
 * O cliente ainda pode não ter pasta (a assinatura vem antes do fechamento): o
 * arquivista guarda na fila e manda quando a pasta nascer (`na_fila`).
 */

export const REACAO_DO_ASSINADOR = 'assinador.copiar-para-pasta';

export interface CopiaDoAssinado {
  estado: string;
  motivo: string | null;
  subpasta: string | null;
  nome: string | null;
  approvalId: string | null;
  url: string | null;
  sha256: string | null;
}

/** O resultado do arquivista no vocabulário do fato (puro). */
export function copiaDoResultado(r: ResultadoDoArquivo, sha256: string | null): CopiaDoAssinado {
  const base: CopiaDoAssinado = { estado: r.estado, motivo: null, subpasta: null, nome: null, approvalId: null, url: null, sha256 };
  switch (r.estado) {
    case 'enviado':
      return { ...base, subpasta: r.subpasta, nome: r.nome, url: r.url };
    case 'aguardando_aprovacao':
      return { ...base, subpasta: r.subpasta, nome: r.nome, approvalId: r.approvalId, motivo: 'o envio espera a aprovação de outra pessoa em /atendimento' };
    case 'classificar_a_mao':
      return { ...base, motivo: `virou pendência para uma pessoa classificar (${r.pendenciaId})` };
    case 'na_fila':
    case 'so_no_os':
    case 'erro':
      return { ...base, motivo: r.motivo };
  }
}

@Injectable()
export class AssinadoNaPastaService implements OnModuleInit {
  private readonly log = new Logger('ComercialAssinadoNaPasta');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly reacoes: ReacoesRegistry,
    @Inject(PORTA_DE_ASSINATURA) private readonly assinatura: PortaDeAssinatura,
    @Optional() @Inject(ARQUIVISTA_DO_CLIENTE) private readonly arquivista?: ArquivistaDoClientePort,
  ) {}

  onModuleInit(): void {
    this.reacoes.inscrever('contrato.assinado', REACAO_DO_ASSINADOR, (ev) => this.copiar(ev.orgId, ev.leadId, ev.payload.documentoId, ev.payload.externoId));
  }

  /** Copia o PDF assinado para `02-contrato` e grava o fato com o estado. Nunca lança. */
  async copiar(orgId: string, leadId: string, documentoId: string, externoId: string): Promise<CopiaDoAssinado> {
    const doc = await this.prisma.comercialDocumento.findFirst({ where: { id: documentoId, orgId, leadId }, select: { externoId: true, assinadoRootEm: true, assinadoClienteEm: true } });
    let copia: CopiaDoAssinado;
    if (!doc) {
      copia = { estado: 'erro', motivo: 'o documento assinado não é deste lead nesta empresa', subpasta: null, nome: null, approvalId: null, url: null, sha256: null };
    } else if (!this.arquivista) {
      copia = { estado: 'so_no_os', motivo: 'o arquivista do cliente não está disponível nesta instância: fica a URL do provedor', subpasta: null, nome: null, approvalId: null, url: null, sha256: null };
    } else if (!this.assinatura.baixarAssinado) {
      copia = { estado: 'erro', motivo: `o conector de assinatura (${this.assinatura.provedor}) não baixa o PDF assinado`, subpasta: null, nome: null, approvalId: null, url: null, sha256: null };
    } else {
      copia = await this.baixarEArquivar(orgId, leadId, externoId, doc.assinadoRootEm ?? doc.assinadoClienteEm ?? new Date());
    }
    await this.fio
      .registrar(orgId, leadId, 'documento.na_pasta', `contrato-assinado:${externoId}:${copia.estado}`, {
        origem: 'contrato-assinado',
        ref: externoId,
        estado: copia.estado,
        subpasta: copia.subpasta,
        nome: copia.nome,
        motivo: copia.motivo,
        approvalId: copia.approvalId,
        url: copia.url,
        sha256: copia.sha256,
      })
      .catch((e: Error) => this.log.warn(`contrato assinado do lead ${leadId}: o fato da cópia não foi gravado (${e.message})`));
    return copia;
  }

  private async baixarEArquivar(orgId: string, leadId: string, externoId: string, assinadoEm: Date): Promise<CopiaDoAssinado> {
    try {
      const pdf = await this.assinatura.baixarAssinado!(externoId);
      if (!pdf) return { estado: 'erro', motivo: 'o provedor não devolveu o PDF assinado (documento sem arquivo final)', subpasta: null, nome: null, approvalId: null, url: null, sha256: null };
      const sha256 = createHash('sha256').update(pdf.buffer).digest('hex');
      const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { partnerId: true, empresa: true } });
      const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true } });
      const r = await this.arquivista!.arquivar({
        orgId,
        partnerId: ficha?.partnerId ?? null,
        leadId,
        origem: 'contrato-assinado',
        nomeOriginal: `contrato-assinado-${externoId.slice(0, 12)}.pdf`,
        tipoMime: pdf.tipoMime,
        conteudo: { buffer: pdf.buffer },
        subpasta: SUBPASTA_DO_CONTRATO,
        tipo: 'Contrato assinado',
        titulo: ficha?.empresa ?? lead?.name ?? 'cliente',
        data: assinadoEm,
      });
      return copiaDoResultado(r, sha256);
    } catch (e) {
      return { estado: 'erro', motivo: (e as Error).message.slice(0, 400), subpasta: null, nome: null, approvalId: null, url: null, sha256: null };
    }
  }
}
