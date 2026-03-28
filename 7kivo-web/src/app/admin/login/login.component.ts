import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  email = '';
  password = '';
  showLoginPassword = false;
  error = '';
  success = '';
  loading = false;
  showRegister = false;

  regOrgName = '';
  regIndustry = 'general';
  regDescription = '';
  regAdminName = '';
  regEmail = '';
  regPassword = '';
  regPlan = '';
  regStep = 1; // 1 = org info, 2 = plan selection, 3 = user info

  availablePlans = [
    { name: 'Starter', price: 9.99, features: ['Bot WhatsApp con menú interactivo', '1 flujo conversacional', '1 base de datos', 'Bandeja de entrada', 'Chat WhatsApp (solo lectura)'] },
    { name: 'Business', price: 19.99, popular: true, features: ['Hasta 3 flujos conversacionales', 'Hasta 3 bases de datos', 'Sistema de citas y agenda', 'Chat en vivo con clientes', '3 usuarios administradores'] },
    { name: 'Premium', price: 39.99, features: ['Hasta 5 flujos conversacionales', 'Hasta 10 bases de datos', 'Roles y permisos avanzados', 'Horarios configurables', '5 usuarios administradores'] },
    { name: 'Enterprise', price: 100, features: ['Hasta 20 flujos conversacionales', 'Bases de datos ilimitadas', 'Usuarios ilimitados', 'Configuración avanzada del bot'] }
  ];

  constructor(
    private authService: AuthService,
    private firebaseService: FirebaseService,
    private router: Router
  ) {}

  async onLogin(): Promise<void> {
    if (!this.email || !this.password) {
      this.error = 'Ingresa tu correo y contraseña';
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      await this.authService.login(this.email, this.password);
      await new Promise(resolve => setTimeout(resolve, 500));

      if (this.authService.isSuperAdmin) {
        this.router.navigate(['/superadmin']);
      } else if (this.firebaseService.isOrgSet) {
        this.router.navigate(['/admin']);
      } else {
        this.error = 'Tu cuenta no está asociada a ninguna organización.';
        await this.authService.logout();
      }
    } catch (err: any) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        this.error = 'Credenciales incorrectas';
      } else if (err.code === 'auth/too-many-requests') {
        this.error = 'Demasiados intentos. Intenta más tarde.';
      } else {
        this.error = 'Error al iniciar sesión';
      }
    } finally {
      this.loading = false;
    }
  }

  nextStep(): void {
    this.error = '';
    if (this.regStep === 1) {
      if (!this.regOrgName.trim()) { this.error = 'El nombre de la organización es requerido'; return; }
      this.regStep = 2;
    } else if (this.regStep === 2) {
      if (!this.regPlan) { this.error = 'Selecciona un plan para continuar'; return; }
      this.regStep = 3;
    }
  }

  prevStep(): void {
    this.error = '';
    if (this.regStep > 1) this.regStep--;
  }

  selectPlan(planName: string): void {
    this.regPlan = planName;
    this.error = '';
  }

  async onRegister(): Promise<void> {
    if (!this.regAdminName.trim()) {
      this.error = 'Tu nombre es requerido';
      return;
    }
    if (!this.regEmail.trim() || !this.regPassword.trim()) {
      this.error = 'Correo y contraseña son requeridos';
      return;
    }
    if (this.regPassword.length < 6) {
      this.error = 'La contraseña debe tener al menos 6 caracteres';
      return;
    }

    this.loading = true;
    this.error = '';
    this.success = '';

    try {
      const user = await this.authService.createUser(this.regEmail.trim(), this.regPassword);

      const orgId = await this.firebaseService.createOrganization({
        name: this.regOrgName.trim(),
        industry: this.regIndustry,
        description: this.regDescription.trim(),
        plan: this.regPlan
      });

      this.firebaseService.setOrgId(orgId);

      const selectedPlan = this.availablePlans.find(p => p.name === this.regPlan);
      await this.firebaseService.updateOrganization(orgId, {
        plan: this.regPlan,
        monthlyRate: selectedPlan?.price || 0,
        botEnabled: false,
        setupComplete: false
      });

      await this.firebaseService.setUserOrg(user.uid, {
        organizationId: orgId,
        email: this.regEmail.trim(),
        role: 'owner',
        name: this.regAdminName.trim()
      });

      await this.firebaseService.addAdmin({
        email: this.regEmail.trim(),
        name: this.regAdminName.trim(),
        role: 'owner'
      });

      await this.authService.refreshUserOrg();

      this.success = `Organización "${this.regOrgName}" creada con plan ${this.regPlan}. Redirigiendo...`;
      setTimeout(() => {
        this.router.navigate(['/admin/bienvenida']);
      }, 1500);
    } catch (err: any) {
      console.error('Registration error:', err);
      if (err.code === 'auth/email-already-in-use') {
        this.error = 'Este correo ya está registrado';
      } else {
        this.error = err.message || 'Error al crear la organización';
      }
    } finally {
      this.loading = false;
    }
  }
}
