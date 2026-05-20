import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrganisationGeneralSettingsService } from './organisation-general-settings.service';
import { UpdateOrganisationGeneralSettingsDto } from './dto/update-organisation-general-settings.dto';

@ApiTags('Organisation General Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('settings/general')
export class OrganisationGeneralSettingsController {
  constructor(private readonly service: OrganisationGeneralSettingsService) {}

  @Get()
  @AnyPermission('settings.general.read', 'lookups.read')
  @ApiOperation({ summary: 'Get organisation general settings (singleton)' })
  get() {
    return this.service.get();
  }

  @Patch()
  @AnyPermission('settings.general.update', 'lookups.manage')
  @ApiOperation({ summary: 'Update organisation general settings' })
  update(@CurrentUser() user: RequestUser, @Body() dto: UpdateOrganisationGeneralSettingsDto) {
    return this.service.update(user.id, dto);
  }
}
