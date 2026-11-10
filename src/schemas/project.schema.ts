import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose from "mongoose";

// Viewer: view. Editor: view + edit. DELETOR: view + delete. Admin: view + edit + delete.
export enum MemberRole {
  VIEWER = 'VIEWER',
  EDITOR = 'EDITOR',
  DELETOR = 'DELETOR',
  ADMIN = 'ADMIN',
}

@Schema({timestamps:true})
export class Project {
  @Prop({type:String,required:true})
  name:string
  @Prop({type:String,required:true})
  description:string

  @Prop({type:[String],required:true,index:true})
  members:string[]

  @Prop({type:Map,of:{type:String,enum:MemberRole},default:{}})
  memberRoles:Map<string,MemberRole>
  
  @Prop({type:String,required:true,index:true})
  owner:string

  @Prop({type:String,required:true})
  coverImage:string
 
  @Prop({type:String,required:true,enum:['ACTIVE','ARCHIVED','DELETED'],default:'ACTIVE'})
  status:string

}

export const ProjectSchema=SchemaFactory.createForClass(Project)

