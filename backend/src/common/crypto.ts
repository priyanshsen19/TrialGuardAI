import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Key ring derived from ENCRYPTION_MASTER_KEY via HKDF-SHA256.
 * Separate sub-keys for the PHI vault, PHI alias HMAC and document storage.
 */
export class KeyRing {
  readonly phiVaultKey: Buffer;
  readonly phiAliasKey: Buffer;
  readonly storageKey: Buffer;

  constructor(masterKey: Buffer) {
    if (masterKey.length < 32) throw new Error('ENCRYPTION_MASTER_KEY must be at least 32 bytes');
    const derive = (info: string) => Buffer.from(hkdfSync('sha256', masterKey, Buffer.from('trialguard-ai'), Buffer.from(info), 32));
    this.phiVaultKey = derive('phi-vault-v1');
    this.phiAliasKey = derive('phi-alias-v1');
    this.storageKey = derive('document-storage-v1');
  }
}

const VERSION = 'v1';

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(key: Buffer, plaintext: Buffer | string, aad = ''): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(key: Buffer, token: string, aad = ''): Buffer {
  const [v, iv, tag, ct] = token.split('.');
  if (v !== VERSION || !iv || !tag || ct === undefined) throw new Error('Unsupported ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]);
}

export function hmacHex(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}
