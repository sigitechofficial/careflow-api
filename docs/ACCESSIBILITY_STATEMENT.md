# Accessibility statement for CareFlow surveys (DRAFT)

> **Draft, not yet published.** Written on 6 November 2026 after the Phase 1 survey accessibility audit.
> Before publishing: fill in the items marked **[to confirm]**, have it reviewed, and repeat the checks
> on the release that goes live. Do not publish claims that the live release has not been checked
> against.

This statement applies to the survey parts of CareFlow, the care management software used by home care
agencies registered with the Care Quality Commission (CQC):

- the survey page that people answer through a survey link (`/survey/…`), whether it was sent to them
  personally, shared as a link or QR code, or opened from a poster;
- the surveys area of the CareFlow portal for people we support and their families (Surveys, Answer
  survey, View my answers);
- the survey screens that care agency staff use in CareFlow: the surveys list, a survey (questions,
  sections, sharing, who can see the answers, alerts), New survey, Results, Record response, Follow-ups,
  Ready-made surveys, Preview, and the printable paper copy and poster.

**[to confirm: the survey call list (`/surveys/…/calls`) is a survey screen but has not been audited or
scanned. Either audit it before publishing or list it under "Not tested yet".]**

The rest of CareFlow is not covered by this statement yet.

The care agency that sends a survey is responsible for its questions and wording. CareFlow is
responsible for how the survey pages work.

## How accessible the survey pages are

We want as many people as possible to be able to answer a survey and to run one. You should be able to:

- answer every kind of question using only a keyboard (Tab to move between questions, arrow keys to
  choose an answer, Space to tick a box);
- use a screen reader (each question is read with its answers, which answer is chosen, whether it must
  be answered, and its help text);
- zoom to 400% or use a screen 320 pixels wide without scrolling sideways;
- change colours, contrast and fonts using your browser or device settings;
- use the page in light or dark mode;
- be told clearly what needs putting right if you press Submit too early: a list of the problems at the
  top of the page, each linking to its question, and an "Error:" message at the question itself.

When you answer a survey anonymously, these features never record who you are. Nothing about how you use
the page (keyboard, screen reader, zoom) is stored with your answers.

If a survey does not suit you, you can ask the care agency to take your answers another way: by
telephone, on a visit, or on a printed paper copy, which staff then type in for you.

## How accessible this website is

We believe the survey pages listed above meet the Web Content Accessibility Guidelines (WCAG) version 2.2
at level AA, apart from the issues listed under "Content that is not accessible". **[to confirm on the
release being published]**

## Content that is not accessible

### Known issues

- **Paper copy and poster.** These are designed to be printed. On screen they work with a keyboard and a
  screen reader, but the printed paper form cannot be read by assistive technology. People who need
  another format should ask the care agency to take their answers by phone or on a visit.
- **QR code.** The poster's QR code is an image. The poster also shows the web address as text.
- **Results charts.** Results show figures as text and tables, as well as bars. The bars are drawn as
  graphics. **[to confirm: check every chart has its figures as text before publishing]**
- **Screens outside the survey area.** Parts of CareFlow that are not listed above have not been audited
  yet. Some form fields there may still have low-contrast borders or text, and some pages may not yet
  have a heading of their own.
- **Large print, easy read and other languages.** A survey is shown in the language and wording the care
  agency wrote. We do not yet offer easy-read or translated versions of the same survey. This is planned
  (survey roadmap, A5). For large print, the page can be zoomed (see above), and the care agency can print
  the paper copy at a larger size.

### Not tested yet

- Results filtered by group and period, with real data.
- Testing with disabled users, and with screen readers other than those listed below.

## What we are doing to improve accessibility

- Audit the rest of CareFlow to the same standard, section by section.
- Run an automated accessibility check (axe-core) on the main screens as part of our automated tests.
  A check already runs on the main routes. On the survey screens it fails the test run if it finds a
  problem; on other screens it only reports problems for now. **[to confirm: whether this test run is
  part of the release pipeline, so that a failure stops a release]**
- Offer easy-read, large-print and other-language versions of the same survey, with the results combined.
- Test with people who use assistive technology, including people we support and care workers.

## Feedback and contact information

If you find a problem with a survey page, or need a survey in a different format:

- if you are answering a survey: please contact the care agency that sent it. If the agency has added
  its phone number and email to CareFlow, they are shown on the survey page when the survey is closed or
  cannot be answered **[to confirm: they are not yet shown while a survey is open, which is when someone
  needing another format would look for them; show them there too, or change this sentence]**;
- if you work for a care agency that uses CareFlow: **[to confirm: support email and phone]**.

We aim to reply within **[to confirm]** working days.

## Enforcement

CareFlow is not a public sector website, so the Public Sector Bodies (Websites and Mobile Applications)
(No. 2) Accessibility Regulations 2018 do not apply to it. We still follow the same standard (WCAG 2.2
AA) and the same format for this statement.

Care agencies that use CareFlow must make reasonable adjustments for disabled people under the Equality
Act 2010. In England, care agencies that provide NHS or publicly funded adult social care must also
follow the Accessible Information Standard when they communicate with people who use their services;
the Care Quality Commission looks at how agencies meet people's communication needs whoever pays for
their care. **[to confirm: the Standard's current reference and version on the NHS England website
(originally DCB1605, now published as DAPB1605)]**

If you are not happy with how a care agency has responded, complain to the agency first. If that does
not resolve it:

- for care arranged or paid for by a council, or paid for by yourself, you can contact the Local
  Government and Social Care Ombudsman;
- for care paid for by the NHS, you can contact the Parliamentary and Health Service Ombudsman.

If you think you have been treated unfairly because of a disability, you can also get free advice from
the Equality Advisory and Support Service (EASS). **[to confirm: add the current contact details or
links for the ombudsmen and EASS]**

## How we tested the survey pages

Tested on 6 November 2026, on the development version of CareFlow, against WCAG 2.2 level AA:

- **Automated checks:** axe-core 4.14 (WCAG 2.0, 2.1 and 2.2 A and AA rules, plus best practice), in
  light and dark mode. Checked: the answer page (also with errors showing), the portal's Surveys page, a
  survey, Results (Summary and Individual responses), Preview, Surveys, Ready-made surveys, Follow-ups,
  paper copy, poster, and every dialog on the survey page (Who can see the answers, Add or change alert,
  Who handles alerts, Rename section, Move question, Edit details, Close survey). **[to confirm: the
  repeatable check in our automated tests uses the WCAG rules only, in light mode, and does not cover
  the paper copy, poster, dialogs or best practice rules. Keep the record of the wider check, or extend
  the automated check to match, before publishing this list.]**
- **Keyboard only:** answering, the error summary and its links, moving between questions and answers,
  opening and closing dialogs (focus moves into the dialog and back to the button that opened it), and
  the section manager.
- **Screen reader structure:** the accessibility tree (names, roles, states, descriptions, headings and
  landmarks) of the same screens. **[to confirm: a full pass with NVDA and VoiceOver before publishing]**
- **Zoom and reflow:** 320 × 256 CSS pixels (equal to 400% zoom on a 1280 × 1024 screen) and 375 pixels
  wide.
- **Colour contrast:** every theme colour pair in light and dark mode is checked by script: text at
  least 4.5:1, form-control borders and other non-text at least 3:1.
- **Automated component tests** (Vitest and Testing Library), which run with every change: question
  types use native radio buttons, check boxes and labels; errors are tied to their questions; dialogs
  return focus.

## Preparation of this statement

This statement was prepared on 6 November 2026 (draft). It was last reviewed on **[to confirm]**. We
will review it again by **[to confirm: review date, at most 12 months later]**, and whenever the
survey pages change significantly.
