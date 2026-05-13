import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserContactsController } from './service-user-contacts.controller';
import { ServiceUserContactsService } from './service-user-contacts.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserContactsController],
  providers: [ServiceUserContactsService],
})
export class ServiceUserContactsModule {}
