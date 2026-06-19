import { MedicationAdministrationStatus, MedicationStatusCodeCategory, MedicationStatusCodeFieldRequirement } from '@prisma/client';
export type MedicationStatusCodeSeedRow = {
    code: string;
    label: string;
    color: string;
    textColor: string;
    category: MedicationStatusCodeCategory;
    administrationStatus: MedicationAdministrationStatus;
    reasonRequirement: MedicationStatusCodeFieldRequirement;
    managerReviewRequirement: MedicationStatusCodeFieldRequirement;
    sortOrder: number;
};
export declare const DEFAULT_MEDICATION_STATUS_CODES: MedicationStatusCodeSeedRow[];
