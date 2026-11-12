import type { PrismaService } from '../prisma/prisma.service';

/**
 * How a would-be independent reviewer is already connected to us, found by their email or full name:
 * a staff record (current or former), a person we support (or did), a family member or other contact of
 * one, or an outside contact our surveys go to. Current staff by email are refused elsewhere; everything
 * here is a warning the manager must declare they have weighed (independence allows declared links).
 */
export type ReviewerLink = {
  kind: 'STAFF' | 'FORMER_STAFF' | 'SERVICE_USER' | 'FAMILY_CONTACT' | 'OUTSIDE_CONTACT';
  /** Plain words for the screen: "Former member of staff: Jane Doe". */
  label: string;
  /** How it matched: the same email, or the same full name. */
  match: 'EMAIL' | 'NAME';
  /** The people this link ties them to (kept out of their sample): service user or employee ids. */
  serviceUserIds: string[];
  employeeIds: string[];
};

const full = (a?: string | null, b?: string | null) => [a?.trim(), b?.trim()].filter(Boolean).join(' ');

export async function findReviewerLinks(
  prisma: PrismaService,
  person: { firstName: string; lastName: string; email: string },
): Promise<ReviewerLink[]> {
  const email = person.email.trim().toLowerCase();
  const first = person.firstName.trim();
  const last = person.lastName.trim();
  const byName = first && last;
  const eq = (v: string) => ({ equals: v, mode: 'insensitive' as const });
  const [staff, people, contacts, outside] = await Promise.all([
    prisma.employeePersonalDetail.findMany({
      where: {
        employee: { deletedAt: null },
        OR: [{ email: eq(email) }, ...(byName ? [{ firstName: eq(first), lastName: eq(last) }] : [])],
      },
      select: { employeeId: true, firstName: true, lastName: true, email: true, employee: { select: { isActive: true } } },
      take: 10,
    }),
    prisma.serviceUser.findMany({
      where: { deletedAt: null, OR: [{ email: eq(email) }, ...(byName ? [{ firstName: eq(first), lastName: eq(last) }] : [])] },
      select: { id: true, firstName: true, lastName: true, email: true },
      take: 10,
    }),
    prisma.serviceUserContact.findMany({
      where: { deletedAt: null, OR: [{ email: eq(email) }, ...(byName ? [{ firstName: eq(first), lastName: eq(last) }] : [])] },
      select: { serviceUserId: true, firstName: true, lastName: true, email: true, serviceUser: { select: { firstName: true, lastName: true } } },
      take: 20,
    }),
    prisma.surveyExternalContact.findMany({
      where: { deletedAt: null, OR: [{ email: eq(email) }, ...(byName ? [{ name: eq(`${first} ${last}`) }] : [])] },
      select: { id: true, kind: true, name: true, role: true, email: true, serviceUserId: true },
      take: 10,
    }),
  ]);
  const how = (rowEmail: string | null | undefined): 'EMAIL' | 'NAME' => (rowEmail?.trim().toLowerCase() === email ? 'EMAIL' : 'NAME');
  const links: ReviewerLink[] = [];
  for (const s of staff) {
    const former = !s.employee.isActive;
    links.push({
      kind: former ? 'FORMER_STAFF' : 'STAFF',
      label: `${former ? 'Former member of staff' : 'Member of staff'}: ${full(s.firstName, s.lastName)}`,
      match: how(s.email),
      serviceUserIds: [],
      employeeIds: [s.employeeId],
    });
  }
  for (const p of people) {
    links.push({ kind: 'SERVICE_USER', label: `Person we support (or did): ${full(p.firstName, p.lastName)}`, match: how(p.email), serviceUserIds: [p.id], employeeIds: [] });
  }
  for (const c of contacts) {
    links.push({
      kind: 'FAMILY_CONTACT',
      label: `Family or contact of ${full(c.serviceUser?.firstName, c.serviceUser?.lastName) || 'a person we support'}`,
      match: how(c.email),
      serviceUserIds: [c.serviceUserId],
      employeeIds: [],
    });
  }
  for (const o of outside) {
    const role = o.role?.trim() || o.kind.toLowerCase();
    links.push({
      kind: 'OUTSIDE_CONTACT',
      label: `Outside contact on our surveys: ${o.name} (${role})`,
      match: how(o.email),
      serviceUserIds: o.serviceUserId ? [o.serviceUserId] : [],
      employeeIds: [],
    });
  }
  return links;
}
