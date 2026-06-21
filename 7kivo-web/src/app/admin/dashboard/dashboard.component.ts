import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService, RoleInfo } from '../../services/auth.service';

interface AcctRow {
  uid: string; name: string; balance: number;
  paid: number; gift: number;
  commissions: number; commissionsPaid: number; commissionsGift: number; refunds: number;
  orders: number;            // pedidos cobrados en el período
  debits: any[];
}
interface AcctTotals {
  paid: number; gift: number;
  commissions: number; commissionsPaid: number; commissionsGift: number; refunds: number;
  balance: number; orders: number;
}

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

  // Delivery stats
  deliveryAvailable = 0;
  deliveryActive = 0;
  deliveryResolvedToday = 0;
  deliveryResolvedTotal = 0;
  deliveryCancelledTotal = 0;
  deliveryActiveItem: any = null;
  deliveryActiveTab: string = '';

  // ── Contabilidad de deliveries (owner/admin, org delivery) ──
  acctRows: AcctRow[] = [];
  acctTotals: AcctTotals = { paid: 0, gift: 0, commissions: 0, commissionsPaid: 0, commissionsGift: 0, refunds: 0, balance: 0, orders: 0 };

  // Filtro de período para la contabilidad por delivery
  acctPeriod: 'today' | 'week' | 'month' | 'all' | 'custom' = 'month';
  acctFrom = '';   // yyyy-mm-dd
  acctTo = '';     // yyyy-mm-dd
  private allLedger: any[] = [];
  private wallets: Record<string, number> = {};
  ordersByDay: { label: string; count: number }[] = [];
  private deliveryOrderCounts: Record<string, { today: number; total: number }> = {};
  private ordersByDayMap: Record<string, number> = {};
  private deliveryAdmins: any[] = [];

  // Edición de comisiones
  expandedAcctUid: string | null = null;
  cmToDelete: any = null;          // transacción (debit) a eliminar
  cmDeleting = false;

  get isDelivery(): boolean {
    const r = this.authService.userRole;
    return r === 'delivery' || r === 'delivery_multi';
  }

  get isManager(): boolean {
    const r = this.authService.userRole;
    return r === 'owner' || r === 'admin';
  }

  get isDeliveryOrg(): boolean {
    return this.authService.orgIndustry === 'delivery';
  }

  get showAccounting(): boolean {
    return this.isManager && this.isDeliveryOrg;
  }

  get maxOrdersByDay(): number {
    return Math.max(...this.ordersByDay.map(d => d.count), 1);
  }

  // Guía de rol: qué puede hacer el usuario según su perfil
  get roleInfo(): RoleInfo {
    return this.authService.getRoleInfo();
  }
  roleGuideDismissed = false;

  dismissRoleGuide(): void {
    this.roleGuideDismissed = true;
    try {
      localStorage.setItem('roleGuideDismissed_' + this.authService.userRole, '1');
    } catch {}
  }

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
    try {
      this.roleGuideDismissed = localStorage.getItem('roleGuideDismissed_' + this.authService.userRole) === '1';
    } catch {}

    const now = new Date();
    this.todayLabel = now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  async ngOnInit(): Promise<void> {
    if (this.isDelivery) {
      await this.loadDeliveryStats();
      return;
    }
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

        // Tallado para contabilidad de deliveries
        if (this.showAccounting) {
          items.forEach((it: any) => {
            const created = it.createdAt?.seconds || 0;
            if (created) {
              const dk = this.dayKey(created);
              this.ordersByDayMap[dk] = (this.ordersByDayMap[dk] || 0) + 1;
            }
            const uid = it.assignedTo?.uid;
            if (uid) {
              if (!this.deliveryOrderCounts[uid]) this.deliveryOrderCounts[uid] = { today: 0, total: 0 };
              this.deliveryOrderCounts[uid].total++;
              const ref = it.assignedAt?.seconds || created;
              if (ref >= todayTs) this.deliveryOrderCounts[uid].today++;
            }
          });
        }

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

      // Contabilidad de deliveries
      if (this.showAccounting) {
        this.deliveryAdmins = admins.filter((a: any) => a.role === 'delivery' || a.role === 'delivery_multi');
        await this.loadDeliveryAccounting();
      }

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

  async loadDeliveryStats(): Promise<void> {
    try {
      const uid = this.authService.currentUser?.uid;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTs = today.getTime() / 1000;

      const flows = await this.firebaseService.getFlows();
      const inboxFlows = flows.filter((f: any) =>
        f.saveToCollection && f.saveToCollection !== 'applicants' && f.saveToCollection !== 'contacts'
      );

      for (const flow of inboxFlows) {
        const items = await this.firebaseService.getFlowSubmissions(flow.saveToCollection);
        for (const item of items) {
          const isCancelled = item.status === 'resolved' && item.resolvedBy?.name === 'Sin disponibilidad';
          if (!item.assignedTo && item.status !== 'resolved') {
            this.deliveryAvailable++;
          }
          if (item.assignedTo?.uid === uid) {
            if (item.status !== 'resolved') {
              this.deliveryActive++;
              if (!this.deliveryActiveItem) {
                this.deliveryActiveItem = item;
                this.deliveryActiveTab = flow.saveToCollection;
              }
            } else {
              if (isCancelled) {
                this.deliveryCancelledTotal++;
              } else {
                this.deliveryResolvedTotal++;
                if ((item.updatedAt?.seconds || item.createdAt?.seconds || 0) >= todayTs) {
                  this.deliveryResolvedToday++;
                }
              }
            }
          } else if (isCancelled) {
            this.deliveryCancelledTotal++;
          }
        }
      }

      this.totalConversations = this.deliveryResolvedTotal;
    } catch (err) {
      console.error('Error loading delivery stats:', err);
    } finally {
      this.loading = false;
    }
  }

  async loadDeliveryAccounting(): Promise<void> {
    try {
      const [wallets, ledger] = await Promise.all([
        this.firebaseService.getDeliveryWallets(),
        this.firebaseService.getCreditTransactions()
      ]);
      this.wallets = wallets;
      this.allLedger = ledger;
      this.buildOrdersByDay();
      this.recomputeAccounting();
    } catch (err) {
      console.error('Error loading delivery accounting:', err);
    }
  }

  // Rango [desde, hasta] en segundos unix según el filtro seleccionado.
  private periodBounds(): { from: number; to: number } {
    if (this.acctPeriod === 'all') return { from: 0, to: Infinity };
    if (this.acctPeriod === 'custom') {
      const from = this.acctFrom ? new Date(this.acctFrom + 'T00:00:00').getTime() / 1000 : 0;
      const to = this.acctTo ? new Date(this.acctTo + 'T23:59:59').getTime() / 1000 : Infinity;
      return { from, to };
    }
    const d = new Date();
    if (this.acctPeriod === 'today') d.setHours(0, 0, 0, 0);
    else if (this.acctPeriod === 'week') d.setDate(d.getDate() - 7);
    else if (this.acctPeriod === 'month') d.setDate(d.getDate() - 30);
    return { from: d.getTime() / 1000, to: Infinity };
  }

  setAcctPeriod(p: 'today' | 'week' | 'month' | 'all' | 'custom'): void {
    this.acctPeriod = p;
    if (p !== 'custom') this.recomputeAccounting();
  }

  applyCustomRange(): void {
    this.acctPeriod = 'custom';
    this.recomputeAccounting();
  }

  recomputeAccounting(): void {
    const { from, to } = this.periodBounds();
    const byUid: Record<string, AcctRow> = {};
    const blank = (uid: string, name: string): AcctRow => ({
      uid, name, balance: this.wallets[uid] || 0,
      paid: 0, gift: 0, commissions: 0, commissionsPaid: 0, commissionsGift: 0, refunds: 0, orders: 0, debits: []
    });
    this.deliveryAdmins.forEach(a => { byUid[a.uid] = blank(a.uid, a.name || a.email || '—'); });

    this.allLedger.forEach((t: any) => {
      const ts = t.createdAt?.seconds || 0;
      if (ts < from || ts > to) return;   // fuera del período
      const uid = t.deliveryUid;
      if (!uid) return;
      if (!byUid[uid]) byUid[uid] = blank(uid, t.deliveryName || '—');
      const row = byUid[uid];
      const amt = t.amount || 0;
      if (t.type === 'recharge' || t.type === 'adjustment') {
        if (t.source === 'paid') row.paid += amt; else row.gift += amt;
      } else if (t.type === 'debit') {
        let fp: number, fg: number;
        if (typeof t.fromPaid === 'number' || typeof t.fromGift === 'number') {
          fp = t.fromPaid || 0; fg = t.fromGift || 0;
        } else { fp = amt; fg = 0; }
        row.commissions += amt;
        row.commissionsPaid += fp;
        row.commissionsGift += fg;
        row.orders += 1;
        row.debits.push(t);
      } else if (t.type === 'reversal') {
        row.commissions -= amt;
        row.commissionsPaid -= (t.fromPaid || 0);
        row.commissionsGift -= (t.fromGift || 0);
        row.orders -= 1;
      } else if (t.type === 'refund') {
        row.refunds += amt;
      }
    });

    this.acctRows = Object.values(byUid).sort((a, b) => b.commissions - a.commissions);
    this.acctTotals = this.acctRows.reduce((t, r) => ({
      paid: t.paid + r.paid, gift: t.gift + r.gift,
      commissions: t.commissions + r.commissions,
      commissionsPaid: t.commissionsPaid + r.commissionsPaid,
      commissionsGift: t.commissionsGift + r.commissionsGift,
      refunds: t.refunds + r.refunds, balance: t.balance + r.balance,
      orders: t.orders + r.orders
    }), { paid: 0, gift: 0, commissions: 0, commissionsPaid: 0, commissionsGift: 0, refunds: 0, balance: 0, orders: 0 });
  }

  private dayKey(seconds: number): string {
    const d = new Date(seconds * 1000);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  private buildOrdersByDay(): void {
    const days: { label: string; count: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      days.push({
        label: d.toLocaleDateString('es', { weekday: 'short', day: 'numeric' }),
        count: this.ordersByDayMap[key] || 0
      });
    }
    this.ordersByDay = days;
  }

  toggleAcctExpand(uid: string): void {
    this.expandedAcctUid = this.expandedAcctUid === uid ? null : uid;
  }

  openRemoveCommission(tx: any): void { this.cmToDelete = tx; }
  closeRemoveCommission(): void { this.cmToDelete = null; }

  async confirmRemove(mode: 'reverse' | 'delete' | 'void'): Promise<void> {
    if (!this.cmToDelete || this.cmDeleting) return;
    this.cmDeleting = true;
    try {
      const by = {
        uid: this.authService.currentUser?.uid || '',
        name: this.authService.currentUser?.displayName || this.authService.currentUser?.email || ''
      };
      await this.firebaseService.removeCommission(this.cmToDelete, mode, by);
      this.cmToDelete = null;
      await this.loadDeliveryAccounting();   // refrescar totales y listas
    } catch (e) {
      console.error('Error eliminando comisión:', e);
    } finally {
      this.cmDeleting = false;
    }
  }

  getPersonName(item: any): string {
    return item?.fullName || item?.name || item?.nombre || 'Sin nombre';
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
