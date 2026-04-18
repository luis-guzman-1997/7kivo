import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-sa-dashboard',
  templateUrl: './sa-dashboard.component.html',
  styleUrls: ['./sa-dashboard.component.css']
})
export class SaDashboardComponent implements OnInit {
  totalOrgs = 0;
  activeOrgs = 0;
  inactiveOrgs = 0;
  botEnabledOrgs = 0;
  botDisabledOrgs = 0;

  pendingPayments = 0;
  overduePayments = 0;
  totalPending = 0;
  totalOverdue = 0;
  totalRevenue = 0;
  monthlyRevenue = 0;

  organizations: any[] = [];
  recentOrgs: any[] = [];
  pendingBilling: any[] = [];
  planDistribution: { name: string; count: number; color: string }[] = [];

  loading = true;
  killingSessions = false;

  constructor(
    private firebaseService: FirebaseService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      const [orgs, billing] = await Promise.all([
        this.firebaseService.getAllOrganizations(),
        this.firebaseService.getPlatformBilling()
      ]);

      this.organizations = orgs;
      this.totalOrgs = orgs.length;
      this.activeOrgs = orgs.filter(o => o.active !== false).length;
      this.inactiveOrgs = this.totalOrgs - this.activeOrgs;
      this.botEnabledOrgs = orgs.filter(o => o.botEnabled !== false && o.active !== false).length;
      this.botDisabledOrgs = this.activeOrgs - this.botEnabledOrgs;

      this.pendingPayments = billing.filter(b => b.status === 'pending').length;
      this.overduePayments = billing.filter(b => b.status === 'overdue').length;
      this.totalPending = billing.filter(b => b.status === 'pending').reduce((s, b) => s + (b.amount || 0), 0);
      this.totalOverdue = billing.filter(b => b.status === 'overdue').reduce((s, b) => s + (b.amount || 0), 0);
      this.totalRevenue = billing.filter(b => b.status === 'paid').reduce((s, b) => s + (b.amount || 0), 0);

      const now = new Date();
      const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      this.monthlyRevenue = billing
        .filter(b => b.status === 'paid' && b.period === currentPeriod)
        .reduce((s, b) => s + (b.amount || 0), 0);

      this.recentOrgs = orgs
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        .slice(0, 5);

      this.pendingBilling = billing
        .filter(b => b.status === 'pending' || b.status === 'overdue')
        .sort((a, b) => {
          if (a.status === 'overdue' && b.status !== 'overdue') return -1;
          if (b.status === 'overdue' && a.status !== 'overdue') return 1;
          return 0;
        })
        .slice(0, 5);

      this.buildPlanDistribution(orgs);
    } catch (err) {
      console.error('Error loading SA dashboard:', err);
    } finally {
      this.loading = false;
    }
  }

  private buildPlanDistribution(orgs: any[]): void {
    const planColors: Record<string, string> = {
      'Starter': '#6366f1',
      'Business': '#8b5cf6',
      'Premium': '#a855f7',
      'Sin plan': '#94a3b8'
    };
    const counts: Record<string, number> = {};
    for (const org of orgs) {
      const plan = org.plan || 'Sin plan';
      counts[plan] = (counts[plan] || 0) + 1;
    }
    this.planDistribution = Object.entries(counts)
      .map(([name, count]) => ({ name, count, color: planColors[name] || '#64748b' }))
      .sort((a, b) => b.count - a.count);
  }

  getExpectedMonthlyIncome(): number {
    return this.organizations
      .filter(o => o.active !== false)
      .reduce((s, o) => s + (o.monthlyRate || 0), 0);
  }

  getCreatedDate(org: any): string {
    if (!org.createdAt?.seconds) return '—';
    return new Date(org.createdAt.seconds * 1000).toLocaleDateString('es');
  }

  getPlanBarWidth(count: number): number {
    if (this.totalOrgs === 0) return 0;
    return Math.max((count / this.totalOrgs) * 100, 8);
  }

  goToOrgs(): void { this.router.navigate(['/superadmin/organizaciones']); }
  goToBilling(): void { this.router.navigate(['/superadmin/facturacion']); }
  goToPlans(): void { this.router.navigate(['/superadmin/planes']); }

  async killAllSessions(): Promise<void> {
    if (!confirm('¿Terminar TODAS las sesiones activas en el sistema? Los usuarios en conversación activa serán desconectados del bot.')) return;
    this.killingSessions = true;
    try {
      const count = await this.firebaseService.killAllSessions();
      alert(`Listo. Se terminaron ${count} sesión(es) activa(s).`);
    } catch (err) {
      console.error('Error terminando sesiones:', err);
      alert('Error al terminar sesiones. Revisa la consola.');
    } finally {
      this.killingSessions = false;
    }
  }
}
