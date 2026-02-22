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
  collectionStats: { name: string; slug: string; count: number; icon: string }[] = [];
  recentItems: any[] = [];
  loading = true;
  planName = '';
  planLimits: any = { flows: 0, collections: 0, admins: 0, chatLive: false };
  isNewOrg = false;
  botEnabled = true;

  constructor(private firebaseService: FirebaseService, public authService: AuthService) {
    this.planName = this.authService.orgPlan || 'Sin plan';
    this.planLimits = this.authService.getPlanLimits();
    this.botEnabled = this.authService.botEnabled;
  }

  async ngOnInit(): Promise<void> {
    try {
      const [admins, flows, colDefs] = await Promise.all([
        this.firebaseService.getAdmins(),
        this.firebaseService.getFlows(),
        this.firebaseService.getCollectionDefs()
      ]);

      this.totalAdmins = admins.length;
      this.totalFlows = flows.length;
      this.totalCollections = colDefs.length;

      const icons = ['fa-layer-group', 'fa-users', 'fa-folder', 'fa-archive', 'fa-clipboard-list', 'fa-tags'];
      const statsPromises = colDefs.map(async (col: any, i: number) => {
        const items = await this.firebaseService.getCollectionData(col.slug);
        const pending = items.filter((it: any) => it.status === 'pending').length;
        if (items.length > 0) {
          const displayField = col.displayField || col.fields?.[0]?.key || 'id';
          const recent = items.slice(0, 3).map((it: any) => ({
            ...it,
            _collectionName: col.name,
            _displayValue: it[displayField] || it.fullName || it.name || it.id
          }));
          this.recentItems.push(...recent);
        }
        return { name: col.name, slug: col.slug, count: items.length, pending, icon: icons[i % icons.length] };
      });

      this.collectionStats = await Promise.all(statsPromises);
      this.recentItems.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      this.recentItems = this.recentItems.slice(0, 5);

      this.isNewOrg = this.totalFlows === 0 && this.totalCollections === 0;
    } catch (err) {
      console.error('Error loading dashboard:', err);
    } finally {
      this.loading = false;
    }
  }

  formatDate(timestamp: any): string {
    if (!timestamp?.seconds) return 'N/A';
    return new Date(timestamp.seconds * 1000).toLocaleDateString('es', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      converted: 'Convertido',
      rejected: 'Rechazado',
      resolved: 'Resuelto',
      active: 'Activo'
    };
    return labels[status] || status || '-';
  }
}
