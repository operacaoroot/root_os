import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional, UnauthorizedException } from '@nestjs/common';
import { ehSaida, TABELA_DE_PRECO, type ComercialEtapa, type ComercialProduto } from '@mktos/shared';
import { ActorType, ApprovalState } from '@prisma/client';

import { alcadaDe, atendeAlcada, temPapelDeMaquina } from '../approvals/alcada';
import { AuditService } from '../audit/audit.service';
import { lerAprovador } from '../auth/aprovador';
import { ReauthService } from '../auth/reauth.service';
import { comTenantPublico, resolverTenantDaCobranca, resolverTenantDoDocumento } from '../common/tenant-publico';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashDoContrato, lacunasDoContrato, montarContrato } from './contrato-modelo';
import { uuidDe, type PayloadDe } from './eventos';
import { FioService, ReacoesRegistry } from './fio.service';
import { cifrarLinkDaRoot, decifrarLinkDaRoot } from './link-da-root';
import { PORTA_DE_ASSINATURA, type PortaDeAssinatura } from './portas/assinatura.port';
import { PORTA_DE_COBRANCA, type FormaDeCobranca, type PortaDeCobranca } from './portas/cobranca.port';
import { segredoDoAmbiente } from './sala-token';
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

/**
 * D-2: o devedor que a titular vê no pedido da cobrança e que a cobrança leva.
 * Vai nos argumentos de `comercial.cobranca.criar` (e, portanto, no hash da
 * aprovação) e fica gravado no `cobranca.criada`, de onde o fechamento o lê.
 */
export interface DevedorDaCobranca {
  documento: string;
  razaoSocial: string;
  email: string;
}

/** O devedor como os argumentos o levam: documento só com dígitos, e-mail minúsculo e sem espaço. */
export function devedorDosDados(d: Pick<DadosDoAceite, 'cnpj' | 'razaoSocial' | 'email'>): DevedorDaCobranca {
  return { documento: d.cnpj.replace(/\D/g, ''), razaoSocial: d.razaoSocial.trim(), email: d.email.trim().toLowerCase() };
}

/** Os três campos do devedor nos argumentos da capacidade (`devedorDocumento`, `devedorRazaoSocial`, `devedorEmail`). */
export function argsDoDevedor(d: DevedorDaCobranca): { devedorDocumento: string; devedorRazaoSocial: string; devedorEmail: string } {
  return { devedorDocumento: d.documento, devedorRazaoSocial: d.razaoSocial, devedorEmail: d.email };
}

/** O mesmo devedor? (documento pelos dígitos, razão social sem espaço nas pontas, e-mail sem caixa.) */
export function mesmoDevedor(a: DevedorDaCobranca, b: DevedorDaCobranca): boolean {
  const x = devedorDosDados({ cnpj: a.documento, razaoSocial: a.razaoSocial, email: a.email });
  const y = devedorDosDados({ cnpj: b.documento, razaoSocial: b.razaoSocial, email: b.email });
  return x.documento === y.documento && x.razaoSocial === y.razaoSocial && x.email === y.email;
}

export type ResultadoDaProposta = 'proposta' | 'na_fila' | 'ja_existe' | 'executada' | 'pulada' | 'aguardando' | 'recusada';

/** De quanto em quanto tempo o sistema volta a pôr na fila uma proposta R4 que venceu sem assinatura. */
export const REPROPOR_DEPOIS_DE_MIN = 60;

/**
 * D-7: quanto a trava da criação da cobrança pode ficar presa (a transação que
 * a segura fica aberta enquanto o provedor responde). Passou disso, o banco
 * solta a trava e a transação falha.
 */
export const PRAZO_DA_TRAVA_DA_COBRANCA_MS = 180_000;

/** D-7: a frase de quem chega enquanto outra execução cria a cobrança do mesmo lead. */
export const COBRANCA_EM_CURSO = 'outra execução está criando a cobrança deste lead agora: nada foi cobrado em dobro. Rode de novo em instantes.';

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
    @Optional() private readonly reauth?: ReauthService,
    @Optional() private readonly audit?: AuditService,
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

  /**
   * D-2: o aceite com o devedor da cobrança APROVADA, para quem escreve depois
   * dela (o fechamento cria o cliente com este devedor, nunca com o aceite mais
   * novo). A fonte é o `devedor` gravado no `cobranca.criada` do lead (uma cobrança por lead),
   * que o efeito só grava depois de conferir contra os argumentos assinados.
   * Os demais dados (endereço, quem assina) são os do último `aceite.dados`
   * anterior à cobrança. Cobrança criada antes do conserto (fato sem `devedor`)
   * usa esse mesmo `aceite.dados` anterior a ela. Sem cobrança: nulo.
   */
  async aceiteDaCobrancaAprovada(leadId: string, a: AceiteDoLead): Promise<AceiteDoLead | null> {
    // O lead tem uma cobrança só (o efeito reaproveita pelo lead): o primeiro fato com devedor é o dela.
    const criadas = await this.prisma.leadEvent.findMany({ where: { leadId, type: 'cobranca.criada' }, orderBy: { occurredAt: 'asc' }, select: { payload: true, occurredAt: true } });
    let quando: Date | null = criadas[0]?.occurredAt ?? null;
    let devedor: DevedorDaCobranca | null = null;
    for (const c of criadas) {
      const d = ((c.payload ?? {}) as P).devedor as Partial<DevedorDaCobranca> | undefined;
      if (d && typeof d.documento === 'string' && typeof d.razaoSocial === 'string' && typeof d.email === 'string') {
        devedor = { documento: d.documento, razaoSocial: d.razaoSocial, email: d.email };
        quando = c.occurredAt;
        break;
      }
    }
    if (!quando) {
      // Linhas da cobrança sem o fato (o processo caiu entre as duas escritas): a hora da primeira linha.
      const linha = await this.prisma.comercialCobranca.findFirst({ where: { leadId }, orderBy: { criadoEm: 'asc' }, select: { criadoEm: true } });
      quando = linha?.criadoEm ?? null;
    }
    if (!quando) return null;
    const dados = await this.prisma.leadEvent.findFirst({ where: { leadId, type: 'aceite.dados', occurredAt: { lte: quando } }, orderBy: { occurredAt: 'desc' }, select: { payload: true } });
    if (!dados && !devedor) return null;
    const d = (dados?.payload ?? {}) as P;
    const base: DadosDoAceite = {
      cnpj: String(d.cnpj ?? ''),
      razaoSocial: String(d.razaoSocial ?? ''),
      endereco: String(d.endereco ?? ''),
      quemAssina: String(d.quemAssina ?? ''),
      email: String(d.email ?? ''),
    };
    const final = devedor ? { ...base, cnpj: devedor.documento, razaoSocial: devedor.razaoSocial, email: devedor.email } : base;
    if (!final.cnpj.replace(/\D/g, '')) return null;
    return { ...a, dados: final };
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
   * A trava da proposta AUTOMÁTICA (reação e relógio). A aprovação R4 vence em
   * 10 minutos; o sistema volta a pô-la na fila no máximo uma vez por hora, e
   * NUNCA depois de a titular recusar (decisão de gente não é refeita por
   * máquina: quem quiser de novo usa "propor de novo", em nome próprio).
   */
  async travaDaRepeticao(orgId: string, capabilityId: string, resourceId: string, agora: Date = new Date()): Promise<'recusada' | 'aguardando' | null> {
    const ultima = await this.prisma.approval.findFirst({ where: { orgId, capabilityId, resourceId }, orderBy: { criadoEm: 'desc' }, select: { status: true, criadoEm: true } });
    if (!ultima) return null;
    if (ultima.status === ApprovalState.rejeitada) return 'recusada';
    if (ultima.criadoEm.getTime() > agora.getTime() - REPROPOR_DEPOIS_DE_MIN * 60_000) return 'aguardando';
    return null;
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
    agora: Date = new Date(),
  ): Promise<{ cobranca: ResultadoDaProposta; contrato: ResultadoDaProposta; approvalIds: string[] } | { pulado: string }> {
    const automatico = ator.tipo === ActorType.system;
    const ficha = await this.prisma.comercialFicha.findUnique({ where: { leadId }, select: { etapa: true } });
    if (ficha && ehSaida(ficha.etapa as ComercialEtapa)) return { pulado: 'lead em saída' };
    const a = await this.aceiteDoLead(leadId);
    if (!a) return { pulado: 'o aceite ainda não tem os dados conferidos e a proposta aceita' };
    const approvalIds: string[] = [];

    let cobranca: ResultadoDaProposta;
    const resCob = `${leadId}:v${a.versao}`;
    if ((await this.prisma.comercialCobranca.count({ where: { leadId } })) > 0) cobranca = 'ja_existe';
    else if (await this.aprovacaoViva(orgId, CAP_COBRANCA, resCob, agora)) cobranca = 'na_fila';
    else if (automatico && (await this.travaDaRepeticao(orgId, CAP_COBRANCA, resCob, agora))) cobranca = (await this.travaDaRepeticao(orgId, CAP_COBRANCA, resCob, agora))!;
    else {
      const r = await this.operador.executar({
        orgId,
        actorId: ator.id,
        actorType: ator.tipo,
        capabilityId: CAP_COBRANCA,
        // D-2: o devedor vai nos argumentos (e no hash que a titular assina), não é relido do aceite mais novo.
        args: { leadId, versao: a.versao, hash: a.hash, valorCentavos: a.valorCentavos, parcelas: a.parcelas, forma: a.forma, ...argsDoDevedor(devedorDosDados(a.dados)) },
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
    else if (await this.aprovacaoViva(orgId, CAP_CONTRATO, resDoc, agora)) contrato = 'na_fila';
    else if (automatico && (await this.travaDaRepeticao(orgId, CAP_CONTRATO, resDoc, agora))) contrato = (await this.travaDaRepeticao(orgId, CAP_CONTRATO, resDoc, agora))!;
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
    // D-2: o devedor assinado é o dos argumentos. Pedido sem ele (anterior ao conserto) ou aceite de
    // agora com outro devedor: nada sai para o Asaas.
    const doc = args.devedorDocumento;
    const razao = args.devedorRazaoSocial;
    const email = args.devedorEmail;
    if (typeof doc !== 'string' || typeof razao !== 'string' || typeof email !== 'string' || !doc || !razao || !email) {
      throw new Error('o pedido não traz o devedor que a titular aprovou: nada foi cobrado. Proponha a cobrança de novo.');
    }
    const assinado: DevedorDaCobranca = { documento: doc, razaoSocial: razao, email };
    if (!mesmoDevedor(assinado, devedorDosDados(a.dados))) {
      throw new Error('o devedor do aceite mudou depois do pedido (documento, razão social ou e-mail): nada foi cobrado');
    }
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
    // D-7: "procura e cria" sem trava deixava duas execuções simultâneas criarem dois clientes e duas
    // cobranças no provedor. A trava é do lead (uma cobrança por lead), tomada sem esperar: quem chega
    // com ela presa recusa sem escrever nada fora; quem a toma confere de novo o que já existe.
    return this.prisma.$transaction(
      async (tx) => {
        const [trava] = await tx.$queryRaw<{ tomou: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`comercial-cobranca:${leadId}`})) AS tomou`;
        if (!trava?.tomou) throw new Error(COBRANCA_EM_CURSO);
        const ja = await this.prisma.comercialCobranca.findMany({ where: { leadId }, orderBy: { parcela: 'asc' } });
        if (ja.length) return { referencia, parcelas: ja.length, reaproveitada: true, externoIds: ja.map((c) => c.externoId) };
        return this.criarNoProvedor(orgId, leadId, a, referencia);
      },
      { timeout: PRAZO_DA_TRAVA_DA_COBRANCA_MS, maxWait: 10_000 },
    );
  }

  /** A criação de fato (cliente, cobrança parcelada, linhas e fato), sob a trava de `criarCobrancaDoAceite`. */
  private async criarNoProvedor(orgId: string, leadId: string, a: AceiteDoLead, referencia: string): Promise<{ referencia: string; parcelas: number; reaproveitada: boolean; externoIds: string[] }> {
    const parcelaCentavos = a.valorCentavos / a.parcelas;
    const lead = await this.prisma.lead.findFirstOrThrow({ where: { id: leadId, orgId }, select: { phone: true } });
    const cliente = await this.cobranca.criarCliente({
      nome: a.dados.razaoSocial,
      documento: a.dados.cnpj.replace(/\D/g, ''),
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
    // D-2: o devedor em nome de quem a cobrança nasceu fica no fato; o fechamento cria o cliente com ELE.
    const criada: PayloadDe<'cobranca.criada'> & { devedor: DevedorDaCobranca } = {
      provedor: this.cobranca.provedor,
      externoId: primeira?.externoId ?? referencia,
      parcelas: r.parcelas.length,
      forma: a.forma,
      valorCentavos: a.valorCentavos,
      primeiraVence: primeira?.vence ?? hojeEmSP(),
      devedor: devedorDosDados(a.dados),
    };
    await this.fio.registrar(orgId, leadId, 'cobranca.criada', referencia, criada);
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
    // D-1: o link que assina PELA ROOT só é guardado cifrado (sem chave no ambiente, não é guardado).
    const segredo = segredoDoAmbiente();
    const linkRootGuardado = linkRoot && segredo ? cifrarLinkDaRoot(linkRoot, segredo, id) : null;
    await this.prisma.comercialDocumento.createMany({
      data: [{ id, leadId, provedor: this.assinatura.provedor, externoId: criado.externoId, estado: 'enviado', hashConteudo: doc.hash, linkCliente, linkRoot: linkRootGuardado }],
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
  // O link de assinatura da Root (D-1)
  // -------------------------------------------------------------------------

  /**
   * Entrega o link que assina o contrato PELA ROOT. A assinatura obriga a
   * empresa, então o link só sai para quem: (1) é gente (conta de máquina não);
   * (2) é usuário ativo com alçada TITULAR relida no banco agora; (3) é o
   * signatário cadastrado no documento (o mesmo e-mail que o `contrato.gerado`
   * registrou); e (4) confirmou a própria senha agora (a mesma conferência do
   * confirm de R4, com o teto de tentativas). Sem verificador de senha nesta
   * instância, recusa. O RASTRO registra a entrega, nunca o link.
   */
  async linkParaAssinarPelaRoot(
    orgId: string,
    leadId: string,
    quem: { id: string; papeis: readonly string[]; ip?: string },
    senha: string | undefined,
  ): Promise<{ externoId: string; estado: string; linkAssinatura: string | null; assinadoRootEm: string | null }> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException('Conta de serviço não assina pela Root.');
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem assina pela Root precisa ser um usuário ativo desta empresa.');
    if (!atendeAlcada('titular', alcadaDe(doBanco.papeis))) throw new ForbiddenException('Assinar pela Root pede alçada titular.');

    const doc = await this.prisma.comercialDocumento.findFirst({ where: { leadId, orgId }, orderBy: { criadoEm: 'desc' } });
    if (!doc) throw new NotFoundException('O contrato deste lead ainda não foi gerado.');
    const base = { externoId: doc.externoId, estado: doc.estado, assinadoRootEm: doc.assinadoRootEm?.toISOString() ?? null };
    if (doc.assinadoRootEm) return { ...base, linkAssinatura: null };

    const gerados = await this.prisma.leadEvent.findMany({ where: { leadId, orgId, type: 'contrato.gerado' }, orderBy: { occurredAt: 'desc' }, select: { payload: true } });
    const gerado = gerados.find((g) => String(((g.payload ?? {}) as P).externoId ?? '') === doc.externoId);
    const cadastrado = String(((gerado?.payload ?? {}) as P).assinaPelaRoot ?? '').trim().toLowerCase();
    const eu = await this.prisma.user.findFirst({ where: { id: quem.id, orgId }, select: { email: true } });
    if (!cadastrado || !eu || eu.email.trim().toLowerCase() !== cadastrado) {
      throw new ForbiddenException('Este contrato foi cadastrado para outra pessoa assinar pela Root: só o signatário cadastrado recebe o link.');
    }

    if (!this.reauth) throw new ForbiddenException('Assinar pela Root exige confirmar a senha, e o verificador não está disponível nesta instância.');
    const prova = await this.reauth.conferir({ userId: quem.id, orgId, aprovacaoId: `assinatura-root:${doc.id}`, prova: { senha: senha ?? '' }, ip: quem.ip });
    if (!atendeAlcada('titular', alcadaDe(prova.papeis))) throw new ForbiddenException('Assinar pela Root pede alçada titular.');

    const segredo = segredoDoAmbiente();
    const link = doc.linkRoot && segredo ? decifrarLinkDaRoot(doc.linkRoot, segredo, doc.id) : null;
    await this.audit?.log({
      orgId,
      actorId: quem.id,
      action: 'comercial.contrato.link_da_root_entregue',
      entityType: 'comercial.documento',
      entityId: doc.id,
      ip: quem.ip,
      after: { leadId, externoId: doc.externoId, entregue: Boolean(link), reautenticadoEm: prova.em.toISOString() },
    });
    return { ...base, linkAssinatura: link };
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
      // O contrato do Financeiro (se o fechamento já o criou) passa a apontar a próxima parcela em aberto.
      const ficha = await this.prisma.comercialFicha.findUnique({ where: { leadId: c.leadId }, select: { contractId: true } });
      if (ficha?.contractId) {
        const proxima = await this.prisma.comercialCobranca.findFirst({ where: { leadId: c.leadId, pagaEm: null }, orderBy: { vence: 'asc' }, select: { vence: true } });
        if (proxima) await this.prisma.contract.updateMany({ where: { id: ficha.contractId, orgId: r.orgId }, data: { proximoVencimento: proxima.vence } });
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
