import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { VisitActionsController } from './visit-actions.controller';
import { VisitActionsService } from './visit-actions.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [VisitActionsController],
  providers: [VisitActionsService],
  exports: [VisitActionsService],
})
export class VisitActionsModule {}
