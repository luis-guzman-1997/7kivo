import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';
import { PresenceService } from '../../services/presence.service';
import { DeliveryAlertService } from '../../services/delivery-alert.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-admin-layout',
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.css']
})
export class AdminLayoutComponent implements OnInit, OnDestroy {
  sidebarCollapsed = false;
  userEmail = '';
  orgName = '';
  orgLogo = '';
  userRole = '';
  botEnabled = true;
  setupComplete = false;
  botPaused = false;
  botBlocked = false;
  isOnChatPage = false;
  isOnMapPage = false;
  sessionDisplacedAlert = false;
  showAlertPanel = false;
  private subs: Subscription[] = [];

  constructor(
    public authService: AuthService,
    private firebaseService: FirebaseService,
    private router: Router,
    private presenceService: PresenceService,
    public deliveryAlert: DeliveryAlertService,
    public pushService: PushNotificationService
  ) {
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
        this.checkSetupComplete();
      }),
      this.authService.botPaused$.subscribe(val => { this.botPaused = val; }),
      this.authService.botBlocked$.subscribe(val => { this.botBlocked = val; }),
      this.authService.sessionDisplaced$.subscribe(() => {
        this.sessionDisplacedAlert = true;
        const slug = localStorage.getItem('orgLoginSlug');
        setTimeout(() => {
          this.sessionDisplacedAlert = false;
          this.router.navigate(slug ? ['/admin/login', slug] : ['/admin/login']);
        }, 3000);
      }),
      this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e) => {
        const ne = e as NavigationEnd;
        this.isOnChatPage = ne.url.startsWith('/admin/chat');
        this.isOnMapPage = ne.url.startsWith('/admin/mapa-delivery');
        // Auto-close sidebar on mobile when navigating
        if (typeof window !== 'undefined' && window.innerWidth < 768 && !this.sidebarCollapsed) {
          this.sidebarCollapsed = true;
        }
        this.checkSetupComplete();
      })
    );
  }

  async ngOnInit(): Promise<void> {
    this.isOnChatPage = this.router.url.startsWith('/admin/chat');
    this.isOnMapPage = this.router.url.startsWith('/admin/mapa-delivery');
    await this.checkSetupComplete();
    this.presenceService.start();
  }

  async checkSetupComplete(): Promise<void> {
    try {
      const [orgConfig, general, contact, schedule, messages, waConfig] = await Promise.all([
        this.firebaseService.getOrgConfig(),
        this.firebaseService.getInfo('general'),
        this.firebaseService.getInfo('contact'),
        this.firebaseService.getInfo('schedule'),
        this.firebaseService.getBotMessages(),
        this.firebaseService.getWhatsAppConfig()
      ]);
      const orgDone      = !!(orgConfig?.orgName && orgConfig?.industry && orgConfig.industry !== 'general');
      const infoDone     = !!(general?.name && general?.description);
      const contactDone  = !!(contact?.phone || contact?.address);
      const scheduleDone = !!(schedule?.days?.some((d: any) => d.active));
      const messagesDone = !!((messages as any[])?.length > 0);
      const offersAppts  = schedule?.offersAppointments !== false;
      const needsServices = offersAppts && schedule?.businessType !== 'products';
      const servicesDone = !needsServices || (schedule?.services?.length > 0);
      const waDone       = !!(orgConfig?.botApiUrl && waConfig?.token && waConfig?.phoneNumberId);

      // contentDone drives auto-pause (operational data the bot needs at runtime)
      const contentDone  = orgDone && infoDone && contactDone && scheduleDone && messagesDone && servicesDone;
      // setupComplete drives the "ready" banner and checklist (includes WA credentials)
      this.setupComplete = contentDone && waDone;

      // Auto-pause / auto-resume only when bot is connected and not hard-blocked.
      // Uses contentDone (not waDone) so existing bots with env-based WA creds are not affected.
      if (this.botEnabled && !this.botBlocked) {
        const reason = this.authService.botPausedReason;
        if (!contentDone && !this.botPaused) {
          await this.firebaseService.setBotStatus(true, 'auto_setup');
          this.authService.updateBotPaused(true, 'auto_setup');
          this.botPaused = true;
        } else if (contentDone && this.botPaused && reason === 'auto_setup') {
          await this.firebaseService.setBotStatus(false, null);
          this.authService.updateBotPaused(false, null);
          this.botPaused = false;
        }
      }
    } catch { /* silent */ }
  }

  async reactivateBot(): Promise<void> {
    if (this.botBlocked) return;
    await this.firebaseService.setBotStatus(false, null);
    this.authService.updateBotPaused(false, null);
    this.botPaused = false;
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.presenceService.stop();
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  getRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      owner:    'Propietario',
      admin:    'Gerente',
      editor:   'Operador',
      viewer:   'Agente',
      delivery:       'Delivery',
      delivery_multi: 'Delivery Múltiple'
    };
    return labels[role] || role;
  }

  get isDeliveryRole(): boolean {
    const r = this.authService.userRole;
    return r === 'delivery' || r === 'delivery_multi';
  }

  get deliveryAlertCount(): number {
    if (!this.isDeliveryRole) return 0;
    return this.deliveryAlert.alertCount;
  }

  triggerLocationRequest(): void {
    this.deliveryAlert.requestLocation$.next();
  }

  triggerPushRequest(): void {
    this.deliveryAlert.requestPush$.next();
  }

  clearOrgContext(): void {
    this.authService.clearOrgContext();
  }

  async logout(): Promise<void> {
    await this.authService.logout();
    const slug = localStorage.getItem('orgLoginSlug');
    this.router.navigate(slug ? ['/admin/login', slug] : ['/admin/login']);
  }
}
