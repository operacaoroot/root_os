import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional, UnauthorizedException } from '@nestjs/common';
import { ehSaida, fatoDaPrimeiraPaga, TABELA_DE_PRECO, type ComercialEtapa, type ComercialProduto } from '@mktos/shared';
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
import { PdfComLacunaError } from './contrato-da-root/pdf-do-contrato';
import { montarPdfDoRegistro, rootsSemAlcada, SemMinutaError } from './contratos/documento-do-registro';
import { garantirContratoDoDocumento, refletirAssinaturas, type ReflexoDaAssinatura, type SignatarioDoDocumento } from './contratos/registro-do-documento';
import { SO_DOCUMENTOS_DE_ASSINATURA } from './documentos';
import { parcelasPagasDosContratos } from './dinheiro-do-contrato';
import { eventoIdComercial, uuidDe, type PayloadDe } from './eventos';
import { aceiteDaDeclaracao, type DeclaracaoDoFechadoFora } from './fechado-fora';
import { FioService, ReacoesRegistry } from './fio.service';
import { cifrarLinkDaRoot, decifrarLinkDaRoot } from './link-da-root';
import { parcelasDoValor } from './proposta-construtor';
import { PORTA_DE_ASSINATURA, signatariosComExternalId, type AssinaturaNoWebhook, type PortaDeAssinatura } from './portas/assinatura.port';
import { PORTA_DE_COBRANCA, type FormaDeCobranca, type PagamentoNoWebhook, type PortaDeCobranca } from './portas/cobranca.port';
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

/** A linha da cobrança que o webhook do provedor move (só o que o pagamento e o estorno leem). */
interface CobrancaDoWebhook {
  id: string;
  leadId: string;
  provedor: string;
  externoId: string;
  parcela: number;
  valorCentavos: number;
  forma: string;
  estado: string;
}

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
  /**
   * T1b: presente quando o aceite foi DECLARADO por uma pessoa (cliente que fechou fora do
   * sistema, `aceite.declarado`), nunca no aceite da sala. Ver `fechado-fora.ts`.
   */
  fora?: DeclaracaoDoFechadoFora;
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

  async aceiteDoLead(orgId: string, leadId: string): Promise<AceiteDoLead | null> {
    const [aceita, dados] = await Promise.all([
      this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'proposta.aceita' }, orderBy: { occurredAt: 'desc' } }),
      this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'aceite.dados' }, orderBy: { occurredAt: 'desc' } }),
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

  /** Há `ComercialContrato` do tipo contrato, não cancelado? Enquanto houver, o esqueleto não sai. */
  private async temContratoRegistrado(orgId: string, leadId: string): Promise<boolean> {
    return !!(await this.prisma.comercialContrato.findFirst({ where: { orgId, leadId, tipo: 'contrato', estado: { not: 'cancelado' } }, select: { id: true } }));
  }

  /** O aceite para o contrato do registro: o da sala, ou o declarado por quem fechou fora. */
  async aceiteParaContrato(orgId: string, leadId: string): Promise<AceiteDoLead | null> {
    const daSala = await this.aceiteDoLead(orgId, leadId);
    if (daSala) return daSala;
    const d = await this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'aceite.declarado' }, orderBy: { occurredAt: 'desc' }, select: { payload: true, occurredAt: true } });
    return d ? aceiteDaDeclaracao(d.payload, d.occurredAt) : null;
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
  async aceiteDaCobrancaAprovada(orgId: string, leadId: string, a: AceiteDoLead): Promise<AceiteDoLead | null> {
    // O lead tem uma cobrança só (o efeito reaproveita pelo lead): o primeiro fato com devedor é o dela.
    const criadas = await this.prisma.leadEvent.findMany({ where: { leadId, orgId, type: 'cobranca.criada' }, orderBy: { occurredAt: 'asc' }, select: { payload: true, occurredAt: true } });
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
      const linha = await this.prisma.comercialCobranca.findFirst({ where: { leadId, orgId }, orderBy: { criadoEm: 'asc' }, select: { criadoEm: true } });
      quando = linha?.criadoEm ?? null;
    }
    if (!quando) return null;
    const dados = await this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'aceite.dados', occurredAt: { lte: quando } }, orderBy: { occurredAt: 'desc' }, select: { payload: true } });
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
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { etapa: true } });
    if (ficha && ehSaida(ficha.etapa as ComercialEtapa)) return { pulado: 'lead em saída' };
    const a = await this.aceiteDoLead(orgId, leadId);
    if (!a) return { pulado: 'o aceite ainda não tem os dados conferidos e a proposta aceita' };
    const approvalIds: string[] = [];

    let cobranca: ResultadoDaProposta;
    const resCob = `${leadId}:v${a.versao}`;
    if ((await this.prisma.comercialCobranca.count({ where: { leadId, orgId } })) > 0) cobranca = 'ja_existe';
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
    // O lead já tem contrato registrado: quem vai à assinatura é o registro, nunca o esqueleto ao lado dele.
    if (await this.temContratoRegistrado(orgId, leadId)) contrato = 'ja_existe';
    // Documento cancelado (módulo de contratos, F3) saiu da ZapSign: não conta como "já existe".
    else if (await this.prisma.comercialDocumento.findFirst({ where: { leadId, orgId, hashConteudo: doc.hash, estado: { not: 'cancelado' } }, select: { id: true } })) contrato = 'ja_existe';
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
  private async aceiteConferido(orgId: string, args: P, campos: string[]): Promise<AceiteDoLead> {
    const leadId = String(args.leadId ?? '');
    const a = await this.aceiteDoLead(orgId, leadId);
    if (!a) throw new Error('o lead não tem aceite com dados: nada foi feito');
    if (a.versao !== Number(args.versao)) throw new Error('a versão aceita mudou depois do pedido: nada foi feito');
    for (const c of campos) {
      if (String((a as unknown as P)[c]) !== String(args[c])) throw new Error(`o aceite mudou depois do pedido (${c}): nada foi feito`);
    }
    return a;
  }

  private async efeitoDeCobranca(args: P, orgId: string, _ctx: ContextoDoEfeito): Promise<unknown> {
    const a = await this.aceiteConferido(orgId, args, ['hash', 'valorCentavos', 'parcelas', 'forma']);
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
    const existentes = await this.prisma.comercialCobranca.findMany({ where: { leadId, orgId }, orderBy: { parcela: 'asc' } });
    if (existentes.length) return { referencia, parcelas: existentes.length, reaproveitada: true, externoIds: existentes.map((c) => c.externoId) };

    // D-11: o valor que não divide pelas parcelas não recusa mais depois da assinatura: a última absorve
    // a diferença (parcelasDoValor), a mesma conta da proposta e do contrato.
    if (!Number.isInteger(a.parcelas) || !(a.parcelas > 0) || !Number.isInteger(a.valorCentavos) || parcelasDoValor(a.valorCentavos, a.parcelas).parcelaCentavos <= 0) {
      throw new Error(`as parcelas não fecham o total (${a.valorCentavos} em ${a.parcelas}): nada foi cobrado`);
    }
    // D-7: "procura e cria" sem trava deixava duas execuções simultâneas criarem dois clientes e duas
    // cobranças no provedor. A trava é do lead (uma cobrança por lead), tomada sem esperar: quem chega
    // com ela presa recusa sem escrever nada fora; quem a toma confere de novo o que já existe.
    return this.prisma.$transaction(
      async (tx) => {
        const [trava] = await tx.$queryRaw<{ tomou: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`comercial-cobranca:${leadId}`})) AS tomou`;
        if (!trava?.tomou) throw new Error(COBRANCA_EM_CURSO);
        const ja = await this.prisma.comercialCobranca.findMany({ where: { leadId, orgId }, orderBy: { parcela: 'asc' } });
        if (ja.length) return { referencia, parcelas: ja.length, reaproveitada: true, externoIds: ja.map((c) => c.externoId) };
        return this.criarNoProvedor(orgId, leadId, a, referencia);
      },
      { timeout: PRAZO_DA_TRAVA_DA_COBRANCA_MS, maxWait: 10_000 },
    );
  }

  /** A criação de fato (cliente, cobrança parcelada, linhas e fato), sob a trava de `criarCobrancaDoAceite`. */
  private async criarNoProvedor(orgId: string, leadId: string, a: AceiteDoLead, referencia: string): Promise<{ referencia: string; parcelas: number; reaproveitada: boolean; externoIds: string[] }> {
    const { parcelaCentavos, ultimaParcelaCentavos } = parcelasDoValor(a.valorCentavos, a.parcelas);
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
      ...(ultimaParcelaCentavos !== parcelaCentavos ? { ultimaParcelaCentavos } : {}),
      forma: a.forma,
      // T1b: de quem fechou fora, o 1º vencimento é o DECLARADO (está no hash que a titular assinou); do funil, hoje.
      primeiroVencimento: a.fora?.primeiroVencimento ?? hojeEmSP(),
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
      primeiraVence: primeira?.vence ?? a.fora?.primeiroVencimento ?? hojeEmSP(),
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

  /**
   * O envio do REGISTRO (F2, `contratoId` nos argumentos). Relê tudo e REGERA o PDF do que está gravado agora: o hash
   * tem de ser o que a titular assinou, senão nada sai. Os signatários são os da lista, e quem assina pela Root é relido
   * no banco. Sem `contratoId`, segue o caminho antigo do aceite, abaixo: ver o roteiro, "o fim do esqueleto".
   */
  private async efeitoDoRegistro(args: P, orgId: string, contratoId: string, ctx: ContextoDoEfeito): Promise<unknown> {
    const leadId = String(args.leadId ?? '');
    const hash = String(args.hash ?? '');
    const registro = await this.prisma.comercialContrato.findFirst({ where: { id: contratoId, orgId, leadId }, include: { signatarios: { orderBy: { ordem: 'asc' } } } });
    if (!registro) throw new Error('o contrato do pedido não existe mais: nada foi enviado');
    if (registro.documentoId) {
      const doc = await this.prisma.comercialDocumento.findFirst({ where: { id: registro.documentoId, orgId }, select: { id: true, externoId: true, hashConteudo: true } });
      if (doc?.hashConteudo === hash) return { documentoId: doc.id, externoId: doc.externoId, contratoId, reaproveitado: true };
      throw new Error('este contrato já tem outro documento na ZapSign: nada foi enviado');
    }
    if (registro.estado !== 'a_emitir' && registro.estado !== 'rascunho') throw new Error(`o contrato passou a ${registro.estado} depois do pedido: nada foi enviado`);
    const a = await this.aceiteParaContrato(orgId, leadId);
    if (!a) throw new Error('o lead não tem aceite com dados: nada foi enviado');
    if (a.versao !== Number(args.versao)) throw new Error('a versão aceita mudou depois do pedido: nada foi enviado');

    let montado: Awaited<ReturnType<typeof montarPdfDoRegistro>>;
    try {
      montado = await montarPdfDoRegistro(this.prisma, orgId, contratoId, a);
    } catch (e) {
      if (e instanceof PdfComLacunaError || e instanceof SemMinutaError) throw new Error(`${e.message}: nada foi enviado`);
      throw e;
    }
    if (montado.pdf.hash !== hash) throw new Error('o PDF de agora não é o que a titular aprovou (a minuta, um signatário ou um dado mudou): nada foi enviado');

    const lista = registro.signatarios.map((s) => ({ papel: s.papel as 'cliente' | 'root', nome: s.nome, email: s.email, ordem: s.ordem }));
    const doCliente = lista.filter((s) => s.papel === 'cliente');
    const daRoot = lista.filter((s) => s.papel === 'root');
    if (!doCliente.length || !daRoot.length) throw new Error('o contrato precisa de quem assine pelos dois lados: nada foi enviado');
    if (doCliente[0]!.email.toLowerCase() !== String(args.signatarioEmail ?? '').toLowerCase()) throw new Error('o signatário mudou depois do pedido: nada foi enviado');
    const semAlcada = await rootsSemAlcada(this.prisma, orgId, lista);
    if (semAlcada.length) throw new Error(`quem assina pela Root não é mais titular ativo (${semAlcada.join(', ')}): nada foi enviado`);

    const ja = await this.prisma.comercialDocumento.findFirst({ where: { leadId, orgId, hashConteudo: hash, estado: { not: 'cancelado' }, ...SO_DOCUMENTOS_DE_ASSINATURA } });
    if (ja) {
      await this.manterORegistro(orgId, leadId, () => garantirContratoDoDocumento(this.prisma, { orgId, leadId, documentoId: ja.id, contratoId }));
      return { documentoId: ja.id, externoId: ja.externoId, contratoId, reaproveitado: true };
    }

    const rotulo = registro.tipo === 'contrato' ? 'Contrato' : registro.tipo === 'aditivo' ? 'Aditivo' : 'Distrato';
    const criado = await this.assinatura.criarDocumento({
      nome: `${rotulo} · ${a.dados.razaoSocial} · proposta v${a.versao}`,
      pdfBase64: montado.pdf.pdf.toString('base64'),
      referenciaExterna: `ctr-${contratoId}-${hash.slice(0, 12)}`,
      signatarios: lista,
    });
    const doProvedor = signatariosComExternalId(lista).map((s) => ({ ...s, doc: criado.signatarios.find((c) => c.externalId === s.externalId) ?? criado.signatarios.find((c) => c.papel === s.papel) }));
    const linkCliente = doProvedor.find((s) => s.papel === 'cliente')?.doc?.link ?? null;
    const linkRoot = doProvedor.find((s) => s.papel === 'root')?.doc?.link ?? null;
    const id = uuidDe([orgId, 'comercial-documento', this.assinatura.provedor, criado.externoId]);
    const segredo = segredoDoAmbiente();
    const linkRootGuardado = linkRoot && segredo ? cifrarLinkDaRoot(linkRoot, segredo, id) : null;
    await this.prisma.comercialDocumento.createMany({
      data: [{ id, leadId, provedor: this.assinatura.provedor, externoId: criado.externoId, estado: 'enviado', hashConteudo: hash, linkCliente, linkRoot: linkRootGuardado }],
      skipDuplicates: true,
    });
    const signatarios: SignatarioDoDocumento[] = doProvedor.map((s) => ({ papel: s.papel, nome: s.nome, email: s.email, ordem: s.ordem, token: s.doc?.token ?? null }));
    await this.manterORegistro(orgId, leadId, async () => {
      await garantirContratoDoDocumento(this.prisma, { orgId, leadId, documentoId: id, contratoId, signatarios });
      // Cada signatário da Root tem o link dele, cifrado e preso ao documento. `linkRoot` segue com o primeiro.
      const links = segredo ? Object.fromEntries(doProvedor.flatMap((s) => (s.papel === 'root' && s.doc?.link ? [[s.externalId, cifrarLinkDaRoot(s.doc.link, segredo, `${id}:${s.externalId}`)]] : []))) : {};
      if (Object.keys(links).length) {
        const dados = (registro.dadosDoContrato ?? {}) as P;
        await this.prisma.comercialContrato.updateMany({ where: { id: contratoId, documentoId: id }, data: { dadosDoContrato: { ...dados, linksDaRoot: { documentoId: id, links } } as never } });
      }
    });
    const quemConfirmou = ctx.actorId ? (await this.prisma.user.findFirst({ where: { id: ctx.actorId, orgId }, select: { name: true } }))?.name ?? null : null;
    await this.fio.registrar(orgId, leadId, 'contrato.minuta_aprovada', `${contratoId}:${hash.slice(0, 16)}`, { contratoId, minutaId: registro.minutaId ?? '', hash, por: quemConfirmou });
    await this.fio.registrar(orgId, leadId, 'contrato.gerado', criado.externoId, { provedor: this.assinatura.provedor, externoId: criado.externoId, hash, contratoId, lacunas: [], assinaPelaRoot: daRoot[0]!.email, assinaPelaRootDecidido: true });

    // M7: o link de cada signatário do cliente, pelo WhatsApp da Root. É outra capacidade (R3): vai à fila como toda mensagem.
    let mensagens = 0;
    if (this.whats) {
      for (const s of doProvedor.filter((x) => x.papel === 'cliente' && x.doc?.link)) {
        try {
          await this.whats.prepararTemplate(orgId, leadId, 'M7', { linkAssinatura: s.doc!.link!, quemAssina: s.nome }, { chave: `${criado.externoId}:${s.externalId}` });
          mensagens++;
        } catch (e) {
          this.log.warn(`M7 de ${leadId}: ${(e as Error).message}`);
        }
      }
    }
    return { documentoId: id, externoId: criado.externoId, contratoId, reaproveitado: false, signatarios: lista.length, mensagens };
  }

  private async efeitoDeContrato(args: P, orgId: string, ctx: ContextoDoEfeito): Promise<unknown> {
    if (typeof args.contratoId === 'string' && args.contratoId) return this.efeitoDoRegistro(args, orgId, args.contratoId, ctx);
    const leadId = String(args.leadId ?? '');
    const a = await this.aceiteConferido(orgId, args, []);
    const doc = this.contratoDoAceite(a);
    if (doc.hash !== String(args.hash)) throw new Error('o conteúdo do contrato mudou depois do pedido: nada foi enviado');
    if (a.dados.email.toLowerCase() !== String(args.signatarioEmail ?? '').toLowerCase()) throw new Error('o signatário mudou depois do pedido: nada foi enviado');

    const ja = await this.prisma.comercialDocumento.findFirst({ where: { leadId, orgId, hashConteudo: doc.hash, estado: { not: 'cancelado' } } });
    if (ja) {
      await this.manterORegistro(orgId, leadId, () => garantirContratoDoDocumento(this.prisma, { orgId, leadId, documentoId: ja.id }));
      return { documentoId: ja.id, externoId: ja.externoId, reaproveitado: true };
    }

    // Cobre o esqueleto que já estava na fila quando o registro nasceu: aprová-lo daria dois documentos ao lead.
    if (await this.temContratoRegistrado(orgId, leadId)) throw new Error('este lead já tem contrato registrado, que vai à assinatura pela emissão: nada foi enviado');

    const root = await this.signatarioDaRoot(orgId);
    if (!root) throw new Error('não há usuário titular nesta empresa para assinar pela Root: nada foi enviado');
    const lista = [
      { papel: 'cliente' as const, nome: a.dados.quemAssina, email: a.dados.email, ordem: 1 },
      { papel: 'root' as const, nome: root.nome, email: root.email, ordem: 2 },
    ];
    const criado = await this.assinatura.criarDocumento({
      nome: `Contrato · ${a.dados.razaoSocial} · proposta v${a.versao}`,
      markdown: doc.markdown,
      referenciaExterna: `ctr-${leadId}-${doc.hash.slice(0, 12)}`,
      signatarios: lista,
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
    // O registro do contrato (módulo de contratos): o documento continua sendo a parte "na ZapSign".
    const signatarios: SignatarioDoDocumento[] = signatariosComExternalId(lista).map((s) => ({
      papel: s.papel,
      nome: s.nome,
      email: s.email,
      ordem: s.ordem,
      token: (criado.signatarios.find((c) => c.externalId === s.externalId) ?? criado.signatarios.find((c) => c.papel === s.papel))?.token ?? null,
    }));
    await this.manterORegistro(orgId, leadId, () => garantirContratoDoDocumento(this.prisma, { orgId, leadId, documentoId: id, signatarios }));
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

    const doc = await this.prisma.comercialDocumento.findFirst({ where: { leadId, orgId, estado: { not: 'cancelado' }, ...SO_DOCUMENTOS_DE_ASSINATURA }, orderBy: { criadoEm: 'desc' } });
    if (!doc) throw new NotFoundException('O contrato deste lead ainda não foi gerado.');
    const base = { externoId: doc.externoId, estado: doc.estado, assinadoRootEm: doc.assinadoRootEm?.toISOString() ?? null };
    if (doc.assinadoRootEm) return { ...base, linkAssinatura: null };

    const eu = await this.prisma.user.findFirst({ where: { id: quem.id, orgId }, select: { email: true } });
    const meuEmail = eu?.email.trim().toLowerCase() ?? '';
    const recusaDeOutro = new ForbiddenException('Este contrato foi cadastrado para outra pessoa assinar pela Root: só o signatário cadastrado recebe o link.');
    // Documento do registro guarda um link por signatário da Root; documento antigo tem um só, e vale o caminho de sempre.
    const registro = await this.prisma.comercialContrato.findFirst({ where: { documentoId: doc.id, orgId }, select: { dadosDoContrato: true, signatarios: { select: { papel: true, nome: true, email: true, ordem: true, assinadoEm: true } } } });
    const guardados = ((registro?.dadosDoContrato ?? {}) as { linksDaRoot?: { documentoId?: string; links?: Record<string, string> } }).linksDaRoot;
    let cifrado = doc.linkRoot;
    let aad = doc.id;
    if (registro && guardados?.documentoId === doc.id && guardados.links) {
      const lista = signatariosComExternalId(registro.signatarios.map((s) => ({ ...s, papel: s.papel as 'cliente' | 'root' })));
      const minha = lista.find((s) => s.papel === 'root' && s.email.trim().toLowerCase() === meuEmail);
      if (!minha) throw recusaDeOutro;
      if (minha.assinadoEm) return { ...base, linkAssinatura: null };
      cifrado = guardados.links[minha.externalId] ?? null;
      aad = `${doc.id}:${minha.externalId}`;
    } else {
      const gerados = await this.prisma.leadEvent.findMany({ where: { leadId, orgId, type: 'contrato.gerado' }, orderBy: { occurredAt: 'desc' }, select: { payload: true } });
      const gerado = gerados.find((g) => String(((g.payload ?? {}) as P).externoId ?? '') === doc.externoId);
      const cadastrado = String(((gerado?.payload ?? {}) as P).assinaPelaRoot ?? '').trim().toLowerCase();
      if (!cadastrado || meuEmail !== cadastrado) throw recusaDeOutro;
    }

    if (!this.reauth) throw new ForbiddenException('Assinar pela Root exige confirmar a senha, e o verificador não está disponível nesta instância.');
    const prova = await this.reauth.conferir({ userId: quem.id, orgId, aprovacaoId: `assinatura-root:${doc.id}`, prova: { senha: senha ?? '' }, ip: quem.ip });
    if (!atendeAlcada('titular', alcadaDe(prova.papeis))) throw new ForbiddenException('Assinar pela Root pede alçada titular.');

    const segredo = segredoDoAmbiente();
    const link = cifrado && segredo ? decifrarLinkDaRoot(cifrado, segredo, aad) : null;
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
    if (p.tipo === 'outro') return { ok: true, gravados: 0, ignorado: 'evento que não é pagamento nem estorno' };
    const r = await resolverTenantDaCobranca(this.prisma as never, this.cobranca.provedor, p.externoId);
    if (!r) return { ok: true, gravados: 0, ignorado: 'cobrança desconhecida' };
    return comTenantPublico(r.orgId, async () => {
      const c = await this.prisma.comercialCobranca.findFirstOrThrow({ where: { id: r.cobrancaId, orgId: r.orgId } });
      const gravados = p.tipo === 'estornada' ? await this.estornoDaParcela(r.orgId, c, p) : await this.pagamentoDaParcela(r.orgId, c, p);
      // O contrato do Financeiro (se o fechamento já o criou) passa a apontar a próxima parcela em aberto.
      const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId: c.leadId, orgId: r.orgId }, select: { contractId: true } });
      if (ficha?.contractId) {
        const proxima = await this.prisma.comercialCobranca.findFirst({ where: { leadId: c.leadId, orgId: r.orgId, pagaEm: null }, orderBy: { vence: 'asc' }, select: { vence: true } });
        if (proxima) await this.prisma.contract.updateMany({ where: { id: ficha.contractId, orgId: r.orgId }, data: { proximoVencimento: proxima.vence } });
      }
      return { ok: true as const, gravados };
    });
  }

  /**
   * A parcela paga. D-10: o fato da 1ª parcela tem o nome da forma (`pix.pago`
   * só para Pix). Paga de novo depois de um estorno, os fatos ganham outra
   * chave (o id do evento do provedor): a chave de antes já está no fio, e sem
   * um fato novo o estorno ficaria por último para sempre.
   * Etapa 4 (F-05): não é mais só do webhook; a parcela que o Financeiro viu paga passa por aqui também.
   */
  async pagamentoDaParcela(orgId: string, c: CobrancaDoWebhook, p: PagamentoNoWebhook): Promise<number> {
    const pagoEm = p.pagoEm ? venceComoData(p.pagoEm) : new Date();
    const depoisDoEstorno = c.estado === 'estornada';
    await this.prisma.comercialCobranca.updateMany({ where: { id: c.id, pagaEm: null }, data: { estado: 'paga', pagaEm: pagoEm } });
    const chave = depoisDoEstorno ? `${c.externoId}:${p.eventoId ?? pagoEm.toISOString()}` : c.externoId;
    let gravados = 0;
    const valor = p.valorCentavos || c.valorCentavos;
    const a = await this.fio.registrar(orgId, c.leadId, 'parcela.paga', chave, { parcela: c.parcela, pagoEm: pagoEm.toISOString(), valorCentavos: valor }, { em: pagoEm });
    if (a.novo) gravados++;
    if (c.parcela === 1) {
      const b = await this.fio.registrar(orgId, c.leadId, fatoDaPrimeiraPaga(c.forma), chave, { provedor: c.provedor, externoId: c.externoId, parcela: 1, valorCentavos: valor, pagoEm: pagoEm.toISOString() }, { em: pagoEm });
      if (b.novo) gravados++;
    }
    return gravados;
  }

  /**
   * Etapa 4 (F-05), tarefa do relógio `dinheiro.pagas_no_financeiro`: a parcela que o FINANCEIRO viu paga
   * (sync do Asaas, extrato ou baixa à mão), num acordo ligado a um contrato do registro, avisa o Comercial
   * com o mesmo fato do webhook.
   *   · Com a cobrança do lead (`asaasPaymentId` = `externoId`) ainda sem `pagaEm`: a mesma rotina do
   *     webhook, com a mesma chave (o id da cobrança). Cobrança estornada fica: depois do estorno, quem
   *     manda é o webhook do Asaas (senão o relógio a pagaria de novo a cada minuto).
   *   · Sem cobrança do lead (baixa à mão, ou cobrança que o Comercial não criou): `parcela.paga` com a
   *     chave do id da parcela.
   * Idempotente: a cobrança pelo `pagaEm`, a parcela à mão pelo id do fato, conferido antes de gravar. A
   * 1ª parcela segue a régua de sempre: o fato chega à reação do fechamento, que vai à assinatura da titular.
   */
  async pagasNoFinanceiro(orgId: string, _agora: Date = new Date()): Promise<{ daCobranca: number; aMao: number }> {
    const pagas = await parcelasPagasDosContratos(this.prisma, orgId);
    if (!pagas.length) return { daCobranca: 0, aMao: 0 };
    const ids = [...new Set(pagas.map((p) => p.asaasPaymentId).filter((x): x is string => !!x))];
    const cobrancas = ids.length ? await this.prisma.comercialCobranca.findMany({ where: { orgId, externoId: { in: ids } } }) : [];
    const dia = (d: Date) => d.toISOString().slice(0, 10);
    let daCobranca = 0;
    let aMao = 0;
    const semCobranca: typeof pagas = [];
    for (const p of pagas) {
      const c = p.asaasPaymentId ? cobrancas.find((x) => x.externoId === p.asaasPaymentId && x.leadId === p.leadId) : undefined;
      if (!c) {
        semCobranca.push(p);
        continue;
      }
      if (c.pagaEm || c.estado === 'estornada') continue;
      daCobranca += await this.pagamentoDaParcela(orgId, c, { eventoId: null, tipo: 'paga', evento: 'financeiro', externoId: c.externoId, valorCentavos: 0, pagoEm: dia(p.pagaEm) });
    }
    if (semCobranca.length) {
      const jaNoFio = new Set(
        (await this.prisma.leadEvent.findMany({ where: { id: { in: semCobranca.map((p) => eventoIdComercial(orgId, p.leadId, 'parcela.paga', p.parcelaId)) } }, select: { id: true } })).map((e) => e.id),
      );
      for (const p of semCobranca) {
        if (jaNoFio.has(eventoIdComercial(orgId, p.leadId, 'parcela.paga', p.parcelaId))) continue;
        const pagoEm = venceComoData(dia(p.pagaEm));
        const r = await this.fio.registrar(orgId, p.leadId, 'parcela.paga', p.parcelaId, { parcela: p.numero, pagoEm: pagoEm.toISOString(), valorCentavos: p.valorCentavos }, { em: pagoEm });
        if (r.novo) aMao++;
      }
    }
    return { daCobranca, aMao };
  }

  /**
   * D-10: estorno ou chargeback. A parcela volta a não paga (`estornada`, sem
   * `pagaEm`) e o fato vai ao fio. O fechamento lê a 1ª parcela da linha da
   * cobrança e do fio: com ela estornada, não segue.
   */
  private async estornoDaParcela(orgId: string, c: CobrancaDoWebhook, p: PagamentoNoWebhook): Promise<number> {
    const em = new Date();
    await this.prisma.comercialCobranca.updateMany({ where: { id: c.id }, data: { estado: 'estornada', pagaEm: null } });
    const chave = `${c.externoId}:${p.eventoId ?? p.evento}`;
    const e = await this.fio.registrar(orgId, c.leadId, 'parcela.estornada', chave, { parcela: c.parcela, externoId: c.externoId, evento: p.evento, em: em.toISOString(), valorCentavos: p.valorCentavos || c.valorCentavos }, { em });
    return e.novo ? 1 : 0;
  }

  async webhookDaZapsign(token: string | undefined, corpo: unknown): Promise<{ ok: true; gravados: number; ignorado?: string }> {
    if (!this.assinatura.webhookAutentico(token)) throw new UnauthorizedException('webhook recusado');
    const w = this.assinatura.interpretarWebhook(corpo);
    if (!w) return { ok: true, gravados: 0, ignorado: 'corpo sem documento' };
    const r = await resolverTenantDoDocumento(this.prisma as never, this.assinatura.provedor, w.externoId);
    if (!r) return { ok: true, gravados: 0, ignorado: 'documento desconhecido' };
    return comTenantPublico(r.orgId, async () => {
      const { gravados } = await this.aplicarAssinatura(r.orgId, r.leadId, r.documentoId, w);
      return { ok: true as const, gravados };
    });
  }

  /**
   * O que o provedor disse sobre as assinaturas de um documento, gravado UM caminho só: o webhook e a
   * conferência (botão, lote e relógio do módulo de contratos) passam por aqui. A chave de cada fato é
   * o id do documento: a reentrega do webhook e a consulta depois dele não duplicam, e a consulta que
   * acha assinatura sem webhook grava os mesmos fatos e dispara a mesma cópia do PDF.
   */
  async aplicarAssinatura(orgId: string, leadId: string, documentoId: string, w: AssinaturaNoWebhook): Promise<{ gravados: number; registro: ReflexoDaAssinatura | null }> {
    let gravados = 0;
    for (const s of w.assinados) {
      const em = s.em ? new Date(s.em) : new Date();
      const quando = Number.isNaN(em.getTime()) ? new Date() : em;
      if (s.papel === 'cliente') {
        await this.prisma.comercialDocumento.updateMany({ where: { id: documentoId, assinadoClienteEm: null }, data: { assinadoClienteEm: quando } });
        const e = await this.fio.registrar(orgId, leadId, 'contrato.assinado_cliente', w.externoId, { provedor: this.assinatura.provedor, externoId: w.externoId, em: quando.toISOString() }, { em: quando });
        if (e.novo) gravados++;
      } else {
        await this.prisma.comercialDocumento.updateMany({ where: { id: documentoId, assinadoRootEm: null }, data: { assinadoRootEm: quando } });
        const e = await this.fio.registrar(orgId, leadId, 'contrato.assinado_root', w.externoId, { provedor: this.assinatura.provedor, externoId: w.externoId, em: quando.toISOString(), por: null }, { em: quando });
        if (e.novo) gravados++;
      }
    }
    if (w.todosAssinaram) {
      await this.prisma.comercialDocumento.updateMany({ where: { id: documentoId }, data: { estado: 'assinado', ...(w.pdfUrl ? { pdfUrl: w.pdfUrl } : {}) } });
    } else if (w.assinados.length || w.assinaturas?.length) {
      await this.prisma.comercialDocumento.updateMany({ where: { id: documentoId, estado: { not: 'assinado' } }, data: { estado: 'assinado_parcial' } });
    }
    // O registro antes do fato final: a reação de `contrato.assinado` já lê o contrato como assinado.
    const registro = await this.manterORegistro(orgId, leadId, () => refletirAssinaturas(this.prisma, { orgId, leadId, documentoId, assinatura: w }));
    if (w.todosAssinaram) {
      // CO-08 (rodada dos agentes): o documento inteiro assinado vira fato; a reação do assinador copia o PDF
      // para `02-contrato` da pasta do cliente (`assinado-na-pasta.service.ts`). A URL do provedor fica no documento.
      const doc = await this.prisma.comercialDocumento.findFirst({ where: { id: documentoId, orgId }, select: { pdfUrl: true } });
      // Não conta em `gravados`: a resposta do webhook continua contando só as assinaturas.
      await this.fio.registrar(orgId, leadId, 'contrato.assinado', w.externoId, {
        provedor: this.assinatura.provedor,
        externoId: w.externoId,
        documentoId,
        temPdf: Boolean(doc?.pdfUrl),
      });
    }
    return { gravados, registro };
  }

  /**
   * O registro do contrato é projeção do documento e do fio: falhar aqui não pode derrubar o webhook nem o
   * efeito, que já escreveram no provedor. Fica no log, e a próxima conferência refaz.
   */
  private async manterORegistro<T>(orgId: string, leadId: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      this.log.error(`registro do contrato do lead ${leadId} (empresa ${orgId}) não foi atualizado: ${(e as Error).message}`);
      return null;
    }
  }
}
