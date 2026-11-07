import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * CareFlow policy library: complete, ready-to-adopt policies for a CQC-registered home care
 * provider, written in the organisation's own voice. An organisation adopts one as a draft, checks
 * it against its own services, then reviews, approves and publishes it.
 *
 * Files: prisma/seed-data/policy-library/<category>/category.json plus one POL-XX-NNN.json per
 * policy. `{{organisation}}` in the text becomes the organisation's name (company profile).
 */

export const LIBRARY_DOCUMENT_TYPES = ['POLICY', 'PROCEDURE', 'PROTOCOL', 'GUIDELINE'] as const;
export const LIBRARY_MODULES = [
  'CARE_PLAN',
  'INITIAL_ASSESSMENT',
  'RISK_ASSESSMENT',
  'MEDICATION',
  'INCIDENT',
  'SAFEGUARDING',
  'VISIT',
  'EMPLOYEE',
  'HR',
  'TRAINING',
  'RECRUITMENT',
  'AUDIT',
  'BUSINESS_CONTINUITY',
  'BRANCH',
  'EQUIPMENT',
  'INFECTION_CONTROL',
] as const;
export const LIBRARY_ROLES = [
  'Admin',
  'Manager',
  'Care Coordinator',
  'HR',
  'Staff Allocation',
  'Senior Carer/Nurse',
  'Carer/Domestic',
] as const;

export const ORGANISATION_TOKEN = '{{organisation}}';

export type LibraryBlock =
  | { p: string }
  | { bullets: string[] }
  | { steps: string[] }
  | { table: { columns: string[]; rows: string[][] } };
export type LibrarySubsection = { heading: string; blocks: LibraryBlock[] };
export type LibrarySection = { heading: string; blocks: LibraryBlock[]; subsections?: LibrarySubsection[] };
export type LibrarySource = { source: string; url: string };

/**
 * The one-page version staff read and acknowledge: what the policy means for them, what they must
 * and must never do, and who to tell. The full policy is for managers, auditors and inspectors.
 */
export type LibraryKeyPoints = { intro: string; points: string[] };

export type LibraryPolicy = {
  reference: string;
  /** Library revision, from 1. Raised whenever the text changes after release; adopters are told. */
  revision: number;
  /** What changed in this revision (required from revision 2). */
  revisionNote?: string;
  title: string;
  documentType: (typeof LIBRARY_DOCUMENT_TYPES)[number];
  summary: string;
  keyPoints: LibraryKeyPoints;
  reviewFrequencyMonths: number;
  acknowledgementRequired: boolean;
  audience: string[];
  moduleLinks: (typeof LIBRARY_MODULES)[number][];
  relatedReferences: string[];
  regulatoryBasis: LibrarySource[];
  sections: LibrarySection[];
};

export type LibraryCategory = { code: string; name: string; researchedOn: string };
export type LibraryFile = { category: LibraryCategory; documents: LibraryPolicy[] };

/** Reference of the catalogue copy (the organisation's adopted draft uses the plain reference). */
export const catalogueReference = (reference: string) => `LIB-${reference}`;

/** Core sections every policy has, in this order (topic sections sit between them). */
export const REQUIRED_SECTIONS = [
  'Policy statement',
  'Purpose',
  'Scope',
  'Roles and responsibilities',
  'Training and competence',
  'Monitoring and review',
] as const;
/** Rendered from the policy's references, so never written as sections. */
const GENERATED_SECTIONS = ['Related policies and procedures', 'Legislation and guidance'];

/** Body length (excluding key points): long enough to be complete, short enough to be read. */
const WORD_LIMITS: Record<LibraryPolicy['documentType'], [number, number]> = {
  POLICY: [1500, 6000],
  PROCEDURE: [1500, 4500],
  PROTOCOL: [1200, 3500],
  GUIDELINE: [1000, 3000],
};
const KEY_POINT_LIMITS = { points: [5, 12], words: [120, 450], wordsPerPoint: 45 } as const;

/** Wording that belongs in a writing guide or an unfinished draft, never in a policy. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\[|\]/, 'square-bracket placeholder'],
  [/\b(TBC|TBA|TODO|XXX?)\b/, 'unfinished marker'],
  [/lorem ipsum|placeholder|insert (name|date|details|here)/i, 'placeholder text'],
  [/\btemplates?\b/i, 'the word "template"'],
  [/your organisation|your own (wording|policy|procedure)|this section (must|should)|must cover/i, 'writing-guide wording'],
  // Writing-guide prompts ("Explain who this applies to"), not care steps ("Explain what you are going to do").
  [/^(Explain|Describe|Set out|Say|State|List|Outline) .*\b(this (policy|procedure|protocol|guideline|section|document)|applies|the organisation|your)\b/, 'an instruction to the writer'],
  [/<\/?[a-z][^>]*>/i, 'HTML markup'],
  [/\{\{(?!organisation\}\})/, 'an unknown {{token}}'],
];

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function blockTexts(block: LibraryBlock): string[] | null {
  if ('p' in block && typeof block.p === 'string') return [block.p];
  if ('bullets' in block && Array.isArray(block.bullets)) return block.bullets;
  if ('steps' in block && Array.isArray(block.steps)) return block.steps;
  if ('table' in block && block.table && Array.isArray(block.table.columns) && Array.isArray(block.table.rows)) {
    return [...block.table.columns, ...block.table.rows.flat()];
  }
  return null;
}

/** Every piece of text in the policy, for linting and word counts. */
export function policyTexts(p: LibraryPolicy): string[] {
  const out: string[] = [p.title, p.summary];
  for (const s of p.sections ?? []) {
    out.push(s.heading);
    for (const b of s.blocks ?? []) out.push(...(blockTexts(b) ?? []));
    for (const sub of s.subsections ?? []) {
      out.push(sub.heading);
      for (const b of sub.blocks ?? []) out.push(...(blockTexts(b) ?? []));
    }
  }
  return out;
}

export function policyWordCount(p: LibraryPolicy): number {
  return policyTexts(p).reduce((n, t) => n + words(t), 0);
}

/** Problems in one policy file; empty when it can be seeded. */
export function validateLibraryPolicy(value: unknown, name: string): string[] {
  const errors: string[] = [];
  const p = value as Partial<LibraryPolicy>;
  const at = `${name} ${p?.reference ?? '(no reference)'}`;
  if (!p || typeof p !== 'object') return [`${name}: not an object`];
  if (!p.reference || !/^POL-[A-Z]+-\d{3}$/.test(p.reference)) errors.push(`${at}: reference must look like POL-XX-001`);
  if (!Number.isInteger(p.revision) || p.revision! < 1) errors.push(`${at}: revision must be a whole number from 1`);
  if ((p.revision ?? 1) > 1 && !p.revisionNote?.trim()) errors.push(`${at}: revisionNote is required from revision 2`);
  if (!p.title?.trim()) errors.push(`${at}: title is required`);
  if (!p.documentType || !LIBRARY_DOCUMENT_TYPES.includes(p.documentType)) errors.push(`${at}: documentType ${p.documentType} is not allowed`);
  if (!p.summary || p.summary.length < 120 || p.summary.length > 700) errors.push(`${at}: summary must be 120–700 characters`);
  if (!Number.isInteger(p.reviewFrequencyMonths) || p.reviewFrequencyMonths! < 1 || p.reviewFrequencyMonths! > 60) {
    errors.push(`${at}: reviewFrequencyMonths must be 1–60`);
  }
  if (typeof p.acknowledgementRequired !== 'boolean') errors.push(`${at}: acknowledgementRequired must be true or false`);
  if (!Array.isArray(p.audience) || !p.audience.length) errors.push(`${at}: audience is required`);
  for (const a of p.audience ?? []) {
    if (a !== 'ALL_EMPLOYEES' && !(LIBRARY_ROLES as readonly string[]).includes(a)) errors.push(`${at}: unknown audience ${a}`);
  }
  for (const m of p.moduleLinks ?? []) {
    if (!(LIBRARY_MODULES as readonly string[]).includes(m)) errors.push(`${at}: unknown module ${m}`);
  }
  if (!Array.isArray(p.relatedReferences)) errors.push(`${at}: relatedReferences must be a list`);
  if (!Array.isArray(p.regulatoryBasis) || p.regulatoryBasis.length < 2) errors.push(`${at}: at least two legislation or guidance sources are required`);
  for (const s of p.regulatoryBasis ?? []) {
    if (!s?.source?.trim() || !/^https:\/\//.test(s.url ?? '')) errors.push(`${at}: every source needs a name and an https URL`);
  }

  const sections = Array.isArray(p.sections) ? p.sections : [];
  const headings = sections.map((s) => s?.heading?.trim() ?? '');
  let last = -1;
  for (const required of REQUIRED_SECTIONS) {
    const i = headings.indexOf(required);
    if (i === -1) errors.push(`${at}: missing the "${required}" section`);
    else if (i < last) errors.push(`${at}: "${required}" is out of order`);
    else last = i;
  }
  if (headings[0] !== 'Policy statement') errors.push(`${at}: the first section must be "Policy statement"`);
  if (headings[headings.length - 1] !== 'Monitoring and review') errors.push(`${at}: the last section must be "Monitoring and review"`);
  for (const h of headings) if (GENERATED_SECTIONS.includes(h)) errors.push(`${at}: "${h}" is generated from the references; remove it`);
  if (new Set(headings).size !== headings.length) errors.push(`${at}: duplicate section headings`);
  const topical = headings.filter((h) => !(REQUIRED_SECTIONS as readonly string[]).includes(h) && h !== 'Definitions' && h !== 'Records');
  if (topical.length < 2) errors.push(`${at}: needs at least two topic sections setting out the arrangements`);

  for (const s of sections) {
    if (!s?.heading?.trim()) errors.push(`${at}: a section has no heading`);
    const hasBody = (s?.blocks?.length ?? 0) > 0 || (s?.subsections?.length ?? 0) > 0;
    if (!hasBody) errors.push(`${at} "${s?.heading}": section is empty`);
    for (const b of [...(s?.blocks ?? []), ...(s?.subsections ?? []).flatMap((sub) => sub?.blocks ?? [])]) {
      const texts = blockTexts(b);
      if (!texts) errors.push(`${at} "${s?.heading}": unknown block ${JSON.stringify(b).slice(0, 60)}`);
      else if (texts.some((t) => typeof t !== 'string' || !t.trim())) errors.push(`${at} "${s?.heading}": empty text in a block`);
    }
    for (const sub of s?.subsections ?? []) {
      if (!sub?.heading?.trim() || !sub.blocks?.length) errors.push(`${at} "${s?.heading}": every subsection needs a heading and content`);
    }
  }
  const kp = p.keyPoints;
  if (!kp || typeof kp.intro !== 'string' || !kp.intro.trim() || !Array.isArray(kp.points)) {
    errors.push(`${at}: keyPoints needs an intro and a list of points`);
  } else {
    const [minPoints, maxPoints] = KEY_POINT_LIMITS.points;
    if (kp.points.length < minPoints || kp.points.length > maxPoints) errors.push(`${at}: keyPoints needs ${minPoints}–${maxPoints} points`);
    for (const point of kp.points) {
      if (typeof point !== 'string' || !point.trim()) errors.push(`${at}: a key point is empty`);
      else if (words(point) > KEY_POINT_LIMITS.wordsPerPoint) errors.push(`${at}: key point over ${KEY_POINT_LIMITS.wordsPerPoint} words: "${point.slice(0, 60)}"`);
    }
  }
  if (errors.length) return errors;

  const policy = p as LibraryPolicy;
  const keyTexts = [policy.keyPoints.intro, ...policy.keyPoints.points];
  const texts = policyTexts(policy);
  for (const t of [...texts, ...keyTexts]) {
    for (const [re, what] of FORBIDDEN) {
      if (re.test(t)) errors.push(`${at}: contains ${what}: "${t.slice(0, 90)}"`);
    }
  }
  if (!texts.some((t) => t.includes(ORGANISATION_TOKEN))) errors.push(`${at}: never names the organisation (${ORGANISATION_TOKEN})`);
  const keyWords = keyTexts.reduce((n, t) => n + words(t), 0);
  const [minKey, maxKey] = KEY_POINT_LIMITS.words;
  if (keyWords < minKey || keyWords > maxKey) errors.push(`${at}: key points are ${keyWords} words; they must be ${minKey}–${maxKey}`);
  const count = policyWordCount(policy);
  const [min, max] = WORD_LIMITS[policy.documentType];
  const kind = policy.documentType.toLowerCase();
  if (count < min) errors.push(`${at}: ${count} words; a ${kind} needs at least ${min}`);
  if (count > max) errors.push(`${at}: ${count} words; a ${kind} must be at most ${max}. Cut repetition and detail that belongs in another document`);
  return errors;
}

/** Words in the key points (staff summary). */
export function keyPointsWordCount(p: LibraryPolicy): number {
  return [p.keyPoints.intro, ...p.keyPoints.points].reduce((n, t) => n + words(t), 0);
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));

/**
 * Every category folder in the library, validated. Throws listing every problem found. A policy
 * may only relate to policies that exist in the library. `partial` (local previews while the library
 * is still being written) skips unfinished files with a warning and allows missing related policies.
 */
export function loadPolicyLibrary(
  dir = join(__dirname, '..', 'seed-data', 'policy-library'),
  opts: { partial?: boolean } = {},
): LibraryFile[] {
  const errors: string[] = [];
  const files: LibraryFile[] = [];
  const folders = existsSync(dir)
    ? readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()).sort()
    : [];
  for (const folder of folders) {
    const categoryPath = join(dir, folder, 'category.json');
    if (!existsSync(categoryPath)) {
      errors.push(`${folder}: category.json is missing`);
      continue;
    }
    const category = readJson(categoryPath) as LibraryCategory;
    if (!category?.code || !category.name || !/^\d{4}-\d{2}-\d{2}$/.test(category.researchedOn ?? '')) {
      errors.push(`${folder}/category.json: code, name and researchedOn (YYYY-MM-DD) are required`);
      continue;
    }
    const documents: LibraryPolicy[] = [];
    for (const name of readdirSync(join(dir, folder)).filter((f) => /^POL-.*\.json$/.test(f)).sort()) {
      let parsed: unknown;
      try {
        parsed = readJson(join(dir, folder, name));
      } catch (err) {
        errors.push(`${folder}/${name}: not valid JSON (${(err as Error).message})`);
        continue;
      }
      const problems = validateLibraryPolicy(parsed, `${folder}/${name}`);
      if ((parsed as LibraryPolicy)?.reference && `${(parsed as LibraryPolicy).reference}.json` !== name) {
        problems.push(`${folder}/${name}: file name must match the reference`);
      }
      if (problems.length && opts.partial) console.warn(`[policy-library] skipped ${folder}/${name}: ${problems[0]}`);
      else errors.push(...problems);
      if (!problems.length) documents.push(parsed as LibraryPolicy);
    }
    if (documents.length) files.push({ category, documents });
  }

  const refs = new Set<string>();
  for (const f of files) {
    for (const d of f.documents) {
      if (refs.has(d.reference)) errors.push(`${d.reference}: used twice in the library`);
      refs.add(d.reference);
    }
  }
  for (const f of files) {
    for (const d of f.documents) {
      for (const r of d.relatedReferences) {
        if (r === d.reference) errors.push(`${d.reference}: relates to itself`);
        else if (!refs.has(r) && !opts.partial) errors.push(`${d.reference}: related policy ${r} is not in the library`);
      }
    }
  }
  if (errors.length) throw new Error(`Policy library has problems:\n- ${errors.join('\n- ')}`);
  return files;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderBlocks(blocks: LibraryBlock[]): string {
  return blocks
    .map((b) => {
      if ('p' in b) return `<p>${esc(b.p)}</p>`;
      if ('bullets' in b) return `<ul>${b.bullets.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
      if ('steps' in b) return `<ol>${b.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`;
      const head = `<thead><tr>${b.table.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>`;
      const body = `<tbody>${b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      return `<table>${head}${body}</table>`;
    })
    .join('\n');
}

/**
 * The policy as HTML for the policy editor: the key points for staff, numbered sections and
 * subsections, then related policies and the legislation and guidance it rests on. The organisation token is kept; it is
 * replaced with the organisation's name when the policy is shown or adopted.
 */
export function renderPolicyHtml(p: LibraryPolicy, titleOf: (ref: string) => string | undefined): string {
  const parts: string[] = [];
  parts.push('<h2>Key points for staff</h2>');
  parts.push(`<p>${esc(p.keyPoints.intro)}</p>`);
  parts.push(`<ul>${p.keyPoints.points.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
  let n = 0;
  for (const s of p.sections) {
    n += 1;
    parts.push(`<h2>${n}. ${esc(s.heading)}</h2>`);
    if (s.blocks?.length) parts.push(renderBlocks(s.blocks));
    (s.subsections ?? []).forEach((sub, i) => {
      parts.push(`<h3>${n}.${i + 1} ${esc(sub.heading)}</h3>`);
      parts.push(renderBlocks(sub.blocks));
    });
  }
  if (p.relatedReferences.length) {
    n += 1;
    parts.push(`<h2>${n}. Related policies and procedures</h2>`);
    parts.push(
      `<ul>${p.relatedReferences.map((r) => `<li>${esc(r)}${titleOf(r) ? ` ${esc(titleOf(r)!)}` : ''}</li>`).join('')}</ul>`,
    );
  }
  n += 1;
  parts.push(`<h2>${n}. Legislation and guidance</h2>`);
  parts.push(
    `<ul>${p.regulatoryBasis
      .map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source)}</a></li>`)
      .join('')}</ul>`,
  );
  return parts.join('\n');
}

/** Replace the organisation token with the organisation's (HTML-escaped) name. */
export function withOrganisationName(html: string, organisationName: string): string {
  return html.split(ORGANISATION_TOKEN).join(esc(organisationName));
}
