import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateClientDto } from './create-client.dto';

export class BulkCreateClientsDto {
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateClientDto)
  clients?: CreateClientDto[];

  /** @deprecated v1 compat — use `clients` */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateClientDto)
  owners?: CreateClientDto[];
}
