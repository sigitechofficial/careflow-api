import {
  parseObservationNumeric,
  resolveTaskObsLink,
} from './visit-task-obs-link.util';

describe('visit-task-obs-link', () => {
  it('links Blood glucose reading to blood_glucose / BLOOD_SUGAR', () => {
    expect(
      resolveTaskObsLink({
        name: 'Blood glucose reading',
        flagsJson: { feedsObservation: ['diabetes'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'blood_glucose',
      observationTypeCode: 'BLOOD_SUGAR',
    });
  });

  it('links Check pressure areas to skin_body_map / BODY_MAP (not blood pressure)', () => {
    expect(resolveTaskObsLink({ name: 'Check pressure areas' })).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'skin_body_map',
      observationTypeCode: 'BODY_MAP',
    });
  });

  it('links Assisted wash to skin_integrity via feedsObservation', () => {
    expect(
      resolveTaskObsLink({
        name: 'Assisted wash',
        flagsJson: { feedsObservation: ['skin_integrity'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'skin_integrity',
      observationTypeCode: 'SKIN_INTEGRITY',
    });
  });

  it('links Temperature with vitals tag to temp, not blood pressure', () => {
    expect(
      resolveTaskObsLink({
        name: 'Temperature',
        flagsJson: { feedsObservation: ['vitals'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'temp',
      observationTypeCode: 'TEMPERATURE',
    });
  });

  it('still links Blood pressure to bp / BLOOD_PRESSURE', () => {
    expect(
      resolveTaskObsLink({
        name: 'Blood pressure',
        flagsJson: { feedsObservation: ['vitals'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'bp',
      observationTypeCode: 'BLOOD_PRESSURE',
    });
  });

  it('links Pain scale to pain_score / PAIN via name and feedsObservation', () => {
    expect(resolveTaskObsLink({ name: 'Pain scale' })).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'pain_score',
      observationTypeCode: 'PAIN',
    });
    expect(
      resolveTaskObsLink({
        name: 'Structured pain (e.g. Abbey)',
        flagsJson: { feedsObservation: ['pain'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'pain_score',
      observationTypeCode: 'PAIN',
    });
  });

  it('links Toilet / pad / catheter to continence, not bowel', () => {
    expect(
      resolveTaskObsLink({
        name: 'Toilet / commode assist',
        flagsJson: { feedsObservation: ['continence'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'continence',
      observationTypeCode: 'CONTINENCE',
    });
    expect(
      resolveTaskObsLink({
        name: 'Pad / continence-product change',
        flagsJson: { feedsObservation: ['continence'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'continence',
      observationTypeCode: 'CONTINENCE',
    });
    expect(
      resolveTaskObsLink({
        name: 'Catheter care',
        flagsJson: { feedsObservation: ['continence'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'continence',
      observationTypeCode: 'CONTINENCE',
    });
  });

  it('keeps Bowel care on bowel when tagged continence + bowel', () => {
    expect(
      resolveTaskObsLink({
        name: 'Bowel care',
        flagsJson: { feedsObservation: ['continence', 'bowel'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'bowel',
      observationTypeCode: 'BOWEL_MOVEMENT',
    });
    expect(
      resolveTaskObsLink({
        name: 'Bowel / continence recording',
        flagsJson: { feedsObservation: ['continence', 'bowel'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'bowel',
      observationTypeCode: 'BOWEL_MOVEMENT',
    });
  });

  it('links Repositioning / turning to repositioning, not skin integrity', () => {
    expect(
      resolveTaskObsLink({
        name: 'Repositioning / turning',
        flagsJson: { feedsObservation: ['repositioning_chart', 'skin_integrity'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'repositioning',
      observationTypeCode: 'REPOSITIONING',
    });
    expect(
      resolveTaskObsLink({
        name: 'Repositioning (scheduled)',
        flagsJson: { feedsObservation: ['repositioning_chart'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'repositioning',
      observationTypeCode: 'REPOSITIONING',
    });
  });

  it('links Sleep to sleep / SLEEP and Mood to wellbeing', () => {
    expect(
      resolveTaskObsLink({
        name: 'Sleep',
        flagsJson: { feedsObservation: ['wellbeing'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'sleep',
      observationTypeCode: 'SLEEP',
    });
    expect(
      resolveTaskObsLink({
        name: 'Mood',
        flagsJson: { feedsObservation: ['wellbeing'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'mood_wellbeing',
      observationTypeCode: 'WELLBEING',
    });
  });

  it('links Falls assistance to falls / FALLS', () => {
    expect(resolveTaskObsLink({ name: 'Falls assistance' })).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'falls',
      observationTypeCode: 'FALLS',
    });
  });

  it('links food, seizure, behaviour and respiratory tasks to the right sheets', () => {
    expect(resolveTaskObsLink({ name: 'PEG / enteral feeding' })).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'peg_enteral',
      observationTypeCode: 'PEG_ENTERAL',
    });
    expect(resolveTaskObsLink({ name: 'Food safety / expiry check' })).toBeNull();
    expect(
      resolveTaskObsLink({
        name: 'Assist to eat',
        flagsJson: { feedsObservation: ['food_intake'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'meals',
      observationTypeCode: 'MEALS',
    });
    expect(
      resolveTaskObsLink({
        name: 'Food / nutrition recording',
        flagsJson: { feedsObservation: ['food_intake', 'must'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'meals',
      observationTypeCode: 'MEALS',
    });
    expect(
      resolveTaskObsLink({
        name: 'Seizure log',
        flagsJson: { feedsObservation: ['epilepsy'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'seizure',
      observationTypeCode: 'SEIZURE_CHART',
    });
    expect(
      resolveTaskObsLink({
        name: 'Behaviour log (PBS-linked)',
        flagsJson: { feedsObservation: ['pbs'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'abc_patterns',
      observationTypeCode: 'ABC_PATTERNS',
    });
    expect(
      resolveTaskObsLink({
        name: 'Respiratory / oxygen',
        flagsJson: { feedsObservation: ['vitals'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'respiration',
      observationTypeCode: 'RESPIRATION',
    });
    expect(
      resolveTaskObsLink({
        name: 'SpO2',
        flagsJson: { feedsObservation: ['vitals'] },
      }),
    ).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'spo2',
      observationTypeCode: 'OXYGEN_SATURATION',
    });
  });

  it('links Encourage fluids to fluid_intake / FLUID_MONITOR', () => {
    expect(resolveTaskObsLink({ name: 'Encourage fluids' })).toEqual({
      linkTab: 'obs',
      linkedTypeCode: 'fluid_intake',
      observationTypeCode: 'FLUID_MONITOR',
    });
  });

  it('parses numeric readings from notes-style strings', () => {
    expect(parseObservationNumeric('5')).toBe(5);
    expect(parseObservationNumeric('5 mmol/L')).toBe(5);
    expect(parseObservationNumeric('5.2mmol/L')).toBe(5.2);
    expect(parseObservationNumeric(null)).toBeNull();
  });
});
