import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { loadConfig } from '../config/config';
import { Roles } from '../auth/roles';
import { ProtocolsService } from '../protocols/protocols.service';
import { TrialsService } from './trials.service';

const CreateTrialSchema = z
  .object({
    code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,30}$/, 'code must be uppercase letters, digits and dashes'),
    title: z.string().min(5).max(300),
    phase: z.string().min(1).max(20),
    sponsor: z.string().min(2).max(120),
    indication: z.string().min(2).max(120),
  })
  .strict();

const ProtocolTextSchema = z.object({ filename: z.string().min(1).max(120), text: z.string().min(20).max(2_000_000) }).strict();

@Controller('trials')
export class TrialsController {
  constructor(
    private readonly trials: TrialsService,
    private readonly protocols: ProtocolsService,
  ) {}

  @Post()
  @Roles('COORDINATOR')
  create(@Body(new ZodPipe(CreateTrialSchema)) body: z.infer<typeof CreateTrialSchema>) {
    return this.trials.create(body);
  }

  @Get()
  list() {
    return this.trials.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.trials.get(id);
  }

  /** Upload a protocol as multipart `file` (PDF or text) or JSON { filename, text }. */
  @Post(':id/protocol')
  @Roles('COORDINATOR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: loadConfig().maxUploadBytes, files: 1 } }))
  async uploadProtocol(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string } | undefined, @Req() req: Request) {
    if (file) return this.protocols.upload(id, { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype });
    const parsed = ProtocolTextSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'Provide a multipart "file" or JSON { filename, text }', 400);
    return this.protocols.upload(id, { buffer: Buffer.from(parsed.data.text, 'utf8'), originalname: parsed.data.filename, mimetype: 'text/plain' });
  }

  @Get(':id/criteria')
  criteria(@Param('id', ParseUUIDPipe) id: string) {
    return this.protocols.criteria(id);
  }
}
