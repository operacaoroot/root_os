import type { CapacidadeCatalogo } from '@mktos/policy';
import type { LlmToolSpec } from '../llm/llm.provider';
import type { ToolCallResult } from '../gateway/tool-gateway.service';

/*
 * Traduz entre o vocabulário da régua e o do modelo.
 *
 * O id da capacidade é pontuado (whatsapp.mensagem.enviar) porque é assim no
 * documento normativo. A API de tool-calling só aceita [A-Za-z0-9_-], então
 * cada capacidade carrega um `ferramenta` explícito. Não é transformação de
 * string: é um mapa, porque transformar não é reversível sem ambiguidade.
 */

export interface Ferramenta {
  spec: LlmToolSpec;
  capabilityId: string;
}

const SCHEMA_VAZIO = { type: 'object', properties: {}, additionalProperties: true };

/**
 * `normalizeSchema` veio do bot do Telegram (mcp-agent.ts): nem todo schema
 * declarado é um objeto, e a API recusa o que não for.
 */
function normalizarSchema(s: unknown): Record<string, unknown> {
  if (!s || typeof s !== 'object') return SCHEMA_VAZIO;
  const o = s as Record<string, unknown>;
  if (o.type !== 'object') return SCHEMA_VAZIO;
  return { ...o, type: 'object', properties: o.properties ?? {} };
}

export function paraFerramentas(caps: CapacidadeCatalogo[]): Ferramenta[] {
  return caps
    .filter((c): c is CapacidadeCatalogo & { ferramenta: string } => !!c.ferramenta)
    .map((c) => {
      const nome = c.ferramenta;
      const argsSchema = (c as { argsSchema?: unknown }).argsSchema;
      return {
        capabilityId: c.id,
        spec: {
          name: nome,
          // O nível entra na descrição como ORIENTAÇÃO, não decisão: reduz
          // proposta que a porta vai recusar, e isso é dinheiro economizado.
          // Quem decide continua sendo a régua, sempre.
          description: `${c.descricao} [${c.nivel}${c.nivel >= 'R2' ? ' · pode exigir aprovação humana' : ''}]`,
          inputSchema: normalizarSchema(argsSchema),
        },
      };
    });
}

/**
 * O que o modelo LÊ depois de a porta decidir.
 *
 * A frase da retenção vem do bot ("não afirme que já foi feito") e muda de
 * dono aqui: sai de um `if` no cliente e passa a valer para QUALQUER
 * capacidade, não para as quatro que alguém lembrou de listar.
 */
export function paraModelo(r: ToolCallResult): { content: string; isError: boolean } {
  switch (r.status) {
    case 'executado':
      return { content: JSON.stringify(r.resultado ?? null), isError: false };
    case 'aguardando_aprovacao':
      return {
        content:
          `Ação RETIDA: aguarda aprovação humana (ticket ${r.approvalId}, expira ${r.expiraEm}). ` +
          'Explique isso ao usuário em uma frase e NÃO afirme que foi feita.',
        isError: false,
      };
    case 'recusado':
      return {
        content:
          `RECUSADO pela régua: ${r.motivo}. ` +
          'Não tente outro caminho para o mesmo efeito; explique ao usuário o que falta.',
        isError: true,
      };
    case 'erro':
      return { content: `A ferramenta falhou: ${r.mensagem}`, isError: true };
  }
}

/** "trimestre 3 · 2026" — o que a tela do traço mostra, não o JSON cru. */
export function resumirArgs(args: Record<string, unknown>): string {
  const partes = Object.entries(args ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .slice(0, 4)
    .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40)}`);
  return partes.length ? partes.join(' · ') : 'sem argumento';
}

export function resumirResultado(r: ToolCallResult): string {
  if (r.status !== 'executado') return r.status.replace('_', ' ');
  const texto = typeof r.resultado === 'string' ? r.resultado : JSON.stringify(r.resultado ?? null);
  return texto.length > 120 ? texto.slice(0, 120) + '…' : texto;
}
