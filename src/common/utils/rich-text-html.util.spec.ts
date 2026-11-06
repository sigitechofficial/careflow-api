import {
  loadPolicyLibrary,
  renderPolicyHtml,
  withOrganisationName,
  type LibraryPolicy,
} from '../../../prisma/seed-lib/policy-library';
import { sanitizeOptionalRichTextHtml, sanitizeRichTextHtml } from './rich-text-html.util';

/**
 * A sanitiser re-serialises text, so `&quot;` in text comes back as a plain `"` (the same character
 * when rendered). Everything else in the ready-made library HTML must come back byte for byte.
 */
const asReserialised = (html: string) => html.replace(/&quot;/g, '"');

describe('sanitizeRichTextHtml', () => {
  describe('removes script', () => {
    it('drops script and style elements with their content', () => {
      expect(sanitizeRichTextHtml('<p>Before</p><script>alert(1)</script><p>After</p>')).toBe(
        '<p>Before</p><p>After</p>',
      );
      expect(sanitizeRichTextHtml('<style>body{display:none}</style><p>Text</p>')).toBe('<p>Text</p>');
      expect(sanitizeRichTextHtml('<p>a<SCRIPT src="https://evil.example/x.js"></SCRIPT>b</p>')).toBe('<p>ab</p>');
    });

    it('drops on* event handler attributes', () => {
      expect(sanitizeRichTextHtml('<p onclick="alert(1)" onmouseover="steal()">Hi</p>')).toBe('<p>Hi</p>');
      expect(sanitizeRichTextHtml('<a href="https://nhs.uk" onfocus="alert(1)">NHS</a>')).toBe(
        '<a href="https://nhs.uk" rel="noopener noreferrer">NHS</a>',
      );
    });

    it('drops elements that can run script or load content', () => {
      expect(sanitizeRichTextHtml('<img src=x onerror="alert(1)"><p>ok</p>')).toBe('<p>ok</p>');
      expect(sanitizeRichTextHtml('<svg onload="alert(1)"><circle /></svg><p>ok</p>')).toBe('<p>ok</p>');
      expect(sanitizeRichTextHtml('<iframe src="https://evil.example"></iframe><p>ok</p>')).toBe('<p>ok</p>');
      expect(sanitizeRichTextHtml('<object data="x.swf"></object><embed src="x"><form action="https://evil.example"><input name="pw"></form>ok')).toBe('ok');
    });

    it('removes javascript:, data: and other non-web link schemes', () => {
      for (const href of [
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        ' javascript:alert(1)',
        'java\tscript:alert(1)',
        'javascript&#58;alert(1)',
        '&#106;avascript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
        'vbscript:msgbox(1)',
        '//evil.example/path',
        '/relative/path',
      ]) {
        expect(sanitizeRichTextHtml(`<a href="${href}">link</a>`)).toBe('<a>link</a>');
      }
    });

    it('keeps the text of tags outside the allow-list', () => {
      expect(sanitizeRichTextHtml('<div><span style="color:red">Plain</span> text</div>')).toBe('Plain text');
      expect(sanitizeRichTextHtml('<h5>Small heading</h5>')).toBe('Small heading');
    });

    it('drops style except text alignment', () => {
      expect(sanitizeRichTextHtml('<p style="text-align: center; background: url(javascript:alert(1))">x</p>')).toBe(
        '<p style="text-align:center">x</p>',
      );
      expect(sanitizeRichTextHtml('<p style="position:fixed;top:0">x</p>')).toBe('<p>x</p>');
      expect(sanitizeRichTextHtml('<p style="text-align: expression(alert(1))">x</p>')).toBe('<p>x</p>');
    });
  });

  describe('keeps editor HTML', () => {
    it('keeps headings, paragraphs, emphasis, lists, quotes and rules', () => {
      const html =
        '<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4>' +
        '<p><strong>Bold</strong> <em>italic</em> <u>underline</u> <s>struck</s><br />next line</p>' +
        '<ul><li><p>Bullet</p></li></ul><ol><li><p>Step</p></li></ol>' +
        '<blockquote><p>Quote</p></blockquote><hr />';
      expect(sanitizeRichTextHtml(html)).toBe(html);
    });

    it('keeps http, https and mailto links and forces rel', () => {
      expect(
        sanitizeRichTextHtml(
          '<a target="_blank" rel="noopener noreferrer nofollow" href="https://www.cqc.org.uk/guidance">CQC</a>',
        ),
      ).toBe('<a target="_blank" rel="noopener noreferrer" href="https://www.cqc.org.uk/guidance">CQC</a>');
      expect(sanitizeRichTextHtml('<a href="http://example.org">x</a>')).toBe(
        '<a href="http://example.org" rel="noopener noreferrer">x</a>',
      );
      expect(sanitizeRichTextHtml('<a href="mailto:office@example.org">Email</a>')).toBe(
        '<a href="mailto:office@example.org" rel="noopener noreferrer">Email</a>',
      );
      expect(sanitizeRichTextHtml('<a href="https://x.org" target="top">x</a>')).toBe(
        '<a href="https://x.org" rel="noopener noreferrer">x</a>',
      );
    });

    it('keeps tables with colspan and rowspan, and editor alignment', () => {
      const html =
        '<table><colgroup><col /><col /></colgroup><tbody>' +
        '<tr><th colspan="2" rowspan="1"><p>Head</p></th></tr>' +
        '<tr><td><p style="text-align:right">1</p></td><td rowspan="2">2</td></tr>' +
        '</tbody></table>';
      expect(sanitizeRichTextHtml(html)).toBe(html);
      expect(sanitizeRichTextHtml('<table style="min-width: 50px"><tbody><tr><td colspan="x" onclick="a()">1</td></tr></tbody></table>')).toBe(
        '<table><tbody><tr><td>1</td></tr></tbody></table>',
      );
    });

    it('keeps escaped text escaped', () => {
      expect(sanitizeRichTextHtml('<p>Use &lt;script&gt; &amp; stay safe</p>')).toBe(
        '<p>Use &lt;script&gt; &amp; stay safe</p>',
      );
    });
  });

  describe('ready-made policy library HTML', () => {
    const policy: LibraryPolicy = {
      reference: 'POL-TEST-001',
      revision: 1,
      title: 'Test policy',
      documentType: 'POLICY',
      summary: 'Summary',
      keyPoints: { intro: `{{organisation}} staff "always" follow this & that.`, points: ['First', "Don't skip"] },
      reviewFrequencyMonths: 12,
      acknowledgementRequired: true,
      audience: [],
      moduleLinks: [],
      relatedReferences: ['POL-TEST-002'],
      regulatoryBasis: [
        { source: 'Health and Social Care Act 2008 (Regulated Activities) Regulations 2014: Regulation 12', url: 'https://www.legislation.gov.uk/uksi/2014/2936/regulation/12' },
        { source: 'NICE NG67 & guidance', url: 'https://www.nice.org.uk/guidance/ng67?tab=a&b=c' },
      ],
      sections: [
        {
          heading: 'Purpose',
          blocks: [
            { p: 'Why <this> matters.' },
            { bullets: ['One', 'Two'] },
            { steps: ['Do this', 'Then that'] },
            { table: { columns: ['Who', 'What'], rows: [['Manager', 'Reviews'], ['Carer', 'Reports']] } },
          ],
          subsections: [{ heading: 'Scope', blocks: [{ p: 'All staff.' }] }],
        },
      ],
    } as LibraryPolicy;

    it('passes renderPolicyHtml output through unchanged', () => {
      const html = withOrganisationName(
        renderPolicyHtml(policy, (ref) => (ref === 'POL-TEST-002' ? 'Related policy' : undefined)),
        'Bright & Co "Care"',
      );
      expect(html).toContain('<table><thead>');
      expect(html).toContain('target="_blank" rel="noopener noreferrer"');
      expect(sanitizeRichTextHtml(html)).toBe(asReserialised(html));
    });

    it('passes every policy in the library through unchanged', () => {
      const files = loadPolicyLibrary(undefined, { partial: true });
      const titles = new Map(files.flatMap((f) => f.documents.map((d) => [d.reference, d.title] as const)));
      const policies = files.flatMap((f) => f.documents);
      expect(policies.length).toBeGreaterThan(0);
      for (const p of policies) {
        const html = withOrganisationName(renderPolicyHtml(p, (ref) => titles.get(ref)), 'Example Care Ltd');
        expect({ reference: p.reference, html: sanitizeRichTextHtml(html) }).toEqual({
          reference: p.reference,
          html: asReserialised(html),
        });
      }
    });
  });

  describe('sanitizeOptionalRichTextHtml', () => {
    it('passes null and undefined through and sanitises strings', () => {
      expect(sanitizeOptionalRichTextHtml(null)).toBeNull();
      expect(sanitizeOptionalRichTextHtml(undefined)).toBeUndefined();
      expect(sanitizeOptionalRichTextHtml('<p onclick="x()">a</p>')).toBe('<p>a</p>');
    });
  });
});
