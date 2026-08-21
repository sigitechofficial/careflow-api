import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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
import { extname, join } from 'path';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { BodyMapService } from '../body-map/body-map.service';
import { CreateBodyMapReviewDto } from '../body-map/dto/create-body-map-record.dto';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppVisitsService } from './employee-app-visits.service';
import { EmployeeAppBodyMapWizardSubmitDto } from './dto/employee-app-body-map-wizard.dto';
import { EmployeeAppCreateBodyMapRecordDto } from './dto/employee-app-body-map-record.dto';

function ensureBodyMapPhotoDir() {
  const root = join(process.cwd(), process.env.UPLOAD_BASE_PATH ?? 'uploads', 'body-map', 'photos');
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
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
