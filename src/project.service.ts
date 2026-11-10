import {
  ForbiddenException,
    Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Project } from './schemas/project.schema.js';
import { Invitation, InvitationStatus } from './schemas/invitation.schema.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { ListProjectQueryDto } from './dto/list-project-query.dto.js';
import { ListMembersQueryDto } from './dto/list-members-query.dto.js';
import {type ClientGrpc, type ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { GrpcBreaker } from './grpc/grpc-breaker.service.js';
import { MemberRole } from './schemas/project.schema.js';
import { can, permissionError, type Permission } from './permissions.js';

const ROLE_TITLE: Record<string, string> = { VIEWER: 'Viewer', EDITOR: 'Editor', DELETOR: 'Deletor', ADMIN: 'Admin' };

@Injectable()
export class ProjectService implements OnModuleInit {
 private userService:any;
 private taskService:any;
 private readonly logger=new Logger(ProjectService.name);
  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<Project>,
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<Invitation>,
    @Inject('USER')private readonly client:ClientGrpc,
    @Inject('EVENTS')private readonly eventsClient:ClientProxy,
    @Inject('MAIL')private readonly mailClient:ClientProxy,
    private readonly grpc:GrpcBreaker,
    @Inject('TASK') private readonly taskClient:ClientGrpc,
  ) {}

onModuleInit() {
    this.userService=this.client.getService('UserService')
    this.taskService=this.taskClient.getService('TaskService')
}
  // The project, once we know the user belongs to it. Deleted projects don't exist for anyone.
  private async getProjectForMember(projectId: string, userId: string) {
    const project: any = await this.projectModel.findOne({ _id: projectId, status: { $ne: 'DELETED' } }).lean();
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    const role = String(project.owner) === userId ? 'OWNER'
      : project.members?.includes(userId) ? project.memberRoles?.[userId] ?? MemberRole.EDITOR
      : null;
    if (!role) {
      throw new ForbiddenException('You are not a member of this project');
    }
    return { project, role: role as string };
  }

  private async requirePermission(projectId: string, userId: string, permission: Permission) {
    const access = await this.getProjectForMember(projectId, userId);
    if (!can(access.role, permission)) {
      throw new ForbiddenException(permissionError(permission));
    }
    return access;
  }

  private async getUsers(ids: string[]) {
    const response: any = await this.grpc.call('user.getUsersByIds', () =>
      this.userService.getUsersByIds({ ids }),
    );
    return response.users;
  }

  // Creates an invitation for each selected user and asks for an email to be sent. They join the project when they accept.
  private async invite(project: any, userIds: string[], inviterName: string, roles: Map<string, MemberRole> = new Map()) {
    const users = await this.getUsers(userIds);

    await this.invitationModel.insertMany(
      users.map((u: any) => ({
        projectId: project._id,
        inviteeId: String(u._id),
        invitedBy: project.owner,
        invitedByName: inviterName,
        role: roles.get(String(u._id)) ?? MemberRole.EDITOR,
      })),
    );

    await this.publishMail('mail.project-invitation', users.map((u: any) => (
      { email: u.email, name: u.name, projectName: project.name, inviterName, role: ROLE_TITLE[roles.get(String(u._id)) ?? MemberRole.EDITOR] }
    )));
  }

  // Tells the users that they were taken out of the project
  private async notifyRemoved(project: any, userIds: string[]) {
    const users = await this.getUsers(userIds);
    await this.publishMail('mail.project-removed', users.map((u: any) => (
      { email: u.email, name: u.name, projectName: project.name }
    )));
  }


  // The email itself is sent by common-service. A failure here is only logged: it must not fail the request.
  private async publishMail(event: string, payloads: object[]) {
    try {
      for (const payload of payloads) {
        await lastValueFrom(this.mailClient.emit(event, payload), { defaultValue: undefined });
      }
    } catch (error) {
      this.logger.error(`could not publish ${event}: ${(error as Error).message}`);
    }
  }

  // the owner is the authenticated user, set by the controller
  async create(payload: CreateProjectDto & { owner: string }, inviterName: string) {
    const { members, memberRoles, ...rest } = payload;

    // the project starts with no members; the selected users are added when they accept
    const created = await this.projectModel.create({ ...rest, members: [] });
    await this.invite(created, members, inviterName, new Map((memberRoles ?? []).map((r) => [r.userId, r.role])));

    return {
      message: 'Project created successfully, invitations sent to the selected members',
      data: created,
    };
  }

  async update(id: string, payload: UpdateProjectDto, userId:string, inviterName: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid id');
    }

    const { members, memberRoles, ...changes }: any = payload;

    const { role } = await this.getProjectForMember(id, userId);
    if (Object.values(changes).some((v) => v !== undefined) && !can(role, 'edit')) {
      throw new ForbiddenException(permissionError('edit'));
    }
    // deciding who is in the team and with what role is for the owner and admins, or an editor could promote themselves
    if ((members || memberRoles) && role !== 'OWNER' && role !== MemberRole.ADMIN) {
      throw new ForbiddenException('Only the project owner or an admin can manage members');
    }

    const roles = new Map<string, MemberRole>((memberRoles ?? []).map((r: any) => [r.userId, r.role]));
    let added: string[] = [];
    let removed: string[] = [];

    if (members || memberRoles) {
      const project: any = await this.projectModel.findById(id).lean();
      const next: string[] = project.members.filter((m: string) => !members || members.includes(m));
      changes.memberRoles = Object.fromEntries(
        next.map((m) => [m, roles.get(m) ?? project.memberRoles?.[m] ?? MemberRole.EDITOR]),
      );
    }

    if (members) {
      const project: any = await this.projectModel.findById(id);
      added = members.filter((m: string) => !project.members.includes(m));
      removed = project.members.filter((m: string) => !members.includes(m));
      // removed people go out now; added people are only invited, they join when they accept
      changes.members = project.members.filter((m: string) => members.includes(m));
    }
    
    const updated = await this.projectModel.findByIdAndUpdate(
      id,
      { $set: changes },
      { new: true, runValidators: true },
    );

    if (!updated) {
      throw new NotFoundException('Project not found');
    }

    if (added.length) await this.invite(updated, added, inviterName, roles);
    if (removed.length) await this.notifyRemoved(updated, removed);

    return {
      message: 'Project updated successfully',
      data: updated,
    };
  }

  // The logged-in user's pending invitations, paginated
  async listMyInvitations(query: ListProjectQueryDto, userId: string) {
    const { pageNo, limit } = query;
    const filters = { inviteeId: userId, status: InvitationStatus.PENDING };

    const [invitations, total] = await Promise.all([
      this.invitationModel
        .find(filters)
        .sort({ createdAt: -1 })
        .skip((pageNo - 1) * limit)
        .limit(limit)
        .populate('projectId', 'name description coverImage'),
      this.invitationModel.countDocuments(filters),
    ]);

    return {
      message: 'Invitations fetched successfully',
      data: invitations,
      meta: { pageNo, limit, totalDocuments: total },
    };
  }

  // Emails the project owner that the invitation was accepted or declined
  async acceptInvitationMail(invitationId: string, userId: string, accept: boolean) {
    // found by id and invitee only: this runs after the answer was saved, so it is no longer PENDING
    const invitation: any = await this.invitationModel
      .findOne({ _id: invitationId, inviteeId: userId })
      .populate('projectId', 'name');
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    const users = await this.getUsers([invitation.invitedBy, invitation.inviteeId]);
    const owner = users.find((u: any) => String(u._id) === invitation.invitedBy);
    const invitee = users.find((u: any) => String(u._id) === invitation.inviteeId);


    await this.publishMail('mail.project-accepted', [
      { email: owner.email, name: owner.name, projectName: invitation.projectId.name, acceptedBy: invitee.name, accepted: accept },
    ]);
  }

  private async respond(invitationId: string, userId: string, accept: boolean) {
    // only the invited user can answer, and only while it is still pending
    const invitation = await this.invitationModel.findOneAndUpdate(
      { _id: invitationId, inviteeId: userId, status: InvitationStatus.PENDING },
      { $set: { status: accept ? InvitationStatus.ACCEPTED : InvitationStatus.DECLINED } },
    );
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }


    if (accept) {
      await this.projectModel.findByIdAndUpdate(invitation.projectId, {
        $addToSet: { members: userId },
        $set: { [`memberRoles.${userId}`]: invitation.role ?? MemberRole.EDITOR },
      });
    }
    await this.acceptInvitationMail(invitationId, userId, accept);

    return { message: accept ? 'Invitation accepted' : 'Invitation declined' };
  }

  acceptInvitation(invitationId: string, userId: string) {
    return this.respond(invitationId, userId, true);
  }

  declineInvitation(invitationId: string, userId: string) {
    return this.respond(invitationId, userId, false);
  }

  async deleteProjectMail(projectId: string) {
    const project = await this.projectModel.findById(projectId)?.lean();
    if(!project){
      throw new NotFoundException('Project not found');
    }
    const users = await this.getUsers(project.members);

    await this.publishMail('mail.project-deleted', users.map((u: any) => (
      { email: u.email, name: u.name, projectName: project.name }
    )));
  }

  async delete(id: string, userId:string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Invalid Id');
    }

    await this.requirePermission(id, userId, 'delete');

    const deleted = await this.projectModel.findByIdAndUpdate(id,{$set:{status:'DELETED'}});
    await this.deleteProjectMail(id);
    await this.invitationModel.updateMany({projectId:id,status:InvitationStatus.PENDING},{$set:{status:InvitationStatus.DECLINED}});

    if (!deleted) {
      throw new NotFoundException('Project not found');
    }
    

    // Tell task-service (through RabbitMQ) to cancel this project's tasks and delete its comments
    try {
      await lastValueFrom(this.eventsClient.emit('project.deleted',{projectId:id}),{defaultValue:undefined})
    }catch(error){
      this.logger.error(`could not publish project.deleted for ${id}: ${(error as Error).message}`)
    }

    return {
      message: 'Project deleted successfully',
    };
  }

  async list(query:ListProjectQueryDto,userId:string) {
    const {status,searchKey}=query
    const page=Math.max(Number(query.pageNo),1)
    const limit=Math.max(Number(query.limit),1)
    const skip=(page-1)*limit

    // only projects the user owns or belongs to, never deleted ones
    const filters:any={
      status:status ?? {$ne:'DELETED'},
      $and:[{$or:[{owner:userId},{members:userId}]}],
    }
    if(searchKey){
      const pattern=new RegExp(searchKey.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i')
      filters.$and.push({$or:[{name:pattern},{description:pattern}]})
    }

    const [projects,total]=await Promise.all([
      this.projectModel
        .find(filters)
        .sort({createdAt:-1,_id:-1})
        .skip(skip)
        .limit(limit)
        .lean(),
      this.projectModel.countDocuments(filters),
    ])

    // Resolve member ids to users. If user-service is down, still return the
    // projects, with the member ids unresolved.
    const memberIds=[
      ...new Set(projects.flatMap((p)=>(p.members ?? []).map((id)=>String(id)))),
    ]
    let users:any[]=[]
    if(memberIds.length){
      try{
        const response:any=await this.grpc.call('user.getUsersByIds',()=>
          this.userService.getUsersByIds({ids:memberIds}),
        )
        users=response?.users ?? []
      }catch(error){
        this.logger.error(`getUsersByIds failed, members left unresolved: ${(error as Error).message}`)
        users=[]
      }
    }
    const usersById=new Map(users.map((u:any)=>[String(u.id ?? u._id),u]))

    const populatedProjects=projects.map((project)=>({
      ...project,
      // the current user's role here; the creator counts as an admin
      myRole:String(project.owner)===userId ? MemberRole.ADMIN : (project.memberRoles as any)?.[userId] ?? MemberRole.EDITOR,
      members:(project.members ?? []).map(
        (id)=>usersById.get(String(id)) ?? {_id:String(id)},
      ),
    }))

    return {
      message:'Projects fetched successfully',
      data:populatedProjects,
      meta:{
        pageNo:page,
        limit,
        totalDocuments:total,
      },
    }
  }

  // Used by other services over gRPC (no end user involved), so there is no access check here.
  async getMembersId(projectId:string){
    if(!Types.ObjectId.isValid(projectId)){
      throw new NotFoundException('Invalid project id')
    }

    const project=await this.projectModel
      .findOne({_id:projectId,status:{$ne:'DELETED'}})
      .select('owner members memberRoles')
      .lean()
    if(!project){
      throw new NotFoundException('Project not found')
    }

    const member_ids=(project.members ?? []).map((id)=>String(id))
    return {
      owner_id:String(project.owner),
      member_ids,
      member_roles:Object.fromEntries(member_ids.map((id)=>[id,(project.memberRoles as any)?.[id] ?? MemberRole.EDITOR])),
    }
  }

  async getMembers(projectId:string,userId:string,query:ListMembersQueryDto={}){
    if(!Types.ObjectId.isValid(projectId)){
      throw new NotFoundException('Invalid project id')
    }

    // only the owner or a member can see a project's people; deleted projects are hidden
    const project=await this.projectModel
      .findOne({_id:projectId,status:{$ne:'DELETED'},$or:[{owner:userId},{members:userId}]})
      .select('owner members memberRoles')
      .lean()
    if(!project){
      throw new NotFoundException('Project not found')
    }

    // owner first, then members, without duplicates - the owner can be assigned too
    const ids=[...new Set([String(project.owner),...(project.members ?? []).map((id)=>String(id))])]

    let users:any[]=[]
    try{
      const response:any=await this.grpc.call('user.getUsersByIds',()=>
        this.userService.getUsersByIds({ids}),
      )
      users=response?.users ?? []
    }catch(error){
      this.logger.error(`getUsersByIds failed, members left unresolved: ${(error as Error).message}`)
      users=[]
    }
    const usersById=new Map(users.map((u:any)=>[String(u.id ?? u._id),u]))

    let data=ids.map((id)=>({
      ...(usersById.get(id) ?? {_id:id}),
      role:id===String(project.owner) ? 'OWNER' : (project.memberRoles as any)?.[id] ?? MemberRole.EDITOR,
    }))

    const term=query.searchKey?.trim().toLowerCase()
    if(term){
      data=data.filter((u:any)=>
        String(u.name ?? '').toLowerCase().includes(term) ||
        String(u.email ?? '').toLowerCase().includes(term),
      )
    }

    return {
      message:'Members fetched successfully',
      data,
    }
  }

  async getTaskStatistics(projectId:string,userId:string){
    if(!Types.ObjectId.isValid(projectId)){
      throw new NotFoundException('Invalid project id')
    }

    const project=await this.projectModel
      .findOne({_id:projectId,status:{$ne:'DELETED'},$or:[{owner:userId},{members:userId}]})
      .select('_id')
      .lean()
    if(!project){
      throw new NotFoundException('Project not found')
    }

    const stats:any=await this.grpc.call('task.getTaskStatistics',()=>
      this.taskService.getTaskStatistics({project_id:projectId}),
    )

    let users:any[]=[]
    if(stats.by_assignee.length){
      try{
        users=await this.getUsers(stats.by_assignee.map((a:any)=>a.user_id))
      }catch(error){
        this.logger.error(`getUsersByIds failed, assignees left unresolved: ${(error as Error).message}`)
      }
    }
    const usersById=new Map(users.map((u:any)=>[String(u.id ?? u._id),u]))

    return {
      message:'Project statistics fetched successfully',
      data:{
        total:stats.total,
        completionRate:stats.completion_rate,
        overdue:stats.overdue,
        dueSoon:stats.due_soon,
        completedLast7Days:stats.completed_last_7_days,
        byStatus:stats.by_status,
        byPriority:stats.by_priority,
        workload:[
          ...stats.by_assignee.map((a:any)=>({
            user:usersById.get(a.user_id) ?? {_id:a.user_id},
            openTasks:a.count,
          })),
          ...(stats.unassigned ? [{user:null,openTasks:stats.unassigned}] : []),
        ],
      },
    }
  }
}
