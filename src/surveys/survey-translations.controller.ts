import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { SurveyTranslationsService } from './survey-translations.service';

/** A survey in other languages and easy read (roadmap Phase 3). Answers are always stored in English. */
@ApiTags('Survey translations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('surveys/:surveyId/translations')
export class SurveyTranslationsController {
  constructor(private readonly translations: SurveyTranslationsService) {}

  @Get()
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({
    summary: 'Languages this survey is translated into, with how much is done',
  })
  list(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
  ) {
    return this.translations.list(user, surveyId);
  }

  @Get(':language')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({
    summary: 'Every text to translate, with the translation so far',
  })
  get(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('language') language: string,
  ) {
    return this.translations.get(user, surveyId, language);
  }

  @Put(':language')
  @Permissions('surveys.manage')
  @ApiOperation({
    summary:
      'Save translated texts ({ edits: [{ key, text }] }; an empty text removes one)',
  })
  save(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('language') language: string,
    @Body() body: { edits?: unknown },
    @Req() req: Request,
  ) {
    return this.translations.save(
      user,
      surveyId,
      language,
      body?.edits,
      getRequestAuditMeta(req),
    );
  }

  @Get(':language/pack')
  @AnyPermission('surveys.read', 'surveys.manage')
  @ApiOperation({
    summary:
      'The translator’s pack: a spreadsheet (CSV) of every text, to send to a translator',
  })
  pack(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('language') language: string,
  ) {
    return this.translations.exportCsv(user, surveyId, language);
  }

  @Post(':language/pack')
  @Permissions('surveys.manage')
  @ApiOperation({
    summary: 'Take the translations from a filled-in pack ({ csv })',
  })
  importPack(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('language') language: string,
    @Body() body: { csv?: unknown },
    @Req() req: Request,
  ) {
    return this.translations.importCsv(
      user,
      surveyId,
      language,
      body?.csv,
      getRequestAuditMeta(req),
    );
  }

  @Post(':language/publish')
  @Permissions('surveys.manage')
  @ApiOperation({
    summary:
      'Offer this language to people answering (every survey text must be translated)',
  })
  publish(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('language') language: string,
    @Req() req: Request,
  ) {
    return this.translations.publish(
      user,
      surveyId,
      language,
      getRequestAuditMeta(req),
    );
  }

  @Post(':language/unpublish')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Stop offering this language (kept as a draft)' })
  unpublish(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('language') language: string,
    @Req() req: Request,
  ) {
    return this.translations.unpublish(
      user,
      surveyId,
      language,
      getRequestAuditMeta(req),
    );
  }

  @Delete(':language')
  @Permissions('surveys.manage')
  @ApiOperation({ summary: 'Delete this translation' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('language') language: string,
    @Req() req: Request,
  ) {
    return this.translations.remove(
      user,
      surveyId,
      language,
      getRequestAuditMeta(req),
    );
  }
}
