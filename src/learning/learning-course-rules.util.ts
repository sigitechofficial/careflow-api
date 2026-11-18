import { LearningCourseType, LearningDeliveryMethod } from '@prisma/client';

/**
 * Course types a NEW course can use, and the delivery methods allowed for each
 * (agreed 12 Nov 2026). Other types (POLICY, CLASSROOM, WEBINAR, BLENDED, EXTERNAL_TRAINING)
 * stay in the enum for existing data but cannot be chosen for new courses.
 */
export const COURSE_TYPE_DELIVERY_METHODS: Partial<
  Record<LearningCourseType, LearningDeliveryMethod[]>
> = {
  // One "Course type" in the admin (17 Nov 2026): Online, Face to face or Workplace. Virtual and
  // Blended are retired; Assessment only / Practical stay for existing courses only.
  [LearningCourseType.COURSE]: [
    LearningDeliveryMethod.ONLINE,
    LearningDeliveryMethod.FACE_TO_FACE,
    LearningDeliveryMethod.WORKPLACE,
  ],
  [LearningCourseType.ASSESSMENT]: [LearningDeliveryMethod.ONLINE],
  [LearningCourseType.PRACTICAL_COMPETENCY]: [
    LearningDeliveryMethod.WORKPLACE,
    LearningDeliveryMethod.FACE_TO_FACE,
  ],
};

export function isCreatableCourseType(type: LearningCourseType): boolean {
  return COURSE_TYPE_DELIVERY_METHODS[type] !== undefined;
}

/** Null when the pair is allowed, else a message for the admin. */
export function courseTypeDeliveryError(
  type: LearningCourseType,
  method: LearningDeliveryMethod,
): string | null {
  const allowed = COURSE_TYPE_DELIVERY_METHODS[type];
  if (!allowed) return 'This course type can no longer be used for new courses';
  if (!allowed.includes(method))
    return 'This delivery method is not available for the chosen course type';
  return null;
}

/**
 * Next free code for a category: "<CATEGORY CODE>-<3-digit number>", e.g. SAFEGUARDING-001.
 * Looks only at existing codes with the same prefix and a numeric suffix.
 */
export function nextCourseCode(
  prefix: string,
  existingCodes: string[],
): string {
  const head = `${prefix.trim().toUpperCase()}-`;
  let max = 0;
  for (const code of existingCodes) {
    const upper = code.trim().toUpperCase();
    if (!upper.startsWith(head)) continue;
    const tail = upper.slice(head.length);
    if (/^\d+$/.test(tail)) max = Math.max(max, Number(tail));
  }
  return `${head}${String(max + 1).padStart(3, '0')}`;
}
