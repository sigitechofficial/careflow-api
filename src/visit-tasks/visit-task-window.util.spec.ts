import {
  nearestVisitGapMinutes,
  placeVisitTasksForDay,
  selectVisitTaskAssignments,
  visitHmWindow,
  visitTaskBelongsToVisit,
  visitTaskDueTimes,
  type VisitTaskWindowContext,
} from './visit-task-window.util';
import { buildVisitTaskProgressByJobId } from '../employee-app/visit-task-progress.util';

const SU = 'su-1';
const ctx: VisitTaskWindowContext = {
  roundTimeByCode: new Map([
    ['MORNING', '08:00'],
    ['MIDDAY', '12:00'],
  ]),
  medDueTimesBySuRound: new Map([[`${SU}|MIDDAY`, ['12:30']]]),
};

const washing = { id: 'washing', serviceUserId: SU, medicationRoundCode: 'MORNING', dueTime: '06:30' };
const breakfast = { id: 'breakfast', serviceUserId: SU, medicationRoundCode: 'MORNING', dueTime: '08:15' };
const noTime = { id: 'no-time', serviceUserId: SU, medicationRoundCode: 'MORNING', dueTime: null };
const prompt = {
  id: 'prompt',
  serviceUserId: SU,
  medicationRoundCode: 'MIDDAY',
  dueTime: null,
  task: { name: 'Medication prompt', flagsJson: { emarPrompt: true } },
};

describe('visit-task-window.util — tasks attach to visits by clock time', () => {
  it('three morning visits: a 06:30 task shows only on the 06:00–07:00 visit', () => {
    const all = [washing, breakfast];
    const ids = (start: string, end: string) =>
      selectVisitTaskAssignments(all, { startHm: start, endHm: end }, ctx, 'MORNING').map((a) => a.id);
    expect(ids('06:00', '07:00')).toEqual(['washing']);
    expect(ids('08:00', '09:00')).toEqual(['breakfast']);
    expect(ids('10:00', '11:00')).toEqual([]);
  });

  it('a task with no due time uses its round time', () => {
    expect(visitTaskDueTimes(noTime, ctx)).toEqual(['08:00']);
    expect(visitTaskBelongsToVisit(noTime, { startHm: '07:30', endHm: '08:30' }, ctx, null)).toBe(true);
    expect(visitTaskBelongsToVisit(noTime, { startHm: '06:00', endHm: '07:00' }, ctx, null)).toBe(false);
  });

  it('ignores the visit round code when a window exists (moved visit gets its time’s tasks)', () => {
    // Visit planned as MIDDAY but actually at 06:00–07:00 → morning washing shows.
    expect(visitTaskBelongsToVisit(washing, { startHm: '06:00', endHm: '07:00' }, ctx, 'MIDDAY')).toBe(true);
  });

  it('eMAR prompt follows its round’s medicine due times, not its own time', () => {
    expect(visitTaskBelongsToVisit(prompt, { startHm: '12:00', endHm: '13:00' }, ctx, null)).toBe(true);
    expect(visitTaskBelongsToVisit(prompt, { startHm: '11:00', endHm: '12:15' }, ctx, null)).toBe(false);
  });

  it('keeps only one eMAR prompt when a visit spans two rounds', () => {
    const prompt2 = { ...prompt, id: 'prompt-2', medicationRoundCode: 'AFTERNOON' };
    const c2: VisitTaskWindowContext = {
      ...ctx,
      medDueTimesBySuRound: new Map([
        [`${SU}|MIDDAY`, ['12:30']],
        [`${SU}|AFTERNOON`, ['15:00']],
      ]),
    };
    const picked = selectVisitTaskAssignments([prompt, prompt2], { startHm: '12:00', endHm: '16:00' }, c2, null);
    expect(picked.map((a) => a.id)).toEqual(['prompt']);
  });

  it('no window (no end time) falls back to the visit round code', () => {
    expect(visitTaskBelongsToVisit(washing, null, ctx, 'MORNING')).toBe(true);
    expect(visitTaskBelongsToVisit(washing, null, ctx, 'MIDDAY')).toBe(false);
    expect(visitTaskBelongsToVisit(washing, null, ctx, null)).toBe(false);
  });

  it('handles overnight visits', () => {
    const night = { ...washing, id: 'night', dueTime: '02:00' };
    expect(visitTaskBelongsToVisit(night, { startHm: '22:00', endHm: '07:00' }, ctx, null)).toBe(true);
  });

  it('builds the window in the org timezone', () => {
    const w = visitHmWindow(
      new Date('2026-10-05T01:00:00Z'),
      new Date('2026-10-05T02:00:00Z'),
      'Asia/Karachi',
    );
    expect(w).toEqual({ startHm: '06:00', endHm: '07:00' });
    expect(visitHmWindow(new Date(), null, 'Asia/Karachi')).toBeNull();
  });
});

describe('placeVisitTasksForDay — each task on exactly one visit of the day', () => {
  const v = (jobId: string, startHm: string, endHm: string, order: number) => ({
    jobId,
    window: { startHm, endHm },
    startMs: order,
  });
  const visits = [v('six', '06:00', '07:00', 1), v('seven', '07:00', '08:00', 2), v('ten', '10:00', '11:00', 3)];
  const task = (id: string, dueTime: string) => ({ id, serviceUserId: SU, medicationRoundCode: 'MORNING', dueTime });
  const where = (placed: Map<string, Array<{ assignmentId: string; nearest: boolean }>>, id: string) => {
    for (const [jobId, list] of placed) {
      const hit = list.find((p) => p.assignmentId === id);
      if (hit) return `${jobId}${hit.nearest ? ' (nearest)' : ''}`;
    }
    return 'none';
  };

  it('a task inside one visit goes there', () => {
    const placed = placeVisitTasksForDay([task('w', '06:30')], visits, ctx);
    expect(where(placed, 'w')).toBe('six');
  });

  it('a 07:00 task between back-to-back visits 6–7 and 7–8 goes only to 7–8', () => {
    const placed = placeVisitTasksForDay([task('w', '07:00')], visits, ctx);
    expect(where(placed, 'w')).toBe('seven');
    expect(placed.get('six')).toEqual([]);
  });

  it('a task no visit covers goes to the nearest visit, flagged', () => {
    const placed = placeVisitTasksForDay([task('w', '09:00')], visits, ctx);
    // 08:00 end of "seven" is 60 min away, 10:00 start of "ten" is 60 min away → tie → earlier.
    expect(where(placed, 'w')).toBe('seven (nearest)');
    const placed2 = placeVisitTasksForDay([task('w', '09:40')], visits, ctx);
    expect(where(placed2, 'w')).toBe('ten (nearest)');
  });

  it('task before the first visit / after the last visit goes to that first / last visit', () => {
    const placed = placeVisitTasksForDay([task('a', '05:00'), task('b', '22:00')], visits, ctx);
    expect(where(placed, 'a')).toBe('six (nearest)');
    expect(where(placed, 'b')).toBe('ten (nearest)');
  });

  it('overlapping visits: the one that started latest wins', () => {
    const placed = placeVisitTasksForDay(
      [task('w', '07:30')],
      [v('long', '06:00', '08:00', 1), v('short', '07:00', '08:00', 2)],
      ctx,
    );
    expect(where(placed, 'w')).toBe('short');
  });

  it('overnight visit covers a 02:00 task', () => {
    const placed = placeVisitTasksForDay([task('n', '02:00')], [v('night', '22:00', '07:00', 1), v('noon', '12:00', '13:00', 2)], ctx);
    expect(where(placed, 'n')).toBe('night');
  });

  it('grace minutes: nearest visit only when within the grace', () => {
    // 09:40 → nearest is "ten" (20 min away)
    expect(where(placeVisitTasksForDay([task('w', '09:40')], visits, ctx, 30), 'w')).toBe('ten (nearest)');
    expect(where(placeVisitTasksForDay([task('w', '09:40')], visits, ctx, 20), 'w')).toBe('ten (nearest)');
    expect(where(placeVisitTasksForDay([task('w', '09:40')], visits, ctx, 19), 'w')).toBe('none');
    // grace 0 → only covering visits
    expect(where(placeVisitTasksForDay([task('w', '09:40')], visits, ctx, 0), 'w')).toBe('none');
    expect(where(placeVisitTasksForDay([task('w', '06:30')], visits, ctx, 0), 'w')).toBe('six');
    // null → no limit
    expect(where(placeVisitTasksForDay([task('w', '22:00')], visits, ctx, null), 'w')).toBe('ten (nearest)');
  });

  it('cancelled visit keeps its task (flagged) — it does not move to another visit', () => {
    const cancelledSix = { ...v('six', '06:00', '07:00', 1), cancelled: true };
    const placed = placeVisitTasksForDay([task('w', '06:30')], [cancelledSix, visits[1], visits[2]], ctx);
    expect(placed.get('six')).toEqual([
      { assignmentId: 'w', dueTime: '06:30', nearest: false, visitCancelled: true },
    ]);
    expect(placed.get('seven')).toEqual([]);
  });

  it('a live visit at the same time wins over a cancelled one (replacement visit)', () => {
    const cancelled = { ...v('old', '08:00', '09:00', 1), cancelled: true };
    const replacement = v('new', '08:00', '09:00', 2);
    const placed = placeVisitTasksForDay([task('w', '08:30')], [cancelled, replacement], ctx);
    expect(where(placed, 'w')).toBe('new');
  });

  it('nearest tie between a cancelled and a live visit prefers the live one', () => {
    const cancelled = { ...v('c', '06:00', '07:00', 1), cancelled: true };
    const live = v('l', '09:00', '10:00', 2);
    // 08:00 is 60 min from both
    expect(where(placeVisitTasksForDay([task('w', '08:00')], [cancelled, live], ctx), 'w')).toBe('l (nearest)');
  });

  it('no visits that day → task is not placed anywhere', () => {
    expect(placeVisitTasksForDay([task('w', '06:30')], [], ctx).size).toBe(0);
  });

  it('eMAR prompt is not placed by the day rule (it follows medicine times)', () => {
    const placed = placeVisitTasksForDay([prompt as never], visits, ctx);
    expect([...placed.values()].flat()).toEqual([]);
  });

  it('task without a due time uses its round time', () => {
    const placed = placeVisitTasksForDay([{ ...task('r', '00:00'), dueTime: null }], visits, ctx);
    // MORNING round time 08:00 → covered by "seven" (07:00–08:00, end inclusive)
    expect(where(placed, 'r')).toBe('seven');
  });
});

describe('buildVisitTaskProgressByJobId — placement mode', () => {
  const job = (id: string) => ({
    id,
    serviceUserId: SU,
    scheduledStartDateTime: new Date('2026-10-05T01:00:00Z'),
    scheduledEndDateTime: new Date('2026-10-05T02:00:00Z'),
    visits: [{ visitPlanSlot: null, scheduledStartDateTime: null, scheduledEndDateTime: null }],
  });

  it('counts placed tasks plus tasks already recorded on the visit', () => {
    const progress = buildVisitTaskProgressByJobId({
      jobs: [job('early'), job('late')],
      assignments: [washing, breakfast],
      completions: [{ scheduledJobId: 'late', assignmentId: 'washing', isCompleted: true }],
      placedAssignmentIdsByJob: new Map([
        ['early', new Set(['washing'])],
        ['late', new Set(['breakfast'])],
      ]),
    });
    expect(progress.get('early')).toEqual({ completed: 0, total: 1 });
    expect(progress.get('late')).toEqual({ completed: 1, total: 2 });
  });

  it('a visit without a plan slot still gets its placed tasks', () => {
    const progress = buildVisitTaskProgressByJobId({
      jobs: [job('adhoc')],
      assignments: [washing],
      completions: [],
      placedAssignmentIdsByJob: new Map([['adhoc', new Set(['washing'])]]),
    });
    expect(progress.get('adhoc')).toEqual({ completed: 0, total: 1 });
  });
});

describe('nearestVisitGapMinutes', () => {
  const visits = [{ jobId: 'v', window: { startHm: '11:00', endHm: '14:00' }, startMs: 1 }];
  it('07:00 task vs an 11:00–14:00 visit is 240 minutes away', () => {
    expect(nearestVisitGapMinutes('07:00', visits)).toBe(240);
  });
  it('is 0 inside a visit and null with no visits', () => {
    expect(nearestVisitGapMinutes('12:00', visits)).toBe(0);
    expect(nearestVisitGapMinutes('12:00', [])).toBeNull();
  });
});
