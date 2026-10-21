import { BadRequestException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ActorType, ApprovalState } from '@prisma/client';
import { PASTA_MODELO_DO_CLIENTE, linkDaPastaDoDrive } from '@mktos/shared';

import { AuditService } from '../../audit/audit.service';
import { comContexto, contextoAtual, novaCorrelacao } from '../../common/contexto-execucao';
import { EfeitosRegistry, type ContextoDoEfeito } from '../../gateway/efeitos.registry';
import { PortaDoOperador } from '../../gateway/porta-do-operador.service';
import { DRIVE_DO_CLIENTE, type DriveDoCliente, type ItemDoDrive } from '../../google/drive-do-cliente';
import { MemoriaService } from '../../memory/memoria.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { PastaDoClientePort, PedidoDePasta, ResultadoDaPasta } from '../portas';
import { escolherPastaExistente, nomeDaPastaDoPartner } from './nome-da-pasta';
import { FRASE_SEM_GOOGLE, FRASE_SEM_RAIZ, idDaRaizDosClientes } from './raiz';

/*
 * TR-04 · O CRIADOR DA PASTA DO CLIENTE (rodada dos agentes, 21/10/2026, lane A4).
 *
 * `garantir` é a porta única: o fechamento, "Iniciar onboarding", "Registrar
 * cliente já fechado", o botão "Criar pasta do cliente" e o script dos clientes
 * antigos chamam isto. IDEMPOTENTE pelo ponteiro (`Partner.pastaDriveId`): com
 * ponteiro, devolve a pasta sem falar com o Drive; com pedido de criação ainda
 * na fila de aprovação, devolve o mesmo pedido em vez de abrir outro.
 *
 * TUDO PELA PORTA, com `drive.pasta.criar` (R3): a chamada é RETIDA e espera a
 * segunda pessoa; quem cria (ou liga) a pasta e grava o ponteiro é o EFEITO,
 * quando a aprovação é confirmada. O efeito relê tudo na hora (o cliente, a
 * raiz, as pastas da raiz), e por isso uma pasta de mesmo nome criada à mão
 * entre a proposta e a confirmação é LIGADA, não duplicada.
 *
 * LIGAR NÃO É MAIS BARATO QUE CRIAR, e é decisão: saber se a pasta já existe é
 * ler o Drive, e a única leitura de pasta que o catálogo tem é a do efeito
 * desta capacidade (a `contexto.arquivo.listar` não lista pastas). Ligar sem
 * aprovação exigiria uma capacidade R0 de listar pastas da raiz, que não está
 * na política 1.11.0 (pedido no relatório).
 *
 * FORA DA RAIZ = RECUSA NO EFEITO: a pasta é sempre filha direta da raiz
 * (resolvida: atalho vira o alvo), e a criada ou ligada é conferida subindo
 * pelos pais antes de o ponteiro ser gravado.
 *
 * Nunca lança por falha do Drive: devolve `erro` com o motivo e grava o motivo
 * em `Partner.pastaDriveErro` (limpo quando dá certo).
 */

/** O proponente quando quem pede é o sistema (o fechamento, o script). O slug do TR-04. */
export const ATOR_DA_PASTA = 'criador-da-pasta-do-cliente';

export type AoNascerAPasta = (orgId: string, partnerId: string) => Promise<void>;

const motivoDe = (e: unknown): string => {
  const r = (e as { response?: { message?: unknown } })?.response?.message;
  const m = typeof r === 'string' ? r : (e as Error)?.message;
  return String(m || 'falha desconhecida').slice(0, 500);
};

@Injectable()
export class PastaDoClienteService implements PastaDoClientePort, OnModuleInit {
  private readonly log = new Logger('PastaDoCliente');
  private readonly aoNascer: Array<{ fn: AoNascerAPasta; quem: string }> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoria: MemoriaService,
    private readonly porta: PortaDoOperador,
    private readonly efeitos: EfeitosRegistry,
    private readonly audit: AuditService,
    @Inject(DRIVE_DO_CLIENTE) private readonly drive: DriveDoCliente,
  ) {}

  onModuleInit(): void {
    this.efeitos.registrar(
      { 'drive.pasta.criar': (a, org, ctx) => this.efeitoCriarPasta(a, org, ctx) },
      'PastaDoClienteService',
    );
  }

  /** Quem quer saber que a pasta nasceu (o arquivista esvazia a fila). Uma inscrição por dono. */
  quandoAPastaNascer(fn: AoNascerAPasta, quem: string): void {
    if (this.aoNascer.some((a) => a.quem === quem)) throw new Error(`${quem} já se inscreveu no nascimento da pasta`);
    this.aoNascer.push({ fn, quem });
  }

  async garantir(pedido: PedidoDePasta): Promise<ResultadoDaPasta> {
    return naEmpresa(pedido.orgId, pedido.atorId ?? null, () => this.garantirNaEmpresa(pedido));
  }

  private async garantirNaEmpresa(pedido: PedidoDePasta): Promise<ResultadoDaPasta> {
    const { orgId, partnerId } = pedido;
    const partner = await this.prisma.partner.findFirst({
      where: { id: partnerId, orgId },
      select: { id: true, isCliente: true, interno: true, razaoSocial: true, nomeFantasia: true, pastaDriveId: true, pastaDriveUrl: true },
    });
    if (!partner || !partner.isCliente) return { estado: 'erro', motivo: 'cliente não encontrado nesta empresa.' };
    if (partner.interno) return { estado: 'erro', motivo: 'o cliente interno da casa não ganha pasta de cliente.' };
    if (partner.pastaDriveId && partner.pastaDriveUrl) {
      return { estado: 'pronta', pastaId: partner.pastaDriveId, url: partner.pastaDriveUrl, ligada: false };
    }
    const nome = nomeDaPastaDoPartner(partner);
    if (!nome) return this.falhou(orgId, partnerId, 'o nome do cliente não serve para nome de pasta (vazio depois da limpeza).');

    const raiz = await idDaRaizDosClientes(this.memoria, orgId).catch(() => null);
    if (!raiz) return { estado: 'sem_raiz', motivo: FRASE_SEM_RAIZ };
    const google = await this.prisma.googleAccount.findUnique({ where: { orgId }, select: { orgId: true } });
    if (!google) return { estado: 'sem_raiz', motivo: FRASE_SEM_GOOGLE };

    const pendente = await this.pedidoNaFila(orgId, partnerId);
    if (pendente) return { estado: 'aguardando_aprovacao', approvalId: pendente };

    try {
      const r = await this.porta.executar<ResultadoDoEfeito>({
        orgId,
        actorId: pedido.atorId ?? ATOR_DA_PASTA,
        actorType: pedido.atorId ? ActorType.user : ActorType.system,
        capabilityId: 'drive.pasta.criar',
        args: { clienteId: partnerId, nome, origem: pedido.origem },
        resource: { type: 'cliente', id: partnerId },
      });
      if (ehRetida(r)) return { estado: 'aguardando_aprovacao', approvalId: r.approvalId };
      return { estado: 'pronta', pastaId: r.pastaId, url: r.url, ligada: r.ligada };
    } catch (e) {
      return this.falhou(orgId, partnerId, motivoDe(e));
    }
  }

  /** O pedido de criação desta pasta ainda vivo na fila (pendente ou confirmado e não executado). */
  private async pedidoNaFila(orgId: string, partnerId: string): Promise<string | null> {
    const a = await this.prisma.approval.findFirst({
      where: {
        orgId,
        capabilityId: 'drive.pasta.criar',
        resourceType: 'cliente',
        resourceId: partnerId,
        status: { in: [ApprovalState.pendente, ApprovalState.confirmada] },
        expiraEm: { gt: new Date() },
      },
      orderBy: { criadoEm: 'desc' },
      select: { id: true },
    });
    return a?.id ?? null;
  }

  private async falhou(orgId: string, partnerId: string, motivo: string): Promise<ResultadoDaPasta> {
    await this.prisma.partner
      .updateMany({ where: { id: partnerId, orgId, pastaDriveId: null }, data: { pastaDriveErro: motivo } })
      .catch((e) => this.log.warn(`não gravei o motivo da falha da pasta: ${(e as Error).message}`));
    return { estado: 'erro', motivo };
  }

  /*
   * O EFEITO de `drive.pasta.criar`: roda pela porta, depois da confirmação.
   * Relê o cliente, a raiz e as pastas da raiz, liga a de mesmo nome ou cria a
   * nova copiando o `_modelo-cliente`, confere que ficou dentro da raiz e grava
   * o ponteiro. Falha grava o motivo e LANÇA (a porta registra a falha).
   */
  async efeitoCriarPasta(args: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito): Promise<ResultadoDoEfeito> {
    const clienteId = String(args.clienteId ?? '');
    const nomePedido = String(args.nome ?? '');
    try {
      const partner = await this.prisma.partner.findFirst({
        where: { id: clienteId, orgId, isCliente: true },
        select: { id: true, interno: true, razaoSocial: true, nomeFantasia: true, pastaDriveId: true, pastaDriveUrl: true },
      });
      if (!partner) throw new BadRequestException('cliente não encontrado nesta empresa.');
      if (partner.interno) throw new BadRequestException('o cliente interno da casa não ganha pasta de cliente.');
      if (partner.pastaDriveId && partner.pastaDriveUrl) {
        return { pastaId: partner.pastaDriveId, url: partner.pastaDriveUrl, ligada: false, jaTinha: true };
      }
      // A aprovação assinou um nome: se o cliente foi renomeado depois, não cria com o nome velho.
      if (nomeDaPastaDoPartner(partner) !== nomePedido) {
        throw new BadRequestException('o nome do cliente mudou depois do pedido: peça a pasta de novo.');
      }

      const raizConfigurada = await idDaRaizDosClientes(this.memoria, orgId);
      if (!raizConfigurada) throw new BadRequestException(FRASE_SEM_RAIZ);
      const raiz = await this.drive.pastaReal(orgId, raizConfigurada);
      if (!raiz) throw new BadRequestException('a pasta raiz dos clientes não é uma pasta que a conta Google da empresa enxerga.');

      const pastasDaRaiz = await this.drive.filhosDaPasta(orgId, raiz.id, { soPastas: true });
      const escolha = escolherPastaExistente(partner, pastasDaRaiz);
      if (escolha.tipo === 'ambigua') {
        throw new BadRequestException(`há ${escolha.quantas} pastas com o nome deste cliente na raiz: ligue à mão no Drive (renomeie as que não são dele).`);
      }

      let pasta: ItemDoDrive;
      let ligada: boolean;
      let copia: { pastasCriadas: number; arquivosCopiados: number } | null = null;
      if (escolha.tipo === 'ligar') {
        pasta = pastasDaRaiz.find((p) => p.id === escolha.id)!;
        ligada = true;
      } else {
        const modelo = pastasDaRaiz.find((p) => p.nome === PASTA_MODELO_DO_CLIENTE);
        if (!modelo) throw new BadRequestException(`falta a pasta "${PASTA_MODELO_DO_CLIENTE}" dentro da raiz dos clientes.`);
        // O pai da escrita é a raiz: conferido ANTES de escrever (a raiz é ela mesma, o modelo é filho dela).
        if (!(await this.drive.dentroDaRaiz(orgId, modelo.id, raiz.id))) {
          throw new BadRequestException('o modelo de pasta está fora da raiz dos clientes: nada foi criado.');
        }
        pasta = await this.drive.criarPasta(orgId, raiz.id, nomePedido);
        const r = await this.drive.copiarEstrutura(orgId, modelo.id, pasta.id);
        copia = { pastasCriadas: r.pastasCriadas, arquivosCopiados: r.arquivosCopiados };
        ligada = false;
      }
      if (!(await this.drive.dentroDaRaiz(orgId, pasta.id, raiz.id))) {
        throw new BadRequestException('a pasta do cliente ficou fora da raiz dos clientes: o ponteiro não foi gravado.');
      }
      const url = pasta.url ?? linkDaPastaDoDrive(pasta.id);
      const gravou = await this.prisma.partner.updateMany({
        where: { id: partner.id, orgId, pastaDriveId: null },
        data: { pastaDriveId: pasta.id, pastaDriveUrl: url, pastaDriveErro: null },
      });
      if (gravou.count !== 1) {
        // Outra passada gravou antes: vale a que já está no cliente.
        const atual = await this.prisma.partner.findFirst({ where: { id: partner.id, orgId }, select: { pastaDriveId: true, pastaDriveUrl: true } });
        if (atual?.pastaDriveId && atual.pastaDriveUrl) return { pastaId: atual.pastaDriveId, url: atual.pastaDriveUrl, ligada: false, jaTinha: true };
      }
      await this.audit.log({
        orgId,
        actorType: ctx.actorType ?? undefined,
        actorId: ctx.actorId ?? undefined,
        action: ligada ? 'clientes.pasta.ligada' : 'clientes.pasta.criada',
        entityType: 'partner',
        entityId: partner.id,
        after: { pastaId: pasta.id, ...(copia ?? {}), origem: String(args.origem ?? '') || null },
        metadata: ctx.approvalId ? { approvalId: ctx.approvalId } : undefined,
      });
      await this.avisarNascimento(orgId, partner.id);
      return { pastaId: pasta.id, url, ligada, ...(copia ? { copia } : {}) };
    } catch (e) {
      const motivo = motivoDe(e);
      await this.prisma.partner
        .updateMany({ where: { id: clienteId, orgId, pastaDriveId: null }, data: { pastaDriveErro: motivo } })
        .catch(() => undefined);
      throw e;
    }
  }

  private async avisarNascimento(orgId: string, partnerId: string): Promise<void> {
    for (const { fn, quem } of this.aoNascer) {
      try {
        await fn(orgId, partnerId);
      } catch (e) {
        // A pasta já nasceu; o que reage a ela (a fila do arquivista) tenta de novo na próxima passada.
        this.log.warn(`${quem} falhou ao reagir à pasta nova: ${(e as Error).message}`);
      }
    }
  }
}

export interface ResultadoDoEfeito {
  pastaId: string;
  url: string;
  ligada: boolean;
  jaTinha?: boolean;
  copia?: { pastasCriadas: number; arquivosCopiados: number };
}

const ehRetida = (r: unknown): r is { status: 'aguardando_aprovacao'; approvalId: string } =>
  (r as { status?: unknown } | null)?.status === 'aguardando_aprovacao';

/** Roda dentro do contexto da empresa (o interruptor e o RLS perguntam ao contexto). */
export function naEmpresa<T>(orgId: string, atorId: string | null, fn: () => Promise<T>): Promise<T> {
  const atual = contextoAtual();
  if (atual?.orgId === orgId) return fn();
  return comContexto(
    {
      orgId,
      actorType: atorId ? ActorType.user : ActorType.system,
      actorId: atorId,
      correlationId: atual?.correlationId ?? novaCorrelacao('clientes'),
      origem: atual?.origem ?? 'cron',
    },
    fn,
  );
}
