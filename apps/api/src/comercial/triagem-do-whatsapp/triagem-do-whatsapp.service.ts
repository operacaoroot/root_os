import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import {
  NOTA_DA_TRIAGEM_DO_WHATSAPP,
  ROTULO_DA_CLASSE_DA_TRIAGEM,
  TIPO_DA_PENDENCIA_DA_TRIAGEM,
  type ClasseDaTriagem,
  type OpcaoDaPendencia,
} from '@mktos/shared';
import { ActorType, type Prisma } from '@prisma/client';

import { ARQUIVISTA_DO_CLIENTE, type ArquivistaDoClientePort } from '../../clientes/portas';
import { PortaDoOperador } from '../../gateway/porta-do-operador.service';
import { LLM_PROVIDER, type LlmProvider } from '../../llm/llm.provider';
import { MemoriaService } from '../../memory/memoria.service';
import { PendenciasRegistry, type RespostaDaPendencia } from '../../pendencias/pendencias.registry';
import { PendenciasService } from '../../pendencias/pendencias.service';
import { PrismaService } from '../../prisma/prisma.service';
import { provedorDoAmbiente } from '../canais/whatsapp.port';
import { hashDoConteudo, normalizarTelefone } from '../eventos';
import { FioService } from '../fio.service';
import { ATOR_DA_TRIAGEM, CAP_LEAD_CRIAR, chaveDaRequisicao } from '../lead-criar.service';
import { decidirTriagem, finalDoTelefone, interpretarTriagem, promptDaTriagem, type ContextoDaTriagem, type DecisaoDaTriagem } from './triagem';

/*
 * A TRIAGEM DO WHATSAPP (rodada dos agentes, 21/10/2026, CO-16).
 *
 * A entrada é a da P8: o webhook do canal de aprovação, com a instância da
 * empresa no corpo e `EntradaDiretaRegistry` desviando a conversa 1:1 para o
 * comercial (`evolution-entrada.service.ts`). Até esta rodada só quem já era
 * lead era desviado; com a triagem LIGADA, o número que não é lead também
 * passa por aqui (a identidade do canal de aprovação e o grupo de links
 * continuam onde estavam: o registro os tira do caminho antes).
 *
 * DESLIGADA POR PADRÃO, com DUAS chaves: `WHATSAPP_PROVEDOR=evolution` (o
 * provedor do comercial) E a nota da memória `comercial.whatsapp.triagem` com
 * `ligada` na primeira linha (por empresa). Sem as duas, nada muda.
 *
 * O DESTINO DE CADA CLASSE:
 *   · lead novo (número desconhecido): o lead nasce pela PORTA, `comercial.lead.criar`
 *     (R1), origem `whatsapp`, pela entrada idempotente do WhatsApp do comercial;
 *   · dúvida de lead e cliente ativo (número que é lead): o fato `whats.triada` no
 *     fio do lead (a mensagem já está lá, como sempre);
 *   · cliente ativo sem lead (só o cadastro de cliente tem o telefone): pendência
 *     para uma pessoa (a caixa);
 *   · documento: o arquivista do cliente (`ARQUIVISTA_DO_CLIENTE`, origem
 *     `whatsapp`; sem cliente, `partnerId` nulo e o arquivista decide). O binário
 *     só existe com o "webhook base64" ligado na instância da Evolution;
 *   · outro: nada (o número desconhecido não deixa rastro além do log).
 *   · confiança baixa, contradição ou modelo mudo: `Pendencia` tipo
 *     `whatsapp.triagem` com as opções para a pessoa decidir; o tratador inscrito
 *     aqui faz o que ela escolheu (lead novo vai PELA PORTA, em nome dela).
 *
 * NADA É RESPONDIDO AO CONTATO por este agente. O modelo é a função CO-16 do
 * cadastro (Haiku 5.5, esforço baixo), sem modelo nem esforço na chamada.
 */

export const MAX_BYTES_DO_DOCUMENTO_DO_WHATSAPP = 20 * 1024 * 1024;

export interface DocumentoDoWhatsapp {
  nome: string;
  mime: string;
  base64: string | null;
}

export interface MensagemParaTriar {
  telefone: string;
  leadId: string | null;
  texto: string | null;
  documento: DocumentoDoWhatsapp | null;
  mensagemId: string | null;
  /** O nome que o WhatsApp mostra (`pushName`), quando veio. */
  nome: string | null;
}

const OPCOES_DE_NUMERO_NOVO: OpcaoDaPendencia[] = [
  { chave: 'lead_novo', rotulo: 'É lead novo: criar no funil' },
  { chave: 'cliente_ativo', rotulo: 'É cliente: eu respondo pelo WhatsApp' },
  { chave: 'outro', rotulo: 'Não é do comercial: ignorar' },
];
const OPCOES_DE_LEAD: OpcaoDaPendencia[] = [
  { chave: 'duvida_de_lead', rotulo: 'É dúvida do lead (fica no fio)' },
  { chave: 'cliente_ativo', rotulo: 'É cliente ativo' },
  { chave: 'outro', rotulo: 'Não é do comercial' },
];

type P = Record<string, unknown>;

@Injectable()
export class TriagemDoWhatsappService implements OnModuleInit {
  private readonly log = new Logger('ComercialTriagemWhatsapp');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly memoria: MemoriaService,
    private readonly porta: PortaDoOperador,
    private readonly pendencias: PendenciasService,
    private readonly registroDePendencias: PendenciasRegistry,
    @Optional() @Inject(LLM_PROVIDER) private readonly llm?: LlmProvider,
    @Optional() @Inject(ARQUIVISTA_DO_CLIENTE) private readonly arquivista?: ArquivistaDoClientePort,
  ) {}

  onModuleInit(): void {
    this.registroDePendencias.aoResponder(TIPO_DA_PENDENCIA_DA_TRIAGEM, (r) => this.aoResponder(r), 'comercial/triagem-do-whatsapp');
  }

  /** As duas chaves: o provedor `evolution` e a nota `comercial.whatsapp.triagem` = `ligada`. */
  async ligada(orgId: string): Promise<boolean> {
    if (provedorDoAmbiente() !== 'evolution') return false;
    const nota = await this.memoria.porChave(orgId, NOTA_DA_TRIAGEM_DO_WHATSAPP, null).catch(() => null);
    const primeira = String(nota?.body ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
    return primeira.toLowerCase() === 'ligada';
  }

  /** Triagem de UMA mensagem. Devolve o rótulo para o log (sem número nem texto). Nunca lança. */
  async triar(orgId: string, m: MensagemParaTriar): Promise<string> {
    try {
      return await this.triarNaVez(orgId, m);
    } catch (e) {
      this.log.warn(`triagem do WhatsApp na empresa ${orgId} falhou: ${(e as Error).message.slice(0, 200)}`);
      return 'triagem: erro';
    }
  }

  private async contexto(orgId: string, m: MensagemParaTriar): Promise<ContextoDaTriagem & { partnerId: string | null }> {
    const telefone = normalizarTelefone(m.telefone);
    if (m.leadId) {
      const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId: m.leadId, orgId }, select: { clienteAtivoEm: true, partnerId: true } });
      const ativo = !!ficha?.clienteAtivoEm || !!(await this.prisma.leadEvent.findFirst({ where: { leadId: m.leadId, orgId, type: 'cliente.ativo' }, select: { id: true } }));
      return { ehLead: true, ehClienteAtivo: ativo, ehDocumento: !!m.documento, partnerId: ficha?.partnerId ?? null };
    }
    const cliente = await this.prisma.partner.findFirst({ where: { orgId, isCliente: true, phone: { in: [telefone, telefone.replace(/^55/, '')] } }, select: { id: true } });
    return { ehLead: false, ehClienteAtivo: !!cliente, ehDocumento: !!m.documento, partnerId: cliente?.id ?? null };
  }

  private async triarNaVez(orgId: string, m: MensagemParaTriar): Promise<string> {
    const ctx = await this.contexto(orgId, m);
    const mensagemId = m.mensagemId ?? hashDoConteudo({ telefone: normalizarTelefone(m.telefone), texto: m.texto ?? '', doc: m.documento?.nome ?? '' }).slice(0, 40);

    if (m.documento) return this.documento(orgId, m, ctx.partnerId, mensagemId);

    let leitura = null;
    if (this.llm && m.texto) {
      try {
        const { system, user } = promptDaTriagem(ctx, m.texto);
        leitura = interpretarTriagem(await this.llm.complete({ funcao: 'CO-16', system, user, orgId, maxTokens: 200 }));
      } catch (e) {
        this.log.warn(`triagem: o modelo não respondeu (${(e as Error).message.slice(0, 120)})`);
      }
    }
    const d = decidirTriagem(leitura, ctx);
    if (d.paraPessoa) return this.paraPessoa(orgId, m, d, mensagemId);

    if (m.leadId) {
      await this.registrar(orgId, m.leadId, d, d.classe === 'outro' ? 'nenhum (fica no fio)' : 'fio do lead', mensagemId);
      return `triagem: ${d.classe}`;
    }
    switch (d.classe) {
      case 'lead_novo':
        return this.criarLead(orgId, m, mensagemId, { actorId: ATOR_DA_TRIAGEM, actorType: ActorType.system }, d);
      case 'cliente_ativo':
        // Cliente cadastrado sem lead: a caixa de uma pessoa, que responde pelo WhatsApp.
        return this.paraPessoa(orgId, m, { ...d, motivo: 'mensagem de cliente ativo que não está no funil' }, mensagemId);
      default:
        return 'triagem: outro (ignorado)';
    }
  }

  private async registrar(orgId: string, leadId: string, d: Pick<DecisaoDaTriagem, 'classe' | 'confianca' | 'motivo'> & { origem: 'modelo' | 'regra' | 'pessoa' }, destino: string, mensagemId: string): Promise<void> {
    await this.fio.registrar(orgId, leadId, 'whats.triada', `${mensagemId}:${d.origem === 'pessoa' ? 'pessoa' : 'agente'}`, {
      classe: d.classe,
      confianca: Math.round(d.confianca * 100) / 100,
      destino,
      origem: d.origem,
      motivo: d.motivo ?? null,
      mensagemId,
    });
  }

  /** Lead novo pela porta (`comercial.lead.criar`, origem `whatsapp`). Retido pela régua, o rótulo diz. */
  private async criarLead(
    orgId: string,
    m: Pick<MensagemParaTriar, 'telefone' | 'texto' | 'nome'>,
    mensagemId: string,
    ator: { actorId: string; actorType: ActorType },
    d: Pick<DecisaoDaTriagem, 'classe' | 'confianca' | 'motivo'> & { origem: 'modelo' | 'regra' | 'pessoa' },
  ): Promise<string> {
    const telefone = normalizarTelefone(m.telefone);
    const nome = (m.nome?.trim() || `Contato do WhatsApp ${finalDoTelefone(telefone)}`).slice(0, 120);
    const mensagem = (m.texto ?? '').trim().slice(0, 2000) || '(mensagem sem texto)';
    const chave = chaveDaRequisicao({ origem: 'whatsapp', telefone, mensagemId });
    const r = await this.porta.executar({
      orgId,
      actorId: ator.actorId,
      actorType: ator.actorType,
      capabilityId: CAP_LEAD_CRIAR,
      args: { origem: 'whatsapp', nome, chave, telefone, mensagem },
      resource: { type: 'lead.entrada', id: chave },
    });
    const o = (r ?? {}) as P;
    if (o.status === 'aguardando_aprovacao') return 'triagem: lead_novo (retido pela régua)';
    const leadId = typeof o.leadId === 'string' ? o.leadId : null;
    if (leadId) await this.registrar(orgId, leadId, d, 'lead novo no funil', mensagemId);
    return 'triagem: lead_novo';
  }

  /** Confiança baixa ou contradição: a pendência com as opções para a pessoa. */
  private async paraPessoa(orgId: string, m: MensagemParaTriar, d: DecisaoDaTriagem, mensagemId: string): Promise<string> {
    const telefone = normalizarTelefone(m.telefone);
    const quem = `${m.nome?.trim() ? `${m.nome.trim().slice(0, 60)} ` : ''}(${finalDoTelefone(telefone)})`;
    const trecho = (m.texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    await this.pendencias.abrir(orgId, {
      funcao: 'CO-16',
      tipo: TIPO_DA_PENDENCIA_DA_TRIAGEM,
      chave: `whatsapp:${mensagemId}`,
      titulo: m.leadId ? `Mensagem de lead no WhatsApp: qual é o assunto? ${quem}` : `Mensagem nova no WhatsApp: é lead? ${quem}`,
      contexto: `${trecho ? `“${trecho}”. ` : ''}A triagem achou ${ROTULO_DA_CLASSE_DA_TRIAGEM[d.classe]} com confiança ${Math.round(d.confianca * 100)}%${d.motivo ? ` (${d.motivo})` : ''}. Nada foi respondido ao contato.`.slice(0, 1000),
      opcoes: m.leadId ? OPCOES_DE_LEAD : OPCOES_DE_NUMERO_NOVO,
      refTipo: m.leadId ? 'lead' : null,
      refId: m.leadId,
      dados: { telefone, nome: m.nome ?? null, texto: (m.texto ?? '').slice(0, 2000), mensagemId, classe: d.classe, confianca: d.confianca } as Prisma.InputJsonValue,
    });
    if (m.leadId) await this.registrar(orgId, m.leadId, d, 'pendência para uma pessoa', mensagemId);
    return 'triagem: pendência';
  }

  /** Documento: o arquivista do cliente. Sem o binário no corpo (webhook base64 desligado), o motivo fica. */
  private async documento(orgId: string, m: MensagemParaTriar, partnerId: string | null, mensagemId: string): Promise<string> {
    const doc = m.documento!;
    const d: DecisaoDaTriagem = { classe: 'documento', confianca: 1, motivo: 'a mensagem é um arquivo', origem: 'regra', paraPessoa: false };
    let destino: string;
    if (!doc.base64) destino = 'sem o arquivo: ligue o webhook base64 na instância da Evolution';
    else if (!this.arquivista) destino = 'arquivista indisponível nesta instância';
    else {
      const buffer = Buffer.from(doc.base64, 'base64');
      if (!buffer.length) destino = 'arquivo vazio';
      else if (buffer.length > MAX_BYTES_DO_DOCUMENTO_DO_WHATSAPP) destino = 'arquivo acima de 20 MB: não arquivado';
      else {
        const r = await this.arquivista.arquivar({
          orgId,
          partnerId,
          leadId: m.leadId,
          origem: 'whatsapp',
          nomeOriginal: doc.nome.slice(0, 200) || 'documento-do-whatsapp',
          tipoMime: doc.mime || 'application/octet-stream',
          conteudo: { buffer },
        });
        destino = `arquivista: ${r.estado}`;
      }
    }
    if (m.leadId) await this.registrar(orgId, m.leadId, d, destino, mensagemId);
    return `triagem: documento (${destino.slice(0, 60)})`;
  }

  /** O tratador da pendência: faz o que a pessoa escolheu. Lead novo vai pela porta, em nome dela. */
  async aoResponder(r: RespostaDaPendencia): Promise<void> {
    const dados = (r.dados ?? {}) as P;
    const telefone = String(dados.telefone ?? '');
    const mensagemId = String(dados.mensagemId ?? r.pendenciaId);
    const escolha = r.escolha as ClasseDaTriagem;
    const decisao = { classe: escolha, confianca: 1, motivo: 'decidido por uma pessoa', origem: 'pessoa' as const };
    if (r.refTipo === 'lead' && r.refId) {
      await this.registrar(r.orgId, r.refId, decisao, escolha === 'outro' ? 'nenhum (fica no fio)' : 'fio do lead', mensagemId);
      return;
    }
    if (escolha === 'lead_novo') {
      await this.criarLead(
        r.orgId,
        { telefone, texto: typeof dados.texto === 'string' ? dados.texto : null, nome: typeof dados.nome === 'string' ? dados.nome : null },
        mensagemId,
        { actorId: r.usuarioId, actorType: ActorType.user },
        decisao,
      );
    }
    // `cliente_ativo` e `outro` de número desconhecido: a decisão fica na própria pendência.
  }
}
