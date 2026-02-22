import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';
import { Unsubscribe } from 'firebase/firestore';

interface Conversation {
  id: string;
  phoneNumber: string;
  contactName?: string;
  lastMessageAt?: any;
  lastUserMessageMs?: number;
  unreadCount?: number;
  mode?: 'bot' | 'admin';
  modeAdminName?: string;
  session?: any;
}

interface ChatMessage {
  id: string;
  from: 'user' | 'bot' | 'admin';
  text: string;
  timestamp?: any;
  createdMs?: number;
  adminName?: string;
  adminEmail?: string;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;

  conversations: Conversation[] = [];
  filteredConversations: Conversation[] = [];
  selectedConversation: Conversation | null = null;
  messages: ChatMessage[] = [];
  newMessage = '';
  searchTerm = '';
  loading = true;
  sending = false;
  togglingMode = false;
  error = '';
  personalWhatsApp = '';
  botApiUrl = '';
  showSettings = false;
  settingsPhone = '';
  chatLiveAllowed = true;

  private convsUnsub: Unsubscribe | null = null;
  private msgsUnsub: Unsubscribe | null = null;
  private windowTimer: any = null;

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService
  ) {}

  async ngOnInit(): Promise<void> {
    this.chatLiveAllowed = this.authService.getPlanLimits().chatLive;
    await this.loadConfig();

    this.convsUnsub = this.firebaseService.onConversationsChange((convs) => {
      this.conversations = convs;
      this.applyFilter();
      this.loading = false;

      if (this.selectedConversation) {
        const updated = convs.find(c => c.id === this.selectedConversation!.id);
        if (updated) {
          this.selectedConversation = updated;
        }
      }
    });
  }

  ngOnDestroy(): void {
    if (this.convsUnsub) this.convsUnsub();
    if (this.msgsUnsub) this.msgsUnsub();
    if (this.windowTimer) clearInterval(this.windowTimer);
  }

  async loadConfig(): Promise<void> {
    try {
      const config = await this.firebaseService.getOrgConfig();
      this.personalWhatsApp = config?.personalWhatsApp || '';
      this.settingsPhone = this.personalWhatsApp;
      this.botApiUrl = config?.botApiUrl || this.authService.botApiUrl || (environment as any).defaultBotApiUrl || '';
    } catch (err) {
      console.error('Error loading config:', err);
    }
  }

  applyFilter(): void {
    const term = this.searchTerm.toLowerCase().trim();
    if (!term) {
      this.filteredConversations = [...this.conversations];
    } else {
      this.filteredConversations = this.conversations.filter(c =>
        (c.contactName || '').toLowerCase().includes(term) ||
        (c.phoneNumber || '').includes(term)
      );
    }
  }

  selectConversation(conv: Conversation): void {
    this.selectedConversation = conv;
    this.messages = [];
    this.error = '';

    if (this.msgsUnsub) this.msgsUnsub();
    if (this.windowTimer) clearInterval(this.windowTimer);

    this.msgsUnsub = this.firebaseService.onConversationMessages(
      conv.phoneNumber,
      (msgs) => {
        this.messages = msgs;
        setTimeout(() => this.scrollToBottom(), 100);
      }
    );

    this.firebaseService.markConversationRead(conv.phoneNumber).catch(() => {});

    this.windowTimer = setInterval(() => {}, 30000);
  }

  get currentMode(): string {
    return this.selectedConversation?.mode || 'bot';
  }

  get isAdminMode(): boolean {
    return this.currentMode === 'admin';
  }

  get isBotMode(): boolean {
    return this.currentMode === 'bot';
  }

  get sessionStep(): string {
    return this.selectedConversation?.session?.step || '';
  }

  get isInFlow(): boolean {
    const step = this.sessionStep;
    return step.startsWith('flow_');
  }

  get isWithin24h(): boolean {
    if (!this.selectedConversation?.lastUserMessageMs) return false;
    return (Date.now() - this.selectedConversation.lastUserMessageMs) < 24 * 60 * 60 * 1000;
  }

  get windowTimeLeft(): string {
    if (!this.selectedConversation?.lastUserMessageMs) return '';
    const expiresAt = this.selectedConversation.lastUserMessageMs + 24 * 60 * 60 * 1000;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return 'Expirada';
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }

  async takeControl(): Promise<void> {
    if (!this.selectedConversation || this.togglingMode) return;
    this.togglingMode = true;
    this.error = '';
    try {
      const user = this.authService.currentUser;
      const response = await fetch(`${this.botApiUrl}/api/take-control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: this.selectedConversation.phoneNumber,
          adminEmail: user?.email || '',
          adminName: user?.displayName || user?.email || 'Admin'
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        this.error = data.error || `Error del servidor (${response.status}). Reinicie el bot.`;
      }
    } catch (err) {
      this.error = 'No se pudo conectar con el bot. Verifique que esté activo y reiniciado.';
    } finally {
      this.togglingMode = false;
    }
  }

  async releaseToBot(): Promise<void> {
    if (!this.selectedConversation || this.togglingMode) return;
    this.togglingMode = true;
    this.error = '';
    try {
      const response = await fetch(`${this.botApiUrl}/api/release-to-bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: this.selectedConversation.phoneNumber
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        this.error = data.error || `Error del servidor (${response.status}).`;
      }
    } catch (err) {
      this.error = 'No se pudo conectar con el bot.';
    } finally {
      this.togglingMode = false;
    }
  }

  async sendMessage(): Promise<void> {
    if (!this.newMessage.trim() || !this.selectedConversation || this.sending) return;
    if (!this.isWithin24h) {
      this.error = 'La ventana de 24h expiró. Use WhatsApp personal.';
      return;
    }

    this.sending = true;
    this.error = '';
    const text = this.newMessage.trim();
    this.newMessage = '';

    try {
      const user = this.authService.currentUser;
      const response = await fetch(`${this.botApiUrl}/api/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: this.selectedConversation.phoneNumber,
          message: text,
          adminEmail: user?.email || '',
          adminName: user?.displayName || user?.email || 'Admin'
        })
      });

      const data = await response.json().catch(() => ({ ok: false, error: `Error HTTP ${response.status}` }));
      if (!data.ok) {
        if (data.error === '24h_window_expired') {
          this.error = 'La ventana de 24h expiró. Use WhatsApp personal para contactar.';
        } else {
          this.error = data.error || 'Error al enviar mensaje. Reinicie el bot.';
        }
        this.newMessage = text;
      }
    } catch (err: any) {
      this.error = 'No se pudo conectar con el bot. Verifique que esté activo y reiniciado.';
      this.newMessage = text;
    } finally {
      this.sending = false;
    }
  }

  getWhatsAppLink(phone: string): string {
    const wpPhone = this.personalWhatsApp || phone;
    return `https://wa.me/${wpPhone}`;
  }

  getContactDisplayName(conv: Conversation): string {
    return conv.contactName || this.formatPhone(conv.phoneNumber);
  }

  formatPhone(phone: string): string {
    if (!phone) return '';
    if (phone.length > 10) {
      return `+${phone.substring(0, phone.length - 10)} ${phone.substring(phone.length - 10)}`;
    }
    return phone;
  }

  formatTimestamp(ts: any): string {
    if (!ts) return '';
    let date: Date;
    if (ts.seconds) {
      date = new Date(ts.seconds * 1000);
    } else if (ts.toDate) {
      date = ts.toDate();
    } else {
      date = new Date(ts);
    }
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return 'Ahora';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return date.toLocaleDateString('es', { day: '2-digit', month: 'short' });
  }

  formatMessageTime(ts: any): string {
    if (!ts) return '';
    let date: Date;
    if (ts.seconds) {
      date = new Date(ts.seconds * 1000);
    } else if (ts.toDate) {
      date = ts.toDate();
    } else {
      date = new Date(ts);
    }
    return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }

  getTotalUnread(): number {
    return this.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  }

  getAdminModeCount(): number {
    return this.conversations.filter(c => c.mode === 'admin').length;
  }

  async saveSettings(): Promise<void> {
    try {
      await this.firebaseService.saveOrgConfig({ personalWhatsApp: this.settingsPhone });
      this.personalWhatsApp = this.settingsPhone;
      this.showSettings = false;
    } catch (err) {
      console.error('Error saving config:', err);
    }
  }

  onKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToBottom(): void {
    try {
      if (this.messagesContainer) {
        this.messagesContainer.nativeElement.scrollTop =
          this.messagesContainer.nativeElement.scrollHeight;
      }
    } catch (e) {}
  }
}
