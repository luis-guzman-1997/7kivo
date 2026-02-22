import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

interface BotMessage {
  id: string;
  key: string;
  label: string;
  category: string;
  content: string;
  description: string;
  [key: string]: any;
}

@Component({
  selector: 'app-bot-config',
  templateUrl: './bot-config.component.html',
  styleUrls: ['./bot-config.component.css']
})
export class BotConfigComponent implements OnInit {
  messages: BotMessage[] = [];
  contactInfo: any = {};
  scheduleInfo: any = { days: [] };
  generalInfo: any = {};
  config: any = {};

  loading = true;
  saving = false;
  saveNotice = '';
  saveError = '';
  activeTab = 'messages';

  editingMessageId: string | null = null;
  editContent = '';

  readonly WEEK_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  constructor(private firebaseService: FirebaseService) {}

  async ngOnInit(): Promise<void> {
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    this.loading = true;
    try {
      const [messages, contact, schedule, general, config] = await Promise.all([
        this.firebaseService.getBotMessages(),
        this.firebaseService.getInfo('contact'),
        this.firebaseService.getInfo('schedule'),
        this.firebaseService.getInfo('general'),
        this.firebaseService.getConfig()
      ]);

      this.messages = messages as BotMessage[];
      this.contactInfo = contact || {};
      this.generalInfo = general || {};
      this.config = config || {};
      this.initSchedule(schedule);
    } catch (err) {
      console.error('Error loading bot config:', err);
    } finally {
      this.loading = false;
    }
  }

  getCategories(): string[] {
    const cats = new Set(this.messages.map(m => m.category));
    return Array.from(cats);
  }

  getMessagesByCategory(category: string): BotMessage[] {
    return this.messages.filter(m => m.category === category);
  }

  getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      greeting: 'Saludo y Bienvenida',
      menu: 'Menú Principal',
      programs: 'Programas',
      schedule: 'Horarios',
      contact: 'Contacto',
      general: 'Información General',
      registration: 'Flujo de Registro',
      fallback: 'Mensajes por Defecto'
    };
    return labels[category] || category;
  }

  getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      greeting: 'fa-hand-wave',
      menu: 'fa-list',
      programs: 'fa-graduation-cap',
      schedule: 'fa-clock',
      contact: 'fa-address-book',
      general: 'fa-info-circle',
      registration: 'fa-clipboard-list',
      fallback: 'fa-comment-dots'
    };
    return icons[category] || 'fa-comment';
  }

  startEditing(msg: BotMessage): void {
    this.editingMessageId = msg.id;
    this.editContent = msg.content;
  }

  cancelEditing(): void {
    this.editingMessageId = null;
    this.editContent = '';
  }

  async saveBotMessage(msg: BotMessage): Promise<void> {
    this.saving = true;
    this.saveNotice = '';
    this.saveError = '';
    try {
      await this.firebaseService.updateBotMessage(msg.id, { content: this.editContent });
      msg.content = this.editContent;
      this.editingMessageId = null;
      this.saveNotice = `"${msg.label}" actualizado correctamente`;
      setTimeout(() => this.saveNotice = '', 3000);
    } catch (err) {
      this.saveError = 'Error al guardar';
      setTimeout(() => this.saveError = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  async saveContactInfo(): Promise<void> {
    this.saving = true;
    try {
      await this.firebaseService.updateInfo('contact', this.contactInfo);
      this.saveNotice = 'Información de contacto actualizada';
      setTimeout(() => this.saveNotice = '', 3000);
    } catch (err) {
      this.saveError = 'Error al guardar contacto';
      setTimeout(() => this.saveError = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  newBlockedDate = '';

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
      blockedDates: raw?.blockedDates || []
    };
  }

  hasActiveDays(): boolean {
    return this.scheduleInfo.days && this.scheduleInfo.days.some((d: any) => d.active);
  }

  addShift(dayIndex: number): void {
    this.scheduleInfo.days[dayIndex].shifts.push({ from: '08:00', to: '17:00' });
  }

  removeShift(dayIndex: number, shiftIndex: number): void {
    const shifts = this.scheduleInfo.days[dayIndex].shifts;
    if (shifts.length > 1) {
      shifts.splice(shiftIndex, 1);
    }
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

  async saveScheduleInfo(): Promise<void> {
    this.saving = true;
    try {
      await this.firebaseService.updateInfo('schedule', this.scheduleInfo);
      this.saveNotice = 'Horarios de atención actualizados';
      setTimeout(() => this.saveNotice = '', 3000);
    } catch (err) {
      this.saveError = 'Error al guardar horarios';
      setTimeout(() => this.saveError = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  async saveConfig(): Promise<void> {
    this.saving = true;
    try {
      await this.firebaseService.updateConfig(this.config);
      this.saveNotice = 'Configuración general actualizada';
      setTimeout(() => this.saveNotice = '', 3000);
    } catch (err) {
      this.saveError = 'Error al guardar configuración';
      setTimeout(() => this.saveError = '', 3000);
    } finally {
      this.saving = false;
    }
  }
}
