/**
 * Key-safe code ownership. The service user's Home & access record (`ServiceUserAddress.keySafeNumber`)
 * is the master and is what carers see. An IA answer is a proposal: it is applied only when the
 * manager reviews the assessment, only into an empty master, and never overwrites a different code.
 */
export type KeySafeProposal = 'none' | 'fill_master' | 'matches' | 'conflict';

function normalise(code: string | null | undefined): string {
  return (code ?? '').replace(/\s+/g, '').toLowerCase();
}

export function decideKeySafeProposal(
  iaCode: string | null | undefined,
  masterCode: string | null | undefined,
): KeySafeProposal {
  const ia = normalise(iaCode);
  if (!ia) return 'none';
  const master = normalise(masterCode);
  if (!master) return 'fill_master';
  return ia === master ? 'matches' : 'conflict';
}
