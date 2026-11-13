import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  InitialAssessmentStatus,
  Prisma,
  ServiceUserClinicalDataSource,
  ServiceUserSharingBasis,
  ServiceUserSharingRecipientKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  RecordConsentChangeDto,
  RecordSharingExceptionDto,
  SaveCommunicationNeedsDto,
  SaveSharingAgreementDto,
  StopSharingDto,
} from './dto/service-user-privacy.dto';
import {
  assessmentConsentRows,
  assessmentPrivacyAnswers,
  mergeConsentChanges,
  type ConsentRow,
  communicationNeedsWords,
  dayOf,
  sharingIsActive,
  sharingStatus,
} from './service-user-privacy.util';

const LEGAL_BASES_NEEDING_AUTHORITY: ServiceUserSharingBasis[] = [
  ServiceUserSharingBasis.LPA_HEALTH_WELFARE,
  ServiceUserSharingBasis.DEPUTY,
];

const contactName = (c: { firstName: string; lastName: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(' ').trim();

type AgreementRow = Prisma.ServiceUserSharingAgreementGetPayload<{
  include: { contact: { select: { firstName: true; lastName: true; relationshipType: { select: { name: true } } } } };
}>;

/**
 * A service user's Privacy section: communication needs, who we may share information with (and stopping it), and
 * information shared without consent. Filled first from the initial assessment; every change is audited.
 */
@Injectable()
export class ServiceUserPrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    @Optional() private readonly orgSettings?: OrganisationGeneralSettingsService,
  ) {}

  private async today(): Promise<string> {
    const tz = (await this.orgSettings?.getOperationalTimezone().catch(() => null)) || 'Europe/London';
    return dayKeyInTimeZone(new Date(), tz);
  }

  private async ensureServiceUser(id: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  private mapAgreement(a: AgreementRow, today: string) {
    return {
      id: a.id,
      recipientKind: a.recipientKind,
      contactId: a.contactId,
      recipientName: a.contact ? contactName(a.contact) : a.recipientName,
      recipientRole: a.recipientRole || a.contact?.relationshipType?.name || '',
      categories: a.categories,
      channels: a.channels,
      basis: a.basis,
      legalAuthorityId: a.legalAuthorityId,
      conditions: a.conditions,
      startsOn: dayOf(a.startsOn)!,
      endsOn: dayOf(a.endsOn),
      reviewOn: dayOf(a.reviewOn),
      status: sharingStatus(a, today),
      stoppedAt: a.stoppedAt?.toISOString() ?? null,
      stopReason: a.stopReason,
      source: a.source,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  /** Personal Details → Language, as a name (stored as a lookup code or as typed text). */
  private async firstLanguage(serviceUserId: string): Promise<string | null> {
    const ref = await this.prisma.serviceUserReference.findFirst({
      where: { serviceUserId, referenceType: 'SU_PROFILE_LANGUAGE', deletedAt: null },
      select: { referenceValue: true },
    });
    const raw = ref?.referenceValue?.trim();
    if (!raw) return null;
    const lang = await this.prisma.serviceUserLanguage.findFirst({
      where: { OR: [{ code: { equals: raw, mode: 'insensitive' } }, { name: { equals: raw, mode: 'insensitive' } }] },
      select: { name: true },
    });
    return lang?.name ?? raw;
  }

  /** Everything the Privacy section shows, plus what the latest assessment recorded (to fill it the first time). */
  async get(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const today = await this.today();
    const [needs, agreements, exceptions, contacts, authorities, assessment] = await Promise.all([
      this.prisma.serviceUserCommunicationNeeds.findUnique({
        where: { serviceUserId },
        include: { contactVia: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.serviceUserSharingAgreement.findMany({
        where: { serviceUserId, deletedAt: null },
        include: { contact: { select: { firstName: true, lastName: true, relationshipType: { select: { name: true } } } } },
        orderBy: [{ stoppedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      }),
      this.prisma.serviceUserSharingException.findMany({ where: { serviceUserId }, orderBy: { sharedOn: 'desc' } }),
      this.prisma.serviceUserContact.findMany({
        where: { serviceUserId, deletedAt: null, isActive: true },
        select: { id: true, firstName: true, lastName: true, canReceiveUpdates: true, relationshipType: { select: { name: true } } },
        orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
      }),
      this.prisma.serviceUserLegalAuthority.findMany({
        where: { serviceUserId, deletedAt: null, isActive: true },
        select: { id: true, category: true, holderName: true, verificationStatus: true },
      }),
      this.latestAssessment(serviceUserId),
    ]);
    const [others, changes, firstLanguage] = await Promise.all([
      this.otherConsents(serviceUserId, today),
      this.consentChanges(serviceUserId),
      this.firstLanguage(serviceUserId),
    ]);
    const consents: ConsentRow[] = mergeConsentChanges([...(assessment?.consents ?? []), ...others], changes);
    const { consents: _c, ...assessmentView } = assessment ?? { consents: [] };
    return {
      data: {
        today,
        /** Personal Details → Language (first language); the interpreter language starts from it. */
        firstLanguage,
        needs: needs
          ? {
              interpreterNeeded: needs.interpreterNeeded,
              interpreterLanguage: needs.interpreterLanguage,
              formats: needs.formats,
              hearing: needs.hearing,
              sight: needs.sight,
              contactViaContactId: needs.contactViaContactId,
              notes: needs.notes,
              source: needs.source,
              summary: communicationNeedsWords({
                ...needs,
                contactViaName: needs.contactVia ? contactName(needs.contactVia) : null,
              }),
              updatedAt: needs.updatedAt.toISOString(),
            }
          : null,
        sharing: agreements.map((a) => this.mapAgreement(a, today)),
        exceptions: exceptions.map((e) => ({
          id: e.id,
          sharedOn: dayOf(e.sharedOn)!,
          sharedWith: e.sharedWith,
          whatShared: e.whatShared,
          reason: e.reason,
          decidedBy: e.decidedBy,
          notes: e.notes,
          createdAt: e.createdAt.toISOString(),
        })),
        contacts: contacts.map((c) => ({
          id: c.id,
          name: contactName(c),
          relationship: c.relationshipType?.name ?? '',
          canReceiveUpdates: c.canReceiveUpdates,
        })),
        legalAuthorities: authorities,
        assessment: assessment ? assessmentView : null,
        /** Every consent recorded for the person, from the assessment, visits, photos, surveys and sharing. */
        consents,
      },
    };
  }

  /** The newest submitted assessment's answers on communication and sharing, or null. */
  private async latestAssessment(serviceUserId: string) {
    const sub = await this.prisma.initialAssessmentSubmission.findFirst({
      where: { serviceUserId, status: { in: [InitialAssessmentStatus.SUBMITTED, InitialAssessmentStatus.REVIEWED] } },
      orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { id: true, submittedAt: true, createdAt: true, metadata: true },
    });
    if (!sub) return null;
    const keys = [
      'consentToAssessment',
      'consentMethod',
      'consentMethodOther',
      'consentToAssessmentNoReason',
      'familyInvolvementConsent',
      'consentToCare',
      'hearingLevel', 'sightLevel', 'infoSharingConsent', 'infoSharingWith', 'infoSharingLimits', 'infoSharingRestrictions', 'partialConsentRefusal', 'partialConsentRefusalDetails'];
    const texts = ['Interpreter required?', 'Language required', 'Easy read or large print required?'];
    const rows = await this.prisma.initialAssessmentAnswer.findMany({
      where: {
        submissionId: sub.id,
        question: {
          OR: [
            ...keys.map((fieldKey) => ({ metadata: { path: ['fieldKey'], equals: fieldKey } })),
            { questionText: { in: texts } },
          ],
        },
      },
      select: {
        checked: true,
        booleanValue: true,
        textValue: true,
        selectedOptions: true,
        question: { select: { questionText: true, metadata: true } },
      },
    });
    const byKey = new Map<string, (typeof rows)[number]>();
    const byText = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const key = (r.question.metadata as Record<string, unknown> | null)?.fieldKey;
      if (typeof key === 'string') byKey.set(key, r);
      byText.set(r.question.questionText, r);
    }
    const submittedOn = (sub.submittedAt ?? sub.createdAt).toISOString();
    const metadata = sub.metadata && typeof sub.metadata === 'object' && !Array.isArray(sub.metadata) ? (sub.metadata as Record<string, unknown>) : {};
    return {
      submissionId: sub.id,
      submittedOn,
      ...assessmentPrivacyAnswers({ byKey, byText }),
      consents: assessmentConsentRows(byKey, metadata.capacityDecisions, submittedOn.slice(0, 10)),
    };
  }

  /** Consents recorded outside the assessment: at visits, for photos, about survey contact, and sharing on consent. */
  private async otherConsents(serviceUserId: string, today: string): Promise<ConsentRow[]> {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const [visitCounts, lastDeclined, bodyMapPhotos, obsPhotos, optOuts, sharing] = await Promise.all([
      this.prisma.visitCareConsent.groupBy({
        by: ['status'],
        where: { serviceUserId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.visitCareConsent.findFirst({
        where: { serviceUserId, status: 'DECLINED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, reason: true },
      }),
      this.prisma.bodyMapPhoto.groupBy({
        by: ['consentStatus'],
        where: { bodyMapRecord: { serviceUserId } },
        _count: { _all: true },
      }),
      this.prisma.serviceUserObservationPhoto.groupBy({
        by: ['consentStatus'],
        where: { observation: { serviceUserId } },
        _count: { _all: true },
      }),
      this.prisma.surveyContactOptOut.findMany({
        where: { subjectKind: 'SERVICE_USER', subjectId: serviceUserId },
        select: { channel: true, reason: true, createdAt: true },
      }),
      this.prisma.serviceUserSharingAgreement.findMany({
        where: { serviceUserId, deletedAt: null, basis: 'CONSENT' },
        select: { recipientName: true, startsOn: true, endsOn: true, stoppedAt: true },
      }),
    ]);
    const rows: ConsentRow[] = [];
    const count = (list: Array<{ _count: { _all: number } } & Record<string, unknown>>, key: string, v: string) =>
      list.find((x) => x[key] === v)?._count._all ?? 0;
    const granted = count(visitCounts, 'status', 'GRANTED');
    const declined = count(visitCounts, 'status', 'DECLINED');
    if (granted || declined || lastDeclined) {
      rows.push({
        key: 'visits',
        title: 'Consent to care at each visit',
        answer: 'RECORDED',
        detail: [
          `Last 90 days: given at ${granted} ${granted === 1 ? 'visit' : 'visits'}, declined at ${declined}.`,
          lastDeclined ? `Last declined ${dayOf(lastDeclined.createdAt)}${lastDeclined.reason ? `: ${lastDeclined.reason}` : ''}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
        on: lastDeclined ? dayOf(lastDeclined.createdAt) : null,
        source: 'VISITS',
      });
    }
    const photo = (v: string) => count(bodyMapPhotos, 'consentStatus', v) + count(obsPhotos, 'consentStatus', v);
    if (photo('GRANTED') + photo('DENIED') + photo('PENDING')) {
      rows.push({
        key: 'photos',
        title: 'Photographs (body map and observations)',
        answer: photo('DENIED') ? 'PARTLY' : 'RECORDED',
        detail: `Consent given for ${photo('GRANTED')}, refused for ${photo('DENIED')}, not yet asked for ${photo('PENDING')}.`,
        on: null,
        source: 'PHOTOS',
      });
    }
    const channelWords: Record<string, string> = { ALL: 'all surveys', EMAIL: 'email', TEXT: 'text messages', APP: 'the app', PORTAL: 'portal emails', PHONE: 'phone calls' };
    rows.push({
      key: 'survey-contact',
      title: 'Being contacted about surveys',
      answer: optOuts.some((o) => o.channel === 'ALL') ? 'REFUSED' : optOuts.length ? 'PARTLY' : 'GIVEN',
      detail: optOuts.length
        ? `Asked not to be contacted by ${optOuts.map((o) => channelWords[o.channel] ?? o.channel.toLowerCase()).join(', ')}.${optOuts.find((o) => o.reason)?.reason ? ` ${optOuts.find((o) => o.reason)!.reason}` : ''}`
        : 'No limits recorded.',
      on: optOuts.length ? dayOf(optOuts.map((o) => o.createdAt).sort().reverse()[0]) : null,
      source: 'SURVEYS',
    });
    for (const a of sharing) {
      const active = sharingIsActive(a, today);
      rows.push({
        key: `sharing-${a.recipientName}-${dayOf(a.startsOn)}`,
        title: `Sharing with ${a.recipientName}`,
        answer: active ? 'GIVEN' : 'REFUSED',
        detail: active ? `Agreed from ${dayOf(a.startsOn)}${a.endsOn ? ` until ${dayOf(a.endsOn)}` : ''}.` : a.stoppedAt ? `Stopped ${dayOf(a.stoppedAt)}.` : 'Ended.',
        on: dayOf(a.stoppedAt ?? a.startsOn),
        source: 'SHARING',
      });
    }
    return rows;
  }

  /** Every consent change recorded on the profile, with who recorded it. */
  private async consentChanges(serviceUserId: string) {
    const rows = await this.prisma.serviceUserConsentChange.findMany({ where: { serviceUserId }, orderBy: { createdAt: 'desc' } });
    const ids = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => Boolean(x)))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const name = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]));
    return rows.map((r) => ({ ...r, recordedBy: r.createdById ? (name.get(r.createdById) ?? null) : null }));
  }

  /** A consent given, changed or withdrawn: a new row (the earlier answer stays as history). */
  async recordConsent(userId: string, serviceUserId: string, dto: RecordConsentChangeDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    const title = (dto.title ?? '').trim();
    if (dto.topic === 'OTHER' && !title) throw new BadRequestException('Say what the consent is about.');
    const today = await this.today();
    if (dto.decidedOn > today) throw new BadRequestException('The date cannot be in the future.');
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceUserConsentChange.create({
        data: {
          serviceUserId,
          topic: dto.topic,
          title: dto.topic === 'OTHER' ? title : '',
          answer: dto.answer,
          method: dto.method ?? '',
          givenBy: (dto.givenBy ?? '').trim(),
          details: (dto.details ?? '').trim(),
          decidedOn: new Date(`${dto.decidedOn}T00:00:00.000Z`),
          createdById: userId,
        },
      });
      await this.log(tx, userId, AuditAction.SERVICE_USER_CONSENT_RECORDED, 'ServiceUserConsentChange', row.id, meta, null, row);
    });
    return { message: 'Consent recorded' };
  }

  async saveNeeds(userId: string, serviceUserId: string, dto: SaveCommunicationNeedsDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    if (dto.contactViaContactId) await this.ensureContact(serviceUserId, dto.contactViaContactId);
    const data = {
      interpreterNeeded: dto.interpreterNeeded,
      interpreterLanguage: dto.interpreterNeeded ? (dto.interpreterLanguage ?? '').trim() : '',
      formats: [...new Set(dto.formats)],
      hearing: (dto.hearing ?? '').trim(),
      sight: (dto.sight ?? '').trim(),
      contactViaContactId: dto.contactViaContactId ?? null,
      notes: (dto.notes ?? '').trim(),
      ...(dto.fromAssessmentId
        ? { source: ServiceUserClinicalDataSource.INITIAL_ASSESSMENT, sourceSubmissionId: dto.fromAssessmentId }
        : { source: ServiceUserClinicalDataSource.MANUAL }),
      updatedById: userId,
    };
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserCommunicationNeeds.findUnique({ where: { serviceUserId } });
      const saved = await tx.serviceUserCommunicationNeeds.upsert({
        where: { serviceUserId },
        create: { serviceUserId, ...data, createdById: userId },
        update: data,
      });
      await this.log(tx, userId, AuditAction.SERVICE_USER_COMMUNICATION_NEEDS_SAVED, 'ServiceUserCommunicationNeeds', saved.id, meta, before, saved);
    });
    return { message: 'Communication needs saved' };
  }

  async createSharing(userId: string, serviceUserId: string, dto: SaveSharingAgreementDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    const data = await this.sharingData(serviceUserId, dto);
    const today = await this.today();
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceUserSharingAgreement.create({
        data: { serviceUserId, ...data, createdById: userId, updatedById: userId },
      });
      await this.syncContactUpdates(tx, userId, serviceUserId, row.contactId, today);
      await this.log(tx, userId, AuditAction.SERVICE_USER_SHARING_ADDED, 'ServiceUserSharingAgreement', row.id, meta, null, row);
      return row;
    });
    return { message: 'Sharing recorded', data: { id: created.id } };
  }

  async updateSharing(userId: string, serviceUserId: string, id: string, dto: SaveSharingAgreementDto, meta?: RequestAuditMeta) {
    const before = await this.findSharing(serviceUserId, id);
    if (before.stoppedAt) throw new BadRequestException('Sharing has been stopped. Add a new line to share again.');
    const data = await this.sharingData(serviceUserId, dto);
    const today = await this.today();
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceUserSharingAgreement.update({ where: { id }, data: { ...data, updatedById: userId } });
      await this.syncContactUpdates(tx, userId, serviceUserId, before.contactId, today);
      if (row.contactId !== before.contactId) await this.syncContactUpdates(tx, userId, serviceUserId, row.contactId, today);
      await this.log(tx, userId, AuditAction.SERVICE_USER_SHARING_UPDATED, 'ServiceUserSharingAgreement', id, meta, before, row);
    });
    return { message: 'Sharing updated' };
  }

  /** Stop sharing now: kept as history with who stopped it and why. A contact with no other sharing stops getting updates. */
  async stopSharing(userId: string, serviceUserId: string, id: string, dto: StopSharingDto, meta?: RequestAuditMeta) {
    const before = await this.findSharing(serviceUserId, id);
    if (before.stoppedAt) throw new BadRequestException('Sharing is already stopped.');
    const today = await this.today();
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceUserSharingAgreement.update({
        where: { id },
        data: { stoppedAt: new Date(), stoppedById: userId, stopReason: dto.reason.trim(), updatedById: userId },
      });
      await this.syncContactUpdates(tx, userId, serviceUserId, row.contactId, today);
      await this.log(tx, userId, AuditAction.SERVICE_USER_SHARING_STOPPED, 'ServiceUserSharingAgreement', id, meta, before, row);
    });
    return { message: 'Sharing stopped' };
  }

  /** Remove a line entered by mistake (not to stop sharing: that is Stop, which keeps the history). */
  async removeSharing(userId: string, serviceUserId: string, id: string, meta?: RequestAuditMeta) {
    const before = await this.findSharing(serviceUserId, id);
    const today = await this.today();
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceUserSharingAgreement.update({ where: { id }, data: { deletedAt: new Date(), deletedById: userId } });
      await this.syncContactUpdates(tx, userId, serviceUserId, before.contactId, today);
      await this.log(tx, userId, AuditAction.SERVICE_USER_SHARING_REMOVED, 'ServiceUserSharingAgreement', id, meta, before, null);
    });
    return { message: 'Removed' };
  }

  async recordException(userId: string, serviceUserId: string, dto: RecordSharingExceptionDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceUserSharingException.create({
        data: {
          serviceUserId,
          sharedOn: new Date(`${dto.sharedOn}T00:00:00.000Z`),
          sharedWith: dto.sharedWith.trim(),
          whatShared: dto.whatShared.trim(),
          reason: dto.reason,
          decidedBy: dto.decidedBy.trim(),
          notes: (dto.notes ?? '').trim(),
          createdById: userId,
        },
      });
      await this.log(tx, userId, AuditAction.SERVICE_USER_SHARING_EXCEPTION_RECORDED, 'ServiceUserSharingException', row.id, meta, null, row);
    });
    return { message: 'Recorded' };
  }

  private async findSharing(serviceUserId: string, id: string) {
    const row = await this.prisma.serviceUserSharingAgreement.findFirst({ where: { id, serviceUserId, deletedAt: null } });
    if (!row) throw new NotFoundException('Sharing not found');
    return row;
  }

  private async ensureContact(serviceUserId: string, contactId: string) {
    const c = await this.prisma.serviceUserContact.findFirst({
      where: { id: contactId, serviceUserId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!c) throw new BadRequestException('Choose one of this person’s contacts.');
    return c;
  }

  private async sharingData(serviceUserId: string, dto: SaveSharingAgreementDto) {
    let recipientName = (dto.recipientName ?? '').trim();
    let contactId: string | null = null;
    if (dto.recipientKind === ServiceUserSharingRecipientKind.CONTACT) {
      const c = await this.ensureContact(serviceUserId, dto.contactId!);
      contactId = c.id;
      recipientName = contactName(c);
    }
    if (!recipientName) throw new BadRequestException('Say who information is shared with.');
    if (!dto.categories.length) throw new BadRequestException('Choose what may be shared.');
    if (dto.endsOn && dto.endsOn < dto.startsOn) throw new BadRequestException('The end date is before the start date.');
    let legalAuthorityId: string | null = null;
    if (LEGAL_BASES_NEEDING_AUTHORITY.includes(dto.basis) && dto.legalAuthorityId) {
      const a = await this.prisma.serviceUserLegalAuthority.findFirst({
        where: { id: dto.legalAuthorityId, serviceUserId, deletedAt: null },
        select: { id: true },
      });
      if (!a) throw new BadRequestException('Choose one of this person’s legal authorities.');
      legalAuthorityId = a.id;
    }
    const day = (v?: string | null) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
    return {
      recipientKind: dto.recipientKind,
      contactId,
      recipientName,
      recipientRole: (dto.recipientRole ?? '').trim(),
      // "Everything" covers the care categories; Surveys is kept alongside it.
      categories: dto.categories.includes('ALL')
        ? ['ALL', ...(dto.categories.includes('SURVEYS') ? ['SURVEYS'] : [])]
        : [...new Set(dto.categories)],
      channels: [...new Set(dto.channels)],
      basis: dto.basis,
      legalAuthorityId,
      conditions: (dto.conditions ?? '').trim(),
      startsOn: day(dto.startsOn)!,
      endsOn: day(dto.endsOn),
      reviewOn: day(dto.reviewOn),
    };
  }

  /**
   * Keep the contact's "Can receive updates" in step with their sharing lines: ticked while one is active, unticked
   * once the last one stops or ends. Contacts with no sharing lines at all are left as staff set them.
   */
  private async syncContactUpdates(tx: Prisma.TransactionClient, userId: string, serviceUserId: string, contactId: string | null, today: string) {
    if (!contactId) return;
    const lines = await tx.serviceUserSharingAgreement.findMany({
      where: { serviceUserId, contactId, deletedAt: null },
      select: { startsOn: true, endsOn: true, stoppedAt: true, categories: true },
    });
    // A surveys-only line says nothing about care updates.
    const careLines = lines.filter((l) => l.categories.some((c) => c !== 'SURVEYS'));
    if (!careLines.length) return;
    const canReceiveUpdates = careLines.some((l) => sharingIsActive(l, today));
    const contact = await tx.serviceUserContact.findUnique({ where: { id: contactId }, select: { canReceiveUpdates: true } });
    if (!contact || contact.canReceiveUpdates === canReceiveUpdates) return;
    await tx.serviceUserContact.update({ where: { id: contactId }, data: { canReceiveUpdates, updatedById: userId } });
  }

  private async log(
    tx: Prisma.TransactionClient,
    userId: string,
    action: AuditAction,
    recordType: string,
    recordId: string,
    meta: RequestAuditMeta | undefined,
    before: unknown,
    after: unknown,
  ) {
    const plain = (v: unknown) => (v ? (JSON.parse(JSON.stringify(v)) as Record<string, unknown>) : undefined);
    await this.audit.logAudit({
      tx,
      userId,
      module: AuditModule.SERVICE_USER,
      action,
      recordType,
      recordId,
      oldValues: plain(before),
      newValues: plain(after),
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
  }
}
