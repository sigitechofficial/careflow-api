import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { hashPassword } from '../common/utils/password.util';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions('users.read')
  async list(@Query() _pagination: PaginationQueryDto) {
    // Keep minimal for now (Admin panel typically uses a dedicated module later)
    return { data: [] };
  }

  @Get(':id')
  @Permissions('users.read')
  async get(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
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
  async update(@Param('id') _id: string, @Body() _dto: UpdateUserDto) {
    return { message: 'Not implemented yet', data: {} };
  }
}

