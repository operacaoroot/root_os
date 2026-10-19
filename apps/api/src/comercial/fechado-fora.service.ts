import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  ClienteFechadoForaSchema,
  FECHADO_FORA_MAX_BYTES,
  PROCEDENCIA_DO_FECHADO_FORA,
  type ClienteFechadoForaInput,
  type ClienteFechadoForaResposta,
} from '@mktos/shared';
import { ActorType } from '@prisma/client';

import { temPapelDeMaquina } from '../approvals/alcada';
import { LeadsService } from '../leads/leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { normalizarTelefone } from './eventos';
import { chaveDoAnexo, camposDaDeclaracao, ehPdf, hashDaDeclaracao, payloadDaDeclaracao } from './fechado-fora';
import { FechamentoService, chaveDoFechamento } from './fechamento.service';
import { FichaService } from './ficha.service';
import { FioService, ReacoesRegistry } from './fio.service';

/*
 * REGISTRAR CLIENTE JÁ FECHADO (rodada do trabalho T1b, 19/10/2026).
 *
 * A única porta para quem fechou FORA do sistema (assinou antes do OS, ou veio
 * por indicação direta e assinou no papel). Fica no comercial, no Funil vivo;
 * a implantação não tem mais "+ adicionar". O caminho:
 *
 *   1. o lead nasce pela ENTRADA IDEMPOTENTE que já existe (`LeadsService.entrada`,
 *      origem `manual`, referência `fechado-fora:<CNPJ>`): o mesmo CNPJ cai no
 *      mesmo lead, e a entrada vai à auditoria como toda entrada;
 *   2. a ficha nasce (E1) e o dono é quem registrou (`dono.atribuido`, com a regra escrita);
 *   3. o PDF vai ao storage dos arquivos (o mesmo `StorageService` da sala), pela
 *      chave do conteúdo, e entra no fio como `contrato.anexado`;
 *   4. os dados que a pessoa digitou entram como `aceite.declarado`, com a
 *      procedência "registrado à mão: contrato assinado fora do sistema" (nunca
 *      como aceite do cliente na sala), e o hash deles com o do PDF;
 *   5. o fechamento é PROPOSTO à porta em nome de quem registrou: a mesma
 *      capacidade (`comercial.fechamento.executar`, R4), a mesma chave
 *      `fech-<lead>-v<n>`, a titular assina com senha em `/atendimento`, e quem
 *      registrou não assina o próprio registro (segunda pessoa).
 *
 * Repetir o mesmo registro (os mesmos dados e o mesmo PDF) não grava nada de
 * novo e devolve onde o fechamento está. Registro diferente para um lead que
 * ainda não fechou vira a versão seguinte (o pedido antigo deixa de valer: o
 * efeito confere a chave e o hash). Lead que já é cliente ativo recusa (409).
 *
 * Quando o fechamento conclui (`cliente.ativo`), a reação leva a ficha a
 * "Negócio fechado" com o motivo escrito: o funil não foi percorrido, e o fio
 * diz isso. É o que põe o contrato em Contratos vivos e o card na implantação.
 */

/** O armazém do PDF (o `StorageService`; a suíte troca por um dublê). */
export interface ArmazemDoAnexo {
  put(key: string, corpo: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ stream: Readable; contentType: string; size: number }>;
}
export const ARMAZEM_DO_ANEXO = 'ARMAZEM_DO_ANEXO';

/** Quem registra: gente da casa, com nome para a procedência. */
export interface QuemRegistra {
  id: string;
  nome: string | null;
  papeis: readonly string[];
  permissions: string[];
}

/** O arquivo como o multer entrega. */
export interface ArquivoRecebido {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const REGRA_DO_DONO = 'registrado à mão: dono é quem registrou o cliente fechado fora do sistema';

@Injectable()
export class FechadoForaService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly reacoes: ReacoesRegistry,
    private readonly fichas: FichaService,
    private readonly fechamento: FechamentoService,
    private readonly leads: LeadsService,
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional() @Inject(ARMAZEM_DO_ANEXO) private readonly armazem?: ArmazemDoAnexo,
  ) {}

  onModuleInit(): void {
    this.reacoes.inscrever('cliente.ativo', 'fechado-fora.etapa', (ev) => this.levarAoFechado(ev.orgId, ev.leadId, ev.eventoId, ev.em));
  }

  /** O corpo da rota: os dados vêm como JSON no campo `dados` do multipart, ao lado do PDF. */
  lerDados(bruto: unknown): ClienteFechadoForaInput {
    let corpo: unknown = bruto;
    if (typeof bruto === 'string') {
      try {
        corpo = JSON.parse(bruto);
      } catch {
        throw new BadRequestException('dados ilegíveis: mande o formulário de novo.');
      }
    }
    const r = ClienteFechadoForaSchema.safeParse(corpo ?? {});
    if (!r.success) throw new BadRequestException({ message: 'Registro inválido.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return r.data;
  }

  async registrar(orgId: string, quem: QuemRegistra, input: ClienteFechadoForaInput, arquivo: ArquivoRecebido | undefined): Promise<ClienteFechadoForaResposta> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException('Conta de máquina não registra cliente fechado: quem declara é gente da casa.');
    if (!arquivo || !arquivo.size) throw new BadRequestException('Anexe o contrato assinado em PDF.');
    if (arquivo.size > FECHADO_FORA_MAX_BYTES) throw new BadRequestException('PDF acima de 10 MB.');
    if (arquivo.mimetype !== 'application/pdf' || !ehPdf(arquivo.buffer)) throw new BadRequestException('O contrato assinado precisa ser um PDF.');
    const armazem = this.armazemDisponivel();
    if (!armazem) throw new ServiceUnavailableException('O envio de arquivo está indisponível agora: o registro não foi feito.');
    const pessoa = await this.prisma.user.findFirst({ where: { id: quem.id, orgId, isActive: true }, select: { id: true, name: true } });
    if (!pessoa) throw new ForbiddenException('Só gente ativa da empresa registra cliente fechado.');
    const nome = pessoa.name || quem.nome;

    const sha = createHash('sha256').update(arquivo.buffer).digest('hex');
    const campos = camposDaDeclaracao(input, sha);
    const hash = hashDaDeclaracao(campos);
    const telefone = normalizarTelefone(input.telefone);

    // 1. O lead pela entrada idempotente (o mesmo CNPJ cai no mesmo lead).
    const entrada = await this.leads.entrada(
      { orgId, sub: quem.id, permissions: quem.permissions },
      { origem: { tipo: 'manual', ref: `fechado-fora:${campos.cnpj}` }, nome: campos.razaoSocial, email: campos.email, telefone },
    );
    const leadId = entrada.id;

    // Já é cliente ativo? O mesmo registro de novo devolve onde está; outro registro recusa.
    const declaracoes = await this.prisma.leadEvent.findMany({ where: { leadId, orgId, type: 'aceite.declarado' }, orderBy: { occurredAt: 'asc' }, select: { payload: true } });
    const mesma = declaracoes.find((d) => String(((d.payload ?? {}) as Record<string, unknown>).hash ?? '') === hash);
    const ativo = await this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'cliente.ativo' }, select: { id: true } });
    if (ativo && !mesma) throw new ConflictException('Este cliente já está ativo: o contrato vivo dele está em Contratos vivos.');
    const daSala = await this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'proposta.aceita' }, select: { id: true } });
    if (daSala) throw new ConflictException('Este lead aceitou a proposta na sala: o fechamento dele segue pelo funil.');
    const versao = mesma ? Number(((mesma.payload ?? {}) as Record<string, unknown>).versao ?? 1) : declaracoes.length + 1;

    // 2. A ficha (E1) e o dono: quem registrou.
    await this.fichas.garantir(orgId, leadId);
    await this.fio.registrar(orgId, leadId, 'dono.atribuido', 'fechado-fora', { donoId: pessoa.id, donoNome: nome, regra: REGRA_DO_DONO });

    // 3. O PDF no storage e no fio.
    const chave = chaveDoAnexo(leadId, sha);
    const nomeDoArquivo = arquivo.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'contrato.pdf';
    await armazem.put(chave, arquivo.buffer, 'application/pdf');
    await this.fio.registrar(orgId, leadId, 'contrato.anexado', sha, {
      nome: nomeDoArquivo,
      bytes: arquivo.size,
      tipo: 'application/pdf',
      sha256: sha,
      chave,
      assinadoEm: input.assinadoEm,
      procedencia: PROCEDENCIA_DO_FECHADO_FORA,
      por: nome,
    });

    // 4. O aceite declarado (a chave do fato é o hash: o mesmo registro cai no mesmo fato).
    const gravado = await this.fio.registrar(orgId, leadId, 'aceite.declarado', hash, payloadDaDeclaracao(campos, versao, { id: pessoa.id, nome }));

    // 5. O fechamento, proposto à porta em nome de quem registrou (R4: a titular assina; não quem registrou).
    const r = await this.fechamento.propor(orgId, leadId, { id: quem.id, tipo: ActorType.user });
    const fechamento = 'pulado' in r ? { estado: 'pulado', approvalId: null, pulado: r.pulado } : { estado: r.estado, approvalId: r.approvalId ?? null, pulado: null };
    return {
      leadId,
      leadNovo: entrada.criado,
      registroNovo: gravado.novo,
      versao,
      chave: chaveDoFechamento(leadId, versao),
      anexo: { sha256: sha, nome: nomeDoArquivo, bytes: arquivo.size },
      fechamento,
    };
  }

  /** O PDF anexado de um lead (o mais novo), para quem confere antes de assinar. */
  async anexo(orgId: string, leadId: string): Promise<{ stream: Readable; contentType: string; size: number; nome: string }> {
    const fato = await this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'contrato.anexado' }, orderBy: { occurredAt: 'desc' }, select: { payload: true } });
    if (!fato) throw new NotFoundException('Este lead não tem contrato anexado.');
    const p = (fato.payload ?? {}) as Record<string, unknown>;
    const armazem = this.armazemDisponivel();
    if (!armazem) throw new ServiceUnavailableException('O storage de arquivos está indisponível agora.');
    const obj = await armazem.get(String(p.chave ?? ''));
    return { ...obj, nome: String(p.nome ?? 'contrato.pdf') };
  }

  /**
   * Reação a `cliente.ativo`: o lead registrado à mão vai a "Negócio fechado". Só com o aceite
   * declarado no fio e sem aceite da sala (o lead do funil chega a E9 pelos portões, como sempre).
   */
  async levarAoFechado(orgId: string, leadId: string, eventoId: string, em: Date): Promise<unknown> {
    const [declarado, daSala] = await Promise.all([
      this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'aceite.declarado' }, select: { id: true } }),
      this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'proposta.aceita' }, select: { id: true } }),
    ]);
    if (!declarado || daSala) return { pulado: 'não é cliente fechado fora do sistema' };
    const r = await this.fichas.mudarEtapa(orgId, leadId, 'fechado', {
      motivo: 'cliente fechado fora do sistema: contrato assinado fora e anexado, fechamento aprovado; as etapas do funil não foram percorridas',
      eventoGatilho: eventoId,
      agora: em,
      fechadoForaDoSistema: true,
    });
    return { etapa: r.para, mudou: r.mudou, faltando: r.faltando };
  }

  private armazemDisponivel(): ArmazemDoAnexo | null {
    if (this.armazem) return this.armazem;
    try {
      return this.moduleRef?.get(StorageService, { strict: false }) ?? null;
    } catch {
      return null;
    }
  }
}
