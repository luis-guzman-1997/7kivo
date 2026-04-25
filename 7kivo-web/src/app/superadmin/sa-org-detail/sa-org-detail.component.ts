import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-sa-org-detail',
  templateUrl: './sa-org-detail.component.html',
  styleUrls: ['./sa-org-detail.component.css']
})
export class SaOrgDetailComponent implements OnInit {
  selectedOrg: any = null;
  orgDetail: any = null;
  orgWhatsApp: any = null;
  orgAdmins: any[] = [];
  loadingDetail = false;
  loadingOrg = true;
  detailTab = 'info';

  editingPlan = false;
  editPlan = '';
  editMonthlyRate: number | null = null;
  editDailyBulkLimit = 0;
  useCustomLimits = false;
  editLimits: any = { flows: 1, collections: 1, admins: 1, chatLive: true };

  platformPlans: any[] = [];

  editingGeneral = false;
  editGeneral: any = {};

  editingWA = false;
  editWA: any = {};

  orgGoogleCalendar: any = {};
  editingGC = false;
  editGC: any = {};

  editAudio: any = { enabled: false, maxSeconds: 30 };

  testingApi = false;
  apiTestResult: { ok: boolean; error?: string } | null = null;

  logoFile: File | null = null;
  logoPreview = '';

  saving = false;
  notice = '';

  actionsMenuOpen = false;

  togglingBlock: { [orgId: string]: boolean } = {};
  togglingActive: { [orgId: string]: boolean } = {};
  togglingBot: { [orgId: string]: boolean } = {};
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
  changePwConfirm = '';
  changePwVisible = false;
  changePwSaving = false;
  changePwError = '';

  editingRoleAdm: any = null;
  editRoleVal = '';
  roleChangeSaving = false;

  shareWaAdm: any = null;
  shareWaPw = '';
  shareWaPwVisible = false;

  resetBotConfirmOrg: any = null;
  resettingBot = false;
  resetBotDone = false;

  webhookModalOpen = false;
  webhookForm: any = {};
  webhookSaving = false;
  webhookSaved = false;
  webhookUrlCopied = false;
  webhookTokenCopied = false;

  loadConfigOrg: any = null;
  loadConfigJson = '';
  loadConfigParsed: any = null;
  loadConfigError = '';
  loadConfigSaving = false;
  loadConfigDone = false;

  exportingOrgId: string | null = null;

  teamSlugEdit = '';
  teamSlugSaving = false;
  teamSlugError = '';
  teamLoginUrlCopied = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private firebaseService: FirebaseService,
    private authService: AuthService
  ) {}

  async ngOnInit(): Promise<void> {
    const orgId = this.route.snapshot.paramMap.get('orgId')!;
    await Promise.all([this.loadOrgById(orgId), this.loadPlans()]);
  }

  async loadPlans(): Promise<void> {
    try {
      const data = await this.firebaseService.getPlatformPlans();
      this.platformPlans = (data?.plans || []).filter((p: any) => p.active);
    } catch (err) {
      console.error('Error loading plans:', err);
    }
  }

  async loadOrgById(orgId: string): Promise<void> {
    this.loadingOrg = true;
    try {
      const org = await this.firebaseService.getOrganization(orgId);
      if (!org) {
        this.router.navigate(['/superadmin/organizaciones']);
        return;
      }
      // Enrich with config data same as the list component does
      const config = await this.firebaseService.getOrgConfigByOrgId(orgId);
      org.orgName = config?.orgName || org.name || org.id;
      org.industry = config?.industry || org.industry || 'general';
      org.orgLogo = config?.orgLogo || '';
      this.selectedOrg = org;
      this.syncTeamSlugFromOrg();
      await this.loadDetail();
    } catch (err) {
      console.error('Error loading org:', err);
    } finally {
      this.loadingOrg = false;
    }
  }

  async loadDetail(): Promise<void> {
    if (!this.selectedOrg) return;
    this.loadingDetail = true;
    this.editingPlan = false;
    this.editingGeneral = false;
    this.editingWA = false;
    this.editingGC = false;
    this.apiTestResult = null;
    this.addingAdmin = false;
    this.addAdminError = '';
    this.addAdminNotice = '';
    this.notice = '';
    this.changePwAdm = null;
    this.changePwVal = '';
    this.changePwError = '';
    this.shareWaAdm = null;
    this.shareWaPw = '';
    try {
      const [detail, wa, admins, gc] = await Promise.all([
        this.firebaseService.getOrgConfigByOrgId(this.selectedOrg.id),
        this.firebaseService.getWhatsAppConfigByOrgId(this.selectedOrg.id),
        this.firebaseService.getOrgAdminsByOrgId(this.selectedOrg.id),
        this.firebaseService.getGoogleCalendarConfigByOrgId(this.selectedOrg.id)
      ]);
      this.orgDetail = detail || {};
      this.orgWhatsApp = wa || {};
      this.orgGoogleCalendar = gc || {};
      this.orgAdmins = admins;
      this.logoPreview = this.orgDetail.orgLogo || '';
      this.editAudio = {
        enabled: this.orgDetail.deliveryAudioEnabled === true,
        maxSeconds: this.orgDetail.deliveryAudioMaxSeconds || 30
      };
    } catch (err) {
      console.error('Error loading org detail:', err);
    } finally {
      this.loadingDetail = false;
    }
  }

  goBack(): void {
    this.router.navigate(['/superadmin/organizaciones']);
  }

  private syncTeamSlugFromOrg(): void {
    if (!this.selectedOrg) return;
    const raw = this.selectedOrg.loginSlug || this.selectedOrg.id || '';
    this.teamSlugEdit = String(raw).toLowerCase();
    this.teamSlugError = '';
  }

  onTeamSlugInput(): void {
    this.teamSlugEdit = this.teamSlugEdit.toLowerCase().replace(/\s+/g, '-');
    this.teamSlugError = '';
  }

  useOrgIdAsLoginSlug(): void {
    if (!this.selectedOrg?.id) return;
    this.teamSlugEdit = String(this.selectedOrg.id)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');
    this.teamSlugError = '';
  }

  get normalizedTeamSlug(): string {
    return (this.teamSlugEdit || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  get teamLoginPreviewHref(): string {
    const slug = this.normalizedTeamSlug;
    if (!slug) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return origin ? `${origin}/admin/login/${slug}` : `/admin/login/${slug}`;
  }

  get hasUnsavedTeamSlug(): boolean {
    const saved = (this.selectedOrg?.loginSlug ?? '').toString();
    return this.normalizedTeamSlug !== saved;
  }

  get teamSlugActive(): boolean {
    return !!(this.selectedOrg?.loginSlug && String(this.selectedOrg.loginSlug).length);
  }

  async saveTeamLoginSlug(): Promise<void> {
    if (!this.selectedOrg || this.teamSlugSaving) return;
    const slug = this.normalizedTeamSlug;
    const previousSlug = (this.selectedOrg.loginSlug ?? '').toString().trim() || null;
    this.teamSlugSaving = true;
    this.teamSlugError = '';
    try {
      if (slug) {
        const existing = await this.firebaseService.getOrgByLoginSlug(slug);
        if (existing && existing.id !== this.selectedOrg.id) {
          this.teamSlugError = 'Este slug ya está en uso por otra organización';
          return;
        }
      }
      const payload: { loginSlug: string | null } = { loginSlug: slug ? slug : null };
      await this.firebaseService.updateOrganization(this.selectedOrg.id, payload);

      const verified = await this.firebaseService.getOrganization(this.selectedOrg.id);
      if (!verified) {
        this.teamSlugError = 'No se pudo leer la organización tras guardar.';
        return;
      }
      const saved = (verified.loginSlug ?? '').toString();
      const expect = slug || '';
      if (saved !== expect) {
        this.teamSlugError = 'El slug no se guardó en el servidor. Revisa permisos de Firestore para organizations.';
        return;
      }

      this.selectedOrg.loginSlug = verified.loginSlug ?? null;
      this.syncTeamSlugFromOrg();

      const orgName = this.orgDetail?.orgName || this.selectedOrg?.orgName || this.selectedOrg.id;
      const orgLogo = this.orgDetail?.orgLogo || this.selectedOrg?.orgLogo || '';
      try {
        await this.firebaseService.syncPublicOrgLoginSlug({
          orgId: this.selectedOrg.id,
          slug: slug || null,
          previousSlug,
          orgName,
          orgLogo: orgLogo || null
        });
      } catch (pubErr) {
        console.error('syncPublicOrgLoginSlug', pubErr);
        this.teamSlugError =
          'Slug guardado, pero la URL pública no funcionará hasta añadir reglas para orgPublicSlugs (lectura pública). Ver comentario en firebase.service.ts.';
        return;
      }

      this.showNotice(slug ? 'Enlace de login activado' : 'Enlace de login desactivado');
    } catch (err) {
      console.error('saveTeamLoginSlug:', err);
      this.teamSlugError = 'No se pudo guardar. ¿Existe el documento de la organización en Firestore?';
    } finally {
      this.teamSlugSaving = false;
    }
  }

  copyTeamLoginUrl(): void {
    const url = this.teamLoginPreviewHref;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      this.teamLoginUrlCopied = true;
      setTimeout(() => (this.teamLoginUrlCopied = false), 2000);
    });
  }

  // ── Plan ──
  startEditPlan(): void {
    this.editPlan = this.selectedOrg?.plan || '';
    this.editMonthlyRate = this.selectedOrg?.monthlyRate || null;
    this.editDailyBulkLimit = this.selectedOrg?.dailyBulkLimit ?? 0;
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
        monthlyRate: this.editMonthlyRate || 0,
        dailyBulkLimit: this.editDailyBulkLimit ?? 0
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
      this.selectedOrg.dailyBulkLimit = data.dailyBulkLimit;
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
      industry: this.orgDetail?.industry || 'general',
      privacyPolicy: this.orgDetail?.privacyPolicy || ''
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
      if (data.privacyPolicy !== undefined) {
        await this.firebaseService.savePublicOrgInfo(this.selectedOrg.id, {
          privacyPolicy: data.privacyPolicy,
          orgName: data.orgName || '',
          orgLogo: data.orgLogo || this.orgDetail?.orgLogo || ''
        });
      }
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

  // ── Google Calendar Config ──
  startEditGC(): void {
    this.editGC = {
      enabled: this.orgGoogleCalendar?.enabled ?? false,
      calendarId: this.orgGoogleCalendar?.calendarId || ''
    };
    this.editingGC = true;
  }

  cancelEditGC(): void { this.editingGC = false; }

  async saveGC(): Promise<void> {
    if (!this.selectedOrg) return;
    this.saving = true;
    try {
      await this.firebaseService.saveGoogleCalendarConfigByOrgId(this.selectedOrg.id, {
        enabled: this.editGC.enabled,
        calendarId: this.editGC.calendarId.trim()
      });
      this.orgGoogleCalendar = { ...this.orgGoogleCalendar, ...this.editGC };
      this.editingGC = false;
      this.showNotice('Google Calendar configurado');
    } catch (err) {
      console.error('Error saving Google Calendar config:', err);
    } finally {
      this.saving = false;
    }
  }

  // ── Audio Delivery Config ──
  async saveAudioConfig(): Promise<void> {
    if (!this.selectedOrg) return;
    this.saving = true;
    try {
      const data = {
        deliveryAudioEnabled: this.editAudio.enabled,
        deliveryAudioMaxSeconds: Number(this.editAudio.maxSeconds) || 30
      };
      await this.firebaseService.saveOrgConfigByOrgId(this.selectedOrg.id, data);
      this.orgDetail = { ...this.orgDetail, ...data };
      this.showNotice('Configuración de audio guardada');
    } catch (err) {
      console.error('Error saving audio config:', err);
    } finally {
      this.saving = false;
    }
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
        await this.firebaseService.savePublicOrgInfo(this.selectedOrg.id, { botApiUrl: this.editWA.botApiUrl });
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

  // ── Toggle states ──
  async toggleActive(org: any): Promise<void> {
    if (this.togglingActive[org.id]) return;
    this.togglingActive[org.id] = true;
    const newVal = org.active === false;
    try {
      await this.firebaseService.updateOrganization(org.id, { active: newVal });
      org.active = newVal;
    } catch (err) {
      console.error('Error toggling org active:', err);
    } finally {
      this.togglingActive[org.id] = false;
    }
  }

  async toggleBot(org: any): Promise<void> {
    if (this.togglingBot[org.id]) return;
    const newVal = org.botEnabled === false;
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
    this.togglingBot[org.id] = true;
    try {
      await this.firebaseService.updateOrganization(org.id, { botEnabled: newVal });
      org.botEnabled = newVal;
      this.botToggleError = null;
    } catch (err) {
      console.error('Error toggling bot:', err);
    } finally {
      this.togglingBot[org.id] = false;
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

  // ── Helpers ──
  getCreatedDate(org: any): string {
    if (!org?.createdAt?.seconds) return '—';
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
    this.changePwConfirm = '';
    this.changePwVisible = false;
    this.changePwError = '';
    this.editingRoleAdm = null;
    this.shareWaAdm = null;
  }

  cancelChangePwSA(): void {
    this.changePwAdm = null;
    this.changePwVal = '';
    this.changePwConfirm = '';
    this.changePwError = '';
  }

  async saveChangePwSA(): Promise<void> {
    if (!this.changePwAdm?.uid) return;
    if (this.changePwVal.length < 6) {
      this.changePwError = 'La contraseña debe tener al menos 6 caracteres';
      return;
    }
    if (this.changePwVal !== this.changePwConfirm) {
      this.changePwError = 'Las contraseñas no coinciden';
      return;
    }
    this.changePwSaving = true;
    this.changePwError = '';
    try {
      const botUrl = this.orgDetail?.botApiUrl;
      await this.firebaseService.setUserPassword(botUrl, this.changePwAdm.uid, this.changePwVal);
      this.changePwAdm = null;
      this.changePwVal = '';
      this.changePwConfirm = '';
      this.showNotice('Contraseña actualizada');
    } catch (err: any) {
      this.changePwError = err?.message || 'Error al cambiar contraseña';
    } finally {
      this.changePwSaving = false;
    }
  }

  // ── WhatsApp Share ──
  startShareWA(adm: any): void {
    this.shareWaAdm = adm;
    this.shareWaPw = '';
    this.shareWaPwVisible = false;
    this.changePwAdm = null;
    this.editingRoleAdm = null;
  }

  cancelShareWA(): void {
    this.shareWaAdm = null;
    this.shareWaPw = '';
  }

  openShareWA(adm: any): void {
    const loginUrl = this.teamLoginPreviewHref || (window.location.origin + '/admin/login/' + (this.selectedOrg?.loginSlug || this.selectedOrg?.id || ''));
    const name = adm.name || adm.email;
    const pw = this.shareWaPw.trim();
    let msg = `Hola ${name}, aquí tus credenciales de acceso al panel:\n\n`;
    msg += `🔗 Acceso: ${loginUrl}\n`;
    msg += `📧 Usuario: ${adm.email}\n`;
    if (pw) msg += `🔑 Contraseña: ${pw}\n`;
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }

  // ── Role Change ──
  startEditRole(adm: any): void {
    this.editingRoleAdm = adm;
    this.editRoleVal = adm.role || 'viewer';
    this.changePwAdm = null;
    this.shareWaAdm = null;
  }

  cancelEditRole(): void {
    this.editingRoleAdm = null;
  }

  async saveEditRole(): Promise<void> {
    if (!this.editingRoleAdm || !this.selectedOrg) return;
    if (this.editRoleVal === this.editingRoleAdm.role) { this.editingRoleAdm = null; return; }
    this.roleChangeSaving = true;
    try {
      await this.firebaseService.updateOrgAdminByOrgId(this.selectedOrg.id, this.editingRoleAdm.id, { role: this.editRoleVal });
      this.editingRoleAdm.role = this.editRoleVal;
      this.editingRoleAdm = null;
      this.showNotice('Rol actualizado');
    } catch (err) {
      console.error('Error changing role:', err);
    } finally {
      this.roleChangeSaving = false;
    }
  }

  roleLabel(role: string): string {
    const map: any = { owner: 'Propietario', admin: 'Gerente', editor: 'Operador', viewer: 'Agente' };
    return map[role] || role;
  }

  adminInitials(adm: any): string {
    const src = adm.name || adm.email || '?';
    return src.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase();
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
    // Navigate back to the list after deletion
    this.router.navigate(['/superadmin/organizaciones']);
  }

  async viewOrgPage(org: any, path: string): Promise<void> {
    await this.authService.setOrgContextForSuperAdmin(org.id);
    this.router.navigate([`/admin/${path}`]);
  }

  // ── Reset Bot ──
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

  private downloadJson(data: any, filename: string): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
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

  // ── Webhook ──
  get webhookUrl(): string {
    const base = (this.webhookForm.botApiUrl || this.orgDetail?.botApiUrl || '').replace(/\/$/, '');
    if (!base || !this.selectedOrg?.id) return '';
    return `${base}/auth/${this.selectedOrg.id}`;
  }

  openWebhookModal(): void {
    this.webhookForm = {
      botApiUrl: this.orgDetail?.botApiUrl || '',
      token: this.orgWhatsApp?.token || '',
      phoneNumberId: this.orgWhatsApp?.phoneNumberId || '',
      verifyToken: this.orgWhatsApp?.verifyToken || ''
    };
    this.webhookSaved = false;
    this.webhookUrlCopied = false;
    this.webhookTokenCopied = false;
    this.webhookModalOpen = true;
  }

  closeWebhookModal(): void {
    this.webhookModalOpen = false;
  }

  generateWebhookToken(): void {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    this.webhookForm.verifyToken = Array.from({ length: 32 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    this.webhookSaved = false;
  }

  async saveWebhookConfig(): Promise<void> {
    if (!this.selectedOrg) return;
    this.webhookSaving = true;
    this.webhookSaved = false;
    try {
      await this.firebaseService.saveWhatsAppConfigByOrgId(this.selectedOrg.id, {
        token: this.webhookForm.token,
        phoneNumberId: this.webhookForm.phoneNumberId,
        verifyToken: this.webhookForm.verifyToken
      });
      if (this.webhookForm.botApiUrl !== undefined) {
        await this.firebaseService.saveOrgConfigByOrgId(this.selectedOrg.id, { botApiUrl: this.webhookForm.botApiUrl });
        this.orgDetail = { ...this.orgDetail, botApiUrl: this.webhookForm.botApiUrl };
      }
      this.orgWhatsApp = {
        ...this.orgWhatsApp,
        token: this.webhookForm.token,
        phoneNumberId: this.webhookForm.phoneNumberId,
        verifyToken: this.webhookForm.verifyToken
      };
      this.webhookSaved = true;
    } catch (err) {
      console.error('Error saving webhook config:', err);
    } finally {
      this.webhookSaving = false;
    }
  }

  copyToClipboard(text: string, type: 'url' | 'token'): void {
    navigator.clipboard.writeText(text).then(() => {
      if (type === 'url') {
        this.webhookUrlCopied = true;
        setTimeout(() => this.webhookUrlCopied = false, 2000);
      } else {
        this.webhookTokenCopied = true;
        setTimeout(() => this.webhookTokenCopied = false, 2000);
      }
    });
  }

  private showNotice(msg: string): void {
    this.notice = msg;
    setTimeout(() => this.notice = '', 3000);
  }
}
