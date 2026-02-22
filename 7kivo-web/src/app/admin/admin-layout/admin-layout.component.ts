import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-admin-layout',
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.css']
})
export class AdminLayoutComponent implements OnDestroy {
  sidebarCollapsed = false;
  userEmail = '';
  orgName = '';
  orgLogo = '';
  userRole = '';
  private subs: Subscription[] = [];

  constructor(public authService: AuthService, private router: Router) {
    this.subs.push(
      this.authService.currentUser$.subscribe(user => {
        this.userEmail = user?.email || '';
      }),
      this.authService.orgName$.subscribe(name => {
        this.orgName = name;
      }),
      this.authService.orgLogo$.subscribe(logo => {
        this.orgLogo = logo;
      }),
      this.authService.userRole$.subscribe(role => {
        this.userRole = role;
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  async logout(): Promise<void> {
    await this.authService.logout();
    this.router.navigate(['/admin/login']);
  }
}
