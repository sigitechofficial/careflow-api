import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ServiceUserCommunicationNotesController } from './service-user-communication-notes.controller';
import { ServiceUserCommunicationNotesService } from './service-user-communication-notes.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [ServiceUserCommunicationNotesController],
  providers: [ServiceUserCommunicationNotesService],
  exports: [ServiceUserCommunicationNotesService],
})
export class ServiceUserCommunicationNotesModule {}
