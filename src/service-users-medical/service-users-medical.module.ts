import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OrgScopeModule } from '../common/org-scope/org-scope.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MedicalConditionsService } from './medical-conditions.service';
import { MedicalHistoryService } from './medical-history.service';
import { MedicalSafetySummaryService } from './medical-safety-summary.service';
import { MonitoringConfigService } from './monitoring-config.service';
import { ReasonableAdjustmentsService } from './reasonable-adjustments.service';
import {
  MedicalConditionCatalogController,
  ServiceUserMedicalConditionsController,
  ServiceUserMedicalHistoryController,
  ServiceUserMedicalSafetySummaryController,
  ServiceUserMonitoringConfigController,
  ServiceUserReasonableAdjustmentsController,
  ServiceUserUsualParametersController,
} from './service-users-medical.controller';
import { UsualParametersService } from './usual-parameters.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, OrgScopeModule],
  controllers: [
    MedicalConditionCatalogController,
    ServiceUserMedicalConditionsController,
    ServiceUserReasonableAdjustmentsController,
    ServiceUserMedicalHistoryController,
    ServiceUserMonitoringConfigController,
    ServiceUserUsualParametersController,
    ServiceUserMedicalSafetySummaryController,
  ],
  providers: [
    MedicalConditionsService,
    ReasonableAdjustmentsService,
    MedicalHistoryService,
    MonitoringConfigService,
    UsualParametersService,
    MedicalSafetySummaryService,
  ],
  exports: [
    MedicalConditionsService,
    ReasonableAdjustmentsService,
    MedicalHistoryService,
    MonitoringConfigService,
    UsualParametersService,
    MedicalSafetySummaryService,
  ],
})
export class ServiceUsersMedicalModule {}
