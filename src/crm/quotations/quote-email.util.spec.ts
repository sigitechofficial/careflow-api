import { buildQuoteEmail } from './quote-email.util';
import type { ClientQuoteView } from './quote-pdf.util';

const view: ClientQuoteView = {
  layout: 'DETAILED',
  provider: {
    name: 'All For Care',
    email: 'office@example.com',
    phone: '020 7946 0000',
    vatNumber: null,
  },
  quotationNumber: 'EQ-2026-0001',
  versionNumber: 2,
  quoteTypeLabel: 'Provisional estimate',
  statusLabel: 'Approved',
  issueDate: '2026-10-30',
  validUntil: '2026-11-29',
  proposedStartDate: '2026-11-09',
  proposedEndDate: null,
  clientName: 'Margaret Clarke',
  contactName: 'John Clarke',
  visits: [
    {
      label: 'Morning call',
      when: 'Mon, Tue 08:00-08:30 (weekly)',
      days: ['Mon', 'Tue'],
      time: '08:00 – 08:30',
      frequency: 'Weekly',
      duration: '30 min',
      carers: 2,
      activities: ['Personal care', 'Breakfast'],
      perVisit: '£24.00',
      weekly: '£48.00 / week',
    },
  ],
  extras: [
    { description: 'Set-up fee', frequency: 'One-off', amount: '£50.00' },
  ],
  rates: [{ label: 'Weekends', value: '+20%' }],
  totals: [{ label: 'Weekly', amount: '£48.00', method: 'One typical week' }],
  oneOffTotal: '£50.00',
  vatLabel: null,
  funding: [
    {
      payer: 'Croydon Council',
      detail: '£20.00 per week',
      weekly: '£20.00',
      status: 'Confirmed',
    },
  ],
  clientWeeklyLiability: '£28.00 / week',
  clientNotes: 'We look forward to supporting you.',
  terms: 'Four weeks notice.',
};

describe('buildQuoteEmail', () => {
  it('puts everything on the quotation in the message', () => {
    const { text, html } = buildQuoteEmail(view, {
      recipientName: 'John',
      message: null,
    });
    for (const part of [
      'Dear John,',
      'EQ-2026-0001 (version 2)',
      'Provisional estimate',
      'Margaret Clarke',
      'Contact: John Clarke',
      'Valid until: 29 Nov 2026',
      'Proposed start: 9 Nov 2026',
      'Morning call: £48.00 / week',
      'Mon, Tue 08:00-08:30 (weekly) · 30 min · 2 carers · £24.00 per visit',
      'Includes: Personal care, Breakfast',
      'Set-up fee: £50.00',
      'Weekends: +20%',
      'Weekly: £48.00',
      'One typical week',
      'One-off charges: £50.00',
      'Croydon Council: £20.00',
      'You pay: £28.00 / week',
      'We look forward to supporting you.',
      'Four weeks notice.',
      'office@example.com · 020 7946 0000',
    ])
      expect(text).toContain(part);
    expect(html).toContain('Morning call');
    expect(html).toContain('You pay');
    expect(html).toContain('Four weeks notice.');
  });

  it('keeps the sender’s own message and escapes it in the HTML', () => {
    const { text, html } = buildQuoteEmail(view, {
      recipientName: null,
      message: 'See <below>',
    });
    expect(text).toContain('Dear Sir or Madam,');
    expect(text).toContain('See <below>');
    expect(html).toContain('See &lt;below&gt;');
  });

  it('shows no times or per-visit prices for a total amount quote', () => {
    const { text } = buildQuoteEmail(
      {
        ...view,
        layout: 'SUMMARY',
        visits: [{ ...view.visits[0], when: 'Mon, Tue · Morning' }],
      },
      { recipientName: null, message: null },
    );
    expect(text).toContain('Mon, Tue · Morning · 2 carers');
    expect(text).not.toContain('per visit');
    expect(text).not.toContain('08:00');
  });
});
