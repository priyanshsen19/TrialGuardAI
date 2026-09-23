import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { KnownIdentifiers, PhiPort, RawDocument, RedactedDocument } from '@trialguard/agents';
import { decrypt, encrypt, KeyRing } from '../common/crypto';
import { loadConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { PhiRedactor, summarize, type KnownPhi, type PhiReplacement } from './phi-redactor';

/**
 * PHI service: redaction before inference + encrypted alias vault.
 *
 * The vault (alias → AES-256-GCM ciphertext) is stored in PhiVaultEntry and is
 * never returned by any API, never logged, never included in audit payloads or
 * dossiers, and never sent to Lyzr / AIMS.
 */
@Injectable()
export class PhiService implements PhiPort {
  private readonly keys: KeyRing;
  readonly redactor: PhiRedactor;
  /** Vault scope + known identifiers for the current async operation. */
  private readonly scopeStore = new AsyncLocalStorage<{ scope: string; known?: KnownPhi }>();

  constructor(private readonly prisma: PrismaService) {
    this.keys = new KeyRing(loadConfig().masterKey);
    this.redactor = new PhiRedactor(this.keys.phiAliasKey);
  }

  /** Bound residual scanner handed to Safe AI (blocks any call that still contains a known identifier). */
  residualScanner = (text: string): Array<{ category: string }> => {
    const ctx = this.scopeStore.getStore();
    return ctx?.known ? this.redactor.residualScan(text, ctx.known) : [];
  };

  /** Run an extraction inside a vault scope: redactions are persisted there and residual scanning covers `known`. */
  runInScope<T>(scope: string, known: KnownPhi | undefined, fn: () => Promise<T>): Promise<T> {
    return this.scopeStore.run({ scope, known }, fn);
  }

  async redact(docs: RawDocument[], known?: KnownIdentifiers): Promise<{ documents: RedactedDocument[]; summary: { totalRedactions: number; byCategory: Record<string, number> } }> {
    const ctx = this.scopeStore.getStore();
    const ids: KnownPhi | undefined = (known as KnownPhi | undefined) ?? ctx?.known;
    const all: PhiReplacement[] = [];
    const documents = docs.map((d) => ({
      // document names can carry identifiers too
      documentName: this.redactor.redact(d.documentName, ids).text,
      pages: d.pages.map((p) => {
        const r = this.redactor.redact(p.text, ids);
        all.push(...r.replacements);
        return { page: p.page, text: r.text };
      }),
    }));
    if (ctx) await this.store(ctx.scope, all);
    return { documents, summary: summarize(all) };
  }

  async store(scope: string, replacements: PhiReplacement[]) {
    const unique = new Map(replacements.map((r) => [r.alias, r]));
    for (const r of unique.values()) {
      await this.prisma.phiVaultEntry.upsert({
        where: { scope_alias: { scope, alias: r.alias } },
        create: { scope, alias: r.alias, category: r.category, ciphertext: encrypt(this.keys.phiVaultKey, r.original, `${scope}:${r.alias}`) },
        update: {},
      });
    }
  }

  /** Store the full identity record (demographics) encrypted in the vault. */
  async storeIdentity(scope: string, known: KnownPhi) {
    const ciphertext = encrypt(this.keys.phiVaultKey, JSON.stringify(known), `identity:${scope}`);
    await this.prisma.phiVaultEntry.upsert({
      where: { scope_alias: { scope, alias: 'IDENTITY_RECORD' } },
      create: { scope, alias: 'IDENTITY_RECORD', category: 'IDENTITY_RECORD', ciphertext },
      update: { ciphertext },
    });
  }

  /** Server-side only: used to derive age and for residual scanning. Never returned by any API. */
  async loadIdentity(scope: string): Promise<KnownPhi | null> {
    const row = await this.prisma.phiVaultEntry.findUnique({ where: { scope_alias: { scope, alias: 'IDENTITY_RECORD' } } });
    return row ? (JSON.parse(decrypt(this.keys.phiVaultKey, row.ciphertext, `identity:${scope}`).toString('utf8')) as KnownPhi) : null;
  }

  async vaultStats(scope: string) {
    const rows = await this.prisma.phiVaultEntry.groupBy({ by: ['category'], where: { scope }, _count: true });
    return Object.fromEntries(rows.map((r: { category: string; _count: number }) => [r.category, r._count]));
  }
}
