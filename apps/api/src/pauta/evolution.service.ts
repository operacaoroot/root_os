import {
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { ConectoresConfiguradosRegistry } from '../gateway/conectores-configurados.registry';
import { TransporteDeCanalRegistry } from '../gateway/canais/transporte.registry';
import {
  PRAZO_DA_CHAMADA_DE_SONDA_MS,
  RegistroDeConectores,
} from '../integrations/conectores.registry';
import {
  type ConectorDoContrato,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
  naoConfigurado,
} from '../integrations/contrato-de-conector';

/**
 * Quanto tempo a consulta de estado da instância pode demorar para QUEM NÃO É A
 * SONDA — hoje, o portão da publicação no WhatsApp.
 *
 * Dez segundos: o valor que este caminho sempre teve. Está escrito como
 * constante, e não solto no `fetch`, porque agora há dois prazos no arquivo e a
 * diferença entre eles é uma decisão, não um descuido (ver `estado`).
 */
export const PRAZO_DA_CONSULTA_DE_INSTANCIA_MS = 10_000;

// Conector WhatsApp via Evolution API. Instância e número DEDICADOS do root —
// o ISOLATION.md proíbe reusar o canal do escritório, e um número compartilhado
// levaria banimento junto se algo aqui disparasse demais.
//
// Por que Evolution e não a Cloud API da Meta: a Cloud API **não envia para
// grupo**, e grupo é o destino. O preço é usar uma conexão não-oficial — daí o
// rate-limit conservador e o envio sempre atrás de aprovação humana.
@Injectable()
export class EvolutionService implements OnModuleInit {
  private readonly log = new Logger('EvolutionService');
  private readonly base = (process.env.EVOLUTION_URL ?? '').replace(/\/$/, '');
  private readonly apiKey = process.env.EVOLUTION_API_KEY ?? '';
  private readonly instancia = process.env.EVOLUTION_INSTANCIA ?? '';
  /** JID do grupo (termina em @g.us) — não é o número de telefone. */
  private readonly grupoPadrao = process.env.EVOLUTION_GRUPO_JID ?? '';

  constructor(
    private readonly efeitos: EfeitosRegistry,
    private readonly conectoresConfigurados: ConectoresConfiguradosRegistry,
    /** O contrato único de conector (fatia 5.4) — módulo `@Global`. */
    private readonly contrato: RegistroDeConectores,
    /*
     * O TRANSPORTE DO CANAL DE APROVAÇÃO (fatia 5.5, RF-A-06) — módulo
     * `@Global`, e `@Optional()` por um motivo concreto: as suítes constroem
     * este serviço À MÃO, com três argumentos posicionais
     * (`test/contrato-de-conector.test.ts`). Um quarto parâmetro obrigatório
     * quebraria uma suíte que não é desta fatia; opcional, ele chega `undefined`
     * ali e o conector se comporta exatamente como antes.
     *
     * Sem ele, o canal de aprovação simplesmente não existe — e não existir é o
     * padrão, não uma falha.
     */
    @Optional() private readonly canais?: TransporteDeCanalRegistry,
  ) {}

  get configured(): boolean {
    return this.base.length > 0 && this.apiKey.length > 0 && this.instancia.length > 0;
  }

  /**
   * O CONTRATO ÚNICO — autorizar, sincronizar, saúde, revogar (RF-X-01).
   *
   * Este conector é o caso em que a honestidade da saúde mais importa: ele é a
   * ÚNICA escrita externa de verdade ligada hoje (R3, `whatsapp.mensagem.enviar`),
   * e uma instância despareada responde "credencial presente" para quem só olha
   * variável de ambiente. A sonda pergunta à Evolution o estado da INSTÂNCIA,
   * que é o que de fato decide se a mensagem vai sair.
   */
  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: 'whatsapp',
      rotulo: 'WhatsApp (Evolution)',
      /*
       * Instância e número DEDICADOS do root, definidos no ambiente — não há uma
       * instância por empresa. O ISOLATION.md proíbe reusar o canal do
       * escritório justamente porque o número é compartilhado entre tudo o que
       * este processo manda.
       */
      escopoDaCredencial: 'processo',

      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'manual',
        instrucao:
          'A Evolution não tem OAuth: a instância é PAREADA por QR code no painel dela, fora ' +
          'do OS, e as credenciais da API ficam no ambiente da API. Quando a sonda diz que a ' +
          'instância não está aberta, o conserto é abrir o painel da Evolution e reconectar o ' +
          'número — nenhuma tela daqui faz isso.',
      }),

      sincronizar: async (): Promise<ResultadoDeSincronizacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'Não há espelho local de WhatsApp para trazer: este conector só ENVIA, e enviar é ' +
          'ação de nível R3 — passa pela porta, com aprovação de uma pessoa, nunca por um ' +
          'botão de sincronizar. O histórico de grupo, quando é preciso, é lido direto no ' +
          'banco da Evolution por consulta, fora do OS.',
      }),

      saude: async (): Promise<SaudeDeConector> => {
        const comecou = Date.now();
        // O prazo CURTO, só aqui: ver o cabeçalho de `estado`. O portão da
        // publicação (que roda com ação já aprovada) fica com o prazo longo.
        const e = await this.estado({ prazoMs: PRAZO_DA_CHAMADA_DE_SONDA_MS });
        if (!e.configurada) {
          return naoConfigurado(
            `${e.motivo ?? 'Credenciais da Evolution ausentes no ambiente da API.'} ` +
              'Sem elas nenhuma empresa envia WhatsApp — a instância é do processo, não desta ' +
              'empresa.',
          );
        }
        if (!e.conectada) {
          return erroDeConector(
            `${e.motivo ?? 'A instância não está aberta.'} Nenhuma mensagem sai enquanto isso.`,
            Date.now() - comecou,
          );
        }
        return conectado(
          Date.now() - comecou,
          `instância aberta${e.grupo ? ` · grupo de destino ${e.grupo}` : ' · sem grupo de destino definido'}.`,
        );
      },

      revogar: async (): Promise<ResultadoDeRevogacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'A credencial da Evolution é do PROCESSO e o número é um só: queimá-la daqui pararia ' +
          'o WhatsApp de todas as empresas, e não há como fazê-lo só para esta. Para esta ' +
          'empresa parar de enviar AGORA, DESLIGUE o conector em Conexões — a porta recusa a ' +
          'ferramenta na próxima chamada, com motivo e registro no rastro. Para queimar a ' +
          'credencial de verdade, troque a chave no painel da Evolution e no ambiente da API.',
      }),
    };
  }

  /*
   * O CONECTOR DECLARA A CAPACIDADE QUE ELE REALIZA — fatia 3.3.
   *
   * Este efeito morava em `agents/efeitos.service.ts`, que para escrevê-lo tinha
   * de IMPORTAR este serviço. Era a violação mais antiga da catraca de
   * arquitetura: o runtime do agente alcançando um conector por fora da porta.
   * O corpo do efeito não mudou — o que mudou foi de que lado da fronteira ele
   * mora. Quem precisa dele agora é a porta, que o busca no registro.
   */
  onModuleInit(): void {
    this.conectoresConfigurados.registrar('whatsapp', () => this.configured);
    // O contrato único (fatia 5.4). Antes de qualquer coisa, pelo mesmo motivo
    // da linha acima: "sem credencial" é uma RESPOSTA, e o registro derruba o
    // arranque quando um conector cobrado não se inscreve.
    this.contrato.registrar(this.descritorDoContrato(), 'EvolutionService');

    /*
     * O TRANSPORTE DO CANAL DE APROVAÇÃO — fatia 5.5, RF-A-06.
     *
     * O que sai por aqui é mensagem de SERVIÇO para o operador: o pedido de
     * decisão e a resposta a quem decidiu. NÃO é publicação — publicar continua
     * sendo `whatsapp.mensagem.enviar`, que é R3, passa pela porta e só sai com
     * assinatura de gente. O argumento inteiro está no cabeçalho de
     * `gateway/canais/envio-de-aprovacao.service.ts`, no bloco "POR QUE ISTO NÃO
     * É AÇÃO DO GATEWAY".
     *
     * DESTINO SEMPRE DIRETO, NUNCA O GRUPO. O parâmetro é a chave de identidade
     * (o número cadastrado em `ChannelIdentity`), e aqui ela vira o JID de
     * conversa individual. `this.grupo` não aparece nesta função de propósito:
     * mandar pedido de aprovação para o grupo poria o conteúdo exato diante de
     * quem não assina e transformaria uma conversa em superfície de decisão —
     * que é exatamente o que a fatia 5.5 recusa.
     */
    if (this.canais) {
      this.canais.registrar(
        'whatsapp',
        async (destino, texto) => {
          await this.enviarTexto(this.jidDireto(destino), texto);
        },
        'EvolutionService',
      );
    }

    this.efeitos.registrar({
      /*
       * R3: só chega aqui depois que uma pessoa aprovou, e com os argumentos
       * GRAVADOS na proposta — nunca com os que vieram na confirmação.
       *
       * O destino é SEMPRE o grupo configurado no ambiente. O modelo não escolhe
       * para quem manda: um `destino` proposto por ele é ignorado de propósito,
       * senão a régua controlaria o texto e não o destinatário.
       *
       * O terceiro parâmetro é quem pediu (RF-T-04, RNF-09). A Evolution não tem
       * campo para ator, então ele sai no RESULTADO — que é o que a porta grava
       * em `ToolCall.resultado` e o que volta para quem confirmou. Sem isso, o
       * registro do envio diz o que saiu e não diz por ordem de quem: nesta rota
       * o proponente é a IA e o executor é gente, e a diferença é o ponto inteiro
       * da aprovação.
       */
      'whatsapp.mensagem.enviar': async (
        a: Record<string, unknown>,
        _org: string,
        ctx: ContextoDoEfeito,
      ) => {
        const titulo = String(a.titulo ?? '').trim();
        const corpo = String(a.corpo ?? a.texto ?? a.mensagem ?? '').trim();
        if (!corpo) throw new Error('mensagem vazia: nada foi enviado');
        const texto = titulo ? `*${titulo}*\n\n${corpo}` : corpo;
        const r = await this.enviarTexto(this.grupo, texto);
        return {
          enviado: true,
          id: r.id,
          destino: this.grupo,
          caracteres: texto.length,
          porOrdemDe: ctx.actorId ?? null,
        };
      },
    }, 'EvolutionService');
  }

  get grupo(): string {
    return this.grupoPadrao;
  }

  /**
   * A chave de identidade vira o JID de CONVERSA INDIVIDUAL.
   *
   * Aceita a chave na forma canônica (só os dígitos) e na forma de JID inteiro,
   * que é como alguém pode tê-la cadastrado. O que ela nunca produz é um JID de
   * grupo: um valor terminado em `@g.us` chega aqui só se alguém o tiver
   * gravado como identidade de pessoa, e mandar o pedido de aprovação para lá
   * seria publicar o conteúdo exato num grupo. Falha fechada — lança.
   */
  private jidDireto(chave: string): string {
    const cru = chave.trim();
    if (cru.endsWith('@g.us')) {
      throw new Error('identidade de canal aponta para um GRUPO: pedido de aprovação não sai daqui');
    }
    return cru.includes('@') ? cru : `${cru}@s.whatsapp.net`;
  }

  private assert(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Evolution não configurada. Defina EVOLUTION_URL, EVOLUTION_API_KEY e ' +
          'EVOLUTION_INSTANCIA no .env (instância própria do root) e reinicie a API.',
      );
    }
  }

  private async chamar<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.log.error(`Evolution ${path} HTTP ${res.status}: ${txt.slice(0, 300)}`);
      throw new ServiceUnavailableException(`Evolution respondeu HTTP ${res.status}.`);
    }
    return (await res.json()) as T;
  }

  /**
   * Estado da conexão — a tela usa para dizer se dá para publicar.
   *
   * ==========================================================================
   * DOIS CHAMADORES, DOIS PRAZOS — e a diferença é deliberada
   * ==========================================================================
   * Quem chama isto não é só a tela de diagnóstico:
   *
   *  · `PautaPublicacaoService.publicarWhatsapp` chama ANTES DE PUBLICAR. É o
   *    portão da única escrita externa viva do produto (R3), e ela chega ali
   *    JÁ APROVADA POR UMA PESSOA. Baixar o prazo desse portão faz uma Evolution
   *    lenta REPROVAR uma publicação já assinada — a mesma mensagem, um efeito
   *    completamente diferente. Por isso o padrão continua sendo
   *    `PRAZO_DA_CONSULTA_DE_INSTANCIA_MS`, os 10 s que este caminho sempre
   *    teve: esta fatia não muda o comportamento de quem já estava em produção;
   *  · a SONDA do contrato passa o prazo curto de propósito (ver `saude`): a
   *    tela de Conexões tem um relógio de fora de 6 s, e o corte de dentro
   *    precisa vencê-lo para que a frase útil ("Instância em 'close' —
   *    reconecte o número") chegue no lugar do "a sonda passou de 6000 ms".
   */
  async estado(
    opcoes: { prazoMs?: number } = {},
  ): Promise<{ configurada: boolean; conectada: boolean; motivo: string | null; grupo: string | null }> {
    if (!this.configured) {
      return { configurada: false, conectada: false, motivo: 'Credenciais ausentes no .env.', grupo: null };
    }
    try {
      const res = await fetch(`${this.base}/instance/connectionState/${this.instancia}`, {
        headers: { apikey: this.apiKey },
        signal: AbortSignal.timeout(opcoes.prazoMs ?? PRAZO_DA_CONSULTA_DE_INSTANCIA_MS),
      });
      if (!res.ok) {
        return {
          configurada: true,
          conectada: false,
          motivo: `A Evolution respondeu HTTP ${res.status} ao consultar a instância.`,
          grupo: this.grupoPadrao || null,
        };
      }
      const j = (await res.json()) as { instance?: { state?: string } };
      const estado = j.instance?.state ?? 'desconhecido';
      return {
        configurada: true,
        conectada: estado === 'open',
        motivo: estado === 'open' ? null : `Instância em "${estado}" — reconecte o número.`,
        grupo: this.grupoPadrao || null,
      };
    } catch (e) {
      return {
        configurada: true,
        conectada: false,
        motivo: `Não deu para falar com a Evolution: ${(e as Error).message}`,
        grupo: this.grupoPadrao || null,
      };
    }
  }

  /** Envia texto para um JID (grupo termina em @g.us). */
  async enviarTexto(jid: string, texto: string): Promise<{ id: string | null }> {
    this.assert();
    const destino = jid || this.grupoPadrao;
    if (!destino) throw new ServiceUnavailableException('Nenhum grupo de destino definido.');

    const r = await this.chamar<{ key?: { id?: string } }>(`/message/sendText/${this.instancia}`, {
      number: destino,
      text: texto,
    });
    return { id: r.key?.id ?? null };
  }
}
