import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

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

  logoFile: File | null = null;
  logoPreview = '';

  saving = false;
  notice = '';

  deleteConfirmOrg: any = null;
  deleteConfirmText = '';
  deleting = false;
  deleteResult: { deletedUsers: string[] } | null = null;

  constructor(private firebaseService: FirebaseService) {}

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
    try {
      await this.firebaseService.updateOrganization(org.id, { botEnabled: newVal });
      org.botEnabled = newVal;
    } catch (err) {
      console.error('Error toggling bot:', err);
    }
  }

  async openDetail(org: any): Promise<void> {
    this.selectedOrg = org;
    this.loadingDetail = true;
    this.detailTab = 'info';
    this.editingPlan = false;
    this.editingGeneral = false;
    this.editingWA = false;
    this.notice = '';
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
      industry: this.orgDetail?.industry || 'general',
      botApiUrl: this.orgDetail?.botApiUrl || ''
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
      verifyToken: this.orgWhatsApp?.verifyToken || ''
    };
    this.editingWA = true;
  }

  cancelEditWA(): void { this.editingWA = false; }

  async saveWA(): Promise<void> {
    if (!this.selectedOrg) return;
    this.saving = true;
    try {
      await this.firebaseService.saveWhatsAppConfigByOrgId(this.selectedOrg.id, this.editWA);
      this.orgWhatsApp = { ...this.orgWhatsApp, ...this.editWA };
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

  private showNotice(msg: string): void {
    this.notice = msg;
    setTimeout(() => this.notice = '', 3000);
  }
}
