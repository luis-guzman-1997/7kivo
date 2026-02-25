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
  newService: any = { title: '', subtitle: '', description: '', duration: 30 };

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
      technology: 'Tecnología', general: 'General', other: 'General'
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
        { title: 'Consultoría Tech', subtitle: 'Análisis de necesidades tecnológicas', description: 'Consultoría para analizar tu situación tecnológica actual, identificar oportunidades de mejora y proponer soluciones digitales a medida para tu negocio.', duration: 60 },
        { title: 'Soporte Técnico', subtitle: 'Resolución de problemas técnicos', description: 'Sesión de soporte para resolver problemas, configurar sistemas o capacitar al equipo en el uso eficiente de herramientas y plataformas digitales.', duration: 45 }
      ]
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
      duration: this.newService.duration
    });
    this.newService = { title: '', subtitle: '', description: '', duration: 30 };
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
