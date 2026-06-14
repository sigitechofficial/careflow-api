import { computeComposeDeltas } from './compose-delta.util';

describe('computeComposeDeltas', () => {
  it('lists fields where composed value differs from published', () => {
    const deltas = computeComposeDeltas(
      { 'a:1': 'Prompted', 'a:2': 'Same' },
      { 'a:1': 'Self-administers', 'a:2': 'Same' },
      { 'a:1': 'Support level', 'a:2': 'Notes' },
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.label).toBe('Support level');
    expect(deltas[0]?.composedValue).toBe('Prompted');
    expect(deltas[0]?.publishedValue).toBe('Self-administers');
  });
});
