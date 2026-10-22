import type { Readable } from 'node:stream';

import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  COMERCIAL_ROTULO_DA_ETAPA,
  ClienteFechadoForaSchema,
  ehSaida,
  type ComercialEtapa,
  PROCEDENCIA_DO_FECHADO_FORA,
  type ClienteFechadoForaInput,
  type ClienteFechadoForaResposta,
} from '@mktos/shared';
import { ActorType } from '@prisma/client';

import { temPapelDeMaquina } from '../approvals/alcada';
import { QuemNaoAssinaRegistry, type QuemNaoAssina } from '../approvals/quem-nao-assina.registry';
import { leadIdDaEntrada } from '../leads/entrada-de-lead';
import { LeadsService } from '../leads/leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { ARMAZEM_DO_ANEXO, armazemDisponivel, conferirPdfRecebido, nomeDoPdf, sha256DoArquivo, type ArmazemDoAnexo, type ArquivoRecebido } from './anexo-do-contrato';
import { hojeEmSP } from './dinheiro.service';
import { eventoIdComercial, normalizarTelefone } from './eventos';
import { chaveDoAnexo, camposDaDeclaracao, hashDaDeclaracao, payloadDaDeclaracao } from './fechado-fora';
import { CAP_FECHAMENTO, FechamentoService, chaveDoFechamento } from './fechamento.service';
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

// O armazém e a conferência do PDF moram em `anexo-do-contrato.ts` (produção 22, M2: o anexo do
// contrato importado usa os mesmos); reexportados aqui para quem já importava deste arquivo.
export { ARMAZEM_DO_ANEXO, type ArmazemDoAnexo, type ArquivoRecebido };

/** Quem registra: gente da casa, com nome para a procedência. */
export interface QuemRegistra {
  id: string;
  nome: string | null;
  papeis: readonly string[];
  permissions: string[];
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
    @Optional() private readonly quemNaoAssina?: QuemNaoAssinaRegistry,
  ) {}

  onModuleInit(): void {
    this.reacoes.inscrever('cliente.ativo', 'fechado-fora.etapa', (ev) => this.levarAoFechado(ev.orgId, ev.leadId, ev.eventoId, ev.em));
    // Revisão P2-2: quem registrou não assina o próprio registro, e a fila sabe disso ANTES do confirm.
    this.quemNaoAssina?.inscrever(CAP_FECHAMENTO, (orgId, args) => this.quemNaoAssinaOFechamento(orgId, args), 'comercial/fechado-fora.service');
  }

  /**
   * Revisão P2-2: no fechamento de quem fechou fora, quem DECLAROU (o `porId` da declaração que o
   * hash do pedido prende) não assina, nem quando outra pessoa propôs de novo. Fechamento do funil: ninguém a mais.
   */
  async quemNaoAssinaOFechamento(orgId: string, args: Record<string, unknown>): Promise<QuemNaoAssina | null> {
    const leadId = typeof args.leadId === 'string' ? args.leadId : '';
    const hash = typeof args.propostaHash === 'string' ? args.propostaHash : '';
    if (!leadId || !hash) return null;
    const ev = await this.prisma.leadEvent.findUnique({ where: { id: eventoIdComercial(orgId, leadId, 'aceite.declarado', hash) }, select: { leadId: true, payload: true } });
    if (!ev || ev.leadId !== leadId) return null;
    const porId = String(((ev.payload ?? {}) as Record<string, unknown>).porId ?? '');
    return porId ? { ids: [porId], motivo: 'Você registrou este cliente fechado fora do sistema, e quem registra não confere o próprio registro. Outra pessoa com alçada titular assina.' } : null;
  }

  /**
   * Revisão P2-3: o mesmo CNPJ em OUTRO lead da empresa. Cliente ativo por ele, ou lead vivo no funil,
   * recusa (409) dizendo qual: o fechamento é por aquele lead, e registrar de novo duplicaria contrato,
   * card e trilho. Lead em saída (perdido, geladeira...) não impede.
   */
  private async conferirOutrosLeads(orgId: string, documento: string, meuLeadId: string): Promise<void> {
    const fichas = await this.prisma.comercialFicha.findMany({ where: { orgId, cnpj: { not: null }, leadId: { not: meuLeadId } }, select: { leadId: true, cnpj: true, etapa: true, empresa: true } });
    const iguais = fichas.filter((f) => (f.cnpj ?? '').replace(/\D/g, '') === documento);
    if (!iguais.length) return;
    const ids = iguais.map((f) => f.leadId);
    const [ativos, leads] = await Promise.all([
      this.prisma.leadEvent.findMany({ where: { orgId, leadId: { in: ids }, type: 'cliente.ativo' }, select: { leadId: true } }),
      this.prisma.lead.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }),
    ]);
    const nomeDe = (f: (typeof iguais)[number]) => f.empresa || leads.find((l) => l.id === f.leadId)?.name || f.leadId;
    const ativo = iguais.find((f) => ativos.some((a) => a.leadId === f.leadId));
    if (ativo) {
      throw new ConflictException({ message: `Este CNPJ já é cliente ativo pelo lead "${nomeDe(ativo)}": o contrato vivo dele está em Contratos vivos. Nada foi registrado.`, leadId: ativo.leadId });
    }
    const aberto = iguais.find((f) => !ehSaida(f.etapa as ComercialEtapa));
    if (aberto) {
      throw new ConflictException({
        message: `Este CNPJ já está no funil pelo lead "${nomeDe(aberto)}" (${COMERCIAL_ROTULO_DA_ETAPA[aberto.etapa as ComercialEtapa] ?? aberto.etapa}): o fechamento é por ele. Nada foi registrado.`,
        leadId: aberto.leadId,
      });
    }
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
    conferirPdfRecebido(arquivo);
    const armazem = this.armazemDisponivel();
    if (!armazem) throw new ServiceUnavailableException('O envio de arquivo está indisponível agora: o registro não foi feito.');
    const pessoa = await this.prisma.user.findFirst({ where: { id: quem.id, orgId, isActive: true }, select: { id: true, name: true } });
    if (!pessoa) throw new ForbiddenException('Só gente ativa da empresa registra cliente fechado.');
    const nome = pessoa.name || quem.nome;

    const sha = sha256DoArquivo(arquivo.buffer);
    const campos = camposDaDeclaracao(input, sha);
    const hash = hashDaDeclaracao(campos);
    const telefone = normalizarTelefone(input.telefone);
    // Revisão P1-1: a cobrança nova nasce no 1º vencimento declarado; parcela já vencida o provedor não cobra,
    // e o que fazer com ela é decisão da mesa. Com cobrança nova, o 1º vencimento é hoje ou depois.
    if (input.criarCobranca && input.primeiroVencimento < hojeEmSP()) {
      throw new BadRequestException('Com cobrança nova, o 1º vencimento é hoje ou depois: parcela já vencida não vai ao Asaas. Ajuste o vencimento, ou registre sem cobrança nova com o motivo.');
    }
    await this.conferirOutrosLeads(orgId, campos.cnpj, leadIdDaEntrada(orgId, { tipo: 'manual', ref: `fechado-fora:${campos.cnpj}` }));

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
    const nomeDoArquivo = nomeDoPdf(arquivo.originalname);
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

  /**
   * O PDF anexado, para quem confere antes de assinar. Sem `sha`, o que a declaração VIGENTE cita
   * (revisão: nunca "o mais novo", que pode ser de outra versão).
   */
  async anexo(orgId: string, leadId: string, sha?: string): Promise<{ stream: Readable; contentType: string; size: number; nome: string }> {
    const alvo = sha && /^[0-9a-f]{64}$/.test(sha) ? sha : (await this.fechamento.aceiteParaFechar(orgId, leadId))?.fora?.arquivoSha256;
    const fato = alvo ? await this.prisma.leadEvent.findUnique({ where: { id: eventoIdComercial(orgId, leadId, 'contrato.anexado', alvo) }, select: { leadId: true, payload: true } }) : null;
    if (!fato || fato.leadId !== leadId) throw new NotFoundException('Este lead não tem contrato anexado.');
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
    // Sem as chaves do S3 o serviço existe mas não grava: conta como indisponível, para o registro
    // recusar ANTES de criar lead e ficha (na homologação sem MinIO o lead ficava pela metade).
    return armazemDisponivel(this.armazem, this.moduleRef);
  }
}
