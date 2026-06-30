export type VisitTaskCompletionInputMode = 'tick' | 'value' | 'note' | 'value_and_note';

export type VisitTaskCompletionInputSpec = {
  inputMode: VisitTaskCompletionInputMode;
  valueLabel?: string;
  valuePlaceholder?: string;
  noteLabel?: string;
  notePlaceholder?: string;
};

type TaskInputSource = {
  name: string;
  flagsJson?: Record<string, unknown> | null;
};

const VALUE_SPECS: Record<string, Pick<VisitTaskCompletionInputSpec, 'valueLabel' | 'valuePlaceholder'>> = {
  Weight: { valueLabel: 'Weight', valuePlaceholder: 'e.g. 68.5 kg' },
  Temperature: { valueLabel: 'Temperature', valuePlaceholder: 'e.g. 36.8 °C' },
  'Blood pressure': { valueLabel: 'Blood pressure', valuePlaceholder: 'e.g. 120/80 mmHg' },
  Pulse: { valueLabel: 'Pulse', valuePlaceholder: 'e.g. 72 bpm' },
  SpO2: { valueLabel: 'SpO2', valuePlaceholder: 'e.g. 98 %' },
  'Blood glucose reading': { valueLabel: 'Blood glucose', valuePlaceholder: 'e.g. 7.2 mmol/L' },
  'Pain scale': { valueLabel: 'Pain score', valuePlaceholder: '0–10' },
  'Fluid intake recording': { valueLabel: 'Fluid intake', valuePlaceholder: 'e.g. 250 ml' },
  'Fluid balance chart': { valueLabel: 'Fluid balance', valuePlaceholder: 'e.g. +200 ml' },
  'Structured pain (e.g. Abbey)': { valueLabel: 'Pain score', valuePlaceholder: 'e.g. Abbey score' },
};

const NOTE_SPECS: Record<string, Pick<VisitTaskCompletionInputSpec, 'noteLabel' | 'notePlaceholder'>> = {
  'Behaviour log (PBS-linked)': {
    noteLabel: 'Behaviour notes',
    notePlaceholder: 'What happened, triggers, interventions…',
  },
  'Seizure log': { noteLabel: 'Seizure details', notePlaceholder: 'Duration, type, recovery…' },
  Mood: { noteLabel: 'Mood notes', notePlaceholder: 'How the person seemed…' },
  Sleep: { noteLabel: 'Sleep notes', notePlaceholder: 'Quality, disturbances…' },
  'Bowel / continence recording': {
    noteLabel: 'Bowel / continence notes',
    notePlaceholder: 'Bristol type, continence status…',
  },
  'Food / nutrition recording': {
    noteLabel: 'Food / nutrition notes',
    notePlaceholder: 'What was eaten, amount, appetite…',
  },
  'Bowel care record (Bristol)': {
    noteLabel: 'Bowel record',
    notePlaceholder: 'Bristol scale, intervention…',
  },
  'Epilepsy / seizure record': {
    noteLabel: 'Seizure record',
    notePlaceholder: 'Duration, type, post-ictal state…',
  },
  'Catheter care record': { noteLabel: 'Catheter care notes', notePlaceholder: 'Output, site condition…' },
  'Stoma care record': { noteLabel: 'Stoma care notes', notePlaceholder: 'Appearance, output, bag change…' },
  'Client errand': { noteLabel: 'Errand details', notePlaceholder: 'What was done, receipt, change…' },
  'Flag faulty / unsafe equipment': {
    noteLabel: 'Equipment issue',
    notePlaceholder: 'What is faulty and actions taken…',
  },
  'Stock check': { noteLabel: 'Stock check notes', notePlaceholder: 'Items checked, shortages…' },
  'Record moving-and-handling equipment in use': {
    noteLabel: 'Equipment notes',
    notePlaceholder: 'Equipment used, LOLER status…',
  },
  'Consumable supply check (in-stock / low / out)': {
    noteLabel: 'Supply check notes',
    notePlaceholder: 'Items low or out of stock…',
  },
  'Shopping support': { noteLabel: 'Shopping notes', notePlaceholder: 'Items bought, spend, change…' },
  'Food safety / expiry check': {
    noteLabel: 'Food safety notes',
    notePlaceholder: 'Use-by dates, items discarded…',
  },
  'Body map / skin check': {
    noteLabel: 'Skin check notes',
    notePlaceholder: 'Areas checked, concerns found…',
  },
};

const VALUE_AND_NOTE_SPECS: Record<
  string,
  Pick<VisitTaskCompletionInputSpec, 'valueLabel' | 'valuePlaceholder' | 'noteLabel' | 'notePlaceholder'>
> = {
  'NEWS2 vitals set': {
    valueLabel: 'NEWS2 score',
    valuePlaceholder: 'e.g. 3',
    noteLabel: 'Vitals summary',
    notePlaceholder: 'BP, pulse, temp, SpO2, consciousness…',
  },
  'Insulin administration': {
    valueLabel: 'Units given',
    valuePlaceholder: 'e.g. 8 units',
    noteLabel: 'Injection site',
    notePlaceholder: 'Site rotation, person response…',
  },
  'PEG / enteral feeding': {
    valueLabel: 'Volume given',
    valuePlaceholder: 'e.g. 200 ml',
    noteLabel: 'Feeding notes',
    notePlaceholder: 'Tolerance, residuals…',
  },
  'Respiratory / oxygen': {
    valueLabel: 'Oxygen / flow rate',
    valuePlaceholder: 'e.g. 2 L/min',
    noteLabel: 'Respiratory notes',
    notePlaceholder: 'Breath sounds, sats, distress…',
  },
  'Wound care': {
    valueLabel: 'Dressing / wound status',
    valuePlaceholder: 'e.g. clean, dry, intact',
    noteLabel: 'Wound care notes',
    notePlaceholder: 'Site, exudate, actions taken…',
  },
  'Repositioning (scheduled)': {
    valueLabel: 'Position',
    valuePlaceholder: 'e.g. left side',
    noteLabel: 'Repositioning notes',
    notePlaceholder: 'Skin check, comfort…',
  },
};

function evidenceRequiresNote(flagsJson?: Record<string, unknown> | null): boolean {
  const evidence = flagsJson?.evidenceRequired;
  return Array.isArray(evidence) && evidence.includes('note');
}

function feedsMeasurableObservation(flagsJson?: Record<string, unknown> | null): boolean {
  const feeds = flagsJson?.feedsObservation;
  if (!Array.isArray(feeds)) return false;
  const measurable = new Set([
    'vitals',
    'diabetes',
    'pain',
    'must',
    'fluid_intake',
    'food_intake',
    'news2',
  ]);
  return feeds.some((f) => typeof f === 'string' && measurable.has(f));
}

function isLogOrRecordTask(name: string): boolean {
  return /\b(log|record)\b/i.test(name);
}

export function resolveVisitTaskCompletionInput(task: TaskInputSource): VisitTaskCompletionInputSpec {
  const stored = task.flagsJson?.completionInput;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const mode = (stored as { inputMode?: string }).inputMode;
    if (mode === 'tick' || mode === 'value' || mode === 'note' || mode === 'value_and_note') {
      return {
        inputMode: mode,
        valueLabel: typeof (stored as { valueLabel?: string }).valueLabel === 'string'
          ? (stored as { valueLabel: string }).valueLabel
          : undefined,
        valuePlaceholder:
          typeof (stored as { valuePlaceholder?: string }).valuePlaceholder === 'string'
            ? (stored as { valuePlaceholder: string }).valuePlaceholder
            : undefined,
        noteLabel:
          typeof (stored as { noteLabel?: string }).noteLabel === 'string'
            ? (stored as { noteLabel: string }).noteLabel
            : undefined,
        notePlaceholder:
          typeof (stored as { notePlaceholder?: string }).notePlaceholder === 'string'
            ? (stored as { notePlaceholder: string }).notePlaceholder
            : undefined,
      };
    }
  }

  if (VALUE_AND_NOTE_SPECS[task.name]) {
    return { inputMode: 'value_and_note', ...VALUE_AND_NOTE_SPECS[task.name] };
  }
  if (VALUE_SPECS[task.name]) {
    return { inputMode: 'value', ...VALUE_SPECS[task.name] };
  }
  if (NOTE_SPECS[task.name]) {
    return { inputMode: 'note', ...NOTE_SPECS[task.name] };
  }

  const needsNote = evidenceRequiresNote(task.flagsJson) || isLogOrRecordTask(task.name);
  const needsValue = feedsMeasurableObservation(task.flagsJson);

  if (needsValue && needsNote) {
    return {
      inputMode: 'value_and_note',
      valueLabel: 'Reading',
      valuePlaceholder: 'Enter measured value',
      noteLabel: 'Notes',
      notePlaceholder: 'Additional details…',
    };
  }
  if (needsValue) {
    return {
      inputMode: 'value',
      valueLabel: 'Reading',
      valuePlaceholder: 'Enter measured value',
    };
  }
  if (needsNote) {
    return {
      inputMode: 'note',
      noteLabel: 'Notes',
      notePlaceholder: 'Describe what was done…',
    };
  }

  return { inputMode: 'tick' };
}

export function visitTaskCompletionInputMissing(
  spec: VisitTaskCompletionInputSpec,
  isCompleted: boolean,
  recordedValue?: string | null,
  notes?: string | null,
): string | null {
  if (!isCompleted) return null;
  const value = recordedValue?.trim() ?? '';
  const note = notes?.trim() ?? '';
  if (spec.inputMode === 'value' && !value) return 'Enter a recorded value';
  if (spec.inputMode === 'note' && !note) return 'Enter a description';
  if (spec.inputMode === 'value_and_note') {
    if (!value && !note) return 'Enter a value and description';
    if (!value) return 'Enter a recorded value';
    if (!note) return 'Enter a description';
  }
  return null;
}
