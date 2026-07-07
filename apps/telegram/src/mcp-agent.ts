import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { config } from './config.js';

// Ponte IA ↔ MCP: a IA (OpenAI) recebe as TOOLS do MCP como function-calling e
// decide o que chamar; a execução passa pelo MCP → API (conta de serviço, RBAC).
// Isso valida o MCP como Hub consumido por qualquer IA.

const SYSTEM_PROMPT = `Você é o assistente do "Marketing OS" no Telegram.
Responda em português do Brasil, de forma curta e direta (é chat de celular).
Use SEMPRE as ferramentas disponíveis para buscar dados reais do sistema — nunca invente
números, datas ou nomes. Se um dado não vier das ferramentas, diga que não tem a informação.
Formate valores em reais como R$ e use no máximo alguns bullets quando fizer sentido.
Se a pergunta não for sobre marketing/vendas/o sistema, responda brevemente que é o
assistente do Marketing OS.`;

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
    return tools.map((t) => t.name);
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  /** Recebe uma pergunta e devolve a resposta final (após rodar as tools que a IA pedir). */
  async ask(question: string, maxSteps = 5): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: question },
    ];

    for (let step = 0; step < maxSteps; step++) {
      const msg = await this.chat(messages);
      messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return (msg.content ?? '').trim() || 'Não consegui gerar uma resposta.';
      }

      for (const tc of msg.tool_calls) {
        let resultText: string;
        try {
          const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          const res = await this.client.callTool({ name: tc.function.name, arguments: args });
          resultText = extractText(res);
        } catch (e) {
          resultText = `Erro ao executar ${tc.function.name}: ${(e as Error).message}`;
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: resultText });
      }
    }
    return 'Não consegui concluir (muitas etapas de ferramenta). Tente reformular.';
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
