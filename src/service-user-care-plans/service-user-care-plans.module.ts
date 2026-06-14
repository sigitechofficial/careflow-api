import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CarePlanComposeService } from './care-plan-compose.service';
import { ServiceUserCarePlansController } from './service-user-care-plans.controller';
import { ServiceUserCarePlansService } from './service-user-care-plans.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserCarePlansController],
  providers: [ServiceUserCarePlansService, CarePlanComposeService],
  exports: [ServiceUserCarePlansService, CarePlanComposeService],
})
export class ServiceUserCarePlansModule {}
