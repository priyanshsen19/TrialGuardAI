import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-pipe';
import { DossierService } from '../audit/dossier.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, type AuthUser } from '../auth/roles';
import { ScreeningsService } from './screenings.service';

const CreateScreeningSchema = z
  .object({
    trialId: z.string().min(3).max(64),
    patientId: z.string().min(3).max(64),
    screeningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

const ReviewSchema = z
  .object({
    action: z.enum(['APPROVE_ELIGIBLE', 'APPROVE_INELIGIBLE', 'REQUEST_MORE_INFORMATION', 'REQUIRE_ADDITIONAL_REVIEW']),
    reason: z.string().trim().min(10, 'reviewer must enter a reason (at least 10 characters)').max(2000),
  })
  .strict();

const IdemKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/).optional();

@Controller('screenings')
export class ScreeningsController {
  constructor(
    private readonly screenings: ScreeningsService,
    private readonly dossier: DossierService,
  ) {}

  @Post()
  @Roles('COORDINATOR')
  create(@Body(new ZodPipe(CreateScreeningSchema)) body: z.infer<typeof CreateScreeningSchema>, @CurrentUser() user: AuthUser, @Headers('idempotency-key') idem?: string) {
    return this.screenings.create(body, user, new ZodPipe(IdemKey).transform(idem));
  }

  @Get()
  list(@Query('decision') decision?: string, @Query('status') status?: string) {
    const d = z.enum(['ELIGIBLE', 'INELIGIBLE', 'REQUIRES_HUMAN_OVERVIEW']).optional().safeParse(decision || undefined);
    const s = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']).optional().safeParse(status || undefined);
    return this.screenings.list({ decision: d.success ? d.data : undefined, status: s.success ? s.data : undefined });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.screenings.get(id);
  }

  @Get(':id/timeline')
  timeline(@Param('id', ParseUUIDPipe) id: string) {
    return this.screenings.timeline(id);
  }

  @Get(':id/evidence')
  evidence(@Param('id', ParseUUIDPipe) id: string) {
    return this.screenings.evidence(id);
  }

  @Post(':id/review')
  @Roles('REVIEWER')
  review(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReviewSchema)) body: z.infer<typeof ReviewSchema>, @CurrentUser() user: AuthUser, @Headers('idempotency-key') idem?: string) {
    return this.screenings.review(id, body, user, new ZodPipe(IdemKey).transform(idem));
  }

  @Get(':id/dossier.json')
  async dossierJson(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const d = await this.dossier.latest(id, 'json');
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="trialguard-dossier-${id}-v${d.version}.json"`);
    res.setHeader('x-dossier-sha256', d.sha256);
    res.send(d.buffer);
  }

  @Get(':id/dossier')
  async dossierPdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const d = await this.dossier.latest(id, 'pdf');
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="trialguard-dossier-${id}-v${d.version}.pdf"`);
    res.setHeader('x-dossier-sha256', d.sha256);
    res.send(d.buffer);
  }
}
