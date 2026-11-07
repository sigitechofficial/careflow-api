import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BodyMapPhotoConsentStatus } from '@prisma/client';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AnyPermission } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { BodyMapService } from './body-map.service';
import { CreateBodyMapMarkerDto } from './dto/create-body-map-marker.dto';
import {
  CloseBodyMapRecordDto,
  CreateBodyMapRecordDto,
  CreateBodyMapReviewDto,
  UpdateBodyMapRecordDto,
} from './dto/create-body-map-record.dto';
import { UpdateBodyMapMarkerDto } from './dto/update-body-map-marker.dto';
import { BodyMapSafeguardingCheckDto } from './dto/body-map-safeguarding.dto';
import {
  BodyMapPressureAssessmentDto,
  BodyMapWoundAssessmentDto,
  CreateBodyMapLinkDto,
} from './dto/body-map-assessments.dto';
import {
  PatchBodyMapMedicationSiteAdministrationDto,
  UpsertBodyMapMedicationSiteDto,
} from './dto/body-map-medication-site.dto';
import { uploadPath } from '../common/utils/upload-path.util';

class UploadBodyMapPhotoDto {
  consentStatus!: BodyMapPhotoConsentStatus;
  caption?: string;
}

function bodyMapPhotoUploadRoot() {
  return uploadPath('body-map', 'photos');
}

function ensureBodyMapPhotoDir() {
  const root = bodyMapPhotoUploadRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

@ApiTags('Body Map')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('body-map')
export class BodyMapController {
  constructor(private readonly service: BodyMapService) {}

  @Post('records')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.body_map.create', 'service_users.update')
  @ApiOperation({ summary: 'Create a body map record with initial marker' })
  createRecord(@CurrentUser() user: RequestUser, @Body() dto: CreateBodyMapRecordDto) {
    return this.service.createRecord(user.id, dto);
  }

  @Get('lookups')
  @AnyPermission('service_users.body_map.read', 'service_users.read')
  @ApiOperation({ summary: 'Record types, sub-types, and body part catalogue' })
  lookups() {
    return this.service.lookups();
  }

  @Get('review-queue')
  @AnyPermission('service_users.body_map.review', 'service_users.body_map.read', 'service_users.read')
  @ApiOperation({ summary: 'Manager review queue — safeguarding, overdue, awaiting review' })
  reviewQueue(
    @Query('overdueOnly') overdueOnly?: string,
    @Query('serviceUserId') serviceUserId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.service.reviewQueue({
      overdueOnly: overdueOnly === 'true',
      serviceUserId: serviceUserId || undefined,
      locationId: locationId?.trim() || undefined,
    });
  }

  @Get('records/:recordId')
  @AnyPermission('service_users.body_map.read', 'service_users.read')
  @ApiOperation({ summary: 'Get full body map record detail' })
  getRecord(@Param('recordId') recordId: string) {
    return this.service.getRecord(recordId);
  }

  @Get('records/:recordId/cqc-evidence')
  @AnyPermission(
    'service_users.body_map.export',
    'service_users.body_map.read',
    'service_users.read',
  )
  @ApiOperation({ summary: 'Inspection-friendly single record CQC view (§21)' })
  cqcEvidenceForRecord(@Param('recordId') recordId: string) {
    return this.service.cqcEvidenceForRecord(recordId);
  }

  @Get('analytics')
  @AnyPermission('service_users.body_map.review', 'service_users.body_map.read', 'service_users.read')
  @ApiOperation({ summary: 'Branch-level body map analytics aggregates (§22)' })
  analytics() {
    return this.service.analytics();
  }

  @Get('governance-alerts')
  @AnyPermission('service_users.body_map.review', 'service_users.body_map.read', 'service_users.read')
  @ApiOperation({ summary: 'Branch governance alerts synced from outstanding gaps (§15.3)' })
  governanceAlerts() {
    return this.service.branchGovernanceAlerts();
  }

  @Patch('records/:recordId')
  @AnyPermission('service_users.body_map.update', 'service_users.update')
  @ApiOperation({ summary: 'Update body map record' })
  updateRecord(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: UpdateBodyMapRecordDto,
  ) {
    return this.service.updateRecord(user.id, recordId, dto);
  }

  @Post('records/:recordId/markers')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.body_map.create', 'service_users.update')
  @ApiOperation({ summary: 'Add marker to existing record' })
  addMarker(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: CreateBodyMapMarkerDto,
  ) {
    return this.service.addMarker(user.id, recordId, dto);
  }

  @Patch('markers/:markerId')
  @AnyPermission('service_users.body_map.update', 'service_users.update')
  @ApiOperation({ summary: 'Update marker position or visibility' })
  updateMarker(
    @CurrentUser() user: RequestUser,
    @Param('markerId') markerId: string,
    @Body() dto: UpdateBodyMapMarkerDto,
  ) {
    return this.service.updateMarker(user.id, markerId, dto);
  }

  @Post('records/:recordId/reviews')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission(
    'service_users.body_map.review',
    'service_users.body_map.update',
    'service_users.update',
  )
  @ApiOperation({ summary: 'Add ongoing review entry' })
  addReview(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: CreateBodyMapReviewDto,
  ) {
    return this.service.addReview(user.id, recordId, dto);
  }

  @Post('records/:recordId/close')
  @AnyPermission('service_users.body_map.close', 'service_users.body_map.update', 'service_users.update')
  @ApiOperation({ summary: 'Close body map record' })
  closeRecord(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: CloseBodyMapRecordDto,
  ) {
    return this.service.closeRecord(user.id, recordId, dto);
  }

  @Post('records/:recordId/wound-assessment')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.body_map.update', 'service_users.body_map.create', 'service_users.update')
  @ApiOperation({ summary: 'Save or update wound assessment' })
  woundAssessment(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: BodyMapWoundAssessmentDto,
  ) {
    return this.service.saveWoundAssessment(user.id, recordId, dto);
  }

  @Post('records/:recordId/medication-site')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.body_map.update', 'service_users.body_map.create', 'service_users.update')
  @ApiOperation({ summary: 'Create or update medication site (MAR-linked) on MEDICATION record' })
  medicationSite(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: UpsertBodyMapMedicationSiteDto,
  ) {
    return this.service.saveMedicationSite(user.id, recordId, dto);
  }

  @Patch('records/:recordId/medication-site/administration')
  @AnyPermission('service_users.body_map.update', 'service_users.update')
  @ApiOperation({
    summary: 'Link or clear MAR administration event on medication site',
    description: 'Set lastAdministrationEventId to a dose UUID, or null to clear the link.',
  })
  medicationSiteAdministration(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: PatchBodyMapMedicationSiteAdministrationDto,
  ) {
    return this.service.patchMedicationSiteAdministration(user.id, recordId, dto);
  }

  @Post('records/:recordId/pressure-assessment')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.body_map.update', 'service_users.body_map.create', 'service_users.update')
  @ApiOperation({ summary: 'Save or update pressure area assessment' })
  pressureAssessment(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: BodyMapPressureAssessmentDto,
  ) {
    return this.service.savePressureAssessment(user.id, recordId, dto);
  }

  @Post('records/:recordId/link')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.body_map.update', 'service_users.body_map.create', 'service_users.update')
  @ApiOperation({ summary: 'Link record to care plan, MAR, incident, etc.' })
  addLink(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: CreateBodyMapLinkDto,
  ) {
    return this.service.addLink(user.id, recordId, dto);
  }

  @Post('records/:recordId/safeguarding-check')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.body_map.review', 'service_users.body_map.update', 'service_users.update')
  @ApiOperation({ summary: 'Complete safeguarding checklist for an existing record' })
  safeguardingCheck(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: BodyMapSafeguardingCheckDto,
  ) {
    return this.service.addSafeguardingCheck(user.id, recordId, dto);
  }

  @Post('records/:recordId/photos')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission('service_users.body_map.update', 'service_users.body_map.create', 'service_users.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload body map photo (consent required)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        consentStatus: { type: 'string', enum: ['GRANTED', 'DENIED', 'PENDING'] },
        caption: { type: 'string' },
      },
      required: ['file', 'consentStatus'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, ensureBodyMapPhotoDir());
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 10_485_760 },
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        cb(null, allowed.includes(file.mimetype));
      },
    }),
  )
  uploadPhoto(
    @CurrentUser() user: RequestUser,
    @Param('recordId') recordId: string,
    @Body() dto: UploadBodyMapPhotoDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');
    const consent = dto.consentStatus ?? (dto as { consentStatus?: string }).consentStatus;
    if (!consent || !Object.values(BodyMapPhotoConsentStatus).includes(consent as BodyMapPhotoConsentStatus)) {
      throw new BadRequestException('Valid consentStatus is required (GRANTED, DENIED, PENDING)');
    }
    return this.service.uploadPhoto(
      user.id,
      recordId,
      file,
      consent as BodyMapPhotoConsentStatus,
      dto.caption,
    );
  }

  @Get('audit/:recordId')
  @AnyPermission('service_users.body_map.read', 'service_users.read')
  @ApiOperation({ summary: 'Audit trail for a body map record' })
  audit(@Param('recordId') recordId: string) {
    return this.service.auditTrail(recordId);
  }
}
