import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-sa-organizations',
  templateUrl: './sa-organizations.component.html',
  styleUrls: ['./sa-organizations.component.css']
})
export class SaOrganizationsComponent implements OnInit {
  organizations: any[] = [];
  filteredOrgs: any[] = [];
  loading = true;
  searchTerm = '';
  filterStatus = 'all';

  selectedOrg: any = null;
  orgDetail: any = null;
  orgWhatsApp: any = null;
  orgAdmins: any[] = [];
  loadingDetail = false;
  detailTab = 'info';

  editingPlan = false;
  editPlan = '';
  editMonthlyRate: number | null = null;
  useCustomLimits = false;
  editLimits: any = { flows: 1, collections: 1, admins: 1, chatLive: true };

  platformPlans: any[] = [];

  editingGeneral = false;
  editGeneral: any = {};

  editingWA = false;
  editWA: any = {};

  testingApi = false;
  apiTestResult: { ok: boolean; error?: string } | null = null;

  logoFile: File | null = null;
  logoPreview = '';

  saving = false;
  notice = '';

  togglingBlock: { [orgId: string]: boolean } = {};
  botToggleError: string | null = null;
  addingAdmin = false;
  newAdmin = { name: '', email: '', password: '', role: 'editor' };
  addAdminSaving = false;
  addAdminError = '';
  addAdminNotice = '';

  deleteConfirmOrg: any = null;
  deleteConfirmText = '';
  deleting = false;
  deleteResult: { deletedUsers: string[] } | null = null;

  changePwAdm: any = null;
  changePwVal = '';
  changePwSaving = false;
  changePwError = '';

  resetBotConfirmOrg: any = null;
  resettingBot = false;
  resetBotDone = false;

  loadConfigOrg: any = null;
  loadConfigJson = '';
  loadConfigParsed: any = null;
  loadConfigError = '';
  loadConfigSaving = false;
  loadConfigDone = false;

  exportingOrgId: string | null = null;
  exportingAll = false;

  importModalOpen = false;
  importParsed: any[] = [];
  importError = '';
  importOverwrite = false;
  importSaving = false;
  importDone = false;
  importResults: { id: string; name: string; existed: boolean; success: boolean; error?: string }[] = [];

  constructor(
    private firebaseService: FirebaseService,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadOrganizations(), this.loadPlans()]);
  }

  async loadPlans(): Promise<void> {
    try {
      const data = await this.firebaseService.getPlatformPlans();
      this.platformPlans = (data?.plans || []).filter((p: any) => p.active);
    } catch (err) {
      console.error('Error loading plans:', err);
    }
  }

  async loadOrganizations(): Promise<void> {
    this.loading = true;
    try {
      const orgs = await this.firebaseService.getAllOrganizations();
      for (const org of orgs) {
        const config = await this.firebaseService.getOrgConfigByOrgId(org.id);
        org.orgName = config?.orgName || org.name || org.id;
        org.industry = config?.industry || org.industry || 'general';
        org.orgLogo = config?.orgLogo || '';
      }
      this.organizations = orgs.sort((a: any, b: any) =>
        (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
      );
      this.applyFilter();
    } catch (err) {
      console.error('Error loading organizations:', err);
    } finally {
      this.loading = false;
    }
  }

  applyFilter(): void {
    let list = [...this.organizations];
    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      list = list.filter(o =>
        (o.orgName || '').toLowerCase().includes(term) ||
        (o.id || '').toLowerCase().includes(term) ||
        (o.industry || '').toLowerCase().includes(term)
      );
    }
    if (this.filterStatus === 'active') list = list.filter(o => o.active !== false);
    else if (this.filterStatus === 'inactive') list = list.filter(o => o.active === false);
    else if (this.filterStatus === 'bot_on') list = list.filter(o => o.botEnabled !== false);
    else if (this.filterStatus === 'bot_off') list = list.filter(o => o.botEnabled === false);
    this.filteredOrgs = list;
  }

  async toggleActive(org: any): Promise<void> {
    const newVal = org.active === false;
    try {
      await this.firebaseService.updateOrganization(org.id, { active: newVal });
      org.active = newVal;
      this.applyFilter();
    } catch (err) {
      console.error('Error toggling org active:', err);
    }
  }

  async toggleBot(org: any): Promise<void> {
    const newVal = org.botEnabled === false;
    // When enabling, verify WhatsApp webhook config is complete
    if (newVal) {
      try {
        const [config, wa] = await Promise.all([
          this.firebaseService.getOrgConfigByOrgId(org.id),
          this.firebaseService.getWhatsAppConfigByOrgId(org.id)
        ]);
        const waReady = !!(config?.botApiUrl && wa?.token && wa?.phoneNumberId);
        if (!waReady) {
          this.botToggleError = org.id;
          setTimeout(() => { this.botToggleError = null; }, 4000);
          return;
        }
      } catch (err) {
        console.error('Error checking WA config:', err);
        return;
      }
    }
    try {
      await this.firebaseService.updateOrganization(org.id, { botEnabled: newVal });
      org.botEnabled = newVal;
      this.botToggleError = null;
    } catch (err) {
      console.error('Error toggling bot:', err);
    }
  }

  async toggleBotBlocked(org: any): Promise<void> {
    if (this.togglingBlock[org.id]) return;
    this.togglingBlock[org.id] = true;
    const newVal = !org.botBlocked;
    try {
      await this.firebaseService.setBotBlockedByOrgId(org.id, newVal);
      org.botBlocked = newVal;
      if (this.selectedOrg?.id === org.id) this.selectedOrg.botBlocked = newVal;
    } catch (err) {
      console.error('Error toggling bot blocked:', err);
    } finally {
      this.togglingBlock[org.id] = false;
    }
  }

  async openDetail(org: any): Promise<void> {
    this.selectedOrg = org;
    this.loadingDetail = true;
    this.detailTab = 'info';
    this.editingPlan = false;
    this.editingGeneral = false;
    this.editingWA = false;
    this.apiTestResult = null;
    this.addingAdmin = false;
    this.addAdminError = '';
    this.addAdminNotice = '';
    this.notice = '';
    this.changePwAdm = null;
    this.changePwVal = '';
    this.changePwError = '';
    try {
      const [detail, wa, admins] = await Promise.all([
        this.firebaseService.getOrgConfigByOrgId(org.id),
        this.firebaseService.getWhatsAppConfigByOrgId(org.id),
        this.firebaseService.getOrgAdminsByOrgId(org.id)
      ]);
      this.orgDetail = detail || {};
      this.orgWhatsApp = wa || {};
      this.orgAdmins = admins;
      this.logoPreview = this.orgDetail.orgLogo || '';
    } catch (err) {
      console.error('Error loading org detail:', err);
    } finally {
      this.loadingDetail = false;
    }
  }

  closeDetail(): void {
    this.selectedOrg = null;
    this.orgDetail = null;
    this.orgWhatsApp = null;
    this.orgAdmins = [];
    this.logoFile = null;
    this.logoPreview = '';
  }

  // ── Plan ──
  startEditPlan(): void {
    this.editPlan = this.selectedOrg?.plan || '';
    this.editMonthlyRate = this.selectedOrg?.monthlyRate || null;
    const cl = this.selectedOrg?.customLimits;
    this.useCustomLimits = !!cl;
    this.editLimits = cl ? { ...cl } : { flows: 1, collections: 1, admins: 1, chatLive: true };
    this.editingPlan = true;
  }

  cancelEditPlan(): void { this.editingPlan = false; }

  onPlanSelectChange(): void {
    const match = this.platformPlans.find((p: any) => p.name === this.editPlan);
    if (match) {
      this.editMonthlyRate = match.price;
    }
  }

  async savePlan(): Promise<void> {
    if (!this.selectedOrg) return;
    this.saving = true;
    try {
      const data: any = {
        plan: this.editPlan,
        monthlyRate: this.editMonthlyRate || 0
      };
      if (this.useCustomLimits) {
        data.customLimits = {
          flows: this.editLimits.flows || 1,
          collections: this.editLimits.collections || 1,
          admins: this.editLimits.admins || 1,
          chatLive: this.editLimits.chatLive !== false
        };
      } else {
        data.customLimits = null;
      }
      await this.firebaseService.updateOrganization(this.selectedOrg.id, data);
      this.selectedOrg.plan = data.plan;
      this.selectedOrg.monthlyRate = data.monthlyRate;
      this.selectedOrg.customLimits = data.customLimits;
      this.editingPlan = false;
      this.showNotice('Plan actualizado');
    } catch (err) {
      console.error('Error saving plan:', err);
    } finally {
      this.saving = false;
    }
  }

  // ── General Config ──
  startEditGeneral(): void {
    this.editGeneral = {
      orgName: this.orgDetail?.orgName || '',
      description: this.orgDetail?.description || '',
      industry: this.orgDetail?.industry || 'general'
    };
    this.editingGeneral = true;
  }

  cancelEditGeneral(): void { this.editingGeneral = false; }

  async saveGeneral(): Promise<void> {
    if (!this.selectedOrg) return;
    this.saving = true;
    try {
      const data: any = { ...this.editGeneral };
      if (this.logoFile) {
        const ext = this.logoFile.name.split('.').pop() || 'png';
        const path = `organizations/${this.selectedOrg.id}/logo.${ext}`;
        const url = await this.firebaseService.uploadFileByPath(this.logoFile, path);
        data.orgLogo = url;
        this.logoPreview = url;
        this.selectedOrg.orgLogo = url;
      }
      await this.firebaseService.saveOrgConfigByOrgId(this.selectedOrg.id, data);
      this.orgDetail = { ...this.orgDetail, ...data };
      this.selectedOrg.orgName = data.orgName;
      this.selectedOrg.industry = data.industry;
      this.editingGeneral = false;
      this.logoFile = null;
      this.showNotice('Configuración guardada');
    } catch (err) {
      console.error('Error saving general config:', err);
    } finally {
      this.saving = false;
    }
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    if (file.size > 2 * 1024 * 1024) return;
    this.logoFile = file;
    const reader = new FileReader();
    reader.onload = (e) => { this.logoPreview = e.target!.result as string; };
    reader.readAsDataURL(file);
  }

  // ── WhatsApp Config ──
  startEditWA(): void {
    this.editWA = {
      token: this.orgWhatsApp?.token || '',
      phoneNumberId: this.orgWhatsApp?.phoneNumberId || '',
      verifyToken: this.orgWhatsApp?.verifyToken || '',
      botApiUrl: this.orgDetail?.botApiUrl || ''
    };
    this.editingWA = true;
    this.apiTestResult = null;
  }

  cancelEditWA(): void { this.editingWA = false; this.apiTestResult = null; }

  async testBotApi(): Promise<void> {
    const url = this.orgDetail?.botApiUrl?.trim();
    if (!url) {
      this.apiTestResult = { ok: false, error: 'URL no configurada' };
      setTimeout(() => this.apiTestResult = null, 5000);
      return;
    }
    this.testingApi = true;
    this.apiTestResult = null;
    try {
      const base = url.replace(/\/$/, '');
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${base}/test`, { method: 'GET', signal: ctrl.signal });
      clearTimeout(tid);
      const text = await res.text();
      if (res.ok && text?.trim().toUpperCase() === 'OK') {
        this.apiTestResult = { ok: true };
      } else {
        this.apiTestResult = { ok: false, error: `HTTP ${res.status}` };
      }
    } catch (err: any) {
      this.apiTestResult = {
        ok: false,
        error: err?.message || err?.name || 'Sin respuesta (CORS, red o servidor caído)'
      };
    } finally {
      this.testingApi = false;
      setTimeout(() => this.apiTestResult = null, 6000);
    }
  }

  async saveWA(): Promise<void> {
    if (!this.selectedOrg) return;
    this.saving = true;
    try {
      await this.firebaseService.saveWhatsAppConfigByOrgId(this.selectedOrg.id, {
        token: this.editWA.token,
        phoneNumberId: this.editWA.phoneNumberId,
        verifyToken: this.editWA.verifyToken
      });
      if (this.editWA.botApiUrl !== undefined) {
        await this.firebaseService.saveOrgConfigByOrgId(this.selectedOrg.id, { botApiUrl: this.editWA.botApiUrl });
        this.orgDetail = { ...this.orgDetail, botApiUrl: this.editWA.botApiUrl };
      }
      this.orgWhatsApp = { ...this.orgWhatsApp, token: this.editWA.token, phoneNumberId: this.editWA.phoneNumberId, verifyToken: this.editWA.verifyToken };
      this.editingWA = false;
      this.showNotice('WhatsApp configurado');
    } catch (err) {
      console.error('Error saving WA config:', err);
    } finally {
      this.saving = false;
    }
  }

  // ── Helpers ──
  getCreatedDate(org: any): string {
    if (!org.createdAt?.seconds) return '—';
    return new Date(org.createdAt.seconds * 1000).toLocaleDateString('es');
  }

  maskToken(token: string): string {
    if (!token || token.length < 12) return token || '—';
    return token.substring(0, 8) + '...' + token.substring(token.length - 4);
  }

  // ── Admin Management ──
  startAddAdmin(): void {
    this.newAdmin = { name: '', email: '', password: '', role: 'editor' };
    this.addAdminError = '';
    this.addAdminNotice = '';
    this.addingAdmin = true;
  }

  cancelAddAdmin(): void {
    this.addingAdmin = false;
    this.addAdminError = '';
  }

  async addAdminToOrg(): Promise<void> {
    if (!this.selectedOrg) return;
    if (!this.newAdmin.email.trim() || !this.newAdmin.password.trim()) {
      this.addAdminError = 'Email y contraseña son requeridos';
      return;
    }
    if (this.newAdmin.password.length < 6) {
      this.addAdminError = 'La contraseña debe tener al menos 6 caracteres';
      return;
    }
    this.addAdminSaving = true;
    this.addAdminError = '';
    try {
      await this.firebaseService.createUserForOrg(
        this.selectedOrg.id,
        this.newAdmin.email.trim(),
        this.newAdmin.password,
        this.newAdmin.name.trim(),
        this.newAdmin.role
      );
      const admins = await this.firebaseService.getOrgAdminsByOrgId(this.selectedOrg.id);
      this.orgAdmins = admins;
      this.addingAdmin = false;
      this.addAdminNotice = 'Usuario creado y agregado al equipo';
      setTimeout(() => this.addAdminNotice = '', 4000);
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/email-already-in-use') {
        this.addAdminError = 'Este email ya tiene una cuenta registrada';
      } else if (code === 'auth/invalid-email') {
        this.addAdminError = 'Email inválido';
      } else {
        this.addAdminError = 'Error al crear usuario. Intenta de nuevo.';
      }
    } finally {
      this.addAdminSaving = false;
    }
  }

  async removeAdminFromOrg(admin: any): Promise<void> {
    if (!this.selectedOrg || !admin.id) return;
    if (!confirm(`¿Quitar a ${admin.email} del equipo?`)) return;
    try {
      await this.firebaseService.deleteAdminByOrgId(this.selectedOrg.id, admin.id);
      this.orgAdmins = this.orgAdmins.filter(a => a.id !== admin.id);
    } catch (err) {
      console.error('Error removing admin:', err);
    }
  }

  // ── Password Change ──
  startChangePwSA(adm: any): void {
    this.changePwAdm = adm;
    this.changePwVal = '';
    this.changePwError = '';
  }

  cancelChangePwSA(): void {
    this.changePwAdm = null;
    this.changePwVal = '';
    this.changePwError = '';
  }

  async saveChangePwSA(): Promise<void> {
    if (!this.changePwAdm?.uid) return;
    if (this.changePwVal.length < 6) {
      this.changePwError = 'La contraseña debe tener al menos 6 caracteres';
      return;
    }
    this.changePwSaving = true;
    this.changePwError = '';
    try {
      const botUrl = this.orgDetail?.botApiUrl;
      await this.firebaseService.setUserPassword(botUrl, this.changePwAdm.uid, this.changePwVal);
      this.changePwAdm = null;
      this.changePwVal = '';
      this.showNotice('Contraseña actualizada');
    } catch (err: any) {
      this.changePwError = err?.message || 'Error al cambiar contraseña';
    } finally {
      this.changePwSaving = false;
    }
  }

  // ── Delete Organization ──
  openDeleteConfirm(org: any): void {
    this.deleteConfirmOrg = org;
    this.deleteConfirmText = '';
    this.deleting = false;
    this.deleteResult = null;
  }

  cancelDelete(): void {
    this.deleteConfirmOrg = null;
    this.deleteConfirmText = '';
    this.deleteResult = null;
  }

  get deleteConfirmValid(): boolean {
    return this.deleteConfirmText.trim() === this.deleteConfirmOrg?.id;
  }

  async executeDelete(): Promise<void> {
    if (!this.deleteConfirmOrg || !this.deleteConfirmValid) return;
    this.deleting = true;
    try {
      const result = await this.firebaseService.deleteOrganizationFull(this.deleteConfirmOrg.id);
      this.deleteResult = result;
      this.organizations = this.organizations.filter(o => o.id !== this.deleteConfirmOrg.id);
      this.applyFilter();
      this.selectedOrg = null;
    } catch (err) {
      console.error('Error deleting organization:', err);
      this.deleteResult = { deletedUsers: [] };
    } finally {
      this.deleting = false;
    }
  }

  closeDeleteResult(): void {
    this.deleteConfirmOrg = null;
    this.deleteConfirmText = '';
    this.deleteResult = null;
  }

  async viewOrgPage(org: any, path: string): Promise<void> {
    await this.authService.setOrgContextForSuperAdmin(org.id);
    this.router.navigate([`/admin/${path}`]);
  }

  openResetBotConfirm(org: any): void {
    this.resetBotConfirmOrg = org;
    this.resetBotDone = false;
  }

  cancelResetBot(): void {
    this.resetBotConfirmOrg = null;
    this.resetBotDone = false;
  }

  async confirmResetBot(): Promise<void> {
    if (!this.resetBotConfirmOrg || this.resettingBot) return;
    this.resettingBot = true;
    try {
      await this.firebaseService.resetOrgBotToDefault(this.resetBotConfirmOrg.id);
      this.resetBotDone = true;
    } catch (err) {
      console.error('Error resetting bot:', err);
    } finally {
      this.resettingBot = false;
    }
  }

  // ── Export ──
  async exportOrg(org: any): Promise<void> {
    this.exportingOrgId = org.id;
    try {
      const data = await this.firebaseService.exportOrgData(org.id);
      const payload = { version: '2', type: 'org_export', exportedAt: new Date().toISOString(), orgs: [data] };
      this.downloadJson(payload, `org-${org.id}-${Date.now()}.json`);
    } catch (err) {
      console.error('Error exporting org:', err);
    } finally {
      this.exportingOrgId = null;
    }
  }

  async exportAllOrgs(): Promise<void> {
    this.exportingAll = true;
    try {
      const orgs = [];
      for (const org of this.organizations) {
        orgs.push(await this.firebaseService.exportOrgData(org.id));
      }
      const payload = { version: '2', type: 'multi_org_export', exportedAt: new Date().toISOString(), orgs };
      this.downloadJson(payload, `orgs-all-${Date.now()}.json`);
    } catch (err) {
      console.error('Error exporting all orgs:', err);
    } finally {
      this.exportingAll = false;
    }
  }

  private downloadJson(data: any, filename: string): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Import ──
  openImport(): void {
    this.importModalOpen = true;
    this.importParsed = [];
    this.importError = '';
    this.importOverwrite = false;
    this.importSaving = false;
    this.importDone = false;
    this.importResults = [];
  }

  cancelImport(): void {
    this.importModalOpen = false;
    this.importError = '';
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target!.result as string);
        if (!parsed.orgs || !Array.isArray(parsed.orgs)) {
          this.importError = 'Archivo inválido: falta el campo "orgs"';
          this.importParsed = [];
          return;
        }
        this.importError = '';
        this.importParsed = parsed.orgs;
      } catch (_) {
        this.importError = 'No se pudo parsear el archivo JSON';
        this.importParsed = [];
      }
    };
    reader.readAsText(input.files[0]);
  }

  orgExistsInList(orgId: string): boolean {
    return this.organizations.some(o => o.id === orgId);
  }

  async executeImport(): Promise<void> {
    if (!this.importParsed.length || this.importSaving) return;
    this.importSaving = true;
    this.importResults = [];
    for (const orgExport of this.importParsed) {
      const existed = this.orgExistsInList(orgExport.id);
      try {
        await this.firebaseService.importOrgData(orgExport, this.importOverwrite);
        this.importResults.push({ id: orgExport.id, name: orgExport.config?.general?.orgName || orgExport.data?.name || orgExport.id, existed, success: true });
      } catch (err: any) {
        this.importResults.push({ id: orgExport.id, name: orgExport.config?.general?.orgName || orgExport.data?.name || orgExport.id, existed, success: false, error: err?.message || 'Error' });
      }
    }
    this.importSaving = false;
    this.importDone = true;
    await this.loadOrganizations();
  }

  // ── Load Config ──
  openLoadConfig(): void {
    this.loadConfigOrg = this.selectedOrg;
    this.loadConfigJson = '';
    this.loadConfigParsed = null;
    this.loadConfigError = '';
    this.loadConfigSaving = false;
    this.loadConfigDone = false;
  }

  cancelLoadConfig(): void {
    this.loadConfigOrg = null;
    this.loadConfigError = '';
  }

  onLoadConfigFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      this.loadConfigJson = e.target!.result as string;
      this.parseLoadConfig();
    };
    reader.readAsText(input.files[0]);
  }

  parseLoadConfig(): void {
    this.loadConfigError = '';
    this.loadConfigParsed = null;
    if (!this.loadConfigJson.trim()) return;
    try {
      const parsed = JSON.parse(this.loadConfigJson);
      if (!parsed.version || !Array.isArray(parsed.flows)) {
        this.loadConfigError = 'JSON inválido: falta "version" o "flows"';
        return;
      }
      this.loadConfigParsed = parsed;
    } catch (_) {
      this.loadConfigError = 'No se pudo parsear el JSON';
    }
  }

  async executeLoadConfig(): Promise<void> {
    if (!this.loadConfigOrg || !this.loadConfigParsed || this.loadConfigSaving) return;
    this.loadConfigSaving = true;
    this.loadConfigError = '';
    try {
      await this.firebaseService.applyOrgSeedConfig(this.loadConfigOrg.id, this.loadConfigParsed);
      this.loadConfigDone = true;
    } catch (err: any) {
      this.loadConfigError = err?.message || 'Error al aplicar la configuración';
    } finally {
      this.loadConfigSaving = false;
    }
  }

  private showNotice(msg: string): void {
    this.notice = msg;
    setTimeout(() => this.notice = '', 3000);
  }
}
