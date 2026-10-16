import { Module } from '@nestjs/common';
import { EmployeeAbsencesController } from './employee-absences.controller';
import { EmployeeAbsencesService } from './employee-absences.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [EmployeeAbsencesController],
  providers: [EmployeeAbsencesService],
})
export class EmployeeAbsencesModule {}
