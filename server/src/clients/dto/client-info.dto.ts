import { IsOptional, IsString } from 'class-validator';

export class ClientInfoDto {
  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  @IsString()
  value?: string;
}
