/** Shared HMRC submission list/detail fields for FPS + EPS (T20). */

export function hmrcSubmissionLifecycleFields(status: string, hasRequestXml: boolean) {
  let lifecycleStage: string
  switch (status) {
    case 'DRAFT_BUILT':
      lifecycleStage = 'DRAFT'
      break
    case 'PENDING_APPROVAL':
      lifecycleStage = 'AWAITING_APPROVAL'
      break
    case 'SUBMITTED':
      lifecycleStage = 'SUBMITTED'
      break
    case 'ACKNOWLEDGED':
      lifecycleStage = 'ACKNOWLEDGED'
      break
    case 'ACCEPTED':
      lifecycleStage = 'ACCEPTED'
      break
    case 'REJECTED':
    case 'REJECTED_APPROVAL':
    case 'ERROR':
      lifecycleStage = 'REJECTED'
      break
    default:
      lifecycleStage = status
  }

  return {
    lifecycleStage,
    canDownloadPayload: hasRequestXml,
    canRetry: status === 'ERROR' || status === 'REJECTED' || status === 'REJECTED_APPROVAL',
  }
}
