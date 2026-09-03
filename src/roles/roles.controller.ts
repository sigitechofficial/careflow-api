import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';

@ApiTags('Roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @AnyPermission('roles.manage', 'permissions.manage')
  @ApiOperation({ summary: 'List identity roles with assigned permissions' })
  async list() {
    return { data: await this.rolesService.listMapped() };
  }

  @Post()
  @Permissions('roles.manage')
  async create(@Body() dto: CreateRoleDto) {
    const role = await this.rolesService.create(dto);
    return { message: 'Role created', data: role };
  }

  @Patch(':id')
  @Permissions('roles.manage')
  async update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    const role = await this.rolesService.update(id, dto);
    return { message: 'Role updated', data: role };
  }

  @Put(':id/permissions')
  @Permissions('permissions.manage')
  @ApiOperation({ summary: 'Replace all permissions on a role' })
  async setPermissions(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    const role = await this.rolesService.setPermissions(
      { id: actor.id, roles: actor.roles },
      id,
      dto.permissionKeys,
    );
    return { message: 'Role permissions updated', data: role };
  }
}
