import { Injectable } from '@nestjs/common';
import { FalhaSinteseLocal, ecoDoInvolucro, fimObservado, tokenObservado, type FimSinteseLocal, type ObservacaoLocal } from './sintese-local';

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
  finishReason?: FimSinteseLocal;
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
    const body = await r.json() as { model?: unknown; choices?: { message?: { content?: unknown; tool_calls?: unknown[] }; finish_reason?: unknown }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
    const choice = body.choices?.[0];
    const message = choice?.message;
    const finishReason = fimObservado(choice?.finish_reason);
    const observado: ObservacaoLocal = {
      modelo: body.model === modelo ? modelo : null,
      tokensIn: tokenObservado(body.usage?.prompt_tokens), tokensOut: tokenObservado(body.usage?.completion_tokens), finishReason,
    };
    if (message?.tool_calls?.length) throw new FalhaSinteseLocal('ferramenta_solicitada', observado);
    if (body.model !== modelo) throw new FalhaSinteseLocal('modelo_divergente', observado);
    if (finishReason !== 'stop') throw new FalhaSinteseLocal(finishReason === 'length' ? 'fim_incompleto' : 'fim_nao_confirmado', observado);
    if (typeof message?.content !== 'string' || !message.content.trim()) throw new FalhaSinteseLocal('texto_ausente', observado);
    if (ecoDoInvolucro(message.content)) throw new FalhaSinteseLocal('eco_do_involucro', observado);
    return { texto: message.content, modelo, tokensIn: observado.tokensIn, tokensOut: observado.tokensOut, finishReason };
  }
}
