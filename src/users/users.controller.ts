import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { SetUserLocationsDto } from './dto/set-user-locations.dto';
import { hashPassword } from '../common/utils/password.util';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions('users.read')
  @ApiOperation({ summary: 'List office users with roles and branch assignments' })
  async list(@CurrentUser() actor: RequestUser) {
    return this.usersService.listUsers({
      roles: actor.roles,
      assignedLocationIds: actor.assignedLocationIds,
    });
  }

  @Get(':id')
  @Permissions('users.read')
  async get(@Param('id') id: string) {
    const user = await this.usersService.findPublicById(id);
    return { data: user };
  }

  @Post()
  @Permissions('users.create')
  async create(@Body() dto: CreateUserDto) {
    const user = await this.usersService.create({
      email: dto.email,
      username: dto.username,
      firstName: dto.firstName,
      lastName: dto.lastName,
      passwordHash: await hashPassword(dto.password),
    });
    return { message: 'User created', data: { id: user.id } };
  }

  @Patch(':id')
  @Permissions('users.create')
  async update(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    const user = await this.usersService.updateOfficeUser(actor, id, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      password: dto.password,
    });
    return {
      message: 'User updated',
      data: { id: user.id, email: user.email },
    };
  }

  @Put(':id/roles')
  @Permissions('roles.manage')
  @ApiOperation({ summary: 'Replace identity roles (anti-escalation enforced)' })
  setRoles(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetUserRolesDto,
  ) {
    return this.usersService.setUserRoles(
      { id: actor.id, roles: actor.roles, assignedLocationIds: actor.assignedLocationIds },
      id,
      dto.roleNames,
    );
  }

  @Put(':id/locations')
  @Permissions('roles.manage')
  @ApiOperation({ summary: 'Replace authorization branch assignments (UserLocation)' })
  setLocations(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetUserLocationsDto,
  ) {
    return this.usersService.setUserLocations(
      {
        id: actor.id,
        roles: actor.roles,
        assignedLocationIds: actor.assignedLocationIds,
      },
      id,
      dto.locationIds,
    );
  }
}
