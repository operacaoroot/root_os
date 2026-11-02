// As ferramentas que alcançam QUALQUER rota da API: busca no inventário, chamada genérica, envio e download de arquivo.
// A lista é fechada (rotas.gen.ts): o modelo não inventa rota. Leitura pelo leitor (operador, senão serviço); escrita só
// pelo operador. A régua, o RBAC e a auditoria continuam na API.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { leitor, operador } from '../client.js';
import { GERADO_EM } from '../rotas.gen.js';
import { METODOS, acharRota, alcancavel, buscarRotas, devolveArquivo, normalizarRota, recebeArquivo, soGente, totalDeRotas, type Metodo } from '../rotas.js';
import { DESTROI, ESCREVE, LE, fail, ok } from './base.js';

const MARCAS: Record<string, string> = { g: 'só gente (operador)', u: 'recebe arquivo', a: 'devolve arquivo', s: 'escrita sensível: vira aprovação', pub: 'sem sessão' };
const resumoDaRota = (r: { m: string; r: string; p: string[]; f: string[]; d: string }) => ({
  metodo: r.m, rota: r.r, permissoes: r.p, marcas: r.f.map((x) => MARCAS[x] ?? x), oQueFaz: r.d || null,
});

/** Separa o caminho (para casar com o inventário) da query string (que segue na chamada). */
function caminhoEQuery(rota: string): { padrao: string; chamada: string } {
  const [bruto, ...resto] = rota.trim().split('?');
  const normal = normalizarRota(bruto);
  const query = resto.join('?');
  return { padrao: normal, chamada: normal.replace(/^\/api/, '') + (query ? `?${query}` : '') };
}

function pastaDeArquivos(): string {
  const pasta = process.env.MCP_PASTA_DE_ARQUIVOS ?? join(homedir(), 'root-os-mcp', 'baixados');
  mkdirSync(pasta, { recursive: true });
  return pasta;
}

export function registrarGenericas(server: McpServer): void {
  server.registerTool(
    'os_rotas',
    {
      description:
        `Pesquisa o inventário das rotas da API do ROOT OS (gerado em ${GERADO_EM} a partir do código) por palavras: devolve método, rota, permissão, marcas e o que a rota faz. Use para achar a rota certa antes de os_api quando não há ferramenta curada. [leitura]`,
      inputSchema: {
        busca: z.string().min(1).describe('Palavras (todas precisam aparecer na rota, no comentário ou na permissão), ex.: "tarefa mover", "contrato encerrar"'),
        metodo: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().describe('Só este método'),
        modulo: z.string().optional().describe('Só este módulo (primeiro trecho da rota): comercial, trabalho, pauta, finance, whatsapp, memoria, agents, rotinas, tenants...'),
        limite: z.number().int().min(1).max(100).optional().describe('Padrão 30'),
      },
      annotations: { title: 'OS: pesquisar rotas da API', ...LE },
    },
    async ({ busca, metodo, modulo, limite }) => {
      try {
        const achadas = buscarRotas(busca, { metodo, modulo, limite });
        return ok({ inventario: { ...totalDeRotas(), geradoEm: GERADO_EM }, encontradas: achadas.length, rotas: achadas.map(resumoDaRota) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'os_api',
    {
      description:
        'Chama QUALQUER rota da API do ROOT OS que esteja no inventário (os_rotas), com ids no lugar dos :parâmetros e a query string na própria rota. Leitura pelo operador (ou pela conta de serviço, sem operador); escrita sempre em nome do operador. A régua do OS vale igual: o que é R3/R4 cai em Aprovações. DELETE exige confirmar=true. Rota pública, de login, de upload ou que devolve arquivo é recusada (há ferramenta própria). [operador, write]',
      inputSchema: {
        metodo: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        rota: z.string().min(1).describe('Ex.: /comercial/lead/<id>/fio ou /api/trabalho/tarefas?listId=<id>'),
        corpo: z.record(z.unknown()).optional().describe('O JSON do corpo, nas escritas'),
        confirmar: z.boolean().optional().describe('Obrigatório true em DELETE'),
      },
      annotations: { title: 'OS: chamar rota da API', ...ESCREVE },
    },
    async ({ metodo, rota, corpo, confirmar }) => {
      try {
        if (!METODOS.includes(metodo as Metodo)) throw new Error(`método inválido: ${metodo}`);
        const { padrao, chamada } = caminhoEQuery(rota);
        const r = acharRota(metodo, padrao);
        if (!r) {
          const parecidas = buscarRotas(padrao.split('/').filter((s) => s && s !== 'api' && !/^[0-9a-f-]{8,}$/i.test(s)).slice(-2).join(' '), { limite: 8 });
          throw new Error(`a rota ${metodo} ${padrao} não está no inventário da API. Parecidas: ${parecidas.map((x) => `${x.m} ${x.r}`).join(' · ') || 'nenhuma'}. Use os_rotas.`);
        }
        if (!alcancavel(r)) throw new Error(`a rota ${r.m} ${r.r} é pública ou de login: fica fora do MCP.`);
        if (recebeArquivo(r)) throw new Error(`a rota ${r.m} ${r.r} recebe arquivo: use os_enviar_arquivo.`);
        if (metodo === 'GET' && devolveArquivo(r)) throw new Error(`a rota ${r.r} devolve arquivo: use os_baixar_arquivo.`);
        if (metodo === 'DELETE' && confirmar !== true) throw new Error(`DELETE ${r.r} exige confirmar: true.`);
        const cliente = metodo === 'GET' ? leitor() : operador();
        const resultado = await cliente.chamar(metodo as Metodo, chamada, corpo);
        return ok({ rota: `${r.m} ${r.r}`, permissoes: r.p, soGente: soGente(r), resultado });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'os_enviar_arquivo',
    {
      description:
        'Envia um arquivo local a uma rota de upload da API (multipart): PDF do contrato, anexo de tarefa, foto de perfil, thumb, mídia do WhatsApp. O campo do arquivo é `file` salvo indicação; campos de texto extras vão em `campos` (ex.: `dados` com o JSON em string, no registrar cliente fechado fora). Em nome do operador. [operador, write]',
      inputSchema: {
        rota: z.string().min(1).describe('Rota POST de upload, com os ids no lugar'),
        caminho_local: z.string().min(1).describe('Caminho do arquivo neste computador'),
        campo: z.string().optional().describe('Nome do campo do arquivo (padrão file)'),
        campos: z.record(z.string()).optional().describe('Outros campos do formulário, como texto'),
      },
      annotations: { title: 'OS: enviar arquivo', ...ESCREVE },
    },
    async ({ rota, caminho_local, campo, campos }) => {
      try {
        const { padrao, chamada } = caminhoEQuery(rota);
        const r = acharRota('POST', padrao);
        if (!r) throw new Error(`a rota POST ${padrao} não está no inventário. Use os_rotas.`);
        if (!alcancavel(r)) throw new Error(`a rota ${r.r} é pública: fica fora do MCP.`);
        if (!recebeArquivo(r)) throw new Error(`a rota ${r.r} não recebe arquivo (use os_api).`);
        const caminho = resolve(caminho_local);
        if (!existsSync(caminho)) throw new Error(`arquivo não encontrado: ${caminho}`);
        const resultado = await operador().enviarArquivo(chamada, { caminho, campo, campos });
        return ok({ rota: `${r.m} ${r.r}`, arquivo: basename(caminho), resultado });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'os_baixar_arquivo',
    {
      description:
        'Baixa o arquivo que uma rota GET devolve (PDF do contrato anexado, anexo de tarefa, foto, mídia) e grava neste computador. Sem `destino`, vai para ~/root-os-mcp/baixados (ou MCP_PASTA_DE_ARQUIVOS). Devolve o caminho gravado. [leitura]',
      inputSchema: {
        rota: z.string().min(1).describe('Rota GET que devolve arquivo, com os ids no lugar'),
        destino: z.string().optional().describe('Caminho completo onde gravar (opcional)'),
      },
      annotations: { title: 'OS: baixar arquivo', ...LE },
    },
    async ({ rota, destino }) => {
      try {
        const { padrao, chamada } = caminhoEQuery(rota);
        const r = acharRota('GET', padrao);
        if (!r) throw new Error(`a rota GET ${padrao} não está no inventário. Use os_rotas.`);
        if (!alcancavel(r)) throw new Error(`a rota ${r.r} é pública: fica fora do MCP.`);
        const baixado = await leitor().baixar(chamada);
        const nome = baixado.nome ?? `${padrao.split('/').filter(Boolean).slice(-2).join('-')}`;
        const caminho = destino ? (isAbsolute(destino) ? destino : resolve(destino)) : join(pastaDeArquivos(), `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${nome.replace(/[^\w.\-]+/g, '_')}`);
        mkdirSync(dirname(caminho), { recursive: true });
        writeFileSync(caminho, baixado.bytes);
        return ok({ rota: `${r.m} ${r.r}`, caminho, bytes: baixado.bytes.length, tipo: baixado.tipo });
      } catch (e) {
        return fail(e);
      }
    },
  );

  // DELETE genérico tem anotação própria para o cliente MCP saber que destrói; `os_api` já cobre o verbo, então
  // esta anotação vale como aviso no catálogo e não como ferramenta separada.
  void DESTROI;
}
