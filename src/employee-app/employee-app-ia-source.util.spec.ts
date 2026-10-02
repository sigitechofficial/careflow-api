import { withoutUnreviewedIaRows } from './employee-app-ia-source.util';

describe('withoutUnreviewedIaRows', () => {
  const prisma = {
    initialAssessmentSubmission: {
      findMany: jest.fn().mockResolvedValue([{ id: 'reviewed-ia' }]),
    },
  };

  it('keeps office rows and rows from a reviewed IA; hides rows from an unreviewed IA', async () => {
    const rows = [
      { id: 'office', sourceSubmissionId: null },
      { id: 'from-reviewed', sourceSubmissionId: 'reviewed-ia' },
      { id: 'from-submitted', sourceSubmissionId: 'submitted-ia' },
    ];
    const out = await withoutUnreviewedIaRows(prisma as never, rows);
    expect(out.map((r) => r.id)).toEqual(['office', 'from-reviewed']);
  });

  it('does not query when no row came from an IA', async () => {
    prisma.initialAssessmentSubmission.findMany.mockClear();
    await withoutUnreviewedIaRows(prisma as never, [{ sourceSubmissionId: null }]);
    expect(prisma.initialAssessmentSubmission.findMany).not.toHaveBeenCalled();
  });
});
