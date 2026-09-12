import { Module } from '@nestjs/common';
import { GoogleController } from './google.controller';
import { GoogleConexaoController } from './google-conexao.controller';
import { GoogleService } from './google.service';
import { AuthModule } from '../auth/auth.module';

/*
 * Dois controladores, de propósito (fatia 3.3):
 *
 *   · `GoogleConexaoController` — o ciclo de vida da credencial (OAuth). É o
 *     único que ainda toca o `GoogleService`, e vem PRIMEIRO na lista para que
 *     `GET /google/callback`, `/connect` e `/status` casem antes de qualquer
 *     rota de ação;
 *   · `GoogleController` — as nove ações (cinco leituras e quatro escritas),
 *     todas pela porta. Ele não conhece o conector.
 *
 * `GoogleService` continua exportado porque o espelho .md da Pauta grava no
 * Drive por ele (`gravarArquivoNoDrive`). O que deixou de existir é o
 * passa-tudo `api()`: fechá-lo é o que faz a fronteira valer — enquanto ele
 * era público, mover o import não movia nada, porque qualquer arquivo podia
 * montar a URL do Google por fora e entregar pronta.
 */
@Module({
  imports: [AuthModule], // login com Gmail volta pelo callback deste conector
  controllers: [GoogleConexaoController, GoogleController],
  providers: [GoogleService],
  exports: [GoogleService],
})
export class GoogleModule {}
