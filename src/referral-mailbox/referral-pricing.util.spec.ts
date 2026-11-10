import { exampleVisitPrices, isCommissioned, standardRatesInWords, visitPrice } from './referral-pricing.util';
import { buildReplyMime, htmlToPlain, sanitizeReplyHtml, textToHtml } from './referral-reply-mime.util';

describe('referral prices', () => {
  const rates = { shortVisits: [{ upToMinutes: 30, pricePerVisit: 17 }], weekend: { mode: 'PERCENT', value: 20 } };

  it('prices a visit from a short-visit band, else pro rata', () => {
    expect(visitPrice(30, 30, rates as never)).toBe(17);
    expect(visitPrice(45, 30, rates as never)).toBe(22.5);
    expect(visitPrice(60, 30, null)).toBe(30);
  });

  it('describes the rates and example visits in words', () => {
    expect(standardRatesInWords(30, rates)).toContain('£30.00 per carer per hour');
    expect(standardRatesInWords(30, rates)).toContain('+20%');
    expect(exampleVisitPrices(30, rates, [45])).toEqual([
      'A 45-minute weekday visit (one carer): £22.50',
      'A 30-minute weekday visit (one carer): £17.00',
      'A 1-hour weekday visit (one carer): £30.00',
    ]);
  });

  it('treats council and NHS funding as commissioned (priced by the funder)', () => {
    expect(isCommissioned('LOCAL_AUTHORITY')).toBe(true);
    expect(isCommissioned('NHS')).toBe(true);
    expect(isCommissioned('DIRECT_PAYMENT')).toBe(false);
    expect(isCommissioned('PRIVATE')).toBe(false);
  });
});

describe('reply email', () => {
  it('turns a drafted reply into HTML and back', () => {
    const html = textToHtml('Dear Mrs Bennett,\n\nCould you send:\n\n- Her address\n- A phone number\n\nKind regards,\nSuzette');
    expect(html).toContain('<ul><li>Her address</li><li>A phone number</li></ul>');
    expect(htmlToPlain(html)).toBe('Dear Mrs Bennett,\n\nCould you send:\n\n- Her address\n- A phone number\n\nKind regards,\nSuzette');
  });

  it('removes scripts and event handlers but keeps formatting', () => {
    const clean = sanitizeReplyHtml('<p onclick="x()"><b>Hi</b><script>alert(1)</script> <a href="javascript:evil()">x</a></p>');
    expect(clean).toBe('<p><b>Hi</b> <a href="#">x</a></p>');
  });

  it('builds a message with text, HTML, Cc and a PDF attachment', () => {
    const raw = buildReplyMime({
      from: '"Suzette" <me@example.test>',
      to: 'me@example.test',
      cc: ['manager@allforcare.co.uk'],
      bcc: [],
      subject: 'Re: Quote – visits',
      inReplyTo: '<a@b>',
      references: '<a@b>',
      text: 'Hello',
      html: '<p>Hello</p>',
      attachments: [{ filename: 'EQ-2026-0001-V1.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') }],
    });
    expect(raw).toContain('Cc: manager@allforcare.co.uk');
    expect(raw).toContain('Subject: =?UTF-8?B?');
    expect(raw).toContain('multipart/alternative');
    expect(raw).toContain('filename="EQ-2026-0001-V1.pdf"');
  });
});
