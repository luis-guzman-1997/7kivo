import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): Observable<boolean> {
    const requiredPermission = route.data['permission'] as string;

    return this.authService.loading$.pipe(
      filter(loading => !loading),
      take(1),
      map(() => {
        if (!this.authService.isAuthenticated) {
          this.router.navigate(['/admin/login']);
          return false;
        }
        if (!requiredPermission || this.authService.hasPermission(requiredPermission)) {
          return true;
        }
        this.router.navigate(['/admin']);
        return false;
      })
    );
  }
}
