import { LearningCourseType, LearningDeliveryMethod } from '@prisma/client';
import {
  courseTypeDeliveryError,
  isCreatableCourseType,
  nextCourseCode,
} from './learning-course-rules.util';

describe('learning-course-rules.util', () => {
  it('allows only the agreed type + delivery pairs', () => {
    expect(
      courseTypeDeliveryError(
        LearningCourseType.COURSE,
        LearningDeliveryMethod.ONLINE,
      ),
    ).toBeNull();
    expect(
      courseTypeDeliveryError(
        LearningCourseType.COURSE,
        LearningDeliveryMethod.WORKPLACE,
      ),
    ).toBeNull();
    // One course type (17 Nov 2026): Online, Face to face, Workplace; Blended and Virtual retired.
    expect(
      courseTypeDeliveryError(
        LearningCourseType.COURSE,
        LearningDeliveryMethod.BLENDED,
      ),
    ).not.toBeNull();
    expect(
      courseTypeDeliveryError(
        LearningCourseType.COURSE,
        LearningDeliveryMethod.FACE_TO_FACE,
      ),
    ).toBeNull();
    expect(
      courseTypeDeliveryError(
        LearningCourseType.COURSE,
        LearningDeliveryMethod.VIRTUAL,
      ),
    ).not.toBeNull();
    expect(
      courseTypeDeliveryError(
        LearningCourseType.ASSESSMENT,
        LearningDeliveryMethod.ONLINE,
      ),
    ).toBeNull();
    expect(
      courseTypeDeliveryError(
        LearningCourseType.ASSESSMENT,
        LearningDeliveryMethod.FACE_TO_FACE,
      ),
    ).not.toBeNull();
    expect(
      courseTypeDeliveryError(
        LearningCourseType.PRACTICAL_COMPETENCY,
        LearningDeliveryMethod.WORKPLACE,
      ),
    ).toBeNull();
    expect(
      courseTypeDeliveryError(
        LearningCourseType.PRACTICAL_COMPETENCY,
        LearningDeliveryMethod.ONLINE,
      ),
    ).not.toBeNull();
  });

  it('blocks retired types for new courses', () => {
    for (const t of [
      LearningCourseType.POLICY,
      LearningCourseType.CLASSROOM,
      LearningCourseType.WEBINAR,
      LearningCourseType.BLENDED,
      LearningCourseType.EXTERNAL_TRAINING,
    ]) {
      expect(isCreatableCourseType(t)).toBe(false);
      expect(
        courseTypeDeliveryError(t, LearningDeliveryMethod.ONLINE),
      ).not.toBeNull();
    }
  });

  it('suggests the next number for a category prefix', () => {
    expect(nextCourseCode('SAFEGUARDING', [])).toBe('SAFEGUARDING-001');
    expect(
      nextCourseCode('safeguarding', [
        'SAFEGUARDING-001',
        'safeguarding-007',
        'SAFEGUARDING-X',
        'FIRST_AID-009',
      ]),
    ).toBe('SAFEGUARDING-008');
  });
});
