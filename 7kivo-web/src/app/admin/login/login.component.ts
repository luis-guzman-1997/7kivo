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

  async onRegister(): Promise<void> {
    if (!this.regOrgName.trim()) {
      this.error = 'El nombre de la organización es requerido';
      return;
    }
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
      // 1. Create Firebase Auth user FIRST (so we're authenticated for Firestore writes)
      const user = await this.authService.createUser(this.regEmail.trim(), this.regPassword);

      // 2. Create org in Firestore (now authenticated)
      const orgId = await this.firebaseService.createOrganization({
        name: this.regOrgName.trim(),
        industry: this.regIndustry,
        description: this.regDescription.trim()
      });

      // 3. Set orgId so we can write admin under the org
      this.firebaseService.setOrgId(orgId);

      // 4. Map user to org in /users/{uid}
      await this.firebaseService.setUserOrg(user.uid, {
        organizationId: orgId,
        email: this.regEmail.trim(),
        role: 'owner',
        name: this.regAdminName.trim()
      });

      // 5. Add user as admin in the org
      await this.firebaseService.addAdmin({
        email: this.regEmail.trim(),
        name: this.regAdminName.trim(),
        role: 'owner'
      });

      this.success = `Organización "${this.regOrgName}" creada exitosamente. Redirigiendo...`;
      setTimeout(() => {
        this.router.navigate(['/admin']);
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
