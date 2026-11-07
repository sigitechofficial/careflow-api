import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '../../prisma/migrations/20261212090000_survey_audience_service_users/migration.sql'),
  'utf8',
)
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');
const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

describe('20261212090000_survey_audience_service_users', () => {
  it('adds the chosen-people list to surveys, empty by default, and changes nothing else', () => {
    expect(sql).toMatch(
      /ALTER TABLE "surveys"\."Survey"\s+ADD COLUMN IF NOT EXISTS "audienceServiceUserIds" UUID\[\] NOT NULL DEFAULT ARRAY\[\]::UUID\[\];/,
    );
    expect(sql).not.toMatch(/DROP|DELETE|UPDATE|isAnonymous|allowAnonymousResponses/);
    expect(sql.match(/;/g)).toHaveLength(1);
  });

  it('matches the Prisma model', () => {
    const model = schema.slice(schema.indexOf('model Survey {'));
    const body = model.slice(0, model.indexOf('\n}'));
    expect(body).toMatch(/audienceServiceUserIds String\[\] @default\(\[\]\) @db\.Uuid/);
  });
});
