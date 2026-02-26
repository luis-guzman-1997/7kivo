import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css']
})
export class WelcomeComponent implements OnInit {
  step = 1;
  saving = false;
  orgName = '';
  description = '';
  personalWhatsApp = '';
  industry = '';
  planName = '';
  planFeatures: string[] = [];

  planMap: Record<string, string[]> = {
    'Starter': ['Bot WhatsApp con menú interactivo', '1 flujo conversacional', '1 base de datos', 'Bandeja de entrada', 'Chat WhatsApp (solo lectura)'],
    'Business': ['Hasta 3 flujos conversacionales', '3 bases de datos', 'Sistema de citas y agenda', 'Chat en vivo con clientes', '3 usuarios administradores'],
    'Premium': ['Hasta 5 flujos conversacionales', '10 bases de datos', 'Roles y permisos avanzados', '5 usuarios administradores'],
    'Enterprise': ['Hasta 20 flujos', 'Bases de datos ilimitadas', 'Usuarios ilimitados', 'Configuración avanzada']
  };

  constructor(
    private authService: AuthService,
    private firebaseService: FirebaseService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    if (this.authService.setupComplete) {
      this.router.navigate(['/admin']);
      return;
    }

    this.planName = this.authService.orgPlan || 'Starter';
    this.planFeatures = this.planMap[this.planName] || this.planMap['Starter'];

    try {
      const config = await this.firebaseService.getOrgConfig();
      this.orgName = config?.orgName || this.authService.orgName || '';
      this.description = config?.description || '';
      this.personalWhatsApp = config?.personalWhatsApp || '';
      this.industry = config?.industry || '';
    } catch (_) {}
  }

  nextStep(): void {
    if (this.step === 1 && !this.orgName.trim()) return;
    if (this.step < 3) this.step++;
  }

  prevStep(): void {
    if (this.step > 1) this.step--;
  }

  async saveAndContinue(): Promise<void> {
    this.saving = true;
    try {
      await this.firebaseService.saveOrgConfig({
        orgName: this.orgName.trim(),
        description: this.description.trim(),
        personalWhatsApp: this.personalWhatsApp.trim(),
        industry: this.industry
      });
      this.step = 2;
    } catch (err) {
      console.error('Error saving config:', err);
    } finally {
      this.saving = false;
    }
  }

  async finishSetup(): Promise<void> {
    this.saving = true;
    try {
      const orgId = this.firebaseService.getOrgId();
      await this.firebaseService.updateOrganization(orgId, { setupComplete: true });
      this.authService.markSetupComplete();
      this.router.navigate(['/admin']);
    } catch (err) {
      console.error('Error finishing setup:', err);
    } finally {
      this.saving = false;
    }
  }
}
