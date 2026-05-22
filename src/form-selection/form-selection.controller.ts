import { Body, Controller, Get, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { FormSelectionService } from './form-selection.service';
import { DefaultFormSelectionQueryDto } from './dto/default-form-selection-query.dto';
import { UpdateDefaultFormSelectionDto } from './dto/update-default-form-selection.dto';

@ApiTags('Form Selection')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('form-selection')
export class FormSelectionController {
  constructor(private readonly service: FormSelectionService) {}

  @Get()
  @Permissions('form_selection.read')
  @ApiOperation({ summary: 'Get default form selections grouped by form type' })
  getSelections() {
    return this.service.getSelections();
  }

  @Patch()
  @Permissions('form_selection.update')
  @ApiOperation({ summary: 'Replace default form selections per submitted form type' })
  updateSelections(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateDefaultFormSelectionDto,
    @Req() req: Request,
  ) {
    return this.service.updateSelections(user.id, dto, getRequestAuditMeta(req));
  }

  @Get('care-plans')
  @Permissions('form_selection.read')
  @ApiOperation({ summary: 'List care plan forms available for selection' })
  listCarePlans(@Query() query: DefaultFormSelectionQueryDto) {
    return this.service.listFormsByType('CARE_PLAN', query);
  }

  @Get('assessments')
  @Permissions('form_selection.read')
  @ApiOperation({ summary: 'List assessment forms available for selection' })
  listAssessments(@Query() query: DefaultFormSelectionQueryDto) {
    return this.service.listFormsByType('ASSESSMENT', query);
  }

  @Get('service-forms')
  @Permissions('form_selection.read')
  @ApiOperation({ summary: 'List service forms available for selection' })
  listServiceForms(@Query() query: DefaultFormSelectionQueryDto) {
    return this.service.listFormsByType('SERVICE_FORM', query);
  }

  @Get('staff-forms')
  @Permissions('form_selection.read')
  @ApiOperation({ summary: 'List staff forms available for selection' })
  listStaffForms(@Query() query: DefaultFormSelectionQueryDto) {
    return this.service.listFormsByType('STAFF_FORM', query);
  }
}
