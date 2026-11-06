import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CarePlanTextService } from './care-plan-text.service';

type Row = Record<string, unknown>;

function createService() {
  const rows: Row[] = [];
  const now = new Date('2026-11-05T10:00:00Z');
  const withMeta = (data: Row): Row => ({
    id: 'tpl-1',
    categoryId: null,
    formId: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    category: null,
    form: null,
    ...data,
  });
  const carePlanTextTemplate = {
    findFirst: jest.fn(async () => rows[0] ?? null),
    create: jest.fn(async ({ data }: { data: Row }) => {
      const row = withMeta(data);
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ data }: { data: Row }) => {
      Object.assign(rows[0], data);
      return rows[0];
    }),
  };
  const prisma = {
    carePlanTextTemplate,
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ carePlanTextTemplate })),
  } as unknown as PrismaService;
  const audit = {
    logAudit: jest.fn(async () => undefined),
    getChangedFields: jest.fn(() => []),
  } as unknown as AuditLogsService;
  return { service: new CarePlanTextService(prisma, audit), rows, withMeta };
}

describe('CarePlanTextService rich text', () => {
  it('stores sanitised HTML and plain text when a template is created', async () => {
    const { service, rows } = createService();
    const res = await service.create('user-1', {
      title: 'Morning routine',
      contentHtml: '<p onmouseover="steal()">Help @ wash</p><script>alert(1)</script><a href="javascript:x()">more</a>',
    });
    expect(rows[0].contentHtml).toBe('<p>Help @ wash</p><a>more</a>');
    expect(rows[0].plainText).toBe('Help @ wash more');
    expect(res.data.contentHtml).toBe('<p>Help @ wash</p><a>more</a>');
  });

  it('stores sanitised HTML when a template is updated', async () => {
    const { service, rows, withMeta } = createService();
    rows.push(withMeta({ title: 'Old', contentHtml: '<p>Old</p>', plainText: 'Old', deletedAt: null }));
    await service.update('user-1', 'tpl-1', { contentHtml: '<h2>New</h2><iframe src="https://evil.example"></iframe>' });
    expect(rows[0].contentHtml).toBe('<h2>New</h2>');
    expect(rows[0].plainText).toBe('New');
  });

  it('sanitises the preview after the service user name is put in', async () => {
    const { service, rows, withMeta } = createService();
    rows.push(
      withMeta({
        title: 'Legacy',
        // Saved before save-time sanitising.
        contentHtml: '<p>Support @ to dress</p><img src=x onerror="alert(1)">',
        plainText: '',
        deletedAt: null,
      }),
    );
    const res = await service.preview('user-1', 'tpl-1', {
      serviceUserName: 'Jo <script>alert(1)</script>',
    });
    expect(res.data.contentHtml).toBe('<p>Support Jo  to dress</p>');
  });
});
