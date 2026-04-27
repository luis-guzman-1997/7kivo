import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';

const DEFAULT_PLANS = [
  { name: 'Starter', tagline: 'Para empezar a automatizar', price: 9.99, popular: false, ctaText: 'Comenzar',
    features: ['Bot WhatsApp con menu interactivo', '1 flujo conversacional', '1 coleccion de datos', 'Bandeja de entrada', 'Chat WhatsApp (solo lectura)'],
    disabledFeatures: ['Sistema de citas', 'Chat en vivo'], active: true },
  { name: 'Business', tagline: 'Para negocios en crecimiento', price: 19.99, popular: true, ctaText: 'Comenzar',
    features: ['Hasta 3 flujos conversacionales', 'Hasta 3 colecciones de datos', 'Sistema de citas y agenda', 'Chat en vivo con clientes', '3 usuarios administradores', 'Bandeja de entrada con calendario'],
    disabledFeatures: [], active: true },
  { name: 'Premium', tagline: 'Para equipos profesionales', price: 39.99, popular: false, ctaText: 'Comenzar',
    features: ['Hasta 5 flujos conversacionales', 'Hasta 10 colecciones de datos', 'Sistema de citas y agenda', 'Chat en vivo con clientes', '5 usuarios administradores', 'Roles y permisos avanzados'],
    disabledFeatures: [], active: true },
  { name: 'Enterprise', tagline: 'Para grandes operaciones', price: 100, popular: false, ctaText: 'Contactar',
    features: ['Hasta 20 flujos conversacionales', 'Colecciones ilimitadas', 'Usuarios ilimitados', 'Configuracion avanzada del bot', 'Roles y permisos completos', 'Plan personalizado'],
    disabledFeatures: [], active: true }
];

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
  plans: any[] = DEFAULT_PLANS;
  plansSectionTitle = 'Un plan para cada etapa de tu negocio';
  plansSectionDesc = 'Elige el plan que se adapte a tus necesidades. Actualiza en cualquier momento.';
  clients: { name: string; logo: string }[] = [];

  constructor(
    private router: Router,
    private authService: AuthService,
    private firebaseService: FirebaseService
  ) {}

  async ngOnInit(): Promise<void> {
    if (this.authService.currentUser) {
      if (this.authService.isSuperAdmin) {
        this.router.navigate(['/superadmin']);
      } else if (this.firebaseService.isOrgSet) {
        this.router.navigate(['/admin']);
      }
      return;
    }
    const slug = localStorage.getItem('orgLoginSlug');
    if (slug) {
      this.router.navigate(['/admin/login', slug]);
      return;
    }
    try {
      this.clients = await this.firebaseService.getPlatformClients();
    } catch { /* silent */ }

    try {
      const data = await this.firebaseService.getPlatformPlans();
      if (data?.plans?.length) {
        this.plans = data.plans.filter((p: any) => p.active !== false);
      }
      if (data?.sectionTitle) this.plansSectionTitle = data.sectionTitle;
      if (data?.sectionDesc) this.plansSectionDesc = data.sectionDesc;
    } catch {
      // usa defaults
    }
  }
}
