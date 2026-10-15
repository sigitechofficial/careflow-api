import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { IncidentsService } from '../incidents/incidents.service';
import {
  CARER_INCIDENT_PHOTO_TYPES,
  incidentAttachmentBytesMatchType,
} from '../incidents/incident-attachment.config';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { EmployeeAppClientsService } from './employee-app-clients.service';
import { EmployeeAppVisitsService } from './employee-app-visits.service';
import { validationError } from './employee-app-contract.util';
import type { EmployeeAppStandaloneIncidentDto } from './dto/employee-app-visit-writes.dto';

/**
 * Incidents a carer reports from Me → "Report an incident" when it did not happen during a
 * visit (a car accident between calls, a lost rota sheet, a dog bite before clocking in…).
 * Same questions and rules as a visit report; there is no visit blob, so the register row
 * itself carries the app's entry id (edits) and the last write key (offline retries).
 */
@Injectable()
export class EmployeeAppIncidentsService {
  private readonly logger = new Logger(EmployeeAppIncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly incidents: IncidentsService,
    private readonly clients: EmployeeAppClientsService,
    private readonly visits: EmployeeAppVisitsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async getCatalog() {
    return { data: await this.visits.getIncidentCatalog() };
  }

  async submit(employeeId: string, userId: string, dto: EmployeeAppStandaloneIncidentDto) {
    // Drafts stay on the phone; only finished reports reach the office.
    if (dto.isDraft) validationError('Drafts are kept on the phone');
    const entryId = dto.clientEntryId?.trim();
    if (!entryId) validationError('clientEntryId is required');
    if (dto.serviceUserId) {
      await this.clients.assertClientOnRound(employeeId, dto.serviceUserId);
    }

    const existing = await this.prisma.incident.findFirst({
      where: { appClientEntryId: entryId, deletedAt: null },
      select: { id: true, referenceNumber: true, reporterEmployeeId: true, appLastWriteKey: true },
    });
    if (existing && existing.reporterEmployeeId !== employeeId) {
      throw new ForbiddenException('Only the carer who reported this incident can change it');
    }
    const now = new Date().toISOString();
    const response = (referenceNumber: string, updated: boolean) => ({
      data: {
        incidentId: entryId,
        referenceNumber,
        entryType: 'incident',
        isDraft: false,
        officeNotified: true,
        updated,
        serverConfirmedAt: now,
      },
    });
    // The same save sent again (offline retry): nothing to change.
    if (existing && existing.appLastWriteKey === dto.idempotencyKey) {
      return response(existing.referenceNumber, false);
    }

    const [timeZone, employment] = await Promise.all([
      this.orgSettings.getOperationalTimezone(),
      this.prisma.employeeEmployment.findFirst({
        where: { employeeId },
        select: { locationId: true },
      }),
    ]);
    const params = {
      ...this.visits.buildCarerAppIncidentParams(dto, {
        employeeId,
        userId,
        scheduledJobId: null,
        serviceUserId: dto.serviceUserId ?? null,
        timeZone,
        visitCarerIds: [],
        now,
      }),
      appClientEntryId: entryId,
      appWriteKey: dto.idempotencyKey,
      // No client involved: the incident belongs to the carer's own branch.
      fallbackLocationId: employment?.locationId ?? null,
    };

    if (existing) {
      // Throws 409 once the office has started the review.
      const row = await this.incidents.updateFromCarerApp(existing.id, params);
      return response(row.referenceNumber, true);
    }
    const created = await this.incidents.createFromCarerApp(params);
    this.logger.log(`Carer-app incident (no visit) ${entryId} registered as ${created.referenceNumber}`);
    return response(created.referenceNumber, false);
  }

  async addAttachment(
    employeeId: string,
    entryId: string,
    file: Express.Multer.File | undefined,
    caption?: string,
  ) {
    if (!file) validationError('file is required');
    const mimeType = file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
    const storedExt = CARER_INCIDENT_PHOTO_TYPES[mimeType];
    if (!storedExt || !incidentAttachmentBytesMatchType(file.buffer, mimeType)) {
      validationError('Incident photo must be a JPEG, PNG, WebP or HEIC image');
    }
    const incident = await this.prisma.incident.findFirst({
      where: { appClientEntryId: entryId, deletedAt: null },
      select: { id: true, reporterEmployeeId: true },
    });
    if (!incident) throw new NotFoundException('Incident not found');
    if (incident.reporterEmployeeId !== employeeId) {
      throw new ForbiddenException('Only the carer who reported this incident can add photos');
    }
    // An offline retry of the same photo must not add it twice.
    const duplicate = await this.prisma.incidentAttachment.findFirst({
      where: {
        incidentId: incident.id,
        deletedAt: null,
        originalName: file.originalname,
        fileSize: file.size,
      },
      select: { id: true },
    });
    if (duplicate) return { data: { attachmentId: duplicate.id, duplicate: true } };

    const dir = path.join(process.cwd(), 'uploads', 'employee-app-incidents', 'no-visit', employeeId);
    await fs.mkdir(dir, { recursive: true });
    const abs = path.join(dir, `${randomUUID()}${storedExt}`);
    await fs.writeFile(abs, file.buffer);
    await this.incidents.addCarerAppAttachment(incident.id, {
      sourceAbsolutePath: abs,
      originalName: file.originalname,
      mimeType,
      fileSize: file.size,
      caption: caption ?? null,
    });
    return { data: { attachmentId: randomUUID(), mimeType, sizeBytes: file.size } };
  }
}
