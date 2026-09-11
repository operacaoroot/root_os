import { ErroDaApi } from '@/lib/api';

/*
 * "ESSA ROTA AINDA NÃO EXISTE" — a pergunta pela CAUSA, não pelo código.
 *
 * Duas telas rodaram com desvio durante uma onda porque
 * `apps/api/src/agents/agents.controller.ts` não pôde ser tocado (fatia 5.2
 * tinha o arquivo vetado): `GET /organograma` e `PUT /agents/:slug/sop` existiam
 * no serviço e não tinham rota. **As duas estão no ar desde a estabilização da
 * onda 9**, e esta função virou rede de segurança: ela só fala quando a rota
 * some de novo.
 *
 * A primeira versão reconhecia isso por `status === 404`. Isso MENTE agora que
 * as rotas existem: `GET /organograma` de uma empresa sem nada, ou
 * `PUT /agents/:slug/sop` num slug apagado em outra aba, também respondem 404 —
 * e a tela diria "a rota não está ligada", mandando quem lê procurar um
 * problema que não existe. Foi por isso que a distinção passou a ser pela
 * CAUSA — e é por isso que ela continua valendo a pena com as rotas no ar.
 *
 * O que distingue a causa é QUEM respondeu. Quando nenhum handler casa, é o
 * roteador do Nest que responde, e a frase dele é sempre `Cannot <MÉTODO> <caminho>`.
 * Uma `NotFoundException` de dentro de um controller traz a frase do domínio
 * ("agente \"x\" não existe"). Então é a frase — o efeito da ausência de rota —
 * que responde, e não o número.
 *
 * Mora em `app/agentes/` porque as duas pastas de tela desta fatia são as
 * únicas que a correção podia escrever; `src/lib/api.ts` é de outro dono. Se um
 * dia isto for útil a uma terceira tela, o lugar dele é lá.
 */
export function rotaNaoExiste(e: unknown, metodo: string, caminho: string): boolean {
  if (!(e instanceof ErroDaApi) || e.status !== 404) return false;
  const dito = e.message.trim().toLowerCase();
  // `includes` e não igualdade: o caminho pode chegar com o prefixo do proxy
  // (`/api/...`) ou com barra final, e nenhum dos dois muda a causa.
  return dito.startsWith(`cannot ${metodo.toLowerCase()} `) && dito.includes(caminho.toLowerCase());
}
