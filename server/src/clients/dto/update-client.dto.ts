import { IsInt, IsOptional, IsString, IsEnum, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ClientPhoneDto } from './client-phone.dto';
import { ClientInfoDto } from './client-info.dto';
import { ClientType } from './client-type.enum';

export class UpdateClientDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ClientType)
  type?: ClientType;

  @IsOptional()
  @IsInt()
  agent_id?: number;

  @IsOptional()
  @IsString()
  next_dial_at?: string | null;

  @IsOptional()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => ClientPhoneDto)
  phones?: ClientPhoneDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ClientInfoDto)
  info?: ClientInfoDto[];
}
