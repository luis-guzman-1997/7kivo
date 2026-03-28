import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-login-org',
  templateUrl: './login-org.component.html',
  styleUrls: ['./login-org.component.css']
})
export class LoginOrgComponent implements OnInit {
  email = '';
  password = '';
  showPassword = false;
  error = '';
  loading = false;

  slugLoading = true;
  org: any = null;
  slugInvalid = false;

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private firebaseService: FirebaseService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    const raw = this.route.snapshot.paramMap.get('slug') || '';
    const slug = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const cacheKey = `orgLoginCache_${slug}`;

    try {
      const org = await this.firebaseService.getOrgByLoginSlug(raw);
      if (!org) {
        // Sin resultado en Firestore — usar caché si existe
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          this.org = JSON.parse(cached);
        } else {
          this.slugInvalid = true;
        }
        return;
      }

      let orgName = org.name || org.orgName || org.id;
      let orgLogo = org.orgLogo || '';
      try {
        const config = await this.firebaseService.getOrgConfigByOrgId(org.id);
        if (config) {
          orgName = config.orgName || orgName;
          orgLogo = config.orgLogo || orgLogo;
        }
      } catch {
        // Sin sesión, las reglas suelen bloquear config/general; el login público sigue siendo válido
      }

      this.org = { ...org, orgName, orgLogo };
      // Guardar slug y datos de la org para cuando Firestore no sea accesible sin auth
      localStorage.setItem('orgLoginSlug', slug);
      localStorage.setItem(cacheKey, JSON.stringify({ orgName, orgLogo }));
    } catch (err) {
      // Firestore bloqueado sin auth — intentar con caché
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        this.org = JSON.parse(cached);
      } else {
        console.error('LoginOrg init', err);
        this.slugInvalid = true;
      }
    } finally {
      this.slugLoading = false;
    }
  }

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
}
