import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { openfdaConfig } from '../config/openfda.config';
import { OpenFdaController } from './openfda.controller';
import { OpenFdaService } from './openfda.service';

@Module({
  imports: [ConfigModule.forFeature(openfdaConfig)],
  controllers: [OpenFdaController],
  providers: [OpenFdaService],
  exports: [OpenFdaService],
})
export class OpenFdaModule {}
