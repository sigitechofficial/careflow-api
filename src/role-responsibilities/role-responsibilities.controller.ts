import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { RoleResponsibilitiesService } from './role-responsibilities.service';
import { AssignResponsibilityDto } from './dto/assign-responsibility.dto';

@ApiTags('Role responsibilities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('permissions.manage')
@Controller('role-responsibilities')
export class RoleResponsibilitiesController {
  constructor(private readonly service: RoleResponsibilitiesService) {}

  @Get()
  @ApiOperation({
    summary: 'Jobs (payroll, visits, service users…) and which roles do them',
  })
  list() {
    return this.service.list();
  }

  @Get('financial-authority')
  @ApiOperation({
    summary: 'Who can prepare, approve, close, pay and audit carer pay, and where nobody can',
  })
  financialAuthority() {
    return this.service.financialAuthority();
  }

  @Put(':key')
  @ApiOperation({
    summary: 'Give a job to roles (others lose the ability; admins keep it)',
  })
  assign(
    @CurrentUser() user: RequestUser,
    @Param('key') key: string,
    @Body() dto: AssignResponsibilityDto,
  ) {
    return this.service.assign(user.id, key, dto.roleIds);
  }
}
