import { Module } from '@nestjs/common';
import { YoutubeService } from './youtube.service';
import { YoutubeConexaoController } from './youtube-conexao.controller';
import { CLIENTE_DO_YOUTUBE } from '../pauta/cliente-do-youtube';
import { CONEXAO_DO_YOUTUBE } from './conexao-do-youtube';

/*
 * O conector do YouTube (MD10). Só declara: o serviço, o retorno do OAuth e os
 * dois contratos que ele cumpre, por injeção — o cliente que a pauta usa dentro
 * dos efeitos (`CLIENTE_DO_YOUTUBE`) e a conclusão do OAuth que o controlador
 * usa (`CONEXAO_DO_YOUTUBE`). Ninguém fora daqui importa o serviço.
 */
@Module({
  controllers: [YoutubeConexaoController],
  providers: [
    YoutubeService,
    { provide: CLIENTE_DO_YOUTUBE, useExisting: YoutubeService },
    { provide: CONEXAO_DO_YOUTUBE, useExisting: YoutubeService },
  ],
  exports: [CLIENTE_DO_YOUTUBE],
})
export class YoutubeModule {}
