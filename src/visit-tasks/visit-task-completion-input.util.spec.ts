import {
  resolveVisitTaskCompletionInput,
  visitTaskCompletionInputMissing,
} from '../../prisma/seed-data/visit-task-completion-input.util';

describe('visitTaskCompletionInputMissing', () => {
  it('names insulin injection site instead of a generic description', () => {
    const spec = resolveVisitTaskCompletionInput({ name: 'Insulin administration' });
    expect(spec.inputMode).toBe('value_and_note');
    expect(spec.noteLabel).toBe('Injection site');
    expect(visitTaskCompletionInputMissing(spec, true, '8', null)).toBe(
      'Enter injection site',
    );
    expect(visitTaskCompletionInputMissing(spec, true, null, 'left abdomen')).toBe(
      'Enter units given',
    );
  });
});
