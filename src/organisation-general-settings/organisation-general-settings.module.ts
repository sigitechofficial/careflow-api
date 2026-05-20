import { Module } from '@nestjs/common';
import { OrganisationGeneralSettingsController } from './organisation-general-settings.controller';
import { OrganisationGeneralSettingsService } from './organisation-general-settings.service';

@Module({
  controllers: [OrganisationGeneralSettingsController],
  providers: [OrganisationGeneralSettingsService],
  exports: [OrganisationGeneralSettingsService],
})
export class OrganisationGeneralSettingsModule {}
