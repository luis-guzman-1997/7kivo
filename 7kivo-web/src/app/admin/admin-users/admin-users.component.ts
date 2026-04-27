import { Component, OnInit, OnDestroy } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService, ROLE_PERMISSIONS } from '../../services/auth.service';
import { PresenceService } from '../../services/presence.service';

interface FlowOption { id: string; name: string; menuLabel: string; active: boolean; notifyDelivery: boolean; }

@Component({
  selector: 'app-admin-users',
  templateUrl: './admin-users.component.html',
  styleUrls: ['./admin-users.component.css']
})
export class AdminUsersComponent implements OnInit, OnDestroy {
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
    { value: 'delivery',       label: 'Delivery',          desc: 'Solo bandeja de delivery: puede tomar y resolver pedidos asignados (un pedido a la vez)' },
    { value: 'delivery_multi', label: 'Delivery Múltiple', desc: 'Igual que Delivery pero puede tomar múltiples pedidos simultáneamente' }
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
    whatsappPhone: '',
    vehicleType: 'motorcycle'
  };

  flows: FlowOption[] = [];
  webstoreFlows: FlowOption[] = [];
  webFlowSaving: string | null = null;

  // Flow assignment
  flowPanelAdminId: string | null = null;
  flowAssignSaving: string | null = null;

  presenceMap: Record<string, any> = {};
  private presenceUnsub: (() => void) | null = null;

  vehicleOptions = [
    { value: 'motorcycle', label: 'Moto',      icon: 'fa-motorcycle' },
    { value: 'bicycle',    label: 'Bicicleta',  icon: 'fa-bicycle'   },
    { value: 'car',        label: 'Auto',       icon: 'fa-car'       },
    { value: 'truck',      label: 'Camión',     icon: 'fa-truck'     }
  ];
  savingVehicleId: string | null = null;

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

  changeNameAdmin: any = null;
  changeNameValue = '';
  changeNameSaving = false;
  changeNameError = '';
  changeNameNotice = '';

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService
  ) {}

  get onlineCount(): number {
    return Object.values(this.presenceMap).filter(p => PresenceService.isOnline(p)).length;
  }

  isOnline(uid: string): boolean {
    return PresenceService.isOnline(this.presenceMap[uid]);
  }

  lastSeenLabel(uid: string): string {
    const p = this.presenceMap[uid];
    if (!p?.lastSeen) return '';
    const ms = p.lastSeen?.toMillis?.() ?? new Date(p.lastSeen).getTime();
    const diff = Math.floor((Date.now() - ms) / 1000);
    if (diff < 60)  return 'hace ' + diff + 's';
    if (diff < 3600) return 'hace ' + Math.floor(diff / 60) + 'min';
    return 'hace ' + Math.floor(diff / 3600) + 'h';
  }

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

  get isDeliveryOrg(): boolean {
    return this.authService.orgIndustry === 'delivery';
  }

  get rolesForSelector() {
    return this.isDeliveryOrg
      ? this.availableRoles
      : this.availableRoles.filter(r => r.value !== 'delivery' && r.value !== 'delivery_multi');
  }

  isDeliveryRole(admin: any): boolean {
    return admin.role === 'delivery' || admin.role === 'delivery_multi';
  }

  // ── Accesos extra ──
  readonly EXTRA_PERM_OPTIONS = [
    { key: 'webdelivery', label: 'WebDelivery' },
    { key: 'campaigns',   label: 'Campañas' },
    { key: 'collections', label: 'Base de Datos' },
    { key: 'flows',       label: 'Flujos del Bot' },
    { key: 'contacts',    label: 'Contactos' },
    { key: 'bot_config',  label: 'Mensajería Bot' },
    { key: 'delivery_map',label: 'Mapa Delivery' },
  ];

  extraPermPanel: string | null = null;
  extraPermSaving: string | null = null;

  searchQuery = '';
  filterRole = '';
  expandedId: string | null = null;

  blockUntilDate = '';
  blockSaving: string | null = null;

  revokePermPanel: string | null = null;
  revokePermSaving: string | null = null;

  get filteredAdmins(): any[] {
    return this.admins.filter(a => {
      const matchRole = !this.filterRole || a.role === this.filterRole;
      const q = this.searchQuery.toLowerCase();
      const matchSearch = !q ||
        (a.name || '').toLowerCase().includes(q) ||
        (a.email || '').toLowerCase().includes(q);
      return matchRole && matchSearch;
    }).sort((a, b) => {
      const score = (u: any) => this.isOnline(u.uid) ? 2 : (u.active !== false ? 1 : 0);
      return score(b) - score(a);
    });
  }

  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(' ').filter(Boolean);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.substring(0, 2).toUpperCase();
  }

  toggleExpand(id: string): void {
    this.expandedId = this.expandedId === id ? null : id;
  }

  toggleRevokePermPanel(id: string): void {
    this.revokePermPanel = this.revokePermPanel === id ? null : id;
  }

  getRolePerms(role: string): string[] {
    return ROLE_PERMISSIONS[role] || [];
  }

  isRevoked(admin: any, key: string): boolean {
    return (admin.revokedPermissions || []).includes(key);
  }

  async toggleRevokedPerm(admin: any, key: string): Promise<void> {
    if (!admin.uid) return;
    this.revokePermSaving = admin.id + key;
    const revoked = this.isRevoked(admin, key);
    try {
      if (revoked) {
        await this.firebaseService.restoreRolePermission(admin.id, admin.uid, key);
        admin.revokedPermissions = (admin.revokedPermissions || []).filter((k: string) => k !== key);
      } else {
        await this.firebaseService.revokeRolePermission(admin.id, admin.uid, key);
        admin.revokedPermissions = [...(admin.revokedPermissions || []), key];
      }
    } catch (e) { console.error('Error toggling revoked perm:', e); }
    finally { this.revokePermSaving = null; }
  }

  isBlocked(admin: any): boolean {
    if (!admin.blocked) return false;
    const until = admin.blockedUntil?.toDate?.() ?? (admin.blockedUntil ? new Date(admin.blockedUntil) : null);
    return !until || until > new Date();
  }

  blockUntilLabel(admin: any): string {
    if (!admin.blockedUntil) return 'Permanente';
    const until = admin.blockedUntil?.toDate?.() ?? new Date(admin.blockedUntil);
    return 'Hasta ' + until.toLocaleString('es-SV', { dateStyle: 'short', timeStyle: 'short' });
  }

  get blockUntilMin(): string {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    return d.toISOString().slice(0, 16);
  }

  async blockAdmin(admin: any, temporary: boolean): Promise<void> {
    if (!admin.uid) return;
    let blockedUntil: Date | null = null;
    if (temporary) {
      if (!this.blockUntilDate) return;
      blockedUntil = new Date(this.blockUntilDate);
      if (blockedUntil <= new Date()) return;
    }
    this.blockSaving = admin.id;
    try {
      await this.firebaseService.blockAdminUser(admin.id, admin.uid, blockedUntil);
      admin.blocked = true;
      admin.blockedUntil = blockedUntil;
      this.blockUntilDate = '';
    } catch (e) { console.error('Error blocking admin:', e); }
    finally { this.blockSaving = null; }
  }

  async unblockAdmin(admin: any): Promise<void> {
    if (!admin.uid) return;
    this.blockSaving = admin.id;
    try {
      await this.firebaseService.unblockAdminUser(admin.id, admin.uid);
      admin.blocked = false;
      admin.blockedUntil = null;
    } catch (e) { console.error('Error unblocking admin:', e); }
    finally { this.blockSaving = null; }
  }

  toggleExtraPermPanel(adminId: string): void {
    this.extraPermPanel = this.extraPermPanel === adminId ? null : adminId;
  }

  hasExtraPerm(admin: any, key: string): boolean {
    return (admin.extraPermissions || []).includes(key);
  }

  hasWebFlow(admin: any, flowId: string): boolean {
    return (admin.assignedWebFlows || []).includes(flowId);
  }

  async toggleWebFlow(admin: any, flowId: string): Promise<void> {
    const current: string[] = admin.assignedWebFlows ? [...admin.assignedWebFlows] : [];
    const idx = current.indexOf(flowId);
    if (idx >= 0) current.splice(idx, 1); else current.push(flowId);
    this.webFlowSaving = admin.id + flowId;
    try {
      await this.firebaseService.updateAdmin(admin.id, { assignedWebFlows: current });
      admin.assignedWebFlows = current;
    } catch (err) { console.error('Error saving web flow assignment:', err); }
    finally { this.webFlowSaving = null; }
  }

  async toggleExtraPerm(admin: any, key: string): Promise<void> {
    if (!admin.uid) return;
    this.extraPermSaving = admin.id + key;
    const has = this.hasExtraPerm(admin, key);
    try {
      let updated: string[];
      if (has) {
        await this.firebaseService.revokeUserExtraPermission(admin.uid, key);
        updated = (admin.extraPermissions || []).filter((k: string) => k !== key);
      } else {
        await this.firebaseService.grantUserExtraPermission(admin.uid, key);
        updated = [...(admin.extraPermissions || []), key];
      }
      await this.firebaseService.updateAdmin(admin.id, { extraPermissions: updated });
      admin.extraPermissions = updated;
    } catch (e) { console.error('Error toggling extra perm:', e); }
    this.extraPermSaving = null;
  }

  async toggleCanSeePromoOrders(admin: any): Promise<void> {
    const newVal = !(admin.canSeePromoOrders !== false);
    try {
      await this.firebaseService.updateAdmin(admin.id, { canSeePromoOrders: newVal });
      admin.canSeePromoOrders = newVal;
    } catch (err) {
      console.error('Error saving canSeePromoOrders:', err);
    }
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadAdmins(), this.loadFlows()]);
    this.presenceUnsub = this.firebaseService.watchPresence(list => {
      this.presenceMap = {};
      list.forEach(p => { this.presenceMap[p.uid] = p; });
    });
  }

  async loadFlows(): Promise<void> {
    try {
      const all = await this.firebaseService.getFlows();
      this.flows = all.map((f: any) => ({ id: f.id, name: f.name, menuLabel: f.menuLabel, active: f.active !== false, notifyDelivery: !!f.notifyDelivery }));
      this.webstoreFlows = all.filter((f: any) => f.webStoreEnabled === true)
        .map((f: any) => ({ id: f.id, name: f.name, menuLabel: f.menuLabel, active: f.active !== false, notifyDelivery: false }));
    } catch { this.flows = []; this.webstoreFlows = []; }
  }

  ngOnDestroy(): void {
    if (this.presenceUnsub) this.presenceUnsub();
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
    this.newAdmin = { name: '', email: '', password: '', role: 'editor', whatsappPhone: '', vehicleType: 'motorcycle' };
  }

  async createAdmin(): Promise<void> {
    if (!this.newAdmin.name || !this.newAdmin.email || !this.newAdmin.password) {
      this.formError = 'Todos los campos son requeridos';
      return;
    }

    if ((this.newAdmin.role === 'delivery' || this.newAdmin.role === 'delivery_multi') && !this.newAdmin.whatsappPhone.trim()) {
      this.formError = 'El número de WhatsApp del Delivery es requerido';
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
        (this.newAdmin.role === 'delivery' || this.newAdmin.role === 'delivery_multi') ? this.newAdmin.whatsappPhone.trim() : undefined,
        (this.newAdmin.role === 'delivery' || this.newAdmin.role === 'delivery_multi') ? this.newAdmin.vehicleType : undefined
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

  startChangeName(admin: any): void {
    this.changeNameAdmin = admin;
    this.changeNameValue = admin.name || '';
    this.changeNameError = '';
  }

  cancelChangeName(): void {
    this.changeNameAdmin = null;
    this.changeNameValue = '';
    this.changeNameError = '';
  }

  async saveChangeName(): Promise<void> {
    if (!this.changeNameAdmin) return;
    if (!this.changeNameValue.trim()) {
      this.changeNameError = 'El nombre no puede estar vacío';
      return;
    }
    this.changeNameSaving = true;
    this.changeNameError = '';
    try {
      const name = this.changeNameValue.trim();
      await this.firebaseService.updateAdmin(this.changeNameAdmin.id, { name });
      if (this.changeNameAdmin.uid) {
        await this.firebaseService.setUserOrg(this.changeNameAdmin.uid, {
          organizationId: this.firebaseService.getOrgId(),
          email: this.changeNameAdmin.email,
          role: this.changeNameAdmin.role,
          name
        });
      }
      this.changeNameAdmin.name = name;
      this.changeNameAdmin = null;
      this.changeNameValue = '';
      this.changeNameNotice = 'Nombre actualizado correctamente';
      setTimeout(() => this.changeNameNotice = '', 4000);
    } catch (err: any) {
      this.changeNameError = err?.message || 'Error al actualizar nombre';
    } finally {
      this.changeNameSaving = false;
    }
  }

  get canChangeName(): boolean {
    return this.authService.userRole === 'owner' || this.authService.isSuperAdmin;
  }

  async setVehicleType(admin: any, vehicleType: string): Promise<void> {
    if (this.savingVehicleId === admin.id) return;
    this.savingVehicleId = admin.id;
    try {
      await this.firebaseService.updateAdmin(admin.id, { vehicleType });
      if (admin.uid) {
        await Promise.all([
          this.firebaseService.setUserOrg(admin.uid, {
            organizationId: this.firebaseService.getOrgId(),
            email: admin.email,
            role: admin.role,
            name: admin.name,
            vehicleType
          }),
          // Actualizar delivery_locations para que el mapa lo refleje en tiempo real
          this.firebaseService.updateDeliveryVehicleType(admin.uid, vehicleType)
        ]);
      }
      admin.vehicleType = vehicleType;
    } catch (err) {
      console.error('Error saving vehicle type:', err);
    } finally {
      this.savingVehicleId = null;
    }
  }

  getVehicleIcon(vehicleType: string): string {
    return this.vehicleOptions.find(v => v.value === vehicleType)?.icon || 'fa-motorcycle';
  }

  getVehicleLabel(vehicleType: string): string {
    return this.vehicleOptions.find(v => v.value === vehicleType)?.label || 'Moto';
  }

  isOwner(admin: any): boolean {
    return admin.role === 'owner';
  }

  canManage(admin: any): boolean {
    if (admin.role === 'owner') return false;
    const myRole = this.authService.userRole;
    return myRole === 'owner' || myRole === 'admin';
  }

  get canAssignFlows(): boolean {
    return this.authService.userRole === 'owner' || this.authService.isSuperAdmin;
  }

  async toggleFlowPanel(admin: any): Promise<void> {
    if (this.flowPanelAdminId === admin.id) {
      this.flowPanelAdminId = null;
      return;
    }
    // Auto-initialize assignedFlows with notifyDelivery flows if never set
    if (!admin.assignedFlows || admin.assignedFlows.length === 0) {
      const defaults = this.flows.filter(f => f.notifyDelivery).map(f => f.id);
      if (defaults.length > 0) {
        admin.assignedFlows = defaults;
        await this.firebaseService.updateAdmin(admin.id, { assignedFlows: defaults });
      }
    }
    this.flowPanelAdminId = admin.id;
  }

  isFlowAssigned(admin: any, flowId: string): boolean {
    return (admin.assignedFlows || []).includes(flowId);
  }

  async toggleFlowAssignment(admin: any, flowId: string): Promise<void> {
    const current: string[] = admin.assignedFlows ? [...admin.assignedFlows] : [];
    const idx = current.indexOf(flowId);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(flowId);

    this.flowAssignSaving = admin.id;
    try {
      await this.firebaseService.updateAdmin(admin.id, { assignedFlows: current });
      admin.assignedFlows = current;
    } catch (err) {
      console.error('Error saving flow assignment:', err);
    } finally {
      this.flowAssignSaving = null;
    }
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
      delivery:       'Delivery',
      delivery_multi: 'Delivery Múltiple'
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
