import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { randomUUID } from 'crypto';

/**
 * Made-up referral emails for testing the referrals mailbox (development only).
 * Every name, address, number and organisation here is fictional; postcodes are real public buildings so the
 * area check works. Together they cover the senders and needs the inbox should handle.
 */

type Doc = { title: string; lines: string[] };
type Scenario = {
  /** Shown in the "Add a test referral" menu. */
  label: string;
  /** Who it tests: the sender and the kind of need. */
  audience: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  body: string;
  /** Sent as a Word file. */
  carePlan?: Doc;
  /** Sent as a PDF. */
  discharge?: Doc;
};

const SCENARIOS: Scenario[] = [
  {
    label: 'Council hospital discharge (Croydon)',
    audience: 'Social worker · council funded · 4 calls a day · attachments',
    subject: 'New referral – Mrs Edith Marlow – hospital discharge Friday',
    fromName: 'Priya Desai (TEST)',
    fromEmail: 'priya.desai@example-council.test',
    body: [
      'Hello,',
      '',
      'Please find attached a referral for Mrs Edith Marlow (DOB 12/04/1938), 14 Larkspur Close, Purley, CR8 2AA.',
      'She is being discharged from Riverside General on Friday and needs a package of 4 calls a day (14 hours per week), single-handed.',
      'Funding is Croydon Council, spot purchase; our package reference is CRY-TEST-55821.',
      '',
      'Could you please confirm:',
      '1. Whether you can start on Saturday morning?',
      '2. Your hourly rate for a council spot purchase?',
      '3. Whether you have a female carer available, as Mrs Marlow prefers?',
      '',
      'Her daughter, Joanna Marlow, is next of kin (07700 900123).',
      '',
      'Kind regards,',
      'Priya Desai',
      'Social Worker, Adult Social Care (TEST)',
      '020 7946 0811',
    ].join('\n'),
    carePlan: {
      title: 'Care and Support Plan – Edith Marlow (TEST)',
      lines: [
        'Name: Edith Marlow. Date of birth: 12/04/1938. NHS number: 943 476 5919 (test).',
        'Address: 14 Larkspur Close, Purley, CR8 2AA. Lives alone in a ground-floor flat.',
        'Conditions: Type 2 diabetes, osteoarthritis of both knees, mild cognitive impairment.',
        'Morning call (8:00–8:45): help to wash and dress, prompt medication from blister pack, breakfast.',
        'Lunch call (12:30–13:00): prepare a light meal, check fluid intake.',
        'Tea call (17:00–17:30): prepare evening meal, prompt evening medication.',
        'Bed call (20:00–20:30): help to undress and settle, ensure pendant alarm is on.',
        'Risks: high risk of falls (fell twice in the last 3 months), uses a walking frame indoors.',
        'Preferences: female carers only. Church of England; likes to listen to the radio in the morning.',
        'Access: key safe at the front door; code to be given by the social worker by phone.',
      ],
    },
    discharge: {
      title: 'Hospital Discharge Summary – Riverside General (TEST)',
      lines: [
        'Patient: Edith Marlow, DOB 12/04/1938.',
        'Admitted 21/10/2026 after a fall at home; no fracture. Treated for a urinary tract infection.',
        'Planned discharge: Friday, with a package of care 4 times daily.',
        'Medication: metformin 500 mg twice daily, paracetamol 1 g as needed, nitrofurantoin course to finish in 3 days.',
        'Mobility: walking frame, supervision on stairs. Physiotherapy follow-up arranged.',
        'Next of kin: Joanna Marlow (daughter).',
      ],
    },
  },
  {
    label: 'Family, private, partial postcode',
    audience: 'Son · self-funded · stroke · asks availability and cost',
    subject: 'Enquiry about care for my father',
    fromName: 'Daniel Okafor (TEST)',
    fromEmail: 'daniel.okafor@example-family.test',
    body: [
      'Hi,',
      '',
      'My father, Samuel Okafor, is 82 and lives with me in Coulsdon (CR5). He had a stroke last year and needs help with personal care in the mornings and getting to bed at night.',
      'We would pay privately to begin with. Do you have availability, and what would it cost for two visits a day?',
      'He speaks English and Yoruba; a carer who understands Yoruba would be lovely but is not essential.',
      '',
      'I have attached the notes from his last assessment.',
      '',
      'Thanks,',
      'Daniel',
    ].join('\n'),
    carePlan: {
      title: 'Assessment notes – Samuel Okafor (TEST)',
      lines: [
        'Left-sided weakness after a stroke (2025). Needs one carer to help with washing and dressing.',
        'Continence: occasional incontinence at night; uses pads.',
        'Swallowing: normal diet, cut into small pieces.',
        'Communication: speech slightly slurred but understandable.',
      ],
    },
    discharge: {
      title: 'GP letter – Samuel Okafor (TEST)',
      lines: ['Medication: clopidogrel 75 mg daily, atorvastatin 40 mg at night, ramipril 5 mg daily.'],
    },
  },
  {
    label: 'Price only – no details',
    audience: 'Daughter · just asking our rates',
    subject: 'How much do you charge?',
    fromName: 'Helen Price (TEST)',
    fromEmail: 'helen.price@example-family.test',
    body: [
      'Hello,',
      '',
      'Could you tell me how much you charge per hour for home care? My mum is starting to need some help a few times a week',
      'and we are looking at a few agencies. Do you charge more at weekends?',
      '',
      'Many thanks,',
      'Helen',
    ].join('\n'),
  },
  {
    label: 'Self-funder asks for a quote (Harrow)',
    audience: 'Wife · private · clear visit pattern · wants a quote',
    subject: 'Quote for morning and evening visits please',
    fromName: 'Margaret Bennett (TEST)',
    fromEmail: 'm.bennett@example-family.test',
    body: [
      'Dear Sir or Madam,',
      '',
      'I am looking for help for my husband, Arthur Bennett (born 3 March 1947). We live at 12 Elmwood Avenue, Harrow, HA1 2XY.',
      "Arthur has Parkinson's and needs help getting washed and dressed in the morning, and help getting ready for bed.",
      'We would like a 45-minute visit at 8am Monday to Friday, and a 30-minute visit at 8pm every evening.',
      'We will be paying ourselves. Please could you send me a quote? We would like to start on 1 December.',
      '',
      'Yours faithfully,',
      'Margaret Bennett',
      '020 8000 0001',
    ].join('\n'),
  },
  {
    label: 'NHS fast-track, end of life (Doncaster)',
    audience: 'District nurse · NHS CHC fast-track · double-up · night care · urgent',
    subject: 'URGENT CHC Fast Track – Mr Peter Holloway – end of life care',
    fromName: 'Sister Claire Watts (TEST)',
    fromEmail: 'claire.watts@example-nhs.test',
    body: [
      'Good afternoon,',
      '',
      'Urgent fast-track referral for Mr Peter Holloway, DOB 19/07/1951, 5 Priory Walk, Doncaster DN1 3BU.',
      'Mr Holloway has advanced lung cancer and wishes to die at home. CHC fast track has been agreed (NHS funded).',
      'He needs 4 double-handed calls a day (hoist transfers): 08:00 for 1 hour, 12:00 for 30 min, 17:00 for 30 min, 21:00 for 45 min.',
      'The family have also asked for waking night support three nights a week. We would like care to start tomorrow if at all possible.',
      'Syringe driver is managed by the district nursing team. DNACPR is in place.',
      '',
      'Can you confirm today whether you can pick this up?',
      '',
      'Claire Watts, District Nursing Sister (TEST)',
      '01302 000 000',
    ].join('\n'),
    discharge: {
      title: 'CHC Fast Track Tool – Peter Holloway (TEST)',
      lines: [
        'Diagnosis: advanced lung cancer; prognosis weeks.',
        'Care needs: all personal care, repositioning 4-hourly, mouth care, continence care (catheter).',
        'Equipment: profiling bed, pressure mattress, hoist and slings in place.',
        'Funding: NHS Continuing Healthcare fast track (approved).',
      ],
    },
  },
  {
    label: 'Outside our areas (Manchester)',
    audience: 'Social worker · council funded · out of area',
    subject: 'Referral – Mrs Joan Fletcher – package of care',
    fromName: 'Tom Riley (TEST)',
    fromEmail: 'tom.riley@example-council.test',
    body: [
      'Hi,',
      '',
      'I have a new package for Mrs Joan Fletcher (DOB 02/02/1940) at 40 King Street, Manchester M2 5DB:',
      'two calls a day, 07:30 for 45 minutes and 19:00 for 30 minutes, every day. Council funded, start next Monday.',
      'Please let me know if you can help.',
      '',
      'Tom Riley, Social Worker (TEST)',
    ].join('\n'),
  },
  {
    label: 'Younger adult, learning disability (Hounslow)',
    audience: 'Support coordinator · direct payment · male carer · community support',
    subject: 'Support worker needed – direct payment – Jamal Hussain',
    fromName: 'Aisha Rahman (TEST)',
    fromEmail: 'aisha.rahman@example-support.test',
    body: [
      'Hello,',
      '',
      'I coordinate support for Jamal Hussain, aged 27, who has a learning disability and autism. He lives with his family at 8 Lampton Road, Hounslow TW3 4DN.',
      'Jamal uses a direct payment and is looking for a male support worker for community activities (swimming, the library, shopping):',
      'Tuesday and Thursday afternoons, 2pm to 5pm. He communicates verbally but needs clear, short sentences and a consistent worker.',
      'What is your hourly rate for direct payment clients, and could you start in two weeks?',
      '',
      'Best wishes,',
      'Aisha Rahman, Support Coordinator (TEST)',
    ].join('\n'),
    carePlan: {
      title: 'Support plan – Jamal Hussain (TEST)',
      lines: [
        'Likes: swimming, buses, the library. Dislikes: loud crowded places.',
        'Communication: short sentences; give time to respond; uses a visual timetable.',
        'Behaviour: can become anxious with changes of plan; warn him in advance.',
        'Funding: London Borough of Hounslow direct payment (managed account).',
      ],
    },
  },
  {
    label: 'Child (Ealing)',
    audience: 'Parent · 15-year-old · after-school support',
    subject: 'After school care for my son',
    fromName: 'Sofia Novak (TEST)',
    fromEmail: 'sofia.novak@example-family.test',
    body: [
      'Hi there,',
      '',
      'My son Luka is 15 years old and has cerebral palsy. We live at 3 Mattock Lane, Ealing W5 2HL.',
      'We need someone to help him after school on weekdays, 4pm to 6pm, with personal care and his tea while I am at work.',
      'Do you work with children? How much would it be?',
      '',
      'Sofia',
    ].join('\n'),
  },
  {
    label: 'Self-referral, short and informal (Wandsworth)',
    audience: 'Older person writing for themself · two visits a week · price',
    subject: 'help',
    fromName: 'George Ellis (TEST)',
    fromEmail: 'g.ellis@example-family.test',
    body: [
      'hello i need someone to help me have a shower twice a week tuesday and friday mornings about 10 oclock.',
      'i am 88 and live on my own at 21 Wandsworth High St SW18 2PU. how much is it',
      'george',
    ].join('\n'),
  },
  {
    label: 'Live-in care, dementia (Brent)',
    audience: 'Care coordinator · dementia · live-in request · mixed funding',
    subject: 'Live-in care enquiry – Mrs Ruth Adeyemi',
    fromName: 'Mark Dunn (TEST)',
    fromEmail: 'mark.dunn@example-mentalhealth.test',
    body: [
      'Dear team,',
      '',
      'I am the care coordinator for Mrs Ruth Adeyemi (DOB 30/09/1944), 2 Engineers Way, Wembley HA9 0FJ.',
      "Ruth has moderate Alzheimer's, wanders at night and her family feel she now needs live-in care.",
      'Funding will be a mix of council funding and a family top-up. Do you provide live-in care, and what does it cost per week?',
      '',
      'Regards,',
      'Mark Dunn, Care Coordinator (TEST)',
    ].join('\n'),
  },
  {
    label: 'Not a referral – job application',
    audience: 'Carer applying for a job',
    subject: 'Application for carer position',
    fromName: 'Grace Mensah (TEST)',
    fromEmail: 'grace.mensah@example-jobs.test',
    body: [
      'Dear Hiring Manager,',
      '',
      'I would like to apply for a care worker role with your company. I have 3 years of experience in domiciliary care,',
      'a full UK driving licence and an enhanced DBS. My CV is attached.',
      '',
      'Kind regards,',
      'Grace Mensah',
    ].join('\n'),
    carePlan: {
      title: 'CV – Grace Mensah (TEST)',
      lines: ['Care Worker, 2023–2026: personal care, medication support, dementia care.', 'Care Certificate; Moving and Handling.'],
    },
  },
  {
    label: 'Complaint about a current client’s visits',
    audience: 'Daughter of a current client · complaint · staff handle it',
    subject: 'Late visits for my mother',
    fromName: 'Helen Price (TEST)',
    fromEmail: 'helen.price@example-family.test',
    body: [
      'Hello,',
      '',
      'Your carers look after my mother, Joan Price (TEST), in Croydon. This week the morning carer came after 11am twice,',
      'so Mum had no breakfast or tablets until then. I am not happy about this and would like someone to call me today.',
      '',
      'Helen Price',
      '07700 900111',
    ].join('\n'),
  },
  {
    label: 'Safeguarding concern from a neighbour',
    audience: 'Neighbour · safeguarding concern · staff handle it',
    subject: 'Worried about the lady at number 4',
    fromName: 'Peter Long (TEST)',
    fromEmail: 'peter.long@example-family.test',
    body: [
      'Hi,',
      '',
      'I live next door to Mrs Rose Field (TEST), 4 Larkspur Close, Purley CR8 2AA. I think your carers visit her.',
      'Her grandson has been taking her bank card and she seems frightened of him. She has had bruises on her arms.',
      'I did not know who else to tell.',
      '',
      'Peter Long',
    ].join('\n'),
  },
  {
    label: 'Referral withdrawn – placed elsewhere',
    audience: 'Social worker · withdraws a referral sent earlier',
    subject: 'RE: Referral – no longer required',
    fromName: 'Sam Okoro (TEST)',
    fromEmail: 'sam.okoro@example-council.test',
    body: [
      'Dear team,',
      '',
      'Please disregard the referral I sent last week for Mr Arthur Bell (TEST), DOB 02/03/1941, CR8 2AA.',
      'The package has now been placed with another provider, so it is no longer required.',
      '',
      'Thank you,',
      'Sam Okoro, Social Worker (TEST)',
    ].join('\n'),
  },
  {
    label: 'Discharge to assess, start tomorrow (Merton)',
    audience: 'Hospital discharge hub · double-handed · very short notice',
    subject: 'D2A Pathway 1 – Mr Leonard Shaw – discharge tomorrow',
    fromName: 'Discharge Hub (TEST)',
    fromEmail: 'discharge.hub@example-hospital.test',
    body: [
      'Pathway 1 discharge to assess referral.',
      '',
      'Patient: Leonard Shaw, DOB 11/11/1936. Address: 6 London Road, Morden SM4 5DX.',
      'Discharge planned tomorrow. Requires 3 calls daily, 2 carers each (stand aid): 08:30 (45 min), 13:00 (30 min), 19:30 (30 min).',
      'Funding: Merton Council D2A for 4 weeks, then reassessment.',
      'Please reply with your earliest start date.',
      '',
      'Discharge Hub, St Elsewhere Hospital (TEST)',
    ].join('\n'),
  },
  {
    label: 'Self-funder quote, carers free (Hammersmith)',
    audience: 'Son · private · clear pattern in a branch with free carers · quote attached',
    subject: 'Prices and a quote for my mother',
    fromName: 'Robert Lane (TEST)',
    fromEmail: 'robert.lane@example-family.test',
    body: [
      'Hello,',
      '',
      'My mother, Mrs Dorothy Lane (born 14 May 1941), lives on her own at 4 Fulham Palace Road, London W6 9JU.',
      'She needs help with a shower, getting dressed and some light housework.',
      'We would like a one-hour visit at 10am on Mondays, Wednesdays and Fridays, starting on 1 December. We will pay privately.',
      'Could you send us a quote, please?',
      '',
      'Thank you,',
      'Robert Lane',
      '07700 900456',
    ].join('\n'),
  },
  {
    label: 'Very detailed council support plan (Hammersmith)',
    audience: 'Brokerage team · full support plan and discharge summary · every section filled in',
    subject: 'Package of care request – PKG-TEST-30418 – Mr Arthur Pennington – reply by 4pm Thursday',
    fromName: 'Home Care Brokerage (TEST)',
    fromEmail: 'brokerage@example-council.test',
    body: [
      'Dear Provider,',
      '',
      'Hammersmith and Fulham Council is seeking a home care provider for the package below. The full Care and Support Plan',
      'and the hospital discharge summary are attached. Please reply by 4pm on Thursday saying whether you can accept,',
      'your earliest start date and your rate.',
      '',
      'Package reference: PKG-TEST-30418. Type: long-term home care following a period of reablement.',
      'Funding: Hammersmith and Fulham Council, framework rate £24.50 per hour.',
      'Start: on discharge, planned for 1 December 2026.',
      '',
      'Kind regards,',
      'Lena Okafor',
      'Brokerage Officer, Adult Social Care (TEST)',
      '020 7946 0322',
    ].join('\n'),
    carePlan: {
      title: 'Care and Support Plan – Arthur Pennington (TEST)',
      lines: [
        'SECTION 1 – PERSONAL INFORMATION',
        'Name: Arthur James Pennington. Known as: Jim. Date of birth: 03/09/1940. NHS number: 943 476 5920 (test).',
        'Gender: male. Ethnicity: White British. Religion: Roman Catholic – would like to watch Sunday Mass on TV.',
        'First language: English. Hard of hearing in the left ear; wears a hearing aid in the right ear. Wears glasses for reading.',
        'Home address: Flat 3, 22 Margravine Gardens, London W6 8RL (first floor, lift in the building).',
        'Currently on Ward 9 (Elderly Care), Charing Cross Hospital. Planned discharge: 01/12/2026.',
        '',
        'SECTION 2 – HOUSEHOLD AND SUPPORT NETWORK',
        'Lives with his wife, Margaret Pennington (84), who is frail and cannot help with personal care or transfers.',
        'Next of kin: Susan Clarke (daughter), 07700 900789, susan.clarke@example-family.test – visits twice a week, holds LPA for health and welfare.',
        'Son, David Pennington, lives abroad – no involvement.',
        'Unpaid carer: Margaret (wife) – provides company and prepares drinks.',
        '',
        'SECTION 3 – PROFESSIONALS INVOLVED',
        'GP: Dr Anika Shah, Brook Green Medical Centre, 020 7946 0555.',
        'Social worker: Tom Reilly, Hammersmith and Fulham Adult Social Care, 020 7946 0377, tom.reilly@example-council.test.',
        'District nurses: Hammersmith Community Nursing Team, 020 7946 0600 – twice weekly for a grade 2 pressure ulcer on the sacrum.',
        'Occupational therapist: Grace Mensah, Charing Cross Hospital – home visit completed, equipment ordered.',
        '',
        'SECTION 4 – DIAGNOSIS AND HEALTH',
        'Primary diagnosis: Parkinson\'s disease (diagnosed 2018). Other: type 2 diabetes (diet controlled), heart failure, mild vascular dementia.',
        'Prognosis: long-term condition, slowly deteriorating. Jim and his family are aware.',
        'Resuscitation: DNACPR in place (ReSPECT form dated 20/11/2026, kept in the red folder by the front door).',
        'Allergies: penicillin (rash), elastoplast.',
        'Continence: doubly incontinent at night; wears pull-up pads; needs prompting to use the toilet during the day.',
        'Skin: grade 2 pressure ulcer on sacrum, district nurse dressing twice weekly; reposition every 3–4 hours in bed; pressure-relieving mattress and cushion.',
        'Nutrition: soft and bite-sized diet (IDDSI level 6), fluids thickened to level 1 following SALT assessment; needs set-up and encouragement; weight loss of 4 kg in 3 months – please record food and fluid intake.',
        'Memory: forgets recent events; can become confused in the late afternoon.',
        '',
        'SECTION 5 – MEDICATION',
        'Medication support: carers to ADMINISTER all medication from a pharmacy blister pack (MAR chart provided by the pharmacy).',
        'Co-careldopa 25/100 – one tablet at 08:00, 12:00, 16:00 and 20:00. TIME-CRITICAL: must be given within 30 minutes of the time.',
        'Bisoprolol 2.5 mg at 08:00. Furosemide 40 mg at 08:00. Paracetamol 1 g up to four times a day as needed (PRN).',
        'Daughter orders repeat prescriptions; Brook Green Pharmacy delivers.',
        'No medicines need a nurse. Barrier cream to sacrum after each pad change.',
        '',
        'SECTION 6 – MOBILITY AND MOVING AND HANDLING',
        'Mobility: unable to walk safely; falls x3 in hospital. Uses a wheelchair pushed by others.',
        'Transfers: full hoist with 2 carers for all transfers (bed, chair, commode). Moving and handling risk assessment completed by OT and attached to the hospital records.',
        'Equipment: ceiling track hoist – being installed 28/11/2026; medium full-body sling x2 – on order; profiling bed – in place; air pressure mattress – in place; pressure cushion – in place; commode – in place; pendant alarm – in place.',
        '',
        'SECTION 7 – COMMUNICATION, BEHAVIOUR AND DAILY LIVING',
        'Communication: speech is quiet and slow because of Parkinson\'s; give him time, use closed questions when he is tired.',
        'Behaviour: can become anxious and call out in the late afternoon; reassure, offer a cup of tea and his music.',
        'Personal care: full strip wash in bed each morning, shave with electric razor, dress in day clothes, hair and teeth.',
        'Meals: carers to prepare breakfast, lunch and tea; Margaret makes hot drinks.',
        'Domestic: carers to empty commode, change bed linen twice a week, put washing in the machine.',
        '',
        'SECTION 8 – MENTAL CAPACITY, CONSENT AND SAFEGUARDING',
        'Capacity: Jim has capacity for day-to-day decisions; a best-interests decision was made about the hoist on 18/11/2026.',
        'Consent: Jim agreed to this referral and to information being shared with the provider.',
        'Legal: daughter holds LPA (health and welfare). No DoLS.',
        'Safeguarding: no current concerns.',
        '',
        'SECTION 9 – HOME ENVIRONMENT AND ACCESS',
        'Access: key safe by the front door – code 4821 (to be confirmed by phone). Margaret can answer the door in the daytime.',
        'Pets: one elderly cat – no risk.',
        'Environment: heating and hot water working; Margaret smokes on the balcony; resident parking permits needed (council can supply).',
        '',
        'SECTION 10 – SCHEDULE OF CARE (all days unless stated)',
        'Morning 08:00 – 60 minutes – 2 carers: hoist out of bed, strip wash, dress, breakfast, give 08:00 medication, empty commode.',
        'Lunch 12:00 – 30 minutes – 1 carer: prepare lunch, give 12:00 co-careldopa, record food and fluid.',
        'Tea 16:00 – 45 minutes – 2 carers: hoist to commode and back, pad change, give 16:00 co-careldopa, prepare tea.',
        'Bed 20:00 – 45 minutes Monday to Friday, 2 carers: pad change, hoist to bed, reposition, give 20:00 medication.',
        'Bed 20:00 – 45 minutes Saturday and Sunday, 2 carers: as weekdays, and change bed linen on Sunday.',
        'Total: about 19 hours a week of carer time.',
        '',
        'SECTION 11 – OUTCOMES AND WHAT MATTERS TO JIM',
        'Outcomes: to stay at home with Margaret; to have no further pressure damage; to keep his weight stable; to get out to the garden square in good weather.',
        'What matters: likes the radio (Classic FM) in the morning, black coffee, Fulham FC on Saturdays. Dislikes being rushed.',
        'Current care: reablement (Hammersmith Reablement Service) ended because he needs long-term double-handed care. No previous provider.',
      ],
    },
    discharge: {
      title: 'Hospital Discharge Summary – Charing Cross Hospital (TEST)',
      lines: [
        'Patient: Arthur Pennington, DOB 03/09/1940, NHS 943 476 5920 (test). Ward 9.',
        'Admitted 02/11/2026 with a fall and aspiration pneumonia, treated with antibiotics (clarithromycin, penicillin allergy).',
        'Seen by SALT: IDDSI level 6 diet, level 1 thickened fluids. Seen by OT and physiotherapy: full hoist with 2 carers.',
        'Discharge planned 01/12/2026 home to wife, with a package of 4 calls a day once the ceiling hoist is installed.',
        'District nurse referral sent for the sacral pressure ulcer.',
      ],
    },
  },
];

async function docxBuffer(title: string, lines: string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(title)] }),
          ...lines.map((l) => new Paragraph({ children: [new TextRun(l)] })),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

function pdfBuffer(title: string, lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text(title).moveDown();
    doc.fontSize(11);
    for (const l of lines) doc.text(l).moveDown(0.5);
    doc.end();
  });
}

function b64Lines(buf: Buffer): string {
  return buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
}

/** The made-up scenarios, for the "Add a test referral" menu. */
export const TEST_REFERRAL_SCENARIOS = SCENARIOS.map((s, index) => ({ index, label: s.label, audience: s.audience }));

/** A raw RFC 822 message (with attachments) for Gmail insert or send, as base64url. */
export async function buildTestReferralRaw(
  toEmail: string,
  scenarioIndex: number,
  opts: { subjectPrefix?: string } = {},
): Promise<{
  raw: string;
  mime: string;
  subject: string;
  /** The same email as parts, for sending a copy through the app's mail service. */
  fromName: string;
  fromEmail: string;
  body: string;
  files: Array<{ filename: string; contentType: string; content: Buffer }>;
}> {
  const s = SCENARIOS[Math.abs(scenarioIndex) % SCENARIOS.length];
  const boundary = `careflow-test-${Date.now()}`;
  const slug = (t: string) => t.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const files: Array<{ filename: string; contentType: string; content: Buffer }> = [];
  if (s.carePlan) {
    files.push({
      filename: `${slug(s.carePlan.title)}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      content: await docxBuffer(s.carePlan.title, s.carePlan.lines),
    });
  }
  if (s.discharge) {
    files.push({ filename: `${slug(s.discharge.title)}.pdf`, contentType: 'application/pdf', content: await pdfBuffer(s.discharge.title, s.discharge.lines) });
  }
  const attachments = files.flatMap((f) => [
    `--${boundary}`,
    `Content-Type: ${f.contentType}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${f.filename}"`,
    '',
    b64Lines(f.content),
  ]);
  const parts = [
    `From: "${s.fromName}" <${s.fromEmail}>`,
    `To: ${toEmail}`,
    // Non-ASCII header text (e.g. an en dash) must be RFC 2047 encoded.
    `Subject: =?UTF-8?B?${Buffer.from(`${opts.subjectPrefix ?? '[TEST]'} ${s.subject}`, 'utf8').toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <test-${randomUUID()}@careflow.test>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(Buffer.from(s.body, 'utf8')),
    ...attachments,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return {
    raw: Buffer.from(parts, 'utf8').toString('base64url'),
    mime: parts,
    subject: s.subject,
    fromName: s.fromName,
    fromEmail: s.fromEmail,
    body: s.body,
    files,
  };
}
