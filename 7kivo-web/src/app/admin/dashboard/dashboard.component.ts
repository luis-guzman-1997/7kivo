import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  totalAdmins = 0;
  totalFlows = 0;
  totalCollections = 0;
  collectionStats: { name: string; slug: string; count: number; pending: number; pct: number; icon: string }[] = [];
  recentItems: any[] = [];
  loading = true;
  planName = '';
  planLimits: any = { flows: 0, collections: 0, admins: 0, chatLive: false };
  botEnabled = true;

  // 360° new data
  orgId = '';
  totalRecords = 0;
  newToday = 0;
  pendingTotal = 0;
  openConversations = 0;
  totalConversations = 0;
  activeCampaigns: any[] = [];
  dailyBulkLimit = 0;
  totalSentToday = 0;
  todayLabel = '';

  // Onboarding
  showOnboarding = false;
  step1Done = false;
  step2Done = false;
  step3Done = false;
  step1Missing = '';
  step2Missing = '';
  step3Missing = '';

  constructor(private firebaseService: FirebaseService, public authService: AuthService) {
    this.planName = this.authService.orgPlan || 'Sin plan';
    this.planLimits = this.authService.getPlanLimits();
    this.botEnabled = this.authService.botEnabled;
    this.orgId = this.firebaseService.getOrgId();

    const now = new Date();
    this.todayLabel = now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  async ngOnInit(): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTs = today.getTime() / 1000;
      const todayStr = new Date().toISOString().split('T')[0];

      const [admins, flows, colDefs, orgConfig, infoGeneral, menuConfig, conversations, campaigns] = await Promise.all([
        this.firebaseService.getAdmins(),
        this.firebaseService.getFlows(),
        this.firebaseService.getCollectionDefs(),
        this.firebaseService.getOrgConfig(),
        this.firebaseService.getDocument('info', 'general'),
        this.firebaseService.getMenuConfig(),
        this.firebaseService.getConversations(),
        this.firebaseService.getCampaigns(this.orgId)
      ]);

      this.totalAdmins = admins.length;
      this.totalFlows = flows.length;
      this.totalCollections = colDefs.length;

      // Conversations
      this.totalConversations = conversations.length;
      this.openConversations = conversations.filter((c: any) => !c.isResolved && !c.resolved).length;

      // Campaigns
      this.activeCampaigns = campaigns.filter((c: any) => c.status === 'active');
      this.dailyBulkLimit = orgConfig?.dailyBulkLimit || 0;
      this.totalSentToday = campaigns.reduce((sum: number, c: any) => {
        if (c.sentTodayDate === todayStr) return sum + (c.sentToday || 0);
        return sum;
      }, 0);

      // Collections
      const icons = ['fa-layer-group', 'fa-users', 'fa-folder', 'fa-archive', 'fa-clipboard-list', 'fa-tags'];
      const statsPromises = colDefs.map(async (col: any, i: number) => {
        const items = await this.firebaseService.getCollectionData(col.slug, 200);
        const pending = items.filter((it: any) => it.status === 'pending').length;
        this.pendingTotal += pending;
        this.totalRecords += items.length;
        this.newToday += items.filter((it: any) => (it.createdAt?.seconds || 0) >= todayTs).length;

        if (items.length > 0) {
          const displayField = col.displayField || col.fields?.[0]?.key || 'id';
          const recent = items.slice(0, 3).map((it: any) => ({
            ...it,
            _collectionName: col.name,
            _displayValue: it[displayField] || it.fullName || it.name || it.id
          }));
          this.recentItems.push(...recent);
        }
        return { name: col.name, slug: col.slug, count: items.length, pending, pct: 0, icon: icons[i % icons.length] };
      });

      this.collectionStats = await Promise.all(statsPromises);
      const maxCount = Math.max(...this.collectionStats.map(c => c.count), 1);
      this.collectionStats = this.collectionStats.map(c => ({ ...c, pct: Math.round((c.count / maxCount) * 100) }));

      this.recentItems.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      this.recentItems = this.recentItems.slice(0, 8);

      // Onboarding
      const hasName = !!(infoGeneral?.name?.trim());
      const hasDesc = !!(infoGeneral?.description?.trim());
      this.step1Done = hasName && hasDesc;
      if (!hasName && !hasDesc) this.step1Missing = 'Falta el nombre y descripción de tu empresa';
      else if (!hasName) this.step1Missing = 'Falta el nombre de tu empresa';
      else if (!hasDesc) this.step1Missing = 'Falta la descripción de tu empresa';
      this.step2Done = this.totalFlows > 0;
      this.step2Missing = 'Aún no has creado ningún flujo del bot';
      this.step3Done = !!(menuConfig?.greeting?.trim());
      this.step3Missing = 'El mensaje de saludo del bot no está configurado';
      this.showOnboarding = !this.step1Done || !this.step2Done || !this.step3Done;
    } catch (err) {
      console.error('Error loading dashboard:', err);
    } finally {
      this.loading = false;
    }
  }

  get limitPct(): number {
    if (!this.dailyBulkLimit) return 0;
    return Math.min(100, Math.round((this.totalSentToday / this.dailyBulkLimit) * 100));
  }

  get limitConicStyle(): string {
    return `conic-gradient(#7c3aed ${this.limitPct}%, #e2e8f0 0)`;
  }

  getGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 18) return 'Buenas tardes';
    return 'Buenas noches';
  }

  formatDate(timestamp: any): string {
    if (!timestamp?.seconds) return '—';
    return new Date(timestamp.seconds * 1000).toLocaleDateString('es', { day: '2-digit', month: 'short' });
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente', converted: 'Convertido', rejected: 'Rechazado',
      resolved: 'Resuelto', active: 'Activo', confirmed: 'Confirmado', cancelled: 'Cancelado'
    };
    return labels[status] || status || '—';
  }

  campaignTypeLabel(type: string): string {
    const m: Record<string, string> = { immediate: 'Inmediato', once: 'Una vez', daily: 'Diario', interval: 'Intervalo' };
    return m[type] || type;
  }
}
