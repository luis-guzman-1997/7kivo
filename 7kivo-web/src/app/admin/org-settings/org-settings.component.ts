import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-org-settings',
  templateUrl: './org-settings.component.html',
  styleUrls: ['./org-settings.component.css']
})
export class OrgSettingsComponent implements OnInit {
  generalConfig: any = {};
  loading = true;
  saving = false;
  notice = '';
  error = '';
  orgId = '';
  logoPreview = '';
  logoFile: File | null = null;
  uploadingLogo = false;

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService
  ) {
    this.orgId = this.firebaseService.getOrgId();
  }

  async ngOnInit(): Promise<void> {
    await this.loadConfig();
  }

  async loadConfig(): Promise<void> {
    this.loading = true;
    try {
      this.generalConfig = await this.firebaseService.getOrgConfig() || {};
      this.logoPreview = this.generalConfig.orgLogo || '';
    } catch (err) {
      console.error('Error loading config:', err);
    } finally {
      this.loading = false;
    }
  }

  async saveGeneral(): Promise<void> {
    this.saving = true;
    this.notice = '';
    this.error = '';
    try {
      if (this.logoFile) {
        const url = await this.uploadLogo();
        if (url) {
          this.generalConfig.orgLogo = url;
          this.logoPreview = url;
        }
      }
      await this.firebaseService.saveOrgConfig(this.generalConfig);
      this.authService.updateOrgLogo(this.generalConfig.orgLogo || '');
      this.notice = 'Configuración guardada';
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al guardar configuración';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    if (file.size > 2 * 1024 * 1024) {
      this.error = 'El logo no debe superar 2 MB';
      setTimeout(() => this.error = '', 3000);
      return;
    }
    this.logoFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      this.logoPreview = e.target!.result as string;
    };
    reader.readAsDataURL(file);
  }

  async uploadLogo(): Promise<string | null> {
    if (!this.logoFile) return null;
    this.uploadingLogo = true;
    try {
      const url = await this.firebaseService.uploadOrgLogo(this.logoFile);
      this.logoFile = null;
      return url;
    } catch (err) {
      console.error('Error uploading logo:', err);
      this.error = 'Error al subir logo';
      setTimeout(() => this.error = '', 3000);
      return null;
    } finally {
      this.uploadingLogo = false;
    }
  }

  async removeLogo(): Promise<void> {
    const orgId = this.firebaseService.getOrgId();
    if (this.generalConfig.orgLogo) {
      await this.firebaseService.deleteFile(`organizations/${orgId}/logo.png`).catch(() => {});
      await this.firebaseService.deleteFile(`organizations/${orgId}/logo.jpg`).catch(() => {});
      await this.firebaseService.deleteFile(`organizations/${orgId}/logo.webp`).catch(() => {});
    }
    this.logoPreview = '';
    this.logoFile = null;
    this.generalConfig.orgLogo = '';
  }
}
