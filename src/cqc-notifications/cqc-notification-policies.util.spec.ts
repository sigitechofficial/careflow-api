import { readdirSync } from 'fs';
import { join } from 'path';
import { CqcNotificationType } from '@prisma/client';
import {
  catalogueReference,
  policiesForCqcForm,
  suggestedPolicyRefs,
} from './cqc-notification-policies.util';

const LIBRARY = join(__dirname, '../../prisma/seed-data/policy-library');
const libraryRefs = new Set(
  readdirSync(LIBRARY, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(LIBRARY, d.name)))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, '')),
);

describe('cqc-notification-policies.util', () => {
  it('only suggests policies that exist in the ready-made library', () => {
    const answers = [
      {},
      { abuseType: 'FINANCIAL', allegedPerpetrator: 'STAFF' },
      { abuseType: 'SEXUAL' },
      { abuseType: 'NEGLECT' },
      { abuseType: 'DISCRIMINATORY' },
      { eventKind: 'STAFFING' },
      { eventKind: 'IT_SYSTEMS' },
    ];
    for (const type of Object.values(CqcNotificationType))
      for (const a of answers)
        for (const ref of suggestedPolicyRefs(type, a))
          expect(libraryRefs.has(ref) ? ref : `missing ${ref}`).toBe(ref);
  });

  it('puts policies for the answers first, then the type, then the general ones', () => {
    const refs = suggestedPolicyRefs(CqcNotificationType.ABUSE_ALLEGATION, {
      abuseType: 'FINANCIAL',
    });
    expect(refs[0]).toBe('POL-CD-017');
    expect(refs).toContain('POL-SG-001');
    expect(refs.at(-1)).toBe('POL-GOV-008');
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('builds the catalogue reference and the CQC form line', () => {
    expect(catalogueReference('POL-SG-001')).toBe('LIB-POL-SG-001');
    expect(policiesForCqcForm([])).toBe('');
    expect(
      policiesForCqcForm([
        {
          title: 'Safeguarding Adults Policy',
          reference: 'POL-SG-001',
          version: 'v2.0',
        },
        {
          title: 'Whistleblowing Policy',
          reference: 'POL-HR-018',
          version: null,
        },
      ]),
    ).toBe(
      'Our relevant policies: Safeguarding Adults Policy (POL-SG-001, v2.0); Whistleblowing Policy (POL-HR-018).',
    );
  });
});
