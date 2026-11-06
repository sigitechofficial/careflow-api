import { classifyTextReply } from './text-message-replies.util';

describe('classifyTextReply', () => {
  it.each([
    ['STOP', 'STOP'],
    [' stop. ', 'STOP'],
    ['Stop sending me these', 'STOP'],
    ['STOP ALL', 'STOP'],
    ['Unsubscribe', 'STOP'],
    ['opt out', 'STOP'],
    ['END', 'STOP'],
    ['Start', 'START'],
    ['UNSTOP', 'START'],
    ['opt-in', 'START'],
  ])('%s → %s', (text, kind) => expect(classifyTextReply(text)).toBe(kind));

  it.each(['Cancel my visit tomorrow please', 'Thanks!', 'Please end the call earlier on Friday', '', 'Yes', '123'])(
    'ignores "%s"',
    (text) => expect(classifyTextReply(text)).toBeNull(),
  );
});
