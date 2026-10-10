import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { SetupChecklistService } from './setup-checklist.service';

@ApiTags('Setup checklist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('setup-checklist')
export class SetupChecklistController {
  constructor(private readonly service: SetupChecklistService) {}

  @Get()
  @Permissions('setup_checklist.read')
  @ApiOperation({
    summary: 'What is set up and what is still missing across the organisation',
  })
  get() {
    return this.service.getChecklist();
  }
}
