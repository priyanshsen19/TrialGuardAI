import { Injectable } from '@nestjs/common';
import type { ClinicalFact, Criterion, OntologyPort, ResolvedCriterion, ResolvedFact } from '@trialguard/agents';
import { PrismaService } from '../prisma/prisma.service';
import { DICTIONARY } from './dictionary';
import { OntologyResolver } from './resolver';

@Injectable()
export class OntologyService implements OntologyPort {
  private readonly resolver = new OntologyResolver();
  readonly version = this.resolver.version;

  constructor(private readonly prisma: PrismaService) {}

  resolveCriteria(criteria: Criterion[]): ResolvedCriterion[] {
    return this.resolver.resolveCriteria(criteria);
  }

  resolveFacts(facts: ClinicalFact[]): ResolvedFact[] {
    return this.resolver.resolveFacts(facts);
  }

  /** Persist the mapping decision for a fact (reused across patients) and return its id. */
  async persistMapping(f: ResolvedFact): Promise<string> {
    const key = {
      sourceText: f.concept.display,
      proposedSystem: f.concept.system,
      proposedCode: f.concept.code ?? '',
      ontologyVersion: this.version,
    };
    const row = await this.prisma.ontologyMapping.upsert({
      where: { sourceText_proposedSystem_proposedCode_ontologyVersion: key },
      create: {
        ...key,
        system: f.resolution.concept?.system ?? null,
        code: f.resolution.concept?.code ?? null,
        display: f.resolution.concept?.display ?? null,
        status: f.resolution.status,
        method: f.resolution.method,
        confidence: f.resolution.mappingConfidence,
      },
      update: {},
    });
    return row.id;
  }

  dictionary() {
    return { version: this.version, entries: DICTIONARY.map(({ key, system, code, display, kind, classes }) => ({ key, system, code, display, kind, classes: classes ?? [] })) };
  }
}
