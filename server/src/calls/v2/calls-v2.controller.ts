import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CallsService } from '../calls.service';
import { SubmitCallDto } from '../dto/submit-call.dto';
import { NotifyCallingDto } from '../dto/notify-calling.dto';
import { ListCallsQueryDto } from '../dto/list-calls-query.dto';
import { GetNextClientQueryDto } from '../dto/get-next-client-query.dto';
import { GetStatusesQueryDto } from '../dto/get-statuses-query.dto';
import type { CallResponseDto } from '../dto/call-response.dto';
import type { NextClientResponseDto } from '../dto/next-client-response.dto';
import type { StatusCountDto } from '../dto/status-count.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { DEFAULT_PAGE_LIMIT } from '../config';

@Controller({ path: 'calls', version: '2' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class CallsV2Controller {
  constructor(private callsService: CallsService) {}

  @Get()
  async findAll(@Query() query: ListCallsQueryDto): Promise<{
    data: CallResponseDto[];
    meta: { total: number; page: number; limit: number };
  }> {
    const clientId: number | undefined = query.client_id ? Number(query.client_id) : undefined;
    const agentId: number | undefined = query.agent_id ? Number(query.agent_id) : undefined;
    const projectId: number | undefined = query.project_id ? Number(query.project_id) : undefined;
    const from: Date | undefined = query.from ? new Date(query.from) : undefined;
    const to: Date | undefined = query.to ? new Date(query.to) : undefined;

    return this.callsService.findAll({
      client_id: clientId,
      agent_id: agentId,
      status: query.status,
      page: query.page ?? 1,
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      from,
      to,
      project_id: projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @Body() dto: SubmitCallDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CallResponseDto> {
    return this.callsService.submit(dto, user.id);
  }

  @Get('next')
  async getNext(
    @Query() query: GetNextClientQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NextClientResponseDto | null> {
    const assignedOnly: boolean = query.assigned_only === 'true' || query.assigned_only === '1';
    return this.callsService.getNextClient({
      projectId: query.project_id && query.project_id !== '0' ? Number(query.project_id) : undefined,
      date: query.date ? new Date(query.date) : undefined,
      agentId: assignedOnly ? user.id : undefined,
      type: query.type,
    });
  }

  @Get('statuses')
  async getStatuses(@Query() query: GetStatusesQueryDto): Promise<StatusCountDto[]> {
    const from: Date | undefined = query.from ? new Date(query.from) : undefined;
    const to: Date | undefined = query.to ? new Date(query.to) : undefined;
    return this.callsService.getStatusCounts(from, to);
  }

  @Post('calling')
  @HttpCode(HttpStatus.OK)
  async notifyCalling(@Body() dto: NotifyCallingDto): Promise<void> {
    await this.callsService.notifyCalling(dto);
  }

  @Get(':callId')
  async findOne(@Param('callId', ParseIntPipe) callId: number): Promise<CallResponseDto | null> {
    return this.callsService.findById(callId);
  }

  @Delete(':callId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin')
  async remove(@Param('callId', ParseIntPipe) callId: number): Promise<void> {
    await this.callsService.remove(callId);
  }
}
