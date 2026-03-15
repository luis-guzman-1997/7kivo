import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';  // used for hasPermission in template

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

  expandedId: string | null = null;

  constructor(
    private firebaseService: FirebaseService,
    private authService: AuthService
  ) {}

  async ngOnInit(): Promise<void> {
    this.orgId = this.firebaseService.getOrgId() || '';
    await Promise.all([this.loadCampaigns(), this.loadOrgInfo(), this.loadCollections()]);
  }

  async loadCampaigns(): Promise<void> {
    this.loading = true;
    try {
      this.campaigns = await this.firebaseService.getCampaigns(this.orgId);
      this.computeTotals();
      this.applyFilter();
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

  computeTotals(): void {
    const today = new Date().toISOString().slice(0, 10);
    this.totalSentToday = this.campaigns.reduce((sum, c) =>
      sum + (c.sentTodayDate === today ? (c.sentToday || 0) : 0), 0);
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
    this.form = {
      name: '',
      message: '',
      type: 'immediate',
      scheduledDate: '',
      dailyHour: 9,
      dailyMinute: 0,
      intervalHours: 24,
      recipientSource: 'manual',
      manualPhones: '',
      collectionId: '',
      phoneField: '',
      includeOptOut: true,
      imageUrl: ''
    };
    this.formImageFile = null;
    this.formImagePreview = '';
    this.formError = '';
    this.showForm = true;
    this.selectedCollectionFields = [];
  }

  openEdit(campaign: any): void {
    this.editingCampaign = campaign;
    const phones = Array.isArray(campaign.manualPhones) ? campaign.manualPhones.join('\n') : '';
    this.form = {
      name: campaign.name || '',
      message: campaign.message || '',
      type: campaign.type || 'immediate',
      scheduledDate: campaign.scheduledDate || '',
      dailyHour: campaign.dailyHour ?? 9,
      dailyMinute: campaign.dailyMinute ?? 0,
      intervalHours: campaign.intervalHours ?? 24,
      recipientSource: campaign.recipientSource || 'manual',
      manualPhones: phones,
      collectionId: campaign.collectionId || '',
      phoneField: campaign.phoneField || '',
      includeOptOut: campaign.includeOptOut !== false,
      imageUrl: campaign.imageUrl || ''
    };
    this.formImageFile = null;
    this.formImagePreview = campaign.imageUrl || '';
    this.formError = '';
    this.showForm = true;
    this.onCollectionChange();
  }

  closeForm(): void {
    this.showForm = false;
    this.editingCampaign = null;
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

  validateForm(): string {
    if (!this.form.name.trim()) return 'El nombre de la campaña es requerido';
    if (!this.form.message.trim()) return 'El mensaje es requerido';
    if (this.form.message.length > 4096) return 'El mensaje no puede superar 4096 caracteres';
    if (this.form.type === 'once' && !this.form.scheduledDate) return 'Selecciona la fecha y hora de envío';
    if (this.form.type === 'interval' && (!this.form.intervalHours || this.form.intervalHours < 1)) return 'Ingresa un intervalo válido (mínimo 1 hora)';
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
    const data: any = {
      name: this.form.name.trim(),
      message: this.form.message.trim(),
      type: this.form.type,
      recipientSource: this.form.recipientSource,
      includeOptOut: this.form.includeOptOut,
      imageUrl: this.form.imageUrl || '',
      status
    };
    if (this.form.type === 'once') data.scheduledDate = this.form.scheduledDate;
    if (this.form.type === 'daily') {
      data.dailyHour = Number(this.form.dailyHour);
      data.dailyMinute = Number(this.form.dailyMinute);
    }
    if (this.form.type === 'interval') data.intervalHours = Number(this.form.intervalHours);
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
    return now.toISOString();
  }

  async saveDraft(): Promise<void> {
    this.formError = this.validateForm();
    if (this.formError) return;
    await this.doSave('draft');
  }

  async activateCampaign(): Promise<void> {
    this.formError = this.validateForm();
    if (this.formError) return;
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
    const m: any = { immediate: 'Inmediata', once: 'Programada', daily: 'Diaria', interval: 'Recurrente' };
    return m[type] || type;
  }

  typeIcon(type: string): string {
    const m: any = { immediate: 'fa-bolt', once: 'fa-calendar-alt', daily: 'fa-sun', interval: 'fa-redo' };
    return m[type] || 'fa-paper-plane';
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
    return 0; // unknown until bot processes
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

  get formHour(): string { return String(this.form.dailyHour ?? 9).padStart(2, '0'); }
  set formHour(v: string) { this.form.dailyHour = parseInt(v, 10) || 0; }
  get formMinute(): string { return String(this.form.dailyMinute ?? 0).padStart(2, '0'); }
  set formMinute(v: string) { this.form.dailyMinute = parseInt(v, 10) || 0; }
}
