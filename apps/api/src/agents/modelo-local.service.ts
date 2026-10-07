import { Injectable } from '@nestjs/common';

export interface ModeloLocalEstado {
  disponivel: boolean;
  provider: 'llama.cpp-local';
  modelo: string | null;
  motivo: string | null;
}
export interface ResultadoLocal {
  texto: string;
  modelo: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

/** Transporte restrito ao servidor local. Não aceita credencial ou fallback remoto. */
@Injectable()
export class ModeloLocalService {
  private endpoint(): string | null {
    const raw = process.env.ROOTOS_LOCAL_MODEL_URL;
    if (!raw) return null;
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
        || u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname)) return null;
      return u.origin;
    } catch { return null; }
  }

  async estado(): Promise<ModeloLocalEstado> {
    const endpoint = this.endpoint();
    const indisponivel = (motivo: string): ModeloLocalEstado => ({ disponivel: false, provider: 'llama.cpp-local', modelo: null, motivo });
    if (!endpoint) return indisponivel('Modelo local não configurado.');
    try {
      const r = await fetch(`${endpoint}/v1/models`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
      if (!r.ok) return indisponivel('Servidor do modelo local indisponível.');
      const body = await r.json() as { data?: { id?: unknown }[] };
      const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200);
      if (ids.length !== 1) return indisponivel('Não foi possível identificar um único modelo local.');
      return { disponivel: true, provider: 'llama.cpp-local', modelo: ids[0], motivo: null };
    } catch { return indisponivel('Servidor do modelo local indisponível.'); }
  }

  async resumir(modelo: string, system: string, pedido: string): Promise<ResultadoLocal> {
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('Modelo local não configurado.');
    const r = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo, temperature: 0, max_tokens: 180,
        messages: [{ role: 'system', content: system }, { role: 'user', content: pedido }] }),
    });
    if (!r.ok) throw new Error('A chamada do modelo local falhou. Confira o servidor antes de criar outro pedido.');
    const body = await r.json() as { model?: unknown; choices?: { message?: { content?: unknown; tool_calls?: unknown[] }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const message = body.choices?.[0]?.message;
    if (message?.tool_calls?.length) throw new Error('Ferramenta não permitida neste procedimento. Nenhuma ferramenta foi executada.');
    if (body.model !== modelo) throw new Error('O modelo servido difere do modelo escolhido. Confira a configuração.');
    if (typeof message?.content !== 'string' || !message.content.trim()) throw new Error('O modelo não produziu texto.');
    const tokens = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
    return { texto: message.content, modelo, tokensIn: tokens(body.usage?.prompt_tokens), tokensOut: tokens(body.usage?.completion_tokens) };
  }
}
