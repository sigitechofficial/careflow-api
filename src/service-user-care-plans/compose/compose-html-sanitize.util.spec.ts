import {
  composeTextContainsRawHtml,
  sanitizeComposeText,
  sanitizeHomeSupportPlanComposeOutput,
} from './compose-html-sanitize.util';

describe('sanitizeComposeText', () => {
  it('removes HTML tags from rich text', () => {
    expect(sanitizeComposeText('<p>Registered with local GP practice.</p>')).toBe(
      'Registered with local GP practice.',
    );
    expect(sanitizeComposeText('<div><strong>Dr Smith</strong></div>')).toBe('Dr Smith');
  });

  it('returns empty string for empty HTML placeholders', () => {
    expect(sanitizeComposeText('<p><br></p>')).toBe('');
    expect(sanitizeComposeText('<p></p>')).toBe('');
    expect(sanitizeComposeText('<div></div>')).toBe('');
    expect(sanitizeComposeText('<p>&nbsp;</p>')).toBe('');
  });

  it('leaves normal plain text unchanged', () => {
    expect(sanitizeComposeText('District nurse visits twice weekly.')).toBe(
      'District nurse visits twice weekly.',
    );
    expect(sanitizeComposeText('  keep spacing  ')).toBe('keep spacing');
  });

  it('decodes HTML entities', () => {
    expect(sanitizeComposeText('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(sanitizeComposeText('&quot;High Street&quot; Pharmacy')).toBe('"High Street" Pharmacy');
  });

  it('sanitizes GP/professional notes example for care plan compose', () => {
    const gpNotes = [
      '<p>Registered with local GP practice.</p>',
      '<p>Dr Smith<br>Riverside Surgery</p>',
      '<p><br></p>',
    ].join('');

    expect(sanitizeComposeText(gpNotes)).toBe(
      'Registered with local GP practice.\nDr Smith\nRiverside Surgery',
    );
  });

  it('preserves line breaks from block-level HTML', () => {
    expect(sanitizeComposeText('<p>Line one</p><p>Line two</p>')).toBe('Line one\nLine two');
  });

  it('handles null and non-string inputs', () => {
    expect(sanitizeComposeText(null)).toBe('');
    expect(sanitizeComposeText(undefined)).toBe('');
    expect(sanitizeComposeText(true)).toBe('Yes');
    expect(sanitizeComposeText(false)).toBe('No');
  });

  it('decodes entity-encoded HTML before stripping tags', () => {
    expect(sanitizeComposeText('&lt;p&gt;Registered with local GP practice.&lt;/p&gt;')).toBe(
      'Registered with local GP practice.',
    );
  });
});

describe('sanitizeHomeSupportPlanComposeOutput', () => {
  it('sanitizes values, suggestions, and provenance in the final compose layer', () => {
    const sanitized = sanitizeHomeSupportPlanComposeOutput({
      values: {
        'sec:gp': '<p>Registered with local GP practice.</p>',
        'sec:lives_alone': true,
      },
      fieldSources: {},
      gaps: [],
      evidence: [],
      composedFrom: {},
      provenance: {
        'sec:gp': {
          sourceType: 'INITIAL_ASSESSMENT',
          submissionId: 'ia-1',
          acceptedAt: '2026-08-19T07:36:44.000Z',
          originalValue: '<p>Registered with local GP practice.</p>',
          sourceDate: '2026-08-19T07:36:44.000Z',
          autoPrefilled: true,
          sourceQuestions: [
            {
              questionId: 'q-gp',
              sourceSection: '§1.1 Holistic assessment',
              sourceLabel: 'GP contact details',
              sourceValue: '<p>Registered with local GP practice.</p>',
            },
          ],
        },
      },
      suggestions: [
        {
          id: 'hsp:1',
          kind: 'value',
          targetFieldKey: 'sec:notes',
          targetLabel: 'Notes',
          targetFieldType: 'TEXTAREA',
          suggestedValue: '<p>Smoking in lounge.</p>',
          displayText: '<p>Smoking in lounge.</p>',
          sourceType: 'INITIAL_ASSESSMENT',
          submissionId: 'ia-1',
          sourceDate: '2026-08-19T07:36:44.000Z',
          sourceQuestions: [
            {
              questionId: 'q-fire',
              sourceSection: '§3.1 Fire',
              sourceLabel: 'Fire safety risks — details',
              sourceValue: '<p>Smoking in lounge.</p>',
            },
          ],
          transform: 'narrative',
        },
      ],
    });

    expect(sanitized.values['sec:gp']).toBe('Registered with local GP practice.');
    expect(sanitized.values['sec:lives_alone']).toBe(true);
    expect(sanitized.suggestions?.[0]?.displayText).toBe('Smoking in lounge.');
    expect(sanitized.suggestions?.[0]?.sourceQuestions[0]?.sourceValue).toBe('Smoking in lounge.');
    expect(sanitized.provenance?.['sec:gp']?.originalValue).toBe('Registered with local GP practice.');
    expect(sanitized.provenance?.['sec:gp']?.sourceQuestions?.[0]?.sourceValue).toBe(
      'Registered with local GP practice.',
    );
    expect(composeTextContainsRawHtml(JSON.stringify(sanitized))).toBe(false);
  });
});
