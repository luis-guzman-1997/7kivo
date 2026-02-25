import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

interface SetupItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  done: boolean;
  link: string;
  linkLabel: string;
  queryParams?: any;
}

@Component({
  selector: 'app-admin-setup',
  templateUrl: './admin-setup.component.html',
  styleUrls: ['./admin-setup.component.css']
})
export class AdminSetupComponent implements OnInit {
  loading = true;
  items: SetupItem[] = [];

  constructor(private firebaseService: FirebaseService) {}

  async ngOnInit(): Promise<void> {
    await this.loadChecklist();
  }

  async loadChecklist(): Promise<void> {
    this.loading = true;
    try {
      const [orgConfig, general, contact, schedule, messages, waConfig] = await Promise.all([
        this.firebaseService.getOrgConfig(),
        this.firebaseService.getInfo('general'),
        this.firebaseService.getInfo('contact'),
        this.firebaseService.getInfo('schedule'),
        this.firebaseService.getBotMessages(),
        this.firebaseService.getWhatsAppConfig()
      ]);

      this.items = [
        {
          id: 'org',
          title: 'Mi Organización',
          description: 'Nombre, industria y descripción de tu empresa. Es el punto de partida.',
          icon: 'fa-building',
          done: !!(orgConfig?.orgName && orgConfig?.industry && orgConfig?.industry !== 'general'),
          link: '/admin/configuracion',
          linkLabel: 'Configurar'
        },
        {
          id: 'info',
          title: 'Información General',
          description: 'Nombre y descripción que el bot comparte cuando preguntan por tu negocio.',
          icon: 'fa-info-circle',
          done: !!(general?.name && general?.description),
          link: '/admin/configuracion',
          linkLabel: 'Completar',
          queryParams: { tab: 'info' }
        },
        {
          id: 'contact',
          title: 'Información de Contacto',
          description: 'Dirección, teléfono y datos que el bot muestra cuando el cliente dice "Contáctanos".',
          icon: 'fa-address-book',
          done: !!(contact?.phone || contact?.address),
          link: '/admin/configuracion',
          linkLabel: 'Completar',
          queryParams: { tab: 'info' }
        },
        {
          id: 'schedule',
          title: 'Horarios de Atención',
          description: 'Días y turnos en que atienden. El bot los muestra cuando el cliente pregunta.',
          icon: 'fa-calendar-alt',
          done: !!(schedule?.days?.some((d: any) => d.active)),
          link: '/admin/configuracion',
          linkLabel: 'Configurar',
          queryParams: { tab: 'horarios' }
        },
        {
          id: 'messages',
          title: 'Mensajería Bot',
          description: 'Mensajes de bienvenida, despedida y fallback que el bot envía automáticamente.',
          icon: 'fa-comment-dots',
          done: !!((messages as any[])?.length > 0),
          link: '/admin/bot',
          linkLabel: 'Configurar'
        },
        {
          id: 'whatsapp',
          title: 'Conexión WhatsApp',
          description: 'El equipo de 7kivo configura la URL del servidor y las credenciales de WhatsApp Cloud API. Sin esto el bot no puede recibir ni enviar mensajes.',
          icon: 'fa-plug',
          done: !!(orgConfig?.botApiUrl && waConfig?.token && waConfig?.phoneNumberId),
          link: '',
          linkLabel: ''
        }
      ];

      if (schedule?.offersAppointments !== false && schedule?.businessType !== 'products') {
        this.items.push({
          id: 'services',
          title: 'Servicios para Citas',
          description: 'Tienes citas por WhatsApp activas — agrega al menos un servicio con su duración.',
          icon: 'fa-list-ul',
          done: !!(schedule?.services?.length > 0),
          link: '/admin/configuracion',
          linkLabel: 'Agregar servicios',
          queryParams: { tab: 'horarios' }
        });
      }

    } catch (err) {
      console.error('Error loading setup checklist:', err);
    } finally {
      this.loading = false;
    }
  }

  get doneCount(): number {
    return this.items.filter(i => i.done).length;
  }

  get totalCount(): number {
    return this.items.length;
  }

  get progressPercent(): number {
    return this.totalCount ? Math.round((this.doneCount / this.totalCount) * 100) : 0;
  }

  get allDone(): boolean {
    return this.doneCount === this.totalCount && this.totalCount > 0;
  }
}
