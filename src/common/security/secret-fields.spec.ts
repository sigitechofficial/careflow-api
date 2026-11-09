import { Prisma } from '@prisma/client';
import { SECRET_FIELD_NAMES, isSecretFieldName, stripSecretFields } from './secret-fields';

/** A full identity.User row, the shape `include: { createdBy: true }` used to return. */
function fullUserRow() {
  return {
    id: 'u-1',
    email: 'nurse@example.test',
    username: null,
    passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
    refreshTokenHash: 'sha256:deadbeef',
    firstName: 'Ada',
    lastName: 'Lovelace',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('stripSecretFields', () => {
  it('removes credential columns at any depth, in objects and arrays', () => {
    const body = {
      success: true,
      data: [
        { id: 'e-1', enteredBy: fullUserRow(), createdBy: fullUserRow(), managerReviewedBy: null },
        { id: 'e-2', nested: { deeper: [{ reviewedBy: fullUserRow() }] } },
      ],
      meta: { portalAccount: { email: 'x@y.test', passwordHash: 'h', refreshTokenHash: 'r' } },
    };

    const out = stripSecretFields(body);
    const json = JSON.stringify(out);

    for (const key of SECRET_FIELD_NAMES) expect(json).not.toContain(`"${key}"`);
    expect(out.data[0].enteredBy).toEqual(
      expect.objectContaining({ id: 'u-1', firstName: 'Ada', lastName: 'Lovelace', email: 'nurse@example.test' }),
    );
    expect(out.meta.portalAccount).toEqual({ email: 'x@y.test' });
  });

  it('strips HMRC gateway ciphertext and password-reset token hashes', () => {
    const out = stripSecretFields({
      gatewayTestUserId: 'gw',
      gatewayTestPasswordEnc: 'enc1',
      gatewayLivePasswordEnc: 'enc2',
      resets: [{ id: 'r', tokenHash: 'abc' }],
    });
    expect(out).toEqual({ gatewayTestUserId: 'gw', resets: [{ id: 'r' }] });
  });

  it('never changes its input', () => {
    const row = fullUserRow();
    const body = { data: { createdBy: row } };
    stripSecretFields(body);
    expect(row.passwordHash).toBeDefined();
    expect(body.data.createdBy).toBe(row);
  });

  it('keeps clean subtrees (and clean bodies) by identity: no copying when nothing is secret', () => {
    const clean = { id: 'x', items: [{ a: 1 }, { b: [2, 3] }] };
    expect(stripSecretFields(clean)).toBe(clean);

    const body = { clean, dirty: { passwordHash: 'h', id: 'y' } };
    const out = stripSecretFields(body);
    expect(out).not.toBe(body);
    expect(out.clean).toBe(clean);
  });

  it('leaves self-serialising values (Date, Prisma.Decimal, Buffer) intact', () => {
    const when = new Date('2026-11-05T10:00:00.000Z');
    const amount = new Prisma.Decimal('12.50');
    const buf = Buffer.from('hi');
    const out = stripSecretFields({ when, amount, buf, user: { passwordHash: 'h', id: 'u' } });
    expect(out.when).toBe(when);
    expect(out.amount).toBe(amount);
    expect(out.buf).toBe(buf);
    expect(JSON.parse(JSON.stringify(out))).toEqual({
      when: '2026-11-05T10:00:00.000Z',
      amount: '12.5',
      buf: { type: 'Buffer', data: [104, 105] },
      user: { id: 'u' },
    });
  });

  it('strips secrets on class instances that JSON.stringify would serialise field by field', () => {
    class UserEntity {
      id = 'u';
      passwordHash = 'h';
    }
    expect(JSON.stringify(stripSecretFields({ user: new UserEntity() }))).toBe('{"user":{"id":"u"}}');
  });

  it('passes primitives through and survives cycles', () => {
    expect(stripSecretFields(null)).toBeNull();
    expect(stripSecretFields('passwordHash')).toBe('passwordHash');
    expect(stripSecretFields(42)).toBe(42);
    const a: Record<string, unknown> = { id: 'a' };
    a.self = a;
    expect(() => stripSecretFields(a)).not.toThrow();
  });
});

describe('secret column coverage (schema guard)', () => {
  /**
   * Columns whose names look like credentials but hold no secret, each one checked by hand.
   * When a new lookalike column fails this test, decide which it is: add a real credential
   * to SECRET_FIELD_NAMES, or add a harmless one here with the reason.
   */
  const REVIEWED_NON_SECRETS: Record<string, string> = {
    'ServiceUserCarePlanDraft.approvalContentHash': 'content fingerprint of a care plan draft, not a credential',
    'SurveyLinkRate.linkHash': 'one-way hash of a shared survey link, used only as a per-minute rate-limit key; never returned by any API',
    'CqcFrameworkVersion.contentHash': 'content fingerprint of a CQC framework version, not a credential',
    'SurveyBenchmarkContribution.contributorHash': 'one-way hash identifying a contributing organisation in pooled benchmarks (so a resend replaces its own row), not a credential',
  };

  const LOOKS_SECRET = /(hash|enc|encrypted|cipher|secret|password)$/i;

  it('every credential-looking column in the Prisma schema is stripped from responses', () => {
    const uncovered: string[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      for (const field of model.fields) {
        if (field.kind !== 'scalar' || !LOOKS_SECRET.test(field.name)) continue;
        const id = `${model.name}.${field.name}`;
        if (!isSecretFieldName(field.name) && !REVIEWED_NON_SECRETS[id]) uncovered.push(id);
      }
    }
    expect(uncovered).toEqual([]);
  });

  it('covers the credential columns of every account model', () => {
    const accounts: Record<string, string[]> = {
      User: ['passwordHash', 'refreshTokenHash'],
      EmployeePortalAccount: ['passwordHash', 'refreshTokenHash'],
      ServiceUserPortalAccount: ['passwordHash', 'refreshTokenHash'],
      TemporaryInspector: ['passwordHash', 'refreshTokenHash'],
      PasswordResetToken: ['tokenHash'],
      PayrollEmployerSettings: ['gatewayTestPasswordEnc', 'gatewayLivePasswordEnc'],
    };
    for (const [modelName, cols] of Object.entries(accounts)) {
      const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
      expect(model).toBeDefined();
      for (const col of cols) {
        expect(model!.fields.some((f) => f.name === col)).toBe(true);
        expect(isSecretFieldName(col)).toBe(true);
      }
    }
  });
});
