import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  email = '';
  password = '';
  error = '';
  loading = false;

  constructor(private authService: AuthService, private router: Router) {}

  async onLogin(): Promise<void> {
    if (!this.email || !this.password) {
      this.error = 'Ingresa tu correo y contraseña';
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      await this.authService.login(this.email, this.password);
      this.router.navigate(['/admin']);
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
}
