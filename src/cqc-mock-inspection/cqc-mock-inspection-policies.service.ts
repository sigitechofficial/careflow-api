import { Injectable } from '@nestjs/common';
import { PolicyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyLibraryService } from '../policies/policy-library.service';
import { readTemplateStatements } from './cqc-mock-inspection.service';

/** A ready-made policy a quality statement relies on. */
export type StatementPolicy = {
  /** The ready-made (library) policy. */
  id: string;
  reference: string;
  title: string;
  documentType: string;
  categoryName: string | null;
  /** The organisation's own copy, when adopted. */
  adoptedPolicyId: string | null;
  /** The adopted copy's status (ARCHIVED when it is no longer in use). */
  adoptedStatus: PolicyStatus | null;
  /** The adopted copy is a draft that was never published, so adopting can be undone (it is deleted). */
  canUndoAdopt: boolean;
};

/**
 * Ready-made policies by quality statement, for mock inspections: the policies an inspector would
 * expect to see behind each statement. The links are part of the mock inspection library
 * (statement-guidance.json `policies`, stored with each template's statements); titles and
 * whether the organisation has adopted each policy come from the policy library.
 */
@Injectable()
export class CqcMockInspectionPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly library: PolicyLibraryService,
  ) {}

  /** Statement code → ready-made policies for it, in the order the library lists them. */
  async byStatement(): Promise<{ data: Record<string, StatementPolicy[]> }> {
    const [templates, library] = await Promise.all([
      this.prisma.cqcMockInspectionTemplate.findMany({
        where: { retiredAt: null },
        select: { statements: true },
      }),
      this.library.list(),
    ]);
    const byRef = new Map(library.data.map((p) => [p.reference, p]));
    const adoptedIds = library.data.flatMap((p) =>
      p.adoptedPolicyId ? [p.adoptedPolicyId] : [],
    );
    const adopted = adoptedIds.length
      ? await this.prisma.policyDocument.findMany({
          where: { id: { in: adoptedIds } },
          select: {
            id: true,
            status: true,
            versions: { select: { status: true } },
          },
        })
      : [];
    // Same rule as deleting a policy: only a draft that was never published can be deleted.
    const adoptedById = new Map(
      adopted.map((d) => [
        d.id,
        {
          status: d.status,
          canUndo:
            d.status === PolicyStatus.DRAFT &&
            d.versions.length > 0 &&
            d.versions.every((v) => v.status === PolicyStatus.DRAFT),
        },
      ]),
    );
    const refsByStatement = new Map<string, string[]>();
    for (const t of templates) {
      for (const s of readTemplateStatements(t.statements)) {
        if (!refsByStatement.has(s.code))
          refsByStatement.set(s.code, s.guidance?.policies ?? []);
      }
    }
    const out: Record<string, StatementPolicy[]> = {};
    for (const [code, refs] of refsByStatement) {
      const policies = refs.flatMap((ref) => {
        const p = byRef.get(ref);
        return p
          ? [
              {
                id: p.id,
                reference: p.reference,
                title: p.title,
                documentType: p.documentType,
                categoryName: p.category?.name ?? null,
                adoptedPolicyId: p.adoptedPolicyId,
                adoptedStatus: p.adoptedPolicyId
                  ? (adoptedById.get(p.adoptedPolicyId)?.status ?? null)
                  : null,
                canUndoAdopt: p.adoptedPolicyId
                  ? (adoptedById.get(p.adoptedPolicyId)?.canUndo ?? false)
                  : false,
              },
            ]
          : [];
      });
      if (policies.length) out[code] = policies;
    }
    return { data: out };
  }
}
