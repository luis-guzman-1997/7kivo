import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-students',
  templateUrl: './students.component.html',
  styleUrls: ['./students.component.css']
})
export class StudentsComponent implements OnInit {
  activeTab: 'contacts' | 'clients' = 'contacts';

  contacts: any[] = [];
  filteredContacts: any[] = [];
  clients: any[] = [];
  filteredClients: any[] = [];

  loading = true;
  saving = false;
  notice = '';
  error = '';
  searchTerm = '';
  statusFilter = 'all';
  selectedPerson: any = null;
  selectedType: 'contact' | 'client' = 'contact';
  orgName = '';

  constructor(
    private firebaseService: FirebaseService,
    private authService: AuthService
  ) {}

  async ngOnInit(): Promise<void> {
    this.orgName = this.authService.orgName;
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    this.loading = true;
    try {
      const [contacts, clients] = await Promise.all([
        this.firebaseService.getContacts(),
        this.firebaseService.getClients()
      ]);
      this.contacts = contacts;
      this.clients = clients;
      this.applyFilters();
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      this.loading = false;
    }
  }

  applyFilters(): void {
    if (this.activeTab === 'contacts') {
      let filtered = [...this.contacts];
      if (this.statusFilter !== 'all') {
        filtered = filtered.filter(a => a.status === this.statusFilter);
      }
      if (this.searchTerm.trim()) {
        const term = this.searchTerm.toLowerCase();
        filtered = filtered.filter(a =>
          a.fullName?.toLowerCase().includes(term) ||
          a.name?.toLowerCase().includes(term) ||
          a.phoneNumber?.includes(term)
        );
      }
      this.filteredContacts = filtered;
    } else {
      let filtered = [...this.clients];
      if (this.statusFilter !== 'all') {
        filtered = filtered.filter(s => s.status === this.statusFilter);
      }
      if (this.searchTerm.trim()) {
        const term = this.searchTerm.toLowerCase();
        filtered = filtered.filter(s =>
          s.fullName?.toLowerCase().includes(term) ||
          s.name?.toLowerCase().includes(term) ||
          s.phoneNumber?.includes(term)
        );
      }
      this.filteredClients = filtered;
    }
  }

  switchTab(tab: 'contacts' | 'clients'): void {
    this.activeTab = tab;
    this.statusFilter = 'all';
    this.searchTerm = '';
    this.applyFilters();
  }

  async updateContactStatus(contact: any, newStatus: string): Promise<void> {
    try {
      await this.firebaseService.updateContactStatus(contact.id, newStatus);
      contact.status = newStatus;
      this.applyFilters();
    } catch (err) {
      this.error = 'Error al actualizar estado';
      setTimeout(() => this.error = '', 3000);
    }
  }

  async convertContact(contact: any): Promise<void> {
    if (!confirm(`¿Convertir a "${this.getPersonName(contact)}" en cliente?`)) return;
    this.saving = true;
    try {
      await this.firebaseService.convertContact(contact);
      contact.status = 'converted';
      this.notice = `"${this.getPersonName(contact)}" convertido a cliente`;
      await this.loadAll();
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al convertir contacto';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  async rejectContact(contact: any): Promise<void> {
    try {
      await this.firebaseService.updateContactStatus(contact.id, 'rejected');
      contact.status = 'rejected';
      this.applyFilters();
    } catch (err) {
      this.error = 'Error al rechazar contacto';
      setTimeout(() => this.error = '', 3000);
    }
  }

  getPersonName(person: any): string {
    return person.fullName || person.name || 'Sin nombre';
  }

  getPersonFields(person: any): { label: string; value: string }[] {
    const fields: { label: string; value: string }[] = [];
    const skip = ['id', 'status', 'createdAt', 'updatedAt', 'organizationId', 'schoolId', 'flowId',
                   'flowName', 'phoneNumber', 'contactId', 'convertedAt', 'clientId', 'applicantId', 'acceptedAt', 'studentId'];

    for (const [key, val] of Object.entries(person)) {
      if (skip.includes(key) || val === null || val === undefined || val === '') continue;
      if (typeof val === 'object') continue;
      fields.push({ label: this.fieldLabel(key), value: String(val) });
    }
    return fields;
  }

  fieldLabel(key: string): string {
    const labels: Record<string, string> = {
      fullName: 'Nombre Completo',
      name: 'Nombre',
      age: 'Edad',
      email: 'Email',
      comment: 'Comentario',
      message: 'Mensaje'
    };
    return labels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  }

  getWhatsAppLink(phone: string): string {
    const cleaned = phone?.replace(/[^0-9]/g, '') || '';
    return `https://wa.me/${cleaned}`;
  }

  getWhatsAppMessageLink(phone: string, name: string): string {
    const cleaned = phone?.replace(/[^0-9]/g, '') || '';
    const orgText = this.orgName ? ` de ${this.orgName}` : '';
    const message = encodeURIComponent(`Hola ${name}, nos comunicamos${orgText}. `);
    return `https://wa.me/${cleaned}?text=${message}`;
  }

  formatDate(timestamp: any): string {
    if (!timestamp?.seconds) return 'N/A';
    return new Date(timestamp.seconds * 1000).toLocaleDateString('es', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  getContactStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      converted: 'Convertido',
      rejected: 'Rechazado'
    };
    return labels[status] || status;
  }

  getClientStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Activo',
      inactive: 'Inactivo',
      completed: 'Completado'
    };
    return labels[status] || status;
  }

  openDetail(person: any, type: 'contact' | 'client'): void {
    this.selectedPerson = person;
    this.selectedType = type;
  }

  closeDetail(): void {
    this.selectedPerson = null;
  }

  get pendingCount(): number {
    return this.contacts.filter(a => a.status === 'pending').length;
  }

  get convertedCount(): number {
    return this.contacts.filter(a => a.status === 'converted').length;
  }

  get totalClientsCount(): number {
    return this.clients.length;
  }
}
