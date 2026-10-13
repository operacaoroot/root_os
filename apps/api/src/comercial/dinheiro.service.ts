import { Inject, Injectable, Logger, OnModuleInit, Optional, UnauthorizedException } from '@nestjs/common';
import { ehSaida, TABELA_DE_PRECO, type ComercialEtapa, type ComercialProduto } from '@mktos/shared';
import { ActorType, ApprovalState } from '@prisma/client';

import { comTenantPublico, resolverTenantDaCobranca, resolverTenantDoDocumento } from '../common/tenant-publico';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashDoContrato, lacunasDoContrato, montarContrato } from './contrato-modelo';
import { uuidDe, type PayloadDe } from './eventos';
import { FioService, ReacoesRegistry } from './fio.service';
import { PORTA_DE_ASSINATURA, type PortaDeAssinatura } from './portas/assinatura.port';
import { PORTA_DE_COBRANCA, type FormaDeCobranca, type PortaDeCobranca } from './portas/cobranca.port';
import { WhatsappComercialService } from './whatsapp.service';

/*
 * O DINHEIRO E A ASSINATURA DO ACEITE (lane D, 13/10/2026).
 *
 * Do "aceito" na sala à cobrança no Asaas e ao contrato na ZapSign, sem
 * redigitar nada e sem afrouxar a régua:
 *
 *   1. `proposta.aceita` (com `aceite.dados` no fio) → a reação PROPÕE à porta,
 *      como o sistema (`comercial`), as duas capacidades: `comercial.cobranca.criar`
 *      e `comercial.contrato.enviar`. As duas são R4 (obrigação financeira):
 *      ficam RETIDAS e só a titular, com senha e motivo, libera em `/atendimento`.
 *   2. Os EFEITOS (inscritos aqui, disparados só pela porta) releem o aceite e
 *      recusam se ele mudou depois do pedido. A cobrança vira uma linha
 *      `ComercialCobranca` por parcela e o fato `cobranca.criada`; o contrato
 *      vira `ComercialDocumento` (hash do conteúdo) e `contrato.gerado`, e a M7
 *      (link de assinatura) é preparada para o WhatsApp, que é outra capacidade
 *      (R3) e vai à fila como qualquer mensagem.
 *   3. Os WEBHOOKS (anônimos, segredo no cabeçalho conferido no conector) gravam
 *      `parcela.paga`/`pix.pago` e `contrato.assinado_cliente|_root` pelo fio.
 *      Reentrega não duplica: a chave do fato é o id no provedor.
 *
 * IDEMPOTÊNCIA EM TRÊS CAMADAS: a proposta não é refeita enquanto há aprovação
 * viva para o mesmo recurso; o efeito não recria o que já tem linha no banco; e
 * no provedor a cobrança tem `externalReference` fixa (`cob-<lead>-v<versao>`),
 * então rodar de novo devolve as mesmas parcelas.
 */

export const CAP_COBRANCA = 'comercial.cobranca.criar';
export const CAP_CONTRATO = 'comercial.contrato.enviar';
export const ATOR_DO_DINHEIRO = 'comercial';

type P = Record<string, unknown>;

export interface DadosDoAceite {
  cnpj: string;
  razaoSocial: string;
  endereco: string;
  quemAssina: string;
  email: string;
}

export interface AceiteDoLead {
  versao: number;
  produto: ComercialProduto;
  valorCentavos: number;
  parcelas: number;
  forma: FormaDeCobranca;
  hash: string;
  em: Date;
  dados: DadosDoAceite;
}

export type ResultadoDaProposta = 'proposta' | 'na_fila' | 'ja_existe' | 'executada' | 'pulada';

function ehRetida(r: unknown): r is { status: 'aguardando_aprovacao'; approvalId: string } {
  return !!r && typeof r === 'object' && (r as P).status === 'aguardando_aprovacao';
}

/** A data de hoje em São Paulo, AAAA-MM-DD (o primeiro vencimento: a 1ª parcela é agora). */
export function hojeEmSP(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/** O vencimento (AAAA-MM-DD) como instante: meio-dia de São Paulo, para não trocar de dia no fuso. */
export function venceComoData(dia: string): Date {
  return new Date(`${dia.slice(0, 10)}T12:00:00-03:00`);
}

@Injectable()
export class DinheiroService implements OnModuleInit {
  private readonly log = new Logger('ComercialDinheiro');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly reacoes: ReacoesRegistry,
    private readonly efeitos: EfeitosRegistry,
    private readonly operador: PortaDoOperador,
    @Inject(PORTA_DE_COBRANCA) readonly cobranca: PortaDeCobranca,
    @Inject(PORTA_DE_ASSINATURA) readonly assinatura: PortaDeAssinatura,
    @Optional() private readonly whats?: WhatsappComercialService,
  ) {}

  onModuleInit(): void {
    this.efeitos.registrar(
      {
        [CAP_COBRANCA]: (args, orgId, ctx) => this.efeitoDeCobranca(args, orgId, ctx),
        [CAP_CONTRATO]: (args, orgId, ctx) => this.efeitoDeContrato(args, orgId, ctx),
      },
      'comercial/dinheiro.service',
    );
    // O aceite congela as condições; os dados conferidos vêm antes (a sala exige). Os dois gatilhos são
    // o mesmo passo: quem chegar por último encontra o par completo e propõe.
    this.reacoes.inscrever('proposta.aceita', 'dinheiro.propor', (ev) => this.proporAceite(ev.orgId, ev.leadId));
    this.reacoes.inscrever('aceite.dados', 'dinheiro.propor', (ev) => this.proporAceite(ev.orgId, ev.leadId));
  }

  // -------------------------------------------------------------------------
  // O aceite, lido do fio
  // -------------------------------------------------------------------------

  async aceiteDoLead(leadId: string): Promise<AceiteDoLead | null> {
    const [aceita, dados] = await Promise.all([
      this.prisma.leadEvent.findFirst({ where: { leadId, type: 'proposta.aceita' }, orderBy: { occurredAt: 'desc' } }),
      this.prisma.leadEvent.findFirst({ where: { leadId, type: 'aceite.dados' }, orderBy: { occurredAt: 'desc' } }),
    ]);
    if (!aceita || !dados) return null;
    const a = (aceita.payload ?? {}) as P;
    const d = (dados.payload ?? {}) as P;
    const produto = String(a.produto ?? '') as ComercialProduto;
    if (!(produto in TABELA_DE_PRECO)) return null;
    return {
      versao: Number(a.versao ?? 0),
      produto,
      valorCentavos: Number(a.valorCentavos ?? 0),
      parcelas: Number(a.parcelas ?? 1),
      forma: String(a.forma ?? '') as FormaDeCobranca,
      hash: String(a.hash ?? ''),
      em: aceita.occurredAt,
      dados: {
        cnpj: String(d.cnpj ?? ''),
        razaoSocial: String(d.razaoSocial ?? ''),
        endereco: String(d.endereco ?? ''),
        quemAssina: String(d.quemAssina ?? ''),
        email: String(d.email ?? ''),
      },
    };
  }

  /** O contrato montado deste aceite (determinístico: a data é a do aceite). */
  contratoDoAceite(a: AceiteDoLead): { markdown: string; hash: string; lacunas: string[] } {
    const markdown = montarContrato({ ...a.dados, produto: a.produto, valorCentavos: a.valorCentavos, parcelas: a.parcelas, forma: a.forma, propostaVersao: a.versao, propostaHash: a.hash, aceitoEm: a.em });
    return { markdown, hash: hashDoContrato(markdown), lacunas: lacunasDoContrato(markdown) };
  }

  // -------------------------------------------------------------------------
  // Propor à porta
  // -------------------------------------------------------------------------

  /** Há aprovação viva (pendente no prazo, ou confirmada e ainda não consumida) para este recurso? */
  async aprovacaoViva(orgId: string, capabilityId: string, resourceId: string, agora: Date = new Date()): Promise<{ id: string; status: ApprovalState } | null> {
    return this.prisma.approval.findFirst({
      where: {
        orgId,
        capabilityId,
        resourceId,
        OR: [{ status: ApprovalState.pendente, expiraEm: { gt: agora } }, { status: ApprovalState.confirmada }],
      },
      select: { id: true, status: true },
      orderBy: { criadoEm: 'desc' },
    });
  }

  /**
   * Propõe a cobrança e o contrato do aceite. Rodar de novo não duplica: o que
   * já existe no banco, ou já está na fila, não vai à porta outra vez.
   * `ator` é o sistema na reação; numa rota, a pessoa que pediu (e então ela
   * não pode assinar: invariante 7).
   */
  async proporAceite(
    orgId: string,
    leadId: string,
    ator: { id: string; tipo: ActorType } = { id: ATOR_DO_DINHEIRO, tipo: ActorType.system },
  ): Promise<{ cobranca: ResultadoDaProposta; contrato: ResultadoDaProposta; approvalIds: string[] } | { pulado: string }> {
    const ficha = await this.prisma.comercialFicha.findUnique({ where: { leadId }, select: { etapa: true } });
    if (ficha && ehSaida(ficha.etapa as ComercialEtapa)) return { pulado: 'lead em saída' };
    const a = await this.aceiteDoLead(leadId);
    if (!a) return { pulado: 'o aceite ainda não tem os dados conferidos e a proposta aceita' };
    const approvalIds: string[] = [];

    let cobranca: ResultadoDaProposta;
    const resCob = `${leadId}:v${a.versao}`;
    if ((await this.prisma.comercialCobranca.count({ where: { leadId } })) > 0) cobranca = 'ja_existe';
    else if (await this.aprovacaoViva(orgId, CAP_COBRANCA, resCob)) cobranca = 'na_fila';
    else {
      const r = await this.operador.executar({
        orgId,
        actorId: ator.id,
        actorType: ator.tipo,
        capabilityId: CAP_COBRANCA,
        args: { leadId, versao: a.versao, hash: a.hash, valorCentavos: a.valorCentavos, parcelas: a.parcelas, forma: a.forma },
        resource: { type: 'comercial.cobranca', id: resCob },
        valorCentavos: a.valorCentavos,
      });
      if (ehRetida(r)) approvalIds.push(r.approvalId);
      cobranca = ehRetida(r) ? 'proposta' : 'executada';
    }

    let contrato: ResultadoDaProposta;
    const doc = this.contratoDoAceite(a);
    const resDoc = `${leadId}:${doc.hash.slice(0, 16)}`;
    if (await this.prisma.comercialDocumento.findFirst({ where: { leadId, hashConteudo: doc.hash }, select: { id: true } })) contrato = 'ja_existe';
    else if (await this.aprovacaoViva(orgId, CAP_CONTRATO, resDoc)) contrato = 'na_fila';
    else {
      const r = await this.operador.executar({
        orgId,
        actorId: ator.id,
        actorType: ator.tipo,
        capabilityId: CAP_CONTRATO,
        args: { leadId, versao: a.versao, hash: doc.hash, signatarioEmail: a.dados.email },
        resource: { type: 'comercial.contrato', id: resDoc },
      });
      if (ehRetida(r)) approvalIds.push(r.approvalId);
      contrato = ehRetida(r) ? 'proposta' : 'executada';
    }
    return { cobranca, contrato, approvalIds };
  }

  // -------------------------------------------------------------------------
  // Os efeitos (só a porta chama)
  // -------------------------------------------------------------------------

  /** Confere o pedido contra o aceite de AGORA: mudou = nada sai. */
  private async aceiteConferido(args: P, campos: string[]): Promise<AceiteDoLead> {
    const leadId = String(args.leadId ?? '');
    const a = await this.aceiteDoLead(leadId);
    if (!a) throw new Error('o lead não tem aceite com dados: nada foi feito');
    if (a.versao !== Number(args.versao)) throw new Error('a versão aceita mudou depois do pedido: nada foi feito');
    for (const c of campos) {
      if (String((a as unknown as P)[c]) !== String(args[c])) throw new Error(`o aceite mudou depois do pedido (${c}): nada foi feito`);
    }
    return a;
  }

  private async efeitoDeCobranca(args: P, orgId: string, _ctx: ContextoDoEfeito): Promise<unknown> {
    const a = await this.aceiteConferido(args, ['hash', 'valorCentavos', 'parcelas', 'forma']);
    return this.criarCobrancaDoAceite(orgId, String(args.leadId), a);
  }

  /**
   * Cria (ou reaproveita) o cliente e a cobrança parcelada no provedor e grava
   * uma `ComercialCobranca` por parcela. Chamado pelos efeitos de
   * `comercial.cobranca.criar` e de `comercial.fechamento.executar`, nunca por rota.
   */
  async criarCobrancaDoAceite(orgId: string, leadId: string, a: AceiteDoLead): Promise<{ referencia: string; parcelas: number; reaproveitada: boolean; externoIds: string[] }> {
    const referencia = `cob-${leadId}-v${a.versao}`;
    const existentes = await this.prisma.comercialCobranca.findMany({ where: { leadId }, orderBy: { parcela: 'asc' } });
    if (existentes.length) return { referencia, parcelas: existentes.length, reaproveitada: true, externoIds: existentes.map((c) => c.externoId) };

    if (!(a.parcelas > 0) || a.valorCentavos % a.parcelas !== 0) {
      throw new Error(`as parcelas não fecham o total (${a.valorCentavos} em ${a.parcelas}): nada foi cobrado`);
    }
    const parcelaCentavos = a.valorCentavos / a.parcelas;
    const lead = await this.prisma.lead.findFirstOrThrow({ where: { id: leadId, orgId }, select: { phone: true } });
    const cliente = await this.cobranca.criarCliente({
      nome: a.dados.razaoSocial,
      documento: a.dados.cnpj,
      email: a.dados.email || null,
      telefone: lead.phone,
      referenciaExterna: `lead-${leadId}`,
    });
    const rotulo = TABELA_DE_PRECO[a.produto]?.rotulo ?? a.produto;
    const r = await this.cobranca.criarCobranca({
      clienteExternoId: cliente.externoId,
      parcelas: a.parcelas,
      parcelaCentavos,
      forma: a.forma,
      primeiroVencimento: hojeEmSP(),
      descricao: `${rotulo} · ${a.dados.razaoSocial}`,
      referenciaExterna: referencia,
    });
    for (const p of r.parcelas) {
      let pix: string | null = null;
      if (a.forma === 'pix' && p.parcela === 1) {
        try {
          pix = await this.cobranca.pixDaCobranca(p.externoId);
        } catch (e) {
          this.log.warn(`Pix da parcela 1 de ${leadId}: ${(e as Error).message}`);
        }
      }
      await this.prisma.comercialCobranca.createMany({
        data: [
          {
            id: uuidDe([orgId, 'comercial-cobranca', this.cobranca.provedor, p.externoId]),
            leadId,
            provedor: this.cobranca.provedor,
            externoId: p.externoId,
            clienteExternoId: cliente.externoId,
            parcela: p.parcela,
            parcelas: p.parcelas,
            valorCentavos: p.valorCentavos,
            forma: a.forma,
            vence: venceComoData(p.vence),
            estado: p.estado === 'paga' ? 'paga' : 'pendente',
            pagaEm: p.pagaEm ? venceComoData(p.pagaEm) : null,
            linkPagamento: p.linkPagamento,
            pixCopiaECola: pix,
          },
        ],
        skipDuplicates: true,
      });
    }
    const primeira = r.parcelas[0];
    await this.fio.registrar(orgId, leadId, 'cobranca.criada', referencia, {
      provedor: this.cobranca.provedor,
      externoId: primeira?.externoId ?? referencia,
      parcelas: r.parcelas.length,
      forma: a.forma,
      valorCentavos: a.valorCentavos,
      primeiraVence: primeira?.vence ?? hojeEmSP(),
    });
    return { referencia, parcelas: r.parcelas.length, reaproveitada: r.reaproveitada, externoIds: r.parcelas.map((p) => p.externoId) };
  }

  /** Quem assina pela Root: [a decidir]. Até a mesa decidir, o e-mail do primeiro usuário titular da empresa. */
  async signatarioDaRoot(orgId: string): Promise<{ nome: string; email: string } | null> {
    const u = await this.prisma.user.findFirst({
      where: { orgId, isActive: true, roles: { some: { key: { in: ['admin_master', 'diretor'] } } } },
      orderBy: { createdAt: 'asc' },
      select: { name: true, email: true },
    });
    return u ? { nome: u.name, email: u.email } : null;
  }

  private async efeitoDeContrato(args: P, orgId: string, _ctx: ContextoDoEfeito): Promise<unknown> {
    const leadId = String(args.leadId ?? '');
    const a = await this.aceiteConferido(args, []);
    const doc = this.contratoDoAceite(a);
    if (doc.hash !== String(args.hash)) throw new Error('o conteúdo do contrato mudou depois do pedido: nada foi enviado');
    if (a.dados.email.toLowerCase() !== String(args.signatarioEmail ?? '').toLowerCase()) throw new Error('o signatário mudou depois do pedido: nada foi enviado');

    const ja = await this.prisma.comercialDocumento.findFirst({ where: { leadId, hashConteudo: doc.hash } });
    if (ja) return { documentoId: ja.id, externoId: ja.externoId, reaproveitado: true };

    const root = await this.signatarioDaRoot(orgId);
    if (!root) throw new Error('não há usuário titular nesta empresa para assinar pela Root: nada foi enviado');
    const criado = await this.assinatura.criarDocumento({
      nome: `Contrato · ${a.dados.razaoSocial} · proposta v${a.versao}`,
      markdown: doc.markdown,
      referenciaExterna: `ctr-${leadId}-${doc.hash.slice(0, 12)}`,
      signatarios: [
        { papel: 'cliente', nome: a.dados.quemAssina, email: a.dados.email },
        { papel: 'root', nome: root.nome, email: root.email },
      ],
    });
    const linkCliente = criado.signatarios.find((s) => s.papel === 'cliente')?.link ?? null;
    const linkRoot = criado.signatarios.find((s) => s.papel === 'root')?.link ?? null;
    const id = uuidDe([orgId, 'comercial-documento', this.assinatura.provedor, criado.externoId]);
    await this.prisma.comercialDocumento.createMany({
      data: [{ id, leadId, provedor: this.assinatura.provedor, externoId: criado.externoId, estado: 'enviado', hashConteudo: doc.hash, linkCliente, linkRoot }],
      skipDuplicates: true,
    });
    const payload = {
      provedor: this.assinatura.provedor,
      externoId: criado.externoId,
      hash: doc.hash,
      lacunas: doc.lacunas,
      // [a decidir] quem assina pela Root: até a mesa decidir, o primeiro titular da empresa.
      assinaPelaRoot: root.email,
      assinaPelaRootDecidido: false,
    };
    await this.fio.registrar(orgId, leadId, 'contrato.gerado', criado.externoId, payload as PayloadDe<'contrato.gerado'>);

    // M7: o link de assinatura pelo WhatsApp da Root (C05). É outra capacidade (R3): vai à fila como toda mensagem.
    if (this.whats && linkCliente) {
      try {
        await this.whats.prepararTemplate(orgId, leadId, 'M7', { linkAssinatura: linkCliente, quemAssina: a.dados.quemAssina }, { chave: criado.externoId });
      } catch (e) {
        this.log.warn(`M7 de ${leadId}: ${(e as Error).message}`);
      }
    }
    return { documentoId: id, externoId: criado.externoId, reaproveitado: false, lacunas: doc.lacunas.length };
  }

  // -------------------------------------------------------------------------
  // Os webhooks (anônimos; o segredo é conferido no conector)
  // -------------------------------------------------------------------------

  async webhookDoAsaas(token: string | undefined, corpo: unknown): Promise<{ ok: true; gravados: number; ignorado?: string }> {
    if (!this.cobranca.webhookAutentico(token)) throw new UnauthorizedException('webhook recusado');
    const p = this.cobranca.interpretarWebhook(corpo);
    if (!p) return { ok: true, gravados: 0, ignorado: 'corpo sem cobrança' };
    if (p.tipo !== 'paga') return { ok: true, gravados: 0, ignorado: 'evento que não é pagamento' };
    const r = await resolverTenantDaCobranca(this.prisma as never, this.cobranca.provedor, p.externoId);
    if (!r) return { ok: true, gravados: 0, ignorado: 'cobrança desconhecida' };
    return comTenantPublico(r.orgId, async () => {
      const c = await this.prisma.comercialCobranca.findUniqueOrThrow({ where: { id: r.cobrancaId } });
      const pagoEm = p.pagoEm ? venceComoData(p.pagoEm) : new Date();
      await this.prisma.comercialCobranca.updateMany({ where: { id: c.id, pagaEm: null }, data: { estado: 'paga', pagaEm: pagoEm } });
      let gravados = 0;
      const valor = p.valorCentavos || c.valorCentavos;
      const a = await this.fio.registrar(r.orgId, c.leadId, 'parcela.paga', c.externoId, { parcela: c.parcela, pagoEm: pagoEm.toISOString(), valorCentavos: valor }, { em: pagoEm });
      if (a.novo) gravados++;
      if (c.parcela === 1) {
        const b = await this.fio.registrar(r.orgId, c.leadId, 'pix.pago', c.externoId, { provedor: c.provedor, externoId: c.externoId, parcela: 1, valorCentavos: valor, pagoEm: pagoEm.toISOString() }, { em: pagoEm });
        if (b.novo) gravados++;
      }
      return { ok: true as const, gravados };
    });
  }

  async webhookDaZapsign(token: string | undefined, corpo: unknown): Promise<{ ok: true; gravados: number; ignorado?: string }> {
    if (!this.assinatura.webhookAutentico(token)) throw new UnauthorizedException('webhook recusado');
    const w = this.assinatura.interpretarWebhook(corpo);
    if (!w) return { ok: true, gravados: 0, ignorado: 'corpo sem documento' };
    const r = await resolverTenantDoDocumento(this.prisma as never, this.assinatura.provedor, w.externoId);
    if (!r) return { ok: true, gravados: 0, ignorado: 'documento desconhecido' };
    return comTenantPublico(r.orgId, async () => {
      let gravados = 0;
      for (const s of w.assinados) {
        const em = s.em ? new Date(s.em) : new Date();
        const quando = Number.isNaN(em.getTime()) ? new Date() : em;
        if (s.papel === 'cliente') {
          await this.prisma.comercialDocumento.updateMany({ where: { id: r.documentoId, assinadoClienteEm: null }, data: { assinadoClienteEm: quando } });
          const e = await this.fio.registrar(r.orgId, r.leadId, 'contrato.assinado_cliente', w.externoId, { provedor: this.assinatura.provedor, externoId: w.externoId, em: quando.toISOString() }, { em: quando });
          if (e.novo) gravados++;
        } else {
          await this.prisma.comercialDocumento.updateMany({ where: { id: r.documentoId, assinadoRootEm: null }, data: { assinadoRootEm: quando } });
          const e = await this.fio.registrar(r.orgId, r.leadId, 'contrato.assinado_root', w.externoId, { provedor: this.assinatura.provedor, externoId: w.externoId, em: quando.toISOString(), por: null }, { em: quando });
          if (e.novo) gravados++;
        }
      }
      if (w.todosAssinaram) {
        await this.prisma.comercialDocumento.updateMany({ where: { id: r.documentoId }, data: { estado: 'assinado', ...(w.pdfUrl ? { pdfUrl: w.pdfUrl } : {}) } });
      } else if (w.assinados.length) {
        await this.prisma.comercialDocumento.updateMany({ where: { id: r.documentoId, estado: { not: 'assinado' } }, data: { estado: 'assinado_parcial' } });
      }
      return { ok: true as const, gravados };
    });
  }
}
