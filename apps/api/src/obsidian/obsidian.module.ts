import { Module, forwardRef } from '@nestjs/common';
import { ObsidianController } from './obsidian.controller';
import { ObsidianService } from './obsidian.service';
import { CatalogoDeColecaoService } from './catalogo-de-colecao.service';
import { CatalogoDeColecaoController } from './catalogo-de-colecao.controller';
import { ContextoMovimentoExplicitoService } from './contexto-movimento-explicito.service';
import { MemoryModule } from '../memory/memoria.module';
import { GoogleModule } from '../google/google.module';

/*
 * `MemoryModule` entra no `imports` porque `ObsidianService` projeta a vault na
 * MEMÓRIA a cada reindexação (fatia 4.1+4.2) e vetoriza as notas que ainda não
 * têm vetor — quem fala com o fornecedor de embedding é este conector, e a
 * memória recebe o vetor pronto.
 *
 * ELA NÃO É MAIS O QUE PÕE A MEMÓRIA DE PÉ: o dono é o `AppModule`, que importa
 * `MemoryModule` desde a onda 9. Aqui a importação declara USO — sem ela o Nest
 * não resolveria `MemoriaService` no construtor de `ObsidianService`. Tirar esta
 * linha exige mover a dependência, nunca só apagá-la.
 */
/*
 * `GoogleModule` entra porque a vault pode morar no Google Drive
 * (`OBSIDIAN_FONTE=drive`) — a metade da leitura que faltava, já que o espelho
 * da pauta escreve no Drive desde a onda 8.
 *
 * `forwardRef` porque o `GoogleModule` alcança este conector pelo caminho da
 * porta, e um ciclo de módulo derruba o arranque com a mensagem menos legível
 * que o Nest produz ("Nest can't resolve dependencies... undefined at index").
 * A dependência é OPCIONAL no construtor: quem não usa Drive não paga por ela,
 * e as suítes que montam o serviço à mão continuam montando.
 */
@Module({
  imports: [MemoryModule, forwardRef(() => GoogleModule)],
  controllers: [CatalogoDeColecaoController, ObsidianController],
  providers: [ObsidianService, CatalogoDeColecaoService, ContextoMovimentoExplicitoService],
  // exportado para o AgentsModule ligar a capacidade ao efeito
  exports: [ObsidianService],
})
export class ObsidianModule {}
