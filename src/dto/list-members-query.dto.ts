import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListMembersQueryDto {
  @ApiPropertyOptional({ description: 'Filter members by name or email' })
  @IsOptional()
  @IsString()
  searchKey?: string;
}
