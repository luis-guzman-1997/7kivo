import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  stats = {
    totalContacts: 0,
    pendingContacts: 0,
    convertedContacts: 0,
    totalClients: 0,
    totalAdmins: 0
  };
  recentContacts: any[] = [];
  loading = true;

  constructor(private firebaseService: FirebaseService) {}

  async ngOnInit(): Promise<void> {
    try {
      const [contacts, clients, admins] = await Promise.all([
        this.firebaseService.getContacts(),
        this.firebaseService.getClients(),
        this.firebaseService.getAdmins()
      ]);

      this.stats.totalContacts = contacts.length;
      this.stats.pendingContacts = contacts.filter(a => a.status === 'pending').length;
      this.stats.convertedContacts = contacts.filter(a => a.status === 'converted').length;
      this.stats.totalClients = clients.length;
      this.stats.totalAdmins = admins.length;
      this.recentContacts = contacts.slice(0, 5);
    } catch (err) {
      console.error('Error loading dashboard:', err);
    } finally {
      this.loading = false;
    }
  }

  getPersonName(person: any): string {
    return person.fullName || person.name || 'Sin nombre';
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
      rejected: 'Rechazado'
    };
    return labels[status] || status;
  }
}
