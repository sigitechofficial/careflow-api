import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CarePlanTextController } from './care-plan-text.controller';
import { CarePlanTextService } from './care-plan-text.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [CarePlanTextController],
  providers: [CarePlanTextService],
  exports: [CarePlanTextService],
})
export class CarePlanTextModule {}
