import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { MemberRole } from './project.schema.js';

export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
}

@Schema({ timestamps: true })
export class Invitation {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  projectId: Types.ObjectId;

  // The invited user (user ids are kept as strings, like project.owner and project.members)
  @Prop({ type: String, required: true, index: true })
  inviteeId: string;

  @Prop({ type: String, required: true })
  invitedBy: string;

  @Prop({ type: String, required: true })
  invitedByName: string;

  // the role the user gets when they accept
  @Prop({ type: String, enum: MemberRole, default: MemberRole.EDITOR })
  role: MemberRole;

  @Prop({ type: String, enum: InvitationStatus, default: InvitationStatus.PENDING })
  status: InvitationStatus;
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation);
