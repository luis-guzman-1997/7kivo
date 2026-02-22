import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SuperAdminRoutingModule } from './superadmin-routing.module';
import { SaLayoutComponent } from './sa-layout/sa-layout.component';
import { SaDashboardComponent } from './sa-dashboard/sa-dashboard.component';
import { SaOrganizationsComponent } from './sa-organizations/sa-organizations.component';
import { SaBillingComponent } from './sa-billing/sa-billing.component';
import { SaPlansComponent } from './sa-plans/sa-plans.component';

@NgModule({
  declarations: [
    SaLayoutComponent,
    SaDashboardComponent,
    SaOrganizationsComponent,
    SaBillingComponent,
    SaPlansComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    SuperAdminRoutingModule
  ]
})
export class SuperAdminModule {}
