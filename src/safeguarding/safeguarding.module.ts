import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SafeguardingController } from './safeguarding.controller';
import { SafeguardingService } from './safeguarding.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SafeguardingController],
  providers: [SafeguardingService],
  exports: [SafeguardingService],
})
export class SafeguardingModule {}
