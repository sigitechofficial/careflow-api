export type ConditionFactsheetDefinition = {
  code: string;
  title: string;
  summary: string;
  /** HTML body — supports care plan personalisation tokens (@, @givenName, etc.). */
  contentHtml: string;
};

export const CONDITION_FACTSHEET_LIBRARY: ConditionFactsheetDefinition[] = [
  {
    code: 'dementia',
    title: 'Understanding dementia',
    summary: 'Person-centred background on dementia for carers and families.',
    contentHtml: `<p><strong>What dementia means for @givenName</strong></p>
<p>Dementia affects memory, thinking, and behaviour. Support should stay person-centred: focus on what @givenName can still do, their life story, and routines that help them feel safe.</p>
<ul>
<li>Speak calmly, in short sentences, and allow extra time to respond.</li>
<li>Use familiar objects, photos, and routines to support orientation.</li>
<li>Reduce noise and rushing — these often increase distress.</li>
<li>Involve family or advocates in planning and review.</li>
</ul>
<p>Review this plan whenever cognition, behaviour, or night-time support changes.</p>`,
  },
  {
    code: 'medication',
    title: 'Medication support factsheet',
    summary: 'Safe administration, refusal, and missed dose guidance.',
    contentHtml: `<p><strong>Medicating @givenName safely</strong></p>
<p>Follow the active medication list and support level recorded in the care plan and eMAR. Never crush or alter medicines unless prescribed and documented.</p>
<ul>
<li>Check identity, dose, route, and time before every administration.</li>
<li>Record refusals and missed doses promptly in eMAR with the agreed action.</li>
<li>Report side effects, confusion after medicines, or repeated refusals to the GP or pharmacy.</li>
<li>Store medicines securely; return discontinued medicines for safe disposal.</li>
</ul>`,
  },
  {
    code: 'falls',
    title: 'Falls prevention factsheet',
    summary: 'Environmental and mobility precautions after a falls risk is identified.',
    contentHtml: `<p><strong>Reducing falls risk for @givenName</strong></p>
<p>Keep pathways clear, ensure call bell or pendant is reachable, and use agreed mobility aids. Do not rush transfers.</p>
<ul>
<li>Good lighting — especially at night and on stairs.</li>
<li>Non-slip footwear; avoid trailing cables and loose rugs.</li>
<li>Follow the moving and handling plan and equipment checks.</li>
<li>Report new falls, near-misses, or dizziness immediately.</li>
</ul>`,
  },
  {
    code: 'diabetes',
    title: 'Diabetes care factsheet',
    summary: 'Blood glucose monitoring and hypo awareness.',
    contentHtml: `<p><strong>Diabetes support for @givenName</strong></p>
<p>Follow the prescribed monitoring and insulin/oral medicine plan. Know the signs of hypoglycaemia and the agreed treatment steps.</p>
<ul>
<li>Never skip agreed blood glucose checks before insulin where required.</li>
<li>Know hypo treatment (e.g. fast-acting glucose) and when to call 999.</li>
<li>Report unexplained highs/lows, illness, or appetite changes promptly.</li>
</ul>`,
  },
];

export const CONDITION_FACTSHEET_BY_CODE = new Map(
  CONDITION_FACTSHEET_LIBRARY.map((sheet) => [sheet.code, sheet]),
);
