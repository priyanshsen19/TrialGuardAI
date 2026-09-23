import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, output } from 'zod';
import { AppError } from './errors';

export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, output<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): output<S> {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Request validation failed',
        400,
        r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return r.data;
  }
}
