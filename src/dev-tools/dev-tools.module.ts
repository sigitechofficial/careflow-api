import { Module } from '@nestjs/common';
import { InitialAssessmentTemplatesModule } from '../initial-assessment-templates/initial-assessment-templates.module';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';
import { IaApiAutofillService } from './ia-api-autofill.service';

/** IA demo-data generation for dev / QA (runs in-process on the API server; nothing persisted). */
@Module({
  imports: [InitialAssessmentTemplatesModule],
  controllers: [DevToolsController],
  providers: [DevToolsService, IaApiAutofillService],
})
export class DevToolsModule {}
