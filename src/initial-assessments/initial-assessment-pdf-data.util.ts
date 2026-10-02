import { Prisma } from '@prisma/client';
import {
  formatInitialAssessmentAnswerForExport,
  isAnsweredForExport,
} from './initial-assessment-answer-format.util';
import { parseStoredClinicalMetadata } from './initial-assessment-clinical.util';
import { buildSignOffSnapshot, type SignOffSnapshot } from './initial-assessment-sign-off.util';
import { adlDependencyBand, adlTotalFromMetadata } from './initial-assessment-adl.util';
import { waterlowScoreFromMetadata } from './initial-assessment-validation.util';

export type InitialAssessmentPdfSection = {
  sectionNumber: number;
  title: string;
  rows: { questionText: string; answerText: string; specRef?: string }[];
};

export type InitialAssessmentPdfData = {
  organisationName?: string | null;
  organisationLogoUrl?: string | null;
  companyLegalName?: string | null;
  productBrandName?: string | null;
  serviceUserName: string;
  serviceUserNumber: string | null;
  dateOfBirth: string | null;
  templateName: string;
  templateVersion: number;
  submissionId: string;
  status: string;
  assessmentReason: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  generatedAt: string;
  generatedBy: string | null;
  includeSecureFields: boolean;
  sections: InitialAssessmentPdfSection[];
  consentSummary: string[];
  safeguardingSummary: string[];
  waterlowScore: number | null;
  adlTotal: number | null;
  adlDependency: string | null;
  vitalsSummary: string[];
  fallsSummary: string[];
  medicationSummary: string[];
  openActions: { title: string; priority: string; status: string; dueDate: string | null }[];
  risks: { description: string; riskLevel: string; riskType: string }[];
  signOff: SignOffSnapshot;
  managerReview: {
    required: boolean;
    approvedForCareStart: boolean;
    conditions: string | null;
  };
};

function metaString(q: { metadata: Prisma.JsonValue }, key: string): string | undefined {
  if (!q.metadata || typeof q.metadata !== 'object' || Array.isArray(q.metadata)) return undefined;
  const v = (q.metadata as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

function findAnswerText(
  questions: {
    questionText: string;
    questionType: string;
    options: Prisma.JsonValue;
    metadata: Prisma.JsonValue;
    id: string;
  }[],
  answers: Map<string, {
    checked: boolean | null;
    booleanValue: boolean | null;
    textValue: string | null;
    numberValue: Prisma.Decimal | null;
    dateValue: Date | null;
    selectedOptions: Prisma.JsonValue;
  }>,
  fragment: string,
  includeSecureFields: boolean,
): string | null {
  const q = questions.find((row) => row.questionText.toLowerCase().includes(fragment.toLowerCase()));
  if (!q) return null;
  return formatInitialAssessmentAnswerForExport(q, answers.get(q.id), { includeSecureFields });
}

export function buildInitialAssessmentPdfData(params: {
  organisationName?: string | null;
  organisationLogoUrl?: string | null;
  companyLegalName?: string | null;
  productBrandName?: string | null;
  serviceUser: {
    firstName: string;
    lastName: string;
    preferredName: string | null;
    serviceUserNumber: string | null;
    dateOfBirth: Date | null;
  };
  template: { name: string; version: number };
  submission: {
    id: string;
    status: string;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    reviewNotes: string | null;
    metadata: Prisma.JsonValue;
  };
  submittedByName: string | null;
  reviewedByName: string | null;
  generatedByName: string | null;
  includeSecureFields: boolean;
  sectionRows: {
    sectionNumber: number;
    title: string;
    questions: {
      id: string;
      questionText: string;
      questionType: string;
      options: Prisma.JsonValue;
      metadata: Prisma.JsonValue;
      sortOrder: number;
    }[];
  }[];
  answers: {
    questionId: string;
    checked: boolean | null;
    booleanValue: boolean | null;
    textValue: string | null;
    numberValue: Prisma.Decimal | null;
    dateValue: Date | null;
    selectedOptions: Prisma.JsonValue;
  }[];
  actions: {
    title: string;
    priority: string;
    status: string;
    dueDate: Date | null;
  }[];
  risks: {
    description: string;
    riskLevel: string;
    riskType: string;
  }[];
  signOffQuestions: {
    id: string;
    questionText: string;
    metadata: Prisma.JsonValue;
  }[];
}): InitialAssessmentPdfData {
  const answerMap = new Map(params.answers.map((a) => [a.questionId, a]));
  const allQuestions = params.sectionRows.flatMap((s) => s.questions);
  const meta =
    params.submission.metadata && typeof params.submission.metadata === 'object' && !Array.isArray(params.submission.metadata)
      ? (params.submission.metadata as Record<string, unknown>)
      : {};
  const clinical = parseStoredClinicalMetadata(params.submission.metadata);

  const sections: InitialAssessmentPdfSection[] = params.sectionRows.map((sec) => {
    const rows = sec.questions
      .filter((q) => isAnsweredForExport(q, answerMap.get(q.id)))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((q) => ({
        questionText: q.questionText,
        answerText:
          formatInitialAssessmentAnswerForExport(q, answerMap.get(q.id), {
            includeSecureFields: params.includeSecureFields,
          }) ?? '—',
        specRef: metaString(q, 'specRef'),
      }));
    return { sectionNumber: sec.sectionNumber, title: sec.title, rows };
  });

  const wlScore = waterlowScoreFromMetadata(params.submission.metadata);
  const adlTotal = adlTotalFromMetadata(params.submission.metadata);
  const adlDependency = adlTotal != null ? adlDependencyBand(adlTotal) : null;

  const vitalsSummary: string[] = [];
  const readings = clinical.vitals?.readings;
  if (readings) {
    if (readings.temperature != null) vitalsSummary.push(`Temperature: ${readings.temperature} °C`);
    if (readings.pulse != null) vitalsSummary.push(`Pulse: ${readings.pulse} bpm`);
    if (readings.respirations != null) vitalsSummary.push(`Respirations: ${readings.respirations} /min`);
    if (readings.bpSystolic != null && readings.bpDiastolic != null) {
      vitalsSummary.push(`Blood pressure: ${readings.bpSystolic}/${readings.bpDiastolic} mmHg`);
    }
    if (readings.spo2 != null) vitalsSummary.push(`SpO₂: ${readings.spo2}%`);
    if (readings.bloodGlucose != null) vitalsSummary.push(`Blood glucose: ${readings.bloodGlucose} mmol/L`);
  }

  const fallsSummary: string[] = [];
  if (clinical.falls) {
    if (clinical.falls.fallsLast12Months != null) {
      fallsSummary.push(`Falls in last 12 months: ${clinical.falls.fallsLast12Months ? 'Yes' : 'No'}`);
    }
    if (clinical.falls.numberOfFalls != null) fallsSummary.push(`Number of falls: ${clinical.falls.numberOfFalls}`);
    const finding = clinical.falls.caseFinding;
    if (finding && finding.status !== 'pending') {
      const label =
        finding.status === 'required'
          ? 'Multifactorial falls assessment indicated'
          : finding.status === 'suggested'
            ? 'Falls assessment suggested'
            : 'Falls assessment not needed (negative case-finding)';
      fallsSummary.push(finding.reasons.length ? `${label}: ${finding.reasons.join(', ')}` : label);
    }
    // Snapshots stored before case-finding carried a numeric score — shown as history only.
    if (clinical.falls.riskLevel) {
      fallsSummary.push(
        `Legacy falls score (no longer used to predict falls): ${clinical.falls.riskLevel} (${clinical.falls.riskScore})`,
      );
    }
    if (clinical.falls.assessmentCompleted != null) {
      fallsSummary.push(`Falls assessment completed: ${clinical.falls.assessmentCompleted ? 'Yes' : 'No'}`);
    }
  }

  const medicationSummary: string[] = [];
  if (clinical.medications) {
    medicationSummary.push(`Medications captured: ${clinical.medications.itemCount}`);
    medicationSummary.push(`List verified: ${clinical.medications.verified ? 'Yes' : 'No'}`);
    for (const med of clinical.medications.items.slice(0, 25)) {
      medicationSummary.push(`• ${med.medicationName}${med.dose ? ` — ${med.dose}` : ''} (${med.status})`);
    }
    if (clinical.medications.items.length > 25) {
      medicationSummary.push(`… and ${clinical.medications.items.length - 25} more`);
    }
  }

  const consentSummary = [
    findAnswerText(allQuestions, answerMap, 'consent to assessment', params.includeSecureFields),
    findAnswerText(allQuestions, answerMap, 'consent to receive care', params.includeSecureFields),
    findAnswerText(allQuestions, answerMap, 'capacity to make decisions', params.includeSecureFields),
    findAnswerText(allQuestions, answerMap, 'mca completed', params.includeSecureFields),
  ]
    .filter(Boolean)
    .map((line, i) => {
      const labels = ['Consent to assessment', 'Consent to receive care', 'Capacity intact', 'MCA completed'];
      return `${labels[i] ?? 'Item'}: ${line}`;
    });

  const safeguardingSummary = [
    findAnswerText(allQuestions, answerMap, 'safeguarding concerns identified', params.includeSecureFields),
    findAnswerText(allQuestions, answerMap, 'safeguarding concern details', params.includeSecureFields),
    findAnswerText(allQuestions, answerMap, 'emergency contact 1', params.includeSecureFields),
  ]
    .filter(Boolean)
    .map((line, i) => {
      const labels = ['Safeguarding concern', 'Concern details', 'Emergency contact recorded'];
      return `${labels[i] ?? 'Item'}: ${line}`;
    });

  const signOff = buildSignOffSnapshot({
    questions: params.signOffQuestions,
    answers: params.answers,
    submittedAt: params.submission.submittedAt,
  });

  const displayName = [params.serviceUser.preferredName ?? params.serviceUser.firstName, params.serviceUser.lastName]
    .filter(Boolean)
    .join(' ');

  return {
    organisationName: params.organisationName,
    organisationLogoUrl: params.organisationLogoUrl ?? null,
    companyLegalName: params.companyLegalName ?? null,
    productBrandName: params.productBrandName ?? 'CareAdmin',
    serviceUserName: displayName,
    serviceUserNumber: params.serviceUser.serviceUserNumber,
    dateOfBirth: params.serviceUser.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    templateName: params.template.name,
    templateVersion: params.template.version,
    submissionId: params.submission.id,
    status: params.submission.status,
    assessmentReason: findAnswerText(allQuestions, answerMap, 'assessment reason', params.includeSecureFields),
    submittedAt: params.submission.submittedAt?.toISOString() ?? null,
    submittedBy: params.submittedByName,
    reviewedAt: params.submission.reviewedAt?.toISOString() ?? null,
    reviewedBy: params.reviewedByName,
    reviewNotes: params.submission.reviewNotes,
    generatedAt: new Date().toISOString(),
    generatedBy: params.generatedByName,
    includeSecureFields: params.includeSecureFields,
    sections,
    consentSummary,
    safeguardingSummary,
    waterlowScore: wlScore > 0 ? wlScore : null,
    adlTotal,
    adlDependency,
    vitalsSummary,
    fallsSummary,
    medicationSummary,
    openActions: params.actions.map((a) => ({
      title: a.title,
      priority: a.priority,
      status: a.status,
      dueDate: a.dueDate?.toISOString().slice(0, 10) ?? null,
    })),
    risks: params.risks,
    signOff,
    managerReview: {
      required: meta.managerReviewRequired === true,
      approvedForCareStart: meta.approvedForCareStart === true,
      conditions: typeof meta.careStartConditions === 'string' ? meta.careStartConditions : null,
    },
  };
}
