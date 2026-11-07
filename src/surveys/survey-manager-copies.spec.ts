import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { SurveyManagerCopiesService } from './survey-manager-copies.service';
import { chooseManagerMinTeam, fillManager, fillManagerDeep, managerMinTeam, managerMinTeamBounds, planManagerCopies, surveyNamesManager, type ManagerTeam } from './survey-manager-copies.util';

const NOW = new Date('2027-06-01T09:00:00Z');
const longAgo = new Date('2026-01-01T00:00:00Z');
const staff = (n: number, prefix: string, namedSince: Date | null = longAgo) =>
  Array.from({ length: n }, (_, i) => ({ employeeId: `${prefix}-${i + 1}`, name: `${prefix} ${i + 1}`, namedSince }));
const team = (name: string, n: number, over: Partial<ManagerTeam> = {}): ManagerTeam => ({
  managerUserId: `u-${name}`,
  managerName: name,
  holdsSurveyAccess: false,
  staff: staff(n, name),
  ...over,
});

describe('planManagerCopies', () => {
  it('gives each manager with 5 or more staff their own copy', () => {
    const plan = planManagerCopies([team('Sam', 6), team('Ana', 5)], NOW);
    expect(plan.copies.map((c) => [c.managerName, c.employeeIds.length])).toEqual([
      ['Ana', 5],
      ['Sam', 6],
    ]);
    expect(plan.pooled).toBeNull();
    expect(plan.notSent).toEqual([]);
  });

  it('pools smaller teams only when the pool cannot point at a manager (3+ managers, 5+ staff, none over half)', () => {
    const plan = planManagerCopies([team('Sam', 6), team('Bo', 2), team('Cy', 2), team('Di', 2)], NOW);
    expect(plan.pooled).toMatchObject({ managerNames: ['Bo', 'Cy', 'Di'] });
    expect(plan.pooled!.employeeIds).toHaveLength(6);
    expect(plan.notSent).toEqual([]);
  });

  it('secondary suppression: no pooled copy with only 2 managers, too few people, or one team over half', () => {
    const two = planManagerCopies([team('Bo', 4), team('Cy', 3)], NOW);
    expect(two.pooled).toBeNull();
    expect(two.notSent.map((n) => n.managerName)).toEqual(['Bo', 'Cy']);
    expect(two.notSent[0].reason).toMatch(/would cover only 2 managers, so its results would point at one of them/);

    const one = planManagerCopies([team('Bo', 4)], NOW);
    expect(one.notSent[0].reason).toMatch(/only 1 manager, so its results would point at them/);

    const few = planManagerCopies([team('Bo', 1), team('Cy', 1), team('Di', 2)], NOW);
    expect(few.pooled).toBeNull();
    expect(few.notSent[0].reason).toMatch(/only 4 people/);

    const dominated = planManagerCopies([team('Bo', 4), team('Cy', 1), team('Di', 1)], NOW);
    expect(dominated.pooled).toBeNull();
    expect(dominated.notSent[0].reason).toMatch(/more than half/);
  });

  it('leaves out staff named under the manager for less than about 3 months; unknown dates are kept', () => {
    const recent = new Date('2027-05-01T00:00:00Z');
    const plan = planManagerCopies(
      [team('Sam', 0, { staff: [...staff(5, 'old', null), ...staff(2, 'new', recent)] }), team('Ana', 0, { staff: staff(3, 'new', recent) })],
      NOW,
    );
    expect(plan.copies).toHaveLength(1);
    expect(plan.copies[0].employeeIds).toEqual(['old-1', 'old-2', 'old-3', 'old-4', 'old-5']);
    expect(plan.recentlyNamed).toEqual([
      { managerName: 'Ana', count: 3 },
      { managerName: 'Sam', count: 2 },
    ]);
    expect(plan.notSent).toEqual([{ managerName: 'Ana', reason: 'Nobody has been named under them for 3 months yet.' }]);
  });

  it("leaves out an excluded role's team entirely (no copy, never pooled) and re-checks pooling without it", () => {
    // Without the exclusion the three small teams would pool; with Bo excluded only 2 managers remain.
    const plan = planManagerCopies([team('Sam', 6), team('Bo', 2, { excludedAs: 'Registered Manager' }), team('Cy', 2), team('Di', 2)], NOW);
    expect(plan.copies.map((c) => c.managerName)).toEqual(['Sam']);
    expect(plan.pooled).toBeNull();
    expect(plan.notSent).toEqual([
      { managerName: 'Bo', reason: "The Registered Manager's team is not asked: their answers could not stay anonymous." },
      expect.objectContaining({ managerName: 'Cy', reason: expect.stringMatching(/only 2 managers/) }),
      expect.objectContaining({ managerName: 'Di' }),
    ]);
    // An excluded manager with a big team gets no copy either.
    const big = planManagerCopies([team('Rm', 9, { excludedAs: 'Registered Manager' })], NOW);
    expect(big.copies).toEqual([]);
    expect(big.notSent[0].reason).toMatch(/Registered Manager's team is not asked/);
  });

  it("uses the survey's minimum team for own copies, the pool's total and the reasons; never below 5", () => {
    const plan = planManagerCopies([team('Sam', 8), team('Ana', 7), team('Bo', 3), team('Cy', 2), team('Di', 1)], NOW, 8);
    expect(plan.copies.map((c) => c.managerName)).toEqual(['Sam']);
    // Ana (7) joins the smaller teams: 7 is more than half of 13, so none of them is pooled.
    expect(plan.pooled).toBeNull();
    expect(plan.notSent.find((n) => n.managerName === 'Ana')?.reason).toBe(
      'Fewer than 8 staff, and one manager’s staff would be more than half of the smaller-teams copy, so its results would point at them.',
    );
    const pooled = planManagerCopies([team('Bo', 4), team('Cy', 4), team('Di', 4)], NOW, 10);
    expect(pooled.pooled?.employeeIds).toHaveLength(12);
    const tooFew = planManagerCopies([team('Bo', 3), team('Cy', 3), team('Di', 3)], NOW, 10);
    expect(tooFew.notSent[0]!.reason).toBe('Fewer than 10 staff, and all the smaller teams together are only 9 people.');
    const two = planManagerCopies([team('Bo', 6), team('Cy', 6)], NOW, 10);
    expect(two.notSent[0]!.reason).toMatch(/^Fewer than 10 staff, and the smaller-teams copy would cover only 2 managers/);
    // Never below 5, whatever is asked.
    expect(planManagerCopies([team('Bo', 4)], NOW, 2).copies).toEqual([]);
    expect(managerMinTeam({ perManagerMinTeam: 10 })).toBe(10);
    expect(managerMinTeam({ perManagerMinTeam: 3 })).toBe(5);
    expect(managerMinTeam({ perManagerMinTeam: 99 })).toBe(50);
    expect(managerMinTeam({ perManagerMinTeam: '10' })).toBe(5);
    expect(managerMinTeam(null)).toBe(5);
  });

  it('minimum team bounds: the reporting threshold for results, never below 5 or above 50', () => {
    expect(managerMinTeamBounds(10)).toEqual({ min: 10, max: 50 });
    expect(managerMinTeamBounds(0)).toEqual({ min: 5, max: 50 });
    expect(managerMinTeamBounds(null)).toEqual({ min: 5, max: 50 });
    expect(managerMinTeamBounds(80)).toEqual({ min: 50, max: 50 });
    const b = managerMinTeamBounds(10);
    expect(chooseManagerMinTeam(6, b)).toEqual({ ok: true, minTeam: 10 });
    expect(chooseManagerMinTeam(12, b)).toEqual({ ok: true, minTeam: 12 });
    expect(chooseManagerMinTeam(12, b, 20)).toEqual({ ok: true, minTeam: 20 });
    expect(chooseManagerMinTeam(12, b, 9)).toEqual({ ok: false, message: 'The smallest team can be no fewer than 10. Below 10, answers could be traced to one person.' });
    expect(chooseManagerMinTeam(12, b, 51)).toMatchObject({ ok: false });
    expect(chooseManagerMinTeam(12, b, 10.5)).toMatchObject({ ok: false });
  });

  it('warns about managers who could watch their own copy (survey access)', () => {
    const plan = planManagerCopies([team('Sam', 6, { holdsSurveyAccess: true }), team('Bo', 2, { holdsSurveyAccess: true }), team('Cy', 2), team('Di', 2)], NOW);
    expect(plan.accessWarnings).toEqual(['Sam', 'Bo']);
  });
});

describe('surveyNamesManager', () => {
  const details = { title: 'Feedback', description: null, closingMessage: null, sectionIntros: null };
  it('finds {{manager}} in alert rules, answers, section titles and introductions, not only question text', () => {
    expect(surveyNamesManager(details, [], [])).toBe(false);
    expect(surveyNamesManager(details, [], [{ title: 'Respect', whenText: 'Does {{manager}} listen? answered No' }])).toBe(true);
    expect(surveyNamesManager(details, [{ options: ['{{manager}}', 'Other'] }], [])).toBe(true);
    expect(surveyNamesManager(details, [{ sectionTitle: 'About {{manager}}' }], [])).toBe(true);
    expect(surveyNamesManager({ ...details, sectionIntros: { 'About {{manager}}': 'Text' } }, [], [])).toBe(true);
    expect(surveyNamesManager({ ...details, closingMessage: '{{manager}} never sees this.' }, [], [])).toBe(true);
  });
});

describe('fillManager', () => {
  it('puts the name in, capitalised at the start of a sentence', () => {
    expect(fillManager('Does {{manager}} listen to you?', 'Sam Patel')).toBe('Does Sam Patel listen to you?');
    expect(fillManager('{{manager}} listens. {{manager}} helps me.', 'your line manager')).toBe('Your line manager listens. Your line manager helps me.');
    expect(fillManagerDeep({ prompt: 'What could {{manager}} do?' }, 'your line manager')).toEqual({ prompt: 'What could your line manager do?' });
  });
});

describe('SurveyManagerCopiesService', () => {
  const admin = { id: 'admin-1', roles: ['Super Admin'], assignedLocationIds: null } as any;
  const branchUser = { id: 'b-1', roles: ['Manager'], assignedLocationIds: ['loc-1'] } as any;
  const template = {
    id: 'tpl-1',
    title: 'Feedback on your manager',
    description: 'Tell us about {{manager}}.',
    closingMessage: null,
    sectionIntros: { 'Day to day': 'About {{manager}} day to day.' },
    targetKind: 'EMPLOYEE',
    isTemplate: true,
    status: 'DRAFT',
    isAnonymous: true,
    locationIds: [],
    deletedAt: null,
  };
  const setup = (
    opts: { survey?: any; teams?: Array<{ manager: string; n: number; access?: boolean; admin?: boolean; rm?: boolean }>; catalogueMeta?: any; copyPolicy?: any } = {},
  ) => {
    const teams = opts.teams ?? [{ manager: 'Sam', n: 5 }];
    const employments = teams.flatMap((t) =>
      Array.from({ length: t.n }, (_, i) => ({
        employeeId: `${t.manager}-${i}`,
        supervisorUserId: `u-${t.manager}`,
        employee: { personalDetail: { firstName: t.manager, lastName: `Staff ${i}` } },
      })),
    );
    let copyN = 0;
    const prisma: any = {
      role: { findMany: jest.fn(async () => [{ id: 'role-rm', name: 'Registered Manager' }, { id: 'role-cc', name: 'Care Coordinator' }]) },
      surveyAlertOwnerRole: { findMany: jest.fn(async () => []) },
      survey: {
        findFirst: jest.fn(async (args: any) => (args?.where?.isCatalogue ? { libraryMeta: opts.catalogueMeta ?? null } : (opts.survey ?? template))),
        findUniqueOrThrow: jest.fn(async () => ({
          id: 'copy',
          clonedFromId: null,
          createdById: 'admin-1',
          isAnonymous: true,
          allowAnonymousResponses: false,
          libraryReference: null,
          libraryMeta: null,
          accessPolicy: opts.copyPolicy ?? null,
          reportingThreshold: null,
          description: 'Tell us about {{manager}}.',
          closingMessage: 'Thank you. {{manager}} never sees your answers.',
          sectionIntros: { 'About {{manager}}': 'About {{manager}} day to day.' },
        })),
        update: jest.fn(async (a: any) => a),
      },
      surveyQuestion: {
        findMany: jest.fn(async () => [
          { id: 'q1', questionText: 'Does {{manager}} treat you with respect?', helpText: null, sectionTitle: 'About {{manager}}', options: null, config: null, exclusiveOptions: null, commentConfig: null, otherOption: null },
          { id: 'q2', questionText: 'Who do you ask first?', helpText: null, sectionTitle: 'Overall', options: ['{{manager}}', 'Someone else'], config: null, exclusiveOptions: null, commentConfig: null, otherOption: null },
          { id: 'q3', questionText: 'Overall?', helpText: null, sectionTitle: 'Overall', options: null, config: null, exclusiveOptions: null, commentConfig: null, otherOption: null },
        ]),
        update: jest.fn(async (a: any) => a),
      },
      surveyAlertRule: {
        findMany: jest.fn(async () => [
          { id: 'r1', title: 'Respect', whenText: 'Does {{manager}} treat you with respect? answered Never', actionText: 'Talk to the HR Manager.', conditions: [{ questionKey: 'q2', answers: ['{{manager}}'] }] },
          { id: 'r2', title: 'Other', whenText: 'Overall answered Poor', actionText: 'Read it.', conditions: [] },
        ]),
        update: jest.fn(async (a: any) => a),
      },
      employeeEmployment: { findMany: jest.fn(async () => employments) },
      user: {
        findMany: jest.fn(async () => teams.map((t) => ({ id: `u-${t.manager}`, firstName: t.manager, lastName: 'Manager', email: `${t.manager}@x` }))),
      },
      userRole: {
        findMany: jest.fn(async () => [
          ...teams.filter((t) => t.access).map((t) => ({ userId: `u-${t.manager}`, roleId: 'role-cc', role: { name: 'Care Coordinator', rolePermissions: [{ permission: { key: 'surveys.read' } }] } })),
          ...teams.filter((t) => t.admin).map((t) => ({ userId: `u-${t.manager}`, roleId: 'role-admin', role: { name: 'Admin', rolePermissions: [] } })),
          ...teams.filter((t) => t.rm).map((t) => ({ userId: `u-${t.manager}`, roleId: 'role-rm', role: { name: 'Registered Manager', rolePermissions: [] } })),
        ]),
      },
      auditLog: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
    };
    const audit = { logAudit: jest.fn() };
    const surveys = { duplicate: jest.fn(async (_a: any, _id: string, o: any) => ({ data: { id: `copy-${++copyN}`, title: o.title } })) };
    const service = new SurveyManagerCopiesService(prisma, new OrgScopeService(prisma), audit as any, surveys as any);
    return { service, prisma, audit, surveys };
  };

  it('makes a draft per manager with the name merged in and only their staff chosen, audited without answers', async () => {
    const { service, prisma, audit, surveys } = setup();
    const res = await service.create(admin, 'tpl-1', { label: 'June 2027' });
    expect(surveys.duplicate).toHaveBeenCalledWith(admin, 'tpl-1', { title: 'Feedback on your manager: Sam Manager, June 2027' }, undefined);
    const update = prisma.survey.update.mock.calls[0][0];
    // Remembered on the copy, so its team is checked again when it is sent or opened.
    expect(update.data.managerCopy).toEqual({ managerUserIds: ['u-Sam'], pooled: false, minTeam: 5 });
    expect(update.data).toMatchObject({
      description: 'Tell us about Sam Manager.',
      closingMessage: 'Thank you. Sam Manager never sees your answers.',
      // Section titles are filled in the introductions' keys too, so they still match.
      sectionIntros: { 'About Sam Manager': 'About Sam Manager day to day.' },
      audienceEmployeeIds: ['Sam-0', 'Sam-1', 'Sam-2', 'Sam-3', 'Sam-4'],
      // The manager it rates never sees it, whatever their role.
      accessPolicy: { excludeUserIds: ['u-Sam'] },
    });
    // Questions that name the manager anywhere (text, section title, answers) are changed; others not.
    expect(prisma.surveyQuestion.update).toHaveBeenCalledTimes(2);
    expect(prisma.surveyQuestion.update.mock.calls[0][0].data).toMatchObject({
      questionText: 'Does Sam Manager treat you with respect?',
      sectionTitle: 'About Sam Manager',
    });
    expect(prisma.surveyQuestion.update.mock.calls[1][0].data.options).toEqual(['Sam Manager', 'Someone else']);
    // Its alert rules too, with the answers they check filled the same way.
    expect(prisma.surveyAlertRule.update).toHaveBeenCalledTimes(1);
    expect(prisma.surveyAlertRule.update.mock.calls[0][0].data).toMatchObject({
      whenText: 'Does Sam Manager treat you with respect? answered Never',
      conditions: [{ questionKey: 'q2', answers: ['Sam Manager'] }],
    });
    expect(res.data.created).toEqual([{ surveyId: 'copy-1', title: 'Feedback on your manager: Sam Manager, June 2027', managerNames: ['Sam Manager'], people: 5 }]);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'survey_manager_copies_created', recordId: 'tpl-1' }));
  });

  it('the pooled copy says "your line manager" and is titled for smaller teams', async () => {
    const { service, prisma, surveys } = setup({ teams: [{ manager: 'Bo', n: 2 }, { manager: 'Cy', n: 2 }, { manager: 'Di', n: 2 }] });
    await service.create(admin, 'tpl-1', {});
    expect(surveys.duplicate).toHaveBeenCalledTimes(1);
    expect(surveys.duplicate.mock.calls[0][2]).toEqual({ title: 'Feedback on your manager: smaller teams' });
    expect(prisma.survey.update.mock.calls[0][0].data.description).toBe('Tell us about your line manager.');
    expect(prisma.survey.update.mock.calls[0][0].data.audienceEmployeeIds).toHaveLength(6);
    // Every manager it covers is left out of who can see it.
    expect(prisma.survey.update.mock.calls[0][0].data.accessPolicy.excludeUserIds).toEqual(['u-Bo', 'u-Cy', 'u-Di']);
  });

  it("keeps the copy's own who-can-see settings and adds the rated manager to those left out", async () => {
    const policy = {
      responses: { restricted: true, ownerKeys: ['HR_MANAGER'], roleIds: [], userIds: [] },
      results: { restricted: true, ownerKeys: ['HR_MANAGER', 'REGISTERED_MANAGER'], roleIds: [], userIds: [] },
    };
    const { service, prisma } = setup({ copyPolicy: policy });
    await service.create(admin, 'tpl-1', {});
    expect(prisma.survey.update.mock.calls[0][0].data.accessPolicy).toEqual({ ...policy, excludeUserIds: ['u-Sam'] });
  });

  it("leaves out the ready-made survey's excluded roles (through the role mapping), or what the dialog chooses", async () => {
    const teams = [{ manager: 'Rm', n: 6, rm: true }, { manager: 'Sam', n: 5 }];
    const lib = setup({ teams, survey: { ...template, libraryReference: 'SUR-STF-018', libraryMeta: null }, catalogueMeta: { perManagerExclude: ['REGISTERED_MANAGER'] } });
    const { data } = await lib.service.plan(admin, 'tpl-1');
    expect(data.exclude).toEqual(['REGISTERED_MANAGER']);
    expect(data.copies.map((c) => c.managerName)).toEqual(['Sam Manager']);
    expect(data.notSent).toEqual([{ managerName: 'Rm Manager', reason: "The Registered Manager's team is not asked: their answers could not stay anonymous." }]);
    await lib.service.create(admin, 'tpl-1', {});
    expect(lib.surveys.duplicate).toHaveBeenCalledTimes(1);
    // The dialog can choose otherwise (none left out here), and unknown roles are refused.
    const { data: none } = await lib.service.plan(admin, 'tpl-1', []);
    expect(none.copies).toHaveLength(2);
    await expect(lib.service.plan(admin, 'tpl-1', ['BOSS'])).rejects.toThrow(/Unknown role/);
    // The organisation's mapping wins over the usual role name.
    const mapped = setup({ teams: [{ manager: 'Sam', n: 5, access: false }, { manager: 'Cc', n: 5, access: true }] });
    mapped.prisma.surveyAlertOwnerRole.findMany.mockResolvedValue([{ ownerKey: 'REGISTERED_MANAGER', roleId: 'role-cc' }]);
    const { data: m } = await mapped.service.plan(admin, 'tpl-1', ['REGISTERED_MANAGER']);
    expect(m.notSent.map((n) => n.managerName)).toEqual(['Cc Manager']);
  });

  it("reads the ready-made survey's minimum team (its own details first), says it in the plan and audits it", async () => {
    const teams = [{ manager: 'Sam', n: 8 }, { manager: 'Ana', n: 6 }];
    const lib = setup({ teams, survey: { ...template, libraryReference: 'SUR-STF-018', libraryMeta: null }, catalogueMeta: { perManagerMinTeam: 7 } });
    const { data } = await lib.service.plan(admin, 'tpl-1');
    expect(data.minTeam).toBe(7);
    expect(data.copies.map((c) => c.managerName)).toEqual(['Sam Manager']);
    expect(data.notSent[0]!.reason).toMatch(/^Fewer than 7 staff/);
    await lib.service.create(admin, 'tpl-1', {});
    expect(lib.audit.logAudit.mock.calls[0][0].metadata).toMatchObject({ minTeam: 7 });
    // The template's own details win over the current ready-made survey; nothing set = 5.
    const own = setup({ teams, survey: { ...template, libraryReference: 'SUR-STF-018', libraryMeta: { perManagerMinTeam: 6 } }, catalogueMeta: { perManagerMinTeam: 9 } });
    expect((await own.service.plan(admin, 'tpl-1')).data.minTeam).toBe(6);
    expect((await setup({ teams }).service.plan(admin, 'tpl-1')).data.minTeam).toBe(5);
  });

  it('the smallest team can be changed in the dialog: the plan, the pooled total and each copy use it', async () => {
    const teams = [{ manager: 'Sam', n: 8 }, { manager: 'Ana', n: 6 }, { manager: 'Bo', n: 3 }, { manager: 'Cy', n: 3 }, { manager: 'Di', n: 3 }];
    const lib = setup({ teams, survey: { ...template, libraryReference: 'SUR-STF-018', libraryMeta: null }, catalogueMeta: { perManagerMinTeam: 5 } });
    const { data } = await lib.service.plan(admin, 'tpl-1', undefined, 7);
    expect(data).toMatchObject({ minTeam: 7, defaultMinTeam: 5, minTeamMin: 5, minTeamMax: 50 });
    expect(data.minTeamFloorReason).toBe('Below 5, answers could be traced to one person.');
    expect(data.copies.map((c) => c.managerName)).toEqual(['Sam Manager']);
    // Ana (6) now joins the smaller teams; together 15, none over half: pooled at the same minimum.
    expect(data.pooled?.managerNames).toEqual(['Ana Manager', 'Bo Manager', 'Cy Manager', 'Di Manager']);
    await lib.service.create(admin, 'tpl-1', { minTeam: 7 });
    const updates = lib.prisma.survey.update.mock.calls.map((c: any) => c[0].data.managerCopy);
    // Stored on each copy, so the send-time check uses the same value.
    expect(updates).toEqual([
      { managerUserIds: ['u-Sam'], pooled: false, minTeam: 7 },
      { managerUserIds: ['u-Ana', 'u-Bo', 'u-Cy', 'u-Di'], pooled: true, minTeam: 7 },
    ]);
    // Audited with the old (ready-made) and new values.
    expect(lib.audit.logAudit.mock.calls[0][0]).toMatchObject({
      oldValues: { minTeam: 5 },
      newValues: { minTeam: 7 },
      metadata: { minTeam: 7, minTeamChanged: true },
    });
  });

  it("never below the survey's reporting threshold for results (nor 5), never above 50, whole numbers only", async () => {
    const teams = [{ manager: 'Sam', n: 12 }];
    // STF-018: results need 10 answers, so 10 is the floor even if the ready-made team size were lower.
    const stf018 = setup({
      teams,
      survey: { ...template, libraryReference: 'SUR-STF-018', libraryMeta: null, allowAnonymousResponses: false, reportingThreshold: null, accessPolicy: null },
      catalogueMeta: { perManagerMinTeam: 6, access: { reportingThreshold: 10 } },
    });
    const { data } = await stf018.service.plan(admin, 'tpl-1');
    expect(data).toMatchObject({ minTeam: 10, defaultMinTeam: 10, minTeamMin: 10, minTeamMax: 50 });
    expect(data.minTeamFloorReason).toBe('Below 10, answers could be traced to one person.');
    await expect(stf018.service.plan(admin, 'tpl-1', undefined, 9)).rejects.toThrow(
      'The smallest team can be no fewer than 10. Below 10, answers could be traced to one person.',
    );
    await expect(stf018.service.create(admin, 'tpl-1', { minTeam: 9 })).rejects.toBeInstanceOf(BadRequestException);
    expect(stf018.surveys.duplicate).not.toHaveBeenCalled();
    await expect(stf018.service.plan(admin, 'tpl-1', undefined, 51)).rejects.toThrow('The smallest team can be at most 50.');
    await expect(stf018.service.plan(admin, 'tpl-1', undefined, 10.5)).rejects.toThrow(/whole number/);
    // A survey's own threshold counts too, and the floor is never below 5.
    const own = setup({ teams, survey: { ...template, reportingThreshold: 12, allowAnonymousResponses: false, accessPolicy: null, libraryMeta: null } });
    expect((await own.service.plan(admin, 'tpl-1')).data).toMatchObject({ minTeam: 12, minTeamMin: 12 });
    await expect(setup({ teams }).service.plan(admin, 'tpl-1', undefined, 4)).rejects.toThrow(/no fewer than 5/);
    // Unchanged: audited as the same old and new value.
    const same = setup({ teams });
    await same.service.create(admin, 'tpl-1', {});
    expect(same.audit.logAudit.mock.calls[0][0]).toMatchObject({ oldValues: { minTeam: 5 }, newValues: { minTeam: 5 }, metadata: { minTeamChanged: false } });
  });

  it('says when no role stands for a left-out library role (its team cannot be found and would get a copy)', async () => {
    const lib = setup({ teams: [{ manager: 'Rm', n: 6 }, { manager: 'Sam', n: 5 }] });
    lib.prisma.role.findMany.mockResolvedValue([{ id: 'role-cc', name: 'Care Coordinator' }]);
    // A setting that points at a role since deleted counts as not set.
    lib.prisma.surveyAlertOwnerRole.findMany.mockResolvedValue([{ ownerKey: 'REGISTERED_MANAGER', roleId: 'role-gone' }]);
    const { data } = await lib.service.plan(admin, 'tpl-1', ['REGISTERED_MANAGER']);
    expect(data.excludeNotFound).toEqual(['Registered Manager']);
    expect(data.copies).toHaveLength(2);
    await lib.service.create(admin, 'tpl-1', { exclude: ['REGISTERED_MANAGER'] });
    expect(lib.audit.logAudit.mock.calls[0][0].metadata.excludedRolesNotFound).toEqual(['Registered Manager']);
    // Found: nothing to say; and several people holding the role are each left out.
    const both = setup({ teams: [{ manager: 'Rm', n: 6, rm: true }, { manager: 'Rm2', n: 6, rm: true }, { manager: 'Sam', n: 5 }] });
    const { data: found } = await both.service.plan(admin, 'tpl-1', ['REGISTERED_MANAGER']);
    expect(found.excludeNotFound).toEqual([]);
    expect(found.copies.map((c) => c.managerName)).toEqual(['Sam Manager']);
    expect(found.notSent.map((n) => n.managerName)).toEqual(['Rm Manager', 'Rm2 Manager']);
  });

  it('warns only about a rated manager who would still see their copy (an admin), not everyone with survey access', async () => {
    const { data } = await setup({ teams: [{ manager: 'Sam', n: 5, access: true }] }).service.plan(admin, 'tpl-1');
    expect(data.accessWarnings).toEqual([]);
    const { service, surveys } = setup({ teams: [{ manager: 'Sam', n: 5, admin: true }] });
    await expect(service.create(admin, 'tpl-1', {})).rejects.toThrow(/Sam Manager is an admin, so they would still see the answers/);
    expect(surveys.duplicate).not.toHaveBeenCalled();
    await service.create(admin, 'tpl-1', { confirmAccess: true });
    expect(surveys.duplicate).toHaveBeenCalledTimes(1);
  });

  it('refuses branch-restricted users, surveys without {{manager}}, sent surveys and nobody to send to', async () => {
    await expect(setup().service.plan(branchUser, 'tpl-1')).rejects.toBeInstanceOf(ForbiddenException);
    const plain = setup({ survey: { ...template, title: 'Staff survey', description: null, sectionIntros: null } });
    plain.prisma.surveyQuestion.findMany.mockResolvedValue([{ questionText: 'Overall?', helpText: null, commentConfig: null, otherOption: null }]);
    plain.prisma.surveyAlertRule.findMany.mockResolvedValue([]);
    await expect(plain.service.plan(admin, 'tpl-1')).rejects.toThrow(/does not name a manager/);
    await expect(setup({ survey: { ...template, isTemplate: false, status: 'ACTIVE' } }).service.plan(admin, 'tpl-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ teams: [{ manager: 'Bo', n: 3 }] }).service.create(admin, 'tpl-1', {})).rejects.toThrow(/No manager has enough staff/);
  });
});
