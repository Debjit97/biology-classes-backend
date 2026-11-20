import {
  createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual,
} from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function buildOtpAuthUri(email: string, secret: string): string {
  const issuer = 'BIOLOGY CLASSES by J.C. SIR';
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export function encryptMfaSecret(secret: string, keyHex: string): string {
  const key = parseEncryptionKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptMfaSecret(payload: string, keyHex: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unsupported encrypted MFA secret format.');
  const key = parseEncryptionKey(keyHex);
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Encrypted MFA secret is malformed.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Returns the matching 30-second counter (including +/- one clock step), or null. */
export function verifyTotp(secret: string, code: string, nowMs = Date.now()): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
  for (const step of [current - 1, current, current + 1]) {
    const expected = totpAt(secret, step);
    const expectedBytes = Buffer.from(expected, 'ascii');
    const suppliedBytes = Buffer.from(code, 'ascii');
    if (expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)) {
      return BigInt(step);
    }
  }
  return null;
}

function totpAt(secret: string, counter: number): string {
  const key = decodeBase32(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
}

function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error('Invalid Base32 secret.');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of normalized) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function parseEncryptionKey(keyHex: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) {
    throw new Error('MFA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).');
  }
  return Buffer.from(keyHex, 'hex');
}
