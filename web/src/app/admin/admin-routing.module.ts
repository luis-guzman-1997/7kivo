import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from '../guards/auth.guard';
import { LoginComponent } from './login/login.component';
import { AdminLayoutComponent } from './admin-layout/admin-layout.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { StudentsComponent } from './students/students.component';
import { AdminUsersComponent } from './admin-users/admin-users.component';
import { BotConfigComponent } from './bot-config/bot-config.component';
import { FlowBuilderComponent } from './flow-builder/flow-builder.component';
import { InboxComponent } from './inbox/inbox.component';
import { ChatComponent } from './chat/chat.component';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: AdminLayoutComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', component: DashboardComponent },
      { path: 'aspirantes', component: StudentsComponent },
      { path: 'chat', component: ChatComponent },
      { path: 'bandeja', component: InboxComponent },
      { path: 'administradores', component: AdminUsersComponent },
      { path: 'bot', component: BotConfigComponent },
      { path: 'flujos', component: FlowBuilderComponent }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AdminRoutingModule {}
