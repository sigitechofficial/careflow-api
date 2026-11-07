/**
 * Check policy library files before they are seeded.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/check-policy-library.ts            (whole library)
 *   npx ts-node --transpile-only prisma/scripts/check-policy-library.ts <file.json> (one policy)
 */
import { readFileSync } from 'fs';
import { basename } from 'path';
import {
  keyPointsWordCount,
  loadPolicyLibrary,
  policyWordCount,
  validateLibraryPolicy,
  type LibraryPolicy,
} from '../seed-lib/policy-library';

const file = process.argv[2];
if (file) {
  const policy = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as LibraryPolicy;
  const problems = validateLibraryPolicy(policy, basename(file));
  if (policy?.reference && `${policy.reference}.json` !== basename(file)) problems.push('file name must match the reference');
  if (problems.length) {
    console.error(`${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(
    `${policy.reference} OK: ${policyWordCount(policy)} words, ${policy.sections.length} sections, ` +
      `key points ${keyPointsWordCount(policy)} words.`,
  );
} else {
  const files = loadPolicyLibrary();
  for (const f of files) {
    const count = f.documents.reduce((n, d) => n + policyWordCount(d), 0);
    console.log(`${f.category.code}: ${f.documents.length} policies, ${count} words`);
  }
}
