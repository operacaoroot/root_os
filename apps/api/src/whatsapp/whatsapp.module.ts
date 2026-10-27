import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { RoutinesModule } from '../routines/routines.module';
import { StorageModule } from '../storage/storage.module';
import { CaixaDoWhatsappController, MidiaDoWhatsappController } from './caixa.controller';
import { CaixaDoWhatsappService } from './caixa.service';
import { GravadorDoWhatsappService } from './gravador.service';
import { ResumoDoWhatsappController } from './resumo.controller';
import { ResumoDoWhatsappService } from './resumo.service';
import { SincronizacaoDoWhatsappService } from './sincronizacao.service';
import { VinculoDoWhatsappController } from './vinculo.controller';
import { VinculoDoWhatsappService } from './vinculo.service';

/**
 * O WHATSAPP DA EMPRESA POR DENTRO DO OS (rodada de produção 4, 22/10/2026).
 *
 *   · W1 · `GravadorDoWhatsappService` se inscreve no `GravacaoDoWhatsappRegistry`
 *     (da porta, global) e grava TODA mensagem do webhook antes dos leitores de
 *     sempre; `SincronizacaoDoWhatsappService` é a rotina `whatsapp.sincronizar`
 *     (só leitura, pela porta `LEITURA_DA_EVOLUTION`).
 *   · W2 · `/whatsapp/conversas`: a caixa (lista, conversa, lida, arquivar,
 *     responder como pessoa pela porta `RESPOSTA_DE_GENTE_PELA_EVOLUTION`).
 *     Layout 27/10: `POST /whatsapp/conversas/:id/midia` manda arquivo e
 *     `GET /whatsapp/mensagens/:id/midia` abre o de uma mensagem (porta
 *     `MIDIA_DA_CAIXA_PELA_EVOLUTION`; o arquivo fica no `StorageService`).
 *   · W3 · `/whatsapp/vinculos`: o vínculo com lead e cliente.
 *   · W4 · `/whatsapp/resumo`: o cartão do Dia a dia e a bolha do menu.
 *
 * O prefixo `whatsapp` é do módulo `leads` (`tenants/modulos.ts`): sem o
 * comercial contratado, a caixa não existe. A Evolution só pelas portas de
 * `gateway/canais/evolution.port.ts`: nada aqui importa o conector.
 *
 * SEM A LINHA NO `AppModule`, o webhook não grava nada (ninguém se inscreve) e
 * toda rota `/api/whatsapp/*` responde 404, sem nada acusar.
 */
@Module({
  imports: [AuditModule, RoutinesModule, StorageModule],
  controllers: [CaixaDoWhatsappController, MidiaDoWhatsappController, VinculoDoWhatsappController, ResumoDoWhatsappController],
  providers: [
    GravadorDoWhatsappService,
    SincronizacaoDoWhatsappService,
    CaixaDoWhatsappService,
    VinculoDoWhatsappService,
    ResumoDoWhatsappService,
  ],
  exports: [VinculoDoWhatsappService],
})
export class WhatsappModule {}
