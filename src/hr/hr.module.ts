import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { HrEmployeesController } from './hr-employees.controller';
import {
  HrDocumentsController,
  HrEmployeeDocumentsController,
} from './hr-documents.controller';
import { HrProfileService } from './hr-profile.service';
import { HrDocumentsService } from './hr-documents.service';
import { RecruitmentModule } from './recruitment/recruitment.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, forwardRef(() => RecruitmentModule)],
  controllers: [
    HrEmployeesController,
    HrEmployeeDocumentsController,
    HrDocumentsController,
  ],
  providers: [HrProfileService, HrDocumentsService],
  exports: [HrProfileService],
})
export class HrModule {}
