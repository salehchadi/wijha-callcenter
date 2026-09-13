import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Delete,
  BadRequestException,
} from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { BulkCreateClientsDto } from './dto/bulk-create-clients.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { AssignProjectDto } from './dto/assign-project.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';
import type { ClientResponseDto } from './dto/client-response.dto';
import type { StatusCountDto } from '@/calls/dto/status-count.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@Controller({ path: 'owners', version: '1' })
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @Get()
  async findAll(@Query() query: ListClientsQueryDto): Promise<{
    data: ClientResponseDto[];
    meta: { total: number; page: number; limit: number };
  }> {
    const projectId: number | undefined = query.project_id ? Number(query.project_id) : undefined;
    const agentId: number | undefined = query.agent_id ? Number(query.agent_id) : undefined;
    const page: number = query.page ? Number(query.page) : 1;
    const limit: number = query.limit ? Math.min(Number(query.limit), 100) : 20;
    return this.clientsService.findAll(projectId, query.type, query.status, page, limit, agentId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateClientDto): Promise<ClientResponseDto> {
    return this.clientsService.create(dto);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  async createBulk(@Body() dto: BulkCreateClientsDto): Promise<ClientResponseDto[]> {
    const items: CreateClientDto[] | undefined = dto.clients ?? dto.owners;
    if (!items || items.length === 0) {
      throw new BadRequestException('Provide a non-empty clients array');
    }
    return this.clientsService.createBulk(items);
  }

  @Get('statuses')
  async getStatuses(): Promise<StatusCountDto[]> {
    return this.clientsService.getStatusCounts();
  }

  @Post(':clientId/projects')
  @HttpCode(HttpStatus.OK)
  async assignProject(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Body() dto: AssignProjectDto,
  ): Promise<ClientResponseDto> {
    return this.clientsService.assignToProject(clientId, dto.project_name);
  }

  @Get(':clientId')
  async findOne(@Param('clientId', ParseIntPipe) clientId: number): Promise<ClientResponseDto | null> {
    return this.clientsService.findById(clientId);
  }

  @Patch(':clientId')
  async patch(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Body() dto: UpdateClientDto,
  ): Promise<ClientResponseDto> {
    return this.clientsService.update(clientId, dto);
  }

  @Delete(':clientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('clientId', ParseIntPipe) clientId: number): Promise<void> {
    return this.clientsService.remove(clientId);
  }
}
