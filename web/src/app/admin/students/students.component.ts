import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-students',
  templateUrl: './students.component.html',
  styleUrls: ['./students.component.css']
})
export class StudentsComponent implements OnInit {
  activeTab: 'applicants' | 'students' = 'applicants';

  applicants: any[] = [];
  filteredApplicants: any[] = [];
  students: any[] = [];
  filteredStudents: any[] = [];

  loading = true;
  saving = false;
  notice = '';
  error = '';
  searchTerm = '';
  statusFilter = 'all';
  selectedPerson: any = null;
  selectedType: 'applicant' | 'student' = 'applicant';

  constructor(private firebaseService: FirebaseService) {}

  async ngOnInit(): Promise<void> {
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    this.loading = true;
    try {
      const [applicants, students] = await Promise.all([
        this.firebaseService.getApplicants(),
        this.firebaseService.getStudents()
      ]);
      this.applicants = applicants;
      this.students = students;
      this.applyFilters();
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      this.loading = false;
    }
  }

  applyFilters(): void {
    if (this.activeTab === 'applicants') {
      let filtered = [...this.applicants];
      if (this.statusFilter !== 'all') {
        filtered = filtered.filter(a => a.status === this.statusFilter);
      }
      if (this.searchTerm.trim()) {
        const term = this.searchTerm.toLowerCase();
        filtered = filtered.filter(a =>
          a.fullName?.toLowerCase().includes(term) ||
          a.name?.toLowerCase().includes(term) ||
          a.phoneNumber?.includes(term) ||
          a.courseType?.toLowerCase().includes(term) ||
          a.instrument?.toLowerCase().includes(term)
        );
      }
      this.filteredApplicants = filtered;
    } else {
      let filtered = [...this.students];
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
      this.filteredStudents = filtered;
    }
  }

  switchTab(tab: 'applicants' | 'students'): void {
    this.activeTab = tab;
    this.statusFilter = 'all';
    this.searchTerm = '';
    this.applyFilters();
  }

  // ==================== APPLICANT ACTIONS ====================

  async updateApplicantStatus(applicant: any, newStatus: string): Promise<void> {
    try {
      await this.firebaseService.updateApplicantStatus(applicant.id, newStatus);
      applicant.status = newStatus;
      this.applyFilters();
    } catch (err) {
      this.error = 'Error al actualizar estado';
      setTimeout(() => this.error = '', 3000);
    }
  }

  async acceptApplicant(applicant: any): Promise<void> {
    if (!confirm(`¿Aceptar a "${this.getPersonName(applicant)}" como estudiante?`)) return;
    this.saving = true;
    try {
      await this.firebaseService.acceptApplicant(applicant);
      applicant.status = 'accepted';
      this.notice = `"${this.getPersonName(applicant)}" aceptado como estudiante`;
      await this.loadAll();
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al aceptar aspirante';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  async rejectApplicant(applicant: any): Promise<void> {
    try {
      await this.firebaseService.updateApplicantStatus(applicant.id, 'rejected');
      applicant.status = 'rejected';
      this.applyFilters();
    } catch (err) {
      this.error = 'Error al rechazar aspirante';
      setTimeout(() => this.error = '', 3000);
    }
  }

  // ==================== HELPERS ====================

  getPersonName(person: any): string {
    return person.fullName || person.name || 'Sin nombre';
  }

  getPersonFields(person: any): { label: string; value: string }[] {
    const fields: { label: string; value: string }[] = [];
    const skip = ['id', 'status', 'createdAt', 'updatedAt', 'schoolId', 'flowId',
                   'flowName', 'phoneNumber', 'applicantId', 'acceptedAt', 'studentId'];

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
      courseType: 'Tipo de Curso',
      courseTypeId: 'ID Curso',
      instrument: 'Instrumento',
      instrumentId: 'ID Instrumento',
      comment: 'Comentario',
      email: 'Email'
    };
    return labels[key] || key;
  }

  getWhatsAppLink(phone: string): string {
    const cleaned = phone?.replace(/[^0-9]/g, '') || '';
    return `https://wa.me/${cleaned}`;
  }

  getWhatsAppMessageLink(phone: string, name: string): string {
    const cleaned = phone?.replace(/[^0-9]/g, '') || '';
    const message = encodeURIComponent(
      `Hola ${name}, nos comunicamos del Instituto CanZion Sonsonate. `
    );
    return `https://wa.me/${cleaned}?text=${message}`;
  }

  formatDate(timestamp: any): string {
    if (!timestamp?.seconds) return 'N/A';
    return new Date(timestamp.seconds * 1000).toLocaleDateString('es-SV', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  getApplicantStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      accepted: 'Aceptado',
      rejected: 'Rechazado'
    };
    return labels[status] || status;
  }

  getStudentStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Activo',
      inactive: 'Inactivo',
      graduated: 'Graduado'
    };
    return labels[status] || status;
  }

  openDetail(person: any, type: 'applicant' | 'student'): void {
    this.selectedPerson = person;
    this.selectedType = type;
  }

  closeDetail(): void {
    this.selectedPerson = null;
  }

  get pendingCount(): number {
    return this.applicants.filter(a => a.status === 'pending').length;
  }

  get acceptedCount(): number {
    return this.applicants.filter(a => a.status === 'accepted').length;
  }

  get totalStudentsCount(): number {
    return this.students.length;
  }
}
