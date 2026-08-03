import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

// Conector WhatsApp via Evolution API. Instância e número DEDICADOS do root —
// o ISOLATION.md proíbe reusar o canal do escritório, e um número compartilhado
// levaria banimento junto se algo aqui disparasse demais.
//
// Por que Evolution e não a Cloud API da Meta: a Cloud API **não envia para
// grupo**, e grupo é o destino. O preço é usar uma conexão não-oficial — daí o
// rate-limit conservador e o envio sempre atrás de aprovação humana.
@Injectable()
export class EvolutionService {
  private readonly log = new Logger('EvolutionService');
  private readonly base = (process.env.EVOLUTION_URL ?? '').replace(/\/$/, '');
  private readonly apiKey = process.env.EVOLUTION_API_KEY ?? '';
  private readonly instancia = process.env.EVOLUTION_INSTANCIA ?? '';
  /** JID do grupo (termina em @g.us) — não é o número de telefone. */
  private readonly grupoPadrao = process.env.EVOLUTION_GRUPO_JID ?? '';

  get configured(): boolean {
    return this.base.length > 0 && this.apiKey.length > 0 && this.instancia.length > 0;
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
