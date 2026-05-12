import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { CreateTemporaryInspectorDto } from './dto/create-temporary-inspector.dto';
import { TemporaryInspectorsService } from './temporary-inspectors.service';

@ApiTags('Temporary inspectors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('temporary-inspectors')
export class TemporaryInspectorsController {
  constructor(private readonly service: TemporaryInspectorsService) {}

  @Get('service-user-options')
  @Permissions('employees.read')
  serviceUserOptions() {
    return { data: this.service.serviceUserOptions() };
  }

  @Get()
  @Permissions('employees.read')
  async list() {
    return { data: await this.service.list() };
  }

  @Post()
  @Permissions('employees.update')
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateTemporaryInspectorDto) {
    const { id } = await this.service.create(user.id, dto);
    return { message: 'Temporary inspector created', data: { id } };
  }

  @Delete(':id')
  @Permissions('employees.update')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.softDelete(id);
    return { message: 'Temporary inspector removed', data: { id } };
  }
}
