import { closestNames, nameSimilarity } from './fuzzy-names';

describe('closestNames (typo correction for names)', () => {
  const names = ['Mary Jones', 'Margaret Johnson', 'Sam Office', 'Priya Patel'];

  it('corrects small typos in a full name', () => {
    expect(closestNames('Mery Jnes', names)[0]).toBe('Mary Jones');
    expect(closestNames('priya patle', names)[0]).toBe('Priya Patel');
  });

  it('a one-word search is corrected to the matching word of a name', () => {
    expect(closestNames('Jnoes', names)[0]).toBe('Jones');
    expect(closestNames('Pattel', names)[0]).toBe('Patel');
  });

  it('nothing for unrelated or too-short text', () => {
    expect(closestNames('xyzzy', names)).toEqual([]);
    expect(closestNames('ab', names)).toEqual([]);
  });

  it('identical names are fully similar; case and accents do not matter', () => {
    expect(nameSimilarity('Zoë Smith', 'zoe smith')).toBe(1);
  });
});
