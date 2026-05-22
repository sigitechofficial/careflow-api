import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { CarePlanTextService } from './care-plan-text.service';
import { CarePlanTextQueryDto } from './dto/care-plan-text-query.dto';
import { CreateCarePlanTextTemplateDto } from './dto/create-care-plan-text-template.dto';
import { UpdateCarePlanTextTemplateDto } from './dto/update-care-plan-text-template.dto';
import { PreviewCarePlanTextDto } from './dto/preview-care-plan-text.dto';

@ApiTags('Care Plan Text')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('care-plan-text')
export class CarePlanTextController {
  constructor(private readonly service: CarePlanTextService) {}

  @Get()
  @Permissions('care_plan_text.read')
  @ApiOperation({ summary: 'List care plan text templates' })
  list(@Query() query: CarePlanTextQueryDto) {
    return this.service.list(query);
  }

  @Get('categories')
  @Permissions('care_plan_text.read')
  @ApiOperation({ summary: 'List care plan text categories' })
  listCategories() {
    return this.service.listCategories();
  }

  @Get(':id')
  @Permissions('care_plan_text.read')
  @ApiOperation({ summary: 'Get care plan text template' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @Permissions('care_plan_text.create')
  @ApiOperation({ summary: 'Create care plan text template' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCarePlanTextTemplateDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('care_plan_text.update')
  @ApiOperation({ summary: 'Update care plan text template' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateCarePlanTextTemplateDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('care_plan_text.delete')
  @ApiOperation({ summary: 'Delete care plan text template' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/preview')
  @Permissions('care_plan_text.preview')
  @ApiOperation({ summary: 'Preview care plan text with @ placeholder replacement' })
  preview(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: PreviewCarePlanTextDto,
    @Req() req: Request,
  ) {
    return this.service.preview(user.id, id, dto, getRequestAuditMeta(req));
  }
}
