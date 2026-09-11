import { Module } from '@nestjs/common';
import { ObsidianController } from './obsidian.controller';
import { ObsidianService } from './obsidian.service';
import { MemoryModule } from '../memory/memoria.module';

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
@Module({
  imports: [MemoryModule],
  controllers: [ObsidianController],
  providers: [ObsidianService],
  // exportado para o AgentsModule ligar a capacidade ao efeito
  exports: [ObsidianService],
})
export class ObsidianModule {}
