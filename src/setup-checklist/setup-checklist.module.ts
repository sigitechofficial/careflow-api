import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganisationGeneralSettingsModule } from '../organisation-general-settings/organisation-general-settings.module';
import { SetupChecklistController } from './setup-checklist.controller';
import { SetupChecklistService } from './setup-checklist.service';

@Module({
  imports: [PrismaModule, OrganisationGeneralSettingsModule],
  controllers: [SetupChecklistController],
  providers: [SetupChecklistService],
})
export class SetupChecklistModule {}
