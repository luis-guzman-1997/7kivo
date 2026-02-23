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
  botEnabled = true;
  private subs: Subscription[] = [];

  constructor(public authService: AuthService, private router: Router) {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      this.sidebarCollapsed = true;
    }
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
      }),
      this.authService.botEnabled$.subscribe(val => {
        this.botEnabled = val;
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
