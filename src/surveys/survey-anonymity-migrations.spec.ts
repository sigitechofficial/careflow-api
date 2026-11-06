import { readFileSync } from 'fs';
import { join } from 'path';

const migration = (name: string) =>
  readFileSync(join(__dirname, `../../prisma/migrations/${name}/migration.sql`), 'utf8');
/** The SQL without its comments (the comments may mention what the statements must not touch). */
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

describe('survey anonymity hardening migrations', () => {
  describe('20261210090000_survey_pending_unlinked_responses', () => {
    const sql = statements(migration('20261210090000_survey_pending_unlinked_responses'));
    const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

    it('creates the pending store with no recipient, person, token or IP column, and no exact-time default', () => {
      const table = sql.slice(sql.indexOf('CREATE TABLE'), sql.indexOf(');', sql.indexOf('CREATE TABLE')));
      expect(table).toContain('"surveys"."SurveyPendingResponse"');
      const columns = [...table.matchAll(/^\s+"(\w+)"/gm)].map((m) => m[1]);
      expect(columns).toEqual(['id', 'surveyId', 'isAnonymous', 'channel', 'payload', 'createdAt']);
      expect(table).not.toMatch(/recipient|employee|serviceUser|token|ip|userAgent|updatedAt|CURRENT_TIMESTAMP/i);
      expect(sql).toMatch(/FOREIGN KEY \("surveyId"\) REFERENCES "surveys"\."Survey"\("id"\)\s+ON DELETE CASCADE/);
    });

    it('matches the Prisma model (no @updatedAt or @default(now()) on it)', () => {
      const model = schema.slice(schema.indexOf('model SurveyPendingResponse {'));
      const body = model.slice(0, model.indexOf('\n}'));
      expect(body).not.toMatch(/@updatedAt|now\(\)|recipient|token/);
      // Either line ending (schema.prisma is checked out with CRLF on Windows).
      expect(body).toMatch(/createdAt\s+DateTime\r?\n/);
    });
  });

  describe('20261210090100_survey_period_library_origin', () => {
    const sql = statements(migration('20261210090100_survey_period_library_origin'));
    const updates = sql.split(/;\s*/).filter((s) => s.includes('UPDATE'));

    it('fills period copies from their clonedFromId parent, only where empty', () => {
      expect(updates).toHaveLength(3);
      for (const u of updates) {
        expect(u).toMatch(/UPDATE "surveys"\."Survey" c/);
        expect(u).toMatch(/FROM "surveys"\."Survey" p/);
        expect(u).toMatch(/c\."clonedFromId" = p\."id"/);
      }
      expect(updates[0]).toMatch(/SET "libraryReference" = p\."libraryReference"/);
      expect(updates[0]).toMatch(/c\."libraryReference" IS NULL/);
      expect(updates[0]).toMatch(/"libraryRevision"\s+= COALESCE\(c\."libraryRevision", p\."libraryRevision"\)/);
      // A copy with its own reference only takes the revision of the same reference.
      expect(updates[1]).toMatch(/c\."libraryRevision" IS NULL/);
      expect(updates[1]).toMatch(/c\."libraryReference" = p\."libraryReference"/);
      expect(updates[2]).toMatch(/SET "createdFromTemplateId" = p\."createdFromTemplateId"/);
      expect(updates[2]).toMatch(/c\."createdFromTemplateId" IS NULL/);
    });

    it('never touches anonymity or anything else', () => {
      expect(sql).not.toMatch(/isAnonymous|allowAnonymousResponses|DELETE|DROP|ALTER/);
    });
  });
});
