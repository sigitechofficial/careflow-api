import * as path from 'path';
import {
  detectVoiceNoteFormat,
  parseVoiceNoteLinks,
  timelineSourceForLink,
  voiceNoteLinkKey,
  formatVoiceNoteDuration,
  isAcceptedVoiceNoteDeclaredType,
  resolveVoiceNoteAbsolutePath,
  voiceNoteIdsByLogEntryId,
  voiceOnlyTimelineDetail,
} from './visit-voice-note.util';

describe('visit-voice-note.util', () => {
  it('detects M4A (ftyp box) and ADTS AAC; rejects anything else', () => {
    const m4a = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypM4A '), Buffer.alloc(8)]);
    expect(detectVoiceNoteFormat(m4a)).toEqual({ mimeType: 'audio/mp4', ext: '.m4a' });
    const adts = Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectVoiceNoteFormat(adts)).toEqual({ mimeType: 'audio/aac', ext: '.aac' });
    expect(detectVoiceNoteFormat(Buffer.from('<html><body>not audio'))).toBeNull();
    expect(detectVoiceNoteFormat(Buffer.alloc(4))).toBeNull();
    expect(detectVoiceNoteFormat(undefined)).toBeNull();
  });

  it('accepts only audio (or generic binary) declared types', () => {
    expect(isAcceptedVoiceNoteDeclaredType('audio/mp4')).toBe(true);
    expect(isAcceptedVoiceNoteDeclaredType('application/octet-stream')).toBe(true);
    expect(isAcceptedVoiceNoteDeclaredType('text/html')).toBe(false);
    expect(isAcceptedVoiceNoteDeclaredType(undefined)).toBe(false);
  });

  it('formats durations for voice-only timeline details', () => {
    expect(formatVoiceNoteDuration(42_000)).toBe('0:42');
    expect(formatVoiceNoteDuration(300_000)).toBe('5:00');
    expect(voiceOnlyTimelineDetail(65_400)).toBe('Voice note (1:05)');
    expect(voiceOnlyTimelineDetail(null)).toBe('Voice note');
    expect(voiceOnlyTimelineDetail(130_000, 3)).toBe('3 voice notes (2:10)');
  });

  it('maps notes / handover / concerns to the voice note they point at', () => {
    const map = voiceNoteIdsByLogEntryId({
      notes: [{ id: 'n1', voiceNoteId: 'v1' }, { id: 'n2' }],
      concerns: [{ id: 'c1', voiceNoteIds: [' v2 ', 'v2', 'v4'] }],
      handoverNote: { id: 'h1', voiceNoteIds: ['v3', 'v5', 'v6', 'v7'] },
    });
    expect([...map.entries()]).toEqual([
      ['n1', ['v1']],
      ['c1', ['v2', 'v4']],
      ['h1', ['v3', 'v5', 'v6']],
    ]);
    expect(voiceNoteIdsByLogEntryId(null).size).toBe(0);
  });

  it('only resolves paths inside the private voice note root', () => {
    const ok = resolveVoiceNoteAbsolutePath(path.join('storage', 'visit-voice-notes', 'job', 'a.m4a'));
    expect(ok).toBe(path.resolve(process.cwd(), 'storage/visit-voice-notes/job/a.m4a'));
    expect(resolveVoiceNoteAbsolutePath('storage/visit-voice-notes/../../.env')).toBeNull();
    expect(resolveVoiceNoteAbsolutePath('uploads/x.m4a')).toBeNull();
  });

  it('keys links per save when there is an idempotency key, else per record', () => {
    expect(voiceNoteLinkKey({ entryType: 'medication', entryId: 'm1', writeIdempotencyKey: 'k1' })).toBe(
      'idem:k1',
    );
    expect(voiceNoteLinkKey({ entryType: 'sos', entryId: 's1', writeIdempotencyKey: ' ' })).toBe('sos:s1');
  });

  it('parses stored links and drops malformed ones', () => {
    const links = parseVoiceNoteLinks({
      voiceNoteLinks: {
        'idem:k1': {
          entryType: 'task',
          entryId: 'a1',
          writeIdempotencyKey: 'k1',
          voiceNoteIds: ['v1', 'v1', 'v2'],
          recordedByEmployeeId: 'e1',
          updatedAt: '2026-10-06T05:00:00Z',
        },
        bad: { entryType: '', entryId: 'x' },
        worse: 'nope',
      },
    });
    expect(links).toEqual([
      {
        entryType: 'task',
        entryId: 'a1',
        writeIdempotencyKey: 'k1',
        voiceNoteIds: ['v1', 'v2'],
        recordedByEmployeeId: 'e1',
        updatedAt: '2026-10-06T05:00:00Z',
      },
    ]);
    expect(parseVoiceNoteLinks(null)).toEqual([]);
  });

  it('maps record types to their timeline source when the save key is unknown', () => {
    const base = { entryId: 'x', recordedByEmployeeId: 'e1' };
    expect(timelineSourceForLink({ ...base, entryType: 'task' })).toEqual({ sourceType: 'task', sourceId: 'x' });
    expect(timelineSourceForLink({ ...base, entryType: 'check_in' })).toEqual({
      sourceType: 'check_in',
      sourceId: 'check_in:e1',
    });
    expect(timelineSourceForLink({ ...base, entryType: 'unable_to_start' })).toEqual({
      sourceType: 'complete',
      sourceId: 'unable_to_start',
    });
    expect(timelineSourceForLink({ ...base, entryType: 'sos' })).toBeNull();
  });
});
