export function formatVacancyReference(recordNo: number): string {
  return `VAC-${String(recordNo).padStart(4, '0')}`;
}

export function formatCandidateReference(recordNo: number): string {
  return `CAN-${String(recordNo).padStart(4, '0')}`;
}
