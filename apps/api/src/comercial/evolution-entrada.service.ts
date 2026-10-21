import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { SalaFormSchema } from '@mktos/shared';

import { EntradaDiretaRegistry } from '../gateway/canais/entrada-direta.registry';
import { ADMINISTRACAO_DA_EVOLUTION, type AdministracaoDaEvolution } from '../gateway/canais/evolution.port';
import { PrismaService } from '../prisma/prisma.service';
import { escolhaNumerada, respostaDoFormulario } from './canais/texto-numerado';
import { provedorDoAmbiente, type Interativo } from './canais/whatsapp.port';
import { normalizarTelefone } from './eventos';
import { SalaService } from './sala.service';
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
 *      horário ou o formulário respondido, pelos MESMOS caminhos do DigiSac e do
 *      simulador.
 *
 * Nem o número, nem o texto, nem o corpo vão para o log (o corpo do webhook da
 * Evolution traz a chave da instância).
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly whats: WhatsappComercialService,
    private readonly sala: SalaService,
    @Optional() @Inject(ADMINISTRACAO_DA_EVOLUTION) private readonly evolution?: AdministracaoDaEvolution,
    @Optional() private readonly diretas?: EntradaDiretaRegistry,
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
    if (!lead) return null;

    if (!(await this.evolution.ligado(orgId))) return 'conector desligado';
    const leitura = lerMensagemDaEvolution(evento);
    if ('ignorado' in leitura) return `ignorado: ${leitura.ignorado}`;
    const m = leitura.mensagem;
    const instancia = await this.evolution.instanciaDaEmpresa(orgId);
    // A instância é a prova de empresa (revisão adversarial, 21/10/2026): o segredo do webhook
    // é do processo, então sem a instância desta empresa no corpo a mensagem não entra.
    if (!instancia || !m.instancia) return 'ignorado: sem instância';
    if (m.instancia !== instancia) return 'ignorado: outra instância';

    const ultima = await this.prisma.comercialMensagem.findFirst({
      where: { orgId, leadId: lead.id, direcao: 'saida', destino: 'lead', estado: 'enviada' },
      orderBy: { enviadaEm: 'desc' },
      select: { interativo: true },
    });
    await this.whats.receberDoLead(orgId, lead.id, m.texto, m.mensagemId);

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
    return 'mensagem de lead';
  }
}
