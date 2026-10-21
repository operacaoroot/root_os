import politicaBase from '@mktos/policy/politica-root.json';
import politicaDelta from '@mktos/policy/politica-marketing-os.json';

import { PrefixoNaoDeclaradoError, moduloDaCapacidade } from '../../tenants/modulos';

/*
 * AS CAPACIDADES QUE UMA EMPRESA ALCANÇA (rodada dos agentes, 21/10/2026, A1).
 *
 * O cadastro único declara UMA lista de capacidades por função. Até aqui o
 * assistente existia em dois lugares para servir duas empresas diferentes: a da
 * casa (com financeiro, leads, tarefas) e a recém-nascida pela entrada (sem
 * módulo nenhum), e a segunda lista era só a primeira menos o que a empresa nova
 * não alcança. Agora a diferença é um FILTRO, a mesma regra que a tela da Régua
 * usa (`catalogoVisivel`, `tenants/modulos.ts`): fica a capacidade cuja rota é
 * de um módulo ligado, ou da espinha, ou não tem rota.
 *
 * Declarar a capacidade de um módulo não contratado faria o agente propor
 * ferramenta que a porta recusa e a tela não mostra: ruído no lugar de alcance.
 * Quando a empresa contratar o módulo, a próxima semente acrescenta a capacidade.
 */

interface CapacidadeComRota {
  id: string;
  rota?: string | null;
}

/** A rota de cada capacidade: o delta do produto vence a base, como na política carregada. */
const ROTA_DA_CAPACIDADE: ReadonlyMap<string, string | null> = new Map(
  [
    ...((politicaBase as { capacidades: CapacidadeComRota[] }).capacidades ?? []),
    ...((politicaDelta as { capacidades: CapacidadeComRota[] }).capacidades ?? []),
  ].map((c) => [c.id, c.rota ?? null]),
);

/**
 * As capacidades da lista que esta empresa alcança com os módulos ligados.
 * Capacidade fora do catálogo FICA (quem recusa capacidade desconhecida é a
 * porta, e o teste do cadastro já garante que toda capacidade citada existe);
 * prefixo de rota não declarado também fica, pelo mesmo motivo do
 * `catalogoVisivel`: sumir com a capacidade por uma linha esquecida esconderia o
 * defeito em vez de mostrá-lo.
 */
export function capacidadesDaEmpresa(capacidades: readonly string[], modulosLigados: Iterable<string>): string[] {
  const ligados = new Set(modulosLigados);
  return capacidades.filter((id) => {
    if (!ROTA_DA_CAPACIDADE.has(id)) return true;
    try {
      const modulo = moduloDaCapacidade(ROTA_DA_CAPACIDADE.get(id));
      return modulo === null || ligados.has(modulo);
    } catch (e) {
      if (e instanceof PrefixoNaoDeclaradoError) return true;
      throw e;
    }
  });
}
