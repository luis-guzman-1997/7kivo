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
import { OrgSettingsComponent } from './org-settings/org-settings.component';
import { CollectionsComponent } from './collections/collections.component';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: AdminLayoutComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', component: DashboardComponent },
      { path: 'contactos', component: StudentsComponent },
      { path: 'chat', component: ChatComponent },
      { path: 'bandeja', component: InboxComponent },
      { path: 'colecciones', component: CollectionsComponent },
      { path: 'administradores', component: AdminUsersComponent },
      { path: 'bot', component: BotConfigComponent },
      { path: 'flujos', component: FlowBuilderComponent },
      { path: 'configuracion', component: OrgSettingsComponent }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AdminRoutingModule {}
