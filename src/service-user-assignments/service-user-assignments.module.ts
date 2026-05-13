import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserAssignmentsController } from './service-user-assignments.controller';
import { ServiceUserAssignmentsService } from './service-user-assignments.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserAssignmentsController],
  providers: [ServiceUserAssignmentsService],
})
export class ServiceUserAssignmentsModule {}
