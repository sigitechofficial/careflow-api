import { Module } from '@nestjs/common';
import { InitialAssessmentTemplatesModule } from '../initial-assessment-templates/initial-assessment-templates.module';
import { InitialAssessmentsModule } from '../initial-assessments/initial-assessments.module';
import { DevToolsController } from './dev-tools.controller';
import { DevToolsService } from './dev-tools.service';
import { IaApiAutofillService } from './ia-api-autofill.service';

/** IA autofill API for dev / demo (runs in-process on the API server). */
@Module({
  imports: [InitialAssessmentsModule, InitialAssessmentTemplatesModule],
  controllers: [DevToolsController],
  providers: [DevToolsService, IaApiAutofillService],
})
export class DevToolsModule {}
