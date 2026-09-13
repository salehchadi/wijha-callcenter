import { IsDateString, IsNumberString, IsOptional, IsBooleanString, IsEnum } from 'class-validator';
import { ClientType } from '@/clients/dto/client-type.enum';

export class GetNextClientQueryDto {
  @IsOptional()
  @IsNumberString()
  project_id?: string;

  @IsOptional()
  @IsBooleanString()
  assigned_only?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsEnum(ClientType)
  type?: ClientType;
}
