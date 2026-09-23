import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { decrypt, encrypt, KeyRing } from '../common/crypto';
import { sha256Hex } from '../common/canonical-json';
import { loadConfig } from '../config/config';

/**
 * Local object storage (content-addressed keys). Documents that may contain
 * PHI are encrypted at rest with AES-256-GCM; dossiers (PHI-free) are stored
 * in plaintext with their SHA-256 recorded in the database.
 * Swap for S3 Object Lock / WORM storage in production (see roadmap).
 */
@Injectable()
export class StorageService {
  private readonly root = resolve(loadConfig().storageDir);
  private readonly keys = new KeyRing(loadConfig().masterKey);

  private path(key: string) {
    if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes('..')) throw new Error('invalid storage key');
    return join(this.root, key);
  }

  async put(key: string, data: Buffer, opts: { encrypt: boolean }): Promise<{ key: string; sha256: string }> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, opts.encrypt ? Buffer.from(encrypt(this.keys.storageKey, data, key)) : data);
    return { key, sha256: sha256Hex(data) };
  }

  async get(key: string, opts: { encrypted: boolean }): Promise<Buffer> {
    const raw = await readFile(this.path(key));
    return opts.encrypted ? decrypt(this.keys.storageKey, raw.toString('utf8'), key) : raw;
  }
}
