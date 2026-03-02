import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-org-settings',
  templateUrl: './org-settings.component.html',
  styleUrls: ['./org-settings.component.css']
})
export class OrgSettingsComponent implements OnInit {
  // --- Org config (existing) ---
  generalConfig: any = {};
  loading = true;
  saving = false;
  notice = '';
  error = '';
  orgId = '';
  logoPreview = '';
  logoFile: File | null = null;
  uploadingLogo = false;

  // --- Tabs ---
  activeTab = 'empresa';

  // --- Info & Contact ---
  generalInfo: any = {};
  contactInfo: any = {};
  scheduleInfo: any = { days: [] };
  newBlockedDate = '';
  newService: any = { title: '', subtitle: '', description: '', duration: 30, capacity: 1 };

  readonly WEEK_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService,
    private route: ActivatedRoute
  ) {
    this.orgId = this.firebaseService.getOrgId();
  }

  async ngOnInit(): Promise<void> {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab) this.activeTab = tab;
    await this.loadConfig();
  }

  async loadConfig(): Promise<void> {
    this.loading = true;
    try {
      const [orgConfig, contact, schedule, general] = await Promise.all([
        this.firebaseService.getOrgConfig(),
        this.firebaseService.getInfo('contact'),
        this.firebaseService.getInfo('schedule'),
        this.firebaseService.getInfo('general')
      ]);
      this.generalConfig = orgConfig || {};
      this.logoPreview = this.generalConfig.orgLogo || '';
      const rawContact = contact || {};
      this.contactInfo = {
        ...rawContact,
        showFields: rawContact.showFields || { address: true, city: true, phone: true, email: true, country: true }
      };
      this.generalInfo = general || {};
      this.initSchedule(schedule);
    } catch (err) {
      console.error('Error loading config:', err);
    } finally {
      this.loading = false;
    }
  }

  // ==================== EMPRESA TAB ====================

  async saveGeneral(): Promise<void> {
    this.saving = true;
    this.notice = '';
    this.error = '';
    try {
      if (this.logoFile) {
        const url = await this.uploadLogo();
        if (url) {
          this.generalConfig.orgLogo = url;
          this.logoPreview = url;
        }
      }
      await this.firebaseService.saveOrgConfig(this.generalConfig);
      this.authService.updateOrgLogo(this.generalConfig.orgLogo || '');
      this.notice = 'Configuración guardada';
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al guardar configuración';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    if (file.size > 2 * 1024 * 1024) {
      this.error = 'El logo no debe superar 2 MB';
      setTimeout(() => this.error = '', 3000);
      return;
    }
    this.logoFile = file;
    const reader = new FileReader();
    reader.onload = (e) => { this.logoPreview = e.target!.result as string; };
    reader.readAsDataURL(file);
  }

  async uploadLogo(): Promise<string | null> {
    if (!this.logoFile) return null;
    this.uploadingLogo = true;
    try {
      const url = await this.firebaseService.uploadOrgLogo(this.logoFile);
      this.logoFile = null;
      return url;
    } catch (err) {
      this.error = 'Error al subir logo';
      setTimeout(() => this.error = '', 3000);
      return null;
    } finally {
      this.uploadingLogo = false;
    }
  }

  async removeLogo(): Promise<void> {
    const orgId = this.firebaseService.getOrgId();
    if (this.generalConfig.orgLogo) {
      await this.firebaseService.deleteFile(`organizations/${orgId}/logo.png`).catch(() => {});
      await this.firebaseService.deleteFile(`organizations/${orgId}/logo.jpg`).catch(() => {});
      await this.firebaseService.deleteFile(`organizations/${orgId}/logo.webp`).catch(() => {});
    }
    this.logoPreview = '';
    this.logoFile = null;
    this.generalConfig.orgLogo = '';
  }

  // ==================== INFO & CONTACT TAB ====================

  get isInfoEmpty(): boolean {
    return !this.generalInfo.name && !this.contactInfo.phone && !this.contactInfo.address;
  }

  async saveGeneralInfo(): Promise<void> {
    this.saving = true;
    try {
      await this.firebaseService.updateInfo('general', this.generalInfo);
      this.notice = 'Información general actualizada';
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al guardar información general';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  async saveContactInfo(): Promise<void> {
    this.saving = true;
    try {
      await this.firebaseService.updateInfo('contact', this.contactInfo);
      this.notice = 'Información de contacto actualizada';
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al guardar contacto';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  getIndustryLabel(industry: string): string {
    const labels: Record<string, string> = {
      education: 'Educación', healthcare: 'Salud / Clínica', retail: 'Comercio / Tienda',
      restaurant: 'Restaurante', services: 'Servicios', realestate: 'Bienes Raíces',
      technology: 'Tecnología', general: 'General', other: 'General',
      barbershop: 'Barbería',
      beauty_salon: 'Salón de Belleza',
      nail_salon: 'Uñas y Pestañas',
      spa: 'Spa y Estética',
      carwash: 'Carwash',
      medical: 'Médico / Clínica',
      tours: 'Tours y Viajes',
      academy: 'Academia',
      school: 'Colegio / Centro Educativo',
      cleaning: 'Limpieza y Lavandería',
      photography: 'Fotografía',
      shipping: 'Empresa de Envíos'
    };
    return labels[industry] || 'General';
  }

  readonly DUMMY_TEMPLATES: Record<string, any> = {
    education: {
      description: 'Centro educativo comprometido con la formación integral, ofreciendo programas académicos de calidad y un ambiente de aprendizaje estimulante.',
      address: '1a Calle Poniente #45, Colonia Escalón', city: 'San Salvador',
      phone: '+503 2222-3333', email: 'info@colegio.edu.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'07:00',to:'15:00'}, 'Martes': {from:'07:00',to:'15:00'}, 'Miércoles': {from:'07:00',to:'15:00'}, 'Jueves': {from:'07:00',to:'15:00'}, 'Viernes': {from:'07:00',to:'15:00'}, 'Sábado': {from:'08:00',to:'12:00'} },
      services: [
        { title: 'Orientación', subtitle: 'Orientación vocacional y académica', description: 'Sesión personalizada de orientación vocacional para elegir la mejor ruta académica según las fortalezas e intereses del estudiante.', duration: 45 },
        { title: 'Revisión', subtitle: 'Seguimiento de rendimiento escolar', description: 'Revisión detallada del rendimiento académico con el equipo pedagógico para identificar áreas de mejora y definir un plan de acción.', duration: 30 }
      ]
    },
    healthcare: {
      description: 'Clínica médica especializada en atención integral a la salud, con profesionales certificados y equipamiento moderno.',
      address: 'Av. La Revolución #123, Col. San Benito', city: 'San Salvador',
      phone: '+503 2244-5566', email: 'citas@clinica.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'07:00',to:'17:00'}, 'Martes': {from:'07:00',to:'17:00'}, 'Miércoles': {from:'07:00',to:'17:00'}, 'Jueves': {from:'07:00',to:'17:00'}, 'Viernes': {from:'07:00',to:'17:00'}, 'Sábado': {from:'08:00',to:'12:00'} },
      services: [
        { title: 'Consulta General', subtitle: 'Medicina general, 30 min', description: 'Consulta con médico general para diagnóstico, tratamiento y orientación sobre tu estado de salud. Se revisa historial clínico y se emite receta si aplica.', duration: 30 },
        { title: 'Pediatría', subtitle: 'Atención para niños y adolesc.', description: 'Atención médica especializada para niños y adolescentes con nuestro equipo de pediatras certificados. Incluye control de crecimiento y desarrollo.', duration: 30 },
        { title: 'Ginecología', subtitle: 'Consulta ginecológica, 45 min', description: 'Consulta especializada en salud femenina con enfoque en prevención, diagnóstico y tratamiento. Incluye examen de rutina y orientación preventiva.', duration: 45 }
      ]
    },
    retail: {
      description: 'Tienda con amplia variedad de productos de calidad, precios competitivos y excelente servicio al cliente.',
      address: 'Local 5, Centro Comercial Metrocentro', city: 'San Salvador',
      phone: '+503 2233-4455', email: 'ventas@tienda.com.sv', country: 'El Salvador',
      businessType: 'products', offersAppointments: false,
      activeDays: { 'Lunes': {from:'09:00',to:'19:00'}, 'Martes': {from:'09:00',to:'19:00'}, 'Miércoles': {from:'09:00',to:'19:00'}, 'Jueves': {from:'09:00',to:'19:00'}, 'Viernes': {from:'09:00',to:'19:00'}, 'Sábado': {from:'09:00',to:'19:00'}, 'Domingo': {from:'10:00',to:'18:00'} },
      services: []
    },
    restaurant: {
      description: 'Restaurante con auténtica cocina preparada con ingredientes frescos, recetas tradicionales y el sabor de siempre.',
      address: 'Boulevard del Hipódromo #78, Zona Rosa', city: 'San Salvador',
      phone: '+503 2211-2233', email: 'reservas@restaurante.com.sv', country: 'El Salvador',
      businessType: 'products', offersAppointments: false,
      activeDays: { 'Lunes': {from:'07:00',to:'21:00'}, 'Martes': {from:'07:00',to:'21:00'}, 'Miércoles': {from:'07:00',to:'21:00'}, 'Jueves': {from:'07:00',to:'21:00'}, 'Viernes': {from:'07:00',to:'22:00'}, 'Sábado': {from:'07:00',to:'22:00'}, 'Domingo': {from:'08:00',to:'20:00'} },
      services: []
    },
    services: {
      description: 'Empresa de servicios profesionales comprometida con la calidad, puntualidad y satisfacción total de cada cliente.',
      address: 'Calle Las Palmas #22, Colonia Médica', city: 'San Salvador',
      phone: '+503 2200-1122', email: 'servicios@empresa.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'08:00',to:'17:00'}, 'Martes': {from:'08:00',to:'17:00'}, 'Miércoles': {from:'08:00',to:'17:00'}, 'Jueves': {from:'08:00',to:'17:00'}, 'Viernes': {from:'08:00',to:'17:00'}, 'Sábado': {from:'08:00',to:'12:00'} },
      services: [
        { title: 'Consultoría', subtitle: 'Sesión inicial de consultoría', description: 'Primera consultoría para evaluar necesidades, establecer objetivos y definir una hoja de ruta personalizada para tu proyecto o negocio.', duration: 60 },
        { title: 'Asesoría', subtitle: 'Asesoría profesional especializada', description: 'Sesión en profundidad para resolver dudas, optimizar procesos y obtener orientación experta adaptada a tu situación específica.', duration: 45 }
      ]
    },
    realestate: {
      description: 'Empresa inmobiliaria con amplia experiencia en compra, venta y alquiler de propiedades residenciales y comerciales.',
      address: 'Torre Futura, Local 8, Santa Elena', city: 'Antiguo Cuscatlán',
      phone: '+503 2266-7788', email: 'info@inmobiliaria.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'08:00',to:'17:00'}, 'Martes': {from:'08:00',to:'17:00'}, 'Miércoles': {from:'08:00',to:'17:00'}, 'Jueves': {from:'08:00',to:'17:00'}, 'Viernes': {from:'08:00',to:'17:00'}, 'Sábado': {from:'09:00',to:'13:00'} },
      services: [
        { title: 'Visita Propiedad', subtitle: 'Recorrido guiado por la propiedad', description: 'Visita guiada con asesor especializado que responderá tus preguntas y te orientará en el proceso de compra o alquiler de la propiedad.', duration: 60 },
        { title: 'Asesoría Legal', subtitle: 'Consulta sobre contratos y trámites', description: 'Asesoría legal especializada para revisar contratos, aclarar trámites notariales y orientarte en el proceso legal de compraventa o arrendamiento.', duration: 60 }
      ]
    },
    technology: {
      description: 'Empresa tecnológica enfocada en soluciones digitales, desarrollo de software y transformación tecnológica para negocios.',
      address: 'Edificio World Trade Center, Local 302', city: 'San Salvador',
      phone: '+503 2277-8899', email: 'hola@techempresa.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'08:00',to:'18:00'}, 'Martes': {from:'08:00',to:'18:00'}, 'Miércoles': {from:'08:00',to:'18:00'}, 'Jueves': {from:'08:00',to:'18:00'}, 'Viernes': {from:'08:00',to:'18:00'} },
      services: [
        { title: 'Consultoría Tech', subtitle: 'Análisis de necesidades tecnológicas', description: 'Consultoría para analizar tu situación tecnológica actual, identificar oportunidades de mejora y proponer soluciones digitales a medida para tu negocio.', duration: 60, capacity: 1 },
        { title: 'Soporte Técnico', subtitle: 'Resolución de problemas técnicos', description: 'Sesión de soporte para resolver problemas, configurar sistemas o capacitar al equipo en el uso eficiente de herramientas y plataformas digitales.', duration: 45, capacity: 1 }
      ]
    },
    barbershop: {
      description: 'Barbería profesional con los mejores estilistas, cortes modernos y clásicos. Reserva tu turno y luce siempre bien.',
      address: '3a Calle Oriente #12, Centro', city: 'San Salvador',
      phone: '+503 2255-6677', email: 'citas@barberia.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'09:00',to:'19:00'}, 'Martes': {from:'09:00',to:'19:00'}, 'Miércoles': {from:'09:00',to:'19:00'}, 'Jueves': {from:'09:00',to:'19:00'}, 'Viernes': {from:'09:00',to:'20:00'}, 'Sábado': {from:'08:00',to:'20:00'} },
      services: [
        { title: 'Corte de cabello', subtitle: 'Corte + lavado', description: 'Corte profesional de cabello con lavado y peinado incluido. Elige el estilo que prefieras.', duration: 30, capacity: 2 },
        { title: 'Corte + barba', subtitle: 'Corte y arreglo de barba', description: 'Corte de cabello más arreglo y perfilado de barba con navaja y acabados profesionales.', duration: 45, capacity: 2 },
        { title: 'Afeitado clásico', subtitle: 'Afeitado con navaja y toalla', description: 'Afeitado tradicional con navaja caliente, espuma artesanal y toalla caliente. Experiencia premium.', duration: 30, capacity: 1 }
      ]
    },
    beauty_salon: {
      description: 'Salón de belleza con servicios de corte, color, tratamientos y más. Nuestro equipo te hará lucir espectacular.',
      address: 'Av. Masferrer Norte #78, Col. Escalón', city: 'San Salvador',
      phone: '+503 2266-3344', email: 'reservas@salon.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'09:00',to:'19:00'}, 'Martes': {from:'09:00',to:'19:00'}, 'Miércoles': {from:'09:00',to:'19:00'}, 'Jueves': {from:'09:00',to:'19:00'}, 'Viernes': {from:'09:00',to:'19:00'}, 'Sábado': {from:'09:00',to:'18:00'} },
      services: [
        { title: 'Corte dama', subtitle: 'Corte, lavado y peinado', description: 'Corte de cabello para dama con lavado, acondicionamiento y peinado final.', duration: 60, capacity: 2 },
        { title: 'Tinte / Color', subtitle: 'Coloración completa', description: 'Aplicación de tinte de raíz a puntas con productos premium. Incluye tratamiento post-color.', duration: 90, capacity: 1 },
        { title: 'Tratamiento', subtitle: 'Nutrición e hidratación', description: 'Tratamiento intensivo de nutrición e hidratación para cabello dañado o reseco.', duration: 45, capacity: 2 }
      ]
    },
    nail_salon: {
      description: 'Especialistas en uñas, pestañas y cejas. Diseños personalizados y técnicas de última generación.',
      address: 'Centro Comercial La Gran Vía, Local 34', city: 'Antiguo Cuscatlán',
      phone: '+503 2288-9900', email: 'citas@nailstudio.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'09:00',to:'18:00'}, 'Martes': {from:'09:00',to:'18:00'}, 'Miércoles': {from:'09:00',to:'18:00'}, 'Jueves': {from:'09:00',to:'18:00'}, 'Viernes': {from:'09:00',to:'19:00'}, 'Sábado': {from:'09:00',to:'19:00'} },
      services: [
        { title: 'Manicure', subtitle: 'Manicure completo', description: 'Manicure completo con limpieza de cutículas, forma y esmaltado regular o semipermanente.', duration: 45, capacity: 2 },
        { title: 'Pedicure', subtitle: 'Pedicure spa', description: 'Pedicure spa con exfoliación, masaje relajante y esmaltado de tu elección.', duration: 60, capacity: 2 },
        { title: 'Uñas acrílicas', subtitle: 'Juego completo acrílico', description: 'Aplicación de uñas acrílicas con diseño personalizado, longitud y forma a elección.', duration: 90, capacity: 1 }
      ]
    },
    spa: {
      description: 'Spa y centro de estética para relajarte y revitalizarte. Tratamientos corporales y faciales de alta calidad.',
      address: 'Calle El Mirador #5, San Benito', city: 'San Salvador',
      phone: '+503 2244-1122', email: 'reservas@spa.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'10:00',to:'19:00'}, 'Martes': {from:'10:00',to:'19:00'}, 'Miércoles': {from:'10:00',to:'19:00'}, 'Jueves': {from:'10:00',to:'19:00'}, 'Viernes': {from:'10:00',to:'20:00'}, 'Sábado': {from:'09:00',to:'20:00'}, 'Domingo': {from:'10:00',to:'17:00'} },
      services: [
        { title: 'Masaje relajante', subtitle: 'Masaje cuerpo completo', description: 'Masaje de cuerpo completo con aceites esenciales para liberar tensiones y alcanzar relajación total.', duration: 60, capacity: 1 },
        { title: 'Facial hidratante', subtitle: 'Limpieza y nutrición facial', description: 'Limpieza profunda facial con exfoliación, vapor, extracción y mascarilla hidratante.', duration: 75, capacity: 1 },
        { title: 'Aromaterapia', subtitle: 'Terapia con aromas naturales', description: 'Sesión de aromaterapia con esencias naturales y masaje suave para equilibrar cuerpo y mente.', duration: 45, capacity: 1 }
      ]
    },
    carwash: {
      description: 'Servicio de lavado y detailing para tu vehículo. Dejamos tu carro como nuevo con los mejores productos.',
      address: 'Bulevar del Ejército Km 4.5', city: 'San Salvador',
      phone: '+503 2233-5566', email: 'citas@carwash.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'07:00',to:'17:00'}, 'Martes': {from:'07:00',to:'17:00'}, 'Miércoles': {from:'07:00',to:'17:00'}, 'Jueves': {from:'07:00',to:'17:00'}, 'Viernes': {from:'07:00',to:'17:00'}, 'Sábado': {from:'07:00',to:'16:00'} },
      services: [
        { title: 'Lavado básico', subtitle: 'Exterior + interior', description: 'Lavado exterior con champú, aspirado de interiores y limpieza de vidrios.', duration: 30, capacity: 3 },
        { title: 'Lavado completo', subtitle: 'Lavado + encerado', description: 'Lavado completo exterior e interior, encerado, brillado de llantas y aromatizante.', duration: 60, capacity: 2 },
        { title: 'Detailing', subtitle: 'Detailing profesional', description: 'Detailing completo: pulido, encerado, limpieza de motor, tapizado y restauración de plásticos.', duration: 120, capacity: 1 }
      ]
    },
    medical: {
      description: 'Consultorio médico especializado en atención integral a la salud, con tecnología moderna y personal certificado.',
      address: 'Av. La Capilla #222, Col. Médica', city: 'San Salvador',
      phone: '+503 2244-5577', email: 'citas@consultorio.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'07:00',to:'17:00'}, 'Martes': {from:'07:00',to:'17:00'}, 'Miércoles': {from:'07:00',to:'17:00'}, 'Jueves': {from:'07:00',to:'17:00'}, 'Viernes': {from:'07:00',to:'17:00'}, 'Sábado': {from:'08:00',to:'12:00'} },
      services: [
        { title: 'Consulta General', subtitle: 'Consulta médica 30 min', description: 'Consulta con médico general para diagnóstico, tratamiento y orientación. Se revisa historial clínico.', duration: 30, capacity: 1 },
        { title: 'Revisión', subtitle: 'Revisión de seguimiento', description: 'Revisión de seguimiento para pacientes con tratamiento activo. Evaluación de evolución y ajuste de medicación.', duration: 20, capacity: 2 },
        { title: 'Examen físico', subtitle: 'Examen completo anual', description: 'Examen físico completo anual con toma de signos vitales, análisis básicos y evaluación general.', duration: 45, capacity: 1 }
      ]
    },
    tours: {
      description: 'Agencia de tours y viajes. Organizamos experiencias únicas nacionales e internacionales para grupos e individuales.',
      address: 'Centro Comercial Multiplaza, Local 12', city: 'San Salvador',
      phone: '+503 2211-4433', email: 'reservas@toursagencia.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'08:00',to:'17:00'}, 'Martes': {from:'08:00',to:'17:00'}, 'Miércoles': {from:'08:00',to:'17:00'}, 'Jueves': {from:'08:00',to:'17:00'}, 'Viernes': {from:'08:00',to:'17:00'}, 'Sábado': {from:'09:00',to:'14:00'} },
      services: [
        { title: 'Asesoría de viaje', subtitle: 'Planificación personalizada', description: 'Sesión de asesoría para planificar tu viaje ideal: destinos, presupuesto, itinerario y trámites.', duration: 60, capacity: 1 },
        { title: 'Tour día completo', subtitle: 'Excursión nacional', description: 'Tour de día completo a destinos nacionales con guía, transporte y alimentación incluida.', duration: 60, capacity: 10 }
      ]
    },
    academy: {
      description: 'Academia de formación profesional con cursos técnicos, talleres y diplomados en diversas áreas.',
      address: 'Calle Arce #456, Col. Flor Blanca', city: 'San Salvador',
      phone: '+503 2222-7788', email: 'info@academia.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'07:00',to:'20:00'}, 'Martes': {from:'07:00',to:'20:00'}, 'Miércoles': {from:'07:00',to:'20:00'}, 'Jueves': {from:'07:00',to:'20:00'}, 'Viernes': {from:'07:00',to:'20:00'}, 'Sábado': {from:'08:00',to:'17:00'} },
      services: [
        { title: 'Orientación', subtitle: 'Orientación vocacional', description: 'Sesión de orientación para elegir el curso o carrera técnica más adecuada según tus intereses.', duration: 45, capacity: 1 },
        { title: 'Inscripción', subtitle: 'Proceso de inscripción', description: 'Cita para completar el proceso de inscripción, entrega de documentos y pago de matrícula.', duration: 30, capacity: 2 }
      ]
    },
    school: {
      description: 'Centro educativo comprometido con la formación integral de niños y jóvenes. Admisiones abiertas.',
      address: '5a Av. Sur #89, Reparto Las Palmas', city: 'Santa Ana',
      phone: '+503 2441-2233', email: 'secretaria@colegio.edu.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'07:00',to:'15:00'}, 'Martes': {from:'07:00',to:'15:00'}, 'Miércoles': {from:'07:00',to:'15:00'}, 'Jueves': {from:'07:00',to:'15:00'}, 'Viernes': {from:'07:00',to:'15:00'} },
      services: [
        { title: 'Pre-matrícula', subtitle: 'Proceso de pre-inscripción', description: 'Cita para iniciar el proceso de pre-matrícula para el próximo año escolar. Traer documentos del alumno.', duration: 30, capacity: 2 },
        { title: 'Reunión padres', subtitle: 'Reunión con maestro', description: 'Cita para reunión entre padres de familia y maestro del grado para revisar rendimiento escolar.', duration: 20, capacity: 1 }
      ]
    },
    cleaning: {
      description: 'Empresa de limpieza y lavandería. Servicio residencial y empresarial con garantía de calidad.',
      address: 'Calle Delgado #33, Res. Altavista', city: 'San Salvador',
      phone: '+503 2200-9988', email: 'servicio@limpieza.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Lunes': {from:'07:00',to:'17:00'}, 'Martes': {from:'07:00',to:'17:00'}, 'Miércoles': {from:'07:00',to:'17:00'}, 'Jueves': {from:'07:00',to:'17:00'}, 'Viernes': {from:'07:00',to:'17:00'}, 'Sábado': {from:'07:00',to:'15:00'} },
      services: [
        { title: 'Limpieza básica', subtitle: 'Hogar o negocio', description: 'Servicio de limpieza general de interiores: barrer, trapear, limpiar superficies y baños.', duration: 120, capacity: 2 },
        { title: 'Lavandería', subtitle: 'Entrega de ropa para lavar', description: 'Cita para entrega y recepción de prendas de lavandería. Incluye lavado, secado y doblado.', duration: 30, capacity: 3 }
      ]
    },
    photography: {
      description: 'Estudio fotográfico profesional para retratos, eventos, productos y fotografía corporativa.',
      address: 'Pasaje los Pinos #8, Zona Rosa', city: 'San Salvador',
      phone: '+503 2277-3344', email: 'sesiones@fotografia.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: true,
      activeDays: { 'Martes': {from:'09:00',to:'18:00'}, 'Miércoles': {from:'09:00',to:'18:00'}, 'Jueves': {from:'09:00',to:'18:00'}, 'Viernes': {from:'09:00',to:'18:00'}, 'Sábado': {from:'09:00',to:'17:00'} },
      services: [
        { title: 'Sesión retrato', subtitle: 'Estudio o exterior', description: 'Sesión fotográfica de retrato individual o familiar en estudio o locación exterior. Incluye edición de 10 fotos.', duration: 60, capacity: 1 },
        { title: 'Fotos de producto', subtitle: 'Fotografía comercial', description: 'Sesión de fotografía de productos para catálogo, e-commerce o redes sociales. Hasta 20 productos.', duration: 120, capacity: 1 }
      ]
    },
    shipping: {
      description: 'Empresa de envíos y paquetería nacional. Servicio rápido, seguro y económico para personas y empresas.',
      address: 'Bulevar Constitución #102, Soyapango', city: 'San Salvador',
      phone: '+503 2299-1100', email: 'envios@paqueteria.com.sv', country: 'El Salvador',
      businessType: 'services', offersAppointments: false,
      activeDays: { 'Lunes': {from:'08:00',to:'17:00'}, 'Martes': {from:'08:00',to:'17:00'}, 'Miércoles': {from:'08:00',to:'17:00'}, 'Jueves': {from:'08:00',to:'17:00'}, 'Viernes': {from:'08:00',to:'17:00'}, 'Sábado': {from:'08:00',to:'12:00'} },
      services: []
    }
  };

  async fillDummyData(): Promise<void> {
    const industry = this.generalConfig.industry || 'services';
    const key = industry in this.DUMMY_TEMPLATES ? industry : 'services';
    const t = this.DUMMY_TEMPLATES[key];
    const name = this.generalConfig.orgName || 'Mi Empresa';

    this.generalInfo = { name, description: t.description };
    this.contactInfo = {
      address: t.address, city: t.city, phone: t.phone, email: t.email, country: t.country,
      showFields: { address: true, city: true, phone: true, email: true, country: true }
    };
    this.scheduleInfo.days = this.scheduleInfo.days.map((day: any) => {
      const shift = t.activeDays[day.name];
      return shift
        ? { name: day.name, active: true, shifts: [{ from: shift.from, to: shift.to }] }
        : { name: day.name, active: false, shifts: [{ from: '08:00', to: '17:00' }] };
    });
    this.scheduleInfo.businessType = t.businessType || 'services';
    this.scheduleInfo.offersAppointments = t.offersAppointments !== false;
    this.scheduleInfo.services = t.services ? [...t.services] : [];

    this.saving = true;
    try {
      await Promise.all([
        this.firebaseService.updateInfo('general', this.generalInfo),
        this.firebaseService.updateInfo('contact', this.contactInfo),
        this.firebaseService.updateInfo('schedule', this.scheduleInfo)
      ]);
      this.notice = 'Datos precargados — revisa y ajusta a tu gusto';
      setTimeout(() => this.notice = '', 5000);
    } catch (err) {
      this.error = 'Error al precargar datos';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  // ==================== SCHEDULE TAB ====================

  initSchedule(raw: any): void {
    const days = this.WEEK_DAYS.map(name => {
      const existing = raw?.days?.find((d: any) => d.name === name);
      return existing
        ? { name, active: !!existing.active, shifts: existing.shifts?.length ? [...existing.shifts] : [{ from: '08:00', to: '17:00' }] }
        : { name, active: false, shifts: [{ from: '08:00', to: '17:00' }] };
    });
    this.scheduleInfo = {
      days,
      slotDuration: raw?.slotDuration || 30,
      blockedDates: raw?.blockedDates || [],
      businessType: raw?.businessType || 'services',
      offersAppointments: raw?.offersAppointments !== false,
      services: raw?.services ? [...raw.services] : []
    };
  }

  hasActiveDays(): boolean {
    return this.scheduleInfo.days?.some((d: any) => d.active);
  }

  addShift(dayIndex: number): void {
    this.scheduleInfo.days[dayIndex].shifts.push({ from: '08:00', to: '17:00' });
  }

  removeShift(dayIndex: number, shiftIndex: number): void {
    const shifts = this.scheduleInfo.days[dayIndex].shifts;
    if (shifts.length > 1) shifts.splice(shiftIndex, 1);
  }

  addBlockedDate(): void {
    if (!this.newBlockedDate) return;
    if (!this.scheduleInfo.blockedDates.includes(this.newBlockedDate)) {
      this.scheduleInfo.blockedDates.push(this.newBlockedDate);
      this.scheduleInfo.blockedDates.sort();
    }
    this.newBlockedDate = '';
  }

  removeBlockedDate(date: string): void {
    this.scheduleInfo.blockedDates = this.scheduleInfo.blockedDates.filter((d: string) => d !== date);
  }

  formatBlockedDate(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
  }

  addService(): void {
    if (!this.newService.title?.trim()) return;
    if (!this.scheduleInfo.services) this.scheduleInfo.services = [];
    this.scheduleInfo.services.push({
      title: this.newService.title.trim().substring(0, 20),
      subtitle: (this.newService.subtitle || '').trim().substring(0, 70),
      description: (this.newService.description || '').trim().substring(0, 500),
      duration: this.newService.duration,
      capacity: this.newService.capacity || 1
    });
    this.newService = { title: '', subtitle: '', description: '', duration: 30, capacity: 1 };
  }

  removeService(index: number): void {
    this.scheduleInfo.services.splice(index, 1);
  }

  get scheduleNeedsServices(): boolean {
    return this.scheduleInfo.offersAppointments === true &&
      this.scheduleInfo.businessType !== 'products' &&
      !(this.scheduleInfo.services?.length > 0);
  }

  async saveScheduleInfo(): Promise<void> {
    if (this.scheduleNeedsServices) return;
    this.saving = true;
    try {
      await this.firebaseService.updateInfo('schedule', this.scheduleInfo);
      this.notice = 'Horarios de atención actualizados';
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al guardar horarios';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

}
