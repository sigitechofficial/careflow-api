import { libraryAlerts } from './survey-alert-rules.util';
import { libraryAccess } from './survey-access';
import { effectiveLibraryMeta, libraryAnonymousVariant, variantDescription } from './survey-library-variant.util';

const meta = {
  type: 'survey-library',
  version: 1,
  introduction: 'Named introduction.',
  privacyNotice: 'Named privacy notice.',
  access: { reportingThreshold: 3, responses: ['REGISTERED_MANAGER'] },
  managerGuidance: {
    alerts: [
      { when: 'Feels unsafe', action: 'Safeguarding.' },
      { when: 'Asks to be contacted', action: 'Phone them.', rule: { task: 'Contact', contactRequest: true } },
    ],
  },
  anonymousVariant: {
    introduction: 'Anonymous introduction.',
    privacyNotice: 'Anonymous privacy notice.',
    leaveOut: ['q-contact'],
    leaveOutAlerts: [1],
    access: { reportingThreshold: 10 },
  },
};

describe('anonymous version of a ready-made survey', () => {
  it('a named survey keeps the named details', () => {
    expect(effectiveLibraryMeta(meta, false)).toBe(meta);
    expect(libraryAlerts(effectiveLibraryMeta(meta, false)).map((a) => a.index)).toEqual([0, 1]);
  });

  it('the anonymous version reads its own introduction, privacy notice, access and alerts (positions kept)', () => {
    const m = effectiveLibraryMeta(meta, true) as Record<string, unknown>;
    expect(m).toMatchObject({ introduction: 'Anonymous introduction.', privacyNotice: 'Anonymous privacy notice.', variant: 'ANONYMOUS' });
    expect(m.anonymousVariant).toBeUndefined();
    expect(libraryAccess(m).threshold).toBe(10);
    expect(libraryAlerts(m).map((a) => a.index)).toEqual([0]);
    expect(variantDescription(libraryAnonymousVariant(meta)!)).toBe('Anonymous introduction.\n\nAnonymous privacy notice.');
  });

  it('a survey whose ready-made details have no anonymous version is unchanged', () => {
    const { anonymousVariant: _v, ...plain } = meta;
    expect(effectiveLibraryMeta(plain, true)).toBe(plain);
    expect(libraryAnonymousVariant(null)).toBeNull();
  });
});
