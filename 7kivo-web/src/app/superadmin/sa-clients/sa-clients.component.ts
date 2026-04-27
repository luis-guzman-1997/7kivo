import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

interface Client { name: string; logo: string; }

@Component({
  selector: 'app-sa-clients',
  templateUrl: './sa-clients.component.html',
  styleUrls: ['./sa-clients.component.css']
})
export class SaClientsComponent implements OnInit {
  clients: Client[] = [];
  loading = true;
  saving = false;
  notice = '';

  newName = '';
  newLogoFile: File | null = null;
  newLogoPreview = '';
  uploadingLogo = false;

  constructor(private firebaseService: FirebaseService) {}

  async ngOnInit(): Promise<void> {
    this.clients = await this.firebaseService.getPlatformClients();
    this.loading = false;
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.[0]) return;
    const file = input.files[0];
    if (file.size > 3 * 1024 * 1024) { this.showNotice('La imagen no debe superar 3 MB'); return; }
    this.newLogoFile = file;
    const reader = new FileReader();
    reader.onload = e => { this.newLogoPreview = e.target!.result as string; };
    reader.readAsDataURL(file);
  }

  clearLogo(): void {
    this.newLogoFile = null;
    this.newLogoPreview = '';
  }

  async addClient(): Promise<void> {
    if (!this.newName.trim()) return;
    this.uploadingLogo = true;
    let logoUrl = '';
    try {
      if (this.newLogoFile) {
        const ext = this.newLogoFile.name.split('.').pop() || 'jpg';
        const path = `platform/clients/${Date.now()}.${ext}`;
        logoUrl = await this.firebaseService.uploadFileByPath(this.newLogoFile, path);
      }
      const updated = [...this.clients, { name: this.newName.trim(), logo: logoUrl }];
      await this.firebaseService.savePlatformClients(updated);
      this.clients = updated;
      this.newName = '';
      this.clearLogo();
      this.showNotice('Cliente agregado');
    } catch (e) { this.showNotice('Error al agregar'); }
    finally { this.uploadingLogo = false; }
  }

  async removeClient(i: number): Promise<void> {
    const updated = this.clients.filter((_, idx) => idx !== i);
    try {
      await this.firebaseService.savePlatformClients(updated);
      this.clients = updated;
      this.showNotice('Cliente eliminado');
    } catch { this.showNotice('Error al eliminar'); }
  }

  async moveUp(i: number): Promise<void> {
    if (i === 0) return;
    const arr = [...this.clients];
    [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    await this.firebaseService.savePlatformClients(arr);
    this.clients = arr;
  }

  async moveDown(i: number): Promise<void> {
    if (i >= this.clients.length - 1) return;
    const arr = [...this.clients];
    [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    await this.firebaseService.savePlatformClients(arr);
    this.clients = arr;
  }

  private showNotice(msg: string): void {
    this.notice = msg;
    setTimeout(() => this.notice = '', 3000);
  }
}
