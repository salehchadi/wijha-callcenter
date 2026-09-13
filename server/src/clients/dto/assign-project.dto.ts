import { IsString } from 'class-validator';

export class AssignProjectDto {
  @IsString()
  project_name!: string;
}
