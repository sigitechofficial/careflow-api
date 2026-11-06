import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Prisma } from '@prisma/client';

/**
 * Regression guard. A Prisma `include`/`select` must never load a whole row of a model that holds
 * credentials (identity.User, the portal accounts, temporary inspectors...). For example
 * `include: { createdBy: true }` returns `passwordHash` and `refreshTokenHash` to whoever can read
 * the parent record. Use `createdBy: { select: USER_DISPLAY_SELECT }` (common/security/secret-fields).
 *
 * The response interceptor strips these columns anyway. This test keeps the queries themselves narrow,
 * so the safety net is never what keeps them out.
 */

const SECRET_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.kind === 'scalar' && /(passwordhash|refreshtokenhash|tokenhash|passwordenc)$/i.test(f.name)))
    .map((m) => m.name),
);

/** Relation field names (on any model) whose target is a credential-bearing model. */
const SECRET_RELATION_NAMES = new Set(
  Prisma.dmmf.datamodel.models.flatMap((m) =>
    m.fields.filter((f) => f.kind === 'object' && SECRET_MODELS.has(f.type)).map((f) => f.name),
  ),
);

/** Prisma relation-query keys. An object made only of these, with no `select`, loads every column. */
const RELATION_QUERY_KEYS = new Set(['where', 'orderBy', 'take', 'skip', 'cursor', 'distinct', 'include', 'omit']);

const SRC = path.resolve(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function propName(node: ts.ObjectLiteralElementLike): string | undefined {
  return node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : undefined;
}

/** `_count: { select: { createdUsers: true } }` counts rows and is safe. */
function insideCount(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isPropertyAssignment(n) && propName(n) === '_count') return true;
  }
  return false;
}

function findUnsafeRelations(file: string, text = fs.readFileSync(file, 'utf8')): string[] {
  if (![...SECRET_RELATION_NAMES].some((name) => text.includes(name))) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node)) {
      const name = propName(node);
      if (name && SECRET_RELATION_NAMES.has(name) && !insideCount(node)) {
        const value = node.initializer;
        let unsafe = value.kind === ts.SyntaxKind.TrueKeyword;
        if (ts.isObjectLiteralExpression(value) && value.properties.length > 0) {
          const keys = value.properties.map(propName);
          unsafe = keys.every((k) => k !== undefined && RELATION_QUERY_KEYS.has(k)) && !keys.includes('select');
        }
        if (unsafe) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          hits.push(`${path.relative(SRC, file).split(path.sep).join('/')}:${line}  ${node.getText().replace(/\s+/g, ' ').slice(0, 100)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe('no Prisma query loads a whole credential-bearing row', () => {
  it('knows which models hold credentials', () => {
    expect([...SECRET_MODELS]).toEqual(
      expect.arrayContaining(['User', 'EmployeePortalAccount', 'ServiceUserPortalAccount', 'TemporaryInspector']),
    );
    expect([...SECRET_RELATION_NAMES]).toEqual(
      expect.arrayContaining(['createdBy', 'enteredBy', 'managerReviewedBy', 'reviewedBy', 'user', 'portalAccount']),
    );
  });

  it('flags the patterns it is meant to catch', () => {
    const fixture = [
      'export const a = { enteredBy: true };',
      'export const b = { reviewedBy: { include: { userRoles: true } } };',
      'export const c = { createdBy: { select: { id: true } } };',
      'export const d = { _count: { select: { createdUsers: true } } };',
      "export const e = { user: { deletedAt: null, isActive: true } };",
      "export const f = { updatedBy: { connect: { id: 'x' } } };",
    ].join('\n');
    const hits = findUnsafeRelations(path.join(SRC, 'fixture.ts'), fixture).map((h) => h.split('  ')[1]);
    expect(hits).toEqual(['enteredBy: true', 'reviewedBy: { include: { userRoles: true } }']);
  });

  /**
   * The check matches on relation names, so it can't tell `MedicationReview.reviewedBy` (an Employee)
   * from `EmployeeReview.reviewedBy` (a User). Hand-checked collisions go here: file, relation, and the
   * model that owns it. The test below confirms against the schema that this relation really points
   * at a model without credentials, so an entry can't hide a real User include.
   */
  const REVIEWED_NAME_COLLISIONS: Array<{ file: string; relation: string; model: string }> = [
    { file: 'medication-reviews/medication-reviews.service.ts', relation: 'reviewedBy', model: 'MedicationReview' },
  ];

  it('reviewed name collisions really point at models without credentials', () => {
    for (const { relation, model } of REVIEWED_NAME_COLLISIONS) {
      const field = Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields.find((f) => f.name === relation);
      expect(field?.kind).toBe('object');
      expect(SECRET_MODELS.has(field!.type)).toBe(false);
    }
  });

  it('src/ has no `<userRelation>: true` or select-less include of a credential-bearing model', () => {
    const hits = sourceFiles(SRC)
      .flatMap((file) => findUnsafeRelations(file))
      .filter(
        (hit) =>
          !REVIEWED_NAME_COLLISIONS.some(
            (c) => hit.startsWith(`${c.file}:`) && hit.split('  ')[1]?.startsWith(`${c.relation}:`),
          ),
      );
    expect(hits).toEqual([]);
  });
});
