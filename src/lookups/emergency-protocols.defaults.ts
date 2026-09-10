export const EMERGENCY_PROTOCOL_ICON_KEYS = [
  'activity',
  'droplet',
  'wind',
  'smile',
  'heart',
  'alert',
  'brain',
  'pulse',
] as const;

export type EmergencyProtocolIconKey = (typeof EMERGENCY_PROTOCOL_ICON_KEYS)[number];

export type EmergencyProtocolStepSeed = {
  action: string;
  detail: string;
};

export type EmergencyProtocolSeed = {
  code: string;
  title: string;
  subtitle: string;
  version: string;
  iconKey: EmergencyProtocolIconKey;
  sortOrder: number;
  steps: EmergencyProtocolStepSeed[];
};

/** UK domiciliary v1 catalog. Create-if-missing only — never overwrite admin edits. */
export const DEFAULT_EMERGENCY_PROTOCOLS: EmergencyProtocolSeed[] = [
  {
    code: 'collapse',
    title: 'Unresponsive / collapse',
    subtitle: 'ABC',
    version: 'v2.0',
    iconKey: 'heart',
    sortOrder: 10,
    steps: [
      {
        action: 'Check for danger',
        detail: 'Make the scene safe for you and the person before approaching.',
      },
      {
        action: 'Check response and open airway',
        detail: 'Speak and gently shake the shoulders. Tilt the head and lift the chin. Look, listen and feel for breathing for up to 10 seconds.',
      },
      {
        action: 'Call 999 if unresponsive or not breathing normally',
        detail: 'Put the phone on speaker. Follow the call handler. Check DNACPR / ReSPECT on the care plan before starting CPR.',
      },
      {
        action: 'If not breathing normally and CPR is indicated',
        detail: 'Start chest compressions 30:2 (or continuous compressions if you cannot give rescue breaths). Use an AED if available.',
      },
      {
        action: 'If breathing, place in the recovery position',
        detail: 'Keep the airway open, stay with them, and re-check breathing until help arrives.',
      },
      {
        action: 'Document and handover',
        detail: 'Record times, what you found, DNACPR status, and what you did. Handover to ambulance / office.',
      },
    ],
  },
  {
    code: 'choking',
    title: 'Choking',
    subtitle: 'Adult',
    version: 'v1.2',
    iconKey: 'wind',
    sortOrder: 20,
    steps: [
      {
        action: 'Ask “are you choking?”',
        detail: 'If they can cough or speak, encourage coughing. Do not slap the back while they can still cough effectively.',
      },
      {
        action: 'If they cannot cough, speak or breathe — call 999',
        detail: 'Stand behind them. Give up to 5 back blows between the shoulder blades, checking after each blow.',
      },
      {
        action: 'Give up to 5 abdominal thrusts',
        detail: 'If back blows fail, give up to 5 abdominal thrusts. Repeat back blows and thrusts until the obstruction clears or they become unresponsive.',
      },
      {
        action: 'If they become unresponsive',
        detail: 'Support them to the floor, start CPR, and continue until help arrives. Check the mouth for obvious obstruction before rescue breaths.',
      },
      {
        action: 'Even if the obstruction clears',
        detail: 'Anyone who received abdominal thrusts or became unresponsive must be assessed by a clinician. Inform office and document.',
      },
    ],
  },
  {
    code: 'stroke',
    title: 'Suspected stroke',
    subtitle: 'FAST',
    version: 'v1.1',
    iconKey: 'smile',
    sortOrder: 30,
    steps: [
      {
        action: 'Face',
        detail: 'Ask them to smile. Look for a droop on one side of the face.',
      },
      {
        action: 'Arms',
        detail: 'Ask them to raise both arms. Look for one arm drifting down or inability to lift.',
      },
      {
        action: 'Speech',
        detail: 'Ask them to repeat a simple sentence. Listen for slurring or inability to speak.',
      },
      {
        action: 'Time — call 999 immediately if any FAST sign is present',
        detail: 'Note the time symptoms started (or when last seen well). Do not give food, drink or medication unless directed.',
      },
      {
        action: 'Stay with them until help arrives',
        detail: 'Keep them comfortable, sitting or lying with the head slightly raised if conscious. Document FAST findings and handover.',
      },
    ],
  },
  {
    code: 'chest-pain',
    title: 'Chest pain / suspected heart attack',
    subtitle: 'Call 999',
    version: 'v1.0',
    iconKey: 'pulse',
    sortOrder: 40,
    steps: [
      {
        action: 'Call 999 without delay',
        detail: 'Chest pain, tightness, pain into the arm/jaw, sweating or sudden breathlessness is an emergency.',
      },
      {
        action: 'Sit them in a comfortable position',
        detail: 'Usually sitting upright and supported. Loosen tight clothing. Do not leave them alone.',
      },
      {
        action: 'Check the care plan for GTN / aspirin instructions',
        detail: 'Only give medication that is prescribed for them and that they can take themselves. Do not give aspirin if they are allergic or it is contraindicated.',
      },
      {
        action: 'If they become unresponsive',
        detail: 'Follow the collapse protocol: airway, breathing, 999 still on the line, CPR if indicated and not DNACPR.',
      },
      {
        action: 'Document and handover',
        detail: 'Record onset time, symptoms, medication given, and what 999 advised.',
      },
    ],
  },
  {
    code: 'anaphylaxis',
    title: 'Anaphylaxis',
    subtitle: 'Adrenaline if prescribed',
    version: 'v1.3',
    iconKey: 'alert',
    sortOrder: 50,
    steps: [
      {
        action: 'Call 999 and say anaphylaxis',
        detail: 'Look for sudden breathing difficulty, swelling of the tongue/throat, widespread rash, collapse, or known allergen exposure.',
      },
      {
        action: 'Use their prescribed adrenaline auto-injector if available',
        detail: 'Inject into the outer mid-thigh, through clothing if needed. Note the time. A second dose may be needed after 5 minutes if no improvement and a second device is available.',
      },
      {
        action: 'Lie them down and raise the legs if they feel faint',
        detail: 'If breathing is difficult, sit them up. If they are pregnant, lie on the left side. Do not make them stand or walk.',
      },
      {
        action: 'If they become unresponsive',
        detail: 'Open the airway, check breathing, and start CPR if indicated. Stay on the line with 999.',
      },
      {
        action: 'Document and handover',
        detail: 'Record allergen if known, time of injection(s), response, and remaining devices used.',
      },
    ],
  },
  {
    code: 'hypo',
    title: 'Hypoglycaemia',
    subtitle: 'Blood glucose <4',
    version: 'v1.4',
    iconKey: 'droplet',
    sortOrder: 60,
    steps: [
      {
        action: 'Check blood glucose',
        detail: 'Confirm BM < 4.0 mmol/L and the person is conscious and can swallow.',
      },
      {
        action: 'Give 15–20 g fast-acting glucose',
        detail:
          'e.g. 4–5 glucose tablets, 150 ml fruit juice, or 5 jelly babies. If unable to swallow safely, do NOT give oral glucose — go to the next step.',
      },
      {
        action: 'Wait 10–15 minutes and re-check BM',
        detail: 'If still below 4.0 mmol/L, repeat fast-acting glucose once.',
      },
      {
        action: 'Give longer-acting carbohydrate',
        detail: 'Once BM ≥ 4.0, offer a snack such as toast or biscuits.',
      },
      {
        action: 'Document and inform',
        detail: 'Record readings, treatment given, and notify office / family as needed.',
      },
      {
        action: 'Escalate if no improvement',
        detail: 'If unresponsive, seizing, or BM not rising — call 999.',
      },
    ],
  },
  {
    code: 'sepsis',
    title: 'Deterioration / sepsis',
    subtitle: 'RESTORE2',
    version: 'v2.1',
    iconKey: 'activity',
    sortOrder: 70,
    steps: [
      {
        action: 'If this is an obvious emergency, call 999 first',
        detail: 'Chest pain, suspected stroke, severe breathing difficulty, or collapse — do not delay 999 for a full RESTORE2.',
      },
      {
        action: 'Look for soft signs of deterioration',
        detail: 'Off legs, new confusion, fever, change in urine, breathlessness, not eating/drinking, or “just not right”.',
      },
      {
        action: 'Take observations if you are trained and equipment is available',
        detail: 'Pulse, breathing rate, temperature, oxygen saturations, blood pressure, alertness. Calculate NEWS2 if used by your service.',
      },
      {
        action: 'Escalate using SBARD',
        detail:
          'Situation, Background, Assessment, Recommendation, Decision — to 111, GP, or 999 depending on severity and the care plan.',
      },
      {
        action: 'Follow the care plan / ReSPECT',
        detail: 'Check escalation ceilings, DNACPR, and who to call out of hours. Stay with the person until advice is given.',
      },
      {
        action: 'Document',
        detail: 'Record soft signs, observations, who you called, advice given, and the agreed plan.',
      },
    ],
  },
  {
    code: 'seizure',
    title: 'Seizure',
    subtitle: 'Timed + care plan',
    version: 'v1.0',
    iconKey: 'brain',
    sortOrder: 80,
    steps: [
      {
        action: 'Protect from injury — do not restrain',
        detail: 'Cushion the head, move hazards, loosen tight clothing around the neck. Do not put anything in the mouth.',
      },
      {
        action: 'Time the seizure',
        detail: 'Note the start time. Follow their epilepsy / seizure care plan for rescue medication and when to call 999.',
      },
      {
        action: 'Call 999 if any red flag',
        detail:
          'First seizure, lasts 5 minutes or longer (or longer than their usual), repeated seizures, injury, pregnancy, diabetes, breathing difficulty, or they do not recover as usual.',
      },
      {
        action: 'When the jerking stops',
        detail: 'Check airway and breathing. Place in the recovery position if they are unresponsive but breathing. Stay with them during recovery.',
      },
      {
        action: 'Document and inform',
        detail: 'Record duration, what you saw, rescue medication given, 999/office informed, and recovery.',
      },
    ],
  },
];
