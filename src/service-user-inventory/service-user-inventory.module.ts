import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserInventoryController } from './service-user-inventory.controller';
import { ServiceUserInventoryService } from './service-user-inventory.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserInventoryController],
  providers: [ServiceUserInventoryService],
})
export class ServiceUserInventoryModule {}
