import { BadRequestException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApprovalState } from '@prisma/client';
import {
  motivoParaRecusarAnexo,
  tipoDoAnexo,
  type AnexoDaTarefa,
  type EstadoDoArquivoDoCliente,
} from '@mktos/shared';

import { AuditService } from '../../audit/audit.service';
import { ARQUIVISTA_DO_CLIENTE, type ArquivistaDoClientePort } from '../../clientes/portas';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

/*
 * TR-06 · O ANEXO NA TAREFA (rodada dos agentes, 21/10/2026, lane A4).
 *
 * O arquivo sobe no pop-up da tarefa (`?tarefa=`), fica no storage do OS
 * (`trabalho/anexos/<empresa>/<tarefa>/<sha256>`) e vira um `WorkAnexo`. A cópia
 * na pasta do cliente da tarefa é do arquivista (origem `anexo-da-tarefa`,
 * cliente = `WorkTask.clienteId`), que vai à porta (`drive.arquivo.enviar`, R3).
 * Tarefa de cliente interno ("Root (interno)") ou sem cliente: só no OS.
 *
 * O OS guarda e devolve o arquivo; nunca o abre, interpreta nem executa. O tipo
 * é conferido pelo tipo declarado E pela extensão (`motivoParaRecusarAnexo`), e
 * o download sai como anexo, sem o navegador tentar exibir.
 */

export interface ArquivoRecebido {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface ArmazemDoAnexo {
  put(chave: string, corpo: Buffer, tipo: string): Promise<void>;
  get(chave: string): Promise<{ stream: NodeJS.ReadableStream; size: number }>;
}

const nomeLimpo = (nome: string) =>
  String(nome ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || 'arquivo';

@Injectable()
export class AnexosDaTarefaService {
  private armazemDeTeste: ArmazemDoAnexo | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ARQUIVISTA_DO_CLIENTE) private readonly arquivista: ArquivistaDoClientePort,
    @Optional() private readonly storage?: StorageService,
  ) {}

  /** A suíte troca o storage por um dublê. */
  usarArmazem(a: ArmazemDoAnexo): void {
    this.armazemDeTeste = a;
  }
  private get armazem(): ArmazemDoAnexo | null {
    if (this.armazemDeTeste) return this.armazemDeTeste;
    return this.storage?.configured ? (this.storage as unknown as ArmazemDoAnexo) : null;
  }

  private async tarefa(orgId: string, taskId: string) {
    const t = await this.prisma.workTask.findFirst({
      where: { id: taskId, orgId },
      select: { id: true, clienteId: true, cliente: { select: { interno: true } } },
    });
    if (!t) throw new NotFoundException('Tarefa não encontrada.');
    return t;
  }

  async listar(orgId: string, taskId: string): Promise<AnexoDaTarefa[]> {
    const t = await this.tarefa(orgId, taskId);
    const anexos = await this.prisma.workAnexo.findMany({ where: { orgId, taskId }, orderBy: { criadoEm: 'desc' }, take: 200 });
    if (!anexos.length) return [];
    const copias = await this.prisma.arquivoDoCliente.findMany({
      where: { orgId, refTipo: 'WorkAnexo', refId: { in: anexos.map((a) => a.id) } },
      orderBy: { criadoEm: 'desc' },
    });
    const porAnexo = new Map<string, (typeof copias)[number]>();
    for (const c of copias) if (c.refId && !porAnexo.has(c.refId)) porAnexo.set(c.refId, c);
    // O pedido que espera aprovação só vale enquanto a aprovação está viva.
    const pedidos = copias.filter((c) => c.estado === 'aguardando_aprovacao' && c.approvalId).map((c) => c.approvalId!);
    const vivas = new Set(
      pedidos.length
        ? (
            await this.prisma.approval.findMany({
              where: { orgId, id: { in: pedidos }, status: { in: [ApprovalState.pendente, ApprovalState.confirmada] }, expiraEm: { gt: new Date() } },
              select: { id: true },
            })
          ).map((a) => a.id)
        : [],
    );
    const semCopia = !t.clienteId
      ? 'tarefa sem cliente: o anexo fica só no OS.'
      : t.cliente?.interno
        ? 'tarefa do cliente interno da casa: o anexo fica só no OS.'
        : 'a cópia na pasta do cliente não foi pedida.';
    return anexos.map((a) => {
      const c = porAnexo.get(a.id);
      const venceu = c?.estado === 'aguardando_aprovacao' && !vivas.has(c.approvalId ?? '');
      if (c && venceu) {
        return {
          id: a.id, nome: a.nome, tipoMime: a.tipoMime, bytes: a.bytes, autorNome: a.autorNome, criadoEm: a.criadoEm.toISOString(),
          estado: 'erro' as EstadoDoArquivoDoCliente, driveUrl: null, subpasta: c.subpasta ?? null,
          motivo: 'o pedido de cópia no Drive venceu ou foi recusado: anexe o arquivo de novo para pedir outra vez.', approvalId: null,
        };
      }
      return {
        id: a.id,
        nome: a.nome,
        tipoMime: a.tipoMime,
        bytes: a.bytes,
        autorNome: a.autorNome,
        criadoEm: a.criadoEm.toISOString(),
        estado: (c?.estado ?? 'so_no_os') as EstadoDoArquivoDoCliente,
        driveUrl: c?.estado === 'enviado' ? c.driveUrl ?? null : null,
        subpasta: c?.subpasta ?? null,
        motivo: c ? c.motivo ?? null : semCopia,
        approvalId: c?.estado === 'aguardando_aprovacao' ? c.approvalId ?? null : null,
      };
    });
  }

  async enviar(orgId: string, taskId: string, quem: { id: string; nome: string }, arquivo: ArquivoRecebido | undefined): Promise<AnexoDaTarefa> {
    if (!arquivo) throw new BadRequestException('nenhum arquivo enviado (campo "file").');
    const nome = nomeLimpo(arquivo.originalname);
    const recusa = motivoParaRecusarAnexo(nome, arquivo.mimetype, arquivo.buffer?.length ?? arquivo.size);
    if (recusa) throw new BadRequestException(recusa);
    const t = await this.tarefa(orgId, taskId);
    const armazem = this.armazem;
    if (!armazem) throw new ServiceUnavailableException('o storage do OS está indisponível: o anexo não foi guardado.');

    const tipoMime = tipoDoAnexo(nome, arquivo.mimetype);
    const sha256 = createHash('sha256').update(arquivo.buffer).digest('hex');
    const chave = `trabalho/anexos/${orgId}/${t.id}/${sha256}`;

    // O mesmo arquivo na mesma tarefa é o mesmo anexo.
    let anexo = await this.prisma.workAnexo.findFirst({ where: { orgId, taskId: t.id, sha256 } });
    if (!anexo) {
      await armazem.put(chave, arquivo.buffer, tipoMime);
      anexo = await this.prisma.workAnexo.create({
        data: { orgId, taskId: t.id, nome, tipoMime, bytes: arquivo.buffer.length, sha256, chave, autorId: quem.id, autorNome: quem.nome.slice(0, 200) || 'Sem nome' },
      });
      await this.audit.log({
        orgId,
        actorId: quem.id,
        action: 'trabalho.anexo.enviado',
        entityType: 'work_task',
        entityId: t.id,
        after: { anexoId: anexo.id, bytes: anexo.bytes, tipoMime, sha256 },
      });
    }

    if (t.clienteId && !t.cliente?.interno) {
      // Nunca lança: o anexo já está no OS, e o estado da cópia aparece na lista.
      await this.arquivista.arquivar({
        orgId,
        partnerId: t.clienteId,
        origem: 'anexo-da-tarefa',
        nomeOriginal: nome,
        tipoMime,
        conteudo: { chave, sha256, bytes: anexo.bytes },
        atorId: quem.id,
        ref: { tipo: 'WorkAnexo', id: anexo.id },
      });
    }
    const lista = await this.listar(orgId, t.id);
    return lista.find((a) => a.id === anexo!.id)!;
  }

  async baixar(orgId: string, taskId: string, anexoId: string) {
    await this.tarefa(orgId, taskId);
    const a = await this.prisma.workAnexo.findFirst({ where: { id: anexoId, orgId, taskId } });
    if (!a) throw new NotFoundException('Anexo não encontrado.');
    const armazem = this.armazem;
    if (!armazem) throw new ServiceUnavailableException('o storage do OS está indisponível.');
    const { stream } = await armazem.get(a.chave);
    return { stream, nome: a.nome, tipoMime: a.tipoMime, bytes: a.bytes };
  }
}
