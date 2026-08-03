import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { BioController } from './bio.controller';
import { BioPublicController } from './bio-public.controller';
import { BioOauthController } from './bio-oauth.controller';
import { BioService } from './bio.service';
import { BioTrackingService } from './bio-tracking.service';
import { BioChallengeService } from './bio-challenge.service';
import { BioAnalyticsService } from './bio-analytics.service';
import { BioCredenciaisService } from './bio-credenciais.service';
import { BioSyncService } from './bio-sync.service';
import { BioBridgeService } from './bio-bridge.service';

@Module({
  imports: [StorageModule],
  controllers: [BioController, BioPublicController, BioOauthController],
  providers: [
    BioService,
    BioTrackingService,
    BioChallengeService,
    BioAnalyticsService,
    BioCredenciaisService,
    BioSyncService,
    BioBridgeService,
  ],
  exports: [BioBridgeService],
})
export class BioModule {}
