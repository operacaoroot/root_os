import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  COMERCIAL_ETAPAS,
  COMERCIAL_ROTULO_DA_ETAPA,
  COMERCIAL_SAIDAS,
  ComercialAtaSchema,
  ComercialEntradaWhatsSchema,
  ComercialSaidaSchema,
  LEAD_STATUS_DA_ETAPA,
  ehSaida,
  proximaEtapa,
  type CartaoDoFunil,
  type ComercialCanalDeEntrada,
  type ComercialEtapa,
  type ComercialEtapaAtiva,
  type ComercialFormaDePagamento,
  type ComercialMotivoDeSaida,
  type ComercialPerfil,
  type ComercialProduto,
  type ComercialSaidaInput,
  type FichaDoLead,
  type FunilVivo,
} from '@mktos/shared';
import { LeadStatus, Prisma, type ComercialEtapa as EtapaDoBanco } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ConfigComercialService } from './config.service';
import { hashDoConteudo, leadIdDoTelefone, linhasDoFio, normalizarTelefone, type PayloadDe } from './eventos';
import { FioService, type EventoGravado } from './fio.service';
import { produtoAlvo } from './pontuacao';
import { avancar, avancarDepoisDaSessao, podeSair, portoesDaEtapa, type EstadoParaPortao, type Veredicto } from './portoes';

/*
 * A FICHA DO LEAD (lane A, 13/10/2026) — a tela 05 é PROJEÇÃO do fio.
 *
 * `ComercialFicha` (1:1 com o Lead) guarda o que a projeção precisa ler sem
 * varrer o fio inteiro, e CADA CAMPO vem do payload de um evento: o mapa está
 * em `camposDoEvento` (puro, testado). Nenhuma rota grava campo à mão; quem
 * quer mudar a ficha grava um fato pelo `FioService`, e a reação da espinha
 * (`reacoes-da-espinha.ts`) aplica.
 *
 * A ETAPA tem um caminho só: `mudarEtapa`. Ele pergunta ao portão
 * (`portoes.ts`: `avancar`, `avancarDepoisDaSessao`, `podeSair`), e só com o
 * portão cumprido faz a escrita CONDICIONADA à etapa lida (duas reações ao
 * mesmo tempo: uma vence, a outra recebe "a etapa mudou"), atualiza
 * `etapaDesde`, `etapaAntesDaSaida` e `Lead.status` pelo mapa fixo
 * `LEAD_STATUS_DA_ETAPA`, e grava `etapa.mudou` no fio. Portão recusado NÃO
 * força: devolve o veredicto com a lista do que falta, e a reação o guarda
 * como resultado.
 */

type Ficha = Prisma.ComercialFichaGetPayload<Record<string, never>>;
type CamposDaFicha = Prisma.ComercialFichaUncheckedUpdateInput;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const data = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const PRODUTOS: readonly string[] = ['imersao', 'operacao', 'kit', 'turma'];

/**
 * O MAPA EVENTO → CAMPOS DA FICHA. Puro: recebe o tipo, o payload, o instante
 * do fato e a ficha de agora; devolve o que escrever (ou `null`). Regras:
 *   · o que não está no payload não é escrito (nunca inventa);
 *   · marcos "primeira vez" (`propostaLidaPelaPrimeiraVezEm`, `pixPagoEm`) não
 *     são sobrescritos por repetição;
 *   · proposta de versão MENOR que a vigente não volta as condições.
 */
export function camposDoEvento(type: string, payload: unknown, em: Date, ficha: Partial<Ficha>): CamposDaFicha | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'lead.chegou': {
      const canal = str(p.canal);
      return canal && !ficha.canal ? { canal } : null;
    }
    case 'cnpj.enriquecido': {
      const c: CamposDaFicha = {};
      if (str(p.cnpj)) c.cnpj = str(p.cnpj);
      if (str(p.razaoSocial) && !ficha.empresa) c.empresa = str(p.razaoSocial);
      return Object.keys(c).length ? c : null;
    }
    case 'lead.pontuado':
      return { pontuacao: num(p.pontuacao), perfil: str(p.perfil) };
    case 'dono.atribuido':
      return str(p.donoId) ? { donoId: str(p.donoId) } : null;
    case 'form.respondido': {
      const c: CamposDaFicha = {};
      if (str(p.sistema)) c.sistemaErp = str(p.sistema);
      if (typeof p.baseOrganizada === 'boolean') c.baseDados = p.baseOrganizada;
      if (str(p.empresa)) c.empresa = str(p.empresa);
      if (str(p.cnpj)) c.cnpj = str(p.cnpj);
      // O produto de entrada que o qualificador propõe (E2) sai das mesmas respostas.
      const alvo = produtoAlvo({ sistemaErp: str(p.sistema), baseDados: typeof p.baseOrganizada === 'boolean' ? p.baseOrganizada : null });
      if (alvo && !ficha.produto) c.produto = alvo;
      return Object.keys(c).length ? c : null;
    }
    case 'agenda.escolhida':
      return data(p.horario) ? { reuniaoEm: data(p.horario) } : null;
    case 'agenda.confirmada':
      return { confirmacaoEnviadaEm: em };
    case 'ata.chegou': {
      const c: CamposDaFicha = {};
      if (str(p.hash)) c.ataHash = str(p.hash);
      if (str(p.por) && !ficha.socioDaConta) c.socioDaConta = str(p.por);
      return Object.keys(c).length ? c : null;
    }
    case 'diagnostico.pronto': {
      const c: CamposDaFicha = {
        diagnostico: { dores: Array.isArray(p.dores) ? p.dores : [], objecoes: Array.isArray(p.objecoes) ? p.objecoes : [], produtoSugerido: str(p.produtoSugerido), prontoEm: em.toISOString() } as Prisma.InputJsonValue,
      };
      if (!ficha.rota) c.rota = 'diagnostico';
      if (data(p.aprovadoEm)) c.diagnosticoAprovadoEm = data(p.aprovadoEm);
      const sugerido = str(p.produtoSugerido);
      if (sugerido && PRODUTOS.includes(sugerido) && !ficha.produto) c.produto = sugerido;
      return c;
    }
    case 'proposta.publicada': {
      const versao = num(p.versao) ?? 0;
      if (versao < (ficha.propostaVersao ?? 0)) return null;
      const c: CamposDaFicha = {
        propostaVersao: versao,
        propostaHash: str(p.hash),
        valorCentavos: num(p.valorCentavos),
        parcelas: num(p.parcelas),
        parcelaCentavos: num(p.parcelaCentavos),
        validade: data(p.validaAte),
        descontoPct: num(p.descontoPct),
        propostaPublicadaEm: em,
      };
      if (str(p.produto) && PRODUTOS.includes(str(p.produto)!)) c.produto = str(p.produto);
      if (p.quadroDeCustos && typeof p.quadroDeCustos === 'object') c.quadroDeCustos = p.quadroDeCustos as Prisma.InputJsonValue;
      // Proposta publicada direto da sessão: a rota é a proposta direta (C04, E4).
      if (!ficha.rota && ficha.etapa === 'sessao') c.rota = 'proposta_direta';
      return c;
    }
    case 'proposta.lida':
      return ficha.propostaLidaPelaPrimeiraVezEm ? null : { propostaLidaPelaPrimeiraVezEm: em };
    case 'proposta.aceita': {
      const c: CamposDaFicha = { propostaAceitaEm: ficha.propostaAceitaEm ?? em };
      if (str(p.produto) && PRODUTOS.includes(str(p.produto)!)) c.produto = str(p.produto);
      if (num(p.valorCentavos) !== null) c.valorCentavos = num(p.valorCentavos);
      if (num(p.parcelas) !== null) c.parcelas = num(p.parcelas);
      if (str(p.forma)) c.forma = str(p.forma);
      return c;
    }
    case 'aceite.dados': {
      const cadastro = { cnpj: str(p.cnpj), razaoSocial: str(p.razaoSocial), endereco: str(p.endereco), quemAssina: str(p.quemAssina), email: str(p.email) };
      const c: CamposDaFicha = { cadastro: cadastro as Prisma.InputJsonValue };
      if (cadastro.cnpj) c.cnpj = cadastro.cnpj;
      if (cadastro.razaoSocial && !ficha.empresa) c.empresa = cadastro.razaoSocial;
      return c;
    }
    case 'cobranca.criada': {
      const c: CamposDaFicha = { cobrancaCriadaEm: ficha.cobrancaCriadaEm ?? em };
      if (str(p.forma) && !ficha.forma) c.forma = str(p.forma);
      return c;
    }
    case 'pix.pago':
      return ficha.pixPagoEm ? null : { pixPagoEm: data(p.pagoEm) ?? em };
    case 'contrato.assinado_cliente':
      return { contratoAssinadoClienteEm: ficha.contratoAssinadoClienteEm ?? data(p.em) ?? em };
    case 'contrato.assinado_root':
      return { contratoAssinadoRootEm: ficha.contratoAssinadoRootEm ?? data(p.em) ?? em };
    case 'cliente.ativo': {
      const c: CamposDaFicha = { clienteAtivoEm: ficha.clienteAtivoEm ?? em };
      if (str(p.partnerId)) c.partnerId = str(p.partnerId);
      if (str(p.contractId)) c.contractId = str(p.contractId);
      if (str(p.trilhoId)) c.trilhoId = str(p.trilhoId);
      return c;
    }
    case 'kickoff.marcado':
      return data(p.horario) ? { kickoffEm: data(p.horario) } : null;
    case 'saida.registrada':
      return {
        motivoSaida: str(p.motivo),
        motivoDetalhe: str(p.detalhe),
        voltaEm: data(p.voltaEm),
        parceiro: str(p.parceiro),
      };
    default:
      return null;
  }
}

/** O que o portão olha, montado da ficha, do lead e do laudo da última proposta. */
export function estadoDaFicha(
  ficha: Ficha,
  lead: { name: string; phone: string | null },
  laudoOk: boolean | null,
): EstadoParaPortao {
  const cad = (ficha.cadastro ?? {}) as Record<string, unknown>;
  return {
    etapa: ficha.etapa as ComercialEtapa,
    nome: lead.name,
    telefone: lead.phone,
    canal: ficha.canal,
    origemIndicacao: ficha.origemIndicacao,
    perfil: ficha.perfil,
    donoId: ficha.donoId,
    sistemaErp: ficha.sistemaErp,
    baseDados: ficha.baseDados,
    produto: ficha.produto,
    reuniaoEm: ficha.reuniaoEm,
    confirmacaoEnviadaEm: ficha.confirmacaoEnviadaEm,
    ataHash: ficha.ataHash,
    rota: (ficha.rota as EstadoParaPortao['rota']) ?? null,
    socioDaConta: ficha.socioDaConta,
    diagnosticoAprovadoEm: ficha.diagnosticoAprovadoEm,
    valorCentavos: ficha.valorCentavos,
    parcelas: ficha.parcelas,
    forma: ficha.forma,
    quadroDeCustos: ficha.quadroDeCustos != null,
    validade: ficha.validade,
    laudoDoRevisorOk: laudoOk,
    propostaAceitaEm: ficha.propostaAceitaEm,
    cnpj: ficha.cnpj ?? str(cad.cnpj),
    endereco: str(cad.endereco),
    quemAssina: str(cad.quemAssina),
    emailDeQuemAssina: str(cad.email),
    contratoAssinadoClienteEm: ficha.contratoAssinadoClienteEm,
    contratoAssinadoRootEm: ficha.contratoAssinadoRootEm,
    cobrancaCriadaEm: ficha.cobrancaCriadaEm,
  };
}

export interface ResultadoDaMudanca extends Veredicto {
  mudou: boolean;
}

export interface QuemFez {
  id: string | null;
  nome: string | null;
}

const DIA_MS = 86_400_000;

/** O nome provisório de quem entra sem nome: o mesmo da lane B ("Lead" e os 4 últimos dígitos). */
export function nomeDeReserva(telefone: string): string {
  return `Lead ${normalizarTelefone(telefone).slice(-4)}`;
}

/** O nome do lead ainda é o provisório (vazio, o telefone ou "Lead 1234")? */
export function nomeEhProvisorio(nome: string, telefone: string | null): boolean {
  const n = nome.trim();
  return !n || n === telefone || /^Lead \d{4}$/.test(n);
}

@Injectable()
export class FichaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly config: ConfigComercialService,
  ) {}

  /** Garante a ficha do lead (E1 na criação). Idempotente: a ficha é 1:1 pelo `leadId`. */
  async garantir(orgId: string, leadId: string): Promise<Ficha> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true, enteredAt: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    await this.prisma.comercialFicha.createMany({
      data: [{ leadId, etapa: 'novo_lead', etapaDesde: lead.enteredAt }],
      skipDuplicates: true,
    });
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId } });
    if (!ficha) throw new NotFoundException('Ficha do lead não encontrada nesta empresa.');
    return ficha;
  }

  /**
   * E1: o lead entra pelo WhatsApp. O id do lead é DERIVADO do telefone (o
   * mesmo número cai no mesmo lead) e a mensagem vira `whats.recebida`; a
   * primeira vira também `lead.chegou`, que a espinha transforma em ficha.
   */
  async entrarPeloWhats(orgId: string, corpo: unknown, agora = new Date()): Promise<{ leadId: string; leadNovo: boolean; eventoId: string }> {
    const r = ComercialEntradaWhatsSchema.safeParse(corpo);
    if (!r.success) throw new BadRequestException({ message: 'Entrada inválida.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const e = r.data;
    const telefone = normalizarTelefone(e.telefone);
    const leadId = leadIdDoTelefone(orgId, telefone);
    const criado = await this.prisma.lead.createMany({
      data: [{ id: leadId, orgId, name: e.nome ?? nomeDeReserva(telefone), phone: telefone, status: LeadStatus.novo, enteredAt: agora }],
      skipDuplicates: true,
    });
    const doLead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!doLead) throw new ConflictException('Este telefone já é lead de outra empresa.');
    const minuto = agora.toISOString().slice(0, 16);
    const chaveDaMensagem = e.mensagemId ?? hashDoConteudo({ telefone, texto: e.texto, minuto });
    // As MESMAS chaves da entrada da lane B (`WhatsappComercialService.receberEntrada`):
    // o lead que chega pelos dois caminhos cai no mesmo `lead.chegou` e na mesma mensagem.
    const ev = await this.fio.registrar(
      orgId,
      leadId,
      'lead.chegou',
      'whatsapp',
      { telefone, texto: e.texto, canal: e.canal ?? null, palavraChave: e.palavraChave ?? null, nome: e.nome ?? null },
      { em: agora },
    );
    await this.fio.registrar(orgId, leadId, 'whats.recebida', chaveDaMensagem, { texto: e.texto, mensagemId: chaveDaMensagem, provedor: 'entrada' }, { em: new Date(agora.getTime() + 1) });
    return { leadId, leadNovo: criado.count === 1, eventoId: ev.eventoId };
  }

  /** Aplica à ficha os campos que o evento traz (`camposDoEvento`). Devolve o que escreveu. */
  async aplicar(evento: EventoGravado): Promise<{ campos: string[] }> {
    const ficha = await this.garantir(evento.orgId, evento.leadId);
    const campos = camposDoEvento(evento.type, evento.payload, evento.em, ficha);
    if (!campos) return { campos: [] };
    await this.prisma.comercialFicha.update({ where: { id: ficha.id }, data: campos });
    return { campos: Object.keys(campos) };
  }

  async estado(orgId: string, leadId: string): Promise<{ ficha: Ficha; estado: EstadoParaPortao }> {
    const ficha = await this.garantir(orgId, leadId);
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true, phone: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    return { ficha, estado: estadoDaFicha(ficha, lead, await this.laudoDaProposta(leadId, ficha.propostaVersao)) };
  }

  /**
   * O ÚNICO caminho de troca de etapa. Pergunta ao portão; recusado, devolve a
   * lista do que falta e não escreve nada. Aceito, escreve condicionado à
   * etapa lida, atualiza `Lead.status` e grava `etapa.mudou`.
   */
  async mudarEtapa(
    orgId: string,
    leadId: string,
    para: ComercialEtapa,
    opcoes: { motivo: string; eventoGatilho?: string | null; agora?: Date },
  ): Promise<ResultadoDaMudanca> {
    const { ficha, estado } = await this.estado(orgId, leadId);
    const de = ficha.etapa as ComercialEtapa;
    if (de === para) return { ok: true, mudou: false, de, para, faltando: [] };

    let veredicto: Veredicto;
    if (ehSaida(para)) {
      const s = podeSair(de, para);
      veredicto = { ok: s.ok, de, para, faltando: s.motivo ? [s.motivo] : [] };
    } else if (de === 'geladeira') {
      // A geladeira volta só para a etapa em que o lead estava (gravada na saída).
      const volta = (ficha.etapaAntesDaSaida as ComercialEtapa | null) ?? 'qualificacao';
      veredicto = volta === para ? { ok: true, de, para, faltando: [] } : { ok: false, de, para, faltando: [`da geladeira o lead volta para ${COMERCIAL_ROTULO_DA_ETAPA[volta]}`] };
    } else if (de === 'sessao') {
      const v = avancarDepoisDaSessao(estado);
      veredicto = v.ok && v.para !== para ? { ok: false, de, para, faltando: [`a rota da sessão leva a ${COMERCIAL_ROTULO_DA_ETAPA[v.para!]}, não a ${COMERCIAL_ROTULO_DA_ETAPA[para]}`] } : { ...v, para };
    } else {
      veredicto = avancar(estado, para as ComercialEtapaAtiva);
    }
    if (!veredicto.ok) return { ...veredicto, mudou: false };

    const agora = opcoes.agora ?? new Date();
    const escrita = await this.prisma.comercialFicha.updateMany({
      where: { id: ficha.id, etapa: de as EtapaDoBanco },
      data: {
        etapa: para as EtapaDoBanco,
        etapaDesde: agora,
        ...(ehSaida(para) ? { etapaAntesDaSaida: (ehSaida(de) ? ficha.etapaAntesDaSaida : de) as EtapaDoBanco | null } : {}),
      },
    });
    if (escrita.count === 0) return { ok: false, mudou: false, de, para, faltando: ['a etapa mudou por outro caminho no mesmo instante: releia a ficha'] };
    await this.prisma.lead.updateMany({ where: { id: leadId, orgId }, data: { status: LEAD_STATUS_DA_ETAPA[para] as LeadStatus } });
    await this.fio.registrar(
      orgId,
      leadId,
      'etapa.mudou',
      `${de}>${para}:${opcoes.eventoGatilho ?? agora.toISOString()}`,
      { de, para, motivo: opcoes.motivo, eventoGatilho: opcoes.eventoGatilho ?? null },
      { em: agora },
    );
    return { ok: true, mudou: true, de, para, faltando: [] };
  }

  /**
   * Avança passo a passo até `alvo`, cada passo pelo portão. Para no primeiro
   * portão recusado e devolve a lista dele (o lead fica onde chegou). Saída e
   * etapa já além do alvo não andam.
   */
  async avancarAte(orgId: string, leadId: string, alvo: ComercialEtapaAtiva, motivo: string, eventoGatilho: string | null, agora?: Date): Promise<ResultadoDaMudanca> {
    const ordemAlvo = COMERCIAL_ETAPAS.indexOf(alvo);
    let ultimo: ResultadoDaMudanca | null = null;
    for (let passo = 0; passo < COMERCIAL_ETAPAS.length; passo++) {
      const { ficha, estado } = await this.estado(orgId, leadId);
      const atual = ficha.etapa as ComercialEtapa;
      if (atual === alvo) return ultimo ?? { ok: true, mudou: false, de: atual, para: alvo, faltando: [] };
      if (ehSaida(atual)) return { ok: false, mudou: false, de: atual, para: alvo, faltando: [`lead em ${COMERCIAL_ROTULO_DA_ETAPA[atual]}: não avança`] };
      const ordemAtual = COMERCIAL_ETAPAS.indexOf(atual as ComercialEtapaAtiva);
      if (ordemAtual > ordemAlvo) return ultimo ?? { ok: true, mudou: false, de: atual, para: alvo, faltando: [] };
      const proxima = atual === 'sessao' ? (avancarDepoisDaSessao(estado).para ?? 'diagnostico') : proximaEtapa(atual);
      if (!proxima) return { ok: false, mudou: false, de: atual, para: alvo, faltando: ['etapa final'] };
      if (COMERCIAL_ETAPAS.indexOf(proxima as ComercialEtapaAtiva) > ordemAlvo) {
        return { ok: false, mudou: ultimo?.mudou ?? false, de: atual, para: alvo, faltando: [`a rota leva a ${COMERCIAL_ROTULO_DA_ETAPA[proxima as ComercialEtapa]}, além de ${COMERCIAL_ROTULO_DA_ETAPA[alvo]}`] };
      }
      const r = await this.mudarEtapa(orgId, leadId, proxima as ComercialEtapa, { motivo, eventoGatilho, agora });
      if (!r.ok) return { ...r, mudou: ultimo?.mudou ?? false };
      ultimo = r;
    }
    return ultimo ?? { ok: false, mudou: false, de: alvo, para: alvo, faltando: ['avanço não terminou'] };
  }

  /**
   * Saída com motivo e dono. Confere `podeSair` ANTES de gravar o fato: saída
   * recusada não entra no fio. A reação da espinha ao `saida.registrada` aplica
   * os campos e move a etapa.
   */
  async registrarSaida(orgId: string, leadId: string, corpo: unknown, por: QuemFez | null, agora = new Date()): Promise<FichaDoLead> {
    const r = ComercialSaidaSchema.safeParse(corpo);
    if (!r.success) throw new BadRequestException({ message: 'Saída inválida.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const s: ComercialSaidaInput = r.data;
    if (s.saida === 'geladeira' && !s.voltaEm) throw new BadRequestException('Geladeira sem data de volta: a geladeira volta com data marcada.');
    if (s.saida === 'parceiro' && !s.parceiro) throw new BadRequestException('Enviado a parceiro sem dizer para quem.');
    const { ficha } = await this.estado(orgId, leadId);
    const pode = podeSair(ficha.etapa as ComercialEtapa, s.saida);
    if (!pode.ok) throw new ConflictException({ message: 'Saída recusada.', faltando: [pode.motivo] });
    await this.fio.registrar(
      orgId,
      leadId,
      'saida.registrada',
      `${s.saida}:${ficha.etapa}:${ficha.etapaDesde.toISOString()}`,
      { saida: s.saida, motivo: s.motivo, detalhe: s.detalhe ?? null, voltaEm: s.voltaEm ?? null, parceiro: s.parceiro ?? null, por: por?.nome ?? por?.id ?? null },
      { em: agora },
    );
    return this.projecao(orgId, leadId);
  }

  /** E4: a ata chega. Só o HASH vai para o fio; o texto não é gravado aqui (o leitor da lane E o recebe). */
  async registrarAta(orgId: string, leadId: string, corpo: unknown, por: QuemFez | null, agora = new Date()): Promise<{ eventoId: string; novo: boolean; hash: string }> {
    const r = ComercialAtaSchema.safeParse(corpo);
    if (!r.success) throw new BadRequestException({ message: 'Ata inválida.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    await this.garantir(orgId, leadId);
    const hash = hashDoConteudo(r.data.texto);
    const payload: PayloadDe<'ata.chegou'> = { hash, caracteres: r.data.texto.length, fonte: r.data.fonte, referencia: r.data.referencia ?? null, por: por?.nome ?? null };
    const ev = await this.fio.registrar(orgId, leadId, 'ata.chegou', hash, payload, { em: agora });
    return { ...ev, hash };
  }

  /** Tela 05: a ficha inteira, com o portão da próxima etapa e o fio. */
  async projecao(orgId: string, leadId: string): Promise<FichaDoLead> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const ficha = await this.garantir(orgId, leadId);
    const [eventos, sala, documento, cobranca, decisoes] = await Promise.all([
      this.prisma.leadEvent.findMany({ where: { leadId, orgId }, orderBy: { occurredAt: 'asc' }, take: 500 }),
      this.prisma.salaDoCliente.findFirst({ where: { leadId, orgId }, select: { slug: true } }),
      this.prisma.comercialDocumento.findFirst({ where: { leadId, orgId }, orderBy: { criadoEm: 'desc' }, select: { externoId: true } }),
      this.prisma.comercialCobranca.findFirst({ where: { leadId, orgId }, orderBy: { criadoEm: 'desc' }, select: { externoId: true } }),
      this.prisma.comercialDecisao.findMany({ where: { leadId, orgId, estado: 'aberta' }, select: { titulo: true, expiraEm: true } }),
    ]);
    const ultimaProposta = [...eventos].reverse().find((e) => e.type === 'proposta.publicada');
    const laudo = ultimaProposta ? Boolean(((ultimaProposta.payload ?? {}) as { laudo?: { ok?: boolean } }).laudo?.ok) : null;
    const estado = estadoDaFicha(ficha, lead, laudo);
    const etapa = ficha.etapa as ComercialEtapa;
    const proxima = etapa === 'sessao' ? avancarDepoisDaSessao(estado).para ?? 'diagnostico' : proximaEtapa(etapa);
    const itens = portoesDaEtapa(estado);
    const nomes = await this.nomesDeUsuarios(orgId, [ficha.donoId]);

    return {
      leadId,
      nome: lead.name,
      telefone: lead.phone,
      email: lead.email,
      empresa: ficha.empresa,
      cnpj: ficha.cnpj,
      canal: (ficha.canal as ComercialCanalDeEntrada | null) ?? null,
      origemIndicacao: ficha.origemIndicacao,
      perfil: (ficha.perfil as ComercialPerfil | null) ?? null,
      pontuacao: ficha.pontuacao,
      sistemaErp: ficha.sistemaErp,
      baseDados: ficha.baseDados,
      dono: ficha.donoId ? { id: ficha.donoId, nome: nomes.get(ficha.donoId) ?? ficha.donoId } : null,
      socioDaConta: ficha.socioDaConta ? { id: ficha.socioDaConta, nome: ficha.socioDaConta } : null,
      produto: (ficha.produto as ComercialProduto | null) ?? null,
      valorCentavos: ficha.valorCentavos,
      parcelas: ficha.parcelas,
      forma: (ficha.forma as ComercialFormaDePagamento | null) ?? null,
      validade: ficha.validade?.toISOString() ?? null,
      propostaVersao: ficha.propostaVersao,
      etapa,
      etapaDesde: ficha.etapaDesde.toISOString(),
      motivoSaida: (ficha.motivoSaida as ComercialMotivoDeSaida | null) ?? null,
      voltaEm: ficha.voltaEm?.toISOString() ?? null,
      saude: ficha.saude,
      proximaAcao: ficha.proximaAcaoTipo
        ? { tipo: ficha.proximaAcaoTipo, quando: ficha.proximaAcaoQuando?.toISOString() ?? null, descricao: ficha.proximaAcaoTexto ?? '' }
        : null,
      proximasAcoesAutomaticas: decisoes.map((d) => `decisão aberta: ${d.titulo}`),
      portao: { proxima: (proxima as ComercialEtapaAtiva | null) ?? null, faltando: itens.filter((i) => !i.cumprido).map((i) => i.rotulo), itens },
      ligadoA: {
        sala: sala?.slug ?? null,
        ata: Boolean(ficha.ataHash),
        proposta: ficha.propostaVersao > 0 ? ficha.propostaVersao : null,
        contrato: documento?.externoId ?? null,
        cobranca: cobranca?.externoId ?? null,
      },
      fio: linhasDoFio(eventos, lead.enteredAt),
    };
  }

  /** Tela 04: o funil vivo, com as saídas visíveis. Arrastar não existe: não há escrita aqui. */
  async funil(orgId: string, filtro?: string | null, agora = new Date()): Promise<FunilVivo> {
    const cfg = await this.config.ler(orgId);
    const fichas = await this.prisma.comercialFicha.findMany({
      where: { orgId },
      include: { lead: { select: { name: true } } },
      orderBy: { etapaDesde: 'asc' },
      take: 1000,
    });
    const abertas = await this.prisma.comercialDecisao.findMany({ where: { orgId, estado: 'aberta' }, select: { leadId: true } });
    const comDecisao = new Set(abertas.map((d) => d.leadId));
    const cartoes: CartaoDoFunil[] = fichas.map((f) => {
      const diasNaEtapa = Math.max(0, Math.floor((agora.getTime() - f.etapaDesde.getTime()) / DIA_MS));
      const etapa = f.etapa as ComercialEtapa;
      return {
        leadId: f.leadId,
        nome: f.lead.name,
        empresa: f.empresa,
        etapa,
        saude: f.saude,
        proximaAcao: f.proximaAcaoTipo ? { tipo: f.proximaAcaoTipo, quando: f.proximaAcaoQuando?.toISOString() ?? null, descricao: f.proximaAcaoTexto ?? '' } : null,
        precisaDeDecisao: comDecisao.has(f.leadId),
        parado: cfg.leadParadoDias != null && !ehSaida(etapa) && etapa !== 'fechado' && diasNaEtapa > cfg.leadParadoDias,
        diasNaEtapa,
        motivoSaida: (f.motivoSaida as ComercialMotivoDeSaida | null) ?? null,
        voltaEm: f.voltaEm?.toISOString() ?? null,
        perfil: (f.perfil as ComercialPerfil | null) ?? null,
        produto: (f.produto as ComercialProduto | null) ?? null,
      };
    });
    const passa = (c: CartaoDoFunil): boolean => {
      if (!filtro || filtro === 'todos') return true;
      if (filtro === 'parados') return c.parado;
      if (filtro === 'decisao') return c.precisaDeDecisao;
      if (/^P[123]$/.test(filtro)) return c.perfil === filtro;
      if (PRODUTOS.includes(filtro)) return c.produto === filtro;
      return true;
    };
    const visiveis = cartoes.filter(passa);
    return {
      colunas: [
        ...COMERCIAL_ETAPAS.map((e) => ({ etapa: e as ComercialEtapa, rotulo: COMERCIAL_ROTULO_DA_ETAPA[e], cartoes: visiveis.filter((c) => c.etapa === e) })),
        { etapa: 'saidas' as const, rotulo: 'Saídas', cartoes: visiveis.filter((c) => (COMERCIAL_SAIDAS as readonly string[]).includes(c.etapa)) },
      ],
    };
  }

  /** O laudo do revisor na proposta vigente (o portão de E6 o exige limpo). */
  private async laudoDaProposta(leadId: string, versao: number): Promise<boolean | null> {
    if (!versao) return null;
    const ev = await this.prisma.leadEvent.findFirst({ where: { leadId, type: 'proposta.publicada' }, orderBy: { occurredAt: 'desc' }, select: { payload: true } });
    if (!ev) return null;
    return Boolean(((ev.payload ?? {}) as { laudo?: { ok?: boolean } }).laudo?.ok);
  }

  private async nomesDeUsuarios(orgId: string, ids: (string | null)[]): Promise<Map<string, string>> {
    const validos = ids.filter((x): x is string => !!x);
    if (!validos.length) return new Map();
    const us = await this.prisma.user.findMany({ where: { orgId, id: { in: validos } }, select: { id: true, name: true } });
    return new Map(us.map((u) => [u.id, u.name]));
  }
}
