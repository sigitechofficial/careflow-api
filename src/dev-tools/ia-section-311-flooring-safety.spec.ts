import {
  SECTION_311_CANONICAL_QUESTION_TEXT,
  SECTION_311_FLOORING_QUESTION_TEXT,
} from '../../prisma/seeds/initial-assessment-enterprise-metadata';
import { isSection311FlooringQuestion } from '../../prisma/seeds/initial-assessment-section-311.seed';

/**
 * Phase 1 seed logs "purged 2 flooring questions + 14 answers".
 * Canonical vs obsolete duplicate texts — used to classify a live purge as
 * (A) intentional duplicate removal or (B) deletion of valid historical Q&A.
 */
describe('§3.11 flooring data-safety contract', () => {
  const obsoleteExtras = [...SECTION_311_FLOORING_QUESTION_TEXT].filter(
    (text) =>
      !SECTION_311_CANONICAL_QUESTION_TEXT.includes(
        text as (typeof SECTION_311_CANONICAL_QUESTION_TEXT)[number],
      ),
  );

  it('keeps exactly two canonical trip/fall flooring questions', () => {
    expect(SECTION_311_CANONICAL_QUESTION_TEXT).toEqual([
      'Rugs or worn carpet (flooring risk)?',
      'Worn carpet on stairs?',
    ]);
  });

  it('names the obsolete duplicate flooring texts that purge/prune may remove', () => {
    expect(obsoleteExtras.sort()).toEqual(['Worn carpet in the home?', 'Worn carpet?']);
  });

  it('classifies flooring by specRef 3.11 or legacy sec_flooring', () => {
    expect(isSection311FlooringQuestion({ specRef: '3.11' })).toBe(true);
    expect(isSection311FlooringQuestion({ legacyCatalogSection: 'sec_flooring' })).toBe(true);
    expect(isSection311FlooringQuestion({ specRef: '3.10' })).toBe(false);
    expect(isSection311FlooringQuestion({ specRef: '18.1' })).toBe(false);
  });

  it('purge helper skips canonical texts so live answers are not wiped on reseed', async () => {
    const canonical = new Set(SECTION_311_CANONICAL_QUESTION_TEXT);
    const extras = [...SECTION_311_FLOORING_QUESTION_TEXT].filter((t) => !canonical.has(t as never));
    expect(extras).toHaveLength(2);
    expect(canonical.has('Rugs or worn carpet (flooring risk)?')).toBe(true);
  });
});
