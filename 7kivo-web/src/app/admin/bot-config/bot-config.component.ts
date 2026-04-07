import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

interface BotMessage {
  id: string;
  key: string;
  label: string;
  category: string;
  content: string;
  description: string;
  [key: string]: any;
}

interface Keyword {
  id: string;
  keyword: string;
  response: string;
  matchType: 'contains' | 'exact';
  active: boolean;
}

@Component({
  selector: 'app-bot-config',
  templateUrl: './bot-config.component.html',
  styleUrls: ['./bot-config.component.css']
})
export class BotConfigComponent implements OnInit {
  messages: BotMessage[] = [];
  config: any = {};

  loading = true;
  saving = false;
  saveNotice = '';
  saveError = '';
  activeTab = 'messages';

  editingMessageId: string | null = null;
  editContent = '';
  showNewMsgForm = false;
  newMsg = { key: '', label: '', category: 'general', content: '', description: '' };

  // Keywords tab
  keywords: Keyword[] = [];
  editingKeywordId: string | null = null;
  editKw: Keyword = this.emptyKeyword();
  newKw: Keyword = this.emptyKeyword();
  showNewKwForm = false;

  constructor(private firebaseService: FirebaseService, public authService: AuthService) {}

  async ngOnInit(): Promise<void> {
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    this.loading = true;
    try {
      const [messages, config, keywords] = await Promise.all([
        this.firebaseService.getBotMessages(),
        this.firebaseService.getConfig(),
        this.firebaseService.getKeywords()
      ]);

      this.messages = messages as BotMessage[];
      this.config = config || {};
      this.keywords = keywords as Keyword[];
    } catch (err) {
      console.error('Error loading bot config:', err);
    } finally {
      this.loading = false;
    }
  }

  emptyKeyword(): Keyword {
    return { id: 'kw_' + Date.now(), keyword: '', response: '', matchType: 'contains', active: true };
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

  readonly DEFAULT_MESSAGES = [
    { key: 'greeting', label: 'Saludo principal', category: 'greeting', description: 'Mensaje de bienvenida', content: '¡Hola{name}! 👋\n\nBienvenido. ¿Cómo podemos ayudarte?' },
    { key: 'fallback', label: 'Mensaje no reconocido', category: 'fallback', description: 'Cuando el bot no entiende', content: 'No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones.' },
    { key: 'goodbye', label: 'Despedida', category: 'general', description: 'Cuando el usuario se despide', content: '¡Hasta pronto! Escribe *hola* cuando quieras volver.' },
    { key: 'session_expired', label: 'Sesión expirada', category: 'general', description: 'Cierre por inactividad', content: 'Tu sesión se cerró por inactividad.\n\nEscribe *hola* cuando quieras retomar.' },
    { key: 'cancel', label: 'Cancelación', category: 'general', description: 'Cuando cancela un proceso', content: 'Proceso cancelado. Escribe *hola* para volver al menú.' },
    { key: 'flow_cancel_hint', label: 'Aviso de cancelación', category: 'flow', description: 'Al iniciar un flujo', content: 'Puedes escribir *cancelar* en cualquier momento para detener este proceso.\n' },
    { key: 'admin_farewell', label: 'Despedida de admin', category: 'admin', description: 'Cuando admin devuelve control', content: 'La conversación con nuestro equipo ha finalizado.\n\nEscribe *hola* para ver el menú.' },
    { key: 'no_registration', label: 'Registro no disponible', category: 'flow', description: 'Sin flujo de registro', content: 'El registro no está disponible en este momento.\n\nEscribe *hola* para ver otras opciones.' }
  ];

  async generateDefaults(): Promise<void> {
    this.saving = true;
    try {
      const existingKeys = this.messages.map(m => m.key);
      let added = 0;
      for (const msg of this.DEFAULT_MESSAGES) {
        if (!existingKeys.includes(msg.key)) {
          await this.firebaseService.addBotMessage(msg);
          added++;
        }
      }
      await this.loadAll();
      this.saveNotice = added > 0 ? `${added} mensaje(s) creados` : 'Todos los mensajes ya existen';
      setTimeout(() => this.saveNotice = '', 3000);
    } catch (err) {
      this.saveError = 'Error al generar mensajes';
      setTimeout(() => this.saveError = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  async addNewMessage(): Promise<void> {
    if (!this.newMsg.key.trim() || !this.newMsg.label.trim() || !this.newMsg.content.trim()) return;
    this.saving = true;
    try {
      await this.firebaseService.addBotMessage(this.newMsg);
      this.newMsg = { key: '', label: '', category: 'general', content: '', description: '' };
      this.showNewMsgForm = false;
      await this.loadAll();
      this.saveNotice = 'Mensaje creado';
      setTimeout(() => this.saveNotice = '', 3000);
    } catch (err) {
      this.saveError = 'Error al crear mensaje';
      setTimeout(() => this.saveError = '', 3000);
    } finally {
      this.saving = false;
    }
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

  // ==================== KEYWORDS ====================

  addKeyword(): void {
    if (!this.newKw.keyword.trim() || !this.newKw.response.trim()) return;
    this.keywords.push({ ...this.newKw, id: 'kw_' + Date.now() });
    this.newKw = this.emptyKeyword();
    this.showNewKwForm = false;
    this.persistKeywords('Palabra clave agregada');
  }

  startEditKeyword(kw: Keyword): void {
    this.editingKeywordId = kw.id;
    this.editKw = { ...kw };
  }

  saveEditKeyword(): void {
    if (!this.editKw.keyword.trim() || !this.editKw.response.trim()) return;
    const idx = this.keywords.findIndex(k => k.id === this.editingKeywordId);
    if (idx >= 0) this.keywords[idx] = { ...this.editKw };
    this.editingKeywordId = null;
    this.persistKeywords('Palabra clave actualizada');
  }

  cancelEditKeyword(): void {
    this.editingKeywordId = null;
  }

  deleteKeyword(id: string): void {
    this.keywords = this.keywords.filter(k => k.id !== id);
    this.persistKeywords('Palabra clave eliminada');
  }

  toggleKeyword(kw: Keyword): void {
    kw.active = !kw.active;
    this.persistKeywords(kw.active ? 'Keyword activada' : 'Keyword desactivada');
  }

  private async persistKeywords(notice: string): Promise<void> {
    this.saving = true;
    try {
      await this.firebaseService.saveKeywords(this.keywords);
      this.saveNotice = notice;
      setTimeout(() => this.saveNotice = '', 3000);
    } catch {
      this.saveError = 'Error al guardar keywords';
      setTimeout(() => this.saveError = '', 3000);
    } finally {
      this.saving = false;
    }
  }
}
