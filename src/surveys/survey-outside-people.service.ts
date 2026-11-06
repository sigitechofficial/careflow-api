import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SurveyStatus, SurveyTargetKind, type Survey } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { MailService } from '../mail/mail.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { TextMessageService } from '../text-messages/text-message.service';
import { normaliseUkMobile } from '../text-messages/uk-mobile.util';
import { DEFAULT_OPERATIONAL_TIMEZONE, dayKeyInTimeZone } from '../common/utils/operational-day.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { surveyVisibleInScope } from './survey-scope.util';
import { SurveyContactRuleService } from './survey-contact-rule.service';
import { freeFromDay, librarySentWith } from './survey-contact-rule.util';
import { SURVEY_UNSUBSCRIBE_REASON, outsideContactBlocks } from './survey-eligibility.util';
import { surveyContactMessages } from './survey-contact-messages.util';
import { surveyEmailBranding, surveyEmailFacts } from './survey-email-branding';
import { readContactPlan } from './survey-contact-plan.util';
import { formatSurveyDateTime } from './survey-recurrence.util';
import { personalLinkPath } from './survey-recipient-links.service';

export const EXTERNAL_CONTACT_KINDS = ['FAMILY', 'PROFESSIONAL', 'COMMISSIONER', 'OTHER'] as const;
export type ExternalContactKind = (typeof EXTERNAL_CONTACT_KINDS)[number];
export const EXTERNAL_SOURCES = ['TYPED', 'SERVICE_USER_CONTACT', 'FUNDER', 'PATHWAY_PROFESSIONAL'] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ContactInput = {
  kind: ExternalContactKind;
  name: string;
  organisation?: string | null;
  role?: string | null;
  email?: string | null;
  mobile?: string | null;
  phone?: string | null;
  locationIds?: string[];
};

/** Check a typed contact. Email or mobile needed to send; a phone alone is enough for a call or paper. */
export function checkContactInput(input: ContactInput): { ok: true; value: ContactInput } | { ok: false; message: string } {
  const name = input.name?.trim() ?? '';
  if (name.length < 2 || name.length > 120) return { ok: false, message: 'Enter their name (2 to 120 characters).' };
  if (!(EXTERNAL_CONTACT_KINDS as readonly string[]).includes(input.kind)) return { ok: false, message: 'Choose who they are.' };
  const email = input.email?.trim() || null;
  if (email && (!EMAIL.test(email) || email.length > 200)) return { ok: false, message: 'Enter a valid email address.' };
  const mobileRaw = input.mobile?.trim() || null;
  const mobile = mobileRaw ? normaliseUkMobile(mobileRaw) : null;
  if (mobileRaw && !mobile) return { ok: false, message: 'Enter a UK mobile number (07…), or leave it empty.' };
  const phone = input.phone?.trim() || null;
  if (!email && !mobile && !phone) return { ok: false, message: 'Add an email address, a mobile or a phone number.' };
  const text = (v: string | null | undefined, max: number) => (v?.trim() ? v.trim().slice(0, max) : null);
  return {
    ok: true,
    value: { kind: input.kind, name, organisation: text(input.organisation, 160), role: text(input.role, 120), email, mobile, phone: text(phone, 40), locationIds: input.locationIds ?? [] },
  };
}

type ExternalRow = Prisma.SurveyExternalContactGetPayload<object>;

/**
 * Outside people (Phase 2 part 4): families from People involved (with consent to be contacted), professionals
 * and commissioners typed in once or taken from records CareFlow keeps (funders, pathway professionals), reusable
 * lists, and named public surveys sent to them with their own links. Opt-outs (CONTACT, EXTERNAL) are honoured
 * everywhere; the 4-week rule counts each outside person as one real person. Anonymous public surveys never get
 * personal links (a link shows whether its holder answered).
 */
@Injectable()
export class SurveyOutsidePeopleService {
  private readonly logger = new Logger(SurveyOutsidePeopleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly texts: TextMessageService,
    @Optional() private readonly contactRule?: SurveyContactRuleService,
    @Optional() private readonly orgSettings?: OrganisationGeneralSettingsService,
  ) {}

  private async timeZone(): Promise<string> {
    try {
      return (await this.orgSettings?.getOperationalTimezone()) || DEFAULT_OPERATIONAL_TIMEZONE;
    } catch {
      return DEFAULT_OPERATIONAL_TIMEZONE;
    }
  }

  // ─── Visibility ──────────────────────────────────────────────────────────

  /** Contacts in the actor's branches, plus organisation-wide ones (no branch). */
  private contactScopeWhere(actor: RequestUser): Prisma.SurveyExternalContactWhereInput {
    const scope = this.orgScope.fromRequestUser(actor);
    if (!scope.locationIds) return {};
    return { OR: [{ locationIds: { isEmpty: true } }, { locationIds: { hasSome: scope.locationIds } }] };
  }

  /** Changing a contact: unrestricted, or every one of its branches is the actor's (never an organisation-wide one). */
  private mayChange(actor: RequestUser, locationIds: string[]): boolean {
    const scope = this.orgScope.fromRequestUser(actor);
    if (!scope.locationIds) return true;
    return locationIds.length > 0 && locationIds.every((l) => scope.locationIds!.includes(l));
  }

  private async optOuts(rows: Array<{ id: string; sourceType: string; sourceId: string | null }>): Promise<Map<string, Set<string>>> {
    const map = new Map<string, Set<string>>();
    if (!rows.length) return map;
    const contactIds = rows.filter((r) => r.sourceType === 'SERVICE_USER_CONTACT' && r.sourceId).map((r) => r.sourceId!);
    const found = await this.prisma.surveyContactOptOut.findMany({
      where: {
        OR: [
          { subjectKind: 'EXTERNAL', subjectId: { in: rows.map((r) => r.id) } },
          ...(contactIds.length ? [{ subjectKind: 'CONTACT', subjectId: { in: contactIds } }] : []),
        ],
      },
      select: { subjectKind: true, subjectId: true, channel: true },
    });
    for (const r of rows) {
      const set = new Set<string>();
      for (const o of found) {
        if ((o.subjectKind === 'EXTERNAL' && o.subjectId === r.id) || (o.subjectKind === 'CONTACT' && o.subjectId === r.sourceId)) set.add(o.channel);
      }
      if (set.size) map.set(r.id, set);
    }
    return map;
  }

  // ─── Contacts ────────────────────────────────────────────────────────────

  async listContacts(actor: RequestUser, query: { search?: string; kind?: string; listId?: string } = {}) {
    const q = query.search?.trim();
    const rows = await this.prisma.surveyExternalContact.findMany({
      where: {
        AND: [
          { deletedAt: null },
          this.contactScopeWhere(actor),
          ...(query.kind ? [{ kind: query.kind }] : []),
          ...(query.listId ? [{ lists: { some: { listId: query.listId } } }] : []),
          ...(q
            ? [{ OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { organisation: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }] }]
            : []),
        ],
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      take: 500,
      include: { lists: { select: { listId: true } } },
    });
    const opt = await this.optOuts(rows);
    return {
      message: 'Outside people',
      data: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        organisation: r.organisation,
        role: r.role,
        email: r.email,
        mobile: r.mobile,
        phone: r.phone,
        sourceType: r.sourceType,
        serviceUserId: r.serviceUserId,
        locationIds: r.locationIds,
        listIds: r.lists.map((l) => l.listId),
        optedOut: [...(opt.get(r.id) ?? [])],
        canChange: this.mayChange(actor, r.locationIds) && r.sourceType === 'TYPED',
      })),
    };
  }

  async createContact(actor: RequestUser, input: ContactInput, meta?: RequestAuditMeta) {
    const checked = checkContactInput(input);
    if (!checked.ok) throw new BadRequestException(checked.message);
    const scope = this.orgScope.fromRequestUser(actor);
    const locationIds = checked.value.locationIds?.length ? checked.value.locationIds : scope.locationIds ?? [];
    if (!this.mayChange(actor, locationIds)) throw new BadRequestException('Choose branches you work in.');
    const row = await this.prisma.surveyExternalContact.create({
      data: { ...checked.value, locationIds, sourceType: 'TYPED', createdById: actor.id, updatedById: actor.id },
    });
    await this.auditContact(actor, row.id, 'added', meta);
    return { message: 'Added', data: { id: row.id } };
  }

  async updateContact(actor: RequestUser, id: string, input: ContactInput, meta?: RequestAuditMeta) {
    const row = await this.requireContact(actor, id);
    if (row.sourceType !== 'TYPED') throw new BadRequestException('This person’s details come from their record in CareFlow: change them there.');
    if (!this.mayChange(actor, row.locationIds)) throw new BadRequestException('Only people who manage all of this contact’s branches can change it.');
    const checked = checkContactInput(input);
    if (!checked.ok) throw new BadRequestException(checked.message);
    const locationIds = checked.value.locationIds?.length ? checked.value.locationIds : row.locationIds;
    if (!this.mayChange(actor, locationIds)) throw new BadRequestException('Choose branches you work in.');
    await this.prisma.surveyExternalContact.update({ where: { id }, data: { ...checked.value, locationIds, updatedById: actor.id } });
    await this.auditContact(actor, id, 'changed', meta);
    return { message: 'Saved', data: { id } };
  }

  async removeContact(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    const row = await this.requireContact(actor, id);
    if (!this.mayChange(actor, row.locationIds) && row.sourceType === 'TYPED') throw new BadRequestException('Only people who manage all of this contact’s branches can remove it.');
    // Kept (soft) so surveys already sent still show who they went to.
    await this.prisma.surveyExternalContact.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actor.id } });
    await this.prisma.surveyContactListMember.deleteMany({ where: { contactId: id } });
    await this.auditContact(actor, id, 'removed', meta);
    return { message: 'Removed', data: { id } };
  }

  private async requireContact(actor: RequestUser, id: string): Promise<ExternalRow> {
    const row = await this.prisma.surveyExternalContact.findFirst({ where: { AND: [{ id, deletedAt: null }, this.contactScopeWhere(actor)] } });
    if (!row) throw new NotFoundException('Contact not found');
    return row;
  }

  private async auditContact(actor: RequestUser, id: string, what: string, meta?: RequestAuditMeta) {
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_UPDATED,
      recordType: 'SurveyExternalContact',
      recordId: id,
      // Never the person's details in the audit text.
      description: `Survey outside person ${what}`,
      ...meta,
    });
  }

  /** Opt-out for an outside person (all survey contact, or one channel), or lifted (channels []). */
  async setContactOptOut(actor: RequestUser, id: string, channels: string[], meta?: RequestAuditMeta) {
    const row = await this.requireContact(actor, id);
    const allowed = ['ALL', 'EMAIL', 'TEXT', 'PHONE'];
    if (channels.some((c) => !allowed.includes(c))) throw new BadRequestException('Choose how they do not want to be contacted.');
    const subject = row.sourceType === 'SERVICE_USER_CONTACT' && row.sourceId ? { subjectKind: 'CONTACT', subjectId: row.sourceId } : { subjectKind: 'EXTERNAL', subjectId: row.id };
    const before = await this.prisma.surveyContactOptOut.findMany({ where: subject, select: { channel: true, reason: true } });
    if (before.some((b) => b.channel === 'ALL' && b.reason === SURVEY_UNSUBSCRIBE_REASON)) {
      throw new BadRequestException('They unsubscribed from all surveys themselves. This cannot be changed by staff.');
    }
    await this.prisma.$transaction([
      this.prisma.surveyContactOptOut.deleteMany({ where: subject }),
      ...(channels.length ? [this.prisma.surveyContactOptOut.createMany({ data: [...new Set(channels)].map((channel) => ({ ...subject, channel, recordedById: actor.id })) })] : []),
    ]);
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_CONTACT_OPT_OUT_CHANGED,
      recordType: subject.subjectKind === 'CONTACT' ? 'ServiceUserContact' : 'SurveyExternalContact',
      recordId: subject.subjectId,
      description: 'Survey contact preferences changed for an outside person',
      oldValues: { channels: before.map((b) => b.channel) },
      newValues: { channels },
      ...meta,
    });
    return { message: 'Saved', data: { channels } };
  }

  // ─── Sources CareFlow already keeps ──────────────────────────────────────

  /** Funders (commissioners) and pathway professionals that can be added; already added ones say so. */
  async listSources(actor: RequestUser, type: 'FUNDER' | 'PATHWAY_PROFESSIONAL', search?: string) {
    const q = search?.trim();
    const suScope = this.orgScope.serviceUserScopeWhere(this.orgScope.fromRequestUser(actor));
    const rows =
      type === 'FUNDER'
        ? (
            await this.prisma.funder.findMany({
              where: { deletedAt: null, isActive: true, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { contactName: { contains: q, mode: 'insensitive' } }] } : {}) },
              select: { id: true, name: true, contactName: true, email: true, phone: true },
              take: 200,
              orderBy: { name: 'asc' },
            })
          ).map((f) => ({ id: f.id, name: f.contactName || f.name, organisation: f.name, role: null as string | null, email: f.email, phone: f.phone }))
        : (
            await this.prisma.specialistPathwayProfessional.findMany({
              where: {
                deletedAt: null,
                // Only professionals on cases of people in the user's branches (as the rest of outside people).
                ...(suScope ? { case: { serviceUser: suScope } } : {}),
                ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { organisation: { contains: q, mode: 'insensitive' } }] } : {}),
              },
              select: { id: true, name: true, role: true, organisation: true, email: true, phone: true },
              take: 200,
              orderBy: { name: 'asc' },
            })
          ).map((p) => ({ id: p.id, name: p.name, organisation: p.organisation, role: p.role, email: p.email, phone: p.phone }));
    const added = new Set(
      (await this.prisma.surveyExternalContact.findMany({ where: { sourceType: type, sourceId: { in: rows.map((r) => r.id) }, deletedAt: null }, select: { sourceId: true } })).map((r) => r.sourceId),
    );
    return { message: 'Contacts in CareFlow', data: rows.map((r) => ({ ...r, added: added.has(r.id) })) };
  }

  /** Add a funder's contact (commissioner) or a pathway professional; their details are read again at each send. */
  async addFromSource(actor: RequestUser, type: 'FUNDER' | 'PATHWAY_PROFESSIONAL', sourceId: string, meta?: RequestAuditMeta) {
    const scope = this.orgScope.fromRequestUser(actor);
    const suScope = this.orgScope.serviceUserScopeWhere(scope);
    if (type === 'PATHWAY_PROFESSIONAL' && suScope) {
      const visible = await this.prisma.specialistPathwayProfessional.count({ where: { id: sourceId, deletedAt: null, case: { serviceUser: suScope } } });
      if (!visible) throw new NotFoundException('Not found');
    }
    const existing = await this.prisma.surveyExternalContact.findFirst({ where: { sourceType: type, sourceId } });
    if (existing && !existing.deletedAt) return { message: 'Already added', data: { id: existing.id } };
    const details = await this.sourceDetails(type, sourceId);
    if (!details) throw new NotFoundException('Not found');
    const data = { ...details, kind: type === 'FUNDER' ? 'COMMISSIONER' : 'PROFESSIONAL', sourceType: type, sourceId, locationIds: scope.locationIds ?? [], updatedById: actor.id, deletedAt: null };
    const row = existing
      ? await this.prisma.surveyExternalContact.update({ where: { id: existing.id }, data })
      : await this.prisma.surveyExternalContact.create({ data: { ...data, createdById: actor.id } });
    await this.auditContact(actor, row.id, 'added from CareFlow records', meta);
    return { message: 'Added', data: { id: row.id } };
  }

  private async sourceDetails(type: string, sourceId: string): Promise<{ name: string; organisation: string | null; role: string | null; email: string | null; mobile: string | null; phone: string | null } | null> {
    if (type === 'FUNDER') {
      const f = await this.prisma.funder.findFirst({ where: { id: sourceId, deletedAt: null } });
      if (!f) return null;
      return { name: f.contactName || f.name, organisation: f.name, role: null, email: f.email, mobile: normaliseUkMobile(f.phone), phone: f.phone };
    }
    if (type === 'PATHWAY_PROFESSIONAL') {
      const p = await this.prisma.specialistPathwayProfessional.findFirst({ where: { id: sourceId, deletedAt: null } });
      if (!p) return null;
      return { name: p.name, organisation: p.organisation, role: p.role, email: p.email, mobile: normaliseUkMobile(p.phone), phone: p.phone };
    }
    if (type === 'SERVICE_USER_CONTACT') {
      const c = await this.prisma.serviceUserContact.findFirst({ where: { id: sourceId, deletedAt: null, isActive: true }, include: { relationshipType: { select: { name: true } } } });
      if (!c) return null;
      return {
        name: `${c.firstName} ${c.lastName ?? ''}`.trim(),
        organisation: null,
        role: c.relationshipType?.name ?? null,
        email: c.email?.trim() || null,
        mobile: normaliseUkMobile(c.mobile) ?? normaliseUkMobile(c.phone),
        phone: c.phone ?? c.mobile ?? null,
      };
    }
    return null;
  }

  /**
   * Families of these people we support (People involved): those who agreed to be contacted ("Can receive care
   * updates"), with an email or mobile. Each becomes (or stays) one outside person, read again from the record.
   */
  async familiesOf(actor: RequestUser, serviceUserIds: string[]) {
    const scope = this.orgScope.fromRequestUser(actor);
    const inScope = this.orgScope.serviceUserScopeWhere(scope);
    const sus = await this.prisma.serviceUser.findMany({
      where: { AND: [{ id: { in: serviceUserIds }, deletedAt: null }, ...(inScope ? [inScope] : [])] },
      select: { id: true, locationId: true, firstName: true, lastName: true, preferredName: true },
    });
    if (sus.length !== new Set(serviceUserIds).size) throw new BadRequestException('Some of the chosen people are not in your branches.');
    const contacts = await this.prisma.serviceUserContact.findMany({
      where: { serviceUserId: { in: sus.map((s) => s.id) }, deletedAt: null, isActive: true },
      include: { relationshipType: { select: { name: true } } },
      orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
    });
    const out: Array<{ contactId: string | null; sourceId: string; serviceUserId: string; name: string; relationship: string | null; email: string | null; mobile: string | null; consent: boolean; reachable: boolean }> = [];
    for (const c of contacts) {
      const mobile = normaliseUkMobile(c.mobile) ?? normaliseUkMobile(c.phone);
      out.push({
        contactId: null,
        sourceId: c.id,
        serviceUserId: c.serviceUserId,
        name: `${c.firstName} ${c.lastName ?? ''}`.trim(),
        relationship: c.relationshipType?.name ?? null,
        email: c.email?.trim() || null,
        mobile,
        consent: c.canReceiveUpdates,
        reachable: Boolean(c.email?.trim() || mobile),
      });
    }
    const people = new Map(sus.map((s) => [s.id, `${s.preferredName?.trim() || s.firstName} ${s.lastName ?? ''}`.trim()]));
    return { message: 'Families', data: out.map((f) => ({ ...f, aboutName: people.get(f.serviceUserId) ?? null })) };
  }

  /** The outside person for a People involved contact (made on first use; details refreshed from the record). */
  private async ensureFamilyContact(sourceId: string, actorId: string | null): Promise<ExternalRow | null> {
    const c = await this.prisma.serviceUserContact.findFirst({ where: { id: sourceId, deletedAt: null, isActive: true }, include: { serviceUser: { select: { locationId: true } } } });
    if (!c) return null;
    const details = await this.sourceDetails('SERVICE_USER_CONTACT', sourceId);
    const data = { ...details!, kind: 'FAMILY', sourceType: 'SERVICE_USER_CONTACT', sourceId, serviceUserId: c.serviceUserId, locationIds: c.serviceUser.locationId ? [c.serviceUser.locationId] : [], updatedById: actorId, deletedAt: null };
    const existing = await this.prisma.surveyExternalContact.findFirst({ where: { sourceType: 'SERVICE_USER_CONTACT', sourceId } });
    try {
      return existing
        ? await this.prisma.surveyExternalContact.update({ where: { id: existing.id }, data })
        : await this.prisma.surveyExternalContact.create({ data: { ...data, createdById: actorId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.prisma.surveyExternalContact.findFirst({ where: { sourceType: 'SERVICE_USER_CONTACT', sourceId } });
      }
      throw e;
    }
  }

  /** Refresh sourced contacts from their records before a send (never a stale email). */
  private async refresh(rows: ExternalRow[]): Promise<ExternalRow[]> {
    const out: ExternalRow[] = [];
    for (const r of rows) {
      if (r.sourceType === 'TYPED' || !r.sourceId) {
        out.push(r);
        continue;
      }
      const d = await this.sourceDetails(r.sourceType, r.sourceId);
      if (!d) continue; // the record was removed: not sent
      out.push(await this.prisma.surveyExternalContact.update({ where: { id: r.id }, data: d }));
    }
    return out;
  }

  // ─── Lists ───────────────────────────────────────────────────────────────

  async listLists(actor: RequestUser) {
    const scope = this.orgScope.fromRequestUser(actor);
    const rows = await this.prisma.surveyContactList.findMany({
      where: { deletedAt: null, ...(scope.locationIds ? { OR: [{ locationIds: { isEmpty: true } }, { locationIds: { hasSome: scope.locationIds } }] } : {}) },
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } } },
    });
    return {
      message: 'Contact lists',
      data: rows.map((l) => ({ id: l.id, name: l.name, description: l.description, locationIds: l.locationIds, members: l._count.members, canChange: this.mayChange(actor, l.locationIds) })),
    };
  }

  async saveList(actor: RequestUser, id: string | null, input: { name: string; description?: string | null; contactIds: string[]; locationIds?: string[] }, meta?: RequestAuditMeta) {
    const name = input.name?.trim() ?? '';
    if (name.length < 2 || name.length > 120) throw new BadRequestException('Give the list a name (2 to 120 characters).');
    const scope = this.orgScope.fromRequestUser(actor);
    const locationIds = input.locationIds?.length ? input.locationIds : scope.locationIds ?? [];
    if (!this.mayChange(actor, locationIds)) throw new BadRequestException('Choose branches you work in.');
    const visible = await this.prisma.surveyExternalContact.findMany({ where: { AND: [{ id: { in: input.contactIds } , deletedAt: null }, this.contactScopeWhere(actor)] }, select: { id: true } });
    if (visible.length !== new Set(input.contactIds).size) throw new BadRequestException('Some of these people are not in your branches.');
    let listId = id;
    if (id) {
      const list = await this.prisma.surveyContactList.findFirst({ where: { id, deletedAt: null } });
      if (!list || !this.mayChange(actor, list.locationIds)) throw new NotFoundException('List not found');
      await this.prisma.$transaction([
        this.prisma.surveyContactList.update({ where: { id }, data: { name, description: input.description?.trim() || null, locationIds, updatedById: actor.id } }),
        this.prisma.surveyContactListMember.deleteMany({ where: { listId: id } }),
        this.prisma.surveyContactListMember.createMany({ data: visible.map((v) => ({ listId: id, contactId: v.id })) }),
      ]);
    } else {
      listId = randomUUID();
      await this.prisma.surveyContactList.create({
        data: { id: listId, name, description: input.description?.trim() || null, locationIds, createdById: actor.id, updatedById: actor.id, members: { create: visible.map((v) => ({ contactId: v.id })) } },
      });
    }
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_UPDATED,
      recordType: 'SurveyContactList',
      recordId: listId!,
      description: `Survey contact list "${name}" ${id ? 'changed' : 'made'}`,
      newValues: { members: visible.length },
      ...meta,
    });
    return { message: 'Saved', data: { id: listId } };
  }

  async removeList(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    const list = await this.prisma.surveyContactList.findFirst({ where: { id, deletedAt: null } });
    if (!list || !this.mayChange(actor, list.locationIds)) throw new NotFoundException('List not found');
    await this.prisma.surveyContactList.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actor.id } });
    await this.audit.logAudit({ userId: actor.id, module: AuditModule.SURVEY, action: AuditAction.SURVEY_UPDATED, recordType: 'SurveyContactList', recordId: id, description: `Survey contact list "${list.name}" removed`, ...meta });
    return { message: 'Removed', data: { id } };
  }

  // ─── Sending to outside people ───────────────────────────────────────────

  private async requireSurvey(actor: RequestUser, id: string): Promise<Survey> {
    const survey = await this.prisma.survey.findFirst({ where: { id, deletedAt: null, isCatalogue: false } });
    if (!survey || !surveyVisibleInScope(this.orgScope.fromRequestUser(actor), survey)) throw new NotFoundException('Survey not found');
    return survey;
  }

  private assertSendable(survey: Survey, now: Date) {
    if (survey.targetKind !== SurveyTargetKind.PUBLIC) throw new BadRequestException('Outside people are sent public surveys (families, professionals, commissioners).');
    if (survey.isAnonymous) {
      throw new BadRequestException('This survey is anonymous, so nobody gets their own link (a link would show whether its holder answered). Share its link instead.');
    }
    if (survey.isTemplate) throw new BadRequestException('Templates are never sent.');
    if (survey.recurrence) throw new BadRequestException('Open a period of this repeating survey to send it to people.');
    if (survey.status === SurveyStatus.CLOSED) throw new BadRequestException('This survey is closed. Reopen it before sending.');
    if (survey.closesAt && survey.closesAt <= now) throw new BadRequestException('This survey’s end date has passed.');
  }

  /** Who the send would reach: contacts, list members and families, with who cannot be sent it and why. */
  async resolveOutside(
    actor: RequestUser,
    survey: Survey,
    input: { contactIds?: string[]; listIds?: string[]; familyContactIds?: string[]; aboutServiceUserId?: string | null },
    now: Date,
  ) {
    const ids = new Set(input.contactIds ?? []);
    if (input.listIds?.length) {
      const members = await this.prisma.surveyContactListMember.findMany({ where: { listId: { in: input.listIds }, list: { deletedAt: null } }, select: { contactId: true } });
      for (const m of members) ids.add(m.contactId);
    }
    let rows = ids.size
      ? await this.prisma.surveyExternalContact.findMany({ where: { AND: [{ id: { in: [...ids] }, deletedAt: null }, this.contactScopeWhere(actor)] } })
      : [];
    // Families: only those who agreed to be contacted, in the actor's branches.
    let noConsent = 0;
    if (input.familyContactIds?.length) {
      const scope = this.orgScope.fromRequestUser(actor);
      const inScope = this.orgScope.serviceUserScopeWhere(scope);
      const contacts = await this.prisma.serviceUserContact.findMany({
        where: { id: { in: input.familyContactIds }, deletedAt: null, isActive: true, serviceUser: { AND: [{ deletedAt: null }, ...(inScope ? [inScope] : [])] } },
        select: { id: true, canReceiveUpdates: true },
      });
      for (const c of contacts) {
        if (!c.canReceiveUpdates) {
          noConsent += 1;
          continue;
        }
        const row = await this.ensureFamilyContact(c.id, actor.id);
        if (row && !rows.some((r) => r.id === row.id)) rows.push(row);
      }
    }
    rows = await this.refresh(rows);
    // Family members however they were chosen (a contact, a list, families of a person): consent read again from
    // People involved now, and never after the person we support has died (except the bereaved-family survey, and
    // the complaint follow-up to the family member who complained). Anyone else on a survey about one person who
    // has died: only with a recorded reason.
    let died = 0;
    const owner = survey.clonedFromId ? ((await this.prisma.survey.findUnique({ where: { id: survey.clonedFromId } })) ?? survey) : survey;
    const about = { ...survey, aboutServiceUserId: input.aboutServiceUserId !== undefined ? input.aboutServiceUserId : survey.aboutServiceUserId };
    const blocks = await outsideContactBlocks(this.prisma, about, owner, rows, 'STAFF');
    const needsReason = new Set<string>();
    for (const [id, why] of blocks) {
      if (why === 'DIED') died += 1;
      else if (why === 'NO_CONSENT') noConsent += 1;
      else if (why === 'NEEDS_REASON') needsReason.add(id);
    }
    rows = rows.filter((r) => !blocks.has(r.id) || needsReason.has(r.id));
    const plan = readContactPlan(survey.contactPlan);
    const textOn = Boolean(plan?.channels.includes('TEXT')) && this.texts.isEnabled();
    const opt = await this.optOuts(rows);
    const already = new Set(
      (await this.prisma.surveyRecipient.findMany({ where: { surveyId: survey.id, externalContactId: { in: rows.map((r) => r.id) } }, select: { externalContactId: true } })).map((r) => r.externalContactId),
    );
    const blocked = (r: ExternalRow, ch: string) => Boolean(opt.get(r.id)?.has('ALL') || opt.get(r.id)?.has(ch));
    const reachable: ExternalRow[] = [];
    let optedOut = 0;
    let noDetails = 0;
    for (const r of rows) {
      if (already.has(r.id)) continue;
      const email = r.email && !blocked(r, 'EMAIL');
      const text = textOn && r.mobile && !blocked(r, 'TEXT');
      if (opt.get(r.id)?.has('ALL')) optedOut += 1;
      else if (email || text) reachable.push(r);
      else if (!r.email && !(textOn && r.mobile)) noDetails += 1;
      else optedOut += 1;
    }
    // The 4-week rule, per real person.
    const tz = await this.timeZone();
    const today = dayKeyInTimeZone(now, tz);
    const held: Array<{ id: string; name: string; freeFrom: string }> = [];
    let free = reachable;
    const rule = this.contactRule ? await this.contactRule.ruleFor(survey) : null;
    if (this.contactRule && rule?.rule.holdBack && reachable.length) {
      const last = await this.contactRule.lastContactsExternal(reachable.map((r) => r.id), survey.clonedFromId ?? survey.id, now, tz, {
        reference: rule.owner.libraryReference ?? null,
        sentWith: librarySentWith(rule.libraryMeta),
      });
      free = [];
      for (const r of reachable) {
        const c = last.get(r.id);
        if (c && freeFromDay(c.day) > today) held.push({ id: r.id, name: r.name, freeFrom: freeFromDay(c.day) });
        else free.push(r);
      }
    }
    const afterDeathRows = free.filter((r) => needsReason.has(r.id));
    free = free.filter((r) => !needsReason.has(r.id));
    const afterDeath = reachable.filter((r) => needsReason.has(r.id)).length;
    return {
      free,
      held,
      heldRows: reachable.filter((r) => held.some((h) => h.id === r.id)),
      afterDeathRows,
      needsReason,
      afterDeath,
      already: already.size,
      optedOut,
      noDetails,
      noConsent,
      died,
      total: rows.length + noConsent + died,
    };
  }

  async checkSendOutside(actor: RequestUser, surveyId: string, input: { contactIds?: string[]; listIds?: string[]; familyContactIds?: string[]; aboutServiceUserId?: string | null }) {
    const survey = await this.requireSurvey(actor, surveyId);
    const now = new Date();
    this.assertSendable(survey, now);
    const r = await this.resolveOutside(actor, survey, input, now);
    return {
      message: 'Send check',
      data: { total: r.total, sendNow: r.free.length, heldBack: r.held.length, held: r.held, already: r.already, optedOut: r.optedOut, noDetails: r.noDetails, noConsent: r.noConsent, died: r.died, afterDeath: r.afterDeath },
    };
  }

  /**
   * Send a named public survey to outside people, each with their own link (email; text when the survey's
   * contact plan includes texts). People surveyed in the last 4 weeks are not sent it unless sent anyway with a
   * reason (outside people are never queued). Audited as counts only.
   */
  async sendOutside(
    actor: RequestUser,
    surveyId: string,
    input: {
      contactIds?: string[];
      listIds?: string[];
      familyContactIds?: string[];
      aboutServiceUserId?: string | null;
      contactRuleOverride?: { reason: string };
      /** A survey about one person who has died: why these people are being asked now (e.g. an end-of-life care review). */
      afterDeathReason?: string;
    },
    meta?: RequestAuditMeta,
    requestOrigin?: string,
  ) {
    const survey = await this.requireSurvey(actor, surveyId);
    const now = new Date();
    this.assertSendable(survey, now);
    if ((await this.prisma.surveyQuestion.count({ where: { surveyId, deletedAt: null } })) === 0) throw new BadRequestException('Add at least one question first.');
    const override = input.contactRuleOverride?.reason?.trim() || null;
    if (input.contactRuleOverride && (!override || override.length < 5 || override.length > 300)) {
      throw new BadRequestException('Say why people surveyed in the last 4 weeks should be sent this now (5 to 300 characters).');
    }
    if (input.aboutServiceUserId) {
      const scope = this.orgScope.fromRequestUser(actor);
      const inScope = this.orgScope.serviceUserScopeWhere(scope);
      const ok = await this.prisma.serviceUser.count({ where: { AND: [{ id: input.aboutServiceUserId, deletedAt: null }, ...(inScope ? [inScope] : [])] } });
      if (!ok) throw new BadRequestException('That person is not in your branches.');
    }
    const deathReason = input.afterDeathReason?.trim() || null;
    if (input.afterDeathReason !== undefined && (!deathReason || deathReason.length < 5 || deathReason.length > 300)) {
      throw new BadRequestException('Say why they should be asked now that the person has died (5 to 300 characters).');
    }
    const r = await this.resolveOutside(actor, survey, input, now);
    const send = [
      ...r.free,
      ...(deathReason ? r.afterDeathRows : []),
      ...(override ? r.heldRows.filter((h) => !r.needsReason.has(h.id) || deathReason) : []),
    ];
    if (!send.length) throw new BadRequestException('Nobody here can be sent this survey now.');
    const rows = send.map((c) => ({ id: randomUUID(), externalContactId: c.id, token: randomUUID() }));
    await this.prisma.$transaction(async (tx) => {
      await tx.surveyRecipient.createMany({
        data: rows.map((x) => ({ ...x, surveyId: survey.id, targetKind: SurveyTargetKind.PUBLIC, status: 'SENT' as const, sentAt: now, createdById: actor.id })),
        skipDuplicates: true,
      });
      await tx.survey.update({
        where: { id: survey.id },
        data: {
          status: SurveyStatus.ACTIVE,
          publishedAt: survey.publishedAt ?? now,
          distributedAt: now,
          ...(input.aboutServiceUserId !== undefined ? { aboutServiceUserId: input.aboutServiceUserId } : {}),
          updatedById: actor.id,
        },
      });
    });
    const saved = await this.prisma.surveyRecipient.findMany({ where: { surveyId: survey.id, token: { in: rows.map((x) => x.token) } }, select: { token: true, externalContactId: true } });
    void this.deliver(survey, saved, send, requestOrigin).catch((e: unknown) => this.logger.warn(`Survey ${survey.id}: outside invitations not sent (${e instanceof Error ? e.name : 'error'})`));
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: override ? AuditAction.SURVEY_CONTACT_RULE_OVERRIDDEN : AuditAction.SURVEY_SENT,
      recordType: 'Survey',
      recordId: survey.id,
      description: `Survey "${survey.title}" sent to outside people`,
      // Counts (and the reason) only: never who.
      newValues: {
        sent: saved.length,
        heldBack: override ? 0 : r.held.length,
        optedOut: r.optedOut,
        noDetails: r.noDetails,
        noConsent: r.noConsent,
        died: r.died,
        afterDeath: r.afterDeath,
        ...(override ? { reason: override } : {}),
        ...(deathReason && r.afterDeath ? { afterDeathReason: deathReason } : {}),
      },
      metadata: { surveyId: survey.id, outside: true },
      ...meta,
    });
    const notes = [
      !override && r.held.length ? `${r.held.length} had another survey in the last 4 weeks and were not sent it` : '',
      r.optedOut ? `${r.optedOut} asked not to be contacted` : '',
      r.noDetails ? `${r.noDetails} have no email${this.texts.isEnabled() ? ' or mobile' : ''}` : '',
      r.noConsent ? `${r.noConsent} family ${r.noConsent === 1 ? 'member has' : 'members have'} not agreed to be contacted` : '',
      r.died ? `${r.died} family ${r.died === 1 ? 'member was' : 'members were'} not sent it because the person we supported has died` : '',
      !deathReason && r.afterDeath ? `${r.afterDeath} ${r.afterDeath === 1 ? 'was' : 'were'} not sent it because the person this survey is about has died (send with a reason if it is needed)` : '',
    ].filter(Boolean);
    return { message: `Sent to ${saved.length} ${saved.length === 1 ? 'person' : 'people'}${notes.length ? `. ${notes.join('; ')}.` : ''}`, data: { sent: saved.length, heldBack: override ? 0 : r.held.length, optedOut: r.optedOut, noDetails: r.noDetails, noConsent: r.noConsent, died: r.died, afterDeath: deathReason ? 0 : r.afterDeath } };
  }

  /**
   * Before sending again to one outside person whose invitation lapsed (SurveysService.resendLapsed): the same
   * rules as a send by name (consent, deaths, a reason after the death of the person the survey is about,
   * opt-outs). Returns their current details, and the reason when one was needed (for the audit).
   */
  async checkResend(survey: Survey, externalContactId: string, reason?: string | null): Promise<{ row: ExternalRow; reasonUsed: string | null }> {
    const found = await this.prisma.surveyExternalContact.findFirst({ where: { id: externalContactId, deletedAt: null } });
    const [row] = found ? await this.refresh([found]) : [];
    if (!row) throw new BadRequestException('This person has been removed, or their record no longer exists.');
    const owner = survey.clonedFromId ? ((await this.prisma.survey.findUnique({ where: { id: survey.clonedFromId } })) ?? survey) : survey;
    const why = (await outsideContactBlocks(this.prisma, survey, owner, [row], 'STAFF')).get(row.id);
    if (why === 'NO_CONSENT') throw new BadRequestException('They have not agreed to be contacted (People involved).');
    if (why === 'DIED') throw new BadRequestException('The person we supported has died, so this survey is not sent to their family.');
    const r = reason?.trim() || null;
    if (why === 'NEEDS_REASON' && (!r || r.length < 5 || r.length > 300)) {
      throw new BadRequestException('The person this survey is about has died. Say why they should be asked now (5 to 300 characters).');
    }
    if ((await this.optOuts([row])).get(row.id)?.has('ALL')) throw new BadRequestException('They asked not to be contacted about surveys.');
    if (!row.email && !row.mobile) throw new BadRequestException('They have no email or mobile.');
    return { row, reasonUsed: why === 'NEEDS_REASON' ? r : null };
  }

  /** Their own link again, by the agreed email (and text when the plan includes texts). Never fails the caller. */
  async deliverOne(survey: Survey, token: string, row: ExternalRow, requestOrigin?: string): Promise<void> {
    await this.deliver(survey, [{ token, externalContactId: row.id }], [row], requestOrigin).catch((e: unknown) =>
      this.logger.warn(`Survey ${survey.id}: an outside invitation was not sent again (${e instanceof Error ? e.name : 'error'})`),
    );
  }

  private appBase(requestOrigin?: string): string | null {
    const configured = this.config.get<string>('app.adminAppUrl', '');
    if (configured) return configured;
    const origin = requestOrigin?.trim().replace(/\/+$/, '');
    return origin && /^https?:\/\/[^/\s]+$/i.test(origin) ? origin : null;
  }

  private async organisationName(): Promise<string | null> {
    const p = await this.prisma.companyProfile.findFirst({ select: { displayName: true, companyName: true } }).catch(() => null);
    return p?.displayName || p?.companyName || null;
  }

  /** Invitations: each person's own link by email, and by text when the plan includes texts. Opt-outs honoured. */
  private async deliver(survey: Survey, saved: Array<{ token: string; externalContactId: string | null }>, contacts: ExternalRow[], requestOrigin?: string) {
    const base = this.appBase(requestOrigin);
    const tz = await this.timeZone();
    const organisation = await this.organisationName();
    const branding = await surveyEmailBranding(this.prisma);
    const facts = await surveyEmailFacts(this.prisma, survey.id, tz);
    const plan = readContactPlan(survey.contactPlan);
    const textOn = Boolean(plan?.channels.includes('TEXT')) && this.texts.isEnabled();
    const opt = await this.optOuts(contacts);
    const byId = new Map(contacts.map((c) => [c.id, c]));
    for (const s of saved) {
      const c = s.externalContactId ? byId.get(s.externalContactId) : null;
      if (!c) continue;
      const link = base ? `${base}${personalLinkPath(s.token)}` : null;
      const m = surveyContactMessages({
        kind: 'EXTERNAL',
        anonymous: false,
        reminder: false,
        title: survey.title,
        firstName: c.name.split(/\s+/)[0] ?? null,
        link,
        portalLink: null,
        closesOn: survey.closesAt ? formatSurveyDateTime(survey.closesAt, tz) : null,
        organisation,
        contactPhone: branding.contactPhone,
        contactEmail: branding.contactEmail,
        logoUrl: branding.logoUrl,
        brand: branding,
        minutes: facts.minutes,
        closesDate: facts.closesDate,
        daysLeft: facts.daysLeft,
        textRepliesSupported: this.texts.supportsReplies(),
      });
      const blocked = (ch: string) => Boolean(opt.get(c.id)?.has('ALL') || opt.get(c.id)?.has(ch));
      if (c.email && !blocked('EMAIL')) {
        try {
          await this.mail.send({ to: c.email, subject: m.emailSubject, text: m.emailText, html: m.emailHtml, skipBcc: true });
        } catch (e) {
          this.logger.warn(`Survey ${survey.id}: an outside invitation email failed (${e instanceof Error ? e.name : 'error'})`);
        }
      }
      if (textOn && c.mobile && !blocked('TEXT')) await this.texts.send({ to: c.mobile, body: m.text }).catch(() => null);
    }
  }
}
