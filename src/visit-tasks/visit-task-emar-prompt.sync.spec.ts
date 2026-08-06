import {
  EMAR_MEDICATION_PROMPT_NAME,
  isEmarMedicationPromptTask,
} from './visit-task-emar-prompt.sync';

describe('isEmarMedicationPromptTask', () => {
  it('matches by exact catalogue name', () => {
    expect(isEmarMedicationPromptTask({ name: EMAR_MEDICATION_PROMPT_NAME })).toBe(true);
  });

  it('matches by emarPrompt flag', () => {
    expect(
      isEmarMedicationPromptTask({
        name: 'Custom label',
        flagsJson: { emarPrompt: true },
      }),
    ).toBe(true);
  });

  it('rejects unrelated tasks', () => {
    expect(isEmarMedicationPromptTask({ name: 'Personal care' })).toBe(false);
    expect(isEmarMedicationPromptTask({ name: 'Prompt observation', flagsJson: {} })).toBe(false);
  });
});
