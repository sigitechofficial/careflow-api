export type AlignOption = { value: string; label: string };

const CONTINENCE_STATUS = ['CONTINENT', 'PAD_CHANGED', 'CATHETER_CARE', 'INCONTINENT'] as const;
const PEG_FEED = ['YES', 'PARTIAL', 'NO', 'NOT_DUE'] as const;
const PEG_TUBE = ['PATENT', 'BLOCKED', 'DISLODGED', 'NOT_CHECKED'] as const;
const PEG_SITE = ['INTACT', 'REDNESS', 'LEAKAGE', 'DISCHARGE'] as const;
const SKIN_CONDITION = ['INTACT', 'REDNESS', 'BROKEN', 'DRY', 'RASH', 'PRESSURE_MARK'] as const;
const BODY_MAP_CONDITION = ['INTACT', 'REDNESS', 'BLISTER', 'BROKEN', 'PRESSURE_ULCER'] as const;
const BRISTOL = ['TYPE_1', 'TYPE_2', 'TYPE_3', 'TYPE_4', 'TYPE_5', 'TYPE_6', 'TYPE_7'] as const;
const FALL_YN = ['YES', 'NO'] as const;
const REPOSITION = ['LEFT', 'RIGHT', 'BACK', 'SITTING'] as const;
const MEAL_AMOUNT = ['ALL', 'MOST', 'HALF', 'LITTLE', 'REFUSED'] as const;

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asCodes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function requireCode(payload: Record<string, unknown>, key: string, allowed: readonly string[], label: string) {
  const code = asString(payload[key]);
  if (!code || !allowed.includes(code)) {
    throw new Error(`${label} is required`);
  }
}

export function validateAlignedCarePayload(typeCode: string, payload: Record<string, unknown>): void {
  const code = typeCode.toUpperCase();
  switch (code) {
    case 'CONTINENCE':
      requireCode(payload, 'status', CONTINENCE_STATUS, 'status');
      return;
    case 'PEG_ENTERAL':
      requireCode(payload, 'feed_given', PEG_FEED, 'feed_given');
      requireCode(payload, 'tube_status', PEG_TUBE, 'tube_status');
      requireCode(payload, 'site', PEG_SITE, 'site');
      return;
    case 'SKIN_INTEGRITY':
      requireCode(payload, 'condition', SKIN_CONDITION, 'condition');
      return;
    case 'BODY_MAP':
      requireCode(payload, 'condition', BODY_MAP_CONDITION, 'condition');
      return;
    case 'BOWEL_MOVEMENT':
      requireCode(payload, 'bristol', BRISTOL, 'bristol');
      return;
    case 'FALLS': {
      const occurred = asString(payload.fall_occurred);
      if (occurred && FALL_YN.includes(occurred as (typeof FALL_YN)[number])) return;
      if (payload.hadFall === true || payload.hadFall === false || payload.hadFall === 'true' || payload.hadFall === 'false') {
        return;
      }
      throw new Error('fall_occurred is required');
    }
    case 'REPOSITIONING':
      requireCode(payload, 'position', REPOSITION, 'position');
      return;
    case 'MEALS': {
      const amount = asString(payload.amount);
      if (amount && MEAL_AMOUNT.includes(amount as (typeof MEAL_AMOUNT)[number])) return;
      if (asString(payload.mealType)) return;
      throw new Error('amount is required');
    }
    default:
      return;
  }
}

const LABEL: Record<string, string> = {
  CONTINENT: 'Continent',
  PAD_CHANGED: 'Pad changed',
  CATHETER_CARE: 'Catheter care',
  INCONTINENT: 'Incontinent',
  CATHETER: 'Catheter',
  YES: 'Yes',
  PARTIAL: 'Partial',
  NO: 'No',
  NOT_DUE: 'Not due',
  PATENT: 'Patent',
  BLOCKED: 'Blocked',
  DISLODGED: 'Dislodged',
  NOT_CHECKED: 'Not checked',
  INTACT: 'Intact',
  REDNESS: 'Redness',
  LEAKAGE: 'Leakage',
  DISCHARGE: 'Discharge',
  BROKEN: 'Broken',
  DRY: 'Dry',
  RASH: 'Rash',
  PRESSURE_MARK: 'Pressure mark',
  BLISTER: 'Blister',
  PRESSURE_ULCER: 'Pressure ulcer',
  TYPE_1: 'Type 1 · hard lumps',
  TYPE_2: 'Type 2 · lumpy',
  TYPE_3: 'Type 3 · cracked',
  TYPE_4: 'Type 4 · smooth',
  TYPE_5: 'Type 5 · soft blobs',
  TYPE_6: 'Type 6 · mushy',
  TYPE_7: 'Type 7 · liquid',
  LEFT: 'Left side',
  RIGHT: 'Right side',
  BACK: 'Back',
  SITTING: 'Sitting',
  ALL: 'All',
  MOST: 'Most',
  HALF: 'Half',
  LITTLE: 'Little',
  REFUSED: 'Refused',
  BATHROOM: 'Bathroom',
  BEDROOM: 'Bedroom',
  LOUNGE: 'Lounge',
  KITCHEN: 'Kitchen',
  OUTSIDE: 'Outside',
  OTHER: 'Other',
  WITNESSED: 'Witnessed',
  UNWITNESSED: 'Unwitnessed',
  BRUISE: 'Bruise',
  SKIN_BREAK: 'Skin break',
  PAIN: 'Pain',
  HEAD_INJURY: 'Head injury',
  FIRST_AID: 'First aid',
  OFFICE: 'Office',
  '999': '999',
  DISCOMFORT: 'With discomfort',
  MARK: 'Mark',
  // Catheter care — care given
  BAG_EMPTIED: 'Bag emptied',
  BAG_CHANGED: 'Bag changed',
  FLUSHED: 'Flushed',
  CHECKED_ONLY: 'Checked only',
  // Catheter care — urine appearance
  CLEAR: 'Clear',
  CLOUDY: 'Cloudy',
  DARK: 'Dark',
  BLOOD_STAINED: 'Blood-stained',
  ODOUR: 'Odour',
  // Catheter care — problems
  BYPASSING: 'Bypassing',
  SITE_REDNESS: 'Site redness',
  // Continence — skin care
  SKIN_INTACT: 'Skin intact',
  BARRIER_CREAM: 'Barrier cream',
  WASH_DRY: 'Wash & dry',
  WASH_AND_DRY: 'Wash & dry',
};

function labelOf(code: string): string {
  return LABEL[code] ?? code.replace(/_/g, ' ');
}

export function formatAlignedCareValue(
  typeCode: string,
  payload: Record<string, unknown>,
): string | null {
  const code = typeCode.toUpperCase();
  const push = (parts: string[], raw: unknown) => {
    if (raw == null || raw === '') return;
    if (Array.isArray(raw)) {
      const labels = raw.map((item) => labelOf(String(item))).filter(Boolean);
      if (labels.length) parts.push(labels.join(', '));
      return;
    }
    parts.push(labelOf(String(raw)));
  };

  // Prefixes a field label so admin readers know what each value means
  // (e.g. "Action: Bag changed" instead of a bare "Bag changed").
  const pushLabeled = (parts: string[], label: string, raw: unknown) => {
    if (raw == null || raw === '') return;
    if (Array.isArray(raw)) {
      const labels = raw.map((item) => labelOf(String(item))).filter(Boolean);
      if (labels.length) parts.push(`${label}: ${labels.join(', ')}`);
      return;
    }
    parts.push(`${label}: ${labelOf(String(raw))}`);
  };

  const parts: string[] = [];
  switch (code) {
    case 'CONTINENCE':
      push(parts, payload.status); // primary status (e.g. "Catheter care")
      // Labels mirror the carer-app field names for app↔admin consistency.
      pushLabeled(parts, 'Care given', payload.catheter_action);
      if (payload.catheter_volume != null && payload.catheter_volume !== '')
        parts.push(`Output: ${payload.catheter_volume} ml`);
      pushLabeled(parts, 'Urine appearance', payload.catheter_appearance);
      pushLabeled(parts, 'Catheter problems', payload.catheter_issues);
      pushLabeled(parts, 'Skin condition', payload.skin);
      break;
    case 'PEG_ENTERAL':
      push(parts, payload.feed_given);
      if (payload.volume_ml != null && payload.volume_ml !== '')
        parts.push(`${payload.volume_ml} ml`);
      push(parts, payload.flush);
      push(parts, payload.tube_status);
      push(parts, payload.site);
      break;
    case 'SKIN_INTEGRITY':
    case 'BODY_MAP':
      push(parts, payload.condition);
      break;
    case 'BOWEL_MOVEMENT':
      push(parts, payload.bristol ?? payload.bowelType);
      push(parts, payload.continence);
      break;
    case 'FALLS': {
      const occurred = asString(payload.fall_occurred);
      if (occurred) push(parts, occurred);
      else if (payload.hadFall === true || payload.hadFall === 'true') parts.push('Yes');
      else if (payload.hadFall === false || payload.hadFall === 'false') parts.push('No');
      push(parts, payload.location);
      push(parts, payload.witnessed);
      push(parts, payload.injury);
      push(parts, payload.help);
      break;
    }
    case 'REPOSITIONING':
      push(parts, payload.position);
      push(parts, payload.tolerated);
      push(parts, payload.skin_glance);
      break;
    case 'MEALS':
      push(parts, payload.amount ?? payload.mealType);
      if (payload.intakeLevel) push(parts, payload.intakeLevel);
      push(parts, payload.refused_reason);
      push(parts, asCodes(payload.texture));
      break;
    default:
      return null;
  }
  return parts.length ? parts.join(' · ') : null;
}

export const ALIGN_CARE_TYPE_CODES = [
  'CONTINENCE',
  'PEG_ENTERAL',
  'SKIN_INTEGRITY',
  'BODY_MAP',
  'BOWEL_MOVEMENT',
  'FALLS',
  'REPOSITIONING',
  'MEALS',
] as const;
