import {
  CADASTRO_DE_FUNCOES,
  MODELOS_DO_CADASTRO,
  escolherModelo,
  funcaoPorId,
  type EsforcoDaFuncao,
  type FuncaoDoCadastro,
} from '@mktos/shared';

import type { LlmEffort } from './llm.provider';

/**
 * A chave do conector "Claude (Anthropic)" em Conexões e no cofre (leva 5, L8,
 * 27/10/2026). Mora aqui, e não no conector, porque `usado-por.ts` e o cofre
 * precisam do nome sem importar o serviço que fala com a Anthropic.
 */
export const CONECTOR_ANTHROPIC = 'anthropic';

/** Os modelos que uma função do cadastro pode receber: a lista do shared, e só ela. */
export const MODELOS_PERMITIDOS: readonly string[] = MODELOS_DO_CADASTRO;

/*
 * O MODELO E O ESFORÇO DE UMA CHAMADA (rodada dos agentes, 21/10/2026, A1).
 *
 * Uma regra só, usada pelo provedor (que manda o pedido) e pelo envelope do teto
 * (que reserva o custo dele), para as duas contas nunca divergirem:
 *
 *   1. `model`/`effort` EXPLÍCITOS na chamada valem por cima de tudo (é como o
 *      laço do agente passa o que a tela de Agentes ajustou no registro);
 *   2. senão, a FUNÇÃO do cadastro único: `LLM_MODELO_<ID>`/`LLM_ESFORCO_<ID>`,
 *      depois o cadastro (`escolherModelo` do shared);
 *   3. senão, o padrão do provedor (`ANTHROPIC_MODEL`/`ANTHROPIC_EFFORT`).
 *
 * Cada metade cai sozinha: modelo explícito sem esforço explícito leva o esforço
 * da função (ou do padrão), e vice-versa.
 */

export interface PadraoDoProvedor {
  modelo: string;
  esforco: LlmEffort;
}

export interface ModeloDaChamada {
  modelo: string;
  esforco: LlmEffort;
  origem: 'explicito' | 'variavel' | 'cadastro' | 'padrao';
}

/*
 * AS LISTAS POR FUNÇÃO, PARA O CONTAINER. O container só enxerga a variável que
 * está no bloco `environment:` do compose, e pôr ali uma `LLM_MODELO_<ID>` por
 * função seriam dezenas de linhas. Então o compose passa DUAS variáveis:
 *
 *   LLM_MODELOS_POR_FUNCAO="CO-03=claude-sonnet-5-5,IM-02=claude-opus-5-5"
 *   LLM_ESFORCOS_POR_FUNCAO="CO-11=medium"
 *
 * que viram `LLM_MODELO_CO_03`/`LLM_ESFORCO_CO_11` para `escolherModelo`. A
 * variável específica, quando existe no processo, vence a lista. Valor fora dos
 * modelos e esforços do cadastro é ignorado (é a regra do `escolherModelo`).
 */
export function ambienteDosModelos(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const extra: Record<string, string> = {};
  const ler = (lista: string | undefined, prefixo: string) => {
    for (const par of (lista ?? '').split(/[,;\s]+/)) {
      const [id, valor] = par.split('=').map((x) => x?.trim() ?? '');
      if (!id || !valor || !/^[A-Za-z]{2}-\d{2}$/.test(id)) continue;
      const chave = `${prefixo}${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
      if (!(env[chave] ?? '').trim()) extra[chave] = valor;
    }
  };
  ler(env.LLM_MODELOS_POR_FUNCAO, 'LLM_MODELO_');
  ler(env.LLM_ESFORCOS_POR_FUNCAO, 'LLM_ESFORCO_');
  return Object.keys(extra).length ? { ...env, ...extra } : env;
}

export function modeloDaChamada(
  input: { funcao?: string; model?: string; effort?: LlmEffort },
  padrao: PadraoDoProvedor,
  ambiente: Readonly<Record<string, string | undefined>> = process.env,
): ModeloDaChamada {
  const escolha = escolherModelo(
    input.funcao,
    { modelo: padrao.modelo, esforco: padrao.esforco as EsforcoDaFuncao },
    ambienteDosModelos(ambiente),
  );
  const model = input.model?.trim();
  const effort = input.effort;
  return {
    modelo: model || escolha.modelo,
    esforco: (effort ?? escolha.esforco) as LlmEffort,
    origem: model || effort ? 'explicito' : escolha.origem,
  };
}

/** Uma linha do bloco "Modelo por função" do cartão Claude (Anthropic), só leitura. */
export interface ModeloEmVigor {
  id: string;
  nome: string;
  area: string;
  tipo: FuncaoDoCadastro['tipo'];
  estado: FuncaoDoCadastro['estado'];
  modelo: string;
  esforco: EsforcoDaFuncao;
  origem: 'cadastro' | 'variavel' | 'padrao';
}

/**
 * O modelo e o esforço que CADA função do cadastro recebe hoje, pela mesma regra
 * de `modeloDaChamada` (variável por função > cadastro > padrão do provedor) e
 * com as mesmas listas do compose (`LLM_MODELOS_POR_FUNCAO`/`LLM_ESFORCOS_POR_FUNCAO`).
 * Só as funções com modelo da Anthropic entram: rotina, automação e modelo
 * externo não gastam o Claude. Função aposentada fica fora, como em todo cartão.
 * Só leitura: trocar continua sendo pelo ambiente da API, por decisão (L8).
 */
export function modelosPorFuncaoEmVigor(
  padrao: PadraoDoProvedor,
  ambiente: Readonly<Record<string, string | undefined>> = process.env,
  cadastro: readonly FuncaoDoCadastro[] = CADASTRO_DE_FUNCOES,
): ModeloEmVigor[] {
  const env = ambienteDosModelos(ambiente);
  return cadastro
    .filter((f) => !!f.modelo && f.estado !== 'aposentado')
    .map((f) => {
      const e = escolherModelo(f.id, { modelo: padrao.modelo, esforco: padrao.esforco as EsforcoDaFuncao }, env);
      return { id: f.id, nome: f.nome, area: f.area, tipo: f.tipo, estado: f.estado, modelo: e.modelo, esforco: e.esforco, origem: e.origem };
    });
}

/**
 * Em nome de quem o gasto é contado: o `agentSlug` informado, senão o slug da
 * função no cadastro. Vazio = gasto da empresa sem agente (o caso de sempre).
 */
export function slugDaChamada(input: { agentSlug?: string; funcao?: string }): string {
  return input.agentSlug?.trim() || (input.funcao ? funcaoPorId(input.funcao)?.slug ?? '' : '');
}

/*
 * O FALLBACK DE SERVIDOR POR MODELO (skill `claude-api`, 21/10/2026):
 *  · Opus 5.5, Opus 5, Sonnet 5.5 e Fable 5.1 aceitam `fallbacks: "default"`
 *    com o beta `server-side-fallback-2026-07-01` (o Sonnet 5.5 SÓ nessa forma);
 *  · o Haiku 5.5 NÃO tem fallback de servidor: com `"default"` a recusa fica
 *    recusa, e com lista de modelos é 400 — então o parâmetro não vai;
 *  · modelo fora desta lista também não leva (não se manda parâmetro que o
 *    modelo pode recusar com 400).
 */
const COM_FALLBACK_DE_SERVIDOR = ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1'];

/** O beta que liga a forma `"default"` do fallback. */
export const BETA_DO_FALLBACK = 'server-side-fallback-2026-07-01';

export function aceitaFallbackDeServidor(modelo: string): boolean {
  const base = modelo.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, '');
  return COM_FALLBACK_DE_SERVIDOR.includes(base);
}

/** A ferramenta de busca na web do servidor que cada modelo aceita. */
export function tipoDaBuscaNaWeb(modelo: string): 'web_search_20260209' | 'web_search_20250305' {
  // A variante com filtro dinâmico é de Opus 5.5/5/4.8/4.7/4.6 e Sonnet 5.5/5/4.6;
  // o resto (Haiku inclusive) fica com a básica.
  return /^claude-(opus-(5-5|5|4-8|4-7|4-6)|sonnet-(5-5|5|4-6))(?:-\d{8})?$/.test(modelo)
    ? 'web_search_20260209'
    : 'web_search_20250305';
}
