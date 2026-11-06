import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BodyMapPhotoConsentStatus } from '@prisma/client';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { BodyMapService } from '../body-map/body-map.service';
import {
  BODY_MAP_VIDEO_INCOMING_DIR,
  BODY_MAP_VIDEO_MAX_BYTES,
} from '../body-map/body-map-video.util';
import { CreateBodyMapReviewDto } from '../body-map/dto/create-body-map-record.dto';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppVisitsService } from './employee-app-visits.service';
import { EmployeeAppBodyMapWizardSubmitDto } from './dto/employee-app-body-map-wizard.dto';
import { EmployeeAppCreateBodyMapRecordDto } from './dto/employee-app-body-map-record.dto';
import { uploadPath } from '../common/utils/upload-path.util';

function ensureBodyMapPhotoDir() {
  const root = uploadPath('body-map', 'photos');
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

function ensureBodyMapVideoIncomingDir() {
  const dir = join(process.cwd(), BODY_MAP_VIDEO_INCOMING_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Dedicated mobile body map API — admin-parity wizard (Type → Location → Observation → Cause → Action).
 * Records sync to schedule-jobs visit workspace via scheduledJobId on the clinical chart.
 */
@ApiTags('Employee App Body Map')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/visits/:jobId/body-map')
export class EmployeeAppBodyMapController {
  constructor(
    private readonly visitsService: EmployeeAppVisitsService,
    private readonly bodyMap: BodyMapService,
  ) {}

  @Get('wizard')
  @ApiOperation({
    summary: 'Body map wizard bootstrap (mobile)',
    description:
      'Lookups, diagram assets, active records, wizard steps/fields (same as admin Add body map record), eligible MAR lines, and canRecord.',
  })
  wizard(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getBodyMapWizard(user.employeeId!, jobId);
  }

  @Post('wizard/records')
  @ApiOperation({
    summary: 'Save body map record from mobile wizard (admin parity)',
    description:
      'Submit after all wizard steps. Creates the same BodyMapRecord as admin POST /body-map/records and links to this visit for schedule-jobs workspace.',
  })
  submitWizard(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppBodyMapWizardSubmitDto,
  ) {
    return this.visitsService.submitBodyMapWizardRecord(user.employeeId!, jobId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Body map bootstrap (legacy — prefer GET wizard)' })
  bootstrap(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getBodyMap(user.employeeId!, jobId);
  }

  @Post('records')
  @ApiOperation({ summary: 'Create body map record (legacy flat DTO — prefer POST wizard/records)' })
  createRecord(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppCreateBodyMapRecordDto,
  ) {
    return this.visitsService.createBodyMapRecord(user.employeeId!, jobId, dto);
  }

  @Get('patch-rotation-check')
  @ApiOperation({ summary: 'Patch rotation warning for this visit’s client' })
  patchRotation(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Query('bodyView') bodyView: string,
    @Query('x') xRaw: string,
    @Query('y') yRaw: string,
  ) {
    return this.visitsService.patchRotationCheckForVisit(user.employeeId!, jobId, {
      bodyView,
      x: Number(xRaw),
      y: Number(yRaw),
    });
  }

  @Post('records/:recordId/reviews')
  @ApiOperation({ summary: 'Carer visit update — better / same / worse + dressing' })
  addReview(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Param('recordId') recordId: string,
    @Body() dto: CreateBodyMapReviewDto,
  ) {
    return this.visitsService.addBodyMapReview(user.employeeId!, jobId, recordId, dto);
  }

  @Post('videos')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload the video (max 60 s, 100 MB, 1 per record) for a body map record made on this visit',
    description:
      'The record is found by the wizard idempotencyKey, so an offline-queued video uploads after its record. ' +
      '409 BODY_MAP_RECORD_PENDING = record not synced yet (retry); 409 BODY_MAP_VIDEO_LIMIT = record already has a video.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['video', 'recordIdempotencyKey', 'clientVideoId'],
      properties: {
        video: { type: 'string', format: 'binary' },
        thumbnail: { type: 'string', format: 'binary', description: 'JPEG/PNG still made on the phone' },
        recordIdempotencyKey: { type: 'string', description: 'idempotencyKey of the wizard submit' },
        clientVideoId: { type: 'string' },
        originalName: { type: 'string' },
        durationMs: { type: 'number' },
        source: { type: 'string', enum: ['camera', 'gallery'] },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'video', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 },
      ],
      {
        // Disk, not memory: 100 MB files. Private dir; the service moves or deletes them.
        storage: diskStorage({
          destination: (_req, _file, cb) => cb(null, ensureBodyMapVideoIncomingDir()),
          filename: (_req, _file, cb) =>
            cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.upload`),
        }),
        limits: { fileSize: BODY_MAP_VIDEO_MAX_BYTES, files: 2 },
      },
    ),
  )
  uploadVideo(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @UploadedFiles() files: { video?: Express.Multer.File[]; thumbnail?: Express.Multer.File[] },
    @Body()
    body: {
      recordIdempotencyKey?: string;
      clientVideoId?: string;
      originalName?: string;
      durationMs?: string;
      source?: string;
    },
  ) {
    return this.visitsService.uploadBodyMapVideo(user.employeeId!, jobId, files ?? {}, body);
  }

  @Post('records/:recordId/photos')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a consented body-map photo on this visit' })
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
    @Param('jobId') jobId: string,
    @Param('recordId') recordId: string,
    @Body() dto: { consentStatus?: string; caption?: string },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');
    const consent = dto.consentStatus;
    if (
      !consent ||
      !Object.values(BodyMapPhotoConsentStatus).includes(consent as BodyMapPhotoConsentStatus)
    ) {
      throw new BadRequestException('Valid consentStatus is required (GRANTED, DENIED, PENDING)');
    }
    return this.visitsService.uploadBodyMapPhoto(
      user.employeeId!,
      jobId,
      recordId,
      file,
      consent as BodyMapPhotoConsentStatus,
      dto.caption,
    );
  }
}
