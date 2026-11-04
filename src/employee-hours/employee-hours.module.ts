import { Module } from '@nestjs/common';
import { EmployeeHoursController } from './employee-hours.controller';
import { EmployeeHoursService } from './employee-hours.service';
import { CarerTimebankService } from './carer-timebank.service';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';

@Module({
  imports: [OrganisationGeneralSettingsModule],
  controllers: [EmployeeHoursController],
  providers: [EmployeeHoursService, CarerTimebankService],
})
export class EmployeeHoursModule {}
