import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { RoleTasksService } from './role-tasks.service';
import {
  CreateRoleTaskTemplateDto,
  ListRoleTasksQueryDto,
  UpdateRoleTaskStatusDto,
  UpdateRoleTaskTemplateDto,
} from './dto/role-task.dto';

@ApiTags('Role tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('role-tasks')
export class RoleTasksController {
  constructor(private readonly service: RoleTasksService) {}

  @Get('mine')
  @ApiOperation({ summary: "Tasks for the signed-in office user's roles" })
  mine(
    @CurrentUser() user: RequestUser,
    @Query() query: ListRoleTasksQueryDto,
  ) {
    return this.service.listMine(user, query.status);
  }

  @Get()
  @Permissions('role_tasks.manage')
  @ApiOperation({ summary: 'Manager view: role tasks across roles' })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListRoleTasksQueryDto,
  ) {
    return this.service.listAll(user, query.status, query.roleId);
  }

  @Get('options')
  @Permissions('role_tasks.manage')
  @ApiOperation({ summary: 'Roles and branches for the task form' })
  options(@CurrentUser() user: RequestUser) {
    return this.service.options(user);
  }

  @Get('templates')
  @Permissions('role_tasks.manage')
  @ApiOperation({ summary: 'Role task definitions (one-off and repeating)' })
  templates(@CurrentUser() user: RequestUser) {
    return this.service.listTemplates(user);
  }

  @Post('templates')
  @Permissions('role_tasks.manage')
  @ApiOperation({ summary: 'Create a task for a role' })
  createTemplate(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateRoleTaskTemplateDto,
  ) {
    return this.service.createTemplate(user, dto);
  }

  @Patch('templates/:id')
  @Permissions('role_tasks.manage')
  @ApiOperation({ summary: 'Update a role task' })
  updateTemplate(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleTaskTemplateDto,
  ) {
    return this.service.updateTemplate(user, id, dto);
  }

  @Delete('templates/:id')
  @Permissions('role_tasks.manage')
  @ApiOperation({
    summary: 'Delete a role task (open occurrences are cancelled)',
  })
  deleteTemplate(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deleteTemplate(user, id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Start, complete or reopen a task (any user with the role)',
  })
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleTaskStatusDto,
  ) {
    return this.service.updateStatus(user, id, dto);
  }
}
