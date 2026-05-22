import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { FormBuilderController } from './form-builder.controller';
import { FormBuilderService } from './form-builder.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [FormBuilderController],
  providers: [FormBuilderService],
  exports: [FormBuilderService],
})
export class FormBuilderModule {}
