import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { ConectoresConfiguradosRegistry } from '../gateway/conectores-configurados.registry';

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
  ) {}

  get configured(): boolean {
    return this.base.length > 0 && this.apiKey.length > 0 && this.instancia.length > 0;
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

  /** Estado da conexão — a tela usa para dizer se dá para publicar. */
  async estado(): Promise<{ configurada: boolean; conectada: boolean; motivo: string | null; grupo: string | null }> {
    if (!this.configured) {
      return { configurada: false, conectada: false, motivo: 'Credenciais ausentes no .env.', grupo: null };
    }
    try {
      const res = await fetch(`${this.base}/instance/connectionState/${this.instancia}`, {
        headers: { apikey: this.apiKey },
        signal: AbortSignal.timeout(10_000),
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
