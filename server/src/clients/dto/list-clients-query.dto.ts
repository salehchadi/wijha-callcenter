import { IsOptional, IsString, IsNumberString, IsEnum } from 'class-validator';
import { ClientType } from './client-type.enum';

export class ListClientsQueryDto {
  @IsNumberString()
  @IsOptional()
  project_id?: string;

  @IsNumberString()
  @IsOptional()
  agent_id?: string;

  @IsOptional()
  @IsEnum(ClientType)
  type?: ClientType;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}
