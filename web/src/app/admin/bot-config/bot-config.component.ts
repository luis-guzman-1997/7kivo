import { Component, OnInit, ElementRef } from '@angular/core';
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
  programs: any[] = [];

  loading = true;
  saving = false;
  saveNotice = '';
  saveError = '';
  activeTab = 'messages';

  editingMessageId: string | null = null;
  editContent = '';

  showProgramForm = false;
  editingProgramId: string | null = null;
  programForm: any = { name: '', age: '', duration: '', focus: '', ageNote: '', note: '', includes: '', active: true, order: 0 };

  constructor(private firebaseService: FirebaseService, private el: ElementRef) {}

  async ngOnInit(): Promise<void> {
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    this.loading = true;
    try {
      const [messages, contact, schedule, general, config, programs] = await Promise.all([
        this.firebaseService.getBotMessages(),
        this.firebaseService.getInfo('contact'),
        this.firebaseService.getInfo('schedule'),
        this.firebaseService.getInfo('general'),
        this.firebaseService.getConfig(),
        this.firebaseService.getPrograms()
      ]);

      this.messages = messages as BotMessage[];
      this.contactInfo = contact || {};
      this.scheduleInfo = schedule || {};
      this.generalInfo = general || {};
      this.config = config || {};
      this.programs = programs;
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

  async saveProgram(program: any): Promise<void> {
    this.saving = true;
    try {
      const { id, ...data } = program;
      await this.firebaseService.updateProgram(id, data);
      this.saveNotice = `Programa "${program.name}" actualizado`;
      setTimeout(() => this.saveNotice = '', 3000);
    } catch (err) {
      this.saveError = 'Error al guardar programa';
      setTimeout(() => this.saveError = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  openNewProgram(): void {
    this.showProgramForm = true;
    this.editingProgramId = null;
    this.programForm = { name: '', age: '', duration: '', focus: '', ageNote: '', note: '', includes: '', active: true, order: this.programs.length + 1 };
    this.scrollToProgramForm();
  }

  openEditProgram(program: any): void {
    this.showProgramForm = true;
    this.editingProgramId = program.id;
    this.programForm = {
      name: program.name || '',
      age: program.age || '',
      duration: program.duration || '',
      focus: program.focus || '',
      ageNote: program.ageNote || '',
      note: program.note || '',
      includes: Array.isArray(program.includes) ? program.includes.join('\n') : '',
      active: program.active !== false,
      order: program.order || 0
    };
    this.scrollToProgramForm();
  }

  private scrollToProgramForm(): void {
    setTimeout(() => {
      const formEl = this.el.nativeElement.querySelector('.program-form-section');
      if (formEl) {
        formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  }

  closeProgramForm(): void {
    this.showProgramForm = false;
    this.editingProgramId = null;
  }

  async submitProgram(): Promise<void> {
    if (!this.programForm.name.trim()) {
      this.saveError = 'El nombre del programa es requerido';
      setTimeout(() => this.saveError = '', 3000);
      return;
    }

    this.saving = true;
    try {
      const data = {
        name: this.programForm.name.trim(),
        age: this.programForm.age.trim(),
        duration: this.programForm.duration.trim(),
        focus: this.programForm.focus.trim(),
        ageNote: this.programForm.ageNote.trim(),
        note: this.programForm.note.trim(),
        includes: this.programForm.includes ? this.programForm.includes.split('\n').map((s: string) => s.trim()).filter((s: string) => s) : [],
        active: this.programForm.active,
        order: this.programForm.order || 0
      };

      if (this.editingProgramId) {
        await this.firebaseService.updateProgram(this.editingProgramId, data);
        this.saveNotice = `Programa "${data.name}" actualizado`;
      } else {
        await this.firebaseService.addProgram(data);
        this.saveNotice = `Programa "${data.name}" creado`;
      }

      this.closeProgramForm();
      await this.loadAll();
      setTimeout(() => this.saveNotice = '', 3000);
    } catch (err) {
      this.saveError = 'Error al guardar programa';
      setTimeout(() => this.saveError = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  async deleteProgram(program: any): Promise<void> {
    if (!confirm(`¿Eliminar el programa "${program.name}"?`)) return;

    this.saving = true;
    try {
      await this.firebaseService.deleteProgram(program.id);
      this.saveNotice = `Programa "${program.name}" eliminado`;
      await this.loadAll();
      setTimeout(() => this.saveNotice = '', 3000);
    } catch (err) {
      this.saveError = 'Error al eliminar programa';
      setTimeout(() => this.saveError = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  async toggleProgramActive(program: any): Promise<void> {
    try {
      await this.firebaseService.updateProgram(program.id, { active: !program.active });
      program.active = !program.active;
      this.saveNotice = `Programa "${program.name}" ${program.active ? 'activado' : 'desactivado'}`;
      setTimeout(() => this.saveNotice = '', 3000);
    } catch (err) {
      this.saveError = 'Error al actualizar programa';
      setTimeout(() => this.saveError = '', 3000);
    }
  }
}
