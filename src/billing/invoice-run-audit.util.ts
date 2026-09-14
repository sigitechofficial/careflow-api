import { InvoiceRunAuditAction, Prisma } from '@prisma/client';

export type InvoiceRunAuditActor = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
};

export type InvoiceRunAuditTrailItem = {
  id: string;
  action: InvoiceRunAuditAction;
  at: string;
  actorUserId: string | null;
  actorName: string | null;
  detail: string | null;
  metadata: Record<string, unknown> | null;
};

export function formatInvoiceAuditActorName(
  user: Pick<InvoiceRunAuditActor, 'firstName' | 'lastName' | 'email'> | null | undefined,
): string | null {
  if (!user) return null;
  const name = [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean).join(' ');
  if (name) return name;
  const email = user.email?.trim();
  return email || null;
}

export function invoiceAuditActionLabel(action: InvoiceRunAuditAction): string {
  switch (action) {
    case InvoiceRunAuditAction.CREATED:
      return 'Invoice run created';
    case InvoiceRunAuditAction.CALCULATED:
      return 'Invoice calculated';
    case InvoiceRunAuditAction.APPROVED:
      return 'Invoice approved';
    case InvoiceRunAuditAction.LOCKED:
      return 'Invoice locked';
    case InvoiceRunAuditAction.SENT:
      return 'Invoice marked sent';
    case InvoiceRunAuditAction.EMAIL_SENT:
      return 'Invoice emailed';
    case InvoiceRunAuditAction.EXPORTED:
      return 'Invoice exported';
    case InvoiceRunAuditAction.PAYMENT_ALLOCATED:
      return 'Payment allocated';
    default:
      return action;
  }
}

type AuditDb = {
  invoiceRunAuditEvent: {
    create: (args: {
      data: {
        invoiceRunId: string;
        action: InvoiceRunAuditAction;
        actorUserId?: string | null;
        occurredAt?: Date;
        detail?: string | null;
        metadata?: Prisma.InputJsonValue;
      };
    }) => Promise<unknown>;
  };
};

export async function recordInvoiceRunAuditEvent(
  db: AuditDb,
  input: {
    invoiceRunId: string;
    action: InvoiceRunAuditAction;
    actorUserId?: string | null;
    occurredAt?: Date;
    detail?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.invoiceRunAuditEvent.create({
    data: {
      invoiceRunId: input.invoiceRunId,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      detail: input.detail?.trim() || null,
      metadata:
        input.metadata == null
          ? undefined
          : (input.metadata as Prisma.InputJsonValue),
    },
  });
}
