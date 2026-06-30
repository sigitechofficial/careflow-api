import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { TaskCatalogueService } from './task-catalogue.service';
import { TaskCatalogueQueryDto } from './dto/task-catalogue-query.dto';
import { CreateTaskCatalogueTaskDto } from './dto/create-task-catalogue-task.dto';
import { UpdateTaskCatalogueTaskDto } from './dto/update-task-catalogue-task.dto';

@ApiTags('Task Catalogue')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('task-catalogue')
export class TaskCatalogueController {
  constructor(private readonly service: TaskCatalogueService) {}

  @Get()
  @AnyPermission('task_catalogue.read', 'service_users.read', 'task_catalogue.manage', 'lookups.manage')
  @ApiOperation({ summary: 'List task catalogue groups, categories, and tasks' })
  list(@Query() query: TaskCatalogueQueryDto, @CurrentUser() user: RequestUser) {
    const canSeeInactive =
      query.includeInactive === true &&
      (user.permissions?.includes('task_catalogue.manage') ||
        user.permissions?.includes('lookups.manage'));
    return this.service.listCatalogue(canSeeInactive);
  }

  @Post('tasks')
  @AnyPermission('task_catalogue.manage', 'lookups.manage')
  @ApiOperation({ summary: 'Create a catalogue task' })
  createTask(@CurrentUser() user: RequestUser, @Body() dto: CreateTaskCatalogueTaskDto) {
    return this.service.createTask(user.id, dto);
  }

  @Patch('tasks/:id')
  @AnyPermission('task_catalogue.manage', 'lookups.manage')
  @ApiOperation({ summary: 'Update a catalogue task' })
  updateTask(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskCatalogueTaskDto,
  ) {
    return this.service.updateTask(user.id, id, dto);
  }

  @Delete('tasks/:id')
  @AnyPermission('task_catalogue.manage', 'lookups.manage')
  @ApiOperation({ summary: 'Soft-delete a catalogue task' })
  removeTask(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.removeTask(user.id, id);
  }
}
