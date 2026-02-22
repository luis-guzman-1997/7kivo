import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService, ROLE_PERMISSIONS } from '../../services/auth.service';

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

  availableRoles = [
    { value: 'admin', label: 'Administrador', desc: 'Acceso completo: mensajería, flujos, colecciones, usuarios y datos de empresa' },
    { value: 'editor', label: 'Editor', desc: 'Dashboard, contactos, chat, bandeja y datos de colecciones' },
    { value: 'viewer', label: 'Solo lectura', desc: 'Dashboard, contactos, bandeja y chat (solo lectura)' }
  ];

  allPermissions = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'contacts', label: 'Contactos' },
    { key: 'chat', label: 'Chat WhatsApp' },
    { key: 'inbox', label: 'Bandeja de Entrada' },
    { key: 'collections', label: 'Colecciones' },
    { key: 'flows', label: 'Flujos del Bot' },
    { key: 'bot_config', label: 'Mensajería Bot' },
    { key: 'users', label: 'Administradores' },
    { key: 'settings', label: 'Mi Empresa' }
  ];

  newAdmin = {
    name: '',
    email: '',
    password: '',
    role: 'editor'
  };

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService
  ) {}

  get canAddAdmin(): boolean {
    const limit = this.authService.getPlanLimits().admins;
    return this.admins.length < limit;
  }

  get adminLimit(): number {
    return this.authService.getPlanLimits().admins;
  }

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
    this.newAdmin = { name: '', email: '', password: '', role: 'editor' };
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
        uid: user.uid,
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

  async changeRole(admin: any, newRole: string): Promise<void> {
    if (admin.role === 'owner') return;
    try {
      await this.firebaseService.updateAdmin(admin.id, { role: newRole });
      if (admin.uid) {
        await this.firebaseService.setUserOrg(admin.uid, {
          organizationId: this.firebaseService.getOrgId(),
          email: admin.email,
          role: newRole,
          name: admin.name
        });
      }
      admin.role = newRole;
    } catch (err) {
      console.error('Error changing role:', err);
    }
  }

  async deleteAdmin(admin: any): Promise<void> {
    if (admin.role === 'owner') return;
    if (!confirm(`¿Estás seguro de eliminar a "${admin.name}"?`)) return;

    try {
      await this.firebaseService.deleteAdmin(admin.id);
      await this.loadAdmins();
    } catch (err) {
      console.error('Error deleting admin:', err);
    }
  }

  isOwner(admin: any): boolean {
    return admin.role === 'owner';
  }

  canManage(admin: any): boolean {
    if (admin.role === 'owner') return false;
    const myRole = this.authService.userRole;
    return myRole === 'owner' || myRole === 'admin';
  }

  formatDate(timestamp: any): string {
    if (!timestamp?.seconds) return 'N/A';
    return new Date(timestamp.seconds * 1000).toLocaleDateString('es-SV', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  getRoleDesc(role: string): string {
    const r = this.availableRoles.find(rr => rr.value === role);
    return r ? r.desc : '';
  }

  getRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      owner: 'Dueño',
      admin: 'Administrador',
      editor: 'Editor',
      viewer: 'Solo lectura'
    };
    return labels[role] || role;
  }

  getRolePermissions(role: string): string[] {
    return ROLE_PERMISSIONS[role] || [];
  }

  getPermissionLabel(key: string): string {
    const p = this.allPermissions.find(pp => pp.key === key);
    return p ? p.label : key;
  }
}
