import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { corpoExecutar, corpoGet, exigirTokenDoCorpo } from './client.js';
import {
  corpoDaExecucao,
  formaDaFerramenta,
  lerOrigem,
  montarLeitura,
  nomeDaDefinicao,
} from './esquema-do-catalogo.js';

/*
 * ============================================================================
 * O MCP GERADO DO CATÁLOGO (A3, 30/10/2026) — `MCP_MODO=catalogo`
 * ============================================================================
 *
 * O modo de sempre (`server.ts`) tem 35 ferramentas escritas à mão, só leitura,
 * com a conta de serviço. Este modo não escreve ferramenta nenhuma: no arranque
 * ele pergunta à API o catálogo do agente do token (`GET /agents/:slug/
 * catalogo-externo`) e registra UMA ferramenta por capacidade declarada:
 *
 *   · nome = o id da capacidade (`operacao.tarefa.criar`);
 *   · esquema = o `argsSchema` que a porta valida, convertido;
 *   · leitura (R0 com rota GET) → o GET de sempre, com o token do corpo;
 *   · o resto → a rota de execução do agente (A2), que passa pela porta e
 *     devolve o desfecho: executado, aguardando aprovação (com o bilhete) ou
 *     recusado (com o motivo). O desfecho volta inteiro para o modelo.
 *
 * Mais UMA ferramenta e UM recurso fora do catálogo: `<slug>_definicao`
 * (`rootinha_definicao`), com missão, procedimento e voz do agente, lidos da
 * API — a tela de Agentes continua sendo onde se muda o procedimento.
 *
 * A ORIGEM DO PEDIDO não vai nos argumentos (o esquema é o da porta, e campo a
 * mais seria recusado): vai no `_meta` da chamada, em `root/origem` — a
 * mensagem de WhatsApp de onde veio, quem pediu, se é texto de terceiro.
 */

interface Ferramenta {
  id: string;
  descricao: string;
  nivel: string;
  argsSchema: Record<string, unknown> | null;
  caminho: 'leitura' | 'execucao';
  rota: string;
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function falha(e: unknown) {
  return { content: [{ type: 'text' as const, text: `Erro: ${(e as Error).message}` }], isError: true };
}

export async function buildServerDoCatalogo(): Promise<McpServer> {
  exigirTokenDoCorpo();
  const slug = (process.env.MCP_AGENTE ?? 'rootinha').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`MCP_AGENTE="${slug}" não é slug de agente.`);

  const catalogo = await corpoGet<{ agente: string; estado: string; ferramentas: Ferramenta[]; semEfeito: string[] }>(
    `/agents/${slug}/catalogo-externo`,
  );
  const server = new McpServer({ name: `root-os-${slug}`, version: '0.2.0' });

  for (const f of catalogo.ferramentas) {
    const leitura = f.caminho === 'leitura';
    server.registerTool(
      f.id,
      {
        description: `${f.descricao} [${f.nivel}${leitura ? ', leitura' : ', pela porta'}]`,
        inputSchema: formaDaFerramenta(f.argsSchema, f.rota, leitura),
        annotations: {
          title: f.id,
          readOnlyHint: leitura || f.nivel === 'R0',
          // R3 para cima sai da casa e fica retido; o modelo precisa saber que pode não sair agora.
          destructiveHint: false,
          openWorldHint: ['R3', 'R4', 'R5'].includes(f.nivel),
        },
      },
      async (args: Record<string, unknown>, extra: { _meta?: unknown }) => {
        try {
          if (leitura) return ok(await corpoGet(montarLeitura(f.rota, args ?? {})));
          return ok(await corpoExecutar(slug, f.id, corpoDaExecucao(args ?? {}, lerOrigem(extra?._meta))));
        } catch (e) {
          return falha(e);
        }
      },
    );
  }

  const lerDefinicao = () => corpoGet(`/agents/${slug}/definicao`);
  server.registerTool(
    nomeDaDefinicao(slug),
    {
      description: `Missão, procedimento e voz do agente ${slug}, como estão no ROOT OS agora. Leia antes de agir. [leitura]`,
      inputSchema: {},
      annotations: { title: `Definição de ${slug}`, readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await lerDefinicao());
      } catch (e) {
        return falha(e);
      }
    },
  );
  server.registerResource(
    nomeDaDefinicao(slug),
    `rootos://agentes/${slug}/definicao`,
    { title: `Definição de ${slug}`, description: 'Missão, procedimento e voz do agente.', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await lerDefinicao(), null, 2) }] }),
  );

  console.error(
    `[marketing-os-mcp] modo catálogo: ${catalogo.ferramentas.length} ferramenta(s) de ${slug} (estado ${catalogo.estado})` +
      (catalogo.semEfeito.length ? `; declaradas sem efeito ligado, fora do MCP: ${catalogo.semEfeito.join(', ')}` : ''),
  );
  return server;
}
