import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ProjectService } from "./project.service.js";
import { CreateProjectDto } from "./dto/create-project.dto.js";
import { UpdateProjectDto } from "./dto/update-project.dto.js";
import { ListProjectQueryDto } from "./dto/list-project-query.dto.js";
import { ListMembersQueryDto } from "./dto/list-members-query.dto.js";
import { GrpcMethod, RpcException } from "@nestjs/microservices";
import { status } from "@grpc/grpc-js";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "./guards/auth.guard.js";
import { CurrentUser } from "./decorators/current-user.decorator.js";

@ApiTags('Project')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('project')
export class ProjectController{
    constructor(private readonly projectService:ProjectService){}
    @ApiOperation({ summary: 'List projects', description: 'Paginated list, filterable by status and searchKey.' })
    @ApiResponse({ status: 200, description: 'Projects fetched successfully' })
    @Get('list')
    @HttpCode(200)
   async getList(@Query () query:ListProjectQueryDto,@CurrentUser('id') userId:string){
       const result=  await this.projectService.list(query,userId)
    return result;
    }
    @ApiOperation({ summary: 'List project members', description: 'Returns the owner and members of a project as user details. Supports searchKey (name or email).' })
    @ApiResponse({ status: 200, description: 'Project members fetched successfully' })
    @ApiResponse({ status: 404, description: 'Project not found' })
    @Get(':id/members')
    @HttpCode(200)
    async getMembers(@Param('id') id:string,@Query() query:ListMembersQueryDto,@CurrentUser('id') userId:string){
       const result=  await this.projectService.getMembers(id,userId,query)
    return result;
    }
    @ApiOperation({ summary: 'Update project' })
    @ApiResponse({ status: 200, description: 'Project updated successfully' })
    @ApiResponse({ status: 404, description: 'Project not found' })
    @HttpCode(200)
    @Patch(':id')
    async updateProject(@Body() payload:UpdateProjectDto,@Param('id') id:string,@CurrentUser('id') userId:string,@CurrentUser('name') userName:string){
       const result=  await this.projectService.update(id,payload,userId,userName)
    return result;
    }
    @ApiOperation({ summary: 'My pending invitations', description: 'Projects the logged-in user has been invited to and has not answered yet. Paginated.' })
    @ApiResponse({ status: 200, description: 'Invitations fetched successfully' })
    @Get('invitations')
    @HttpCode(200)
    async listInvitations(@Query() query:ListProjectQueryDto,@CurrentUser('id') userId:string){
      return this.projectService.listMyInvitations(query,userId)
    }
    @ApiOperation({ summary: 'Accept an invitation', description: 'Adds the logged-in user to the project.' })
    @ApiResponse({ status: 200, description: 'Invitation accepted' })
    @ApiResponse({ status: 404, description: 'Invitation not found or already answered' })
    @Post('invitations/:id/accept')
    @HttpCode(200)
    async acceptInvitation(@Param('id') id:string,@CurrentUser('id') userId:string){
      return this.projectService.acceptInvitation(id,userId)
    }
    @ApiOperation({ summary: 'Decline an invitation' })
    @ApiResponse({ status: 200, description: 'Invitation declined' })
    @ApiResponse({ status: 404, description: 'Invitation not found or already answered' })
    @Post('invitations/:id/decline')
    @HttpCode(200)
    async declineInvitation(@Param('id') id:string,@CurrentUser('id') userId:string){
      return this.projectService.declineInvitation(id,userId)
    }
    @ApiOperation({ summary: 'Create project', description: 'The owner is taken from the access token.' })
    @ApiResponse({ status: 201, description: 'Project created successfully' })
    @ApiResponse({ status: 400, description: 'Validation failed' })
    @ApiResponse({ status: 401, description: 'Missing, invalid or revoked token' })
    @Post('')
    @HttpCode(201)
   async addProject(@Body() payload:CreateProjectDto,@CurrentUser('id') userId:string,@CurrentUser('name') userName:string){
    const result=  await this.projectService.create({...payload,owner:userId},userName)
    return result;
    }
    @ApiOperation({ summary: 'Delete project' })
    @ApiResponse({ status: 200, description: 'Project deleted successfully' })
    @ApiResponse({ status: 404, description: 'Project not found' })
    @HttpCode(200)
    @Delete(':id')
    async deleteProject(@Param('id') id:string,@CurrentUser('id') userId:string ){
      const result=  await this.projectService.delete(id,userId)
    return result;
    }

    // Called by other services over gRPC. The AuthGuard lets non-HTTP calls through.
    @GrpcMethod('ProjectService','GetMembersId')
    async getMembersId(data:{project_id?:string}){
      if(!data.project_id){
        throw new RpcException({code:status.INVALID_ARGUMENT,message:'project_id is missing'})
      }
      try{
        return await this.projectService.getMembersId(data.project_id)
      }catch(error){
        throw new RpcException({code:status.NOT_FOUND,message:(error as Error).message})
      }
    }

    @ApiOperation({ summary: 'Project statistics', description: 'Dashboard numbers: tasks by status and priority, workload per person, overdue and due soon.' })
    @ApiResponse({ status: 200, description: 'Project statistics fetched successfully' })
    @ApiResponse({ status: 404, description: 'Project not found' })
    @Get(':id/statistics')
    @HttpCode(200)
    async getTaskStatistics(@Param('id') id:string,@CurrentUser('id') userId:string){
        return await this.projectService.getTaskStatistics(id,userId)
    }
}
