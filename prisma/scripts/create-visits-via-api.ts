/**
 * Create visits for service users — with their carers, tasks and medicines — through the HTTP API
 * only, calling the same endpoints in the same order as the admin app's screens (no DB writes):
 *
 *   Visit plan tab   → create/load plan, weekly-hours + carer-pattern (+ amendment) previews, save
 *   Visit tasks tab  → load tasks, merge, save (PUT replaces the whole list, so existing tasks are kept)
 *   Add medication   → one medicine per name, one administration time per round it is given in
 *   Visit plan tab   → activate preview + activate (draft only), generate-rota preview + generate
 *   Check            → read the rota back: visits, carers on them, carers waiting for Hours approvals
 *
 * Every app rule still runs: carers over their weekly hours go to Hours approvals, blocked carers and
 * clashes are refused, audit logs are written as the logged-in user.
 *
 * Usage:
 *   npm run visits:create -- --file=prisma/scripts/create-visits.example.json [--dry-run]
 *
 * Env: API_BASE_URL (default http://localhost:3000), VISITS_EMAIL / VISITS_PASSWORD
 * (default admin@careadmin.local / Admin@12345). A non-local API_BASE_URL needs --allow-remote.
 *
 * Input file (JSON) — see create-visits.example.json:
 *   fromDate, toDate?          rota dates to generate (toDate defaults to fromDate + 13 days)
 *   carer?                     default carer(s) for every visit with none of its own (one carer → many service users)
 *   amendmentReason?           saved on the visit plan amendment (CQC audit)
 *   respectWorkingPatterns?    true (default, as the app): carers stay off visits outside their working
 *                              pattern. false = "assign anyway" in the app's working-pattern dialog.
 *   serviceUsers[]:
 *     serviceUser              number (SU-1042), full name or id
 *     weeklyContractedHours?   only for a new plan when the DOM Care tab has no hours (the plan must
 *                              match the current hours; changing them needs a manager in the app)
 *     visits[]:
 *       round                  MORNING | MIDDAY | AFTERNOON | EVENING | NIGHT (Settings → Time slots)
 *       start, end             "08:00", "09:00"
 *       days?                  "daily" (default), "weekdays", "weekends" or ["Mon", "Wed", …]
 *       carers?                one or more carers (name or id) on every day of the visit
 *       carersByDay?           { "Sat": ["Chloe Mensah"] } — other carers on those days
 *       requiredCarers?        default: the most carers listed for one day (1–4)
 *       notes?
 *       tasks?[]               { task (task list name), instructions?, priority? routine|important|critical,
 *                                dueTime? (the visit's start) }
 *       medicines?[]           { name, dose, route? (ORAL), kind? REGULAR|PRN, time? (visit start),
 *                                startDate? (fromDate), instructions?, reason? }
 */
import { readFileSync } from 'node:fs';

const BASE = (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.VISITS_EMAIL ?? 'admin@careadmin.local';
const PASS = process.env.VISITS_PASSWORD ?? 'Admin@12345';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const DRY_RUN = flag('dry-run');
const DEFAULT_REASON = 'Visits added by create-visits-via-api script';
/** The API generates at most 31 days of rota per call. */
const MAX_GENERATE_DAYS = 31;

// ── Input ──────────────────────────────────────────────────────────────────────

type CarerRef = string;
type TaskInput = { task: string; instructions?: string; priority?: string; dueTime?: string };
type MedicineInput = {
  name: string;
  dose: string;
  route?: string;
  kind?: 'REGULAR' | 'PRN';
  time?: string;
  startDate?: string;
  instructions?: string;
  reason?: string;
};
type VisitInput = {
  round: string;
  start: string;
  end: string;
  days?: string | Array<string | number>;
  carers?: CarerRef | CarerRef[];
  carersByDay?: Record<string, CarerRef | CarerRef[]>;
  requiredCarers?: number;
  notes?: string;
  tasks?: TaskInput[];
  medicines?: MedicineInput[];
};
type ServiceUserInput = {
  serviceUser: string;
  weeklyContractedHours?: string | number;
  visits: VisitInput[];
};
type InputFile = {
  fromDate: string;
  toDate?: string;
  carer?: CarerRef | CarerRef[];
  amendmentReason?: string;
  respectWorkingPatterns?: boolean;
  serviceUsers: ServiceUserInput[];
};

// ── API ────────────────────────────────────────────────────────────────────────

type Envelope<T> = { data?: T; meta?: Record<string, unknown>; message?: string };

let token = '';

class ApiFailure extends Error {}

async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<Envelope<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => ({}))) as Envelope<T> & { message?: unknown };
  if (!res.ok) {
    const message = Array.isArray(json.message) ? json.message.join('; ') : String(json.message ?? res.statusText);
    // Validation failures carry the field errors next to the message.
    const { message: _m, statusCode: _s, success: _ok, ...rest } = json as Record<string, unknown>;
    const details = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    throw new ApiFailure(`${method} ${path} → ${res.status}: ${message}${details}`);
  }
  return json;
}

async function login() {
  const res = await api<{ accessToken?: string }>('POST', '/auth/login', { email: EMAIL, password: PASS });
  const t = res.data?.accessToken ?? (res as { accessToken?: string }).accessToken;
  if (!t) throw new ApiFailure('Login returned no access token');
  token = t;
}

// ── Small helpers ──────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAY_ENUM = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

const list = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60; // overnight visit
  return diff;
}

/** 0=Sun … 6=Sat, as the visit plan API counts days. */
function dayIndex(day: string | number): number {
  if (typeof day === 'number' && day >= 0 && day <= 6) return day;
  const i = DAY_NAMES.indexOf(String(day).trim().slice(0, 3).toUpperCase());
  if (i < 0) throw new Error(`Unknown day "${day}" (use Mon, Tue … Sun)`);
  return i;
}

function parseDays(days: VisitInput['days']): number[] {
  if (days == null || days === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  if (days === 'weekdays') return [1, 2, 3, 4, 5];
  if (days === 'weekends') return [0, 6];
  if (!Array.isArray(days)) throw new Error(`Unknown days "${days}"`);
  return [...new Set(days.map(dayIndex))].sort();
}

function chunks(from: string, to: string): Array<{ fromDate: string; toDate: string }> {
  const out: Array<{ fromDate: string; toDate: string }> = [];
  for (let start = from; start <= to; start = addDaysIso(start, MAX_GENERATE_DAYS)) {
    const end = addDaysIso(start, MAX_GENERATE_DAYS - 1);
    out.push({ fromDate: start, toDate: end < to ? end : to });
  }
  return out;
}

function log(line = '') {
  console.log(line);
}

// ── Lookups (resolved by name, as the app's search boxes do) ───────────────────

type ServiceUserRow = { id: string; serviceUserNumber: string | null; firstName: string; lastName: string };
type EmployeeRow = { id: string; fullName: string | null; firstName: string | null; lastName: string | null };
type Lookup = { id: string; name: string; code: string; time?: string | null };
type Lookups = { routes: Lookup[]; frequencies: Lookup[]; rounds: Lookup[] };

const carerCache = new Map<string, EmployeeRow>();

async function findServiceUser(ref: string): Promise<ServiceUserRow> {
  if (UUID.test(ref)) {
    const res = await api<ServiceUserRow>('GET', `/service-users/${ref}`);
    if (res.data) return res.data;
  }
  // The search matches one field at a time, so a full name is searched by its last word.
  const term = ref.trim().split(/\s+/).pop() ?? ref;
  const res = await api<ServiceUserRow[]>(
    'GET',
    `/service-users?search=${encodeURIComponent(term)}&limit=100`,
  );
  const want = norm(ref);
  const matches = (res.data ?? []).filter(
    (s) => norm(s.serviceUserNumber ?? '') === want || norm(`${s.firstName} ${s.lastName}`) === want,
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? `Service user "${ref}" matches ${matches.length} people — use their number or id`
        : `Service user "${ref}" not found`,
    );
  }
  return matches[0];
}

async function findCarer(ref: string): Promise<EmployeeRow> {
  const key = norm(ref);
  const cached = carerCache.get(key);
  if (cached) return cached;
  const res = await api<EmployeeRow[]>('GET', `/employees?search=${encodeURIComponent(ref)}&limit=20`);
  const rows = res.data ?? [];
  const matches = UUID.test(ref)
    ? rows.filter((e) => e.id === ref)
    : rows.filter((e) => norm(e.fullName ?? `${e.firstName ?? ''} ${e.lastName ?? ''}`) === key);
  if (UUID.test(ref) && !matches.length) {
    const one = await api<EmployeeRow>('GET', `/employees/${ref}`);
    if (one.data) matches.push(one.data);
  }
  if (matches.length !== 1) {
    throw new Error(
      matches.length ? `Carer "${ref}" matches ${matches.length} people — use their id` : `Carer "${ref}" not found`,
    );
  }
  carerCache.set(key, matches[0]);
  return matches[0];
}

const carerName = (e: EmployeeRow) => e.fullName ?? `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim();

/** Every task in the task list (groups → categories → tasks), by name. */
function catalogueTasks(groups: unknown): Map<string, { id: string; name: string }> {
  const out = new Map<string, { id: string; name: string }>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.tasks)) {
      for (const t of obj.tasks as Array<{ id?: string; name?: string }>) {
        if (t?.id && t.name) out.set(norm(t.name), { id: t.id, name: t.name });
      }
    }
    for (const v of Object.values(obj)) if (v && typeof v === 'object') walk(v);
  };
  walk(groups);
  return out;
}

// ── Visit plan slots ───────────────────────────────────────────────────────────

type CarerAssignment = {
  dayOfWeek?: number | null;
  employeeId: string;
  role?: 'LEAD' | 'SECONDARY';
  requiredCarers?: number | null;
  durationMinutes?: number | null;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  sortOrder?: number;
};
type SlotInput = Record<string, unknown> & {
  slotCode: string;
  plannedStartTime: string;
  plannedEndTime: string;
  daysOfWeek: number[];
};
type PlanSlot = SlotInput & { carerAssignments?: Array<CarerAssignment & { id?: string }> };
type Plan = {
  id: string;
  status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'ENDED';
  weeklyContractedHours: string | null;
  numberOfCarers?: number;
  notes?: string | null;
  slots: PlanSlot[];
};

/** The slot fields a save accepts — the same list as the visit plan tab's toSlotInput. */
const SLOT_FIELDS = [
  'slotCode', 'daysOfWeek', 'plannedStartTime', 'plannedEndTime', 'requiredCarers', 'isEnabled',
  'medicationRoundCode', 'notes', 'scheduleFrequency', 'repeatEvery', 'repeatUnit', 'timeCritical',
  'timeToleranceMinutes', 'durationMinutes', 'notesRequired', 'photoAllowed', 'shareOutcomeWithFamily',
  'analysisArea', 'monthlyDayMode', 'monthlyDaysOfMonth', 'monthlyPatternOrdinal', 'monthlyPatternWeekday',
  'linkedCarePlanFormIds', 'assignedEmployeeIds', 'slotKind', 'nightDuty', 'slotEffectiveFrom',
  'slotEffectiveTo', 'oneOffDate', 'allowBackfillDays', 'carerAssignments',
] as const;
const ASSIGNMENT_FIELDS = [
  'dayOfWeek', 'employeeId', 'role', 'requiredCarers', 'durationMinutes', 'plannedStartTime',
  'plannedEndTime', 'sortOrder',
] as const;

function pick<T extends Record<string, unknown>>(obj: T, fields: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

/** An existing slot as a save body (unknown fields are refused by the API). */
function existingSlotInput(slot: PlanSlot): SlotInput {
  const carerAssignments = (slot.carerAssignments ?? [])
    .filter((a) => a.employeeId)
    .map((a) => pick(a as Record<string, unknown>, ASSIGNMENT_FIELDS));
  const input = pick(slot, SLOT_FIELDS) as SlotInput;
  input.carerAssignments = carerAssignments;
  // Default (all-days) carers only, as normalizeSlotCarerFields does.
  const allDays = carerAssignments.filter((a) => a.dayOfWeek == null).map((a) => a.employeeId as string);
  if (allDays.length) input.assignedEmployeeIds = [...new Set(allDays)];
  return input;
}

const sameSlot = (a: SlotInput, b: SlotInput) =>
  a.slotCode === b.slotCode && a.plannedStartTime === b.plannedStartTime && a.plannedEndTime === b.plannedEndTime;

async function buildSlot(visit: VisitInput, defaultCarers: CarerRef[]): Promise<{ slot: SlotInput; carers: string[] }> {
  if (!HM.test(visit.start) || !HM.test(visit.end)) throw new Error(`Visit times must be HH:mm (${visit.start}–${visit.end})`);
  const daysOfWeek = parseDays(visit.days);
  const allDayRefs = list(visit.carers).length ? list(visit.carers) : defaultCarers;
  const allDay = await Promise.all(allDayRefs.map(findCarer));
  const byDay = new Map<number, EmployeeRow[]>();
  for (const [day, refs] of Object.entries(visit.carersByDay ?? {})) {
    byDay.set(dayIndex(day), await Promise.all(list(refs).map(findCarer)));
  }
  const most = Math.max(allDay.length, ...[...byDay.values()].map((c) => c.length), 1);
  const requiredCarers = Math.min(4, visit.requiredCarers ?? most);

  const carerAssignments: CarerAssignment[] = [];
  allDay.forEach((e, i) =>
    carerAssignments.push({ dayOfWeek: null, employeeId: e.id, role: i === 0 ? 'LEAD' : 'SECONDARY', sortOrder: i }),
  );
  for (const [day, carers] of byDay) {
    carers.forEach((e, i) =>
      carerAssignments.push({
        dayOfWeek: day,
        employeeId: e.id,
        role: i === 0 ? 'LEAD' : 'SECONDARY',
        requiredCarers,
        sortOrder: i,
      }),
    );
  }

  const slot: SlotInput = {
    slotCode: visit.round.toUpperCase(),
    medicationRoundCode: visit.round.toUpperCase(),
    daysOfWeek,
    plannedStartTime: visit.start,
    plannedEndTime: visit.end,
    durationMinutes: minutesBetween(visit.start, visit.end),
    requiredCarers,
    isEnabled: true,
    scheduleFrequency: 'WEEKLY',
    ...(visit.notes ? { notes: visit.notes } : {}),
    assignedEmployeeIds: allDay.map((e) => e.id),
    carerAssignments,
  };
  const names = [
    ...allDay.map(carerName),
    ...[...byDay.entries()].map(([d, c]) => `${DAY_NAMES[d]}: ${c.map(carerName).join(' + ')}`),
  ];
  return { slot, carers: names };
}

// ── Per service user ───────────────────────────────────────────────────────────

type Summary = {
  serviceUser: string;
  plan: string;
  slots: string[];
  tasks: string[];
  medicines: string[];
  warnings: string[];
  visits?: { total: number; fullyStaffed: number; carers: Record<string, number>; missing: string[] };
  failed?: string;
};

async function processServiceUser(
  input: ServiceUserInput,
  file: InputFile,
  lookups: Lookups,
  taskList: Map<string, { id: string; name: string }>,
  toDate: string,
): Promise<Summary> {
  const su = await findServiceUser(input.serviceUser);
  const label = `${su.serviceUserNumber ?? su.id} ${su.firstName} ${su.lastName}`;
  const summary: Summary = { serviceUser: label, plan: '', slots: [], tasks: [], medicines: [], warnings: [] };
  const reason = file.amendmentReason?.trim() || DEFAULT_REASON;
  const respect = file.respectWorkingPatterns !== false;
  log(`\n━━ ${label}`);

  // 1) Visits as visit plan slots, carers on them.
  const rounds = new Set(lookups.rounds.map((r) => r.code));
  const built: SlotInput[] = [];
  for (const visit of input.visits) {
    if (!rounds.has(visit.round.toUpperCase())) {
      throw new Error(`Unknown round "${visit.round}" (${[...rounds].join(', ')})`);
    }
    const { slot, carers } = await buildSlot(visit, list(file.carer));
    built.push(slot);
    const days = slot.daysOfWeek.map((d) => DAY_NAMES[d]).join(',');
    summary.slots.push(`${slot.slotCode} ${slot.plannedStartTime}–${slot.plannedEndTime} ${days} · ${carers.join(', ') || 'no carer'}`);
  }

  // 2) The plan the visit plan tab edits: active first, then draft, then suspended.
  const plans = (await api<Plan[]>('GET', `/service-users/${su.id}/visit-plans`)).data ?? [];
  const working =
    plans.find((p) => p.status === 'ACTIVE') ??
    plans.find((p) => p.status === 'DRAFT') ??
    plans.find((p) => p.status === 'SUSPENDED');

  let plan: Plan | undefined;
  if (!working) {
    const domHours = (await api<{ weeklyContractedHours?: string | null }>('GET', `/service-users/${su.id}/dom-care`)).data
      ?.weeklyContractedHours;
    // The plan must match the service user's current hours (DOM Care tab); changing them needs a
    // manager-approved request, so the file's value is only used when DOM Care has none.
    const fromFile = String(input.weeklyContractedHours ?? '').trim();
    const weeklyContractedHours = String(domHours ?? '').trim() || fromFile;
    if (!weeklyContractedHours) {
      throw new Error('No visit plan yet and no weekly contracted hours (DOM Care tab or "weeklyContractedHours")');
    }
    if (fromFile && domHours && Number(fromFile) !== Number(domHours)) {
      summary.warnings.push(
        `Plan uses the service user's current ${domHours}h a week, not ${fromFile}h — change the hours in the app (manager approval)`,
      );
    }
    const numberOfCarers = Math.max(...built.map((s) => Number(s.requiredCarers ?? 1)));
    if (DRY_RUN) {
      summary.plan = `would create a draft plan (${weeklyContractedHours}h a week) with ${built.length} visit(s)`;
      log(`  ${summary.plan}`);
    } else {
      plan = (await api<Plan>('POST', `/service-users/${su.id}/visit-plans`, {
        weeklyContractedHours,
        numberOfCarers,
        slots: built,
      })).data!;
      summary.plan = `created draft plan ${plan.id} (${weeklyContractedHours}h a week)`;
      log(`  ${summary.plan}`);
      await previews(su.id, plan, plan.slots.map(existingSlotInput), reason, respect, summary);
    }
  } else {
    plan = working;
    // Existing visits are kept; a visit with the same round and times is replaced (re-running is safe).
    const kept = plan.slots.map(existingSlotInput).filter((s) => !built.some((b) => sameSlot(s, b)));
    const slots = [...kept, ...built];
    // Disabled rows are the plan's unused rounds (every plan has one per round).
    const keptVisits = kept.filter((s) => s.isEnabled !== false).length;
    summary.plan = `${plan.status.toLowerCase()} plan ${plan.id}: ${keptVisits} other visit(s) kept, ${built.length} added/updated`;
    log(`  ${summary.plan}`);
    const { applyScheduleImpact, respectWorkingPatternOnSync } = await previews(su.id, plan, slots, reason, respect, summary);
    if (!DRY_RUN) {
      const saved = await api<Plan>('PATCH', `/service-users/${su.id}/visit-plans/${working.id}`, {
        amendmentReason: reason,
        weeklyContractedHours: working.weeklyContractedHours ?? null,
        numberOfCarers: working.numberOfCarers ?? Math.max(...slots.map((s) => Number(s.requiredCarers ?? 1))),
        notes: working.notes ?? '',
        slots,
        applyScheduleImpact,
        respectWorkingPatternOnSync,
      });
      for (const w of (saved.meta?.carerHoursWarnings as string[] | undefined) ?? []) summary.warnings.push(w);
      for (const h of (saved.meta?.heldTimeChanges as Array<{ slotLabel: string }> | undefined) ?? []) {
        summary.warnings.push(`${h.slotLabel}: new time waits for a manager (carer over weekly hours)`);
      }
      plan = saved.data!;
      log('  plan saved');
    }
  }

  // 3) Tasks — Visit tasks tab: load, merge, save the whole list.
  const wantedTasks = input.visits.flatMap((v) =>
    // Due at the visit's start unless given (the tab pre-fills this client's slot start): a task
    // shows on the visit whose time window holds its due time.
    (v.tasks ?? []).map((t) => ({ round: v.round.toUpperCase(), days: parseDays(v.days), ...t, dueTime: t.dueTime ?? v.start })),
  );
  if (wantedTasks.length) await saveTasks(su.id, wantedTasks, taskList, summary);

  // 4) Medicines — Add medication: one per name, one time per round it is given in.
  const wantedMeds = input.visits.flatMap((v) =>
    (v.medicines ?? []).map((m) => ({ round: v.round.toUpperCase(), visitStart: v.start, ...m })),
  );
  if (wantedMeds.length) await saveMedicines(su.id, wantedMeds, lookups, file.fromDate, summary);

  if (DRY_RUN || !plan) return summary;

  // 5) Activate a draft (the screen saves first, then activates).
  if (plan.status === 'DRAFT') {
    const impact = (await api<{ otherActivePlans?: unknown[]; scheduleImpact?: { jobsCancelled?: number } }>(
      'GET',
      `/service-users/${su.id}/visit-plans/${plan.id}/activate-impact-preview`,
    )).data;
    // The Activate dialog's default: with another active plan, its future visits are cancelled.
    const hasOtherActive = (impact?.otherActivePlans?.length ?? 0) > 0;
    if (hasOtherActive) {
      summary.warnings.push(
        `Activating replaced another active plan: ${impact?.scheduleImpact?.jobsCancelled ?? 0} of its visits cancelled`,
      );
    }
    const activated = await api<Plan>('POST', `/service-users/${su.id}/visit-plans/${plan.id}/activate`, {
      cancelEndedPlanJobs: hasOtherActive,
    });
    for (const w of (activated.message ?? '').split('Warning: ').slice(1)) summary.warnings.push(w.trim());
    plan = activated.data!;
    log('  plan activated');
  } else if (plan.status === 'SUSPENDED') {
    summary.warnings.push('Plan is suspended — rota not generated (reactivate it in the app first)');
    return summary;
  }

  // 6) Generate the rota for the dates (preview first, as the Generate rota dialog does).
  let created = 0;
  let skipped = 0;
  for (const range of chunks(file.fromDate, toDate)) {
    const qs = new URLSearchParams(range).toString();
    await api('GET', `/service-users/${su.id}/visit-plans/${plan.id}/generate-schedule-preview?${qs}`);
    const gen = await api<{ visitsCreated: number; visitsSkipped: number; weeklyHoursWarning?: string }>(
      'POST',
      `/service-users/${su.id}/visit-plans/${plan.id}/generate-schedule`,
      { ...range, respectWorkingPatternOnSync: respect },
    );
    created += gen.data?.visitsCreated ?? 0;
    skipped += gen.data?.visitsSkipped ?? 0;
    if (gen.data?.weeklyHoursWarning) summary.warnings.push(gen.data.weeklyHoursWarning);
  }
  log(`  rota generated ${file.fromDate} → ${toDate}: ${created} visit(s) created, ${skipped} already there`);

  // 7) Read the rota back.
  summary.visits = await checkRota(su.id, file.fromDate, toDate);
  return summary;
}

/** Weekly-hours, carer working-pattern and (active plan) amendment previews, as the Save button runs them. */
async function previews(
  serviceUserId: string,
  plan: Plan,
  slots: SlotInput[],
  reason: string,
  respect: boolean,
  summary: Summary,
): Promise<{ applyScheduleImpact: boolean; respectWorkingPatternOnSync: boolean }> {
  const base = `/service-users/${serviceUserId}/visit-plans/${plan.id}`;
  const hours = (await api<{ limitWeeklyHours: number | null; overLimitWeeks: Array<{ weekStart: string; minutes: number }>; visitsNeedApproval?: boolean }>(
    'POST',
    `${base}/weekly-hours-preview`,
    { slots },
  )).data;
  for (const w of hours?.overLimitWeeks ?? []) {
    summary.warnings.push(
      `Week of ${w.weekStart}: ${Math.round(w.minutes / 6) / 10}h of visits, over the service user's ` +
        `${hours?.limitWeeklyHours ?? '?'}h a week — ` +
        (hours?.visitsNeedApproval ? 'visits over it wait for Hours approvals' : 'made with a warning'),
    );
  }
  const pattern = (await api<{
    conflicts?: Array<{ employeeName: string; slotLabel: string; unavailableDayLabels: string[]; timeOutsidePattern: boolean }>;
    visitsSkippedIfRespecting?: number;
  }>('POST', `${base}/carer-sync-pattern-preview`, { slots })).data;
  for (const c of pattern?.conflicts ?? []) {
    const when = c.unavailableDayLabels.length ? c.unavailableDayLabels.join(', ') : 'outside their hours';
    summary.warnings.push(
      `Working pattern: ${c.employeeName} not working on ${c.slotLabel} (${when}) — ` +
        (respect ? 'left off those visits ("respectWorkingPatterns": false assigns anyway)' : 'assigned anyway'),
    );
  }
  let applyScheduleImpact = false;
  if (plan.status === 'ACTIVE') {
    const impact = (await api<{ scheduleImpact?: { jobsCancelled?: number; jobsRescheduled?: number } }>(
      'POST',
      `${base}/amendment-impact-preview`,
      { amendmentReason: reason, weeklyContractedHours: plan.weeklyContractedHours ?? null, slots },
    )).data;
    const cancelled = impact?.scheduleImpact?.jobsCancelled ?? 0;
    const rescheduled = impact?.scheduleImpact?.jobsRescheduled ?? 0;
    // The screen asks to confirm; the script confirms and reports it.
    if (cancelled + rescheduled > 0) {
      applyScheduleImpact = true;
      summary.warnings.push(`Rota changes from this amendment: ${cancelled} cancelled, ${rescheduled} rescheduled`);
    }
  }
  return { applyScheduleImpact, respectWorkingPatternOnSync: respect };
}

type TaskAssignment = {
  medicationRoundCode: string;
  carerInstructions: string | null;
  priority: string;
  dueTime: string | null;
  bodyMapRequired: boolean;
  schedule?: Record<string, unknown>;
  task: { id: string; name: string };
};

const SCHEDULE_FIELDS = [
  'scheduleFrequency', 'repeatEvery', 'repeatUnit', 'daysOfWeek', 'timeCritical', 'timeToleranceMinutes',
  'monthlyDayMode', 'monthlyDaysOfMonth', 'monthlyPatternOrdinal', 'monthlyPatternWeekday',
] as const;

/** The Visit tasks tab's default schedule (DEFAULT_VISIT_TASK_SCHEDULE), on the visit's days. */
function defaultTaskSchedule(daysOfWeek: number[]) {
  return {
    daysOfWeek,
    scheduleFrequency: 'DAILY',
    repeatEvery: 1,
    repeatUnit: 'DAYS',
    timeCritical: false,
    timeToleranceMinutes: 30,
    monthlyDayMode: 'BY_DATE',
    monthlyDaysOfMonth: [],
    monthlyPatternOrdinal: 'FIRST',
    monthlyPatternWeekday: 1,
  };
}

async function saveTasks(
  serviceUserId: string,
  wanted: Array<TaskInput & { round: string; days: number[] }>,
  taskList: Map<string, { id: string; name: string }>,
  summary: Summary,
) {
  const current = (await api<{ assignmentsByRound: Record<string, TaskAssignment[]> }>(
    'GET',
    `/service-users/${serviceUserId}/visit-tasks`,
  )).data?.assignmentsByRound ?? {};

  // Everything already there, as the save body (the save replaces the whole list).
  const byRound = new Map<string, Array<Record<string, unknown>>>();
  for (const [round, rows] of Object.entries(current)) {
    byRound.set(
      round,
      rows.map((r) => ({
        taskCatalogueTaskId: r.task.id,
        carerInstructions: r.carerInstructions,
        priority: r.priority,
        bodyMapRequired: r.bodyMapRequired,
        dueTime: r.dueTime,
        ...(r.schedule ? { schedule: pick(r.schedule, SCHEDULE_FIELDS) } : {}),
      })),
    );
  }

  for (const t of wanted) {
    const found = taskList.get(norm(t.task));
    if (!found) throw new Error(`Task "${t.task}" is not in the task list (Settings → Tasks planner)`);
    const priority = (t.priority ?? 'routine').toLowerCase();
    if (!['routine', 'important', 'critical'].includes(priority)) {
      throw new Error(`Task "${t.task}": priority must be routine, important or critical`);
    }
    if (t.dueTime && !HM.test(t.dueTime)) throw new Error(`Task "${t.task}": dueTime must be HH:mm`);
    const rows = byRound.get(t.round) ?? [];
    const item = {
      taskCatalogueTaskId: found.id,
      carerInstructions: t.instructions ?? null,
      priority,
      ...(t.dueTime ? { dueTime: t.dueTime } : {}),
    };
    const at = rows.findIndex((r) => r.taskCatalogueTaskId === found.id);
    if (at >= 0) rows[at] = { ...rows[at], ...item };
    // A schedule is always sent, as the tab does (the API's default without one is broken).
    else rows.push({ ...item, schedule: defaultTaskSchedule(t.days) });
    byRound.set(t.round, rows);
    summary.tasks.push(`${t.round}: ${found.name} (${priority})${at >= 0 ? ' — updated' : ''}`);
  }

  if (DRY_RUN) return;
  await api('PUT', `/service-users/${serviceUserId}/visit-tasks`, {
    rounds: [...byRound.entries()].map(([medicationRoundCode, tasks]) => ({ medicationRoundCode, tasks })),
  });
  log(`  tasks saved (${wanted.length})`);
}

async function saveMedicines(
  serviceUserId: string,
  wanted: Array<MedicineInput & { round: string; visitStart: string }>,
  lookups: Lookups,
  fromDate: string,
  summary: Summary,
) {
  const existing = (await api<Array<{ medicationName: string; status: string }>>(
    'GET',
    `/service-users/${serviceUserId}/medications?limit=100`,
  )).data ?? [];
  const active = new Set(existing.filter((m) => m.status === 'ACTIVE').map((m) => norm(m.medicationName)));

  // One medicine per name; each round it appears in becomes one administration time.
  const byName = new Map<string, Array<MedicineInput & { round: string; visitStart: string }>>();
  for (const m of wanted) byName.set(norm(m.name), [...(byName.get(norm(m.name)) ?? []), m]);

  for (const [key, rows] of byName) {
    const first = rows[0];
    if (active.has(key)) {
      summary.medicines.push(`${first.name} — already active, skipped`);
      continue;
    }
    const kind = (first.kind ?? 'REGULAR').toUpperCase() as 'REGULAR' | 'PRN';
    const routeCode = (first.route ?? 'ORAL').toUpperCase();
    const route = lookups.routes.find((r) => r.code === routeCode || norm(r.name) === norm(routeCode));
    if (!route) throw new Error(`Medicine "${first.name}": unknown route "${first.route}"`);

    const schedules =
      kind === 'PRN'
        ? undefined
        : rows.map((m) => {
            const dueTime = m.time ?? m.visitStart;
            if (!HM.test(dueTime)) throw new Error(`Medicine "${m.name}": time must be HH:mm`);
            return {
              dueTime,
              dose: m.dose,
              roundId: lookups.rounds.find((r) => r.code === m.round)?.id,
            };
          });
    const timesPerDay = schedules?.length ?? 0;
    const frequencyCode =
      timesPerDay >= 5 ? 'FIVE_TIMES_DAILY'
        : timesPerDay === 4 ? 'FOUR_TIMES_DAILY'
          : timesPerDay === 3 ? 'THREE_TIMES_DAILY'
            : timesPerDay === 2 ? 'TWICE_DAILY'
              : 'ONCE_DAILY';
    const body = {
      medicationName: first.name,
      medicationKind: kind,
      dose: first.dose,
      startDate: first.startDate ?? fromDate,
      routeId: route.id,
      ...(kind === 'REGULAR'
        ? {
            schedulePattern: 'DAILY',
            frequencyIntervalDays: 1,
            frequencyId: lookups.frequencies.find((f) => f.code === frequencyCode)?.id,
            schedules,
          }
        : {}),
      ...(first.instructions ? { instructions: first.instructions } : {}),
      ...(first.reason ? { reasonForMedication: first.reason } : {}),
    };
    const when = kind === 'PRN' ? 'PRN' : rows.map((m) => `${m.round} ${m.time ?? m.visitStart}`).join(', ');
    summary.medicines.push(`${first.name} ${first.dose} (${route.name}) — ${when}`);
    if (!DRY_RUN) await api('POST', `/service-users/${serviceUserId}/medications`, body);
  }
  if (!DRY_RUN) log(`  medicines saved (${byName.size})`);
}

type JobRow = { id: string; jobName: string; scheduledStartDateTime: string; requiredCarers?: number };
type AllocationRow = { employeeId: string; status: string };

/** Carers on each visit come from the allocations endpoint (the list does not carry them), as the rota does. */
async function checkRota(serviceUserId: string, fromDate: string, toDate: string) {
  const jobs: JobRow[] = [];
  for (let page = 1; ; page += 1) {
    const qs = new URLSearchParams({
      serviceUserId,
      dateFrom: `${fromDate}T00:00:00.000Z`,
      dateTo: `${toDate}T23:59:59.999Z`,
      limit: '100',
      page: String(page),
    });
    const res = await api<JobRow[]>('GET', `/scheduled-jobs?${qs}`);
    jobs.push(...(res.data ?? []));
    const totalPages = Number((res.meta as { totalPages?: number } | undefined)?.totalPages ?? 1);
    if (!res.data?.length || page >= totalPages) break;
  }
  const nameById = new Map([...carerCache.values()].map((e) => [e.id, carerName(e)]));
  const carers: Record<string, number> = {};
  const missing: string[] = [];
  let fullyStaffed = 0;
  for (const job of jobs.sort((a, b) => a.scheduledStartDateTime.localeCompare(b.scheduledStartDateTime))) {
    const rows = (await api<AllocationRow[]>('GET', `/scheduled-jobs/${job.id}/allocations`)).data ?? [];
    const on = rows.filter((a) => ['ALLOCATED', 'CONFIRMED', 'PENDING_CONFIRMATION'].includes(a.status));
    const required = job.requiredCarers ?? 1;
    if (on.length >= required) fullyStaffed += 1;
    else missing.push(`${job.scheduledStartDateTime.slice(0, 16).replace('T', ' ')} ${job.jobName} (${on.length}/${required})`);
    for (const a of on) {
      const name = nameById.get(a.employeeId) ?? a.employeeId;
      carers[name] = (carers[name] ?? 0) + 1;
    }
  }
  return { total: jobs.length, fullyStaffed, carers, missing };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const filePath = option('file');
  if (!filePath) {
    console.error('Usage: npm run visits:create -- --file=<visits.json> [--dry-run] [--allow-remote]');
    process.exit(1);
  }
  const host = new URL(BASE).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && !flag('allow-remote')) {
    console.error(`Refusing to run against ${BASE} — add --allow-remote if you mean it.`);
    process.exit(1);
  }

  const file = JSON.parse(readFileSync(filePath, 'utf8')) as InputFile;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(file.fromDate ?? '')) throw new Error('"fromDate" must be YYYY-MM-DD');
  const toDate = file.toDate ?? addDaysIso(file.fromDate, 13);
  if (toDate < file.fromDate) throw new Error('"toDate" is before "fromDate"');
  if (!file.serviceUsers?.length) throw new Error('"serviceUsers" is empty');

  log(`API ${BASE} as ${EMAIL}${DRY_RUN ? ' — DRY RUN (previews only, nothing saved)' : ''}`);
  log(`Rota dates ${file.fromDate} → ${toDate}`);
  await login();

  const lookups = (await api<Lookups>('GET', '/medication-lookups')).data!;
  const taskList = catalogueTasks((await api('GET', '/task-catalogue')).data);

  const results: Summary[] = [];
  for (const su of file.serviceUsers) {
    try {
      results.push(await processServiceUser(su, file, lookups, taskList, toDate));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`  ✖ ${message}`);
      results.push({ serviceUser: su.serviceUser, plan: '', slots: [], tasks: [], medicines: [], warnings: [], failed: message });
    }
  }

  log('\n════════ Summary');
  for (const r of results) {
    log(`\n${r.serviceUser}${r.failed ? ` — FAILED: ${r.failed}` : ''}`);
    if (r.plan) log(`  Plan: ${r.plan}`);
    for (const s of r.slots) log(`  Visit: ${s}`);
    for (const t of r.tasks) log(`  Task: ${t}`);
    for (const m of r.medicines) log(`  Medicine: ${m}`);
    if (r.visits) {
      log(`  Rota: ${r.visits.total} visit(s), ${r.visits.fullyStaffed} with all carers on`);
      for (const [name, n] of Object.entries(r.visits.carers)) log(`    ${name}: ${n} visit(s)`);
      if (r.visits.missing.length) {
        log('  Visits still missing carers (the app refused them: a clash with another visit, leave,');
        log('  working pattern, or weekly hours waiting in Hours approvals — see the rota for each):');
        for (const m of r.visits.missing) log(`    ${m}`);
      }
    }
    for (const w of r.warnings) log(`  ⚠ ${w}`);
  }
  const failed = results.filter((r) => r.failed).length;
  log(`\n${results.length - failed}/${results.length} service user(s) done${DRY_RUN ? ' (dry run)' : ''}.`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
