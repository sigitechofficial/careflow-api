import { iaRoute } from './compose-routes.util';

describe('iaRoute', () => {
  it('names the enterprise § as iaSection so the admin opens the tab that shows it', () => {
    expect(iaRoute('su-1', 11)).toBe('/service-users/initial-assessment?serviceUserId=su-1&iaSection=11');
  });

  it('links to the IA without a section when none is given', () => {
    expect(iaRoute('su 1')).toBe('/service-users/initial-assessment?serviceUserId=su%201');
  });
});
