import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserDocumentsController } from './service-user-documents.controller';
import { ServiceUserDocumentsService } from './service-user-documents.service';
import { ServiceUserDocumentStoreController } from './service-user-document-store.controller';
import { ServiceUserDocumentStoreService } from './service-user-document-store.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ServiceUserDocumentsController, ServiceUserDocumentStoreController],
  providers: [ServiceUserDocumentsService, ServiceUserDocumentStoreService],
})
export class ServiceUserDocumentsModule {}
