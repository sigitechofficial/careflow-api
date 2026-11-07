import { SetupChecklistService } from './setup-checklist.service';

/** Any model / method: count → 0, lists → [], single rows → null (overridable per test). */
function createPrismaMock() {
  const models = new Map<string, Record<string, jest.Mock>>();
  return new Proxy(
    {},
    {
      get(_target, model: string) {
        if (!models.has(model)) {
          const methods: Record<string, jest.Mock> = {};
          models.set(
            model,
            new Proxy(methods, {
              get(m, method: string) {
                if (!m[method]) {
                  m[method] = jest.fn(async () =>
                    method === 'count' ? 0 : method === 'findMany' ? [] : null,
                  );
                }
                return m[method];
              },
            }),
          );
        }
        return models.get(model);
      },
    },
  ) as any;
}

describe('SetupChecklistService — surveys', () => {
  it('does not count templates or ready-made (catalogue) surveys as surveys created (or active)', async () => {
    const prisma = createPrismaMock();
    prisma.survey.count.mockImplementation(async (args: any) =>
      args.where.isTemplate === false && args.where.isCatalogue === false ? (args.where.status ? 1 : 2) : 99,
    );
    const service = new SetupChecklistService(
      prisma,
      { getOperationalTimezone: jest.fn(async () => 'Europe/London') } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const sections = await (service as any).moduleSections(0);
    const surveys = sections.find((s: any) => s.key === 'surveys');
    const item = (key: string) => surveys.items.find((i: any) => i.key === key);

    expect(item('surveys-created')).toMatchObject({ value: 2, status: 'complete' });
    expect(item('surveys-active')).toMatchObject({ value: 1 });
    for (const [args] of prisma.survey.count.mock.calls) {
      expect(args.where).toMatchObject({ deletedAt: null, isTemplate: false, isCatalogue: false });
    }
  });
});
