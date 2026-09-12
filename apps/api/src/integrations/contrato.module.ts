import { Global, Module } from '@nestjs/common';
import { RegistroDeConectores } from './conectores.registry';

/**
 * O registro do contrato de conector, visível a todo módulo — RF-X-01.
 *
 * ----------------------------------------------------------------------------
 * POR QUE UM MÓDULO PRÓPRIO, E POR QUE `@Global`
 * ----------------------------------------------------------------------------
 * Quem se inscreve no contrato são os conectores, e eles moram em quatro pastas
 * diferentes: `google/`, `meta/`, `obsidian/`, `integrations/` e `pauta/`. Sem
 * `@Global`, cada um desses módulos precisaria importar o `IntegrationsModule` —
 * e três deles (`GoogleModule`, `MetaModule`, `ObsidianModule`) não o importam
 * hoje. Acrescentar essas três arestas ao grafo de módulos numa onda com quatro
 * agentes escrevendo ao mesmo tempo é colisão garantida, e arestas novas entre
 * módulos são exatamente o tipo de coisa que fecha ciclo sem ninguém perceber.
 *
 * A alternativa considerada foi marcar o `IntegrationsModule` inteiro como
 * `@Global`, e foi recusada: ele exporta `ClickupService` e `ConectoresService`,
 * e torná-los injetáveis em qualquer lugar amplia a superfície de um conector
 * sem necessidade nenhuma. Um módulo pequeno, com um provider só, dá a mesma
 * visibilidade sem carregar o resto junto.
 *
 * `@Global` NÃO REGISTRA NADA SOZINHO — é a pegadinha que já custou uma entrega
 * inteira nesta base (ver `cofre/cofre.module.ts`). Ele só diz que, uma vez
 * IMPORTADO, os `exports` ficam visíveis sem re-importação. Quem o importa é o
 * `IntegrationsModule`, que o `AppModule` já carrega — e é por isso que esta
 * fatia não precisou tocar em `app.module.ts`, que é arquivo de outra pessoa.
 *
 * NENHUM CONTROLADOR AQUI, de propósito: as rotas do contrato pertencem ao
 * módulo que já tem a tela de Conexões (`integrations/`), que é quem sabe casar
 * a resposta do contrato com o catálogo e com o desligamento por empresa.
 */
@Global()
@Module({
  providers: [RegistroDeConectores],
  exports: [RegistroDeConectores],
})
export class ContratoDeConectorModule {}
