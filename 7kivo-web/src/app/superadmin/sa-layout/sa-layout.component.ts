import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-sa-layout',
  templateUrl: './sa-layout.component.html',
  styleUrls: ['./sa-layout.component.css']
})
export class SaLayoutComponent {
  sidebarCollapsed = false;
  userEmail = '';

  constructor(public authService: AuthService, private router: Router) {
    this.authService.currentUser$.subscribe(user => {
      this.userEmail = user?.email || '';
    });
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  async logout(): Promise<void> {
    await this.authService.logout();
    this.router.navigate(['/admin/login']);
  }
}
