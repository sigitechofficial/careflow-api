import {
  assessVisitPlanReadiness,
  assessVisitPlanSlotReadiness,
  slotAssignedEmployeeIds,
} from './visit-plan-readiness.util';

describe('visit-plan-readiness.util', () => {
  const roundNames = new Map([['AM', 'Morning']]);

  it('prefers carerAssignments over assignedEmployeeIds', () => {
    const ids = slotAssignedEmployeeIds({
      slotCode: 'AM',
      medicationRoundCode: 'AM',
      isEnabled: true,
      plannedStartTime: '08:00',
      plannedEndTime: '09:00',
      daysOfWeek: [1],
      scheduleFrequency: 'DAILY',
      requiredCarers: 1,
      assignedEmployeeIds: ['legacy-id'],
      carerAssignments: [{ employeeId: 'assignment-id' }],
    });
    expect(ids).toEqual(['assignment-id']);
  });

  it('flags missing times and carers on enabled slots', () => {
    const issues = assessVisitPlanSlotReadiness(
      {
        slotCode: 'AM',
        medicationRoundCode: 'AM',
        isEnabled: true,
        plannedStartTime: '',
        plannedEndTime: '',
        daysOfWeek: [1],
        scheduleFrequency: 'DAILY',
        requiredCarers: 2,
        assignedEmployeeIds: ['e1'],
      },
      roundNames,
    );
    expect(issues).toContain('Morning: set start and end times');
    expect(issues).toContain('Morning: 1 of 2 carers assigned');
  });

  it('marks plan not ready when no enabled slots', () => {
    const result = assessVisitPlanReadiness(
      [
        {
          slotCode: 'AM',
          medicationRoundCode: 'AM',
          isEnabled: false,
          plannedStartTime: '08:00',
          plannedEndTime: '09:00',
          daysOfWeek: [1],
          scheduleFrequency: 'DAILY',
          requiredCarers: 1,
          assignedEmployeeIds: ['e1'],
        },
      ],
      roundNames,
    );
    expect(result.ready).toBe(false);
    expect(result.issues).toContain('No enabled visit slots');
  });

  it('marks plan ready when all enabled slots pass checks', () => {
    const result = assessVisitPlanReadiness(
      [
        {
          slotCode: 'AM',
          medicationRoundCode: 'AM',
          isEnabled: true,
          plannedStartTime: '08:00',
          plannedEndTime: '09:00',
          daysOfWeek: [1, 2, 3, 4, 5],
          scheduleFrequency: 'DAILY',
          requiredCarers: 1,
          assignedEmployeeIds: ['e1'],
        },
      ],
      roundNames,
    );
    expect(result.ready).toBe(true);
    expect(result.enabledSlotCount).toBe(1);
    expect(result.issues).toHaveLength(0);
  });

  it('can skip carer requirement for bulk rota readiness', () => {
    const result = assessVisitPlanReadiness(
      [
        {
          slotCode: 'AM',
          medicationRoundCode: 'AM',
          isEnabled: true,
          plannedStartTime: '08:00',
          plannedEndTime: '09:00',
          daysOfWeek: [1, 2, 3, 4, 5],
          scheduleFrequency: 'DAILY',
          requiredCarers: 2,
          assignedEmployeeIds: [],
        },
      ],
      roundNames,
      { requireCarers: false },
    );
    expect(result.ready).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
