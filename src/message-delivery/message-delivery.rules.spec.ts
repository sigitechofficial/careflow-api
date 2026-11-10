import { DEFAULT_DELIVERY_RULES, decideDelivery, normalisePhone, type DeliveryRules } from './message-delivery.rules';
import { maskPhone } from './message-delivery.service';
import { MESSAGE_KINDS, findKind } from './message-kinds';

const rules = (over: Partial<DeliveryRules> = {}): DeliveryRules => ({ ...DEFAULT_DELIVERY_RULES, ...over });

describe('message delivery rules', () => {
  it('sends everything to everyone when nothing is set (as before the settings existed)', () => {
    const d = decideDelivery(rules(), 'EMAIL', 'invoices', ['a@x.com', 'b@y.com']);
    expect(d.allowed).toEqual(['a@x.com', 'b@y.com']);
    expect(d.held).toEqual([]);
  });

  it('holds everything when the channel is off, or the type is off', () => {
    expect(decideDelivery(rules({ emailEnabled: false }), 'EMAIL', 'quotes', ['a@x.com']).held).toEqual([{ recipient: 'a@x.com', reason: 'CHANNEL_OFF' }]);
    expect(decideDelivery(rules({ disabledKinds: ['EMAIL:quotes'] }), 'EMAIL', 'quotes', ['a@x.com']).held[0].reason).toBe('TYPE_OFF');
    // The same key on another channel is separate.
    expect(decideDelivery(rules({ disabledKinds: ['EMAIL:surveys'] }), 'PUSH', 'surveys', ['a@x.com']).allowed).toEqual(['a@x.com']);
    expect(decideDelivery(rules({ pushEnabled: false }), 'PUSH', 'visits', ['a@x.com']).held[0].reason).toBe('CHANNEL_OFF');
  });

  it('limits to listed addresses and whole domains, case-insensitively', () => {
    const r = rules({ emailAudience: 'ALLOWED_ONLY', allowedEmails: ['@AllForCare.co.uk', 'tester@gmail.com'] });
    const d = decideDelivery(r, 'EMAIL', 'referral-replies', ['Sam@allforcare.co.uk', 'tester@GMAIL.com', 'gp@nhs.net', 'x@notallforcare.co.uk.evil.com']);
    expect(d.allowed).toEqual(['Sam@allforcare.co.uk', 'tester@GMAIL.com']);
    expect(d.held.map((h) => h.recipient)).toEqual(['gp@nhs.net', 'x@notallforcare.co.uk.evil.com']);
    expect(d.held.every((h) => h.reason === 'NOT_ALLOWED')).toBe(true);
  });

  it('lets sign-in and password emails through the list (only the person who asked gets them), unless switched off', () => {
    const r = rules({ emailAudience: 'ALLOWED_ONLY', allowedEmails: ['@allforcare.co.uk'] });
    expect(decideDelivery(r, 'EMAIL', 'account', ['carer@gmail.com']).allowed).toEqual(['carer@gmail.com']);
    expect(decideDelivery({ ...r, disabledKinds: ['EMAIL:account'] }, 'EMAIL', 'account', ['carer@gmail.com']).held[0].reason).toBe('TYPE_OFF');
  });

  it('matches phone numbers in any UK format; WhatsApp uses the text list', () => {
    const r = rules({ textAudience: 'ALLOWED_ONLY', allowedPhones: ['07700 900123'] });
    expect(decideDelivery(r, 'TEXT', 'surveys', ['+447700900123', '+447700900999']).allowed).toEqual(['+447700900123']);
    expect(decideDelivery(r, 'WHATSAPP', undefined, ['0044 7700 900123']).allowed).toEqual(['0044 7700 900123']);
    expect(decideDelivery(rules({ whatsappEnabled: false }), 'WHATSAPP', undefined, ['07700900123']).held[0].reason).toBe('CHANNEL_OFF');
    expect(normalisePhone('(07700) 900-123')).toBe('+447700900123');
  });

  it('treats an unknown or missing type as the channel\'s "other"', () => {
    expect(findKind('EMAIL', 'no-such-kind').key).toBe('other');
    expect(decideDelivery(rules({ disabledKinds: ['EMAIL:other'] }), 'EMAIL', undefined, ['a@x.com']).held[0].reason).toBe('TYPE_OFF');
  });

  it('has an "other" type for every channel and no duplicate types', () => {
    for (const c of ['EMAIL', 'TEXT', 'WHATSAPP', 'PUSH']) expect(MESSAGE_KINDS.some((k) => k.channel === c && k.key === 'other')).toBe(true);
    const ids = MESSAGE_KINDS.map((k) => `${k.channel}:${k.key}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never keeps a whole phone number in the log', () => {
    expect(maskPhone('+447700900123')).toBe('+447700•••123');
  });
});
