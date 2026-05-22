import { replaceCarePlanTextPlaceholders } from './care-plan-text.service';

describe('replaceCarePlanTextPlaceholders', () => {
  it('replaces @ with the service user name', () => {
    expect(replaceCarePlanTextPlaceholders('Hello @, welcome.', 'Jane Doe')).toBe(
      'Hello Jane Doe, welcome.',
    );
  });

  it('replaces multiple @ tokens', () => {
    expect(replaceCarePlanTextPlaceholders('@ lives with @.', 'Alex')).toBe(
      'Alex lives with Alex.',
    );
  });
});
