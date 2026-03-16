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
    { value: 'admin',    label: 'Gerente',     desc: 'Gestión operativa: mensajería, flujos, bases de datos y usuarios (sin configuración de empresa)' },
    { value: 'editor',   label: 'Operador',    desc: 'Operaciones del día a día: dashboard, contactos, chat, bandeja y bases de datos' },
    { value: 'viewer',   label: 'Agente',      desc: 'Atención al cliente: dashboard, bandeja de entrada y chat (sin acceso a contactos)' },
    { value: 'delivery', label: 'Delivery',  desc: 'Solo bandeja de delivery: puede tomar y resolver pedidos asignados' }
  ];

  allPermissions = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'contacts', label: 'Contactos' },
    { key: 'chat', label: 'Chat WhatsApp' },
    { key: 'inbox', label: 'Bandeja de Entrada' },
    { key: 'collections', label: 'Base de Datos' },
    { key: 'flows', label: 'Flujos del Bot' },
    { key: 'bot_config', label: 'Mensajería Bot' },
    { key: 'users', label: 'Administradores' },
    { key: 'settings', label: 'Mi Empresa' }
  ];

  newAdmin = {
    name: '',
    email: '',
    password: '',
    role: 'editor',
    whatsappPhone: ''
  };

  changePwAdmin: any = null;
  changePwValue = '';
  changePwSaving = false;
  changePwError = '';
  changePwNotice = '';

  changePhoneAdmin: any = null;
  changePhoneValue = '';
  changePhoneSaving = false;
  changePhoneError = '';
  changePhoneNotice = '';

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService
  ) {}

  get botReady(): boolean {
    return this.authService.botEnabled;
  }

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
    if (!this.botReady) return;
    this.showForm = !this.showForm;
    this.formError = '';
    this.formSuccess = '';
    if (!this.showForm) {
      this.resetForm();
    }
  }

  resetForm(): void {
    this.newAdmin = { name: '', email: '', password: '', role: 'editor', whatsappPhone: '' };
  }

  async createAdmin(): Promise<void> {
    if (!this.newAdmin.name || !this.newAdmin.email || !this.newAdmin.password) {
      this.formError = 'Todos los campos son requeridos';
      return;
    }

    if (this.newAdmin.role === 'delivery' && !this.newAdmin.whatsappPhone.trim()) {
      this.formError = 'El número de WhatsApp del repartidor es requerido';
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
      await this.firebaseService.createUserForOrg(
        this.firebaseService.getOrgId(),
        this.newAdmin.email.trim(),
        this.newAdmin.password,
        this.newAdmin.name.trim(),
        this.newAdmin.role,
        this.newAdmin.role === 'delivery' ? this.newAdmin.whatsappPhone.trim() : undefined
      );

      this.formSuccess = `Usuario "${this.newAdmin.name}" creado exitosamente`;
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

  startChangePassword(admin: any): void {
    this.changePwAdmin = admin;
    this.changePwValue = '';
    this.changePwError = '';
  }

  cancelChangePassword(): void {
    this.changePwAdmin = null;
    this.changePwValue = '';
    this.changePwError = '';
  }

  async saveChangePassword(): Promise<void> {
    if (!this.changePwAdmin?.uid) return;
    if (this.changePwValue.length < 6) {
      this.changePwError = 'La contraseña debe tener al menos 6 caracteres';
      return;
    }
    this.changePwSaving = true;
    this.changePwError = '';
    try {
      const botUrl = this.authService.botApiUrl;
      await this.firebaseService.setUserPassword(botUrl, this.changePwAdmin.uid, this.changePwValue);
      this.changePwAdmin = null;
      this.changePwValue = '';
      this.changePwNotice = 'Contraseña actualizada correctamente';
      setTimeout(() => this.changePwNotice = '', 4000);
    } catch (err: any) {
      this.changePwError = err?.message || 'Error al cambiar contraseña';
    } finally {
      this.changePwSaving = false;
    }
  }

  startChangePhone(admin: any): void {
    this.changePhoneAdmin = admin;
    this.changePhoneValue = admin.whatsappPhone || '';
    this.changePhoneError = '';
  }

  cancelChangePhone(): void {
    this.changePhoneAdmin = null;
    this.changePhoneValue = '';
    this.changePhoneError = '';
  }

  async saveChangePhone(): Promise<void> {
    if (!this.changePhoneAdmin) return;
    if (!this.changePhoneValue.trim()) {
      this.changePhoneError = 'El número no puede estar vacío';
      return;
    }
    this.changePhoneSaving = true;
    this.changePhoneError = '';
    try {
      const phone = this.changePhoneValue.trim();
      await this.firebaseService.updateAdmin(this.changePhoneAdmin.id, { whatsappPhone: phone });
      if (this.changePhoneAdmin.uid) {
        await this.firebaseService.setUserOrg(this.changePhoneAdmin.uid, {
          organizationId: this.firebaseService.getOrgId(),
          email: this.changePhoneAdmin.email,
          role: this.changePhoneAdmin.role,
          name: this.changePhoneAdmin.name,
          whatsappPhone: phone
        });
      }
      this.changePhoneAdmin.whatsappPhone = phone;
      this.changePhoneAdmin = null;
      this.changePhoneValue = '';
      this.changePhoneNotice = 'Número actualizado correctamente';
      setTimeout(() => this.changePhoneNotice = '', 4000);
    } catch (err: any) {
      this.changePhoneError = err?.message || 'Error al actualizar número';
    } finally {
      this.changePhoneSaving = false;
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
      owner:    'Propietario',
      admin:    'Gerente',
      editor:   'Operador',
      viewer:   'Agente',
      delivery: 'Delivery'
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
