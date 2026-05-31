import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-campaigns',
  templateUrl: './campaigns.component.html',
  styleUrls: ['./campaigns.component.css']
})
export class CampaignsComponent implements OnInit {
  campaigns: any[] = [];
  filteredCampaigns: any[] = [];
  loading = true;
  filterTab: string = 'all';

  deliveryFlows: any[] = [];
  deliveryAdmins: any[] = [];
  adminSearch = '';
  filteredDeliveryAdmins: any[] = [];

  dailyBulkLimit = 0;
  totalSentToday = 0;
  orgId = '';

  orgCollections: any[] = [];
  selectedCollectionFields: any[] = [];

  showForm = false;
  editingCampaign: any = null;
  saving = false;
  formError = '';

  formImageFile: File | null = null;
  formImagePreview = '';
  uploadingImage = false;

  form: any = {};

  deletingCampaign: any = null;
  deleting = false;

  togglingId: string | null = null;
  isResend = false;

  expandedId: string | null = null;

  // Plantillas de WhatsApp (Meta) aprobadas
  templates: any[] = [];
  loadingTemplates = false;
  templatesError = '';
  templatesErrorRaw = '';
  selectedTemplate: any = null;

  // Días de la semana (orden lunes→domingo) para el selector semanal
  weekDays = [
    { value: 1, label: 'L', name: 'Lunes' },
    { value: 2, label: 'M', name: 'Martes' },
    { value: 3, label: 'M', name: 'Miércoles' },
    { value: 4, label: 'J', name: 'Jueves' },
    { value: 5, label: 'V', name: 'Viernes' },
    { value: 6, label: 'S', name: 'Sábado' },
    { value: 0, label: 'D', name: 'Domingo' }
  ];

  // Días disponibles para recurrencia mensual (1–31)
  monthDays = Array.from({ length: 31 }, (_, i) => i + 1);

  // Estado auxiliar para el offset del recordatorio (antes / mismo día / después)
  reminderDir: 'before' | 'same' | 'after' = 'before';
  reminderDays = 3;

  constructor(
    private firebaseService: FirebaseService,
    private authService: AuthService
  ) {}

  async ngOnInit(): Promise<void> {
    this.orgId = this.firebaseService.getOrgId() || '';
    const tasks: Promise<any>[] = [this.loadCampaigns(), this.loadOrgInfo(), this.loadCollections(), this.loadTemplates()];
    if (this.isDeliveryOrg) tasks.push(this.loadDeliveryFlows(), this.loadDeliveryAdmins());
    await Promise.all(tasks);
  }

  async loadCampaigns(): Promise<void> {
    this.loading = true;
    try {
      this.campaigns = await this.firebaseService.getCampaigns(this.orgId);
      this.computeTotals();
      this.applyFilter();
      this.resolveCollectionCounts();
    } catch (err) {
      console.error('Error loading campaigns:', err);
    } finally {
      this.loading = false;
    }
  }

  async loadOrgInfo(): Promise<void> {
    try {
      const org = await this.firebaseService.getOrganization(this.orgId);
      this.dailyBulkLimit = org?.dailyBulkLimit ?? 0;
    } catch (err) { console.error(err); }
  }

  async loadCollections(): Promise<void> {
    try {
      this.orgCollections = await this.firebaseService.getOrgCollectionDefs(this.orgId);
    } catch (err) { console.error(err); }
  }

  async loadTemplates(): Promise<void> {
    const botApiUrl = this.authService.botApiUrl;
    if (!botApiUrl) return;
    this.loadingTemplates = true;
    this.templatesError = '';
    this.templatesErrorRaw = '';
    try {
      this.templates = await this.firebaseService.getApprovedTemplates(botApiUrl, this.orgId);
    } catch (err: any) {
      const raw = err?.message || 'Error desconocido';
      this.templatesError = this.friendlyTemplateError(raw);
      // Solo mostramos el detalle técnico si difiere del mensaje amigable
      this.templatesErrorRaw = this.templatesError === raw ? '' : raw;
    } finally {
      this.loadingTemplates = false;
    }
  }

  // Traduce el error técnico de Meta/bot a un mensaje claro y accionable.
  // El orden importa: primero los errores específicos de WABA (código 100), luego permisos.
  private friendlyTemplateError(raw: string): string {
    const r = (raw || '').toLowerCase();
    if (r.includes('no configurado'))
      return 'Falta configurar el WABA ID de esta organización. Lo configura un administrador en el panel de superadmin.';
    // El ID existe pero no es una cuenta WhatsApp Business (no tiene el campo message_templates)
    if (r.includes('nonexisting field') || r.includes('message_templates'))
      return 'El ID configurado no es una cuenta de WhatsApp Business (WABA). Probablemente se puso el ID del negocio, de la App o del número. Corrige el WABA ID en el panel de superadmin.';
    // El ID no existe o no es accesible por el token
    if (r.includes('does not exist') || r.includes('subcode 33') || r.includes('cannot be loaded') || r.includes('código 100') || r.includes('(#100)'))
      return 'El WABA ID configurado no es válido o el token no tiene acceso a esa cuenta de WhatsApp. Verifica el WABA ID en Meta.';
    // Errores de permiso real de Meta
    if (r.includes('missing permission') || r.includes('(#200)') || r.includes('(#10)') || r.includes('permission denied'))
      return 'El token de WhatsApp no tiene permiso para gestionar plantillas (whatsapp_business_management). Pide a un administrador que regenere el token en Meta con ese permiso.';
    if (r.includes('url del bot') || r.includes('sesión'))
      return 'No se pudo contactar al bot. Verifica que esté configurado y en línea.';
    return raw || 'No se pudieron cargar las plantillas.';
  }

  setTemplateMode(): void {
    this.form.channelMode = 'template';
    if (this.templates.length === 0 && !this.loadingTemplates) this.loadTemplates();
  }

  onTemplateChange(): void {
    const tpl = this.templates.find(t => t.name === this.form.templateName);
    this.selectedTemplate = tpl || null;
    if (!tpl) return;
    this.form.templateLang = tpl.language || 'es';
    const body = (tpl.components || []).find((c: any) => c.type === 'BODY');
    const count = body && body.text ? (body.text.match(/\{\{\s*\d+\s*\}\}/g) || []).length : 0;
    const existing = this.form.templateVariables || [];
    this.form.templateVariables = Array.from({ length: count }, (_, i) => ({
      source: existing[i]?.source || 'static',
      value: existing[i]?.value || '',
      field: existing[i]?.field || ''
    }));
    const header = (tpl.components || []).find((c: any) => c.type === 'HEADER');
    this.form.templateHeaderImage = !!(header && header.format === 'IMAGE');
  }

  varLabel(i: number): string {
    return '{{' + (i + 1) + '}}';
  }

  get templateBodyText(): string {
    const body = (this.selectedTemplate?.components || []).find((c: any) => c.type === 'BODY');
    return body?.text || '';
  }

  get templatePreview(): string {
    let text = this.templateBodyText;
    (this.form.templateVariables || []).forEach((v: any, i: number) => {
      const re = new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, 'g');
      let repl: string;
      if (v?.source === 'field') repl = v.field ? `‹${v.field}›` : `{{${i + 1}}}`;
      else repl = (v?.value || '').trim() || `{{${i + 1}}}`;
      text = text.replace(re, repl);
    });
    return text;
  }

  // Campos de la colección seleccionada (todos, para fecha y variables tipo campo)
  get currentCollectionFields(): any[] {
    const col = this.orgCollections.find(c => c.id === this.form.collectionId);
    return col?.fields || [];
  }

  // Recalcula reminderOffsetDays a partir de dirección + días
  updateReminderOffset(): void {
    if (this.reminderDir === 'same') {
      this.form.reminderOffsetDays = 0;
    } else {
      const sign = this.reminderDir === 'before' ? -1 : 1;
      this.form.reminderOffsetDays = sign * Math.abs(Number(this.reminderDays) || 0);
    }
  }

  async loadDeliveryFlows(): Promise<void> {
    try {
      this.deliveryFlows = await this.firebaseService.getDeliveryFlowsForOrg(this.orgId);
    } catch (err) { console.error(err); }
  }

  async loadDeliveryAdmins(): Promise<void> {
    try {
      const admins = await this.firebaseService.getAdmins();
      this.deliveryAdmins = admins.filter(
        (a: any) => (a.role === 'delivery' || a.role === 'delivery_multi') && a.active !== false
      );
      this.filteredDeliveryAdmins = [...this.deliveryAdmins];
    } catch (err) { console.error(err); }
  }

  filterAdmins(): void {
    const q = this.adminSearch.toLowerCase().trim();
    this.filteredDeliveryAdmins = q
      ? this.deliveryAdmins.filter(a =>
          (a.name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q))
      : [...this.deliveryAdmins];
  }

  toggleAdminAssignment(uid: string): void {
    const list: string[] = this.form.assignedDeliveryUids || [];
    const idx = list.indexOf(uid);
    if (idx === -1) list.push(uid);
    else list.splice(idx, 1);
    this.form.assignedDeliveryUids = [...list];
  }

  isAdminAssigned(uid: string): boolean {
    return (this.form.assignedDeliveryUids || []).includes(uid);
  }

  getAssignedNames(): string {
    const uids: string[] = this.form.assignedDeliveryUids || [];
    return this.deliveryAdmins
      .filter(a => uids.includes(a.uid))
      .map(a => a.name || a.email)
      .join(', ') || 'Ninguno';
  }

  get isDeliveryOrg(): boolean {
    return this.authService.orgIndustry === 'delivery';
  }

  // Fecha "hoy" en zona horaria local (El Salvador, UTC-6), igual que el backend
  private todayLocal(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(new Date());
  }

  computeTotals(): void {
    const today = this.todayLocal();
    this.totalSentToday = this.campaigns.reduce((sum, c) =>
      sum + (c.sentTodayDate === today ? (c.sentToday || 0) : 0), 0);
  }

  // Resuelve el número real de destinatarios para campañas basadas en colección
  async resolveCollectionCounts(): Promise<void> {
    const colCamps = this.campaigns.filter(c => c.recipientSource === 'collection' && c.collectionId);
    await Promise.all(colCamps.map(async c => {
      c.resolvedRecipients = await this.firebaseService.countCollectionRecipients(this.orgId, c.collectionId);
    }));
  }

  applyFilter(): void {
    if (this.filterTab === 'all') {
      this.filteredCampaigns = [...this.campaigns];
    } else if (this.filterTab === 'active') {
      this.filteredCampaigns = this.campaigns.filter(c => c.status === 'active' || c.status === 'scheduled');
    } else if (this.filterTab === 'draft') {
      this.filteredCampaigns = this.campaigns.filter(c => c.status === 'draft');
    } else if (this.filterTab === 'paused') {
      this.filteredCampaigns = this.campaigns.filter(c => c.status === 'paused');
    } else if (this.filterTab === 'completed') {
      this.filteredCampaigns = this.campaigns.filter(c => c.status === 'completed' || c.status === 'cancelled');
    }
  }

  setFilter(tab: string): void {
    this.filterTab = tab;
    this.applyFilter();
  }

  openCreate(): void {
    this.editingCampaign = null;
    this.isResend = false;
    this.form = {
      name: '',
      message: '',
      channelMode: 'freeform',
      templateName: '',
      templateLang: 'es',
      templateVariables: [],
      templateHeaderImage: false,
      type: 'immediate',
      scheduledDate: '',
      dailyHour: 9,
      dailyMinute: 0,
      intervalHours: 24,
      weeklyDays: [1],
      weeklyHour: 9,
      weeklyMinute: 0,
      monthlyDay: 1,
      monthlyHour: 9,
      monthlyMinute: 0,
      reminderDateField: '',
      reminderOffsetDays: -3,
      reminderHour: 9,
      reminderMinute: 0,
      recipientSource: 'manual',
      manualPhones: '',
      collectionId: '',
      phoneField: '',
      includeOptOut: true,
      imageUrl: '',
      actionKeywordEnabled: false,
      actionButtonLabel: 'Pedir',
      actionFlowId: '',
      stock: null,
      businessName: '',
      contactName: '',
      address: '',
      contactWhatsapp: '',
      restrictToUsers: false,
      assignedDeliveryUids: []
    };
    this.adminSearch = '';
    this.filteredDeliveryAdmins = [...this.deliveryAdmins];
    this.formImageFile = null;
    this.formImagePreview = '';
    this.formError = '';
    this.showForm = true;
    this.selectedCollectionFields = [];
    this.reminderDir = 'before';
    this.reminderDays = 3;
  }

  openEdit(campaign: any): void {
    this.editingCampaign = campaign;
    this.isResend = campaign.status === 'completed' || campaign.status === 'cancelled';
    const phones = Array.isArray(campaign.manualPhones) ? campaign.manualPhones.join('\n') : '';
    this.form = {
      name: campaign.name || '',
      message: campaign.message || '',
      channelMode: campaign.channelMode || 'freeform',
      templateName: campaign.templateName || '',
      templateLang: campaign.templateLang || 'es',
      templateVariables: Array.isArray(campaign.templateVariables)
        ? campaign.templateVariables.map((v: any) => ({ source: v?.source || 'static', value: v?.value || '', field: v?.field || '' })) : [],
      templateHeaderImage: campaign.templateHeaderImage || false,
      reminderDateField: campaign.reminderDateField || '',
      reminderOffsetDays: campaign.reminderOffsetDays ?? -3,
      reminderHour: campaign.reminderHour ?? 9,
      reminderMinute: campaign.reminderMinute ?? 0,
      type: campaign.type || 'immediate',
      scheduledDate: campaign.scheduledDate || '',
      dailyHour: campaign.dailyHour ?? 9,
      dailyMinute: campaign.dailyMinute ?? 0,
      intervalHours: campaign.intervalHours ?? 24,
      weeklyDays: Array.isArray(campaign.weeklyDays) ? [...campaign.weeklyDays] : [1],
      weeklyHour: campaign.weeklyHour ?? 9,
      weeklyMinute: campaign.weeklyMinute ?? 0,
      monthlyDay: campaign.monthlyDay ?? 1,
      monthlyHour: campaign.monthlyHour ?? 9,
      monthlyMinute: campaign.monthlyMinute ?? 0,
      recipientSource: campaign.recipientSource || 'manual',
      manualPhones: phones,
      collectionId: campaign.collectionId || '',
      phoneField: campaign.phoneField || '',
      includeOptOut: campaign.includeOptOut !== false,
      imageUrl: campaign.imageUrl || '',
      actionKeywordEnabled: campaign.actionKeywordEnabled || false,
      actionButtonLabel: campaign.actionButtonLabel || 'Pedir',
      actionFlowId: campaign.actionFlowId || '',
      stock: campaign.stock ?? null,
      businessName: campaign.businessName || '',
      contactName: campaign.contactName || '',
      address: campaign.address || '',
      contactWhatsapp: campaign.contactWhatsapp || '',
      restrictToUsers: Array.isArray(campaign.assignedDeliveryUids) && campaign.assignedDeliveryUids.length > 0,
      assignedDeliveryUids: campaign.assignedDeliveryUids || []
    };
    this.adminSearch = '';
    this.filteredDeliveryAdmins = [...this.deliveryAdmins];
    this.formImageFile = null;
    this.formImagePreview = campaign.imageUrl || '';
    this.formError = '';
    this.showForm = true;
    // Derivar dirección/días del offset del recordatorio
    const off = campaign.reminderOffsetDays ?? 0;
    this.reminderDir = off < 0 ? 'before' : off > 0 ? 'after' : 'same';
    this.reminderDays = Math.abs(off) || 3;
    this.onCollectionChange();
    if (this.form.channelMode === 'template') this.onTemplateChange();
  }

  closeForm(): void {
    this.showForm = false;
    this.editingCampaign = null;
    this.isResend = false;
    this.formImageFile = null;
    this.formImagePreview = '';
    this.formError = '';
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) { this.formError = 'La imagen no debe superar 5 MB'; return; }
    this.formImageFile = file;
    const reader = new FileReader();
    reader.onload = (e) => { this.formImagePreview = e.target!.result as string; };
    reader.readAsDataURL(file);
  }

  clearImage(): void {
    this.formImageFile = null;
    this.formImagePreview = '';
    this.form.imageUrl = '';
  }

  onCollectionChange(): void {
    const col = this.orgCollections.find(c => c.id === this.form.collectionId);
    this.selectedCollectionFields = (col?.fields || []).filter((f: any) => f.type === 'text' || !f.type || f.type === 'phone');
    if (this.selectedCollectionFields.length > 0 && !this.form.phoneField) {
      const phoneGuess = this.selectedCollectionFields.find((f: any) =>
        (f.key || '').toLowerCase().includes('phone') ||
        (f.key || '').toLowerCase().includes('tel') ||
        (f.label || '').toLowerCase().includes('tel') ||
        (f.label || '').toLowerCase().includes('cel')
      );
      this.form.phoneField = phoneGuess?.key || this.selectedCollectionFields[0]?.key || '';
    }
  }

  toggleWeekDay(day: number): void {
    const list: number[] = this.form.weeklyDays || [];
    const idx = list.indexOf(day);
    if (idx === -1) list.push(day);
    else list.splice(idx, 1);
    this.form.weeklyDays = [...list];
  }

  isWeekDaySelected(day: number): boolean {
    return (this.form.weeklyDays || []).includes(day);
  }

  validateForm(): string {
    if (!this.form.name.trim()) return 'El nombre de la campaña es requerido';
    if (this.form.type === 'reminder') {
      if (this.form.recipientSource !== 'collection' || !this.form.collectionId) return 'Selecciona una colección para el recordatorio';
      if (!this.form.reminderDateField) return 'Selecciona el campo de fecha del recordatorio';
    }
    if (this.form.channelMode === 'template') {
      if (!this.form.templateName) return 'Selecciona una plantilla aprobada';
      const missing = (this.form.templateVariables || []).some((v: any) =>
        v?.source === 'field' ? !v.field : !String(v?.value || '').trim());
      if (missing) return 'Completa todas las variables de la plantilla';
      if (this.form.templateHeaderImage && !this.form.imageUrl && !this.formImageFile) return 'Esta plantilla requiere una imagen de encabezado';
    } else {
      if (!this.form.message.trim()) return 'El mensaje es requerido';
      if (this.form.message.length > 4096) return 'El mensaje no puede superar 4096 caracteres';
    }
    if (this.form.type === 'once' && !this.form.scheduledDate) return 'Selecciona la fecha y hora de envío';
    if (this.form.type === 'interval' && (!this.form.intervalHours || this.form.intervalHours < 1)) return 'Ingresa un intervalo válido (mínimo 1 hora)';
    if (this.form.type === 'weekly' && (!this.form.weeklyDays || this.form.weeklyDays.length === 0)) return 'Selecciona al menos un día de la semana';
    if (this.form.type === 'monthly' && (!this.form.monthlyDay || this.form.monthlyDay < 1 || this.form.monthlyDay > 31)) return 'Selecciona un día del mes válido (1-31)';
    if (this.form.recipientSource === 'manual') {
      const phones = this.parsePhones();
      if (phones.length === 0) return 'Ingresa al menos un número de teléfono';
    } else {
      if (!this.form.collectionId) return 'Selecciona una colección';
      if (!this.form.phoneField) return 'Selecciona el campo de teléfono';
    }
    return '';
  }

  parsePhones(): string[] {
    return (this.form.manualPhones || '').split('\n')
      .map((p: string) => p.trim().replace(/\s+/g, ''))
      .filter((p: string) => p.length >= 8);
  }

  buildCampaignData(status: string): any {
    const isTemplate = this.form.channelMode === 'template';
    const data: any = {
      name: this.form.name.trim(),
      message: isTemplate ? this.templatePreview : this.form.message.trim(),
      channelMode: this.form.channelMode || 'freeform',
      templateName: isTemplate ? this.form.templateName : '',
      templateLang: isTemplate ? (this.form.templateLang || 'es') : '',
      templateVariables: isTemplate
        ? (this.form.templateVariables || []).map((v: any) => ({
            source: v?.source || 'static',
            value: String(v?.value || ''),
            field: v?.field || ''
          }))
        : [],
      templateHeaderImage: isTemplate ? !!this.form.templateHeaderImage : false,
      type: this.form.type,
      recipientSource: this.form.recipientSource,
      includeOptOut: this.form.includeOptOut,
      imageUrl: this.form.imageUrl || '',
      status,
      actionKeywordEnabled: this.isDeliveryOrg ? (this.form.actionKeywordEnabled || false) : false,
      actionButtonLabel: this.isDeliveryOrg && this.form.actionKeywordEnabled ? (this.form.actionButtonLabel || 'Pedir').trim() : '',
      actionFlowId: this.isDeliveryOrg && this.form.actionKeywordEnabled ? (this.form.actionFlowId || '') : '',
      stock: (this.isDeliveryOrg && this.form.actionKeywordEnabled && this.form.stock !== null && this.form.stock !== '')
        ? Number(this.form.stock) : null,
      businessName: this.isDeliveryOrg ? (this.form.businessName || '').trim() : '',
      contactName: this.isDeliveryOrg ? (this.form.contactName || '').trim() : '',
      address: this.isDeliveryOrg ? (this.form.address || '').trim() : '',
      contactWhatsapp: this.isDeliveryOrg ? (this.form.contactWhatsapp || '').trim().replace(/[^0-9]/g, '') : '',
      assignedDeliveryUids: (this.isDeliveryOrg && this.form.restrictToUsers)
        ? (this.form.assignedDeliveryUids || [])
        : []
    };
    if (this.form.type === 'once') data.scheduledDate = this.form.scheduledDate;
    if (this.form.type === 'daily') {
      data.dailyHour = Number(this.form.dailyHour);
      data.dailyMinute = Number(this.form.dailyMinute);
    }
    if (this.form.type === 'interval') data.intervalHours = Number(this.form.intervalHours);
    if (this.form.type === 'weekly') {
      data.weeklyDays = (this.form.weeklyDays || []).map((d: number) => Number(d)).sort((a: number, b: number) => a - b);
      data.weeklyHour = Number(this.form.weeklyHour);
      data.weeklyMinute = Number(this.form.weeklyMinute);
    }
    if (this.form.type === 'monthly') {
      data.monthlyDay = Number(this.form.monthlyDay);
      data.monthlyHour = Number(this.form.monthlyHour);
      data.monthlyMinute = Number(this.form.monthlyMinute);
    }
    if (this.form.type === 'reminder') {
      data.reminderDateField = this.form.reminderDateField;
      data.reminderOffsetDays = Number(this.form.reminderOffsetDays || 0);
      data.reminderHour = Number(this.form.reminderHour);
      data.reminderMinute = Number(this.form.reminderMinute);
    }
    if (this.form.recipientSource === 'manual') {
      data.manualPhones = this.parsePhones();
    } else {
      data.collectionId = this.form.collectionId;
      data.phoneField = this.form.phoneField;
    }
    if (status === 'active' || status === 'scheduled') {
      data.nextRunAt = this.computeNextRunAt();
    }
    return data;
  }

  computeNextRunAt(): string {
    const now = new Date();
    if (this.form.type === 'immediate') return now.toISOString();
    if (this.form.type === 'once') return new Date(this.form.scheduledDate).toISOString();
    if (this.form.type === 'daily') {
      const d = new Date();
      d.setHours(Number(this.form.dailyHour), Number(this.form.dailyMinute), 0, 0);
      if (d <= now) d.setDate(d.getDate() + 1);
      return d.toISOString();
    }
    if (this.form.type === 'interval') {
      const d = new Date(now.getTime() + Number(this.form.intervalHours) * 3600000);
      return d.toISOString();
    }
    if (this.form.type === 'weekly') {
      return this.computeWeeklyNext(
        this.form.weeklyDays || [], Number(this.form.weeklyHour), Number(this.form.weeklyMinute)
      ).toISOString();
    }
    if (this.form.type === 'monthly') {
      return this.computeMonthlyNext(
        Number(this.form.monthlyDay), Number(this.form.monthlyHour), Number(this.form.monthlyMinute)
      ).toISOString();
    }
    return now.toISOString();
  }

  // Próxima ejecución semanal: el día(s) de la semana seleccionado(s) más cercano
  private computeWeeklyNext(days: number[], hour: number, minute: number, from?: Date): Date {
    const base = from || new Date();
    const set = (days || []).map(d => Number(d));
    for (let offset = 0; offset <= 7; offset++) {
      const d = new Date(base);
      d.setDate(d.getDate() + offset);
      d.setHours(hour, minute, 0, 0);
      if (set.includes(d.getDay()) && d > base) return d;
    }
    const f = new Date(base);
    f.setDate(f.getDate() + 7);
    f.setHours(hour, minute, 0, 0);
    return f;
  }

  // Próxima ejecución mensual: día fijo del mes, o el último día si el mes es más corto
  private computeMonthlyNext(day: number, hour: number, minute: number, from?: Date): Date {
    const base = from || new Date();
    const makeDate = (y: number, m: number) => {
      const lastDay = new Date(y, m + 1, 0).getDate();
      return new Date(y, m, Math.min(day, lastDay), hour, minute, 0, 0);
    };
    let y = base.getFullYear();
    let m = base.getMonth();
    let next = makeDate(y, m);
    if (next <= base) {
      m += 1;
      if (m > 11) { m = 0; y += 1; }
      next = makeDate(y, m);
    }
    return next;
  }

  async saveDraft(): Promise<void> {
    this.formError = this.validateForm();
    if (this.formError) return;
    await this.doSave('draft');
  }

  async activateCampaign(): Promise<void> {
    this.formError = this.validateForm();
    if (this.formError) return;
    // Envío inmediato requiere el bot configurado; si no, quedaría "activa" sin enviarse nunca
    if (this.form.type === 'immediate' && !this.authService.botApiUrl) {
      this.formError = 'El bot no está configurado (falta la URL del bot). Guarda como borrador o configura el bot antes de enviar.';
      return;
    }
    const status = this.form.type === 'once' ? 'scheduled' : (this.form.type === 'immediate' ? 'active' : 'active');
    await this.doSave(status);
  }

  private async doSave(status: string): Promise<void> {
    this.saving = true;
    this.formError = '';
    try {
      // Upload image if new file selected
      if (this.formImageFile) {
        this.uploadingImage = true;
        const ext = this.formImageFile.name.split('.').pop() || 'jpg';
        const path = `organizations/${this.orgId}/campaigns/img-${Date.now()}.${ext}`;
        this.form.imageUrl = await this.firebaseService.uploadFileByPath(this.formImageFile, path);
        this.uploadingImage = false;
      }
      const data = this.buildCampaignData(status);
      let campaignId: string;
      if (this.editingCampaign) {
        campaignId = this.editingCampaign.id;
        await this.firebaseService.updateCampaign(this.orgId, campaignId, data);
        const idx = this.campaigns.findIndex(c => c.id === campaignId);
        if (idx >= 0) this.campaigns[idx] = { ...this.campaigns[idx], ...data };
      } else {
        campaignId = await this.firebaseService.createCampaign(this.orgId, data);
        this.campaigns.unshift({ id: campaignId, ...data, sentTotal: 0, failedTotal: 0, sentToday: 0, optedOutPhones: [] });
      }

      // Envío inmediato: llamar al bot para disparar el envío ahora
      if (status === 'active' && this.form.type === 'immediate') {
        const botApiUrl = this.authService.botApiUrl;
        if (botApiUrl) {
          try {
            await this.firebaseService.triggerCampaign(botApiUrl, this.orgId, campaignId);
          } catch (sendErr: any) {
            // No bloquear el flujo si el trigger falla — el bot puede reintentar
            console.warn('No se pudo disparar el envío inmediato:', sendErr?.message);
          }
          // Recargar para reflejar status completado y contadores
          await this.loadCampaigns();
        }
      }

      this.applyFilter();
      this.closeForm();
    } catch (err: any) {
      this.formError = err?.message || 'Error al guardar';
    } finally {
      this.saving = false;
      this.uploadingImage = false;
    }
  }

  async togglePause(campaign: any): Promise<void> {
    if (this.togglingId === campaign.id) return;
    this.togglingId = campaign.id;
    const newStatus = campaign.status === 'paused' ? 'active' : 'paused';
    const data: any = { status: newStatus };
    if (newStatus === 'active') data.nextRunAt = this.computeNextRunAtForCampaign(campaign);
    try {
      await this.firebaseService.updateCampaign(this.orgId, campaign.id, data);
      campaign.status = newStatus;
      if (newStatus === 'active') campaign.nextRunAt = data.nextRunAt;
      // Sync keyword trigger active state
      this.applyFilter();
    } catch (err) { console.error(err); }
    finally { this.togglingId = null; }
  }

  computeNextRunAtForCampaign(c: any): string {
    const now = new Date();
    if (c.type === 'immediate') return now.toISOString();
    if (c.type === 'daily') {
      const d = new Date();
      d.setHours(c.dailyHour ?? 9, c.dailyMinute ?? 0, 0, 0);
      if (d <= now) d.setDate(d.getDate() + 1);
      return d.toISOString();
    }
    if (c.type === 'interval') return new Date(now.getTime() + (c.intervalHours || 24) * 3600000).toISOString();
    if (c.type === 'weekly') {
      return this.computeWeeklyNext(c.weeklyDays || [], c.weeklyHour ?? 9, c.weeklyMinute ?? 0).toISOString();
    }
    if (c.type === 'monthly') {
      return this.computeMonthlyNext(c.monthlyDay || 1, c.monthlyHour ?? 9, c.monthlyMinute ?? 0).toISOString();
    }
    return now.toISOString();
  }

  openDelete(campaign: any): void {
    this.deletingCampaign = campaign;
    this.deleting = false;
  }

  cancelDelete(): void {
    this.deletingCampaign = null;
  }

  async confirmDelete(): Promise<void> {
    if (!this.deletingCampaign) return;
    this.deleting = true;
    try {
      await this.firebaseService.deleteCampaign(this.orgId, this.deletingCampaign.id);
      this.campaigns = this.campaigns.filter(c => c.id !== this.deletingCampaign.id);
      this.applyFilter();
      this.deletingCampaign = null;
    } catch (err) { console.error(err); }
    finally { this.deleting = false; }
  }

  toggleExpand(id: string): void {
    this.expandedId = this.expandedId === id ? null : id;
  }

  // ── Display helpers ──
  typeLabel(type: string): string {
    const m: any = { immediate: 'Inmediata', once: 'Programada', daily: 'Diaria', weekly: 'Semanal', interval: 'Recurrente', monthly: 'Mensual', reminder: 'Recordatorio' };
    return m[type] || type;
  }

  typeIcon(type: string): string {
    const m: any = { immediate: 'fa-bolt', once: 'fa-calendar-alt', daily: 'fa-sun', weekly: 'fa-calendar-week', interval: 'fa-redo', monthly: 'fa-calendar-check', reminder: 'fa-bell' };
    return m[type] || 'fa-paper-plane';
  }

  // Nombre corto del día de la semana (0=Domingo)
  weekdayShort(d: number): string {
    return ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d] || '';
  }

  statusLabel(status: string): string {
    const m: any = { draft: 'Borrador', scheduled: 'Programada', active: 'Activa', paused: 'Pausada', completed: 'Completada', cancelled: 'Cancelada' };
    return m[status] || status;
  }

  scheduleText(c: any): string {
    if (c.type === 'immediate') return 'Envío único inmediato';
    if (c.type === 'once') {
      if (!c.scheduledDate) return '—';
      return 'Una vez: ' + new Date(c.scheduledDate).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
    }
    if (c.type === 'daily') {
      const h = String(c.dailyHour ?? 9).padStart(2, '0');
      const m = String(c.dailyMinute ?? 0).padStart(2, '0');
      return `Todos los días a las ${h}:${m}`;
    }
    if (c.type === 'interval') return `Cada ${c.intervalHours} hora${c.intervalHours === 1 ? '' : 's'}`;
    if (c.type === 'weekly') {
      const h = String(c.weeklyHour ?? 9).padStart(2, '0');
      const mm = String(c.weeklyMinute ?? 0).padStart(2, '0');
      const ordered = [1, 2, 3, 4, 5, 6, 0].filter(d => (c.weeklyDays || []).includes(d));
      const names = ordered.map(d => this.weekdayShort(d)).join(', ');
      return `Cada ${names || '—'} a las ${h}:${mm}`;
    }
    if (c.type === 'monthly') {
      const h = String(c.monthlyHour ?? 9).padStart(2, '0');
      const mm = String(c.monthlyMinute ?? 0).padStart(2, '0');
      return `El día ${c.monthlyDay ?? 1} de cada mes a las ${h}:${mm}`;
    }
    if (c.type === 'reminder') {
      const h = String(c.reminderHour ?? 9).padStart(2, '0');
      const mm = String(c.reminderMinute ?? 0).padStart(2, '0');
      const off = c.reminderOffsetDays || 0;
      const when = off === 0 ? 'El día de' : (off < 0 ? `${Math.abs(off)} día(s) antes de` : `${off} día(s) después de`);
      return `${when} «${c.reminderDateField || '—'}» a las ${h}:${mm}`;
    }
    return '—';
  }

  nextRunText(c: any): string {
    if (!c.nextRunAt) return '';
    try {
      const d = typeof c.nextRunAt === 'string' ? new Date(c.nextRunAt) : c.nextRunAt.toDate?.() || new Date(c.nextRunAt);
      return d.toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
    } catch { return ''; }
  }

  recipientCount(c: any): number {
    if (c.recipientSource === 'manual') return (c.manualPhones || []).length;
    return c.resolvedRecipients ?? 0; // resuelto vía countCollectionRecipients
  }

  get limitPercent(): number {
    if (!this.dailyBulkLimit) return 0;
    return Math.min(100, Math.round((this.totalSentToday / this.dailyBulkLimit) * 100));
  }

  get limitWarning(): boolean { return this.limitPercent >= 80; }
  get limitExceeded(): boolean { return this.dailyBulkLimit > 0 && this.totalSentToday >= this.dailyBulkLimit; }

  get filterCounts(): any {
    return {
      all: this.campaigns.length,
      active: this.campaigns.filter(c => c.status === 'active' || c.status === 'scheduled').length,
      draft: this.campaigns.filter(c => c.status === 'draft').length,
      paused: this.campaigns.filter(c => c.status === 'paused').length,
      completed: this.campaigns.filter(c => c.status === 'completed' || c.status === 'cancelled').length
    };
  }

  // Previsualización legible de cuándo se enviará la campaña (en el formulario)
  get formNextRunPreview(): string {
    try {
      if (this.form.type === 'reminder') return '—';
      if (this.form.type === 'once' && !this.form.scheduledDate) return '—';
      if (this.form.type === 'weekly' && (!this.form.weeklyDays || this.form.weeklyDays.length === 0)) return '—';
      const iso = this.computeNextRunAt();
      return new Date(iso).toLocaleString('es', {
        weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
    } catch { return '—'; }
  }

  get formHour(): string { return String(this.form.dailyHour ?? 9).padStart(2, '0'); }
  set formHour(v: string) { this.form.dailyHour = parseInt(v, 10) || 0; }
  get formMinute(): string { return String(this.form.dailyMinute ?? 0).padStart(2, '0'); }
  set formMinute(v: string) { this.form.dailyMinute = parseInt(v, 10) || 0; }
}
