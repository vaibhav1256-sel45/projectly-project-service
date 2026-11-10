import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { MemberRole } from '../schemas/project.schema.js';

export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export class MemberRoleDto {
  @ApiProperty({ example: '665f1c2e8a1b2c3d4e5f6a7b' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ enum: MemberRole, example: MemberRole.EDITOR })
  @IsEnum(MemberRole)
  role: MemberRole;
}

export class CreateProjectDto {
  @ApiProperty({ example: 'Website Redesign' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Redesign of the marketing website' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: '665f1c2e8a1b2c3d4e5f6a7b', description: 'Project members' })
  @IsArray()
  @IsString({each:true})
  @ArrayNotEmpty()
  members: string [];

  @ApiProperty({ type: [MemberRoleDto], required: false, description: 'Role of each member; anyone left out is an Editor' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MemberRoleDto)
  memberRoles?: MemberRoleDto[];

  @ApiProperty({ example: 'images/uuid.png', description: 'Storage key returned by common-service upload URL' })
  @IsString()
  @IsNotEmpty()
  coverImage: string;

  @ApiProperty({ enum: ProjectStatus, example: ProjectStatus.ACTIVE })
  @IsEnum(ProjectStatus)
  status: ProjectStatus;
}
