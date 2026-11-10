import { Module } from '@nestjs/common';
import { ProjectModule } from './project.module.js';

@Module({
  imports: [ProjectModule],
})
export class AppModule {}
