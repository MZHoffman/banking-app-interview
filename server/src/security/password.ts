import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const KEY_LENGTH = 32;
const N = 2 ** 17;
const R = 8;
const P = 1;
const MAX_MEMORY = 256 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, { ...options, maxmem: MAX_MEMORY }, (error, res) => {
      if (error) reject(error);
      else resolve(res);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), derived.toString("base64")].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, nValue, rValue, pValue, saltValue, digestValue] = encoded.split("$");
  if (!algorithm || !nValue || !rValue || !pValue || !saltValue || !digestValue || algorithm !== "scrypt") {
    return false;
  }

  const salt = Buffer.from(saltValue, "base64");
  const expected = Buffer.from(digestValue, "base64");
  const actual = await derive(password, salt, expected.length, {
    N: Number(nValue),
    r: Number(rValue),
    p: Number(pValue),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
