import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  ForbiddenException,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { BulkCreateUsersDto } from './dto/bulk-create-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import type { UserStatsDto } from './dto/user-stats.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';

@Controller({ path: 'users', version: ['1', '2'] })
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async findAll(@Query() query: ListUsersQueryDto): Promise<UserResponseDto[]> {
    return this.usersService.findAll(query.role, query.online);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.usersService.create(dto);
  }

  @Post('bulk')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  async createBulk(@Body() dto: BulkCreateUsersDto): Promise<UserResponseDto[]> {
    return this.usersService.createBulk(dto.users);
  }

  @Get(':userId')
  async findOne(@Param('userId', ParseIntPipe) userId: number): Promise<UserResponseDto | null> {
    return this.usersService.findById(userId);
  }

  @Patch(':userId')
  async update(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    if (currentUser.role !== 'admin' && currentUser.id !== userId) {
      throw new ForbiddenException('You can only update your own profile');
    }
    return this.usersService.update(userId, dto, currentUser.role === 'admin');
  }

  @Patch(':userId/deactivate')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('userId', ParseIntPipe) userId: number): Promise<UserResponseDto> {
    return this.usersService.deactivate(userId);
  }

  @Post(':userId/profile-image')
  @UseInterceptors(FileInterceptor('profile_image', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @HttpCode(HttpStatus.OK)
  async uploadProfileImage(
    @Param('userId', ParseIntPipe) userId: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    if (currentUser.role !== 'admin' && currentUser.id !== userId) {
      throw new ForbiddenException('You can only update your own profile image');
    }
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Only jpeg, png, gif, webp allowed');
    }
    return this.usersService.uploadProfileImage(userId, file.buffer, file.mimetype);
  }

  @Delete(':userId/profile-image')
  @HttpCode(HttpStatus.OK)
  async deleteProfileImage(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    if (currentUser.role !== 'admin' && currentUser.id !== userId) {
      throw new ForbiddenException('You can only delete your own profile image');
    }
    return this.usersService.deleteProfileImage(userId);
  }

  @Get(':userId/profile-image')
  async getProfileImage(
    @Param('userId', ParseIntPipe) userId: number,
    @Res() res: Response,
  ): Promise<void> {
    const image = await this.usersService.getProfileImage(userId);
    if (!image) {
      res.status(404).end();
      return;
    }
    res.set('Content-Type', image.mime);
    res.send(image.data);
  }

  @Get(':userId/stats')
  async getStats(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<UserStatsDto | null> {
    return this.usersService.getStats(userId, from, to);
  }
}
