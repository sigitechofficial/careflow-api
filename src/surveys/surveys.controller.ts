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
import {
  AnyPermission,
  Permissions,
} from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveysService } from './surveys.service';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';
import {
  CreateSurveyQuestionDto,
  UpdateSurveyQuestionDto,
} from './dto/survey-question.dto';
import { SendSurveyDto } from './dto/send-survey.dto';
import { ListSurveysQueryDto } from './dto/list-surveys-query.dto';

@ApiTags('Surveys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys')
export class SurveysController {
  constructor(private readonly service: SurveysService) {}

  @Get()
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'List surveys' })
  list(@Query() query: ListSurveysQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Get a survey with its questions' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Get(':id/results')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'Get a survey response-rate rollup' })
  results(@Param('id') id: string) {
    return this.service.results(id);
  }

  @Get(':id/responses')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'List submitted survey responses with answers' })
  listResponses(@Param('id') id: string) {
    return this.service.listResponses(id);
  }

  @Get(':id/recipients')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({ summary: 'List survey recipients with share tokens' })
  listRecipients(@Param('id') id: string) {
    return this.service.listRecipients(id);
  }

  @Post()
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Create a survey' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSurveyDto,
    @Req() req: Request,
  ) {
    return this.service.create(user.id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Update a survey' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateSurveyDto,
    @Req() req: Request,
  ) {
    return this.service.update(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Delete(':id')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Soft-delete a survey' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.remove(user.id, id, getRequestAuditMeta(req));
  }

  @Post(':id/questions')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Add a question to a survey' })
  addQuestion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateSurveyQuestionDto,
    @Req() req: Request,
  ) {
    return this.service.addQuestion(user.id, id, dto, getRequestAuditMeta(req));
  }

  @Patch(':id/questions/:questionId')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Update a survey question' })
  updateQuestion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: UpdateSurveyQuestionDto,
    @Req() req: Request,
  ) {
    return this.service.updateQuestion(user.id, id, questionId, dto, getRequestAuditMeta(req));
  }

  @Delete(':id/questions/:questionId')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Remove a survey question' })
  removeQuestion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Req() req: Request,
  ) {
    return this.service.removeQuestion(user.id, id, questionId, getRequestAuditMeta(req));
  }

  @Post(':id/send')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Send a survey to employees or service users' })
  send(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SendSurveyDto,
    @Req() req: Request,
  ) {
    return this.service.send(
      user.id,
      id,
      dto,
      getRequestAuditMeta(req),
      req.headers.origin,
    );
  }

  @Post(':id/publish')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Publish a survey and enable its shareable link' })
  publish(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.publish(user.id, id, getRequestAuditMeta(req));
  }
}
