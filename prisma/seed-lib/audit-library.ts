import { existsSync, readdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

/**
 * Ready-made audits (Governance → Audits → Audit library), written in CareFlow's own words from
 * public sources (CQC fundamental standards, NICE and UKHSA guidance, HSE).
 *
 * Files in prisma/seed-data/audit-library:
 *  - library.json: research date, note, the sources templates cite, and the audit areas;
 *  - AUD-NNN.json: one template each: area, key question, title, summary, how often (and the days it
 *    may be done early or late), minutes, an optional audited item label, the CQC quality statements
 *    it gives evidence for, and its sections of standards. Each standard has an
 *    id (kebab-case, unique in the template) that stays the same when its wording is edited, so
 *    answers keep matching it.
 * Seeds must not import from src/.
 */

export const AUDIT_TEMPLATE_CODE = /^AUD-\d{3}$/;
const TEMPLATE_FILE = /^AUD-\d{3}\.json$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STANDARD_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const AUDIT_KEY_QUESTIONS = [
  'SAFE',
  'EFFECTIVE',
  'CARING',
  'RESPONSIVE',
  'WELL_LED',
] as const;
export const AUDIT_FREQUENCIES = [
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
] as const;
const AREA_CODE = /^[A-Z][A-Z0-9_]*$/;

export type AuditLibrarySource = { id: string; source: string; url: string };
export type AuditLibraryArea = {
  code: string;
  name: string;
  description: string;
  displayOrder: number;
};
export type AuditLibrary = {
  researchedOn: string;
  note: string;
  sources: AuditLibrarySource[];
  areas: AuditLibraryArea[];
};
export type AuditStandard = { id: string; text: string; hint?: string };
export type AuditSection = { title: string; standards: AuditStandard[] };
export type AuditTemplateFile = {
  code: string;
  area: string;
  keyQuestion: (typeof AUDIT_KEY_QUESTIONS)[number];
  displayOrder: number;
  title: string;
  summary: string;
  frequency: (typeof AUDIT_FREQUENCIES)[number];
  earlyDays?: number;
  lateDays?: number;
  introduction?: string;
  auditedItemLabel?: string;
  estimatedMinutes: number;
  cqcStatements: string[];
  sections: AuditSection[];
  sources: string[];
  researchedOn: string;
};

const isText = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

/** Problems with the library and templates; `statementCodes` are the CQC framework's statement codes. */
export function validateAuditLibrary(
  library: unknown,
  templates: unknown[],
  statementCodes?: readonly string[],
): string[] {
  const errors: string[] = [];
  const lib = library as Partial<AuditLibrary>;
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
    )
      errors.push(
        'library.json: every source needs an id, a name and an https URL',
      );
    else if (sourceIds.has(s.id))
      errors.push(`library.json: source ${s.id} is listed twice`);
    else sourceIds.add(s.id);
  }
  if (!sourceIds.size)
    errors.push('library.json: at least one source is required');
  const areas = new Set<string>();
  for (const a of Array.isArray(lib.areas) ? lib.areas : []) {
    if (
      !isText(a?.code) ||
      !AREA_CODE.test(a.code) ||
      !isText(a?.name) ||
      !isText(a?.description) ||
      !Number.isInteger(a?.displayOrder)
    )
      errors.push(
        'library.json: every area needs an UPPER_CASE code, a name, a description and displayOrder',
      );
    else if (areas.has(a.code))
      errors.push(`library.json: area ${a.code} is listed twice`);
    else areas.add(a.code);
  }
  if (!areas.size) errors.push('library.json: at least one area is required');

  const known = statementCodes ? new Set(statementCodes) : null;
  const codes = new Set<string>();
  for (const raw of templates) {
    const t = raw as Partial<AuditTemplateFile>;
    const at = `template ${t?.code ?? '?'}`;
    if (!isText(t?.code) || !AUDIT_TEMPLATE_CODE.test(t.code)) {
      errors.push(`${at}: code must look like AUD-001`);
      continue;
    }
    if (codes.has(t.code)) errors.push(`${at}: code is used twice`);
    codes.add(t.code);
    if (!areas.has(t.area ?? ''))
      errors.push(`${at}: unknown area ${String(t.area)}`);
    for (const key of ['earlyDays', 'lateDays'] as const) {
      const v = t[key];
      if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 60))
        errors.push(`${at}: ${key} must be 0 to 60 days`);
    }
    for (const key of ['introduction', 'auditedItemLabel'] as const)
      if (t[key] !== undefined && !isText(t[key]))
        errors.push(`${at}: ${key} must be text`);
    if (!AUDIT_KEY_QUESTIONS.includes(t.keyQuestion as never))
      errors.push(
        `${at}: keyQuestion must be one of ${AUDIT_KEY_QUESTIONS.join(', ')}`,
      );
    if (!AUDIT_FREQUENCIES.includes(t.frequency as never))
      errors.push(
        `${at}: frequency must be one of ${AUDIT_FREQUENCIES.join(', ')}`,
      );
    if (!Number.isInteger(t.displayOrder))
      errors.push(`${at}: displayOrder must be a whole number`);
    for (const key of ['title', 'summary'] as const)
      if (!isText(t[key])) errors.push(`${at}: ${key} is required`);
    if (
      !Number.isInteger(t.estimatedMinutes) ||
      (t.estimatedMinutes as number) < 10
    )
      errors.push(`${at}: estimatedMinutes must be 10 or more`);
    if (!DATE_PATTERN.test(t.researchedOn ?? ''))
      errors.push(`${at}: researchedOn (YYYY-MM-DD) is required`);
    if (!Array.isArray(t.sources) || !t.sources.length)
      errors.push(`${at}: at least one source is required`);
    else
      for (const id of t.sources)
        if (!sourceIds.has(id)) errors.push(`${at}: unknown source ${id}`);
    if (!Array.isArray(t.cqcStatements))
      errors.push(`${at}: cqcStatements must be a list`);
    else
      for (const code of t.cqcStatements)
        if (known && !known.has(code))
          errors.push(`${at}: ${code} is not a CQC quality statement`);

    const sections = Array.isArray(t.sections) ? t.sections : [];
    if (!sections.length) errors.push(`${at}: needs at least one section`);
    const ids = new Set<string>();
    for (const s of sections) {
      if (!isText(s?.title)) errors.push(`${at}: every section needs a title`);
      const standards = Array.isArray(s?.standards) ? s.standards : [];
      if (!standards.length)
        errors.push(`${at}: section "${s?.title ?? '?'}" has no standards`);
      for (const st of standards) {
        if (!isText(st?.id) || !STANDARD_ID.test(st.id)) {
          errors.push(
            `${at}: standard id "${String(st?.id)}" must be kebab-case`,
          );
          continue;
        }
        if (ids.has(st.id))
          errors.push(`${at}: standard ${st.id} is used twice`);
        ids.add(st.id);
        if (!isText(st.text))
          errors.push(`${at}: standard ${st.id} needs text`);
        if (st.hint !== undefined && !isText(st.hint))
          errors.push(`${at}: standard ${st.id} hint must be text`);
      }
    }
  }
  return errors;
}

export function loadAuditLibrary(
  statementCodes?: readonly string[],
  dir = join(__dirname, '..', 'seed-data', 'audit-library'),
): { library: AuditLibrary; templates: AuditTemplateFile[] } {
  const libraryPath = join(dir, 'library.json');
  if (!existsSync(libraryPath))
    throw new Error(`Audit library: ${libraryPath} is missing`);
  const library = JSON.parse(readFileSync(libraryPath, 'utf8')) as unknown;
  const templates = readdirSync(dir)
    .filter((f) => TEMPLATE_FILE.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown);
  const errors = validateAuditLibrary(library, templates, statementCodes);
  if (errors.length)
    throw new Error(`Audit library is not valid:\n - ${errors.join('\n - ')}`);
  return {
    library: library as AuditLibrary,
    templates: templates as AuditTemplateFile[],
  };
}

/** Changes when anything stored for the template changes, so unchanged templates are skipped. */
export function auditTemplateHash(
  t: AuditTemplateFile,
  sources: AuditLibrarySource[],
): string {
  return createHash('sha256')
    .update(JSON.stringify({ t, sources }))
    .digest('hex');
}
