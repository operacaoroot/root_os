import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import {
  COMERCIAL_ETAPAS,
  COMERCIAL_ROTULO_DA_AUTOMACAO,
  COMERCIAL_ROTULO_DA_ETAPA,
  LEAD_STATUS_DA_ETAPA,
  TABELA_DE_PRECO_DATA,
  precoNaTabela,
  partesNoFuso,
  type ComercialAutomacao,
  type ComercialEtapa,
  type ComercialProduto,
  type PremissaDoVigia,
} from '@mktos/shared';

import { RegistroDeConectores } from '../integrations/conectores.registry';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { MemoriaService } from '../memory/memoria.service';
import { fusoDaPolitica, minutosNoFuso } from '../policy/limites';
import { PrismaService } from '../prisma/prisma.service';
import { horariosOferecidos } from './agenda-de-homologacao';
import { ConfigComercialService } from './config.service';
import { DecisoesService, SEM_PRAZO } from './decisoes.service';
import { FioService } from './fio.service';
import { CHAVE_DO_VIGIA, corpoComDado, dadoDaNota, gravarNota } from './notas-do-comercial';
import { proximaAcaoDoLead } from './proxima-acao';
import { RelogioComercialRegistry } from './relogio.registry';
import { MENSAGENS } from './mensagens';

/*
 * O VIGIA DAS 08:00 (lane E, fase 2, 13/10/2026) — mapa C05/C10/K03 e tela 12.
 *
 * "Automação morre em silêncio": a esteira do escritório morreu três vezes sem
 * ninguém ver (status renomeado, encoding, banco corrompido). O vigia confere,
 * uma vez por dia às 08:00 do fuso da política (`POLITICA_FUSO_HORARIO`, padrão
 * São Paulo; a hora vem de `minutosNoFuso`/`partesNoFuso`, nunca do `TZ` do
 * processo), as premissas que o mapa escreve, e só avisa do que quebrou.
 *
 * AS PREMISSAS, E DE ONDE CADA UMA VEM
 *
 * Das automações (tela 12, a coluna "premissa conferida hoje"):
 *   · qualificador · "formulário grava no lead": todo `form.respondido` dos
 *     últimos 30 dias deixou o sistema e a base na ficha;
 *   · agendador · "agenda da Root responde": a agenda real é [a decidir]. A
 *     de homologação é uma conta determinística: só vale como conferida com os
 *     valores de homologação ligados; fora deles fica não conferida (revisão E-12);
 *   · leitor de ata · "chave do modelo válida": o vigia não chama o modelo (seria
 *     gasto para conferir). Com o stub não há o que conferir: não conferida. Com
 *     a ponte, lê o `/saude` dela (sem token): fora do ar ou com falhas seguidas
 *     é quebrada. Com provedor de produção, não conferida (`null`). Revisão E-12:
 *     antes o stub e a ponte saíam "ok" sem conferir nada;
 *   · construtor de proposta · "tabela de preço de 04/10": a tabela em vigor é a
 *     de 04/10 e toda proposta publicada como "dentro da tabela" nos últimos 30
 *     dias tem o preço da linha;
 *   · fupeiro · "textos M5 e M6 aprovados": os dois textos existem no catálogo;
 *   · assinador · "ZapSign API responde 200": a MESMA sonda da tela de Conexões
 *     (`RegistroDeConectores.sondar`, chave `zapsign`). Conector desligado não é
 *     sondado (sondar é sair da casa, e o botão de emergência impede): fica não
 *     conferida, como fica sem o registro (a suíte que monta à mão);
 *   · cobrador · "webhook do Asaas chegando": parcela vencida há mais de
 *     `cobrancaSemWebhookDias` sem pagamento nem aviso de atraso. Sem o número
 *     ([a decidir]), não conferida;
 *   · fechador · "chave de transação única": nenhum lead com dois `cliente.ativo`
 *     de chaves diferentes;
 *   · revisor, relator e vigia: o mapa não escreve premissa. [a decidir].
 *   · assistente da proposta (E-15): a regra é do código, sem medida diária;
 *     fica não conferida.
 *
 * Do funil (C07 e a prova de pronto da onda 5):
 *   · "lead vivo sem próximo passo é alerta do vigia" (C07): lead em etapa ativa
 *     sem próxima ação projetada;
 *   · "falha simulada (status renomeado de propósito) acusada no mesmo dia" (onda
 *     5): o `Lead.status` difere do que o mapa fixo manda para a etapa;
 *   · decisão vencida sem o padrão aplicado (K01: "vencer aplica o padrão");
 *   · proposta publicada sem validade (portão de E6: "validade escrita");
 *   · efeito do comercial retido na porta há mais de `efeitoRetidoHoras` (sem o
 *     número, não conferida);
 *   · reação do fio parada em erro (a automação que morreu).
 *
 * O QUE FICA DE CADA PASSAGEM
 *   · premissa de lead quebrada: o fato `vigia.premissa` no fio do lead e a
 *     decisão `excecao_do_vigia` na fila (uma por premissa, lead e dia; padrão
 *     "ciente", que só registra). Premissa sem lead não abre decisão: a decisão
 *     da fila é de um lead;
 *   · a passagem inteira: a nota `comercial.vigia`, uma versão por passagem
 *     (a torre lê a última).
 *
 * Ele roda como tarefa do relógio comercial (`inteligencia.vigia`), e a
 * autonomia segura: vigia em A0 não confere nada.
 */

export const HORA_DO_VIGIA_MIN = 8 * 60;
const DIA_MS = 86_400_000;
/** A decisão vencida que o relógio ainda não alcançou: o tique é de 1 minuto, a folga é de 2 (como a reação parada). */
const FOLGA_DO_RELOGIO_MS = 2 * 60_000;
const JANELA_MS = 30 * DIA_MS;

export interface PassagemDoVigia {
  dia: string;
  em: string;
  conferidas: number;
  quebradas: number;
  naoConferidas: number;
  premissas: PremissaDoVigia[];
  decisoesAbertas: number;
}

/** O texto da premissa de cada automação (tela 12). `[a decidir]` onde o mapa não escreve. */
export const PREMISSA_DA_AUTOMACAO: Record<ComercialAutomacao, string> = {
  qualificador: 'formulário grava no lead',
  agendador: 'agenda da Root responde',
  leitor_de_ata: 'chave do modelo válida',
  construtor_de_proposta: 'tabela de preço de 04/10',
  revisor_de_proposta: '[a decidir]',
  assistente_da_proposta: 'texto do modelo ao cliente passa por gente',
  fupeiro: 'textos M5 e M6 aprovados',
  assinador: 'ZapSign API responde 200',
  cobrador: 'webhook do Asaas chegando',
  fechador: 'chave de transação única',
  relator: '[a decidir]',
  vigia: '[a decidir]',
};

/** Conta as premissas da passagem (puro). */
export function contarPremissas(premissas: readonly PremissaDoVigia[]): { conferidas: number; quebradas: number; naoConferidas: number } {
  return {
    conferidas: premissas.filter((p) => p.ok !== null).length,
    quebradas: premissas.filter((p) => p.ok === false).length,
    naoConferidas: premissas.filter((p) => p.ok === null).length,
  };
}

/** O vigia já devia ter passado hoje? (puro; a hora é a do fuso da política). */
export function horaDoVigia(agora: Date, fuso: string = fusoDaPolitica()): { passou: boolean; dia: string } {
  const minutos = minutosNoFuso(agora, fuso);
  return { passou: !Number.isNaN(minutos) && minutos >= HORA_DO_VIGIA_MIN, dia: partesNoFuso(agora, fuso).dia };
}

function premissa(chave: string, automacao: ComercialAutomacao | null, texto: string, ok: boolean | null, detalhe: string, leads: string[] = []): PremissaDoVigia {
  return { chave, automacao, premissa: texto, ok, detalhe, leads };
}

@Injectable()
export class VigiaService implements OnModuleInit {
  private readonly log = new Logger('VigiaComercial');
  private readonly passouHoje = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly decisoes: DecisoesService,
    private readonly config: ConfigComercialService,
    private readonly relogio: RelogioComercialRegistry,
    private readonly memoria: MemoriaService,
    @Optional() @Inject(LLM_PROVIDER) private readonly llm?: LlmProvider,
    @Optional() private readonly conectores?: RegistroDeConectores,
  ) {}

  onModuleInit(): void {
    this.inscrever();
  }

  inscrever(): void {
    this.relogio.inscrever('inteligencia.vigia', (orgId, agora) => this.talvezPassar(orgId, agora));
  }

  /** A tarefa do relógio: uma passagem por dia, a partir das 08:00 do fuso da política. */
  async talvezPassar(orgId: string, agora: Date): Promise<number> {
    const h = horaDoVigia(agora);
    if (!h.passou) return 0;
    const marca = `${orgId}:${h.dia}`;
    if (this.passouHoje.has(marca)) return 0;
    const ultima = await this.ultimaPassagem(orgId);
    if (ultima?.dia === h.dia) {
      this.passouHoje.add(marca);
      return 0;
    }
    await this.passar(orgId, agora);
    this.passouHoje.add(marca);
    return 1;
  }

  /** A última passagem gravada (a torre lê daqui). */
  async ultimaPassagem(orgId: string): Promise<PassagemDoVigia | null> {
    const nota = await this.memoria.porChave(orgId, CHAVE_DO_VIGIA);
    return nota ? dadoDaNota<PassagemDoVigia>(nota.body) : null;
  }

  /** Uma passagem completa: confere, grava os fatos, abre as exceções e versiona a nota. */
  async passar(orgId: string, agora: Date = new Date()): Promise<PassagemDoVigia> {
    const dia = partesNoFuso(agora, fusoDaPolitica()).dia;
    const premissas = await this.conferir(orgId, agora);
    let decisoesAbertas = 0;
    for (const p of premissas) {
      if (p.ok !== false) continue;
      for (const leadId of p.leads) {
        await this.fio.registrar(orgId, leadId, 'vigia.premissa', `${p.chave}:${dia}`, { automacao: p.automacao ?? 'funil', premissa: p.premissa, ok: false, detalhe: p.detalhe }, { em: agora });
        const d = await this.decisoes.abrir({
          orgId,
          leadId,
          tipo: 'excecao_do_vigia',
          chave: `${p.chave}:${dia}`,
          titulo: `Vigia: ${p.premissa}`,
          contexto: `${p.detalhe} Conferido às 08:00 de ${dia}. O vigia só avisa: quem conserta é gente.`,
          opcoes: [
            { chave: 'ciente', rotulo: 'ciente', efeito: 'fica registrado; o vigia confere de novo amanhã' },
            { chave: 'vou_resolver', rotulo: 'vou resolver', efeito: 'fica registrado com o seu nome; o vigia confere de novo amanhã' },
          ],
          padrao: 'ciente',
          dados: { premissa: p.chave, automacao: p.automacao },
          agora,
        });
        if (d.nova) decisoesAbertas++;
      }
    }
    const c = contarPremissas(premissas);
    const passagem: PassagemDoVigia = { dia, em: agora.toISOString(), ...c, premissas, decisoesAbertas };
    await gravarNota(this.memoria, orgId, CHAVE_DO_VIGIA, {
      title: 'Vigia do comercial',
      body: corpoComDado(this.markdown(passagem), passagem),
      motivo: `passagem do vigia de ${dia}: ${c.conferidas} conferidas, ${c.quebradas} quebradas`,
      tags: ['comercial', 'vigia'],
      sourceRef: `comercial.vigia · ${dia}`,
    });
    if (c.quebradas) this.log.warn(`empresa ${orgId}: vigia de ${dia} achou ${c.quebradas} premissa(s) quebrada(s).`);
    return passagem;
  }

  private markdown(p: PassagemDoVigia): string {
    const linha = (x: PremissaDoVigia) =>
      `- ${x.ok === null ? 'não conferida' : x.ok ? 'ok' : 'QUEBRADA'} · ${x.automacao ? COMERCIAL_ROTULO_DA_AUTOMACAO[x.automacao] : 'funil'} · ${x.premissa}: ${x.detalhe}`;
    return [
      `# Vigia do comercial · ${p.dia}`,
      '',
      `${p.conferidas} premissas conferidas · ${p.quebradas} quebradas · ${p.naoConferidas} não conferidas.`,
      '',
      ...p.premissas.map(linha),
    ].join('\n');
  }

  private async premissaDaZapsign(orgId: string): Promise<PremissaDoVigia> {
    const texto = PREMISSA_DA_AUTOMACAO.assinador;
    if (!this.conectores) return premissa('zapsign_responde', 'assinador', texto, null, 'sem o registro de conectores neste processo: não conferida.');
    const desligado = await this.prisma.conectorDesligado.findFirst({ where: { orgId, conector: 'zapsign' }, select: { motivo: true } }).catch(() => null);
    const saude = await this.conectores.sondar({
      orgId,
      chave: 'zapsign',
      desligadoPorque: desligado ? `A ZapSign está desligada nesta empresa${desligado.motivo ? ` (${desligado.motivo})` : ''}.` : null,
    });
    if (saude.estado === 'conectado') return premissa('zapsign_responde', 'assinador', texto, true, `a ZapSign respondeu${saude.latenciaMs != null ? ` em ${saude.latenciaMs} ms` : ''}.`);
    if (saude.estado === 'nao_verificado') return premissa('zapsign_responde', 'assinador', texto, null, saude.mensagem ?? 'não verificada.');
    return premissa('zapsign_responde', 'assinador', texto, false, `a ZapSign não respondeu como devia: ${saude.mensagem ?? saude.estado}.`);
  }

  /**
   * Como o vigia lê o `/saude` da ponte. Separado para a suíte trocar; o padrão é
   * o `fetch` com prazo de 4 s.
   */
  lerSaudeDaPonte: (url: string) => Promise<{ status: number; corpo: unknown }> = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    return { status: r.status, corpo: await r.json().catch(() => null) };
  };

  /** E-12: a premissa do modelo só sai "ok" quando algo foi conferido de fato. */
  private async premissaDoModelo(): Promise<PremissaDoVigia> {
    const texto = PREMISSA_DA_AUTOMACAO.leitor_de_ata;
    const provedor = this.llm?.name ?? 'desconhecido';
    if (provedor === 'stub') return premissa('chave_do_modelo', 'leitor_de_ata', texto, null, 'provedor stub de homologação: não há chave nem modelo a conferir.');
    if (provedor !== 'ponte') return premissa('chave_do_modelo', 'leitor_de_ata', texto, null, `provedor ${provedor}: o vigia não chama o modelo para conferir a chave (seria gasto).`);
    const base = (process.env.PONTE_MODELO_URL?.trim() || 'http://127.0.0.1:4099').replace(/\/$/, '');
    try {
      const { status, corpo } = await this.lerSaudeDaPonte(`${base}/saude`);
      const c = (corpo ?? {}) as { ok?: unknown; falhasSeguidas?: unknown };
      const falhas = typeof c.falhasSeguidas === 'number' ? c.falhasSeguidas : null;
      if (status !== 200 || c.ok !== true || falhas === null) {
        return premissa('chave_do_modelo', 'leitor_de_ata', texto, false, `a ponte de modelo respondeu ${status} sem a saúde esperada.`);
      }
      if (falhas > 0) return premissa('chave_do_modelo', 'leitor_de_ata', texto, false, `a ponte de modelo está de pé com ${falhas} falha(s) seguida(s) do modelo.`);
      return premissa('chave_do_modelo', 'leitor_de_ata', texto, true, 'a ponte de modelo respondeu à saúde sem falha seguida.');
    } catch (e) {
      return premissa('chave_do_modelo', 'leitor_de_ata', texto, false, `a ponte de modelo não respondeu à saúde: ${(e as Error).message.slice(0, 120)}.`);
    }
  }

  /** Confere todas as premissas (só lê; a sonda da ZapSign é a de Conexões). */
  async conferir(orgId: string, agora: Date): Promise<PremissaDoVigia[]> {
    const cfg = await this.config.ler(orgId);
    const desde = new Date(agora.getTime() - JANELA_MS);
    const out: PremissaDoVigia[] = [];

    // --- qualificador: formulário grava no lead ---
    const forms = await this.prisma.leadEvent.findMany({ where: { lead: { orgId }, type: 'form.respondido', occurredAt: { gte: desde } }, select: { leadId: true } });
    const leadsDoForm = [...new Set(forms.map((f) => f.leadId))];
    const semGravar = leadsDoForm.length
      ? await this.prisma.comercialFicha.findMany({ where: { orgId, leadId: { in: leadsDoForm }, OR: [{ sistemaErp: null }, { baseDados: null }] }, select: { leadId: true } })
      : [];
    out.push(
      premissa('formulario_grava', 'qualificador', PREMISSA_DA_AUTOMACAO.qualificador, semGravar.length === 0,
        semGravar.length ? `${semGravar.length} formulário(s) respondido(s) sem sistema ou base na ficha.` : `${leadsDoForm.length} formulário(s) em 30 dias, todos na ficha.`,
        semGravar.map((f) => f.leadId)),
    );

    // --- agendador: a agenda responde (a de homologação; a real é [a decidir]) ---
    // E-12: a agenda de homologação é uma conta; só vale como conferida em homologação.
    if (cfg.valoresDeHomologacao) {
      const horarios = horariosOferecidos(agora);
      out.push(premissa('agenda_responde', 'agendador', PREMISSA_DA_AUTOMACAO.agendador, horarios.length >= 2,
        `${horarios.length} horários oferecidos pela agenda de homologação; a agenda real da Root é [a decidir].`));
    } else {
      out.push(premissa('agenda_responde', 'agendador', PREMISSA_DA_AUTOMACAO.agendador, null,
        'a agenda real da Root é [a decidir]; a de homologação é uma conta e não confere nada fora de homologação.'));
    }

    // --- leitor de ata: chave do modelo ---
    out.push(await this.premissaDoModelo());

    // --- construtor de proposta: tabela de preço de 04/10 ---
    const publicadas = await this.prisma.leadEvent.findMany({ where: { lead: { orgId }, type: 'proposta.publicada', occurredAt: { gte: desde } }, select: { leadId: true, payload: true } });
    const foraDaLinha = publicadas.filter((e) => {
      const p = (e.payload ?? {}) as { dentroDaTabela?: boolean; produto?: string; valorCentavos?: number };
      return p.dentroDaTabela === true && !precoNaTabela(p.produto as ComercialProduto, Number(p.valorCentavos ?? 0));
    });
    const tabelaOk = TABELA_DE_PRECO_DATA === '2026-10-04';
    out.push(premissa('tabela_de_preco', 'construtor_de_proposta', PREMISSA_DA_AUTOMACAO.construtor_de_proposta, tabelaOk && foraDaLinha.length === 0,
      !tabelaOk ? `a tabela em vigor é de ${TABELA_DE_PRECO_DATA}, não a de 04/10.` : foraDaLinha.length ? `${foraDaLinha.length} proposta(s) "dentro da tabela" com preço fora da linha.` : `${publicadas.length} proposta(s) em 30 dias conferidas contra a tabela de 04/10.`,
      [...new Set(foraDaLinha.map((e) => e.leadId))]));

    // --- revisor: o mapa não escreve premissa ---
    out.push(premissa('revisor', 'revisor_de_proposta', PREMISSA_DA_AUTOMACAO.revisor_de_proposta, null, 'o mapa não escreve a premissa do revisor: [a decidir].'));

    // --- assistente da proposta (E-15): a regra é do código (só frase do sistema vai direto) ---
    out.push(premissa('assistente_por_gente', 'assistente_da_proposta', PREMISSA_DA_AUTOMACAO.assistente_da_proposta, null,
      'a resposta direta só sai de frase do sistema e o resto vai à fila; não há medida diária a conferir: [a decidir].'));

    // --- fupeiro: M5 e M6 no catálogo ---
    // O catálogo versionado da C08 (lane B): texto, versão e data de cada mensagem aprovada.
    const faltam = (['M5', 'M6'] as const).filter((t) => {
      const m = (MENSAGENS as Record<string, { texto?: string; versao?: number; data?: string } | undefined>)[t];
      return !m?.texto?.trim() || !m.versao || !m.data;
    });
    out.push(premissa('textos_m5_m6', 'fupeiro', PREMISSA_DA_AUTOMACAO.fupeiro, faltam.length === 0,
      faltam.length ? `${faltam.join(' e ')} sem texto aprovado com versão e data no catálogo.` : `M5 v${MENSAGENS.M5.versao} e M6 v${MENSAGENS.M6.versao} no catálogo de ${MENSAGENS.M5.data}.`));

    // --- assinador: a mesma sonda da tela de Conexões, que respeita o conector desligado ---
    out.push(await this.premissaDaZapsign(orgId));

    // --- cobrador: webhook do Asaas chegando ---
    if (cfg.cobrancaSemWebhookDias == null) {
      out.push(premissa('webhook_asaas', 'cobrador', PREMISSA_DA_AUTOMACAO.cobrador, null, 'o prazo sem webhook é [a decidir]: premissa desligada.'));
    } else {
      const limite = new Date(agora.getTime() - cfg.cobrancaSemWebhookDias * DIA_MS);
      const presas = await this.prisma.comercialCobranca.findMany({ where: { orgId, estado: 'pendente', pagaEm: null, vence: { lt: limite } }, select: { leadId: true } });
      out.push(premissa('webhook_asaas', 'cobrador', PREMISSA_DA_AUTOMACAO.cobrador, presas.length === 0,
        presas.length ? `${presas.length} parcela(s) vencida(s) há mais de ${cfg.cobrancaSemWebhookDias} dia(s) sem notícia do Asaas.` : `nenhuma parcela vencida há mais de ${cfg.cobrancaSemWebhookDias} dia(s) sem notícia${cfg.valoresDeHomologacao ? ' (prazo de homologação)' : ''}.`,
        [...new Set(presas.map((x) => x.leadId))]));
    }

    // --- fechador: chave de transação única ---
    const ativos = await this.prisma.leadEvent.findMany({ where: { lead: { orgId }, type: 'cliente.ativo' }, select: { leadId: true, payload: true } });
    const chavesPorLead = new Map<string, Set<string>>();
    for (const e of ativos) {
      const chave = String(((e.payload ?? {}) as { chave?: unknown }).chave ?? '');
      chavesPorLead.set(e.leadId, (chavesPorLead.get(e.leadId) ?? new Set()).add(chave));
    }
    const duplicados = [...chavesPorLead.entries()].filter(([, cs]) => cs.size > 1).map(([l]) => l);
    out.push(premissa('chave_unica', 'fechador', PREMISSA_DA_AUTOMACAO.fechador, duplicados.length === 0,
      duplicados.length ? `${duplicados.length} lead(s) com dois fechamentos de chaves diferentes.` : `${chavesPorLead.size} fechamento(s), um por lead.`, duplicados));

    out.push(premissa('relator', 'relator', PREMISSA_DA_AUTOMACAO.relator, null, 'o mapa não escreve a premissa do relator: [a decidir].'));
    out.push(premissa('vigia', 'vigia', PREMISSA_DA_AUTOMACAO.vigia, null, 'o mapa não escreve a premissa do próprio vigia: [a decidir].'));

    // --- funil ---
    const ativas = COMERCIAL_ETAPAS as readonly string[];
    const fichas = await this.prisma.comercialFicha.findMany({ where: { orgId }, include: { lead: { select: { status: true } } }, take: 2000 });
    const abertas = await this.prisma.comercialDecisao.findMany({ where: { orgId, estado: 'aberta' }, select: { leadId: true, titulo: true, padrao: true, expiraEm: true } });

    const semProximo = fichas.filter((f) => {
      if (!ativas.includes(f.etapa)) return false;
      const ds = abertas.filter((d) => d.leadId === f.leadId).map((d) => ({ titulo: d.titulo, padrao: d.padrao, expiraEm: d.expiraEm, semPrazo: d.expiraEm.getTime() >= SEM_PRAZO.getTime() }));
      return proximaAcaoDoLead(f, cfg, ds, agora) === null;
    });
    out.push(premissa('lead_sem_proximo_passo', null, 'lead vivo tem próximo passo', semProximo.length === 0,
      semProximo.length ? `${semProximo.length} lead(s) vivo(s) sem próxima ação.` : 'todo lead vivo tem próxima ação.', semProximo.map((f) => f.leadId)));

    const statusErrado = fichas.filter((f) => String(f.lead.status) !== LEAD_STATUS_DA_ETAPA[f.etapa as ComercialEtapa]);
    out.push(premissa('status_segue_etapa', null, 'o status do lead segue a etapa', statusErrado.length === 0,
      statusErrado.length
        ? `${statusErrado.length} lead(s) com status diferente do que a etapa manda (ex.: ${String(statusErrado[0].lead.status)} em ${COMERCIAL_ROTULO_DA_ETAPA[statusErrado[0].etapa as ComercialEtapa]}).`
        : 'o status de todo lead segue a etapa.',
      statusErrado.map((f) => f.leadId)));

    const vencidas = abertas.filter((d) => d.expiraEm.getTime() < SEM_PRAZO.getTime() && d.expiraEm.getTime() < agora.getTime() - FOLGA_DO_RELOGIO_MS);
    out.push(premissa('decisao_vencida', null, 'decisão vencida tem o padrão aplicado', vencidas.length === 0,
      vencidas.length ? `${vencidas.length} decisão(ões) vencida(s) ainda aberta(s): o relógio não aplicou o padrão.` : 'nenhuma decisão vencida aberta.',
      [...new Set(vencidas.map((d) => d.leadId))]));

    const semValidade = fichas.filter((f) => (f.etapa === 'proposta' || f.etapa === 'follow_up') && f.propostaPublicadaEm && !f.validade);
    out.push(premissa('proposta_sem_validade', null, 'proposta publicada tem validade', semValidade.length === 0,
      semValidade.length ? `${semValidade.length} proposta(s) publicada(s) sem validade escrita.` : 'toda proposta publicada tem validade.', semValidade.map((f) => f.leadId)));

    if (cfg.efeitoRetidoHoras == null) {
      out.push(premissa('efeito_retido', null, 'efeito do comercial não fica retido', null, 'o prazo de retenção é [a decidir]: premissa desligada.'));
    } else {
      const limite = new Date(agora.getTime() - cfg.efeitoRetidoHoras * 3_600_000);
      const retidos = await this.prisma.approval.count({ where: { orgId, status: 'pendente', capabilityId: { startsWith: 'comercial.' }, criadoEm: { lt: limite } } });
      out.push(premissa('efeito_retido', null, 'efeito do comercial não fica retido', retidos === 0,
        retidos ? `${retidos} efeito(s) do comercial esperando aprovação há mais de ${cfg.efeitoRetidoHoras} h.` : `nada retido há mais de ${cfg.efeitoRetidoHoras} h${cfg.valoresDeHomologacao ? ' (prazo de homologação)' : ''}.`));
    }

    const emErro = await this.prisma.comercialReacao.findMany({ where: { orgId, estado: 'erro', criadoEm: { lt: new Date(agora.getTime() - FOLGA_DO_RELOGIO_MS) } }, select: { leadId: true, reacao: true }, take: 200 });
    out.push(premissa('reacao_em_erro', null, 'nenhuma reação parada em erro', emErro.length === 0,
      emErro.length ? `${emErro.length} reação(ões) parada(s) em erro (${[...new Set(emErro.map((r) => r.reacao))].join(', ')}).` : 'nenhuma reação parada em erro.',
      [...new Set(emErro.map((r) => r.leadId))]));

    return out;
  }
}
