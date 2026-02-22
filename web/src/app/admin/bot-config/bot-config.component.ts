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
  scheduleInfo: any = {};
  generalInfo: any = {};
  config: any = {};

  loading = true;
  saving = false;
  saveNotice = '';
  saveError = '';
  activeTab = 'messages';

  editingMessageId: string | null = null;
  editContent = '';

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
      this.scheduleInfo = schedule || {};
      this.generalInfo = general || {};
      this.config = config || {};
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

  async saveScheduleInfo(): Promise<void> {
    this.saving = true;
    try {
      await this.firebaseService.updateInfo('schedule', this.scheduleInfo);
      this.saveNotice = 'Información de horarios actualizada';
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
