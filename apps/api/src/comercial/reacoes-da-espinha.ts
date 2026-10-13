import { Injectable, OnModuleInit } from '@nestjs/common';
import { COMERCIAL_ETAPAS, ehSaida, type ComercialEtapa, type ComercialEtapaAtiva, type ComercialEvento } from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { DecisoesRegistry, DecisoesService, type DecisaoResolvida } from './decisoes.service';
import { FichaService } from './ficha.service';
import { FioService, ReacoesRegistry, type EventoGravado } from './fio.service';
import { pontuar } from './pontuacao';
import { RelogioDaEspinha } from './relogio-da-espinha';

/*
 * AS REAÇÕES DA ESPINHA (lane A, 13/10/2026) — K02, a parte que mexe na ficha.
 *
 * Inscritas no `ReacoesRegistry` no `onModuleInit`. Para cada evento do
 * catálogo que traz campo da ficha, a MESMA reação (`espinha.projetar`) faz
 * duas coisas:
 *
 *   1. aplica os campos do payload (`camposDoEvento`, em `ficha.service.ts`);
 *   2. calcula a etapa que os FATOS já sustentam (`etapaPelosFatos`) e avança
 *      até ela PASSO A PASSO, cada passo pelo portão. Portão recusado NÃO
 *      força: o lead fica onde chegou e a lista do que falta vai para o
 *      resultado da reação (`ComercialReacao.resultado`, que o fio mostra).
 *
 * Por que "a etapa que os fatos sustentam" e não "o evento X move para E-n":
 * o fato que destrava um portão pode chegar DEPOIS do fato que pede a etapa
 * (o diagnóstico aprovado depois da proposta lida; o dono atribuído depois do
 * formulário). Recalcular a cada fato faz o lead andar sozinho assim que o
 * último portão se cumpre, sem reação especial para cada ordem possível.
 *
 * Além do projetar, quatro reações próprias:
 *   · `lead.chegou` → pontuação inicial (só com canal: sem dado, sem número),
 *     dono pela regra, e a rotina `comercial.relogio` semeada na empresa;
 *   · `form.respondido` → pontuação com as respostas, dono pela regra, e o
 *     PONTO ZERO: sem base organizada, decisão `ponto_zero` na fila;
 *   · `lead.pontuado`/`dono.atribuido` → espelham `Lead.score`/`Lead.ownerId`
 *     para as telas antigas;
 *   · `saida.registrada` → aplica os campos e move para a saída (`podeSair`).
 *
 * Efeitos externos (mandar WhatsApp, cobrar, gerar diagnóstico) NÃO moram
 * aqui: são das lanes B, D e E, inscritas nos próprios serviços.
 *
 * A REGRA DO DONO (C04, E1: "todo lead nasce com dono"): o dono do comercial
 * é [a decidir] pela mesa (o mapa cita o Lucas, mas pessoa não se inventa no
 * código). Enquanto a mesa não grava a regra, o dono é o PRIMEIRO usuário
 * ativo da empresa com papel `admin_master` ou `diretor`, por data de
 * criação. Sem nenhum, `donoId` fica nulo e o portão de E1 recusa — a recusa
 * é a regra funcionando.
 */

export const REGRA_DO_DONO = 'regra-v1: primeiro usuário ativo com papel admin_master ou diretor (dono do comercial [a decidir] pela mesa)';
const PAPEIS_DE_DONO = ['admin_master', 'diretor'];

/** Os eventos cujo payload muda a ficha: cada um ganha a reação `espinha.projetar`. */
export const EVENTOS_QUE_PROJETAM: readonly ComercialEvento[] = [
  'lead.chegou',
  'cnpj.enriquecido',
  'lead.pontuado',
  'dono.atribuido',
  'form.respondido',
  'agenda.escolhida',
  'agenda.confirmada',
  'ata.chegou',
  'diagnostico.pronto',
  'proposta.publicada',
  'proposta.lida',
  'proposta.aceita',
  'aceite.dados',
  'cobranca.criada',
  'pix.pago',
  'contrato.assinado_cliente',
  'contrato.assinado_root',
  'cliente.ativo',
  'kickoff.marcado',
];

/**
 * A etapa mais adiantada que os fatos da ficha sustentam (puro). Não é a
 * etapa que o lead vai ter: é o ALVO. Quem decide se chega é cada portão.
 */
export function etapaPelosFatos(f: {
  clienteAtivoEm?: Date | null;
  propostaAceitaEm?: Date | null;
  propostaLidaPelaPrimeiraVezEm?: Date | null;
  propostaPublicadaEm?: Date | null;
  diagnostico?: unknown;
  ataHash?: string | null;
  reuniaoEm?: Date | null;
  sistemaErp?: string | null;
  baseDados?: boolean | null;
}): ComercialEtapaAtiva {
  if (f.clienteAtivoEm) return 'fechado';
  if (f.propostaAceitaEm) return 'contrato';
  if (f.propostaLidaPelaPrimeiraVezEm) return 'follow_up';
  if (f.propostaPublicadaEm) return 'proposta';
  if (f.diagnostico) return 'diagnostico';
  if (f.ataHash) return 'sessao';
  if (f.reuniaoEm) return 'reuniao_agendada';
  if (f.sistemaErp || typeof f.baseDados === 'boolean') return 'qualificacao';
  return 'novo_lead';
}

@Injectable()
export class ReacoesDaEspinha implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly reacoes: ReacoesRegistry,
    private readonly fichas: FichaService,
    private readonly decisoes: DecisoesService,
    private readonly aoDecidir: DecisoesRegistry,
    private readonly relogio: RelogioDaEspinha,
  ) {}

  onModuleInit(): void {
    this.inscrever();
  }

  /** Separado do `onModuleInit` para a suíte montar à mão, sem Nest. */
  inscrever(): void {
    // A ordem importa: a ficha e o avanço primeiro, depois o que depende deles.
    for (const type of EVENTOS_QUE_PROJETAM) {
      this.reacoes.inscrever(type, 'espinha.projetar', (e) => this.projetar(e));
    }
    this.reacoes.inscrever('lead.chegou', 'espinha.entrada', (e) => this.naEntrada(e));
    this.reacoes.inscrever('form.respondido', 'espinha.qualificacao', (e) => this.naQualificacao(e as EventoGravado<'form.respondido'>));
    this.reacoes.inscrever('lead.pontuado', 'espinha.lead-score', (e) => this.espelharPontuacao(e as EventoGravado<'lead.pontuado'>));
    this.reacoes.inscrever('dono.atribuido', 'espinha.lead-dono', (e) => this.espelharDono(e as EventoGravado<'dono.atribuido'>));
    this.reacoes.inscrever('saida.registrada', 'espinha.saida', (e) => this.naSaida(e as EventoGravado<'saida.registrada'>));

    this.aoDecidir.aoDecidir('ponto_zero', (d) => this.resolverPontoZero(d), 'espinha.ponto-zero');
    this.aoDecidir.aoDecidir('lead_parado', (d) => this.resolverLeadParado(d), 'espinha.lead-parado');
  }

  /** Aplica os campos e avança até onde os fatos e os portões deixam. */
  async projetar(e: EventoGravado): Promise<unknown> {
    const { campos } = await this.fichas.aplicar(e);
    const ficha = await this.fichas.garantir(e.orgId, e.leadId);
    const atual = ficha.etapa as ComercialEtapa;
    if (ehSaida(atual)) return { campos, etapa: atual, avancou: false, motivo: 'lead em saída: os fatos ficam na ficha, a etapa não anda' };
    const alvo = etapaPelosFatos(ficha);
    if (COMERCIAL_ETAPAS.indexOf(alvo) <= COMERCIAL_ETAPAS.indexOf(atual as ComercialEtapaAtiva)) {
      return { campos, etapa: atual, avancou: false };
    }
    const r = await this.fichas.avancarAte(e.orgId, e.leadId, alvo, `${e.type} sustenta ${alvo}`, e.eventoId, e.em);
    const depois = await this.fichas.garantir(e.orgId, e.leadId);
    return { campos, alvo, etapa: depois.etapa, avancou: r.mudou, faltando: r.ok ? [] : r.faltando };
  }

  private async naEntrada(e: EventoGravado): Promise<unknown> {
    await this.relogio.garantirRotina(e.orgId);
    const ficha = await this.fichas.garantir(e.orgId, e.leadId);
    const p = pontuar({ canal: ficha.canal });
    let pontuado = false;
    if (p.pontuacao !== null) {
      await this.fio.registrar(e.orgId, e.leadId, 'lead.pontuado', 'inicial', { pontuacao: p.pontuacao, perfil: p.perfil, criterios: p.criterios }, { em: e.em });
      pontuado = true;
    }
    const dono = await this.atribuirDono(e);
    return { pontuado, pontuacao: p.pontuacao, dono };
  }

  private async naQualificacao(e: EventoGravado<'form.respondido'>): Promise<unknown> {
    const ficha = await this.fichas.garantir(e.orgId, e.leadId);
    const f = e.payload;
    // O nome do formulário substitui o telefone que serviu de nome na entrada.
    if (f.nome) {
      const lead = await this.prisma.lead.findFirst({ where: { id: e.leadId, orgId: e.orgId }, select: { name: true, phone: true } });
      if (lead && (!lead.name.trim() || lead.name === lead.phone)) {
        await this.prisma.lead.updateMany({ where: { id: e.leadId, orgId: e.orgId }, data: { name: f.nome } });
      }
    }
    const p = pontuar({ canal: ficha.canal, sistemaErp: f.sistema, baseDados: f.baseOrganizada, equipeFinanceiro: f.equipeFinanceiro, maiorDor: f.maiorDor, cnpj: f.cnpj ?? ficha.cnpj });
    if (p.pontuacao !== null) {
      await this.fio.registrar(e.orgId, e.leadId, 'lead.pontuado', `form:${e.eventoId}`, { pontuacao: p.pontuacao, perfil: p.perfil, criterios: p.criterios }, { em: e.em });
    }
    const dono = await this.atribuirDono(e);

    // O PONTO ZERO (regra de 15/09): só entra cliente com sistema e base. Sem
    // base, a exceção é decisão de gente — a fila, nunca o código.
    let pontoZero: string | null = null;
    if (f.baseOrganizada === false) {
      const d = await this.decisoes.abrir({
        orgId: e.orgId,
        leadId: e.leadId,
        tipo: 'ponto_zero',
        chave: 'form',
        titulo: 'Lead sem base de dados organizada',
        contexto: `Usa ${f.sistema}. Pontuação ${p.pontuacao ?? 'sem número'}. A regra de 15/09 só aceita cliente com sistema e base; a exceção é decisão de vocês.`,
        opcoes: [
          { chave: 'aceitar_excecao', rotulo: 'aceitar exceção', efeito: 'o lead segue na qualificação' },
          { chave: 'geladeira', rotulo: 'geladeira', efeito: 'sai para a geladeira com motivo "sem base" (data de volta [a decidir])' },
          { chave: 'desqualificar', rotulo: 'desqualificar', efeito: 'sai como desqualificado, motivo "sem base"' },
        ],
        // Padrão = a REGRA escrita (sem base não entra), na saída reversível.
        padrao: 'geladeira',
        dados: { baseOrganizada: false, sistema: f.sistema },
        agora: e.em,
      });
      pontoZero = d.id;
    }
    return { pontuacao: p.pontuacao, perfil: p.perfil, dono, pontoZero };
  }

  private async espelharPontuacao(e: EventoGravado<'lead.pontuado'>): Promise<unknown> {
    if (typeof e.payload.pontuacao !== 'number') return null;
    await this.prisma.lead.updateMany({ where: { id: e.leadId, orgId: e.orgId }, data: { score: e.payload.pontuacao } });
    return { score: e.payload.pontuacao };
  }

  private async espelharDono(e: EventoGravado<'dono.atribuido'>): Promise<unknown> {
    if (!e.payload.donoId) return null;
    const r = await this.prisma.lead.updateMany({ where: { id: e.leadId, orgId: e.orgId, ownerId: null }, data: { ownerId: e.payload.donoId } });
    return { ownerId: r.count ? e.payload.donoId : 'mantido' };
  }

  private async naSaida(e: EventoGravado<'saida.registrada'>): Promise<unknown> {
    await this.fichas.aplicar(e);
    const r = await this.fichas.mudarEtapa(e.orgId, e.leadId, e.payload.saida as ComercialEtapa, { motivo: `saída: ${e.payload.motivo}`, eventoGatilho: e.eventoId, agora: e.em });
    return { etapa: r.ok ? r.para : r.de, mudou: r.mudou, faltando: r.faltando };
  }

  /** Dono pela regra, uma vez por lead (a chave do fato é a regra). Lead com dono não troca. */
  private async atribuirDono(e: EventoGravado): Promise<string | null> {
    const ficha = await this.fichas.garantir(e.orgId, e.leadId);
    if (ficha.donoId) return ficha.donoId;
    const dono = await this.prisma.user.findFirst({
      where: { orgId: e.orgId, isActive: true, roles: { some: { key: { in: PAPEIS_DE_DONO } } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    await this.fio.registrar(e.orgId, e.leadId, 'dono.atribuido', 'regra-v1', { donoId: dono?.id ?? null, donoNome: dono?.name ?? null, regra: REGRA_DO_DONO }, { em: e.em });
    return dono?.id ?? null;
  }

  private async resolverPontoZero(d: DecisaoResolvida): Promise<unknown> {
    if (d.escolha === 'aceitar_excecao') return { efeito: 'segue na qualificação' };
    const saida = d.escolha === 'desqualificar' ? 'desqualificado' : 'geladeira';
    return this.sairPorDecisao(d, saida, 'sem_base');
  }

  private async resolverLeadParado(d: DecisaoResolvida): Promise<unknown> {
    if (d.escolha === 'manter') return { efeito: 'segue onde está' };
    const saida = d.escolha === 'perdido' ? 'perdido' : 'geladeira';
    return this.sairPorDecisao(d, saida, 'sumiu');
  }

  /**
   * Saída decidida na fila. Não passa pela rota (não há corpo de pessoa): grava
   * o mesmo fato `saida.registrada`, com a decisão como origem. A geladeira por
   * decisão nasce sem data de volta ([a decidir]): quem marca a data é gente.
   */
  private async sairPorDecisao(d: DecisaoResolvida, saida: 'geladeira' | 'desqualificado' | 'perdido', motivo: 'sem_base' | 'sumiu'): Promise<unknown> {
    const ficha = await this.fichas.garantir(d.orgId, d.leadId);
    if (ehSaida(ficha.etapa as ComercialEtapa) || ficha.etapa === 'fechado') return { efeito: 'nada: o lead já não está no funil ativo', etapa: ficha.etapa };
    await this.fio.registrar(d.orgId, d.leadId, 'saida.registrada', `decisao:${d.id}`, {
      saida,
      motivo,
      detalhe: `decisão ${d.tipo}: ${d.escolha}${d.como === 'expirada' ? ' (padrão aplicado no vencimento)' : ''}`,
      voltaEm: null,
      parceiro: null,
      por: d.por?.nome ?? d.por?.id ?? (d.como === 'expirada' ? 'relógio' : null),
    });
    const depois = await this.fichas.garantir(d.orgId, d.leadId);
    return { efeito: `saída ${saida}`, etapa: depois.etapa };
  }
}
