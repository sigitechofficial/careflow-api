import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';

export type DomCareShiftDefinition = {
  id: string;
  name: string;
  fromTime: string;
  toTime: string;
  colorHex: string;
  endsNextDay: boolean;
  sortOrder: number;
};

export const DEFAULT_DOM_CARE_SHIFT_DEFINITIONS: DomCareShiftDefinition[] = [
  {
    id: 'default-morning',
    name: 'Morning Call',
    fromTime: '06:00',
    toTime: '10:59',
    colorHex: '#F4D03F',
    endsNextDay: false,
    sortOrder: 0,
  },
  {
    id: 'default-lunch',
    name: 'Lunch Call',
    fromTime: '11:00',
    toTime: '14:59',
    colorHex: '#2ECC71',
    endsNextDay: false,
    sortOrder: 1,
  },
  {
    id: 'default-tea',
    name: 'Tea Call',
    fromTime: '15:00',
    toTime: '17:59',
    colorHex: '#F39C12',
    endsNextDay: false,
    sortOrder: 2,
  },
  {
    id: 'default-evening',
    name: 'Evening Call',
    fromTime: '18:00',
    toTime: '20:55',
    colorHex: '#5DADE2',
    endsNextDay: false,
    sortOrder: 3,
  },
  {
    id: 'default-night',
    name: 'Night call',
    fromTime: '21:00',
    toTime: '07:00',
    colorHex: '#BB8FCE',
    endsNextDay: true,
    sortOrder: 4,
  },
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return TIME_RE.test(t) ? t : null;
}

function parseShift(raw: unknown, index: number): DomCareShiftDefinition | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const fromTime = parseTime(raw.fromTime);
  const toTime = parseTime(raw.toTime);
  if (!name || !fromTime || !toTime) return null;
  let colorHex = typeof raw.colorHex === 'string' ? raw.colorHex.trim() : '#5DADE2';
  if (!HEX_RE.test(colorHex)) colorHex = '#5DADE2';
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : randomUUID();
  const sortOrder = Number.isFinite(Number(raw.sortOrder)) ? Math.round(Number(raw.sortOrder)) : index;
  let endsNextDay = raw.endsNextDay === true;
  if (!endsNextDay && fromTime > toTime) endsNextDay = true;
  return { id, name, fromTime, toTime, colorHex, endsNextDay, sortOrder };
}

export function parseDomCareShiftDefinitions(
  value: Prisma.JsonValue | null | undefined,
): DomCareShiftDefinition[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_DOM_CARE_SHIFT_DEFINITIONS.map((s) => ({ ...s }));
  }
  const parsed = value
    .map((row, i) => parseShift(row, i))
    .filter((s): s is DomCareShiftDefinition => s !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return parsed.length > 0 ? parsed : DEFAULT_DOM_CARE_SHIFT_DEFINITIONS.map((s) => ({ ...s }));
}

export function serializeDomCareShiftDefinitions(shifts: DomCareShiftDefinition[]): Prisma.InputJsonValue {
  return shifts.map((s, index) => ({
    id: s.id,
    name: s.name.trim(),
    fromTime: s.fromTime,
    toTime: s.toTime,
    colorHex: s.colorHex,
    endsNextDay: s.endsNextDay,
    sortOrder: Number.isFinite(s.sortOrder) ? s.sortOrder : index,
  }));
}

export function inferEndsNextDay(fromTime: string, toTime: string): boolean {
  if (!TIME_RE.test(fromTime) || !TIME_RE.test(toTime)) return false;
  return fromTime > toTime;
}
