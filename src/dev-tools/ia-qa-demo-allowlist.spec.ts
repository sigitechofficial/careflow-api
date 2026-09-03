import {
  IA_QA_DEMO_SERVICE_USER_NUMBERS,
  isDesignatedIaQaDemoServiceUserNumber,
} from './ia-qa-demo-allowlist';
import { IA_AUTOFILL_LEVELS } from './dto/generate-ia-section.dto';

describe('IA QA Demo Service User allow-list', () => {
  it('allows only the existing IA demo identifier SU-1042', () => {
    expect([...IA_QA_DEMO_SERVICE_USER_NUMBERS]).toEqual(['SU-1042']);
    expect(isDesignatedIaQaDemoServiceUserNumber('SU-1042')).toBe(true);
  });

  it('rejects non-designated and persona numbers', () => {
    expect(isDesignatedIaQaDemoServiceUserNumber('SU-9999')).toBe(false);
    expect(isDesignatedIaQaDemoServiceUserNumber('SU-TEST-P01')).toBe(false);
    expect(isDesignatedIaQaDemoServiceUserNumber(null)).toBe(false);
    expect(isDesignatedIaQaDemoServiceUserNumber(undefined)).toBe(false);
    expect(isDesignatedIaQaDemoServiceUserNumber('')).toBe(false);
  });
});

describe('IA QA Demo severity values', () => {
  it('keeps Critical / Moderate / Stable API values unchanged', () => {
    expect(IA_AUTOFILL_LEVELS).toEqual(['low', 'normal', 'critical']);
  });
});
