import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserNfcTagsController } from './service-user-nfc-tags.controller';
import { ServiceUserNfcTagsService } from './service-user-nfc-tags.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserNfcTagsController],
  providers: [ServiceUserNfcTagsService],
  exports: [ServiceUserNfcTagsService],
})
export class ServiceUserNfcTagsModule {}
