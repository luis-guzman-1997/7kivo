import { Component, OnInit, OnDestroy, AfterViewInit, HostListener } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SwUpdate } from '@angular/service-worker';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  title = '7kivo';
  activeSection: string = 'inicio';
  isAdminRoute = false;
  private scrollTimeout: any;
  private mainEl: Element | null = null;

  private readonly sections = ['inicio', 'funcionalidades', 'planes', 'casos', 'nosotros'];

  constructor(private router: Router, private swUpdate: SwUpdate) {
    if (swUpdate.isEnabled) {
      swUpdate.versionUpdates.pipe(
        filter(e => e.type === 'VERSION_READY')
      ).subscribe(() => window.location.reload());
    }
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.isAdminRoute = event.url.startsWith('/admin') || event.url.startsWith('/superadmin');
    });
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
  }

  ngAfterViewInit(): void {
    this.mainEl = document.querySelector('main');
    if (this.mainEl) {
      this.mainEl.addEventListener('scroll', () => this.onScrollDebounced(), { passive: true });
    }
    setTimeout(() => this.updateActiveSection(), 200);
  }

  @HostListener('window:scroll')
  onWindowScroll(): void { this.onScrollDebounced(); }

  private onScrollDebounced(): void {
    if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
    this.scrollTimeout = setTimeout(() => this.updateActiveSection(), 60);
  }

  updateActiveSection(): void {
    const scrollY = this.mainEl ? this.mainEl.scrollTop : window.scrollY;
    const viewH = window.innerHeight;

    if (scrollY < 100) { this.activeSection = 'inicio'; return; }

    let best = 'inicio';
    for (const id of this.sections) {
      const el = document.getElementById(id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top < viewH * 0.45 && rect.bottom > viewH * 0.15) {
        best = id;
      }
    }
    this.activeSection = best;
  }

  scrollToSection(sectionId: string, event: Event): void {
    event.preventDefault();
    const container = this.mainEl || window;

    if (sectionId === 'inicio') {
      this.activeSection = 'inicio';
      this.smoothScrollTo(container, 0, 400);
      return;
    }

    const el = document.getElementById(sectionId);
    if (!el) return;

    let target: number;
    if (this.mainEl) {
      const mainRect = this.mainEl.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      target = elRect.top - mainRect.top + this.mainEl.scrollTop + 72;
    } else {
      const navbar = document.querySelector('.navbar');
      const offset = (navbar ? navbar.getBoundingClientRect().height : 66) - 2;
      target = el.getBoundingClientRect().top + window.pageYOffset - offset;
    }

    this.activeSection = sectionId;
    this.smoothScrollTo(container, Math.max(0, target), 400);
    setTimeout(() => this.updateActiveSection(), 450);
  }

  private smoothScrollTo(container: Element | Window, target: number, ms: number): void {
    const isWin = container === window;
    const start = isWin ? window.pageYOffset : (container as Element).scrollTop;
    const dist = target - start;
    let t0: number | null = null;

    const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const step = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min((now - t0) / ms, 1);
      const pos = start + dist * ease(p);
      isWin ? window.scrollTo(0, pos) : (container as Element).scrollTo(0, pos);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  isActive(id: string): boolean { return this.activeSection === id; }
}

