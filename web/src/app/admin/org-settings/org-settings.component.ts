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
  whatsappConfig: any = {};
  loading = true;
  saving = false;
  notice = '';
  error = '';
  activeTab = 'general';
  orgId = '';
  copied = false;

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
      const [general, whatsapp] = await Promise.all([
        this.firebaseService.getOrgConfig(),
        this.firebaseService.getWhatsAppConfig()
      ]);
      this.generalConfig = general || {};
      this.whatsappConfig = whatsapp || {};
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
      await this.firebaseService.saveOrgConfig(this.generalConfig);
      this.notice = 'Configuración general guardada';
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al guardar configuración';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  copyOrgId(): void {
    navigator.clipboard.writeText(this.orgId).then(() => {
      this.copied = true;
      setTimeout(() => this.copied = false, 2000);
    });
  }

  async saveWhatsApp(): Promise<void> {
    this.saving = true;
    this.notice = '';
    this.error = '';
    try {
      await this.firebaseService.saveWhatsAppConfig(this.whatsappConfig);
      this.notice = 'Configuración de WhatsApp guardada';
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al guardar configuración de WhatsApp';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }
}
