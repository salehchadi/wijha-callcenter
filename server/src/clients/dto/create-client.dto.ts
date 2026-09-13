import {
  IsString,
  IsNumber,
  IsInt,
  IsOptional,
  IsEnum,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClientPhoneDto } from './client-phone.dto';
import { ClientInfoDto } from './client-info.dto';
import { ClientType } from './client-type.enum';

export class CreateClientDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsNumber()
  @IsOptional()
  project_id?: number;

  @IsOptional()
  @IsEnum(ClientType)
  type?: ClientType;

  @IsOptional()
  @IsInt()
  agent_id?: number;

  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => ClientPhoneDto)
  phones!: ClientPhoneDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ClientInfoDto)
  info?: ClientInfoDto[];
}
