/**
 * Freeze the survey library's question ids and alerts against each survey's revision.
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/freeze-survey-library-ids.ts
 *
 * Run it when library changes are released (after check-survey-library.ts passes). It writes
 * prisma/seed-data/survey-library-released-ids.json: for every survey, its revision, every question
 * key ever released (type, text, answers; retired ones kept) and its alerts in order. From then on
 * the checker and the seed refuse a released key that disappears, is reused or changes answer type,
 * a released answer dropped without an answerChanges entry, and alerts moved or dropped, unless the
 * survey raises its revision and records the change (retiredQuestions, answerChanges, "retired": true
 * on an alert). The file only grows: a released key is never forgotten.
 */
import { writeFileSync } from 'fs';
import {
  RELEASED_IDS_PATH,
  freezeSurveyIds,
  loadSurveyLibrary,
  readReleasedLibraryIds,
  type ReleasedLibraryIds,
} from '../seed-lib/survey-library';

function main() {
  // Loading checks every survey against what was released before; it throws on any problem.
  const files = loadSurveyLibrary();
  const before = readReleasedLibraryIds();
  const after: ReleasedLibraryIds = { ...before };
  let changed = 0;
  for (const f of files) {
    for (const s of f.surveys) {
      const next = freezeSurveyIds(s, before[s.reference] ?? null);
      if (JSON.stringify(next) !== JSON.stringify(before[s.reference])) changed += 1;
      after[s.reference] = next;
    }
  }
  const sorted = Object.fromEntries(Object.keys(after).sort().map((k) => [k, after[k]]));
  writeFileSync(RELEASED_IDS_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log(`[survey-library] Released ids frozen: ${Object.keys(sorted).length} surveys, ${changed} changed.`);
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
