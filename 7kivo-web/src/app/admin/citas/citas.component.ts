import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-citas',
  templateUrl: './citas.component.html',
  styleUrls: ['./citas.component.css']
})
export class CitasComponent implements OnInit {
  collections: { slug: string; name: string }[] = [];
  selectedSlug = '';
  items: any[] = [];
  loading = false;
  notice = '';
  error = '';

  filterStatus = 'all';
  filterFrom = '';
  filterTo = '';

  cancellingId: string | null = null;
  detailItem: any = null;

  botApiUrl = '';

  constructor(private firebaseService: FirebaseService) {}

  async ngOnInit(): Promise<void> {
    const today = new Date();
    this.filterFrom = this.toDateStr(today);
    const next30 = new Date(today);
    next30.setDate(next30.getDate() + 30);
    this.filterTo = this.toDateStr(next30);

    this.collections = await this.firebaseService.getAppointmentCollections();
    if (this.collections.length > 0) {
      this.selectedSlug = this.collections[0].slug;
      await this.loadItems();
    }

    try {
      const config = await this.firebaseService.getOrgConfig();
      this.botApiUrl = config?.botApiUrl?.replace(/\/$/, '') || '';
    } catch (_) {}
  }

  async loadItems(): Promise<void> {
    if (!this.selectedSlug) return;
    this.loading = true;
    try {
      this.items = await this.firebaseService.getAppointmentItems(
        this.selectedSlug, this.filterFrom, this.filterTo, this.filterStatus
      );
    } catch (err) {
      this.error = 'Error al cargar citas';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.loading = false;
    }
  }

  async cancelItem(item: any): Promise<void> {
    if (!confirm(`¿Cancelar la cita del ${item._apptFecha} a las ${item._apptHora}?`)) return;
    this.cancellingId = item.id;
    try {
      if (item.gcEventId && this.botApiUrl) {
        try {
          await fetch(`${this.botApiUrl}/api/appointments/cancel-gcal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gcEventId: item.gcEventId })
          });
        } catch (_) {}
      }
      await this.firebaseService.cancelAppointmentItem(this.selectedSlug, item.id);
      item.status = 'cancelled';
      this.showNotice('Cita cancelada');
    } catch (_) {
      this.error = 'Error al cancelar';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.cancellingId = null;
    }
  }

  setQuickFilter(range: 'today' | 'week' | 'month' | 'all'): void {
    const today = new Date();
    this.filterFrom = '';
    this.filterTo = '';
    if (range === 'today') {
      this.filterFrom = this.toDateStr(today);
      this.filterTo = this.toDateStr(today);
    } else if (range === 'week') {
      const end = new Date(today);
      end.setDate(end.getDate() + 7);
      this.filterFrom = this.toDateStr(today);
      this.filterTo = this.toDateStr(end);
    } else if (range === 'month') {
      const end = new Date(today);
      end.setDate(end.getDate() + 30);
      this.filterFrom = this.toDateStr(today);
      this.filterTo = this.toDateStr(end);
    }
    this.loadItems();
  }

  statusLabel(status: string): string {
    const map: any = { confirmed: 'Confirmada', pending: 'Pendiente', cancelled: 'Cancelada' };
    return map[status] || status || 'Pendiente';
  }

  statusClass(status: string): string {
    const map: any = { confirmed: 'badge-confirmed', pending: 'badge-pending', cancelled: 'badge-cancelled' };
    return map[status] || 'badge-pending';
  }

  getExtraFields(item: any): { key: string; value: any }[] {
    const skip = new Set(['id', '_apptFecha', '_apptHora', '_apptDuration', '_apptService', 'status',
      'organizationId', 'flowId', 'flowName', 'phoneNumber', 'createdAt', 'updatedAt', 'gcEventId']);
    return Object.entries(item)
      .filter(([k]) => !skip.has(k) && !k.endsWith('Id'))
      .map(([key, value]) => ({ key, value: value as any }));
  }

  openDetail(item: any): void { this.detailItem = item; }
  closeDetail(): void { this.detailItem = null; }

  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private showNotice(msg: string): void {
    this.notice = msg;
    setTimeout(() => this.notice = '', 3000);
  }

  get filteredItems(): any[] {
    if (this.filterStatus === 'all') return this.items;
    return this.items.filter(i => (i.status || 'pending') === this.filterStatus);
  }

  get counts() {
    return {
      all: this.items.length,
      confirmed: this.items.filter(i => i.status === 'confirmed').length,
      pending: this.items.filter(i => !i.status || i.status === 'pending').length,
      cancelled: this.items.filter(i => i.status === 'cancelled').length
    };
  }
}
