import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin-users',
  templateUrl: './admin-users.component.html',
  styleUrls: ['./admin-users.component.css']
})
export class AdminUsersComponent implements OnInit {
  admins: any[] = [];
  loading = true;
  showForm = false;
  formLoading = false;
  formError = '';
  formSuccess = '';

  newAdmin = {
    name: '',
    email: '',
    password: '',
    role: 'admin'
  };

  constructor(
    private firebaseService: FirebaseService,
    private authService: AuthService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadAdmins();
  }

  async loadAdmins(): Promise<void> {
    this.loading = true;
    try {
      this.admins = await this.firebaseService.getAdmins();
    } catch (err) {
      console.error('Error loading admins:', err);
    } finally {
      this.loading = false;
    }
  }

  toggleForm(): void {
    this.showForm = !this.showForm;
    this.formError = '';
    this.formSuccess = '';
    if (!this.showForm) {
      this.resetForm();
    }
  }

  resetForm(): void {
    this.newAdmin = { name: '', email: '', password: '', role: 'admin' };
  }

  async createAdmin(): Promise<void> {
    if (!this.newAdmin.name || !this.newAdmin.email || !this.newAdmin.password) {
      this.formError = 'Todos los campos son requeridos';
      return;
    }

    if (this.newAdmin.password.length < 6) {
      this.formError = 'La contraseña debe tener al menos 6 caracteres';
      return;
    }

    this.formLoading = true;
    this.formError = '';
    this.formSuccess = '';

    try {
      const user = await this.authService.createUser(this.newAdmin.email, this.newAdmin.password);

      // Map the new user to this organization
      await this.firebaseService.setUserOrg(user.uid, {
        organizationId: this.firebaseService.getOrgId(),
        email: this.newAdmin.email,
        role: this.newAdmin.role,
        name: this.newAdmin.name
      });

      await this.firebaseService.addAdmin({
        email: this.newAdmin.email,
        name: this.newAdmin.name,
        role: this.newAdmin.role
      });

      this.formSuccess = `Administrador "${this.newAdmin.name}" creado exitosamente`;
      this.resetForm();
      await this.loadAdmins();

      setTimeout(() => {
        this.showForm = false;
        this.formSuccess = '';
      }, 2000);
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        this.formError = 'Este correo ya está registrado';
      } else if (err.code === 'auth/invalid-email') {
        this.formError = 'Correo electrónico inválido';
      } else {
        this.formError = 'Error al crear administrador: ' + (err.message || '');
      }
    } finally {
      this.formLoading = false;
    }
  }

  async toggleActive(admin: any): Promise<void> {
    try {
      await this.firebaseService.updateAdmin(admin.id, { active: !admin.active });
      admin.active = !admin.active;
    } catch (err) {
      console.error('Error toggling admin:', err);
    }
  }

  async deleteAdmin(admin: any): Promise<void> {
    if (!confirm(`¿Estás seguro de eliminar a "${admin.name}"?`)) return;

    try {
      await this.firebaseService.deleteAdmin(admin.id);
      await this.loadAdmins();
    } catch (err) {
      console.error('Error deleting admin:', err);
    }
  }

  formatDate(timestamp: any): string {
    if (!timestamp?.seconds) return 'N/A';
    return new Date(timestamp.seconds * 1000).toLocaleDateString('es-SV', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  getRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      superadmin: 'Super Admin',
      admin: 'Administrador',
      viewer: 'Solo lectura'
    };
    return labels[role] || role;
  }
}
