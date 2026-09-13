import { ClientType } from './client-type.enum';

export class ClientPhoneResponse {
  phone!: string;
}

export class ClientInfoResponse {
  key!: string;
  value!: string;
}

export class ProjectAssignmentResponse {
  project_id!: number;
  project_name!: string;
  status?: string;
  attempt_count?: number;
  last_dialed_at?: string | null;
}

export class ClientResponseDto {
  id!: number;
  name?: string;
  type?: ClientType;
  next_dial_at?: string | null;
  agent_id?: number;
  phones?: ClientPhoneResponse[];
  info?: ClientInfoResponse[];
  projects?: ProjectAssignmentResponse[];
}
