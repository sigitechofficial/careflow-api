import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OnCallController } from './on-call.controller';
import { OnCallService } from './on-call.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [OnCallController],
  providers: [OnCallService],
})
export class OnCallModule {}
