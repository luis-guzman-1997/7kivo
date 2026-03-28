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

  togglingBlock: { [orgId: string]: boolean } = {};
  botToggleError: string | null = null;

  exportingOrgId: string | null = null;
  exportingAll = false;

  deleteConfirmOrg: any = null;
  deleteConfirmText = '';
  deleting = false;
  deleteResult: { deletedUsers: string[] } | null = null;

  importModalOpen = false;
  importParsed: any[] = [];
  importError = '';
  importOverwrite = false;
  importSaving = false;
  importDone = false;
  importResults: { id: string; name: string; existed: boolean; success: boolean; error?: string }[] = [];

  slugEditOrg: any = null;
  slugEditValue = '';
  slugSaving = false;
  slugError = '';

  constructor(
    private firebaseService: FirebaseService,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadOrganizations();
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

  openOrg(org: any): void {
    this.router.navigate([`/superadmin/organizaciones/${org.id}`]);
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
    } catch (err) {
      console.error('Error toggling bot blocked:', err);
    } finally {
      this.togglingBlock[org.id] = false;
    }
  }

  getCreatedDate(org: any): string {
    if (!org.createdAt?.seconds) return '—';
    return new Date(org.createdAt.seconds * 1000).toLocaleDateString('es');
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

  // ── Delete (inline from table) ──
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

  // ── Login Slug ──
  openSlugEdit(org: any): void {
    this.slugEditOrg = org;
    this.slugEditValue = org.loginSlug || '';
    this.slugError = '';
    this.slugSaving = false;
  }

  closeSlugEdit(): void {
    this.slugEditOrg = null;
    this.slugError = '';
  }

  async saveLoginSlug(): Promise<void> {
    if (!this.slugEditOrg || this.slugSaving) return;
    const slug = this.slugEditValue.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    this.slugSaving = true;
    this.slugError = '';
    try {
      if (slug) {
        const existing = await this.firebaseService.getOrgByLoginSlug(slug);
        if (existing && existing.id !== this.slugEditOrg.id) {
          this.slugError = 'Este slug ya está en uso por otra organización';
          return;
        }
      }
      const previousSlug = this.slugEditOrg.loginSlug || null;
      await this.firebaseService.updateOrganization(this.slugEditOrg.id, { loginSlug: slug || null });
      await this.firebaseService.syncPublicOrgLoginSlug({
        orgId: this.slugEditOrg.id,
        slug: slug || null,
        previousSlug,
        orgName: this.slugEditOrg.orgName || this.slugEditOrg.name || this.slugEditOrg.id,
        orgLogo: this.slugEditOrg.orgLogo || null
      });
      this.slugEditOrg.loginSlug = slug || null;
      this.closeSlugEdit();
    } catch (err) {
      this.slugError = 'Error al guardar';
    } finally {
      this.slugSaving = false;
    }
  }

  getLoginUrl(org: any): string {
    return org.loginSlug ? `/admin/login/${org.loginSlug}` : '';
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
}
