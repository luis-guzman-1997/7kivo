import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
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

  canActivate(): Observable<boolean> {
    return this.authService.loading$.pipe(
      filter(loading => !loading),
      take(1),
      map(() => {
        if (this.authService.isAuthenticated && this.firebaseService.isOrgSet) {
          return true;
        }
        this.router.navigate(['/admin/login']);
        return false;
      })
    );
  }
}
