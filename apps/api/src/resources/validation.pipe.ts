import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from '@finance-flow/validation';
export class SchemaPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}
  transform(value: unknown) {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException(
        'Dados inválidos. Confira os campos, valores e identificadores informados.',
      );
    return parsed.data;
  }
}
