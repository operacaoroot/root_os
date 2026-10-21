import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  COMERCIAL_ETAPAS,
  COMERCIAL_ROTULO_DA_ETAPA,
  COMERCIAL_SAIDAS,
  ComercialAtaSchema,
  ComercialEntradaWhatsSchema,
  COMERCIAL_SEM_MOTIVO_INFORMADO,
  ComercialSaidaSchema,
  LEAD_STATUS_DA_ETAPA,
  avisoDoMoverAMao,
  destinoDoMover,
  ehSaida,
  filtroDoFunil,
  filtrosDoFiltroAntigo,
  filtrosDoFunilVazios,
  mensagemDoMover,
  proximaEtapa,
  type ComercialAvisoDoMover,
  type ComercialBalaoDoMover,
  type ComercialFiltrosDoFunil,
  type ComercialMoverInput,
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
import { ActorType, LeadStatus, Prisma, type ComercialEtapa as EtapaDoBanco } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ConfigComercialService } from './config.service';
import { hashDoConteudo, leadIdDoTelefone, linhasDoFio, normalizarTelefone, type PayloadDe } from './eventos';
import { guardarAtaEmTransito } from './ata-em-transito';
import { FioService, type EventoGravado } from './fio.service';
import { produtoAlvo } from './pontuacao';
import { decisaoSemPrazo } from './decisoes.service';
import { proximaAcaoDoLead, saudeDoLead, type DecisaoParaProximaAcao } from './proxima-acao';
import { avancar, avancarDepoisDaSessao, pendenciasDasEtapas, pendenciasDoMover, pendenciasQueRestam, podeSair, portoesDaEtapa, type EstadoParaPortao, type Veredicto } from './portoes';

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
    case 'aceite.declarado': {
      // T1b: o aceite que uma pessoa declarou (fechado fora do sistema). As condições e o cadastro vão à
      // ficha; `propostaAceitaEm` NÃO, porque o cliente não aceitou nada na sala.
      const cadastro = { cnpj: str(p.cnpj), razaoSocial: str(p.razaoSocial), endereco: str(p.endereco), quemAssina: str(p.quemAssina), email: str(p.email) };
      const c: CamposDaFicha = { cadastro: cadastro as Prisma.InputJsonValue };
      if (cadastro.cnpj) c.cnpj = cadastro.cnpj;
      if (cadastro.razaoSocial) c.empresa = cadastro.razaoSocial;
      if (str(p.produto) && PRODUTOS.includes(str(p.produto)!)) c.produto = str(p.produto);
      if (num(p.valorCentavos) !== null) c.valorCentavos = num(p.valorCentavos);
      if (num(p.parcelas) !== null) c.parcelas = num(p.parcelas);
      if (str(p.forma)) c.forma = str(p.forma);
      return c;
    }
    case 'cobranca.criada': {
      const c: CamposDaFicha = { cobrancaCriadaEm: ficha.cobrancaCriadaEm ?? em };
      if (str(p.forma) && !ficha.forma) c.forma = str(p.forma);
      return c;
    }
    case 'pix.pago':
    case 'boleto.pago':
    case 'cartao.pago':
      // D-10: o nome do fato é o da forma; o campo é o da 1ª parcela paga.
      return ficha.pixPagoEm ? null : { pixPagoEm: data(p.pagoEm) ?? em };
    case 'parcela.estornada':
      // D-10: a 1ª parcela estornada volta a não paga na ficha (a próxima ação volta a pedir o pagamento).
      return Number(p.parcela) === 1 && ficha.pixPagoEm ? { pixPagoEm: null } : null;
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
    case 'lead.importado': {
      // Rodada de produção 1: o que o cartão do CRM antigo trazia preenche só o que a ficha ainda não tem.
      const c: CamposDaFicha = {};
      if (str(p.empresa) && !ficha.empresa) c.empresa = str(p.empresa);
      if (str(p.cnpj) && !ficha.cnpj) c.cnpj = str(p.cnpj);
      if (str(p.produto) && PRODUTOS.includes(str(p.produto)!) && !ficha.produto) c.produto = str(p.produto);
      if (num(p.valorCentavos) !== null && ficha.valorCentavos == null) c.valorCentavos = num(p.valorCentavos);
      return Object.keys(c).length ? c : null;
    }
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

/**
 * O laudo abre o portão de E6 quando saiu limpo, ou quando uma pessoa levou a
 * versão à liberação na decisão `proposta_fora_da_tabela` (revisão E-3: o
 * quadro de exemplo é apontamento, e quem decide é gente).
 */
function laudoQueAbreOPortao(payload: unknown): boolean {
  const l = ((payload ?? {}) as { laudo?: { ok?: boolean; liberadoNaDecisao?: unknown } }).laudo;
  return l?.ok === true || typeof l?.liberadoNaDecisao === 'string';
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
  /** P5: o que ficou em aberto quando uma pessoa moveu com pendência (vazio no caminho dos portões). */
  pendencias?: string[];
  /** U4: as etapas cujas conclusões ficaram para trás no mover à mão. */
  semConclusoesDe?: ComercialEtapa[];
  /** U4: a frase da tela do mover à mão. */
  mensagem?: string;
  /** U4: o aviso que o cartão passa a mostrar (E8 e E9 à mão, saída sem motivo). */
  aviso?: string | null;
}

export interface QuemFez {
  id: string | null;
  nome: string | null;
}

const DIA_MS = 86_400_000;
/** C-20: quantas fichas o funil lê de uma vez. */
export const TETO_DO_FUNIL = 1000;

function paraProximaAcao(d: { titulo: string; padrao: string; expiraEm: Date }): DecisaoParaProximaAcao {
  return { titulo: d.titulo, padrao: d.padrao, expiraEm: d.expiraEm, semPrazo: decisaoSemPrazo(d.expiraEm) };
}

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
    opcoes: {
      motivo: string;
      eventoGatilho?: string | null;
      agora?: Date;
      /**
       * P5: a mudança vem de uma PESSOA pela tela (já autorizada pela aprovação
       * da rota). Aqui o portão em aberto AVISA em vez de travar: a etapa muda e
       * `etapa.movida_com_pendencia` entra na MESMA transação, com a lista. Sem
       * `pessoa` (reações, relógio, agente), o portão recusa como sempre.
       */
      pessoa?: QuemFez;
      /**
       * U4: a saída à mão (só com `pessoa` e destino de saída). Vai no MESMO
       * gesto: os campos da saída entram na escrita da etapa e o fato
       * `saida.registrada` na mesma transação.
       */
      saida?: PayloadDe<'saida.registrada'>;
      /** U4: o motivo escrito da saída à mão (`null` = sem motivo informado). */
      motivoDoMover?: { texto: string | null; semMotivo: boolean };
      /**
       * T1b: o cliente que fechou FORA do sistema vai a E9 quando o fechamento conclui
       * (`cliente.ativo`), sem percorrer o funil. Só vale para `fechado`, nunca a partir de uma
       * saída, e o motivo escrito vai no `etapa.mudou`. Quem chama confere o registro e o fato.
       */
      fechadoForaDoSistema?: boolean;
    },
  ): Promise<ResultadoDaMudanca> {
    const { ficha, estado } = await this.estado(orgId, leadId);
    const de = ficha.etapa as ComercialEtapa;
    if (de === para) return { ok: true, mudou: false, de, para, faltando: [] };

    let veredicto: Veredicto;
    let comPendencia: { atravessadas: string[]; pendencias: string[] } | null = null;
    if (opcoes.fechadoForaDoSistema) {
      veredicto = para === 'fechado' && !ehSaida(de) ? { ok: true, de, para, faltando: [] } : { ok: false, de, para, faltando: ['o registro de cliente fechado fora só leva a Negócio fechado, e nunca a partir de uma saída'] };
    } else if (opcoes.pessoa) {
      // U4 (20/10/2026, decisão do dono do produto): GENTE move para qualquer etapa. O portão em aberto
      // não trava: vira a lista do fato `etapa.movida_a_mao` e o balão. Este ramo é SÓ da pessoa (a rota
      // do mover, com `SoGenteGuard` e a releitura no banco); sem `pessoa`, os portões abaixo recusam como sempre.
      const destino = destinoDoMover(de, para, (ficha.etapaAntesDaSaida as ComercialEtapaAtiva | null) ?? null);
      if (!destino.permitido) return { ok: false, mudou: false, de, para, faltando: [destino.motivo ?? 'mover recusado'] };
      const p = pendenciasDoMover(estado, de, para);
      if (p.pendencias.length) comPendencia = p;
      veredicto = { ok: true, de, para, faltando: [] };
    } else if (ehSaida(para)) {
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
    const aMao = opcoes.pessoa ?? null;
    const saidaAMao = aMao && ehSaida(para) ? (opcoes.saida ?? null) : null;
    // A-5: a etapa, o `Lead.status` e o fato `etapa.mudou` numa transação só. Queda no meio desfaz as três:
    // nunca a etapa nova sem o fato no fio (o fio é a fonte da ficha). As reações ao fato rodam depois do commit.
    const gravado = await this.prisma.$transaction(async (tx) => {
      const escrita = await tx.comercialFicha.updateMany({
        where: { id: ficha.id, etapa: de as EtapaDoBanco },
        data: {
          etapa: para as EtapaDoBanco,
          etapaDesde: agora,
          ...(ehSaida(para) ? { etapaAntesDaSaida: (ehSaida(de) ? ficha.etapaAntesDaSaida : de) as EtapaDoBanco | null } : {}),
          // U4: a saída à mão leva os campos dela na mesma escrita; voltar de uma saída à mão limpa os da saída
          // (senão o cartão ativo mostraria o motivo da saída antiga).
          ...(saidaAMao
            ? { motivoSaida: saidaAMao.motivo, motivoDetalhe: saidaAMao.detalhe ?? null, voltaEm: saidaAMao.voltaEm ? new Date(saidaAMao.voltaEm) : null, parceiro: saidaAMao.parceiro ?? null }
            : {}),
          ...(aMao && ehSaida(de) && !ehSaida(para) ? { motivoSaida: null, motivoDetalhe: null, voltaEm: null, parceiro: null } : {}),
        },
      });
      if (escrita.count === 0) return null;
      await tx.lead.updateMany({ where: { id: leadId, orgId }, data: { status: LEAD_STATUS_DA_ETAPA[para] as LeadStatus } });
      const chave = `${de}>${para}:${opcoes.eventoGatilho ?? agora.toISOString()}`;
      const mudou = await this.fio.gravarNaTransacao(
        tx,
        orgId,
        leadId,
        'etapa.mudou',
        chave,
        { de, para, motivo: opcoes.motivo, eventoGatilho: opcoes.eventoGatilho ?? null },
        agora,
      );
      // U4: o mover à mão fica no fio com a MESMA chave da mudança (a mesma mudança cai no mesmo fato) e na
      // auditoria, na mesma transação. Substitui o `etapa.movida_com_pendencia` da P5 (os fatos antigos seguem
      // valendo para o balão): a lista do que ficou para trás vai aqui.
      const movida = aMao
        ? await this.fio.gravarNaTransacao(
            tx,
            orgId,
            leadId,
            'etapa.movida_a_mao',
            chave,
            {
              de,
              para,
              pendencias: comPendencia?.pendencias ?? [],
              atravessadas: comPendencia?.atravessadas ?? [],
              por: aMao.nome ?? null,
              porId: aMao.id ?? null,
              motivo: opcoes.motivoDoMover?.texto ?? null,
              semMotivo: opcoes.motivoDoMover?.semMotivo ?? false,
            },
            new Date(agora.getTime() + 1),
          )
        : null;
      // U4: a saída à mão é o MESMO fato da rota de saída, com a mesma forma de chave (etapa de origem e o
      // instante em que entrou nela): registrar a saída pelos dois caminhos no mesmo estado cai num fato só.
      const saida = saidaAMao
        ? await this.fio.gravarNaTransacao(tx, orgId, leadId, 'saida.registrada', `${para}:${de}:${ficha.etapaDesde.toISOString()}`, saidaAMao, new Date(agora.getTime() + 2))
        : null;
      if (aMao && movida?.novo) {
        await tx.auditLog.create({
          data: {
            orgId,
            actorType: ActorType.user,
            actorId: aMao.id,
            action: 'comercial.etapa.movida_a_mao',
            entityType: 'lead',
            entityId: leadId,
            before: { etapa: de } as Prisma.InputJsonValue,
            after: {
              etapa: para,
              pendencias: comPendencia?.pendencias ?? [],
              motivo: opcoes.motivoDoMover?.texto ?? null,
              semMotivo: opcoes.motivoDoMover?.semMotivo ?? false,
              eventoId: movida.evento.eventoId,
            } as Prisma.InputJsonValue,
          },
        });
      }
      return { mudou, movida, saida };
    });
    if (!gravado) return { ok: false, mudou: false, de, para, faltando: ['a etapa mudou por outro caminho no mesmo instante: releia a ficha'] };
    if (gravado.mudou.novo) await this.fio.reagir(gravado.mudou.evento);
    if (gravado.movida?.novo) await this.fio.reagir(gravado.movida.evento);
    if (gravado.saida?.novo) await this.fio.reagir(gravado.saida.evento);
    return { ok: true, mudou: true, de, para, faltando: [], pendencias: comPendencia?.pendencias ?? [] };
  }

  /**
   * U4 (20/10/2026): o MOVER À MÃO de uma pessoa, para qualquer etapa. Quem
   * chama (a rota, com `SoGenteGuard`, e o `MoverService`, que relê a pessoa no
   * banco) já garantiu que é gente com `leads.editar`. Escreve por `mudarEtapa`
   * com `pessoa` e devolve a mensagem da tela. Nenhuma escrita do fechamento
   * nasce daqui: só a etapa, o fio e a auditoria (e, na saída, o fato de saída).
   */
  async moverAMao(orgId: string, leadId: string, entrada: ComercialMoverInput, pessoa: QuemFez, agora?: Date): Promise<ResultadoDaMudanca> {
    const { ficha, estado } = await this.estado(orgId, leadId);
    const de = ficha.etapa as ComercialEtapa;
    const para = entrada.para as ComercialEtapa;
    const texto = entrada.motivo?.trim() ? entrada.motivo.trim() : null;
    const saida: PayloadDe<'saida.registrada'> | undefined = ehSaida(para)
      ? {
          saida: para,
          motivo: entrada.tipoDeMotivo ?? 'outro',
          detalhe: texto ?? COMERCIAL_SEM_MOTIVO_INFORMADO,
          voltaEm: para === 'geladeira' ? (entrada.voltaEm ?? null) : null,
          parceiro: para === 'parceiro' ? (entrada.parceiro?.trim() || null) : null,
          por: pessoa.nome ?? pessoa.id ?? null,
        }
      : undefined;
    const semMotivo = ehSaida(para) && !texto;
    const r = await this.mudarEtapa(orgId, leadId, para, {
      motivo: `movido à mão por ${pessoa.nome ?? 'pessoa da mesa'} pela tela do funil`,
      eventoGatilho: `mao:${ficha.etapaDesde.toISOString()}`,
      pessoa,
      saida,
      motivoDoMover: ehSaida(para) ? { texto, semMotivo } : undefined,
      agora,
    });
    if (!r.ok) return r;
    if (!r.mudou) return { ...r, pendencias: [], semConclusoesDe: [], mensagem: `O lead já está em ${COMERCIAL_ROTULO_DA_ETAPA[para]}.`, aviso: null };
    const pendencias = r.pendencias ?? [];
    const semConclusoesDe = pendencias.length
      ? pendenciasDoMover(estado, de, para).atravessadas.filter((s) => pendenciasDasEtapas(estado, [s]).length > 0)
      : [];
    return { ...r, pendencias, semConclusoesDe, mensagem: mensagemDoMover(para, semConclusoesDe, pendencias), aviso: avisoDoMoverAMao(para, semMotivo) };
  }

  /**
   * P5: o balão de cada lead, calculado ao projetar. Lê os fatos
   * `etapa.movida_com_pendencia` dos leads pedidos e pergunta aos portões, com a
   * ficha de agora, o que ainda falta nas etapas que pessoas atravessaram.
   * Sanou tudo, o lead não entra no mapa.
   */
  async baloes(orgId: string, leadIds: readonly string[]): Promise<Map<string, ComercialBalaoDoMover>> {
    const saida = new Map<string, ComercialBalaoDoMover>();
    if (!leadIds.length) return saida;
    const fatos = await this.prisma.leadEvent.findMany({
      // U4: o mover à mão de agora grava `etapa.movida_a_mao`; os fatos da P5 seguem valendo.
      where: { orgId, type: { in: ['etapa.movida_com_pendencia', 'etapa.movida_a_mao'] }, leadId: { in: [...leadIds] } },
      orderBy: { occurredAt: 'asc' },
      select: { leadId: true, payload: true, occurredAt: true },
    });
    const atravessadasDo = (f: (typeof fatos)[number]): string[] => {
      const a = (f.payload as { atravessadas?: unknown } | null)?.atravessadas;
      return Array.isArray(a) ? a.map(String) : [];
    };
    const porLead = new Map<string, typeof fatos>();
    // Só os movimentos que deixaram etapa para trás com pendência contam (o mover à mão sem pendência não tem balão).
    for (const f of fatos) if (atravessadasDo(f).length) porLead.set(f.leadId, [...(porLead.get(f.leadId) ?? []), f]);
    for (const [leadId, lista] of porLead) {
      const atravessadas = lista.flatMap(atravessadasDo);
      const { estado } = await this.estado(orgId, leadId);
      const pendencias = pendenciasQueRestam(estado, atravessadas);
      if (!pendencias.length) continue;
      const ultimo = lista[lista.length - 1];
      const por = (ultimo.payload as { por?: unknown } | null)?.por;
      saida.set(leadId, { pendencias, movidoPor: typeof por === 'string' && por ? por : null, em: ultimo.occurredAt.toISOString() });
    }
    return saida;
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
    // E-24: o id de quem subiu a ata vai junto do nome; o sócio da conta é achado por ele, nunca pelo nome.
    const payload: PayloadDe<'ata.chegou'> = { hash, caracteres: r.data.texto.length, fonte: r.data.fonte, referencia: r.data.referencia ?? null, por: por?.nome ?? null, porId: por?.id ?? null };
    // Lane E: o texto fica só na memória do processo para o leitor de ata (reação); nunca no banco.
    guardarAtaEmTransito(orgId, leadId, hash, r.data.texto);
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
      this.prisma.comercialDecisao.findMany({ where: { leadId, orgId, estado: 'aberta' }, select: { titulo: true, expiraEm: true, padrao: true } }),
    ]);
    const cfg = await this.config.ler(orgId);
    const agora = new Date();
    const ultimaProposta = [...eventos].reverse().find((e) => e.type === 'proposta.publicada');
    const laudo = ultimaProposta ? laudoQueAbreOPortao(ultimaProposta.payload) : null;
    const estado = estadoDaFicha(ficha, lead, laudo);
    const etapa = ficha.etapa as ComercialEtapa;
    const proxima = etapa === 'sessao' ? avancarDepoisDaSessao(estado).para ?? 'diagnostico' : proximaEtapa(etapa);
    const itens = portoesDaEtapa(estado);
    const nomes = await this.nomesDeUsuarios(orgId, [ficha.donoId]);
    // E-24: o sócio da conta é a pessoa da ata que gravou o nome (a primeira com `por`), achada pelo id
    // que a ata trouxe e conferida na empresa. Dois usuários com o mesmo nome não se confundem.
    const ataDoSocio = ficha.socioDaConta ? eventos.find((e) => e.type === 'ata.chegou' && (e.payload as { por?: unknown } | null)?.por === ficha.socioDaConta) : undefined;
    const idDaAta = ataDoSocio ? (ataDoSocio.payload as { porId?: unknown }).porId : null;
    const socio = typeof idDaAta === 'string' && idDaAta ? await this.prisma.user.findFirst({ where: { id: idDaAta, orgId }, select: { id: true } }) : null;
    const balao = (await this.baloes(orgId, [leadId])).get(leadId) ?? null;
    // I1: o retrolink lead → card da implantação (o card é do Trabalho; a empresa é conferida aqui).
    const card = ficha.cardId
      ? await this.prisma.workTask.findFirst({ where: { id: ficha.cardId, orgId }, select: { id: true, listId: true, status: { select: { name: true } } } })
      : null;

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
      // A ficha guarda o NOME de quem conduziu a sessão (o `por` da ata); o id vem da ata. Sem ele, nulo.
      socioDaConta: ficha.socioDaConta ? { id: socio?.id ?? null, nome: ficha.socioDaConta } : null,
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
      // Lane E, fase 2: projeção (`proxima-acao.ts`); as colunas da tabela não são lidas.
      saude: saudeDoLead(),
      proximaAcao: proximaAcaoDoLead(ficha, cfg, decisoes.map(paraProximaAcao), agora),
      proximasAcoesAutomaticas: decisoes.map((d) => `decisão aberta: ${d.titulo}`),
      portao: { proxima: (proxima as ComercialEtapaAtiva | null) ?? null, faltando: itens.filter((i) => !i.cumprido).map((i) => i.rotulo), itens },
      ligadoA: {
        sala: sala?.slug ?? null,
        ata: Boolean(ficha.ataHash),
        proposta: ficha.propostaVersao > 0 ? ficha.propostaVersao : null,
        contrato: documento?.externoId ?? null,
        cobranca: cobranca?.externoId ?? null,
        implantacao: card ? { cardId: card.id, listId: card.listId, etapa: card.status.name, trilhoId: ficha.trilhoId ?? null } : null,
      },
      fio: linhasDoFio(eventos, lead.enteredAt),
      balao,
    };
  }

  /**
   * Tela 04: o funil vivo, com as saídas visíveis. Só leitura: mover o cartão é
   * `mudarEtapa` com `pessoa`, chamado pela rota aprovada (P5).
   *
   * C-20: acima do teto, o corte é dos que mudaram de etapa HÁ MAIS TEMPO (os
   * novos sempre aparecem) e a resposta diz quantos ficaram de fora. Na tela, a
   * ordem segue a de antes (dentro da coluna, o mais antigo na etapa primeiro).
   */
  async funil(
    orgId: string,
    filtro?: string | Partial<ComercialFiltrosDoFunil> | null,
    agora = new Date(),
    teto = TETO_DO_FUNIL,
    quemPergunta?: string | null,
  ): Promise<FunilVivo> {
    const cfg = await this.config.ler(orgId);
    // U4: os filtros do painel. O `?filtro=` antigo (etiqueta) chega como texto e é traduzido para o mesmo formato.
    const antigo = typeof filtro === 'string' || filtro == null ? (filtro ?? null) : null;
    const f: ComercialFiltrosDoFunil = { ...filtrosDoFunilVazios(), ...(antigo !== null || filtro == null ? filtrosDoFiltroAntigo(antigo) : (filtro as Partial<ComercialFiltrosDoFunil>)) };
    for (const k of Object.keys(f) as (keyof ComercialFiltrosDoFunil)[]) f[k] = String(f[k] ?? '').trim().slice(0, 120);
    const abertas = await this.prisma.comercialDecisao.findMany({ where: { orgId, estado: 'aberta' }, select: { leadId: true, titulo: true, padrao: true, expiraEm: true } });
    const comDecisao = new Set(abertas.map((d) => d.leadId));
    const decisoesDo = (leadId: string) => abertas.filter((d) => d.leadId === leadId).map(paraProximaAcao);
    // O filtro vai no banco, antes do teto: o corte acima do teto é dos leads que PASSAM no filtro.
    const e: Prisma.ComercialFichaWhereInput[] = [];
    if (f.dono === 'sem') e.push({ donoId: null });
    else if (f.dono === 'eu') e.push({ donoId: quemPergunta || '__ninguem__' });
    else if (f.dono) e.push({ donoId: f.dono });
    if (f.produto) e.push({ produto: f.produto });
    if (f.perfil) e.push({ perfil: f.perfil });
    if (f.etapa === 'saidas') e.push({ etapa: { in: [...COMERCIAL_SAIDAS] as EtapaDoBanco[] } });
    else if (f.etapa && ((COMERCIAL_ETAPAS as readonly string[]).includes(f.etapa) || (COMERCIAL_SAIDAS as readonly string[]).includes(f.etapa))) e.push({ etapa: f.etapa as EtapaDoBanco });
    else if (f.etapa) e.push({ leadId: { in: [] } });
    if (f.decisao) e.push({ leadId: { in: [...comDecisao] } });
    if (f.parado) {
      // A mesma conta do `parado` do cartão: dias inteiros na etapa ACIMA do limite, fora das saídas e do fechado.
      if (cfg.leadParadoDias == null) e.push({ leadId: { in: [] } });
      else {
        e.push({ etapa: { in: COMERCIAL_ETAPAS.filter((x) => x !== 'fechado') as EtapaDoBanco[] } });
        e.push({ etapaDesde: { lte: new Date(agora.getTime() - (cfg.leadParadoDias + 1) * DIA_MS) } });
      }
    }
    if (f.q) e.push({ OR: [{ empresa: { contains: f.q, mode: 'insensitive' } }, { lead: { name: { contains: f.q, mode: 'insensitive' } } }] });
    const where: Prisma.ComercialFichaWhereInput = e.length ? { orgId, AND: e } : { orgId };
    const [total, maisNovas, comDono] = await Promise.all([
      this.prisma.comercialFicha.count({ where }),
      this.prisma.comercialFicha.findMany({
        where,
        include: { lead: { select: { name: true } } },
        orderBy: [{ etapaDesde: 'desc' }, { leadId: 'asc' }],
        take: teto,
      }),
      this.prisma.comercialFicha.findMany({ where: { orgId, donoId: { not: null } }, select: { donoId: true }, distinct: ['donoId'] }),
    ]);
    const fichas = [...maisNovas].reverse();
    const fora = Math.max(0, total - fichas.length);
    const nomes = await this.nomesDeUsuarios(orgId, comDono.map((d) => d.donoId));
    const cartoes: CartaoDoFunil[] = fichas.map((ficha) => {
      const diasNaEtapa = Math.max(0, Math.floor((agora.getTime() - ficha.etapaDesde.getTime()) / DIA_MS));
      const etapa = ficha.etapa as ComercialEtapa;
      return {
        leadId: ficha.leadId,
        nome: ficha.lead.name,
        empresa: ficha.empresa,
        etapa,
        saude: saudeDoLead(),
        proximaAcao: proximaAcaoDoLead(ficha, cfg, decisoesDo(ficha.leadId), agora),
        precisaDeDecisao: comDecisao.has(ficha.leadId),
        parado: cfg.leadParadoDias != null && !ehSaida(etapa) && etapa !== 'fechado' && diasNaEtapa > cfg.leadParadoDias,
        diasNaEtapa,
        motivoSaida: (ficha.motivoSaida as ComercialMotivoDeSaida | null) ?? null,
        voltaEm: ficha.voltaEm?.toISOString() ?? null,
        perfil: (ficha.perfil as ComercialPerfil | null) ?? null,
        produto: (ficha.produto as ComercialProduto | null) ?? null,
        voltaPara: etapa === 'geladeira' ? ((ficha.etapaAntesDaSaida as ComercialEtapaAtiva | null) ?? 'qualificacao') : null,
        balao: null,
        donoId: ficha.donoId ?? null,
        dono: ficha.donoId ? (nomes.get(ficha.donoId) ?? null) : null,
        avisoDoMover: null,
      };
    });
    // P5: o balão de quem moveu com pendência; U4: o aviso de quem moveu à mão. Só dos cartões que vão à tela.
    const ids = cartoes.map((c) => c.leadId);
    const [baloes, avisos] = await Promise.all([this.baloes(orgId, ids), this.avisosDoMover(orgId, fichas)]);
    for (const c of cartoes) {
      c.balao = baloes.get(c.leadId) ?? null;
      c.avisoDoMover = avisos.get(c.leadId) ?? null;
    }
    return {
      total,
      filtro: filtroDoFunil(antigo),
      filtros: f,
      donos: [...nomes.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      aviso: fora ? `O funil mostra os ${fichas.length} leads que mudaram de etapa por último; ${fora} ${fora === 1 ? 'ficou' : 'ficaram'} de fora. Use um filtro.` : null,
      colunas: [
        ...COMERCIAL_ETAPAS.map((etapa) => ({ etapa: etapa as ComercialEtapa, rotulo: COMERCIAL_ROTULO_DA_ETAPA[etapa], cartoes: cartoes.filter((c) => c.etapa === etapa) })),
        { etapa: 'saidas' as const, rotulo: 'Saídas', cartoes: cartoes.filter((c) => (COMERCIAL_SAIDAS as readonly string[]).includes(c.etapa)) },
      ],
    };
  }

  /**
   * U4: o aviso de quem moveu à mão, lido do último `etapa.movida_a_mao` de
   * cada lead. Vale enquanto o lead está na etapa para onde a pessoa o levou
   * (o fato é do instante em que ele entrou nela). Some quando o fato de
   * verdade chega: o aceite para E8, o fechamento para E9.
   */
  private async avisosDoMover(
    orgId: string,
    fichas: readonly { leadId: string; etapa: string; etapaDesde: Date; propostaAceitaEm: Date | null; clienteAtivoEm: Date | null }[],
  ): Promise<Map<string, ComercialAvisoDoMover>> {
    const saida = new Map<string, ComercialAvisoDoMover>();
    const candidatas = fichas.filter((f) => f.etapa === 'fechado' || f.etapa === 'contrato' || ehSaida(f.etapa as ComercialEtapa));
    if (!candidatas.length) return saida;
    const fatos = await this.prisma.leadEvent.findMany({
      where: { orgId, type: 'etapa.movida_a_mao', leadId: { in: candidatas.map((f) => f.leadId) } },
      orderBy: { occurredAt: 'desc' },
      select: { leadId: true, payload: true, occurredAt: true },
    });
    for (const f of candidatas) {
      const ultimo = fatos.find((x) => x.leadId === f.leadId);
      if (!ultimo || ultimo.occurredAt.getTime() < f.etapaDesde.getTime()) continue;
      const p = (ultimo.payload ?? {}) as { para?: unknown; por?: unknown; semMotivo?: unknown };
      if (p.para !== f.etapa) continue;
      if (f.etapa === 'fechado' && f.clienteAtivoEm) continue;
      if (f.etapa === 'contrato' && f.propostaAceitaEm) continue;
      const texto = avisoDoMoverAMao(f.etapa as ComercialEtapa, p.semMotivo === true);
      if (texto) saida.set(f.leadId, { texto, por: typeof p.por === 'string' && p.por ? p.por : null, em: ultimo.occurredAt.toISOString() });
    }
    return saida;
  }

  /** O laudo do revisor na proposta vigente (o portão de E6 o exige limpo). */
  private async laudoDaProposta(leadId: string, versao: number): Promise<boolean | null> {
    if (!versao) return null;
    const ev = await this.prisma.leadEvent.findFirst({ where: { leadId, type: 'proposta.publicada' }, orderBy: { occurredAt: 'desc' }, select: { payload: true } });
    if (!ev) return null;
    return laudoQueAbreOPortao(ev.payload);
  }

  private async nomesDeUsuarios(orgId: string, ids: (string | null)[]): Promise<Map<string, string>> {
    const validos = ids.filter((x): x is string => !!x);
    if (!validos.length) return new Map();
    const us = await this.prisma.user.findMany({ where: { orgId, id: { in: validos } }, select: { id: true, name: true } });
    return new Map(us.map((u) => [u.id, u.name]));
  }
}
