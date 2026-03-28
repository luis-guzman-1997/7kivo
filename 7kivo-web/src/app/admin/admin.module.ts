import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminRoutingModule } from './admin-routing.module';
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
import { CampaignsComponent } from './campaigns/campaigns.component';
import { CitasComponent } from './citas/citas.component';
import { LoginOrgComponent } from './login-org/login-org.component';

@NgModule({
  declarations: [
    LoginComponent,
    LoginOrgComponent,
    AdminLayoutComponent,
    DashboardComponent,
    StudentsComponent,
    AdminUsersComponent,
    BotConfigComponent,
    FlowBuilderComponent,
    InboxComponent,
    ChatComponent,
    OrgSettingsComponent,
    CollectionsComponent,
    WelcomeComponent,
    AdminSetupComponent,
    CampaignsComponent,
    CitasComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    AdminRoutingModule
  ]
})
export class AdminModule {}
