import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { FirebaseService } from '../services/firebase.service';
import { Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private firebaseService: FirebaseService,
    private router: Router
  ) {}

  canActivate(_route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> {
    return this.authService.loading$.pipe(
      filter(loading => !loading),
      take(1),
      map(() => {
        if (this.authService.isAuthenticated && this.authService.isSuperAdmin) {
          // Allow SA to access admin pages when an org context has been set (SA previewing an org)
          if (this.firebaseService.isOrgSet) {
            return true;
          }
          this.router.navigate(['/superadmin']);
          return false;
        }
        if (this.authService.isAuthenticated && this.firebaseService.isOrgSet) {
          const isWelcomeRoute = state.url.includes('/bienvenida');
          if (!this.authService.setupComplete && !isWelcomeRoute) {
            this.router.navigate(['/admin/bienvenida']);
            return false;
          }
          return true;
        }
        const slug = localStorage.getItem('orgLoginSlug');
        this.router.navigate(slug ? ['/admin/login', slug] : ['/admin/login']);
        return false;
      })
    );
  }
}
