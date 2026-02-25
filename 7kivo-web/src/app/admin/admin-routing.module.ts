import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from '../guards/auth.guard';
import { RoleGuard } from '../guards/role.guard';
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
import { WelcomeComponent } from './welcome/welcome.component';
import { AdminSetupComponent } from './admin-setup/admin-setup.component';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'bienvenida', component: WelcomeComponent, canActivate: [AuthGuard] },
  {
    path: '',
    component: AdminLayoutComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', component: DashboardComponent },
      { path: 'contactos', component: StudentsComponent, canActivate: [RoleGuard], data: { permission: 'contacts' } },
      { path: 'chat', component: ChatComponent, canActivate: [RoleGuard], data: { permission: 'chat' } },
      { path: 'bandeja', component: InboxComponent, canActivate: [RoleGuard], data: { permission: 'inbox' } },
      { path: 'colecciones', component: CollectionsComponent, canActivate: [RoleGuard], data: { permission: 'collections' } },
      { path: 'administradores', component: AdminUsersComponent, canActivate: [RoleGuard], data: { permission: 'users' } },
      { path: 'bot', component: BotConfigComponent, canActivate: [RoleGuard], data: { permission: 'bot_config' } },
      { path: 'flujos', component: FlowBuilderComponent, canActivate: [RoleGuard], data: { permission: 'flows' } },
      { path: 'configuracion', component: OrgSettingsComponent, canActivate: [RoleGuard], data: { permission: 'settings' } },
      { path: 'pendientes', component: AdminSetupComponent, canActivate: [AuthGuard] }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AdminRoutingModule {}
