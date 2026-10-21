import { Global, Module } from '@nestjs/common';

import {
  ARQUIVISTA_DO_CLIENTE,
  PASTA_DO_CLIENTE,
  type ArquivistaDoClientePort,
  type PastaDoClientePort,
} from './portas';

/*
 * A PASTA DO CLIENTE E O ARQUIVISTA (rodada dos agentes, 21/10/2026).
 *
 * Lane 0 deixa o módulo com as duas portas respondendo "ainda não ligado", para
 * as lanes que CHAMAM (comercial, implantação, trabalho) compilarem e testarem
 * contra o contrato enquanto a lane do Drive (TR-04/TR-05) implementa. A lane
 * do Drive troca estes dois provedores pelos de verdade, aqui mesmo.
 *
 * `@Global`: chamado de muitos módulos; importar em cada um fecharia ciclo.
 */
const PASTA_AINDA_NAO_LIGADA: PastaDoClientePort = {
  garantir: async () => ({ estado: 'erro', motivo: 'a pasta do cliente ainda não está ligada nesta versão' }),
};
const ARQUIVISTA_AINDA_NAO_LIGADO: ArquivistaDoClientePort = {
  arquivar: async () => ({ estado: 'so_no_os', motivo: 'o arquivista ainda não está ligado nesta versão' }),
};

@Global()
@Module({
  providers: [
    { provide: PASTA_DO_CLIENTE, useValue: PASTA_AINDA_NAO_LIGADA },
    { provide: ARQUIVISTA_DO_CLIENTE, useValue: ARQUIVISTA_AINDA_NAO_LIGADO },
  ],
  exports: [PASTA_DO_CLIENTE, ARQUIVISTA_DO_CLIENTE],
})
export class ClientesModule {}
