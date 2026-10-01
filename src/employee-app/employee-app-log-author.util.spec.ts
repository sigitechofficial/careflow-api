import { logEntryRolesById, visitLogAuthorLabel } from './employee-app-log-author.util';

describe('employee-app-log-author.util', () => {
  it('reads the role stored on notes, concerns, incidents and handover', () => {
    const roles = logEntryRolesById({
      notes: [
        { id: 'n1', recordedByRole: 'support' },
        { id: 'n2' },
      ],
      concerns: [{ id: 'c1', recordedByRole: 'lead' }],
      incidents: [{ id: 'i1', recordedByRole: 'support' }],
      handoverNote: { id: 'h1', recordedByRole: 'lead' },
    });
    expect(roles.get('n1')).toBe('support');
    expect(roles.has('n2')).toBe(false);
    expect(roles.get('c1')).toBe('lead');
    expect(roles.get('i1')).toBe('support');
    expect(roles.get('h1')).toBe('lead');
  });

  it('ignores bad shapes', () => {
    expect(logEntryRolesById(null).size).toBe(0);
    expect(logEntryRolesById({ notes: 'x', handoverNote: [] }).size).toBe(0);
  });

  it('labels the author with their role', () => {
    expect(visitLogAuthorLabel('Liam Walsh', 'support')).toBe('Liam Walsh (Support)');
    expect(visitLogAuthorLabel('Chloe Mensah', 'lead')).toBe('Chloe Mensah (Lead)');
    expect(visitLogAuthorLabel('Amina Yusuf', null)).toBe('Amina Yusuf');
  });
});
