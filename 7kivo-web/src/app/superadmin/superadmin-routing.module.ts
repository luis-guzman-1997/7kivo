import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { SaLayoutComponent } from './sa-layout/sa-layout.component';
import { SaDashboardComponent } from './sa-dashboard/sa-dashboard.component';
import { SaOrganizationsComponent } from './sa-organizations/sa-organizations.component';
import { SaOrgDetailComponent } from './sa-org-detail/sa-org-detail.component';
import { SaBillingComponent } from './sa-billing/sa-billing.component';
import { SaPlansComponent } from './sa-plans/sa-plans.component';

const routes: Routes = [
  {
    path: '',
    component: SaLayoutComponent,
    canActivate: [SuperAdminGuard],
    children: [
      { path: '', component: SaDashboardComponent },
      { path: 'organizaciones', component: SaOrganizationsComponent },
      { path: 'organizaciones/:orgId', component: SaOrgDetailComponent },
      { path: 'facturacion', component: SaBillingComponent },
      { path: 'planes', component: SaPlansComponent }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class SuperAdminRoutingModule {}
