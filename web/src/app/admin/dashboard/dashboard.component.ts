import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  stats = {
    totalApplicants: 0,
    pendingApplicants: 0,
    acceptedApplicants: 0,
    totalStudents: 0,
    totalAdmins: 0
  };
  recentApplicants: any[] = [];
  loading = true;

  constructor(private firebaseService: FirebaseService) {}

  async ngOnInit(): Promise<void> {
    try {
      const [applicants, students, admins] = await Promise.all([
        this.firebaseService.getApplicants(),
        this.firebaseService.getStudents(),
        this.firebaseService.getAdmins()
      ]);

      this.stats.totalApplicants = applicants.length;
      this.stats.pendingApplicants = applicants.filter(a => a.status === 'pending').length;
      this.stats.acceptedApplicants = applicants.filter(a => a.status === 'accepted').length;
      this.stats.totalStudents = students.length;
      this.stats.totalAdmins = admins.length;
      this.recentApplicants = applicants.slice(0, 5);
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
    return new Date(timestamp.seconds * 1000).toLocaleDateString('es-SV', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      accepted: 'Aceptado',
      rejected: 'Rechazado'
    };
    return labels[status] || status;
  }
}
