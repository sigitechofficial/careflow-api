import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { InitialAssessmentCarePlanRulesService } from './initial-assessment-care-plan-rules.service';
import {
  CreateCarePlanRecommendationRuleDto,
  UpdateCarePlanRecommendationRuleDto,
} from './dto/care-plan-recommendation-rule.dto';

@ApiTags('Initial Assessment Care Plan Rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('initial-assessments/care-plan-recommendation-rules')
export class InitialAssessmentCarePlanRulesController {
  constructor(private readonly rulesService: InitialAssessmentCarePlanRulesService) {}

  @Get()
  @AnyPermission('form_builder.read', 'service_users.initial_assessment.read')
  @ApiOperation({ summary: 'List care plan recommendation rules' })
  list() {
    return this.rulesService.listRules();
  }

  @Get('care-plans')
  @AnyPermission(
    'form_builder.read',
    'form_selection.read',
    'service_users.initial_assessment.read',
  )
  @ApiOperation({ summary: 'List care plan forms for trigger rules' })
  listCarePlans() {
    return this.rulesService.listCarePlanForms();
  }

  @Get('field-keys')
  @AnyPermission('form_builder.read', 'service_users.initial_assessment.read')
  @ApiOperation({ summary: 'List assessment field keys for rule conditions' })
  fieldKeys(@Query('templateId') templateId?: string) {
    return this.rulesService.listAssessmentFieldKeys(templateId);
  }

  @Get('diagnostics')
  @AnyPermission('form_builder.read', 'service_users.initial_assessment.read')
  @ApiOperation({
    summary:
      'Rule configuration health: invalid target forms, unresolvable or ambiguous conditions, free-text triggers and drift from the starter rules (read-only)',
  })
  diagnostics(@Query('templateId') templateId?: string) {
    return this.rulesService.diagnostics(templateId);
  }

  @Post()
  @AnyPermission('form_builder.update', 'service_users.initial_assessment.update')
  @ApiOperation({ summary: 'Create care plan recommendation rule' })
  create(@Body() dto: CreateCarePlanRecommendationRuleDto) {
    return this.rulesService.createRule(dto);
  }

  @Patch(':id')
  @AnyPermission('form_builder.update', 'service_users.initial_assessment.update')
  @ApiOperation({ summary: 'Update care plan recommendation rule' })
  update(@Param('id') id: string, @Body() dto: UpdateCarePlanRecommendationRuleDto) {
    return this.rulesService.updateRule(id, dto);
  }

  @Delete(':id')
  @AnyPermission('form_builder.update', 'service_users.initial_assessment.update')
  @ApiOperation({ summary: 'Delete care plan recommendation rule' })
  remove(@Param('id') id: string) {
    return this.rulesService.deleteRule(id);
  }
}
