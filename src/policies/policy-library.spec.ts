import {
  catalogueReference,
  loadPolicyLibrary,
  policyWordCount,
  renderPolicyHtml,
  validateLibraryPolicy,
  withOrganisationName,
  type LibraryPolicy,
  type LibrarySection,
} from '../../prisma/seed-lib/policy-library';

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `Care workers record visit ${i + 1} in the daily notes before they leave the home.`).join(' ');

const section = (heading: string, text = filler(20)): LibrarySection => ({ heading, blocks: [{ p: text }] });

const policy = (over: Partial<LibraryPolicy> = {}): LibraryPolicy => ({
  reference: 'POL-XX-001',
  revision: 1,
  title: 'Example Policy',
  documentType: 'POLICY',
  keyPoints: {
    intro: 'What this policy means for you at every visit, in brief. Read the full policy for the detail behind each point.',
    points: [
      'Read the care plan and any alerts before you start the visit.',
      'Check in and check out on CareFlow at the start and end of every visit.',
      'Record what you did and anything you noticed in the daily notes before you leave.',
      'Phone the office before you leave the home if anything worries you.',
      'Call 999 straight away if the person is in danger or seriously unwell.',
      'Never leave the home with a concern unreported, even if you are running late for your next visit.',
      'Ask the office if you are unsure what the care plan means; do not guess or work around it.',
    ],
  },
  summary: 'How we keep people safe at every visit, who is responsible for what, and how we check that it works in practice across every branch.',
  reviewFrequencyMonths: 12,
  acknowledgementRequired: true,
  audience: ['ALL_EMPLOYEES'],
  moduleLinks: ['VISIT'],
  relatedReferences: [],
  regulatoryBasis: [
    { source: 'Regulation 12', url: 'https://www.legislation.gov.uk/uksi/2014/2936/regulation/12' },
    { source: 'Regulation 17', url: 'https://www.legislation.gov.uk/uksi/2014/2936/regulation/17' },
  ],
  sections: [
    section('Policy statement', `{{organisation}} keeps people safe & well. ${filler(20)}`),
    section('Purpose'),
    section('Scope'),
    {
      heading: 'Roles and responsibilities',
      blocks: [],
      subsections: [{ heading: 'Registered Manager', blocks: [{ bullets: ['Audits any branch scoring < 80% & > 0.'] }] }],
    },
    { heading: 'Before the visit', blocks: [{ steps: ['Read the care plan.', 'Check the alerts.'] }, { p: filler(20) }] },
    {
      heading: 'At the visit',
      blocks: [{ table: { columns: ['When', 'Who'], rows: [['Late by 30 minutes', 'Care Coordinator']] } }, { p: filler(20) }],
    },
    section('Training and competence'),
    section('Monitoring and review'),
  ],
  ...over,
});

describe('policy library', () => {
  it('accepts a complete policy', () => {
    expect(validateLibraryPolicy(policy(), 'x.json')).toEqual([]);
    expect(policyWordCount(policy())).toBeGreaterThan(1500);
  });

  it('rejects placeholders and writing-guide wording', () => {
    const sections = policy().sections.map((s) =>
      s.heading === 'Scope' ? section('Scope', `Explain who this applies to [insert team]. TBC. ${filler(20)}`) : s,
    );
    const errors = validateLibraryPolicy(policy({ sections }), 'x.json').join('\n');
    expect(errors).toMatch(/square-bracket placeholder/);
    expect(errors).toMatch(/unfinished marker/);
    expect(errors).toMatch(/instruction to the writer/);
  });

  it('requires the core sections in order, first and last', () => {
    const p = policy();
    const swapped = [...p.sections];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    expect(validateLibraryPolicy(policy({ sections: swapped }), 'x.json').join('\n')).toMatch(/"Scope" is out of order|"Purpose" is out of order/);
    const noTraining = p.sections.filter((s) => s.heading !== 'Training and competence');
    expect(validateLibraryPolicy(policy({ sections: noTraining }), 'x.json')).toContain(
      'x.json POL-XX-001: missing the "Training and competence" section',
    );
    const withRefs = [...p.sections.slice(0, -1), section('Legislation and guidance'), p.sections[p.sections.length - 1]];
    expect(validateLibraryPolicy(policy({ sections: withRefs }), 'x.json').join('\n')).toMatch(/generated from the references/);
  });

  it('rejects a policy that is too short or never names the organisation', () => {
    const short = policy().sections.map((s) => ({ ...s, blocks: s.blocks.length ? [{ p: 'Short.' }] : s.blocks }));
    const errors = validateLibraryPolicy(policy({ sections: short }), 'x.json').join('\n');
    expect(errors).toMatch(/needs at least 1500/);
    expect(errors).toMatch(/never names the organisation/);
  });

  it('caps the length and requires short key points for staff', () => {
    const long = policy().sections.map((s) => (s.heading === 'Scope' ? section('Scope', filler(600)) : s));
    expect(validateLibraryPolicy(policy({ sections: long }), 'x.json').join('\n')).toMatch(/must be at most 6000/);
    const fewPoints = policy({ keyPoints: { intro: 'In brief.', points: ['Read the care plan.'] } });
    expect(validateLibraryPolicy(fewPoints, 'x.json').join('\n')).toMatch(/keyPoints needs 5–12 points/);
    expect(validateLibraryPolicy(policy({ revision: 2 }), 'x.json').join('\n')).toMatch(/revisionNote is required/);
  });

  it('renders numbered, escaped HTML with related policies and sources', () => {
    const html = renderPolicyHtml(policy({ relatedReferences: ['POL-XX-002'] }), (r) => (r === 'POL-XX-002' ? 'Other Policy' : undefined));
    expect(html.indexOf('<h2>Key points for staff</h2>')).toBe(0);
    expect(html).toContain('<h2>1. Policy statement</h2>');
    expect(html).toContain('<h3>4.1 Registered Manager</h3>');
    expect(html).toContain('<li>Audits any branch scoring &lt; 80% &amp; &gt; 0.</li>');
    expect(html).toContain('<ol><li>Read the care plan.</li><li>Check the alerts.</li></ol>');
    expect(html).toContain('<th>When</th><th>Who</th>');
    expect(html).toContain('<h2>9. Related policies and procedures</h2>');
    expect(html).toContain('<li>POL-XX-002 Other Policy</li>');
    expect(html).toContain('<h2>10. Legislation and guidance</h2>');
    expect(withOrganisationName(html, 'Allfor Care & Co')).toContain('<p>Allfor Care &amp; Co keeps people safe &amp; well.');
  });

  it('keeps catalogue references apart from adopted ones', () => {
    expect(catalogueReference('POL-MED-001')).toBe('LIB-POL-MED-001');
  });

  it('ships a library that validates', () => {
    // Strict: every document passes the validator and every related policy exists.
    const files = loadPolicyLibrary();
    const refs = files.flatMap((f) => f.documents.map((d) => d.reference));
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs).toHaveLength(122);
  });
});
