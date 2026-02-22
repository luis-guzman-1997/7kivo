import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-sa-billing',
  templateUrl: './sa-billing.component.html',
  styleUrls: ['./sa-billing.component.css']
})
export class SaBillingComponent implements OnInit {
  billingRecords: any[] = [];
  filteredRecords: any[] = [];
  organizations: any[] = [];
  loading = true;
  searchTerm = '';
  filterStatus = 'all';

  showForm = false;
  editingRecord: any = null;
  form = { orgId: '', orgName: '', amount: 0, period: '', status: 'pending', dueDate: '', notes: '' };
  saving = false;

  totalPending = 0;
  totalPaid = 0;
  totalOverdue = 0;

  constructor(private firebaseService: FirebaseService) {}

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading = true;
    try {
      const [records, orgs] = await Promise.all([
        this.firebaseService.getPlatformBilling(),
        this.firebaseService.getAllOrganizations()
      ]);
      this.billingRecords = records;
      this.organizations = orgs.sort((a: any, b: any) =>
        (a.name || a.id || '').localeCompare(b.name || b.id || '')
      );
      this.calculateTotals();
      this.applyFilter();
    } catch (err) {
      console.error('Error loading billing:', err);
    } finally {
      this.loading = false;
    }
  }

  calculateTotals(): void {
    this.totalPending = this.billingRecords.filter(r => r.status === 'pending').reduce((s, r) => s + (r.amount || 0), 0);
    this.totalPaid = this.billingRecords.filter(r => r.status === 'paid').reduce((s, r) => s + (r.amount || 0), 0);
    this.totalOverdue = this.billingRecords.filter(r => r.status === 'overdue').reduce((s, r) => s + (r.amount || 0), 0);
  }

  applyFilter(): void {
    let list = [...this.billingRecords];
    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      list = list.filter(r =>
        (r.orgName || '').toLowerCase().includes(term) ||
        (r.period || '').includes(term)
      );
    }
    if (this.filterStatus !== 'all') {
      list = list.filter(r => r.status === this.filterStatus);
    }
    this.filteredRecords = list;
  }

  openNewRecord(): void {
    this.editingRecord = null;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    this.form = {
      orgId: '', orgName: '', amount: 0,
      period: `${year}-${month}`,
      status: 'pending',
      dueDate: '',
      notes: ''
    };
    this.showForm = true;
  }

  editRecord(record: any): void {
    this.editingRecord = record;
    this.form = {
      orgId: record.orgId || '',
      orgName: record.orgName || '',
      amount: record.amount || 0,
      period: record.period || '',
      status: record.status || 'pending',
      dueDate: record.dueDate || '',
      notes: record.notes || ''
    };
    this.showForm = true;
  }

  onOrgSelected(): void {
    const org = this.organizations.find((o: any) => o.id === this.form.orgId);
    if (org) {
      this.form.orgName = org.name || org.id;
      this.form.amount = org.monthlyRate || 0;
    }
  }

  closeForm(): void {
    this.showForm = false;
    this.editingRecord = null;
  }

  async saveRecord(): Promise<void> {
    if (!this.form.orgId || !this.form.period) return;
    this.saving = true;
    try {
      const data: any = {
        orgId: this.form.orgId,
        orgName: this.form.orgName,
        amount: this.form.amount,
        period: this.form.period,
        status: this.form.status,
        dueDate: this.form.dueDate,
        notes: this.form.notes
      };
      if (this.form.status === 'paid' && !this.editingRecord?.paidAt) {
        data.paidAt = new Date().toISOString();
      }
      if (this.editingRecord) {
        await this.firebaseService.updatePlatformBilling(this.editingRecord.id, data);
      } else {
        await this.firebaseService.addPlatformBilling(data);
      }
      this.closeForm();
      await this.loadData();
    } catch (err) {
      console.error('Error saving billing:', err);
    } finally {
      this.saving = false;
    }
  }

  async markAsPaid(record: any): Promise<void> {
    try {
      await this.firebaseService.updatePlatformBilling(record.id, {
        status: 'paid',
        paidAt: new Date().toISOString()
      });
      record.status = 'paid';
      record.paidAt = new Date().toISOString();
      this.calculateTotals();
      this.applyFilter();
    } catch (err) {
      console.error('Error marking as paid:', err);
    }
  }

  async markAsOverdue(record: any): Promise<void> {
    try {
      await this.firebaseService.updatePlatformBilling(record.id, { status: 'overdue' });
      record.status = 'overdue';
      this.calculateTotals();
      this.applyFilter();
    } catch (err) {
      console.error('Error marking as overdue:', err);
    }
  }

  async deleteRecord(record: any): Promise<void> {
    if (!confirm('¿Eliminar este registro de facturación?')) return;
    try {
      await this.firebaseService.deletePlatformBilling(record.id);
      await this.loadData();
    } catch (err) {
      console.error('Error deleting billing:', err);
    }
  }

  getStatusLabel(status: string): string {
    const map: Record<string, string> = { pending: 'Pendiente', paid: 'Pagado', overdue: 'Vencido' };
    return map[status] || status;
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('es');
  }

  formatCreatedDate(record: any): string {
    if (!record.createdAt?.seconds) return '—';
    return new Date(record.createdAt.seconds * 1000).toLocaleDateString('es');
  }
}
