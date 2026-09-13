import type { ClientResponseDto } from '@/clients/dto/client-response.dto';
import type { CallResponseDto } from './call-response.dto';

export class NextClientResponseDto {
  client!: ClientResponseDto;
  calls!: CallResponseDto[];
  /** @deprecated v1 compat — alias of `client` */
  owner!: ClientResponseDto;
}
