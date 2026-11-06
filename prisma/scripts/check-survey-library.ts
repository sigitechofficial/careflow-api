/**
 * Check survey library files before they are seeded.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/check-survey-library.ts            (whole library)
 *   npx ts-node --transpile-only prisma/scripts/check-survey-library.ts <file.json> (one survey)
 *
 * Prints "SUR-PWS-001 OK: 12 questions (2 comment box, 1 asked only if), 4 sections, ~8 minutes" for each
 * survey that passes. Other choices, clearing answers (exclusiveOptions), comment boxes and show-if
 * rules are checked too (ids, earlier questions, answers that exist).
 */
import { readFileSync } from 'fs';
import { basename } from 'path';
import {
  freezeSurveyIds,
  loadSurveyLibrary,
  readReleasedLibraryIds,
  policyLibraryReferences,
  surveyQuestions,
  validateLibrarySurvey,
  type LibrarySurvey,
} from '../seed-lib/survey-library';

/** Other choices, comment boxes and conditional questions, when the survey has any. */
const extras = (s: LibrarySurvey) => {
  const qs = surveyQuestions(s);
  const parts = [
    [qs.filter((q) => q.otherOption).length, 'Other choice'],
    [qs.filter((q) => q.exclusiveOptions?.length).length, 'clearing answer'],
    [qs.filter((q) => q.comment).length, 'comment box'],
    [qs.filter((q) => q.showIf).length, 'asked only if'],
  ] as const;
  const shown = parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  return shown.length ? ` (${shown.join(', ')})` : '';
};

const line = (s: LibrarySurvey) =>
  `${s.reference} OK: ${surveyQuestions(s).length} questions${extras(s)}, ${s.sections.length} sections, ~${s.estimatedMinutes} minutes`;

const file = process.argv[2];
if (file) {
  let survey: LibrarySurvey;
  try {
    survey = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as LibrarySurvey;
  } catch (err) {
    console.error(`Not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }
  const problems = validateLibrarySurvey(survey, basename(file), {
    policyReferences: policyLibraryReferences(),
    released: survey?.reference ? (readReleasedLibraryIds()[survey.reference] ?? null) : null,
  });
  if (survey?.reference && `${survey.reference}.json` !== basename(file)) problems.push('file name must match the reference');
  if (problems.length) {
    console.error(`${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(line(survey));
} else {
  try {
    const files = loadSurveyLibrary();
    for (const f of files) {
      console.log(`${f.group.short} ${f.group.name}: ${f.surveys.length} survey${f.surveys.length === 1 ? '' : 's'}`);
      for (const s of f.surveys) console.log(`  ${line(s)}`);
    }
    // Released question ids (prisma/scripts/freeze-survey-library-ids.ts): what a release would freeze.
    const released = readReleasedLibraryIds();
    const surveys = files.flatMap((f) => f.surveys);
    const notFrozen = surveys.filter((s) => !released[s.reference]).length;
    const changed = surveys.filter(
      (s) => released[s.reference] && JSON.stringify(freezeSurveyIds(s, released[s.reference])) !== JSON.stringify(released[s.reference]),
    ).length;
    console.log(
      `Released question ids: ${surveys.length - notFrozen} survey(s) frozen` +
        (notFrozen ? `, ${notFrozen} not released yet` : '') +
        (changed ? `, ${changed} with new questions or alerts to freeze when released` : '') +
        '.',
    );
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
