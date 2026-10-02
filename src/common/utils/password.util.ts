import * as bcrypt from 'bcrypt';

const DEFAULT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, DEFAULT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyPasswordHash: Promise<string> | undefined;

/**
 * Runs one bcrypt compare against a throwaway hash. Call on login failures that did not check a
 * real password (unknown / inactive account) so they take as long as a wrong password and response
 * timing does not reveal which accounts exist.
 */
export async function burnPasswordCompare(plain: string): Promise<void> {
  try {
    dummyPasswordHash ??= bcrypt.hash(
      'careflow-login-timing-equaliser',
      DEFAULT_ROUNDS,
    );
    await bcrypt.compare(String(plain ?? ''), await dummyPasswordHash);
  } catch {
    dummyPasswordHash = undefined; // timing only; never affect the login outcome
  }
}
