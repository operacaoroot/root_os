import { Global, Module } from '@nestjs/common';

import { GoogleModule } from '../google/google.module';
import { MemoryModule } from '../memory/memoria.module';
import { StorageModule } from '../storage/storage.module';
import { ArquivistaService } from './arquivista/arquivista.service';
import { ClientesController } from './clientes.controller';
import { PastaDoClienteService } from './pasta-do-cliente/pasta-do-cliente.service';
import { ARQUIVISTA_DO_CLIENTE, PASTA_DO_CLIENTE } from './portas';

/*
 * A PASTA DO CLIENTE E O ARQUIVISTA (rodada dos agentes, 21/10/2026).
 *
 * A Lane 0 deixou as duas portas respondendo "ainda não ligado"; a lane A4
 * (TR-04/TR-05) as liga aqui: `PASTA_DO_CLIENTE` é o `PastaDoClienteService` e
 * `ARQUIVISTA_DO_CLIENTE` é o `ArquivistaService`, os dois inscrevendo o efeito
 * da própria capacidade (`drive.pasta.criar`, `drive.arquivo.enviar`) e
 * recebendo o cliente do Drive por `DRIVE_DO_CLIENTE` (o conector Google, sem
 * importá-lo). A rota é `POST /clientes/:id/pasta` e `GET /clientes/pastas`.
 *
 * `@Global`: chamado de muitos módulos (comercial, implantação, trabalho);
 * importar em cada um fecharia ciclo.
 */
@Global()
@Module({
  imports: [GoogleModule, MemoryModule, StorageModule],
  controllers: [ClientesController],
  providers: [
    PastaDoClienteService,
    ArquivistaService,
    { provide: PASTA_DO_CLIENTE, useExisting: PastaDoClienteService },
    { provide: ARQUIVISTA_DO_CLIENTE, useExisting: ArquivistaService },
  ],
  exports: [PASTA_DO_CLIENTE, ARQUIVISTA_DO_CLIENTE, ArquivistaService, PastaDoClienteService],
})
export class ClientesModule {}
