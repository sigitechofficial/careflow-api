/**
 * Force visit-plan carer sync by PATCHing active plan (triggers syncVisitPlanSlotCarersToScheduledJobs).
 */
const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
const PAT_ID = '28699cc0-b6eb-41e2-b806-ca216c34d485';
const AMARA_ID = '70e5b38b-fd79-4d94-865c-f343b643de85';

type PlanSlot = Record<string, unknown>;

async function api(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function toSlotInput(s: PlanSlot, amaraMorning: boolean) {
  const carerAssignments = amaraMorning
    ? [
        {
          dayOfWeek: null,
          employeeId: AMARA_ID,
          role: 'LEAD',
          durationMinutes: null,
          plannedStartTime: null,
          plannedEndTime: null,
          sortOrder: 0,
        },
      ]
    : ((s.carerAssignments as PlanSlot[]) ?? []).map(({ id: _id, ...row }) => row);
  const assignedEmployeeIds = amaraMorning
    ? [AMARA_ID]
    : ((s.assignedEmployeeIds as string[]) ?? []).filter(Boolean);

  return {
    slotCode: s.slotCode,
    daysOfWeek: s.daysOfWeek,
    plannedStartTime: s.plannedStartTime,
    plannedEndTime: s.plannedEndTime,
    requiredCarers: s.requiredCarers,
    isEnabled: s.isEnabled,
    medicationRoundCode: s.medicationRoundCode,
    notes: (s.notes as string) ?? '',
    scheduleFrequency: s.scheduleFrequency,
    repeatEvery: s.repeatEvery,
    repeatUnit: s.repeatUnit,
    timeCritical: s.timeCritical,
    timeToleranceMinutes: s.timeToleranceMinutes,
    durationMinutes: s.durationMinutes,
    notesRequired: s.notesRequired,
    photoAllowed: s.photoAllowed,
    shareOutcomeWithFamily: s.shareOutcomeWithFamily,
    analysisArea: s.analysisArea,
    monthlyDayMode: s.monthlyDayMode,
    monthlyDaysOfMonth: s.monthlyDaysOfMonth ?? [],
    monthlyPatternOrdinal: s.monthlyPatternOrdinal,
    monthlyPatternWeekday: s.monthlyPatternWeekday,
    linkedCarePlanFormIds: s.linkedCarePlanFormIds ?? [],
    assignedEmployeeIds,
    carerAssignments,
    slotKind: s.slotKind,
    slotEffectiveFrom: s.slotEffectiveFrom,
    slotEffectiveTo: s.slotEffectiveTo,
    oneOffDate: s.oneOffDate,
    allowBackfillDays: s.allowBackfillDays ?? 0,
    exceptions: ((s.exceptions as PlanSlot[]) ?? []).map(({ id: _id, ...ex }) => ex),
  };
}

async function main() {
  const login = await api('/auth/login', '', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@careadmin.local', password: 'Admin@12345' }),
  });
  const token = login.json.data?.accessToken as string;
  if (!token) {
    console.error('Login failed', login.json);
    process.exit(1);
  }

  const activeRes = await api(`/service-users/${PAT_ID}/visit-plans/active`, token);
  const plan = activeRes.json.data as PlanSlot;
  if (!plan?.id) {
    console.error('No active plan', activeRes.json);
    process.exit(1);
  }

  const slots = ((plan.slots as PlanSlot[]) ?? []).map((s) =>
    toSlotInput(s, s.slotCode === 'MORNING' && s.isEnabled === true),
  );

  const updated = await api(`/service-users/${PAT_ID}/visit-plans/${plan.id}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      amendmentReason: 'Force carer sync — assign Amara to generated jobs',
      weeklyContractedHours: plan.weeklyContractedHours,
      numberOfCarers: plan.numberOfCarers,
      notes: plan.notes ?? '',
      slots,
      applyScheduleImpact: false,
    }),
  });
  console.log('Update:', updated.ok, updated.json);

  const jobsRes = await api(
    `/scheduled-jobs?serviceUserId=${PAT_ID}&dateFrom=2026-06-24T00:00:00.000Z&dateTo=2026-06-24T23:59:59.999Z&limit=5`,
    token,
  );
  const job = jobsRes.json.data?.[0] as { id: string; status: string } | undefined;
  if (!job) {
    console.log('No job on 2026-06-24');
    return;
  }
  console.log('Job status:', job.status, job.id);
  const allocs = await api(`/scheduled-jobs/${job.id}/allocations`, token);
  console.log('Allocations:', JSON.stringify(allocs.json, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
