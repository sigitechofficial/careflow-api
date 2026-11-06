import { existsSync, readdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

/**
 * CQC assessment framework as versioned data (Quality & compliance → CQC evidence).
 *
 * Files: prisma/seed-data/cqc-framework/<code>-v<version>.json, one per framework version. Version
 * 1 is CQC's single assessment framework (5 key questions, 34 quality statements, 6 evidence
 * categories). When CQC replaces it (its sector frameworks were in draft at November 2026), the
 * new framework is added as the next version with status ACTIVE and the old file is set to
 * RETIRED. Every statement and evidence category in the new version lists `mapsFrom`: the codes
 * in the previous version it takes over. The seed then links existing evidence to the new
 * statements (planFrameworkRemap) — evidence keeps its old links as history, so nothing is lost
 * and nothing has to be re-entered.
 *
 * Seeds must not import from src/. Statement-title matching for surveys lives in
 * src/cqc-evidence/cqc-statement-match.util.ts; a spec checks every library survey's statements
 * resolve against this framework.
 */

export const CQC_FRAMEWORK_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type CqcFrameworkStatus = (typeof CQC_FRAMEWORK_STATUSES)[number];

/** The five key questions survive in every CQC framework so far (and in the 2026 drafts). */
export const CQC_KEY_QUESTION_CODES = ['SAFE', 'EFFECTIVE', 'CARING', 'RESPONSIVE', 'WELL_LED'] as const;

export const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILE_PATTERN = /^([a-z0-9-]+)-v(\d+)\.json$/;

/** Statement summaries are CareFlow's own short wording, not CQC's text copied at length. */
export const SUMMARY_LIMITS = { minChars: 30, maxChars: 300, maxWords: 45 } as const;

export type CqcFrameworkSource = { id: string; source: string; url: string };
export type CqcStatementVerification = { status: 'verified' | 'unverified'; sources: string[] };

export type CqcFrameworkStatement = {
  code: string;
  title: string;
  summary: string;
  aliases: string[];
  /** Codes in the previous framework version this statement takes over (version 2 onwards). */
  mapsFrom?: string[];
  verification: CqcStatementVerification;
};

export type CqcFrameworkKeyQuestion = {
  code: (typeof CQC_KEY_QUESTION_CODES)[number];
  title: string;
  summary: string;
  statements: CqcFrameworkStatement[];
};

export type CqcFrameworkCategory = {
  code: string;
  title: string;
  description: string;
  mapsFrom?: string[];
  sources: string[];
};

export type CqcFramework = {
  version: number;
  code: string;
  title: string;
  status: CqcFrameworkStatus;
  effectiveFrom: string | null;
  checkedOn: string;
  note: string;
  sources: CqcFrameworkSource[];
  keyQuestions: CqcFrameworkKeyQuestion[];
  evidenceCategories: CqcFrameworkCategory[];
};

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.trim().toLocaleLowerCase('en-GB');

/** Problems in one framework file; empty when it can be seeded. */
export function validateCqcFramework(value: unknown, name: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${name}: not an object`];
  const f = value as Partial<CqcFramework>;
  const errors: string[] = [];
  const at = `${name} v${f.version ?? '?'}`;

  if (!Number.isInteger(f.version) || (f.version as number) < 1) errors.push(`${at}: version must be a whole number from 1`);
  if (!isText(f.code)) errors.push(`${at}: code is required`);
  if (!isText(f.title)) errors.push(`${at}: title is required`);
  if (!f.status || !(CQC_FRAMEWORK_STATUSES as readonly string[]).includes(f.status)) {
    errors.push(`${at}: status must be one of ${CQC_FRAMEWORK_STATUSES.join(', ')}`);
  }
  if (f.effectiveFrom !== null && f.effectiveFrom !== undefined && !DATE_PATTERN.test(f.effectiveFrom)) {
    errors.push(`${at}: effectiveFrom must be YYYY-MM-DD or null`);
  }
  if (!DATE_PATTERN.test(f.checkedOn ?? '')) errors.push(`${at}: checkedOn (YYYY-MM-DD) is required`);
  if (!isText(f.note)) errors.push(`${at}: note is required (what the version is and how it was checked)`);

  const sourceIds = new Set<string>();
  if (!Array.isArray(f.sources) || !f.sources.length) errors.push(`${at}: at least one source is required`);
  for (const s of f.sources ?? []) {
    if (!isText(s?.id) || !isText(s?.source) || !/^https:\/\//.test(s?.url ?? '')) {
      errors.push(`${at}: every source needs an id, a name and an https URL`);
      continue;
    }
    if (sourceIds.has(s.id)) errors.push(`${at}: source ${s.id} is listed twice`);
    sourceIds.add(s.id);
  }
  const checkSources = (ids: unknown, where: string) => {
    if (!Array.isArray(ids) || !ids.length) {
      errors.push(`${where}: needs at least one source`);
      return;
    }
    for (const id of ids) if (!sourceIds.has(id)) errors.push(`${where}: unknown source ${String(id)}`);
  };
  const checkMapsFrom = (mapsFrom: unknown, where: string) => {
    if (mapsFrom === undefined) return;
    if (!Array.isArray(mapsFrom) || !mapsFrom.every((c) => typeof c === 'string' && CODE_PATTERN.test(c))) {
      errors.push(`${where}: mapsFrom must be a list of codes`);
    } else if (f.version === 1 && mapsFrom.length) {
      errors.push(`${where}: version 1 has no previous version to map from`);
    }
  };

  const kqs = Array.isArray(f.keyQuestions) ? f.keyQuestions : [];
  const kqCodes = kqs.map((k) => k?.code);
  if (
    kqCodes.length !== CQC_KEY_QUESTION_CODES.length ||
    !CQC_KEY_QUESTION_CODES.every((c) => kqCodes.includes(c))
  ) {
    errors.push(`${at}: keyQuestions must be ${CQC_KEY_QUESTION_CODES.join(', ')}, once each`);
  }
  const statementCodes = new Set<string>();
  const statementTitles = new Map<string, string>();
  for (const kq of kqs) {
    const kAt = `${at} ${kq?.code ?? '(key question)'}`;
    if (!isText(kq?.title) || !isText(kq?.summary)) errors.push(`${kAt}: title and summary are required`);
    const statements = Array.isArray(kq?.statements) ? kq.statements : [];
    if (!statements.length) errors.push(`${kAt}: needs at least one quality statement`);
    for (const s of statements) {
      const sAt = `${kAt} ${s?.code ?? '(statement)'}`;
      if (!isText(s?.code) || !CODE_PATTERN.test(s.code)) {
        errors.push(`${sAt}: code must be capitals, digits and underscores`);
        continue;
      }
      if (statementCodes.has(s.code)) errors.push(`${sAt}: code is used twice`);
      statementCodes.add(s.code);
      if (!isText(s.title)) errors.push(`${sAt}: title is required`);
      if (!isText(s.summary)) {
        errors.push(`${sAt}: summary is required`);
      } else if (
        s.summary.length < SUMMARY_LIMITS.minChars ||
        s.summary.length > SUMMARY_LIMITS.maxChars ||
        words(s.summary) > SUMMARY_LIMITS.maxWords
      ) {
        errors.push(
          `${sAt}: summary must be ${SUMMARY_LIMITS.minChars}–${SUMMARY_LIMITS.maxChars} characters and at most ${SUMMARY_LIMITS.maxWords} words (a short summary in our own words)`,
        );
      }
      if (!Array.isArray(s.aliases) || !s.aliases.every(isText)) errors.push(`${sAt}: aliases must be a list (may be empty)`);
      for (const label of [s.title, ...(Array.isArray(s.aliases) ? s.aliases : [])]) {
        if (!isText(label)) continue;
        const other = statementTitles.get(norm(label));
        if (other && other !== s.code) errors.push(`${sAt}: "${label}" is also used by ${other}`);
        statementTitles.set(norm(label), s.code);
      }
      if (!s.verification || !['verified', 'unverified'].includes(s.verification.status)) {
        errors.push(`${sAt}: verification.status must be verified or unverified`);
      } else {
        checkSources(s.verification.sources, `${sAt} verification`);
      }
      checkMapsFrom(s.mapsFrom, sAt);
    }
  }

  const categories = Array.isArray(f.evidenceCategories) ? f.evidenceCategories : [];
  if (!categories.length) errors.push(`${at}: needs at least one evidence category`);
  const categoryCodes = new Set<string>();
  for (const c of categories) {
    const cAt = `${at} category ${c?.code ?? '?'}`;
    if (!isText(c?.code) || !CODE_PATTERN.test(c.code)) {
      errors.push(`${cAt}: code must be capitals, digits and underscores`);
      continue;
    }
    if (categoryCodes.has(c.code)) errors.push(`${cAt}: code is used twice`);
    categoryCodes.add(c.code);
    if (!isText(c.title) || !isText(c.description)) errors.push(`${cAt}: title and description are required`);
    checkSources(c.sources, cAt);
    checkMapsFrom(c.mapsFrom, cAt);
  }
  return errors;
}

/** Problems across versions: one ACTIVE version, consecutive numbers, mapsFrom codes that exist. */
export function validateCqcFrameworkSet(frameworks: CqcFramework[]): string[] {
  const errors: string[] = [];
  if (!frameworks.length) return ['No CQC framework files found'];
  const active = frameworks.filter((f) => f.status === 'ACTIVE');
  if (active.length !== 1) errors.push(`Exactly one framework version must be ACTIVE (found ${active.length})`);
  const sorted = [...frameworks].sort((a, b) => a.version - b.version);
  sorted.forEach((f, i) => {
    if (f.version !== i + 1) errors.push(`Framework versions must run 1, 2, 3… (found v${f.version} at position ${i + 1})`);
  });
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevStatements = new Set(statementsOf(prev).map((s) => s.code));
    const prevCategories = new Set(prev.evidenceCategories.map((c) => c.code));
    for (const s of statementsOf(cur)) {
      for (const code of s.mapsFrom ?? []) {
        if (!prevStatements.has(code)) errors.push(`v${cur.version} ${s.code}: mapsFrom ${code} is not a statement in v${prev.version}`);
      }
    }
    for (const c of cur.evidenceCategories) {
      for (const code of c.mapsFrom ?? []) {
        if (!prevCategories.has(code)) errors.push(`v${cur.version} category ${c.code}: mapsFrom ${code} is not a category in v${prev.version}`);
      }
    }
  }
  return errors;
}

export const statementsOf = (f: Pick<CqcFramework, 'keyQuestions'>): CqcFrameworkStatement[] =>
  f.keyQuestions.flatMap((k) => k.statements);

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));

/** Every framework version in the folder, validated, oldest first. Throws listing every problem. */
export function loadCqcFrameworks(dir = join(__dirname, '..', 'seed-data', 'cqc-framework')): CqcFramework[] {
  const errors: string[] = [];
  const frameworks: CqcFramework[] = [];
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const name of files) {
    const m = FILE_PATTERN.exec(name);
    if (!m) {
      errors.push(`${name}: file name must look like saf-v1.json`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = readJson(join(dir, name));
    } catch (err) {
      errors.push(`${name}: not valid JSON (${(err as Error).message})`);
      continue;
    }
    const problems = validateCqcFramework(parsed, name);
    const f = parsed as CqcFramework;
    if (Number.isInteger(f?.version) && Number(m[2]) !== f.version) problems.push(`${name}: file name says v${m[2]} but the file is version ${f.version}`);
    errors.push(...problems);
    if (!problems.length) frameworks.push({ ...f, effectiveFrom: f.effectiveFrom ?? null });
  }
  if (!errors.length) errors.push(...validateCqcFrameworkSet(frameworks));
  if (errors.length) throw new Error(`CQC framework has problems:\n- ${errors.join('\n- ')}`);
  return frameworks.sort((a, b) => a.version - b.version);
}

/** JSON with object keys sorted, so equal content gives an equal hash whatever the key order. */
export function frameworkHash(f: CqcFramework): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]))
        : v;
  return createHash('sha256').update(JSON.stringify(sort(f))).digest('hex');
}

export type FrameworkRemapPlan = {
  /** `v<version>:<code>` of an older statement → codes of the active version's statements that take it over. */
  statements: Map<string, string[]>;
  /** `v<version>:<code>` of an older category → the active version's category code (first successor). */
  categories: Map<string, string>;
  /** Older statements nothing in the active version takes over (evidence stays as history only). */
  unmappedStatements: string[];
};

export const versionKey = (version: number, code: string) => `v${version}:${code}`;

/**
 * Where evidence linked to an older framework version belongs in the active version. Successors
 * follow mapsFrom one version at a time (v1 → v2 → v3); a category without mapsFrom carries on
 * when the next version keeps the same code.
 */
export function planFrameworkRemap(frameworks: CqcFramework[]): FrameworkRemapPlan {
  const sorted = [...frameworks].sort((a, b) => a.version - b.version);
  const active = sorted.find((f) => f.status === 'ACTIVE');
  const plan: FrameworkRemapPlan = { statements: new Map(), categories: new Map(), unmappedStatements: [] };
  if (!active) return plan;
  const upTo = sorted.filter((f) => f.version <= active.version);

  const successors = (to: CqcFramework, code: string): string[] =>
    statementsOf(to)
      .filter((s) => (s.mapsFrom ?? []).includes(code))
      .map((s) => s.code);
  const categorySuccessor = (to: CqcFramework, code: string): string | null =>
    to.evidenceCategories.find((c) => (c.mapsFrom ?? []).includes(code))?.code ??
    (to.evidenceCategories.some((c) => c.code === code && !(c.mapsFrom ?? []).length) ? code : null);

  for (let i = 0; i < upTo.length - 1; i += 1) {
    const start = upTo[i];
    for (const s of statementsOf(start)) {
      let codes = [s.code];
      for (let j = i; j < upTo.length - 1; j += 1) {
        codes = [...new Set(codes.flatMap((c) => successors(upTo[j + 1], c)))];
      }
      if (codes.length) plan.statements.set(versionKey(start.version, s.code), codes);
      else plan.unmappedStatements.push(versionKey(start.version, s.code));
    }
    for (const c of start.evidenceCategories) {
      let code: string | null = c.code;
      for (let j = i; j < upTo.length - 1 && code; j += 1) code = categorySuccessor(upTo[j + 1], code);
      if (code) plan.categories.set(versionKey(start.version, c.code), code);
    }
  }
  return plan;
}
