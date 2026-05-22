import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { FormSelectionController } from './form-selection.controller';
import { FormSelectionService } from './form-selection.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [FormSelectionController],
  providers: [FormSelectionService],
  exports: [FormSelectionService],
})
export class FormSelectionModule {}
