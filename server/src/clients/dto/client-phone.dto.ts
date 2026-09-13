import { IsPhoneNumber } from 'class-validator';

export class ClientPhoneDto {
  @IsPhoneNumber('EG')
  phone!: string;
}
