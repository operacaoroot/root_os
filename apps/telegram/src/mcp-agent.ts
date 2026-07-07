import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from './config.js';
import { ACTION_TOOLS, ACTION_TOOL_NAMES, parseAction, type ProposedAction } from './actions.js';

// Ponte IA ↔ MCP: a IA (OpenAI) recebe as TOOLS do MCP como function-calling e
// decide o que chamar; a execução passa pelo MCP → API (conta de serviço, RBAC).
// Isso valida o MCP como Hub consumido por qualquer IA.

const SYSTEM_PROMPT = `Você é o assistente do "Marketing OS" no Telegram.
Responda em português do Brasil, de forma curta e direta (é chat de celular).
Use SEMPRE as ferramentas de leitura para buscar dados reais — nunca invente números, datas
ou nomes. Se um dado não vier das ferramentas, diga que não tem a informação.
Para AÇÕES (mudar etapa de lead, concluir tarefa, pausar campanha), primeiro descubra o ID
pela ferramenta de leitura e então chame a ferramenta "propose_*" correspondente. Essas
ferramentas NÃO executam nada: elas registram uma proposta que o humano confirma no Telegram.
Depois de propor, explique em 1 frase o que será feito e diga que aguarda a confirmação —
NUNCA afirme que já foi feito.
Formate valores em reais como R$. Se a pergunta não for sobre o sistema, responda brevemente.`;

interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export class McpAgent {
  private client!: Client;
  private tools: OpenAiTool[] = [];

  async connect(): Promise<string[]> {
    const transport = new StdioClientTransport({
      command: process.execPath, // node
      args: [config.mcp.entry],
      env: {
        ...(process.env as Record<string, string>),
        MCP_API_URL: config.mcp.apiUrl,
        MCP_SERVICE_EMAIL: config.mcp.serviceEmail,
        MCP_SERVICE_PASSWORD: config.mcp.servicePassword,
      },
    });
    this.client = new Client({ name: 'mktos-telegram', version: '0.1.0' });
    await this.client.connect(transport);

    const { tools } = await this.client.listTools();
    this.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description ?? t.annotations?.title ?? t.name,
        parameters: normalizeSchema(t.inputSchema as Record<string, unknown> | undefined),
      },
    }));
    // + tools de AÇÃO (propostas; não executam — o bot pede confirmação humana)
    this.tools.push(...ACTION_TOOLS);
    return tools.map((t) => t.name);
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  /** Pergunta → resposta final + (opcional) uma AÇÃO proposta aguardando confirmação. */
  async ask(question: string, maxSteps = 5): Promise<{ text: string; action?: ProposedAction }> {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: question },
    ];
    let pending: ProposedAction | undefined;

    for (let step = 0; step < maxSteps; step++) {
      const msg = await this.chat(messages);
      messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const text = (msg.content ?? '').trim() || (pending ? 'Confirma a ação abaixo?' : 'Não consegui gerar uma resposta.');
        return { text, action: pending };
      }

      for (const tc of msg.tool_calls) {
        let resultText: string;
        try {
          const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          if (ACTION_TOOL_NAMES.has(tc.function.name)) {
            // AÇÃO: não executa — registra a proposta (a 1ª) e pede confirmação.
            if (!pending) pending = parseAction(tc.function.name, args);
            resultText = 'Proposta registrada. Explique ao usuário e peça CONFIRMAÇÃO — não afirme que já foi feito.';
          } else {
            const res = await this.client.callTool({ name: tc.function.name, arguments: args });
            resultText = extractText(res);
          }
        } catch (e) {
          resultText = `Erro em ${tc.function.name}: ${(e as Error).message}`;
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: resultText });
      }
    }
    return { text: 'Não consegui concluir (muitas etapas). Tente reformular.', action: pending };
  }

  private async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    const res = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.openai.model,
        temperature: 0.2,
        messages,
        tools: this.tools,
        tool_choice: 'auto',
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: ChatMessage }> };
    const message = json.choices?.[0]?.message;
    if (!message) throw new Error('OpenAI não retornou mensagem.');
    return message;
  }
}

function extractText(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
  const text = content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n');
  return text || '(sem conteúdo)';
}

// OpenAI exige parameters como JSON Schema de objeto. Normaliza o inputSchema do MCP.
function normalizeSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const s = { ...schema };
  delete (s as Record<string, unknown>)['$schema'];
  if (s.type !== 'object') return { type: 'object', properties: (s.properties as object) ?? {} };
  if (!s.properties) s.properties = {};
  return s;
}
