import { createHash } from 'node:crypto';
import { z } from 'zod';

/*
 * ============================================================================
 * OS ARGUMENTOS DAS CAPACIDADES DA CENTRAL (política 1.13.0, 30/10/2026)
 * ============================================================================
 *
 * A porta já valida cada pedido contra o `argsSchema` do catálogo ANTES de
 * classificar — e é ali que o modelo aprende o nome certo do campo. Por que
 * validar de novo aqui? Porque o validador da porta (`gateway/validacao.ts`)
 * confere tipo, obrigatório, enum, `minLength` e `pattern`, e NÃO confere
 * `maxLength` nem `maxItems` de objeto aninhado com o rigor de um esquema de
 * verdade. O catálogo diz "título até 300", e sem esta segunda conferência um
 * título de 50 mil caracteres passaria pela porta e chegaria ao banco.
 *
 * O que vale é o catálogo: estes esquemas são a MESMA forma, escrita em zod, e o
 * teste `test/agentes-externos-efeitos.test.ts` confere que os campos batem um a
 * um com o `argsSchema` da política. Divergiu, o teste fica vermelho.
 *
 * Arquivo PURO de propósito (sem Nest, sem banco): roda sob vitest sem levantar
 * a aplicação.
 */

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export const TarefaCriarArgs = z
  .object({
    titulo: z.string().trim().min(1).max(300),
    area: z.string().trim().min(1).max(120).optional(),
    pessoa: z.string().trim().min(1).max(120).optional(),
    prazo: z.string().regex(DIA).optional(),
    clienteId: z.string().uuid().optional(),
    confirmar: z.boolean().optional(),
  })
  .strict();

export const TarefaComentarArgs = z
  .object({
    tarefaId: z.string().uuid(),
    texto: z.string().trim().min(1).max(4000),
  })
  .strict();

export const PendenciaListarArgs = z
  .object({
    estado: z.enum(['aberta', 'resolvida', 'descartada']).optional(),
    de: z.enum(['minhas', 'todas']).optional(),
  })
  .strict();

export const PendenciaCriarArgs = z
  .object({
    titulo: z.string().trim().min(1).max(300),
    contexto: z.string().max(4000).optional(),
    para: z.string().trim().min(1).max(120).optional(),
    opcoes: z
      .array(
        z
          .object({
            chave: z.string().regex(/^[a-z0-9_-]{1,40}$/),
            rotulo: z.string().trim().min(1).max(80),
          })
          .strict(),
      )
      .min(1)
      .max(6)
      .optional(),
    chave: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,80}$/).optional(),
  })
  .strict();

export const AprovacaoListarArgs = z
  .object({
    status: z.enum(['pendente', 'confirmada', 'consumida', 'rejeitada', 'expirada']).optional(),
  })
  .strict();

export const AgenteInvocarArgs = z
  .object({
    agente: z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    nota: z.string().trim().max(300).optional(),
  })
  .strict();

export const BriefingLerArgs = z.object({}).strict();

export const MemoriaSugerirArgs = z
  .object({
    titulo: z.string().trim().min(1).max(400),
    corpo: z.string().min(1).max(20000),
    chave: z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,120}$/).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    motivo: z.string().max(2000).optional(),
  })
  .strict();

export const ConversaResponderArgs = z
  .object({
    mensagemId: z.string().regex(/^[A-Za-z0-9_:.-]{1,200}$/),
    texto: z.string().trim().min(1).max(4000),
  })
  .strict();

/** Os esquemas por capacidade — é este mapa que o teste cruza com o catálogo. */
export const ARGUMENTOS_DA_CENTRAL: Readonly<Record<string, z.ZodObject<z.ZodRawShape>>> = {
  'operacao.tarefa.criar': TarefaCriarArgs,
  'operacao.tarefa.comentar': TarefaComentarArgs,
  'caixa.pendencia.listar': PendenciaListarArgs,
  'caixa.pendencia.criar': PendenciaCriarArgs,
  'aprovacao.listar': AprovacaoListarArgs,
  'agente.invocar': AgenteInvocarArgs,
  'briefing.ler': BriefingLerArgs,
  'contexto.memoria.sugerir': MemoriaSugerirArgs,
  'whatsapp.conversa.responder': ConversaResponderArgs,
};

/**
 * Lê os argumentos de uma capacidade da central ou LANÇA com a frase do campo.
 * O efeito lança e a porta transforma em `erro` com a mensagem: nada é escrito.
 */
export function lerArgumentos<T extends z.ZodTypeAny>(esquema: T, args: unknown, capacidade: string): z.infer<T> {
  const r = esquema.safeParse(args ?? {});
  if (r.success) return r.data;
  const problemas = r.error.issues
    .map((i) => `${i.path.join('.') || '(argumentos)'}: ${i.message}`)
    .join('; ');
  throw new Error(`argumentos inválidos para ${capacidade}: ${problemas}. Nada foi feito.`);
}

/* ========================================================================== *
 * A SUGESTÃO DE MEMÓRIA
 * ========================================================================== */

/** O tipo da pendência que leva a sugestão até uma pessoa. */
export const TIPO_DA_SUGESTAO_DE_MEMORIA = 'memoria.sugestao';
/** As duas respostas, e só elas. */
export const GRAVAR_NA_MEMORIA = 'gravar';
export const NAO_GRAVAR = 'descartar';

/**
 * TODA NOTA SUGERIDA NASCE SOB `sugestao/`, e é a trava que importa.
 *
 * A memória tem chaves com dono: a voz do autor (`voz.pedro`), a marca, a
 * grade, o brandbook, as notas projetadas da vault (`vault:`). Um agente que
 * escolhesse a chave livremente proporia, sem querer ou de propósito, escrever
 * em cima de uma delas — e quem clica "Gravar" lê o TEXTO, não confere chave.
 * Com o prefixo fixo, a sugestão só cria nota NOVA num canto que ninguém mais
 * usa; a criação recusa chave repetida, então também não sobrescreve outra
 * sugestão.
 */
export function chaveDaSugestao(titulo: string, chave: string | undefined, semente: string): string {
  const base = (chave ?? '')
    .replace(/^sugestao\//, '')
    .trim();
  if (base) return `sugestao/${base}`;
  const pedaco = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const curto = createHash('sha256').update(`${semente}|${titulo}`).digest('hex').slice(0, 8);
  return `sugestao/${pedaco || 'nota'}-${curto}`;
}

/** A chave de idempotência da pendência: o mesmo pedido cai na mesma linha. */
export function chaveDaPendencia(prefixo: string, partes: readonly unknown[]): string {
  const h = createHash('sha256').update(JSON.stringify(partes)).digest('hex').slice(0, 24);
  return `${prefixo}:${h}`;
}

/* ========================================================================== *
 * RESPONDER NA MESMA CONVERSA
 * ========================================================================== */

/**
 * Até quando a resposta vale depois da mensagem que pediu. 24 horas, e o
 * motivo é a aprovação: a resposta é R3, fica retida, e a pessoa que aprova
 * pode demorar. Passado isso, "responder na mesma conversa" já é começar uma
 * conversa nova — e aí a capacidade certa é outra.
 */
export const JANELA_DA_RESPOSTA_MS = 24 * 60 * 60 * 1000;

/** A mensagem que pediu ainda pode receber resposta agora? */
export function dentroDaJanela(mensagemEm: Date, agora: Date = new Date()): boolean {
  const idade = agora.getTime() - mensagemEm.getTime();
  return idade >= -5 * 60 * 1000 && idade <= JANELA_DA_RESPOSTA_MS;
}

/* ========================================================================== *
 * INVOCAR OUTRO AGENTE
 * ========================================================================== */

/**
 * A recusa de `agente.invocar`, ou `null` quando pode. Pura: quem chama lê o
 * agente alvo no banco e entrega o que importa aqui.
 *
 *  · nunca o próprio — um agente que se acorda é um laço sem fim pago a modelo;
 *  · nunca um agente que TAMBÉM invoca agente — A chama B, B chama A: o mesmo
 *    laço com um passo a mais;
 *  · só agente de verdade (`llm`): rotina e conector não têm passagem de modelo.
 */
export function recusaDaInvocacao(
  quemPede: string | null | undefined,
  alvo: { slug: string; tipo: string; capacidades: readonly string[] } | null,
): string | null {
  if (!alvo) return 'esse agente não existe nesta empresa. Nada foi feito.';
  if (quemPede && alvo.slug === quemPede) return 'um agente não invoca a si mesmo. Nada foi feito.';
  if (alvo.capacidades.includes('agente.invocar')) {
    return `"${alvo.slug}" também invoca agentes, e um chamando o outro vira laço. Nada foi feito.`;
  }
  if (alvo.tipo !== 'llm') return `"${alvo.slug}" não é agente de modelo (é rotina ou conector). Nada foi feito.`;
  return null;
}
