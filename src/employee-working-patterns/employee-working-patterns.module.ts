import { Module } from '@nestjs/common';
import { EmployeeWorkingPatternsController } from './employee-working-patterns.controller';
import { EmployeeWorkingPatternsService } from './employee-working-patterns.service';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';

@Module({
  imports: [OrganisationGeneralSettingsModule],
  controllers: [EmployeeWorkingPatternsController],
  providers: [EmployeeWorkingPatternsService],
})
export class EmployeeWorkingPatternsModule {}

