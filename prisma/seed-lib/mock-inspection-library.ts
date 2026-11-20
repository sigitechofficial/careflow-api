import { existsSync, readdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { loadPolicyLibrary } from './policy-library';

/**
 * Ready-made mock CQC inspections (Governance → Mock CQC inspection → Ready-made inspections).
 *
 * Files in prisma/seed-data/mock-inspection-library:
 *  - library.json: research date, note, sources and the template groups;
 *  - statement-guidance.json: for each quality statement code, what to look at, what to ask people
 *    and staff, and where to look in CareFlow (CareFlow's own words, shared by every template);
 *  - MI-NNN.json: one template each: title, summary, when to use, minutes, and its statements
 *    (framework statement codes, each with an optional template-specific focus).
 * The seed stores each template with its statements' guidance joined in. Seeds must not import
 * from src/.
 */

export const TEMPLATE_CODE_PATTERN = /^MI-\d{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TEMPLATE_FILE = /^MI-\d{3}\.json$/;

export type LibrarySource = { id: string; source: string; url: string };
export type LibraryGroup = {
  code: string;
  name: string;
  description: string;
  displayOrder: number;
};
export type MockInspectionLibrary = {
  researchedOn: string;
  note: string;
  sources: LibrarySource[];
  groups: LibraryGroup[];
};
export type StatementGuidance = {
  lookAt: string[];
  askPeople: string[];
  askStaff: string[];
  inCareFlow: string[];
  /** Ready-made policies (POL-… references in the policy library) the statement relies on. */
  policies: string[];
};
export type TemplateStatement = { code: string; focus?: string };
export type MockInspectionTemplateFile = {
  code: string;
  group: string;
  displayOrder: number;
  title: string;
  summary: string;
  whenToUse: string;
  estimatedMinutes: number;
  statements: TemplateStatement[];
  sources: string[];
  researchedOn: string;
};
/** A template as stored: its statements carry their guidance. */
export type SeedTemplate = Omit<MockInspectionTemplateFile, 'statements'> & {
  groupName: string;
  statements: Array<{
    code: string;
    focus: string | null;
    guidance: StatementGuidance;
  }>;
};

const isText = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;
const isTextList = (v: unknown, allowEmpty = true): v is string[] =>
  Array.isArray(v) && v.every(isText) && (allowEmpty || v.length > 0);

/** Problems with the library, guidance and templates against the framework's statement codes. */
export function validateMockInspectionLibrary(
  library: unknown,
  guidance: unknown,
  templates: unknown[],
  frameworkStatementCodes: readonly string[],
  /** References of the ready-made policies; when given, every linked policy must be one of them. */
  policyReferences?: readonly string[],
): string[] {
  const errors: string[] = [];
  const statementCodes = new Set(frameworkStatementCodes);
  const knownPolicies = policyReferences ? new Set(policyReferences) : null;

  const lib = library as Partial<MockInspectionLibrary>;
  if (!lib || typeof lib !== 'object') return ['library.json: not an object'];
  if (!DATE_PATTERN.test(lib.researchedOn ?? ''))
    errors.push('library.json: researchedOn (YYYY-MM-DD) is required');
  if (!isText(lib.note)) errors.push('library.json: note is required');
  const sourceIds = new Set<string>();
  for (const s of Array.isArray(lib.sources) ? lib.sources : []) {
    if (
      !isText(s?.id) ||
      !isText(s?.source) ||
      !/^https:\/\//.test(s?.url ?? '')
    ) {
      errors.push(
        'library.json: every source needs an id, a name and an https URL',
      );
    } else if (sourceIds.has(s.id))
      errors.push(`library.json: source ${s.id} is listed twice`);
    else sourceIds.add(s.id);
  }
  if (!sourceIds.size)
    errors.push('library.json: at least one source is required');
  const groups = new Set<string>();
  for (const g of Array.isArray(lib.groups) ? lib.groups : []) {
    if (
      !isText(g?.code) ||
      !isText(g?.name) ||
      !isText(g?.description) ||
      !Number.isInteger(g?.displayOrder)
    ) {
      errors.push(
        'library.json: every group needs a code, name, description and displayOrder',
      );
    } else groups.add(g.code);
  }
  if (!groups.size) errors.push('library.json: at least one group is required');

  const guide = (guidance ?? {}) as Record<string, Partial<StatementGuidance>>;
  if (
    typeof guidance !== 'object' ||
    guidance === null ||
    Array.isArray(guidance)
  ) {
    errors.push('statement-guidance.json: not an object');
  } else {
    for (const [code, g] of Object.entries(guide)) {
      if (!statementCodes.has(code))
        errors.push(
          `statement-guidance.json: ${code} is not a statement of the framework`,
        );
      if (!isTextList(g?.lookAt, false))
        errors.push(
          `statement-guidance.json ${code}: lookAt needs at least one item`,
        );
      for (const key of ['askPeople', 'askStaff', 'inCareFlow'] as const) {
        if (!isTextList(g?.[key]))
          errors.push(
            `statement-guidance.json ${code}: ${key} must be a list of text`,
          );
      }
      if (!isTextList(g?.policies, false)) {
        errors.push(
          `statement-guidance.json ${code}: policies needs at least one policy reference`,
        );
      } else {
        if (new Set(g.policies).size !== g.policies.length)
          errors.push(
            `statement-guidance.json ${code}: a policy is listed twice`,
          );
        for (const ref of knownPolicies ? g.policies : [])
          if (!knownPolicies!.has(ref))
            errors.push(
              `statement-guidance.json ${code}: ${ref} is not a ready-made policy`,
            );
      }
    }
  }

  const codes = new Set<string>();
  for (const raw of templates) {
    const t = raw as Partial<MockInspectionTemplateFile>;
    const at = `template ${t?.code ?? '?'}`;
    if (!isText(t?.code) || !TEMPLATE_CODE_PATTERN.test(t.code)) {
      errors.push(`${at}: code must look like MI-001`);
      continue;
    }
    if (codes.has(t.code)) errors.push(`${at}: code is used twice`);
    codes.add(t.code);
    if (!groups.has(t.group ?? ''))
      errors.push(`${at}: unknown group ${String(t.group)}`);
    if (!Number.isInteger(t.displayOrder))
      errors.push(`${at}: displayOrder must be a whole number`);
    for (const key of ['title', 'summary', 'whenToUse'] as const)
      if (!isText(t[key])) errors.push(`${at}: ${key} is required`);
    if (
      !Number.isInteger(t.estimatedMinutes) ||
      (t.estimatedMinutes as number) < 15
    )
      errors.push(`${at}: estimatedMinutes must be 15 or more`);
    if (!DATE_PATTERN.test(t.researchedOn ?? ''))
      errors.push(`${at}: researchedOn (YYYY-MM-DD) is required`);
    if (!isTextList(t.sources, false))
      errors.push(`${at}: at least one source is required`);
    else
      for (const id of t.sources)
        if (!sourceIds.has(id)) errors.push(`${at}: unknown source ${id}`);
    const seen = new Set<string>();
    const statements = Array.isArray(t.statements) ? t.statements : [];
    if (!statements.length) errors.push(`${at}: needs at least one statement`);
    for (const s of statements) {
      if (!isText(s?.code)) {
        errors.push(`${at}: every statement needs a code`);
        continue;
      }
      if (!statementCodes.has(s.code))
        errors.push(`${at}: ${s.code} is not a statement of the framework`);
      if (!guide[s.code])
        errors.push(
          `${at}: ${s.code} has no guidance in statement-guidance.json`,
        );
      if (seen.has(s.code)) errors.push(`${at}: ${s.code} is listed twice`);
      seen.add(s.code);
      if (s.focus !== undefined && !isText(s.focus))
        errors.push(`${at}: ${s.code} focus must be text`);
    }
  }
  if (!codes.size) errors.push('No mock inspection templates found');
  return errors;
}

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));

/** The library, validated against the framework's statement codes, as templates ready to store. Throws listing every problem. */
export function loadMockInspectionLibrary(
  frameworkStatementCodes: readonly string[],
  dir = join(__dirname, '..', 'seed-data', 'mock-inspection-library'),
): { library: MockInspectionLibrary; templates: SeedTemplate[] } {
  if (!existsSync(dir))
    throw new Error(`Mock inspection library folder not found: ${dir}`);
  const library = readJson(join(dir, 'library.json'));
  const guidance = readJson(join(dir, 'statement-guidance.json'));
  const files = readdirSync(dir)
    .filter((f) => TEMPLATE_FILE.test(f))
    .sort();
  const templates = files.map((f) => readJson(join(dir, f)));
  const policyReferences = loadPolicyLibrary().flatMap((f) =>
    f.documents.map((d) => d.reference),
  );
  const errors = validateMockInspectionLibrary(
    library,
    guidance,
    templates,
    frameworkStatementCodes,
    policyReferences,
  );
  for (const [i, f] of files.entries()) {
    const code = (templates[i] as { code?: string })?.code;
    if (code && `${code}.json` !== f)
      errors.push(`${f}: file name must match the code ${code}`);
  }
  if (errors.length)
    throw new Error(
      `Mock inspection library has problems:\n- ${errors.join('\n- ')}`,
    );
  const lib = library as MockInspectionLibrary;
  const guide = guidance as Record<string, StatementGuidance>;
  const groupName = new Map(lib.groups.map((g) => [g.code, g.name]));
  return {
    library: lib,
    templates: (templates as MockInspectionTemplateFile[]).map((t) => ({
      ...t,
      groupName: groupName.get(t.group) ?? t.group,
      statements: t.statements.map((s) => ({
        code: s.code,
        focus: s.focus ?? null,
        guidance: guide[s.code],
      })),
    })),
  };
}

/** Hash of a stored template, so the seed skips one that has not changed. */
export function templateHash(
  t: SeedTemplate,
  sources: LibrarySource[],
): string {
  return createHash('sha256')
    .update(JSON.stringify({ t, sources }))
    .digest('hex');
}
