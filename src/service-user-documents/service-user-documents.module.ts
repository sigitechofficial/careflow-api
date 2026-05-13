import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserDocumentsController } from './service-user-documents.controller';
import { ServiceUserDocumentsService } from './service-user-documents.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserDocumentsController],
  providers: [ServiceUserDocumentsService],
})
export class ServiceUserDocumentsModule {}
