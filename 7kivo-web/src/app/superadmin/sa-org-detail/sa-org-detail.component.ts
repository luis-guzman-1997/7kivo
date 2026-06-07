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
  testingWA = false;
  waTestResult: { ok: boolean; total?: number; approved?: number; error?: string } | null = null;

  // Crear plantilla de WhatsApp
  showCreateTemplate = false;
  creatingTemplate = false;
  templateForm: any = {
    name: '', language: 'es', category: 'UTILITY', body: '', footer: '', examples: [],
    headerType: 'none', headerText: '', headerImageUrl: '', buttons: []
  };
  createTemplateResult: { ok: boolean; status?: string; name?: string; error?: string } | null = null;

  // Listado / borrado de plantillas
  showTemplatesList = false;
  loadingTemplatesList = false;
  templatesList: any[] = [];
  templatesListError = '';
  deletingTemplate: string | null = null;

  logoFile: File | null = null;
  logoPreview = '';

  // ── Gastos de campañas (facturación mensual, organizations/{id}/billing) ──
  billingMonths: any[] = [];
  loadingBilling = false;
  billingError = '';
  abonoMonth: string | null = null; // mes con el formulario de abono abierto
  abonoAmount: number | null = null;
  abonoNote = '';
  abonoSaving = false;
  abonoError = '';

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

  // ── Gastos de campañas ──
  openBillingTab(): void {
    this.detailTab = 'billing';
    if (this.billingMonths.length === 0 && !this.loadingBilling) this.loadBilling();
  }

  async loadBilling(): Promise<void> {
    if (!this.selectedOrg) return;
    this.loadingBilling = true;
    this.billingError = '';
    try {
      this.billingMonths = await this.firebaseService.getOrgBilling(this.selectedOrg.id);
    } catch (err: any) {
      this.billingError = err?.message || 'Error al cargar los gastos';
    } finally {
      this.loadingBilling = false;
    }
  }

  billingBalance(b: any): number {
    return Math.max(0, (Number(b.totalCost) || 0) - (Number(b.paidAmount) || 0));
  }

  // Estado calculado en vivo (el totalCost puede crecer después de un pago)
  billingStatus(b: any): 'paid' | 'partial' | 'pending' {
    const cost = Number(b.totalCost) || 0;
    const paid = Number(b.paidAmount) || 0;
    if (cost > 0 && paid >= cost - 0.005) return 'paid';
    return paid > 0 ? 'partial' : 'pending';
  }

  billingStatusLabel(b: any): string {
    const m = { paid: 'Pagado', partial: 'Abonado', pending: 'Pendiente' };
    return m[this.billingStatus(b)];
  }

  monthLabel(month: string): string {
    const [y, m] = String(month || '').split('-').map(Number);
    if (!y || !m) return month;
    const names = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${names[m - 1]} ${y}`;
  }

  // Desglose por categoría de plantilla para mostrar como chips
  billingCategories(b: any): Array<{ label: string; sent: number; cost: number }> {
    const names: Record<string, string> = {
      MARKETING: 'Marketing', UTILITY: 'Utilidad', AUTHENTICATION: 'Autenticación', FREEFORM: 'Mensaje libre'
    };
    const by = b.byCategory || {};
    return Object.keys(by).map(k => ({
      label: names[k] || k,
      sent: Number(by[k]?.sent) || 0,
      cost: Number(by[k]?.cost) || 0
    }));
  }

  paymentDate(p: any): string {
    try { return new Date(p.at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return ''; }
  }

  openAbono(b: any): void {
    this.abonoMonth = b.month;
    this.abonoAmount = null;
    this.abonoNote = '';
    this.abonoError = '';
  }

  cancelAbono(): void {
    this.abonoMonth = null;
    this.abonoError = '';
  }

  async saveAbono(b: any): Promise<void> {
    const amount = Number(this.abonoAmount);
    if (!amount || amount <= 0) { this.abonoError = 'Ingresa un monto válido'; return; }
    this.abonoSaving = true;
    this.abonoError = '';
    try {
      const res = await this.firebaseService.addBillingPayment(this.selectedOrg.id, b.month, {
        amount, note: this.abonoNote.trim()
      });
      Object.assign(b, res);
      this.abonoMonth = null;
    } catch (err: any) {
      this.abonoError = err?.message || 'Error al registrar el abono';
    } finally {
      this.abonoSaving = false;
    }
  }

  // Registra un abono por el saldo restante y deja el mes como pagado
  async markBillingPaid(b: any): Promise<void> {
    const saldo = this.billingBalance(b);
    if (saldo <= 0) return;
    this.abonoSaving = true;
    try {
      const res = await this.firebaseService.addBillingPayment(this.selectedOrg.id, b.month, {
        amount: Number(saldo.toFixed(2)), note: 'Pago total'
      });
      Object.assign(b, res);
    } catch (err: any) {
      this.billingError = err?.message || 'Error al marcar como pagado';
    } finally {
      this.abonoSaving = false;
    }
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
      wabaId: this.orgWhatsApp?.wabaId || '',
      appId: this.orgWhatsApp?.appId || '',
      botApiUrl: this.orgDetail?.botApiUrl || '',
      waPhone: this.orgDetail?.waPhone || ''
    };
    this.editingWA = true;
    this.apiTestResult = null;
  }

  cancelEditWA(): void { this.editingWA = false; this.apiTestResult = null; this.waTestResult = null; }

  // Prueba el token + WABA ID escritos en el formulario (sin guardarlos) contra Meta
  async testWhatsApp(): Promise<void> {
    const botApiUrl = (this.editWA.botApiUrl || this.orgDetail?.botApiUrl || '').trim();
    if (!botApiUrl) { this.waTestResult = { ok: false, error: 'Configura primero la URL del bot' }; return; }
    if (!this.editWA.token || !this.editWA.wabaId) { this.waTestResult = { ok: false, error: 'Ingresa el token y el WABA ID' }; return; }
    this.testingWA = true;
    this.waTestResult = null;
    try {
      this.waTestResult = await this.firebaseService.testWhatsAppTemplates(botApiUrl, {
        token: this.editWA.token.trim(),
        wabaId: (this.editWA.wabaId || '').trim()
      });
    } catch (err: any) {
      this.waTestResult = { ok: false, error: err?.message || 'No se pudo contactar al bot (¿URL correcta / en línea?)' };
    } finally {
      this.testingWA = false;
    }
  }

  // ── Crear plantilla de WhatsApp ──
  openCreateTemplate(): void {
    this.templateForm = {
      name: '', language: 'es', category: 'UTILITY', body: '', footer: '', examples: [],
      headerType: 'none', headerText: '', headerImageUrl: '', buttons: []
    };
    this.createTemplateResult = null;
    this.showCreateTemplate = true;
  }

  addTemplateButton(type: 'quick_reply' | 'url'): void {
    if ((this.templateForm.buttons || []).length >= 10) return;
    this.templateForm.buttons.push(type === 'url' ? { type: 'url', text: '', url: '' } : { type: 'quick_reply', text: '' });
  }

  removeTemplateButton(i: number): void {
    this.templateForm.buttons.splice(i, 1);
  }

  closeCreateTemplate(): void {
    this.showCreateTemplate = false;
    this.createTemplateResult = null;
  }

  // Recalcula los campos de ejemplo según las variables {{n}} del cuerpo
  onTemplateBodyChange(): void {
    const count = (String(this.templateForm.body || '').match(/\{\{\s*\d+\s*\}\}/g) || []).length;
    const existing = this.templateForm.examples || [];
    this.templateForm.examples = Array.from({ length: count }, (_, i) => existing[i] || '');
  }

  varLabel(i: number): string { return '{{' + (i + 1) + '}}'; }

  get templatePreview(): string {
    let text = String(this.templateForm.body || '');
    (this.templateForm.examples || []).forEach((ex: string, i: number) => {
      const re = new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, 'g');
      text = text.replace(re, (ex || '').trim() || `{{${i + 1}}}`);
    });
    return text;
  }

  async submitTemplate(): Promise<void> {
    const botApiUrl = (this.editWA.botApiUrl || this.orgDetail?.botApiUrl || '').trim();
    if (!botApiUrl) { this.createTemplateResult = { ok: false, error: 'Configura primero la URL del bot' }; return; }
    if (!this.editWA.token || !this.editWA.wabaId) { this.createTemplateResult = { ok: false, error: 'Ingresa el token y el WABA ID arriba' }; return; }
    if (!this.templateForm.name?.trim()) { this.createTemplateResult = { ok: false, error: 'El nombre es requerido' }; return; }
    if (!this.templateForm.body?.trim()) { this.createTemplateResult = { ok: false, error: 'El cuerpo del mensaje es requerido' }; return; }
    const missingEx = (this.templateForm.examples || []).some((e: string) => !String(e || '').trim());
    if (missingEx) { this.createTemplateResult = { ok: false, error: 'Completa un ejemplo para cada variable' }; return; }

    // Validaciones de header/botones
    if (this.templateForm.headerType === 'image' && !this.templateForm.headerImageUrl?.trim()) {
      this.createTemplateResult = { ok: false, error: 'Ingresa la URL de la imagen de encabezado' }; return;
    }
    if (this.templateForm.headerType === 'image' && !this.editWA.appId?.trim()) {
      this.createTemplateResult = { ok: false, error: 'Para imagen de encabezado necesitas configurar el App ID de Meta arriba' }; return;
    }
    const badBtn = (this.templateForm.buttons || []).some((b: any) =>
      !String(b.text || '').trim() || (b.type === 'url' && !String(b.url || '').trim()));
    if (badBtn) { this.createTemplateResult = { ok: false, error: 'Completa el texto (y URL) de cada botón' }; return; }

    const header = this.templateForm.headerType === 'text'
      ? { type: 'text', text: (this.templateForm.headerText || '').trim() }
      : this.templateForm.headerType === 'image'
        ? { type: 'image', imageUrl: (this.templateForm.headerImageUrl || '').trim() }
        : null;

    this.creatingTemplate = true;
    this.createTemplateResult = null;
    try {
      const res = await this.firebaseService.createTemplate(botApiUrl, {
        token: this.editWA.token.trim(),
        wabaId: (this.editWA.wabaId || '').trim(),
        appId: (this.editWA.appId || '').trim(),
        name: this.templateForm.name.trim(),
        language: this.templateForm.language || 'es',
        category: this.templateForm.category || 'UTILITY',
        body: this.templateForm.body.trim(),
        footer: (this.templateForm.footer || '').trim(),
        examples: this.templateForm.examples || [],
        header,
        buttons: this.templateForm.buttons || []
      });
      this.createTemplateResult = res;
      if (res.ok && this.showTemplatesList) this.loadTemplatesList();
    } catch (err: any) {
      this.createTemplateResult = { ok: false, error: err?.message || 'No se pudo contactar al bot' };
    } finally {
      this.creatingTemplate = false;
    }
  }

  // ── Listar / borrar plantillas ──
  async toggleTemplatesList(): Promise<void> {
    this.showTemplatesList = !this.showTemplatesList;
    if (this.showTemplatesList && this.templatesList.length === 0) await this.loadTemplatesList();
  }

  async loadTemplatesList(): Promise<void> {
    const botApiUrl = (this.editWA.botApiUrl || this.orgDetail?.botApiUrl || '').trim();
    if (!botApiUrl) { this.templatesListError = 'Configura la URL del bot'; return; }
    this.loadingTemplatesList = true;
    this.templatesListError = '';
    try {
      this.templatesList = await this.firebaseService.getAllTemplates(botApiUrl, this.selectedOrg.id);
    } catch (err: any) {
      this.templatesListError = err?.message || 'No se pudieron cargar las plantillas';
    } finally {
      this.loadingTemplatesList = false;
    }
  }

  async deleteTemplate(name: string): Promise<void> {
    if (!confirm(`¿Borrar la plantilla «${name}»? Esta acción no se puede deshacer.`)) return;
    const botApiUrl = (this.editWA.botApiUrl || this.orgDetail?.botApiUrl || '').trim();
    this.deletingTemplate = name;
    try {
      const res = await this.firebaseService.deleteTemplate(botApiUrl, {
        token: this.editWA.token.trim(),
        wabaId: (this.editWA.wabaId || '').trim(),
        name
      });
      if (res.ok) {
        this.templatesList = this.templatesList.filter(t => t.name !== name);
      } else {
        this.templatesListError = res.error || 'No se pudo borrar';
      }
    } catch (err: any) {
      this.templatesListError = err?.message || 'No se pudo borrar';
    } finally {
      this.deletingTemplate = null;
    }
  }

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
        verifyToken: this.editWA.verifyToken,
        wabaId: (this.editWA.wabaId || '').trim(),
        appId: (this.editWA.appId || '').trim()
      });
      if (this.editWA.botApiUrl !== undefined) {
        const waPhone = (this.editWA.waPhone || '').replace(/\D/g, '');
        await this.firebaseService.saveOrgConfigByOrgId(this.selectedOrg.id, { botApiUrl: this.editWA.botApiUrl, waPhone });
        await this.firebaseService.savePublicOrgInfo(this.selectedOrg.id, { botApiUrl: this.editWA.botApiUrl, waPhone });
        this.orgDetail = { ...this.orgDetail, botApiUrl: this.editWA.botApiUrl, waPhone };
      }
      this.orgWhatsApp = { ...this.orgWhatsApp, token: this.editWA.token, phoneNumberId: this.editWA.phoneNumberId, verifyToken: this.editWA.verifyToken, wabaId: (this.editWA.wabaId || '').trim(), appId: (this.editWA.appId || '').trim() };
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
