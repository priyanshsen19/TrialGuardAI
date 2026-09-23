import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { Roles } from '../auth/roles';
import { PatientsService } from './patients.service';

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CreatePatientSchema = z
  .object({
    patientRef: z.string().regex(/^PAT-[A-Z0-9]{3,8}$/).optional(),
    synthetic: z.literal(true, { errorMap: () => ({ message: 'This deployment accepts synthetic data only; set "synthetic": true to confirm.' }) }),
    demographics: z
      .object({
        name: z.string().min(2).max(120),
        dateOfBirth: IsoDay,
        sex: z.enum(['F', 'M']),
        mrn: z.string().max(40).optional(),
        email: z.string().email().max(200).optional(),
        phone: z.string().max(40).optional(),
        address: z.string().max(200).optional(),
        insuranceId: z.string().max(40).optional(),
        hospitalId: z.string().max(40).optional(),
        ssn: z.string().max(20).optional(),
      })
      .strict(),
    documents: z
      .array(
        z
          .object({ name: z.string().min(1).max(120), text: z.string().max(500_000).optional(), pages: z.array(z.string().max(200_000)).max(200).optional() })
          .strict()
          .refine((d) => d.text || d.pages?.length, 'each document needs text or pages'),
      )
      .min(1)
      .max(50),
  })
  .strict();

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Post()
  @Roles('COORDINATOR')
  create(@Body(new ZodPipe(CreatePatientSchema)) body: z.infer<typeof CreatePatientSchema>) {
    if (body.documents.some((d) => /\u0000/.test(d.text ?? ''))) throw new AppError('INVALID_FILE', 'documents contain binary content');
    return this.patients.create(body);
  }

  @Get()
  list() {
    return this.patients.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.patients.get(id);
  }
}
