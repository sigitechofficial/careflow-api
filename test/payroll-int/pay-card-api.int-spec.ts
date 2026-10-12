/**
 * Gate A sprint — regression check of PC-02 through the pay card API: a custom time band is
 * created, saved, reloaded, edited, previewed and published. Real controllers, guards and tokens.
 */
import request from 'supertest';
import { resetPayData, uuid } from './harness';
import { bearer, createStaffUser, createTestApp, resetIdentityData, TestApp } from './http-harness';

describe('PC-02: custom time band on a pay card (HTTP)', () => {
  let t: TestApp;
  let editor: { id: string };
  let reader: { id: string };
  const server = () => t.app.getHttpServer();
  const as = (user: { id: string }) => bearer(t.staffToken(user.id));
  const code = () => `TEST-PC02-${uuid().slice(0, 8)}`.toUpperCase();

  const weekday = { label: 'Weekday', dayType: 'WEEKDAY', rateType: 'HOURLY', amount: 14 };
  /** A period that matches no preset: 18:30 to 21:45. */
  const customBand = (over: Record<string, unknown> = {}) => ({
    label: 'Twilight',
    dayType: 'WEEKDAY',
    rateType: 'HOURLY',
    amount: 17.5,
    startTime: '18:30',
    endTime: '21:45',
    ...over,
  });
  type StoredRule = { label: string; amount: unknown; startTime?: string; endTime?: string; dayType?: string };
  const twilight = (rules: StoredRule[]) => rules.find((r) => r.label === 'Twilight') as StoredRule;

  beforeAll(async () => {
    t = await createTestApp();
  }, 240_000);
  beforeEach(async () => {
    await resetPayData(t.prisma);
    await resetIdentityData(t.prisma);
    editor = await createStaffUser(t.prisma, { permissions: ['billing.pay_cards.read', 'billing.pay_cards.manage'] });
    reader = await createStaffUser(t.prisma, { permissions: ['billing.pay_cards.read'] });
  });
  afterAll(async () => {
    await t.prisma.payCard.deleteMany({ where: { code: { startsWith: 'TEST-PC02-' } } }).catch(() => undefined);
    await t.close();
  });

  it('create → save → reload → edit → preview → publish', async () => {
    // Create as a draft with a custom band.
    const created = await request(server())
      .post('/billing/pay-cards')
      .set(as(editor))
      .send({ name: 'PC-02 card', code: code(), effectiveFrom: '2026-01-01', rules: [weekday, customBand()] });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data.status).toBe('DRAFT');
    expect(twilight(created.body.data.rules)).toMatchObject({ startTime: '18:30', endTime: '21:45' });

    // Reload: the band is stored exactly as entered.
    const reloaded = await request(server()).get(`/billing/pay-cards/${id}`).set(as(editor));
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.data.rules).toHaveLength(2);
    expect(twilight(reloaded.body.data.rules)).toMatchObject({ startTime: '18:30', endTime: '21:45', dayType: 'WEEKDAY' });
    expect(Number(twilight(reloaded.body.data.rules).amount)).toBe(17.5);

    // Edit the band and save again.
    const edited = await request(server())
      .patch(`/billing/pay-cards/${id}`)
      .set(as(editor))
      .send({ rules: [weekday, customBand({ startTime: '19:15', endTime: '22:40', amount: 18 })] });
    expect(edited.status).toBe(200);
    const afterEdit = await request(server()).get(`/billing/pay-cards/${id}`).set(as(editor));
    expect(afterEdit.body.data.rules).toHaveLength(2);
    expect(twilight(afterEdit.body.data.rules)).toMatchObject({ startTime: '19:15', endTime: '22:40' });
    expect(Number(twilight(afterEdit.body.data.rules).amount)).toBe(18);

    // Preview a visit that crosses into the band: Tue 3 Nov 2026, 18:15 to 20:15.
    // 60 min at £14 (18:15 to 19:15) + 60 min at £18 (19:15 to 20:15).
    const preview = await request(server())
      .post('/billing/pay-cards/preview')
      .set(as(editor))
      .send({ rules: afterEdit.body.data.rules.map(ruleForPreview), date: '2026-11-03', startTime: '18:15', endTime: '20:15' });
    expect(preview.status).toBe(201);
    expect(Number(preview.body.data.amount)).toBe(32);
    expect(preview.body.data.warnings ?? []).toEqual([]);

    // Publish.
    const published = await request(server()).patch(`/billing/pay-cards/${id}`).set(as(editor)).send({ status: 'ACTIVE' });
    expect(published.status).toBe(200);
    const live = await request(server()).get(`/billing/pay-cards/${id}`).set(as(editor));
    expect(live.body.data.status).toBe('ACTIVE');
    expect(twilight(live.body.data.rules)).toMatchObject({ startTime: '19:15', endTime: '22:40' });

    // Changing the band on a published card keeps the old band as history (a new version).
    const changed = await request(server())
      .patch(`/billing/pay-cards/${id}`)
      .set(as(editor))
      .send({ rules: [weekday, customBand({ startTime: '20:00', endTime: '23:59', amount: 19 })] });
    expect(changed.status).toBe(200);
    const versions = await request(server()).get(`/billing/pay-cards/${id}/versions`).set(as(editor));
    expect(versions.status).toBe(200);
    expect(versions.body.data.length).toBeGreaterThanOrEqual(2);
    const current = await request(server()).get(`/billing/pay-cards/${id}`).set(as(editor));
    expect(twilight(current.body.data.rules)).toMatchObject({ startTime: '20:00', endTime: '23:59' });
  });

  it('validation and permission', async () => {
    const body = { name: 'PC-02 card', code: code(), effectiveFrom: '2026-01-01', rules: [weekday, customBand()] };
    expect((await request(server()).post('/billing/pay-cards').send(body)).status).toBe(401);
    expect((await request(server()).post('/billing/pay-cards').set(as(reader)).send(body)).status).toBe(403);
    expect(
      (await request(server()).post('/billing/pay-cards').set(as(editor)).send({ ...body, rules: [customBand({ amount: -1 })] })).status,
    ).toBe(400);
    // A reader can preview (nothing is saved) but cannot change a card.
    const preview = await request(server())
      .post('/billing/pay-cards/preview')
      .set(as(reader))
      .send({ rules: [weekday, customBand()], date: '2026-11-03', startTime: '18:00', endTime: '19:00' });
    expect(preview.status).toBe(201);
    // 30 min at £14 + 30 min at £17.50.
    expect(Number(preview.body.data.amount)).toBe(15.75);
  });
});

/** The stored rule reduced to the fields the pay card form sends back. */
function ruleForPreview(rule: Record<string, unknown>) {
  return {
    label: rule.label,
    dayType: rule.dayType,
    rateType: rule.rateType,
    amount: Number(rule.amount),
    ...(rule.startTime ? { startTime: rule.startTime } : {}),
    ...(rule.endTime ? { endTime: rule.endTime } : {}),
  };
}
