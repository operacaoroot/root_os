import { z } from 'zod';

/*
 * O MODO CATÁLOGO, a parte pura (A3, 30/10/2026): do `argsSchema` que a porta
 * valida para o esquema que o MCP anuncia, e dos argumentos de uma leitura para
 * o caminho e a consulta do GET.
 *
 * Sem SDK e sem rede aqui: é o pedaço que a suíte da API exercita direto.
 *
 * O ESQUEMA É O DA PORTA, convertido — não um segundo esquema escrito à mão. O
 * conversor cobre o subconjunto que o catálogo usa (objeto de propriedades com
 * string/enum/pattern/tamanho, número, booleano e lista) e cai em `unknown`
 * para o resto: o MCP anuncia algo mais frouxo, e a porta continua sendo quem
 * recusa. Errar para o lado frouxo aqui é seguro; para o lado apertado, o
 * modelo nunca conseguiria mandar um campo que a porta aceitaria.
 */

type Esquema = Record<string, unknown>;

function propriedade(p: Esquema | undefined): z.ZodTypeAny {
  if (!p || typeof p !== 'object') return z.unknown();
  const descricao = typeof p.description === 'string' ? p.description : undefined;
  let t: z.ZodTypeAny;
  if (Array.isArray(p.enum) && p.enum.length > 0 && p.enum.every((v) => typeof v === 'string')) {
    t = z.enum(p.enum as [string, ...string[]]);
  } else if (p.type === 'string') {
    let s = z.string();
    if (typeof p.minLength === 'number') s = s.min(p.minLength);
    if (typeof p.maxLength === 'number') s = s.max(p.maxLength);
    if (typeof p.pattern === 'string') {
      try {
        s = s.regex(new RegExp(p.pattern));
      } catch {
        // Padrão que o JavaScript não lê: a porta confere do jeito dela.
      }
    }
    t = s;
  } else if (p.type === 'integer' || p.type === 'number') {
    let n = p.type === 'integer' ? z.number().int() : z.number();
    if (typeof p.minimum === 'number') n = n.min(p.minimum);
    if (typeof p.maximum === 'number') n = n.max(p.maximum);
    t = n;
  } else if (p.type === 'boolean') {
    t = z.boolean();
  } else if (p.type === 'array') {
    const itens = p.items as Esquema | undefined;
    let a = z.array(itens?.type === 'object' ? z.object(formaDoObjeto(itens)) : propriedade(itens));
    if (typeof p.minItems === 'number') a = a.min(p.minItems);
    if (typeof p.maxItems === 'number') a = a.max(p.maxItems);
    t = a;
  } else if (p.type === 'object' && p.properties) {
    t = z.object(formaDoObjeto(p));
  } else {
    t = z.unknown();
  }
  return descricao ? t.describe(descricao) : t;
}

function formaDoObjeto(esquema: Esquema): z.ZodRawShape {
  const props = (esquema.properties ?? {}) as Record<string, Esquema>;
  const obrigatorios = new Set(Array.isArray(esquema.required) ? (esquema.required as string[]) : []);
  const forma: z.ZodRawShape = {};
  for (const [nome, p] of Object.entries(props)) {
    const t = propriedade(p);
    forma[nome] = obrigatorios.has(nome) ? t : t.optional();
  }
  return forma;
}

/** Os `:parametros` de uma rota do catálogo (`GET /leads/:id` → `['id']`). */
export function parametrosDaRota(rota: string): string[] {
  const caminho = rota.trim().split(/\s+/)[1] ?? '';
  return [...caminho.split('?')[0].matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

/**
 * O esquema que o MCP anuncia para uma capacidade. Com `argsSchema`, é ele. Sem
 * (as leituras antigas, como `crm.lead.ler` em `GET /leads/:id`), são os
 * parâmetros da rota, todos obrigatórios.
 */
export function formaDaFerramenta(argsSchema: Esquema | null, rota: string, leitura: boolean): z.ZodRawShape {
  const forma = argsSchema && argsSchema.type === 'object' ? formaDoObjeto(argsSchema) : {};
  if (leitura) {
    for (const p of parametrosDaRota(rota)) if (!(p in forma)) forma[p] = z.string().min(1).describe(`o ${p} da rota`);
  }
  return forma;
}

/**
 * Uma leitura: o caminho com os `:parametros` preenchidos (codificados) e o
 * resto dos argumentos na consulta. A consulta fixa da rota do catálogo
 * (`GET /tasks?overdue=1`) entra junto, e o argumento não a sobrescreve.
 */
export function montarLeitura(rota: string, args: Record<string, unknown>): string {
  const [, cru = ''] = rota.trim().split(/\s+/);
  const [caminhoCru, consultaFixa = ''] = cru.split('?');
  const usados = new Set<string>();
  const caminho = caminhoCru.replace(/:([A-Za-z0-9_]+)/g, (_m, nome: string) => {
    usados.add(nome);
    const v = args[nome];
    if (v === undefined || v === null || String(v) === '') throw new Error(`falta o argumento "${nome}" da rota`);
    return encodeURIComponent(String(v));
  });
  const consulta = new URLSearchParams(consultaFixa);
  for (const [k, v] of Object.entries(args)) {
    if (usados.has(k) || v === undefined || v === null || v === '' || consulta.has(k)) continue;
    consulta.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const q = consulta.toString();
  return q ? `${caminho}?${q}` : caminho;
}

/** `rootinha` → `rootinha_definicao`: o nome da ferramenta da definição do agente. */
export function nomeDaDefinicao(slug: string): string {
  return `${slug.replace(/[^a-z0-9]+/gi, '_')}_definicao`;
}

/**
 * A origem de um pedido, lida do `_meta` da chamada MCP (`root/origem`), e não
 * dos argumentos: o esquema da ferramenta é o da porta, e campo a mais lá seria
 * recusado. O corpo (o Hermes) põe ali de onde veio o pedido — a mensagem de
 * WhatsApp, quem pediu, se é texto de terceiro.
 */
export interface OrigemDoPedido {
  canal?: 'whatsapp' | 'mcp' | 'outro';
  mensagemId?: string;
  solicitanteId?: string;
  procedenciaExterna?: boolean;
  descricao?: string;
}

export function lerOrigem(meta: unknown): OrigemDoPedido {
  const m = meta && typeof meta === 'object' ? (meta as Record<string, unknown>)['root/origem'] : undefined;
  if (!m || typeof m !== 'object') return {};
  const o = m as Record<string, unknown>;
  const canal = o.canal === 'whatsapp' || o.canal === 'mcp' || o.canal === 'outro' ? o.canal : undefined;
  return {
    ...(canal ? { canal } : {}),
    ...(typeof o.mensagemId === 'string' ? { mensagemId: o.mensagemId } : {}),
    ...(typeof o.solicitanteId === 'string' ? { solicitanteId: o.solicitanteId } : {}),
    ...(o.procedenciaExterna === true ? { procedenciaExterna: true } : {}),
    ...(typeof o.descricao === 'string' ? { descricao: o.descricao.slice(0, 300) } : {}),
  };
}

/** O corpo do POST da rota de execução (A2), com a origem quando houver. */
export function corpoDaExecucao(args: Record<string, unknown>, origem: OrigemDoPedido): Record<string, unknown> {
  return {
    args,
    ...(origem.solicitanteId ? { solicitanteId: origem.solicitanteId } : {}),
    ...(origem.procedenciaExterna ? { procedenciaExterna: true } : {}),
    ...(origem.canal || origem.mensagemId
      ? {
          origem: {
            canal: origem.canal ?? 'mcp',
            ...(origem.mensagemId ? { mensagemId: origem.mensagemId } : {}),
            ...(origem.descricao ? { descricao: origem.descricao } : {}),
          },
        }
      : {}),
  };
}
