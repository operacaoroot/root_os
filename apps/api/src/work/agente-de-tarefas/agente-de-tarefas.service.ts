import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ActorType, EstadoDeAgente } from '@prisma/client';
import type { TarefaDoDia } from '@mktos/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EntradaDeGrupoRegistry } from '../../gateway/canais/entrada-de-grupo.registry';
import { ENVIO_PELA_EVOLUTION, type EnvioPelaEvolution } from '../../gateway/canais/evolution.port';
import { LLM_PROVIDER, type LlmProvider } from '../../llm/llm.provider';
import { exigirAcessoAtual } from '../../memory/acesso-memoria';
import { TarefasDoDiaService } from '../tarefas-do-dia.service';
import {
  AJUDA, LIMITE_DA_LISTA, MAXIMO_DE_ABERTAS_NO_CONTEXTO, acharPorNome, lerComando, lerPedidoDoGrupo,
  linhaDaTarefa, mesmoTelefone, promptDoSistema, type Comando, type PedidoDoGrupo,
} from './pedido-do-grupo';

export const FUNCAO_DO_AGENTE_DE_TAREFAS = 'TR-12';
export const SLUG_DO_AGENTE_DE_TAREFAS = 'agente-de-tarefas';
const SAIDA_DO_MODELO = 300;
/** A parecida segurada espera a confirmação por este tempo. */
const VALIDADE_DA_CONFIRMACAO_MS = 10 * 60 * 1000;
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/*
 * O AGENTE DE TAREFAS (TR-12) — o pedido do grupo vira tarefa do Dia a dia.
 *
 * ENTRA pela entrada única do webhook (`EntradaDeGrupoRegistry`), igual ao grupo
 * de links: a Evolution tem uma URL só, e o grupo da equipe é inscrito pelo
 * `AGENTE_TAREFAS_JID`. Sem a variável, nada muda.
 *
 * LIGA E DESLIGA NA TELA DE AGENTES: o agente só responde quando o registro
 * `Agent` dele, nesta empresa, está ativo. Pausado = silêncio.
 *
 * AGE EM NOME DE QUEM PEDIU. O telefone do WhatsApp é casado com o telefone do
 * cadastro da pessoa (`User.phone`); a tarefa nasce e muda com o id dela, que
 * precisa ter `tarefas.editar` — a mesma régua do botão na tela. Número que não
 * é da equipe recebe uma frase e nada acontece. Toda escrita passa pelo
 * `TarefasDoDiaService` (auditoria, versão, tarefa igual que não nasce).
 */
@Injectable()
export class AgenteDeTarefasService implements OnModuleInit {
  private readonly log = new Logger('AgenteDeTarefas');
  private readonly jid = (process.env.AGENTE_TAREFAS_JID ?? '').trim().toLowerCase();
  private fila: Promise<unknown> = Promise.resolve();
  private readonly seguradas = new Map<string, { titulo: string; areaId: string; pessoaId: string | null; prazo: string | null; actorId: string; ate: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tarefas: TarefasDoDiaService,
    @Optional() private readonly grupos?: EntradaDeGrupoRegistry,
    @Optional() @Inject(ENVIO_PELA_EVOLUTION) private readonly envio?: EnvioPelaEvolution,
    @Optional() @Inject(LLM_PROVIDER) private readonly llm?: LlmProvider,
  ) {}

  onModuleInit(): void {
    if (!this.jid) return;
    if (!this.grupos) {
      this.log.warn('AGENTE_TAREFAS_JID definido, mas o registro de entrada por grupo não está no ar');
      return;
    }
    if (this.jid === (process.env.EVOLUTION_LINKS_JID ?? '').trim().toLowerCase()) {
      this.log.warn('AGENTE_TAREFAS_JID é o mesmo grupo dos links: agente de tarefas desligado para não tomar o lugar da pauta');
      return;
    }
    this.grupos.registrar(this.jid, (orgId, evento) => this.receber(orgId, evento), 'AgenteDeTarefasService');
  }

  /** Uma mensagem por vez: a Evolution reentrega, e duas criações iguais no mesmo segundo viram uma. */
  receber(orgId: string, evento: unknown): Promise<string> {
    const vez = this.fila.then(() => this.processar(orgId, evento));
    this.fila = vez.catch(() => undefined);
    return vez;
  }

  private async processar(orgId: string, evento: unknown): Promise<string> {
    const pedido = lerPedidoDoGrupo(evento, this.jid);
    if (!pedido) return 'ignorado:nao-e-pedido';
    const agente = await this.prisma.agent.findFirst({
      where: { orgId, slug: SLUG_DO_AGENTE_DE_TAREFAS }, select: { id: true, estado: true },
    });
    if (!agente || agente.estado !== EstadoDeAgente.ativo) return 'ignorado:agente-desligado';

    let resposta: string;
    let desfecho: string;
    try {
      ({ resposta, desfecho } = await this.atender(orgId, pedido));
    } catch (e) {
      this.log.warn(`pedido falhou (${orgId}): ${(e as Error).message}`);
      resposta = 'Não consegui fazer isso agora. Tente de novo em instantes ou faça pela tela de Tarefas.';
      desfecho = 'erro';
    }
    await this.responder(orgId, resposta);
    await this.audit.log({
      orgId, actorType: ActorType.ai, actorId: agente.id, action: 'tarefas.whatsapp.pedido',
      entityType: 'agent', entityId: agente.id,
      after: { desfecho, mensagemId: pedido.mensagemId, pedido: pedido.texto.slice(0, 300) },
    });
    return desfecho;
  }

  private async responder(orgId: string, texto: string): Promise<void> {
    if (!this.envio) {
      this.log.warn('sem envio pela Evolution: resposta não saiu');
      return;
    }
    await this.envio.enviarAoGrupo(orgId, this.jid, texto);
  }

  /** Quem é da equipe pelo telefone; `null` quando não dá para saber. */
  private async quemPediu(orgId: string, pedido: PedidoDoGrupo): Promise<{ id: string; nome: string } | null> {
    if (!pedido.telefone) return null;
    const contas = await this.prisma.user.findMany({
      where: { orgId, isActive: true, phone: { not: null } }, select: { id: true, name: true, phone: true },
    });
    const achada = contas.find((c) => mesmoTelefone(c.phone, pedido.telefone));
    return achada ? { id: achada.id, nome: achada.name } : null;
  }

  private async atender(orgId: string, pedido: PedidoDoGrupo): Promise<{ resposta: string; desfecho: string }> {
    const quem = await this.quemPediu(orgId, pedido);
    if (!quem) {
      return {
        resposta: 'Não reconheci este número na equipe. Cadastre o seu celular no seu perfil do OS e peça de novo.',
        desfecho: 'recusado:numero-desconhecido',
      };
    }
    try {
      await exigirAcessoAtual(this.prisma, orgId, quem.id, ['tarefas.editar']);
    } catch {
      return { resposta: `${quem.nome}, sua conta não pode editar tarefas.`, desfecho: 'recusado:sem-permissao' };
    }
    if (pedido.plural && !pedido.texto) return this.listar(orgId, { acao: 'listar', filtro: 'todas' });
    if (!pedido.texto) return { resposta: AJUDA, desfecho: 'ajuda' };
    if (/^confirm(a|ar|o)\b/i.test(pedido.texto)) return this.confirmar(orgId, quem);

    const painel = await this.tarefas.painel(orgId);
    const abertas = painel.tarefas.filter((t) => t.status.tipo !== 'concluida');
    const hoje = painel.hoje;
    const comando = await this.entender(orgId, pedido, quem.nome, painel.pessoas.map((p) => p.nome), painel.areas.map((a) => a.nome), abertas, hoje);
    if (!comando) return { resposta: `Não entendi o pedido.\n\n${AJUDA}`, desfecho: 'nao-entendido' };

    const pessoaDe = (nome: string | null | undefined) =>
      nome && /^(eu|mim|minhas?|meus?)$/i.test(nome.trim()) ? (acharPorNome(painel.pessoas, quem.nome) ?? { id: quem.id, nome: quem.nome }) : acharPorNome(painel.pessoas, nome);

    switch (comando.acao) {
      case 'ajuda':
        return { resposta: AJUDA, desfecho: 'ajuda' };
      case 'listar':
        return this.listar(orgId, comando, painel.tarefas, pessoaDe(comando.pessoa));
      case 'criar': {
        if (!comando.titulo) return { resposta: 'Qual é a tarefa? Ex.: tarefa pro Pedro: revisar contrato até sexta', desfecho: 'sem-titulo' };
        const pessoa = comando.pessoa ? pessoaDe(comando.pessoa) : null;
        if (comando.pessoa && !pessoa) return { resposta: `Não achei "${comando.pessoa}" na equipe (${painel.pessoas.map((p) => p.nome).join(', ')}).`, desfecho: 'pessoa-desconhecida' };
        const area = acharPorNome(painel.areas, comando.area) ?? acharPorNome(painel.areas, 'Operação') ?? painel.areas[0];
        if (!area) return { resposta: 'Não há área de tarefa cadastrada.', desfecho: 'sem-area' };
        return this.criar(orgId, quem, { titulo: comando.titulo, areaId: area.id, pessoaId: pessoa?.id ?? null, prazo: comando.prazo ?? null }, false);
      }
      case 'concluir':
      case 'alterar': {
        const alvo = comando.tarefa ? abertas.slice(0, MAXIMO_DE_ABERTAS_NO_CONTEXTO)[comando.tarefa - 1] : undefined;
        if (!alvo) return { resposta: 'Não achei essa tarefa entre as abertas. Escreva o nome dela como está no Dia a dia.', desfecho: 'tarefa-nao-achada' };
        if (comando.acao === 'concluir') {
          await this.tarefas.alternarFeita(orgId, quem.id, alvo.id, alvo.updatedAt);
          return { resposta: `✅ Concluída: ${alvo.titulo}`, desfecho: 'concluida' };
        }
        const pessoa = comando.pessoa ? pessoaDe(comando.pessoa) : null;
        if (comando.pessoa && !pessoa) return { resposta: `Não achei "${comando.pessoa}" na equipe.`, desfecho: 'pessoa-desconhecida' };
        if (!pessoa && !comando.prazo) return { resposta: 'O que muda? Prazo ou responsável.', desfecho: 'sem-mudanca' };
        const nova = await this.tarefas.editar(orgId, quem.id, alvo.id, {
          expectedUpdatedAt: alvo.updatedAt,
          ...(comando.prazo ? { prazo: comando.prazo } : {}),
          ...(pessoa ? { pessoaId: pessoa.id } : {}),
        });
        return { resposta: `✏️ Atualizada:\n${linhaDaTarefa(nova)}`, desfecho: 'alterada' };
      }
    }
  }

  private async entender(
    orgId: string, pedido: PedidoDoGrupo, quemPediu: string, pessoas: string[], areas: string[], abertas: TarefaDoDia[], hoje: string,
  ): Promise<Comando | null> {
    if (!this.llm) return null;
    const system = promptDoSistema({
      hoje, diaDaSemana: DIAS[new Date(`${hoje}T12:00:00Z`).getUTCDay()], quemPediu, pessoas, areas, abertas,
    });
    const saida = await this.llm.complete({
      funcao: FUNCAO_DO_AGENTE_DE_TAREFAS, agentSlug: SLUG_DO_AGENTE_DE_TAREFAS,
      system, user: pedido.texto, orgId, maxTokens: SAIDA_DO_MODELO,
    });
    return lerComando(saida);
  }

  private async listar(
    orgId: string, comando: Comando, todas?: TarefaDoDia[], pessoa?: { id: string; nome: string } | null,
  ): Promise<{ resposta: string; desfecho: string }> {
    todas ??= (await this.tarefas.painel(orgId)).tarefas;
    let lista = todas.filter((t) => t.status.tipo !== 'concluida');
    if (pessoa) lista = lista.filter((t) => t.pessoas.some((p) => p.id === pessoa.id));
    if (comando.filtro === 'atrasadas') lista = lista.filter((t) => t.situacao === 'atrasada');
    if (comando.filtro === 'hoje') lista = lista.filter((t) => t.situacao === 'hoje' || t.situacao === 'atrasada');
    if (comando.filtro === 'semana') lista = lista.filter((t) => t.situacao !== 'sem_prazo' && t.situacao !== 'mais_tarde');
    const titulo = [
      comando.filtro === 'atrasadas' ? 'Atrasadas' : comando.filtro === 'hoje' ? 'Para hoje' : comando.filtro === 'semana' ? 'Até 7 dias' : 'Abertas',
      pessoa ? `de ${pessoa.nome}` : null,
    ].filter(Boolean).join(' ');
    if (lista.length === 0) return { resposta: `${titulo}: nenhuma. 🎉`, desfecho: 'listada:0' };
    const linhas = lista.slice(0, LIMITE_DA_LISTA).map(linhaDaTarefa);
    const resto = lista.length > LIMITE_DA_LISTA ? `\n…e mais ${lista.length - LIMITE_DA_LISTA} no Dia a dia.` : '';
    return { resposta: `*${titulo} (${lista.length})*\n${linhas.join('\n')}${resto}`, desfecho: `listada:${lista.length}` };
  }

  private async criar(
    orgId: string, quem: { id: string; nome: string },
    dados: { titulo: string; areaId: string; pessoaId: string | null; prazo: string | null }, confirmar: boolean,
  ): Promise<{ resposta: string; desfecho: string }> {
    const r = await this.tarefas.criar(orgId, quem.id, { ...dados, confirmar });
    if (r.criada) return { resposta: `🆕 Criada:\n${linhaDaTarefa(r.tarefa)}`, desfecho: 'criada' };
    if (r.aviso.tipo === 'igual') {
      return { resposta: `Já existe essa tarefa aberta:\n${linhaDaTarefa(r.aviso.tarefa)}`, desfecho: 'igual' };
    }
    this.seguradas.set(orgId, { ...dados, actorId: quem.id, ate: Date.now() + VALIDADE_DA_CONFIRMACAO_MS });
    const aviso = r.aviso;
    const porque = aviso.tipo === 'nao_parece_tarefa'
      ? `Isso parece ${aviso.casa}, não tarefa (${aviso.motivo}).`
      : `Já existe uma parecida:\n${linhaDaTarefa(aviso.tarefa)}`;
    return { resposta: `${porque}\n\nPara criar "${dados.titulo}" mesmo assim, responda: *tarefa confirmar*`, desfecho: `segurada:${r.aviso.tipo}` };
  }

  private async confirmar(orgId: string, quem: { id: string; nome: string }): Promise<{ resposta: string; desfecho: string }> {
    const s = this.seguradas.get(orgId);
    this.seguradas.delete(orgId);
    if (!s || s.ate < Date.now()) return { resposta: 'Não há tarefa esperando confirmação.', desfecho: 'confirmar:nada' };
    return this.criar(orgId, quem, { titulo: s.titulo, areaId: s.areaId, pessoaId: s.pessoaId, prazo: s.prazo }, true);
  }
}

