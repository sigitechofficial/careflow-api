import { parseAboutMeReferenceJson } from './about-me-compose-summary.util';

describe('parseAboutMeReferenceJson', () => {
  it('extracts person-centred fields from About Me JSON', () => {
    const summary = parseAboutMeReferenceJson(
      JSON.stringify({
        version: 1,
        whatIsMostImportantToMe: 'Stay at home',
        peopleImportantToMe: 'Sarah (daughter)',
        howAndWhenToSupportMe: 'Morning personal care',
        howICommunicate: 'Clear speech',
        personalHygiene: 'Shower in morning',
        foodDrinksLike: 'Tea',
        foodDrinksDontLike: 'Shellfish',
        whatMakesMeHappy: 'Radio',
        whatMakesMeUnhappy: 'Being rushed',
        whatMakesAGoodDay: 'Garden time',
        myOccupation: 'Teacher',
        whereIAmFrom: 'Leeds',
        nightSupport: 'Night light',
        routine: {
          monday: { breakfast: '9am porridge' },
        },
      }),
    );
    expect(summary?.whatMattersMost).toBe('Stay at home');
    expect(summary?.peopleImportant).toBe('Sarah (daughter)');
    expect(summary?.foodPreferences).toContain('Tea');
    expect(summary?.routineSummary).toContain('monday breakfast');
    expect(summary?.lifeHistoryInterests).toContain('Leeds');
    expect(summary?.goodDay).toBe('Garden time');
    expect(summary?.nightSupport).toBe('Night light');
  });
});
