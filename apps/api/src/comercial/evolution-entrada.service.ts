import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { SalaFormSchema } from '@mktos/shared';

import { EntradaDiretaRegistry } from '../gateway/canais/entrada-direta.registry';
import { ADMINISTRACAO_DA_EVOLUTION, type AdministracaoDaEvolution } from '../gateway/canais/evolution.port';
import { PrismaService } from '../prisma/prisma.service';
import { escolhaNumerada, respostaDoFormulario } from './canais/texto-numerado';
import { provedorDoAmbiente, type Interativo } from './canais/whatsapp.port';
import { normalizarTelefone } from './eventos';
import { SalaService } from './sala.service';
import { TriagemDoWhatsappService, type DocumentoDoWhatsapp } from './triagem-do-whatsapp/triagem-do-whatsapp.service';
import { WhatsappComercialService } from './whatsapp.service';

/*
 * A ENTRADA DA EVOLUTION NO COMERCIAL (Rodada de produção 1, 21/10/2026, P8).
 *
 * O webhook da instância é o do canal de aprovação
 * (`POST /api/approvals/canal/whatsapp/:orgId`, com o segredo `x-canal-segredo`;
 * sem ele, 404, como sempre). Ali, depois do grupo de links, a conversa
 * INDIVIDUAL passa por `EntradaDiretaRegistry`, que já tirou do caminho quem é
 * identidade do canal; este serviço se inscreve nele no arranque. A porta não
 * importa o comercial: é o comercial que se oferece.
 *
 * O que é do comercial: a mensagem de texto de um número que JÁ É LEAD desta
 * empresa, com `WHATSAPP_PROVEDOR=evolution`. O resto devolve `null` e segue
 * para o canal (que ignora, em silêncio, quem não é identidade cadastrada).
 * Número novo NÃO cria lead por aqui: a instância é a mesma do canal de
 * aprovação, e qualquer conversa com o número viraria lead (decisão desta
 * rodada, registrada como pendência).
 *
 * O caminho de uma mensagem do lead:
 *   1. conector desligado nesta empresa: nada entra;
 *   2. mensagem de outra instância (o `instance` do corpo) é ignorada;
 *   3. só texto digitado passa (conversa ou texto estendido; edição,
 *      protocolo, mídia e reação ficam de fora);
 *   4. grava a mensagem (`receberDoLead`) e, se a última mensagem enviada ao
 *      lead tinha botões ou formulário, a resposta numerada vira a escolha do
 *      horário ou o formulário respondido, pelos MESMOS caminhos do simulador.
 *
 * Nem o número, nem o texto, nem o corpo vão para o log (o corpo do webhook da
 * Evolution traz a chave da instância).
 *
 * A TRIAGEM (rodada dos agentes, 21/10/2026, CO-16): com a triagem LIGADA
 * (`WHATSAPP_PROVEDOR=evolution` e a nota `comercial.whatsapp.triagem` =
 * `ligada`), o número que NÃO é lead também passa por aqui e vai à triagem
 * (que cria o lead pela porta, abre pendência ou ignora), e o documento (de lead
 * ou não) vai ao arquivista. A mensagem de texto de quem já é lead segue o
 * caminho de sempre e, depois, ganha a classe no fio. Com a triagem desligada,
 * tudo é exatamente como antes. Conector desligado e instância de outra empresa
 * barram a triagem do mesmo jeito.
 *
 * A SALA NA PRIMEIRA MENSAGEM (leva 5, L6, 27/10/2026): quem já é lead e escreve
 * ganha a sala ali, pelo MESMO `SalaService.garantir` da reação `sala.abrir`
 * (idempotente pelo `leadId` único: a segunda mensagem não cria outra). É o
 * caminho do lead importado do CRM antigo ou criado à mão, que nunca teve o
 * `lead.chegou`. Falha ao garantir a sala nunca segura a mensagem.
 */

const ISO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const TIPOS_DE_TEXTO = new Set(['conversation', 'extendedTextMessage']);

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function temEdicaoOuProtocolo(v: unknown, profundidade = 0): boolean {
  const o = objeto(v);
  if (!o || profundidade > 6) return false;
  return Object.entries(o).some(([k, x]) => k === 'editedMessage' || k === 'protocolMessage' || temEdicaoOuProtocolo(x, profundidade + 1));
}

export type LeituraDaEvolution = { mensagem: { mensagemId: string | null; texto: string; instancia: string | null } } | { ignorado: string };

const TIPOS_DE_DOCUMENTO = new Set(['documentMessage', 'documentWithCaptionMessage', 'imageMessage']);

/**
 * CO-16: o arquivo de uma mensagem da Evolution (documento ou imagem), ou `null`. O binário só vem
 * com o "webhook base64" ligado na instância (`message.base64`); sem ele, `base64` é `null`.
 */
export function lerDocumentoDaEvolution(evento: unknown): (DocumentoDoWhatsapp & { mensagemId: string | null; instancia: string | null }) | null {
  const raiz = objeto(evento);
  const data = objeto(raiz?.data);
  const message = objeto(data?.message);
  if (!data || !message) return null;
  const tipo = typeof data.messageType === 'string' ? data.messageType : '';
  if (!TIPOS_DE_DOCUMENTO.has(tipo)) return null;
  const comLegenda = objeto(objeto(message.documentWithCaptionMessage)?.message);
  const doc = objeto(message.documentMessage) ?? objeto(comLegenda?.documentMessage) ?? objeto(message.imageMessage);
  const nome = typeof doc?.fileName === 'string' && doc.fileName.trim() ? doc.fileName.trim() : tipo === 'imageMessage' ? 'imagem-do-whatsapp.jpg' : 'documento-do-whatsapp';
  const mime = typeof doc?.mimetype === 'string' ? doc.mimetype.split(';')[0].trim().slice(0, 120) : '';
  const base64 = typeof message.base64 === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(message.base64.slice(0, 200)) ? message.base64.replace(/\s+/g, '') : null;
  const key = objeto(data.key);
  return {
    nome: nome.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').slice(0, 200),
    mime,
    base64,
    mensagemId: typeof key?.id === 'string' ? key.id.slice(0, 120) : null,
    instancia: typeof raiz?.instance === 'string' ? raiz.instance : null,
  };
}

/** O nome que o WhatsApp mostra de quem escreveu (`pushName`), numa linha. */
function nomeDoContato(evento: unknown): string | null {
  const v = objeto(objeto(evento)?.data)?.pushName;
  return typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
}

/** O texto digitado de uma mensagem nova da Evolution (`messages.upsert`), ou o motivo de não ser. */
export function lerMensagemDaEvolution(evento: unknown): LeituraDaEvolution {
  const raiz = objeto(evento);
  const data = objeto(raiz?.data);
  const message = objeto(data?.message);
  if (!data || !message) return { ignorado: 'sem mensagem' };
  if (temEdicaoOuProtocolo(data)) return { ignorado: 'edição ou protocolo' };
  const tipo = data.messageType;
  if (typeof tipo === 'string' && !TIPOS_DE_TEXTO.has(tipo)) return { ignorado: `tipo ${tipo}` };
  const estendida = objeto(message.extendedTextMessage);
  const cru = typeof message.conversation === 'string' ? message.conversation : typeof estendida?.text === 'string' ? estendida.text : '';
  const texto = cru.trim();
  if (!texto) return { ignorado: 'sem texto' };
  const key = objeto(data.key);
  return {
    mensagem: {
      mensagemId: typeof key?.id === 'string' ? key.id.slice(0, 120) : null,
      texto: texto.slice(0, 2000),
      instancia: typeof raiz?.instance === 'string' ? raiz.instance : null,
    },
  };
}

@Injectable()
export class EvolutionEntradaService implements OnModuleInit {
  private readonly log = new Logger('ComercialEvolutionEntrada');

  constructor(
    private readonly prisma: PrismaService,
    private readonly whats: WhatsappComercialService,
    private readonly sala: SalaService,
    @Optional() @Inject(ADMINISTRACAO_DA_EVOLUTION) private readonly evolution?: AdministracaoDaEvolution,
    @Optional() private readonly diretas?: EntradaDiretaRegistry,
    // CO-16 (rodada dos agentes): a triagem; sem ela (ou desligada), o caminho é o de antes.
    @Optional() private readonly triagem?: TriagemDoWhatsappService,
  ) {}

  onModuleInit(): void {
    this.diretas?.registrar((orgId, evento, remetente) => this.processar(orgId, evento, remetente), 'comercial/evolution-entrada');
  }

  /**
   * A conversa 1:1 que chegou pelo webhook. `null` = não é do comercial (segue
   * para o canal). O rótulo vai para o log e para a suíte, sem número nem texto.
   */
  async processar(orgId: string, evento: unknown, remetente: string): Promise<string | null> {
    if (provedorDoAmbiente() !== 'evolution' || !this.evolution) return null;
    const telefone = normalizarTelefone(remetente);
    if (!/^\d{10,15}$/.test(telefone)) return null;
    const lead = await this.prisma.lead.findFirst({ where: { orgId, phone: telefone }, select: { id: true }, orderBy: { enteredAt: 'asc' } });
    // CO-16: com a triagem ligada, o número que não é lead também é do comercial.
    const triagem = this.triagem && (await this.triagem.ligada(orgId)) ? this.triagem : null;
    if (!lead && !triagem) return null;

    if (!(await this.evolution.ligado(orgId))) return 'conector desligado';
    const leitura = lerMensagemDaEvolution(evento);
    const documento = triagem && 'ignorado' in leitura ? lerDocumentoDaEvolution(evento) : null;
    if ('ignorado' in leitura && !documento) return `ignorado: ${leitura.ignorado}`;
    const instanciaDoCorpo = 'mensagem' in leitura ? leitura.mensagem.instancia : documento?.instancia ?? null;
    const instancia = await this.evolution.instanciaDaEmpresa(orgId);
    // A instância é a prova de empresa (revisão adversarial, 21/10/2026): o segredo do webhook
    // é do processo, então sem a instância desta empresa no corpo a mensagem não entra.
    if (!instancia || !instanciaDoCorpo) return 'ignorado: sem instância';
    if (instanciaDoCorpo !== instancia) return 'ignorado: outra instância';
    if (documento && triagem) {
      return triagem.triar(orgId, { telefone, leadId: lead?.id ?? null, texto: null, documento, mensagemId: documento.mensagemId, nome: nomeDoContato(evento) });
    }
    if (!('mensagem' in leitura)) return 'ignorado';
    const m = leitura.mensagem;
    if (!lead) {
      return triagem!.triar(orgId, { telefone, leadId: null, texto: m.texto, documento: null, mensagemId: m.mensagemId, nome: nomeDoContato(evento) });
    }

    const ultima = await this.prisma.comercialMensagem.findFirst({
      where: { orgId, leadId: lead.id, direcao: 'saida', destino: 'lead', estado: 'enviada' },
      orderBy: { enviadaEm: 'desc' },
      select: { interativo: true },
    });
    await this.whats.receberDoLead(orgId, lead.id, m.texto, m.mensagemId);
    // L6: a sala nasce na primeira mensagem de quem já é lead (idempotente). Só o id do lead vai ao log.
    try {
      await this.sala.garantir(orgId, lead.id);
    } catch (e) {
      this.log.warn(`sala do lead ${lead.id} não garantida na entrada: ${(e as Error).message}`);
    }

    const inter = (ultima?.interativo ?? null) as Interativo | null;
    if (inter?.botoes?.length) {
      const chave = escolhaNumerada(m.texto, inter.botoes);
      if (chave && ISO_COM_FUSO.test(chave)) {
        await this.sala.escolherHorario(orgId, lead.id, chave);
        return 'botão escolhido';
      }
    }
    if (inter?.formulario) {
      const campos = respostaDoFormulario(m.texto, inter.formulario);
      const form = campos ? SalaFormSchema.safeParse(campos) : null;
      if (form?.success) {
        await this.sala.responderFormulario(orgId, lead.id, form.data);
        return 'formulário respondido';
      }
    }
    // CO-16: a mensagem livre de quem já é lead ganha a classe no fio (a resposta numerada acima não).
    if (triagem) await triagem.triar(orgId, { telefone, leadId: lead.id, texto: m.texto, documento: null, mensagemId: m.mensagemId, nome: nomeDoContato(evento) });
    return 'mensagem de lead';
  }
}
