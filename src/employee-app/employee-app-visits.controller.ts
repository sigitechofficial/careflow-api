import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { getRequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SaveVisitJobTasksDto } from '../scheduled-jobs-housekeeping/dto/save-visit-job-tasks.dto';
import { EmployeeAppAuthGuard } from './guards/employee-app-auth.guard';
import { EmployeeAppVisitsService } from './employee-app-visits.service';
import { EmployeeAppVisitCheckInDto } from './dto/employee-app-visit-check-in.dto';
import { EmployeeAppAreaPresenceDto } from './dto/employee-app-area-presence.dto';
import { EmployeeAppSosDto } from './dto/employee-app-sos.dto';
import { EmployeeAppCheckInMethodRequestDto } from './dto/employee-app-check-in-method-request.dto';
import { EmployeeAppVisitCompleteDto } from './dto/employee-app-visit-complete.dto';
import {
  EmployeeAppHandoverAcknowledgeDto,
  EmployeeAppIdentityDto,
  EmployeeAppIncidentDto,
  EmployeeAppLogConcernDto,
  EmployeeAppLogHandoverDto,
  EmployeeAppLogNoteDto,
  EmployeeAppMedicationAdminDto,
  EmployeeAppObservationWriteDto,
  EmployeeAppSaveTaskDto,
  EmployeeAppUnableToStartDto,
  EmployeeAppCareConsentDto,
} from './dto/employee-app-visit-writes.dto';
import { EmployeeAppCoCarerPresenceDto } from './dto/employee-app-co-carer-presence.dto';

@ApiTags('Employee App Visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EmployeeAppAuthGuard)
@Controller('employee-app/visits')
export class EmployeeAppVisitsController {
  constructor(private readonly visitsService: EmployeeAppVisitsService) {}

  @Get(':jobId')
  @ApiOperation({ summary: 'Visit workspace shell + overview tab' })
  workspace(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getWorkspace(user.employeeId!, jobId);
  }

  @Get(':jobId/details')
  @ApiOperation({
    summary: 'Complete visit details bootstrap',
    description:
      'Returns the shared visit shell plus overview, tasks, MAR, observations, log, and body-map bootstrap (lookups, active records, diagram catalog) in one snapshot. Includes `data.unableToStart`, `data.careConsent`, clock-in/out reason catalogues, and `data.visitOutcomes` (medication pills from MAR status codes plus nested reasons; task / observation outcomes from Settings).',
  })
  details(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getVisitDetails(user.employeeId!, jobId);
  }

  @Get(':jobId/care-consent')
  @ApiOperation({ summary: 'Visit-level consent to care (lead records)' })
  getCareConsent(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getCareConsentForJob(user.employeeId!, jobId);
  }

  @Post(':jobId/care-consent')
  @ApiOperation({
    summary: 'Record consent to care for this visit',
    description:
      'One row per visit (lead records). Clock-in required. DECLINED requires reason. Upserts if already recorded.',
  })
  saveCareConsent(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppCareConsentDto,
  ) {
    return this.visitsService.saveCareConsent(user.employeeId!, jobId, dto);
  }

  @Post(':jobId/area-presence')
  @ApiOperation({
    summary: 'Report mid-visit geofence presence',
    description:
      'After clock-in, send current GPS (or outsideArea for sim). Outside the visit area creates a lock and ECM exception.',
  })
  reportAreaPresence(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppAreaPresenceDto,
  ) {
    return this.visitsService.reportAreaPresence(user.employeeId!, jobId, dto);
  }

  @Post(':jobId/sos')
  @ApiOperation({
    summary: 'Send a carer SOS alert with optional GPS and message',
    description:
      'Does not require clock-in. Each send creates a new CARER_SOS exception. Empty message is allowed. GPS failure still creates the alert. Rejected when the visit is completed, cancelled, called off, or missed.',
  })
  sendSos(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppSosDto,
  ) {
    return this.visitsService.sendSos(user.employeeId!, jobId, dto);
  }

  @Post(':jobId/check-in-method-request')
  @ApiOperation({
    summary: 'Request office to enable Manual check-in for this visit',
    description:
      'GPS-only organisations. Creates an ECM exception. Office authorise enables Manual for this carer, this visit, this operational day only. Does not change organisation settings.',
  })
  requestCheckInMethod(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppCheckInMethodRequestDto,
  ) {
    return this.visitsService.requestCheckInMethod(user.employeeId!, jobId, dto);
  }

  @Post(':jobId/check-in')
  @ApiOperation({ summary: 'Check in to visit (GPS + identity confirmation)' })
  checkIn(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppVisitCheckInDto,
  ) {
    return this.visitsService.checkIn(user.employeeId!, jobId, dto);
  }

  @Post(':jobId/unable-to-start')
  @ApiOperation({
    summary: 'Report unable to start visit (post check-in, API-10)',
    description:
      'Lead only on double-up visits. Carer must already be checked in. Records care-not-delivered (visit COMPLETED + careNotDelivered). reasonCode must match GET details → data.unableToStart.reasons[].code. No GPS required.',
  })
  unableToStart(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppUnableToStartDto,
  ) {
    return this.visitsService.unableToStart(user.employeeId!, jobId, dto);
  }

  @Post(':jobId/co-carers/:employeeId/presence')
  @ApiOperation({
    summary: 'Mark co-carer arrived / left (double-up presence sync)',
    description:
      'Either allocated carer may mark a partner present or left for two-person task UI. Does not replace check-in/out and does not block lead task completion. Reflected on next GET details under shell.coCarers[].present / arrivedAt / leftAt.',
  })
  setCoCarerPresence(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Param('employeeId') employeeId: string,
    @Body() dto: EmployeeAppCoCarerPresenceDto,
  ) {
    return this.visitsService.setCoCarerPresence(
      user.employeeId!,
      jobId,
      employeeId,
      dto,
    );
  }

  @Get(':jobId/tasks')
  @ApiOperation({ summary: 'Visit tasks tab (required + optional)' })
  tasks(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getTasks(user.employeeId!, jobId);
  }

  @Patch(':jobId/tasks')
  @ApiOperation({ summary: 'Save visit task completions (bulk)' })
  saveTasks(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: SaveVisitJobTasksDto,
  ) {
    return this.visitsService.saveTasks(user.employeeId!, jobId, dto);
  }

  @Put(':jobId/tasks/:taskId')
  @ApiOperation({ summary: 'Save a single task outcome (API-11)' })
  saveTask(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Param('taskId') taskId: string,
    @Body() dto: EmployeeAppSaveTaskDto,
  ) {
    return this.visitsService.saveTask(user.employeeId!, jobId, taskId, dto);
  }

  @Get(':jobId/medication')
  @ApiOperation({ summary: 'Visit MAR tab (scheduled + PRN medicines)' })
  medication(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getMedication(user.employeeId!, jobId);
  }

  @Post(':jobId/medication/:medicationKey/administrations')
  @ApiOperation({ summary: 'Record MAR administration (API-12)' })
  recordMedicationAdministration(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Param('medicationKey') medicationKey: string,
    @Body() dto: EmployeeAppMedicationAdminDto,
  ) {
    return this.visitsService.recordMedicationAdministration(
      user.employeeId!,
      jobId,
      decodeURIComponent(medicationKey),
      dto,
    );
  }

  @Get(':jobId/observations')
  @ApiOperation({ summary: 'Visit observations tab' })
  observations(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getObservations(user.employeeId!, jobId);
  }

  @Post(':jobId/observations')
  @ApiOperation({ summary: 'Record an observation during this visit (API-13)' })
  createObservation(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppObservationWriteDto,
  ) {
    return this.visitsService.createObservationContract(user.employeeId!, jobId, dto);
  }

  @Patch(':jobId/observations/:observationId')
  @ApiOperation({ summary: 'Update / correct an observation (API-14)' })
  updateObservation(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Param('observationId') observationId: string,
    @Body() dto: EmployeeAppObservationWriteDto,
  ) {
    return this.visitsService.updateObservationContract(
      user.employeeId!,
      jobId,
      observationId,
      dto,
    );
  }

  @Post(':jobId/observations/:observationId/photos')
  @ApiOperation({ summary: 'Attach a consented clinical photo to a visit observation' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'idempotencyKey', 'consentStatus'],
      properties: {
        file: { type: 'string', format: 'binary' },
        idempotencyKey: { type: 'string' },
        clientPhotoId: { type: 'string' },
        consentStatus: { type: 'string', enum: ['GRANTED', 'DENIED', 'PENDING'] },
        caption: { type: 'string' },
        capturedAt: { type: 'string' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  addObservationPhoto(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Param('observationId') observationId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      idempotencyKey?: string;
      clientPhotoId?: string;
      consentStatus?: string;
      caption?: string;
      capturedAt?: string;
    },
  ) {
    return this.visitsService.addObservationPhoto(
      user.employeeId!,
      jobId,
      observationId,
      file,
      body,
    );
  }

  @Get(':jobId/log')
  @ApiOperation({ summary: 'Visit log tab (timeline + handover note)' })
  log(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getLog(user.employeeId!, jobId);
  }

  @Post(':jobId/log/notes')
  @ApiOperation({ summary: 'Add visit log note (API-15)' })
  createLogNote(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppLogNoteDto,
  ) {
    return this.visitsService.createLogNote(user.employeeId!, jobId, dto);
  }

  @Post(':jobId/log/handover')
  @ApiOperation({ summary: 'Save handover note (API-16)' })
  createLogHandover(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppLogHandoverDto,
  ) {
    return this.visitsService.createLogHandover(user.employeeId!, jobId, dto);
  }

  @Post(':jobId/log/concerns')
  @ApiOperation({ summary: 'Raise concern (API-17)' })
  createLogConcern(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppLogConcernDto,
  ) {
    return this.visitsService.createLogConcern(user.employeeId!, jobId, dto);
  }

  @Post(':jobId/incidents')
  @ApiOperation({ summary: 'Report incident (API-18)' })
  createIncident(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppIncidentDto,
  ) {
    return this.visitsService.createIncident(user.employeeId!, jobId, dto);
  }

  @Post(':jobId/incidents/:incidentId/attachments')
  @ApiOperation({ summary: 'Attach incident photo (API-19)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'idempotencyKey'],
      properties: {
        file: { type: 'string', format: 'binary' },
        idempotencyKey: { type: 'string' },
        clientAttachmentId: { type: 'string' },
        capturedAt: { type: 'string' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  addIncidentAttachment(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Param('incidentId') incidentId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      idempotencyKey?: string;
      clientAttachmentId?: string;
      capturedAt?: string;
    },
  ) {
    return this.visitsService.addIncidentAttachment(
      user.employeeId!,
      jobId,
      incidentId,
      file,
      body.idempotencyKey ?? '',
      body.clientAttachmentId,
      body.capturedAt,
    );
  }

  @Post(':jobId/identity')
  @ApiOperation({ summary: 'Identity confirmation audit (API-20)' })
  recordIdentity(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppIdentityDto,
  ) {
    return this.visitsService.recordIdentity(user.employeeId!, jobId, dto);
  }

  @Post(':jobId/handover/acknowledge')
  @ApiOperation({ summary: 'Acknowledge last handover (API-21)' })
  acknowledgeHandover(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppHandoverAcknowledgeDto,
  ) {
    return this.visitsService.acknowledgeHandover(user.employeeId!, jobId, dto);
  }

  @Get(':jobId/completion-options')
  @ApiOperation({
    summary: 'Visit completion options (outcomes + checklist + timing reasons)',
    description:
      'Bootstrap for the carer Record visit screen — allowed outcomes, timing exception reasons, planned/actual times, and whether this visit has tasks / medications / observations / body-map items (with completion progress).',
  })
  completionOptions(@CurrentUser() user: RequestUser, @Param('jobId') jobId: string) {
    return this.visitsService.getCompletionOptions(user.employeeId!, jobId);
  }

  @Post(':jobId/complete')
  @ApiOperation({
    summary: 'Complete / partially complete / miss visit',
    description:
      'Same core flow as admin schedule-jobs Record visit. Set `status` or contract `visitOutcome`. COMPLETED / fully_delivered enforces task/med gates.',
  })
  complete(
    @CurrentUser() user: RequestUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmployeeAppVisitCompleteDto,
    @Req() req: Request,
  ) {
    void getRequestAuditMeta(req);
    return this.visitsService.complete(user.employeeId!, jobId, dto);
  }
}
