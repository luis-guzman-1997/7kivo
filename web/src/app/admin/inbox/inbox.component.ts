import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

interface FlowTab {
  flowId: string;
  flowName: string;
  collection: string;
  type: string;
  submissions: any[];
  filteredSubmissions: any[];
  loading: boolean;
  unreadCount: number;
}

@Component({
  selector: 'app-inbox',
  templateUrl: './inbox.component.html',
  styleUrls: ['./inbox.component.css']
})
export class InboxComponent implements OnInit {
  tabs: FlowTab[] = [];
  activeTabIndex = 0;
  loading = true;
  searchTerm = '';
  statusFilter = 'all';

  selectedItem: any = null;
  selectedTab: FlowTab | null = null;

  constructor(private firebaseService: FirebaseService) {}

  async ngOnInit(): Promise<void> {
    await this.loadFlows();
  }

  async loadFlows(): Promise<void> {
    this.loading = true;
    try {
      const flows = await this.firebaseService.getFlows();

      // Filtrar flujos que tienen saveToCollection y NO son "applicants" (esos van en Aspirantes)
      const inboxFlows = flows.filter(f =>
        f.saveToCollection && f.saveToCollection !== 'applicants'
      );

      this.tabs = inboxFlows.map(f => ({
        flowId: f.id,
        flowName: f.name,
        collection: f.saveToCollection,
        type: f.type,
        submissions: [],
        filteredSubmissions: [],
        loading: true,
        unreadCount: 0
      }));

      // Cargar submissions de cada tab en paralelo
      await Promise.all(this.tabs.map(tab => this.loadTabSubmissions(tab)));
    } catch (err) {
      console.error('Error loading flows:', err);
    } finally {
      this.loading = false;
    }
  }

  async loadTabSubmissions(tab: FlowTab): Promise<void> {
    tab.loading = true;
    try {
      const items = await this.firebaseService.getFlowSubmissions(tab.collection);
      tab.submissions = items;
      tab.unreadCount = items.filter(i => i.status === 'pending').length;
      this.applyFilters(tab);
    } catch (err) {
      console.error(`Error loading ${tab.collection}:`, err);
      tab.submissions = [];
      tab.filteredSubmissions = [];
    } finally {
      tab.loading = false;
    }
  }

  get activeTab(): FlowTab | null {
    return this.tabs[this.activeTabIndex] || null;
  }

  get totalUnread(): number {
    return this.tabs.reduce((sum, t) => sum + t.unreadCount, 0);
  }

  switchTab(index: number): void {
    this.activeTabIndex = index;
    this.searchTerm = '';
    this.statusFilter = 'all';
    if (this.activeTab) {
      this.applyFilters(this.activeTab);
    }
  }

  applyFilters(tab?: FlowTab): void {
    const t = tab || this.activeTab;
    if (!t) return;

    let filtered = [...t.submissions];

    if (this.statusFilter !== 'all') {
      filtered = filtered.filter(s => s.status === this.statusFilter);
    }

    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(s => {
        return Object.values(s).some(val =>
          typeof val === 'string' && val.toLowerCase().includes(term)
        );
      });
    }

    t.filteredSubmissions = filtered;
  }

  async markAsRead(item: any, tab: FlowTab): Promise<void> {
    if (item.status === 'pending') {
      try {
        await this.firebaseService.updateDocument(tab.collection, item.id, { status: 'read' });
        item.status = 'read';
        tab.unreadCount = tab.submissions.filter(i => i.status === 'pending').length;
      } catch (err) {
        console.error('Error updating status:', err);
      }
    }
  }

  async markAsResolved(item: any, tab: FlowTab): Promise<void> {
    try {
      await this.firebaseService.updateDocument(tab.collection, item.id, { status: 'resolved' });
      item.status = 'resolved';
      tab.unreadCount = tab.submissions.filter(i => i.status === 'pending').length;
      this.applyFilters(tab);
    } catch (err) {
      console.error('Error updating status:', err);
    }
  }

  openDetail(item: any, tab: FlowTab): void {
    this.selectedItem = item;
    this.selectedTab = tab;
    this.markAsRead(item, tab);
  }

  closeDetail(): void {
    this.selectedItem = null;
    this.selectedTab = null;
  }

  getPersonName(item: any): string {
    return item.fullName || item.name || item.nombre || 'Sin nombre';
  }

  getItemFields(item: any): { label: string; value: string }[] {
    const fields: { label: string; value: string }[] = [];
    const skip = ['id', 'status', 'createdAt', 'updatedAt', 'schoolId',
                   'flowId', 'flowName', 'phoneNumber'];

    for (const [key, val] of Object.entries(item)) {
      if (skip.includes(key) || val === null || val === undefined || val === '') continue;
      if (typeof val === 'object') continue;
      fields.push({ label: this.fieldLabel(key), value: String(val) });
    }
    return fields;
  }

  fieldLabel(key: string): string {
    const labels: Record<string, string> = {
      fullName: 'Nombre Completo', name: 'Nombre', age: 'Edad',
      courseType: 'Tipo de Curso', instrument: 'Instrumento',
      comment: 'Comentario', email: 'Email', message: 'Mensaje',
      question: 'Pregunta', subject: 'Asunto'
    };
    return labels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  }

  getWhatsAppLink(phone: string): string {
    const cleaned = phone?.replace(/[^0-9]/g, '') || '';
    return `https://wa.me/${cleaned}`;
  }

  getWhatsAppMessageLink(phone: string, name: string): string {
    const cleaned = phone?.replace(/[^0-9]/g, '') || '';
    const msg = encodeURIComponent(`Hola ${name}, respecto a tu consulta en Instituto CanZion Sonsonate. `);
    return `https://wa.me/${cleaned}?text=${msg}`;
  }

  formatDate(timestamp: any): string {
    if (!timestamp?.seconds) return 'N/A';
    return new Date(timestamp.seconds * 1000).toLocaleDateString('es-SV', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Nuevo', read: 'Leído', resolved: 'Resuelto'
    };
    return labels[status] || status;
  }

  getTabIcon(type: string): string {
    const icons: Record<string, string> = {
      inquiry: 'fa-comments', feedback: 'fa-star', registration: 'fa-user-plus', custom: 'fa-cogs'
    };
    return icons[type] || 'fa-inbox';
  }
}
