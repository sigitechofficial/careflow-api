import { renderQuoteHtml } from './quote-pdf-html.util';
import type { ClientQuoteView } from './quote-pdf.util';

const view = (over: Partial<ClientQuoteView>): ClientQuoteView => ({
  layout: 'DETAILED',
  provider: { name: 'All For Care', email: null, phone: null, vatNumber: null },
  quotationNumber: 'EQ-2026-0001',
  versionNumber: 1,
  quoteTypeLabel: 'Provisional estimate',
  statusLabel: 'Approved',
  issueDate: '2026-10-30',
  validUntil: '2026-11-29',
  proposedStartDate: '2026-11-09',
  proposedEndDate: null,
  clientName: 'Margaret Clarke',
  contactName: null,
  visits: [
    {
      label: 'Morning call',
      when: 'Mon, Tue 08:00-08:30 (weekly)',
      days: ['Mon', 'Tue'],
      time: '08:00 – 08:30',
      frequency: 'Weekly',
      duration: '30 min',
      carers: 1,
      activities: [],
      perVisit: '£12.00',
      weekly: '£24.00 / week',
    },
  ],
  extras: [],
  rates: [],
  totals: [{ label: 'Weekly', amount: '£24.00', method: 'One typical week' }],
  oneOffTotal: null,
  vatLabel: 'VAT not added',
  funding: [],
  clientWeeklyLiability: '£24.00 / week',
  clientNotes: null,
  terms: null,
  ...over,
});

describe('quote PDF layout', () => {
  it('shows visit times and prices on a detailed quote', () => {
    const html = renderQuoteHtml(view({}));
    expect(html).toContain('08:00 – 08:30');
    expect(html).toContain('Per visit');
    expect(html).toContain('£12.00');
  });

  it('shows only the visits by time of day and the total on a summary quote', () => {
    const html = renderQuoteHtml(
      view({
        layout: 'SUMMARY',
        visits: [
          {
            label: 'Morning visit',
            when: 'Mon, Tue (weekly)',
            days: ['Mon', 'Tue'],
            time: '',
            frequency: 'Weekly',
            duration: '',
            carers: 1,
            activities: [],
            perVisit: null,
            weekly: '',
          },
        ],
      }),
    );
    expect(html).toContain('Morning visit');
    expect(html).not.toContain('Per visit');
    expect(html).not.toContain('Duration');
    expect(html).toContain('£24.00');
  });
});
