import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

interface DeliveryItem {
  id?: string;
  flowId: string;
  nombre: string;
  descripcion: string;
  precio: number | null;
  imagen: string;
  categoria: string;
  disponible: boolean;
  stockLimitado: boolean;
  stock: number | null;
}

@Component({
  selector: 'app-webdelivery',
  templateUrl: './webdelivery.component.html',
  styleUrls: ['./webdelivery.component.css']
})
export class WebDeliveryComponent implements OnInit {
  flows: any[] = [];
  selectedFlow: any = null;
  items: any[] = [];

  loading = true;
  saving = false;
  notice = '';
  error = '';

  showForm = false;
  editingId: string | null = null;
  form: DeliveryItem = this.emptyForm();

  imageFile: File | null = null;
  imagePreview = '';
  uploadingImage = false;

  filterCategory = '';
  filterText = '';

  storeCategories: string[] = [];
  newCategoryInput = '';
  savingCategory = false;
  showCategoryModal = false;

  deleteTarget: any = null;

  activeSection: 'productos' | 'config' = 'productos';

  storeLogoFile: File | null = null;
  storeLogoPreview = '';
  savingLogo = false;

  storeColor = '#2e7d32';
  colorChanged = false;
  savingColor = false;

  colorPresets = [
    { name: 'Verde',    hex: '#2e7d32' },
    { name: 'Rojo',     hex: '#c62828' },
    { name: 'Azul',     hex: '#1565c0' },
    { name: 'Naranja',  hex: '#e65100' },
    { name: 'Morado',   hex: '#6a1b9a' },
    { name: 'Turquesa', hex: '#00695c' },
    { name: 'Rosa',     hex: '#ad1457' },
    { name: 'Café',     hex: '#4e342e' },
    { name: 'Negro',    hex: '#212121' },
  ];

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadFlows();
  }

  emptyForm(flowId = ''): DeliveryItem {
    return {
      flowId,
      nombre: '', descripcion: '', precio: null,
      imagen: '', categoria: '', disponible: true,
      stockLimitado: false, stock: null
    };
  }

  async loadFlows(): Promise<void> {
    this.loading = true;
    try {
      const all = await this.firebaseService.getFlows();
      let webFlows = all.filter((f: any) => f.webStoreEnabled === true);

      const role = this.authService.userRole;
      const fullAccess = role === 'owner' || role === 'admin' || role === 'editor' || role === 'superadmin';
      if (!fullAccess) {
        const uid = this.authService.currentUser?.uid;
        if (uid) {
          const adminDoc = await this.firebaseService.getAdminByUid(uid);
          const assigned: string[] = adminDoc?.assignedWebFlows || [];
          if (assigned.length > 0) {
            webFlows = webFlows.filter((f: any) => assigned.includes(f.id));
          }
        }
      }

      this.flows = webFlows;
      if (this.flows.length > 0) await this.selectFlow(this.flows[0]);
    } catch {
      this.error = 'Error al cargar flujos';
    } finally {
      this.loading = false;
    }
  }

  async selectFlow(flow: any): Promise<void> {
    this.selectedFlow = flow;
    this.showForm = false;
    this.filterCategory = '';
    this.filterText = '';
    this.storeLogoFile = null;
    this.storeLogoPreview = flow.storeImage || '';
    this.storeColor = flow.storeColor || '#2e7d32';
    this.colorChanged = false;
    this.storeCategories = flow.storeCategories || [];
    this.newCategoryInput = '';
    await this.loadItems();
    // Sync público automático para que la tienda web refleje el estado actual
    this.firebaseService.syncPublicStore(flow.id).catch(() => {});
  }

  async loadItems(): Promise<void> {
    if (!this.selectedFlow) return;
    try {
      this.items = await this.firebaseService.getWebDeliveryItems(this.selectedFlow.id);
    } catch {
      this.error = 'Error al cargar productos';
      setTimeout(() => this.error = '', 3000);
    }
  }

  get filteredItems(): any[] {
    return this.items.filter(i => {
      const matchCat  = !this.filterCategory || (i.categoria || '') === this.filterCategory;
      const matchText = !this.filterText || (i.nombre || '').toLowerCase().includes(this.filterText.toLowerCase());
      return matchCat && matchText;
    });
  }

  openNew(): void {
    this.form = this.emptyForm(this.selectedFlow?.id || '');
    this.editingId = null;
    this.imageFile = null;
    this.imagePreview = '';
    this.showForm = true;
    setTimeout(() => document.getElementById('wd-nombre')?.focus(), 50);
  }

  openEdit(item: any): void {
    this.form = {
      flowId:       item.flowId       || this.selectedFlow?.id || '',
      nombre:       item.nombre       || '',
      descripcion:  item.descripcion  || '',
      precio:       item.precio       ?? null,
      imagen:       item.imagen       || '',
      categoria:    item.categoria    || '',
      disponible:   item.disponible   !== false,
      stockLimitado:item.stockLimitado === true,
      stock:        item.stock        ?? null,
    };
    this.editingId = item.id;
    this.imageFile = null;
    this.imagePreview = item.imagen || '';
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.editingId = null;
    this.imageFile = null;
    this.imagePreview = '';
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.[0]) return;
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
      this.error = 'La imagen no debe superar 5 MB';
      setTimeout(() => this.error = '', 3000);
      return;
    }
    this.imageFile = file;
    const reader = new FileReader();
    reader.onload = e => { this.imagePreview = e.target!.result as string; };
    reader.readAsDataURL(file);
  }

  clearImage(): void {
    this.imageFile = null;
    this.imagePreview = '';
    this.form.imagen = '';
  }

  async save(): Promise<void> {
    if (!this.form.nombre.trim()) {
      this.error = 'El nombre es obligatorio';
      setTimeout(() => this.error = '', 3000);
      return;
    }
    if (this.form.precio === null || this.form.precio === undefined || this.form.precio < 0) {
      this.error = 'El precio es obligatorio';
      setTimeout(() => this.error = '', 3000);
      return;
    }
    this.saving = true;
    try {
      if (this.imageFile) {
        this.uploadingImage = true;
        const orgId = this.firebaseService.getOrgId();
        const ext = this.imageFile.name.split('.').pop() || 'jpg';
        const path = `organizations/${orgId}/webdelivery/${Date.now()}.${ext}`;
        this.form.imagen = await this.firebaseService.uploadFileByPath(this.imageFile, path);
        this.uploadingImage = false;
      }

      const data = {
        ...this.form,
        stock: this.form.stockLimitado ? (this.form.stock || 0) : null,
      };

      if (this.editingId) {
        await this.firebaseService.updateWebDeliveryItem(this.editingId, data);
        this.notice = 'Producto actualizado';
      } else {
        await this.firebaseService.addWebDeliveryItem(this.selectedFlow.id, data);
        this.notice = 'Producto creado';
      }

      await this.loadItems();
      await this.firebaseService.syncPublicStore(this.selectedFlow.id);
      this.closeForm();
      setTimeout(() => this.notice = '', 3000);
    } catch {
      this.error = 'Error al guardar';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
      this.uploadingImage = false;
    }
  }

  async toggleDisponible(item: any): Promise<void> {
    const newVal = item.disponible === false;
    try {
      await this.firebaseService.updateWebDeliveryItem(item.id, { disponible: newVal });
      item.disponible = newVal;
      this.firebaseService.syncPublicStore(this.selectedFlow.id).catch(() => {});
    } catch {
      this.error = 'Error al actualizar';
      setTimeout(() => this.error = '', 3000);
    }
  }

  confirmDelete(item: any): void { this.deleteTarget = item; }

  async deleteItem(): Promise<void> {
    if (!this.deleteTarget) return;
    try {
      await this.firebaseService.deleteWebDeliveryItem(this.deleteTarget.id);
      this.items = this.items.filter(i => i.id !== this.deleteTarget.id);
      this.firebaseService.syncPublicStore(this.selectedFlow.id).catch(() => {});
      this.deleteTarget = null;
      this.notice = 'Producto eliminado';
      setTimeout(() => this.notice = '', 3000);
    } catch {
      this.error = 'Error al eliminar';
      setTimeout(() => this.error = '', 3000);
    }
  }

  async addCategory(): Promise<void> {
    const cat = this.newCategoryInput.trim();
    if (!cat || this.storeCategories.includes(cat)) return;
    this.savingCategory = true;
    try {
      const updated = [...this.storeCategories, cat];
      await this.firebaseService.updateFlow(this.selectedFlow.id, { storeCategories: updated });
      this.selectedFlow.storeCategories = updated;
      this.storeCategories = updated;
      this.newCategoryInput = '';
    } catch { this.error = 'Error al guardar categoría'; setTimeout(() => this.error = '', 3000); }
    finally { this.savingCategory = false; }
  }

  async removeCategory(cat: string): Promise<void> {
    const updated = this.storeCategories.filter(c => c !== cat);
    try {
      await this.firebaseService.updateFlow(this.selectedFlow.id, { storeCategories: updated });
      this.selectedFlow.storeCategories = updated;
      this.storeCategories = updated;
      if (this.filterCategory === cat) this.filterCategory = '';
    } catch { this.error = 'Error al eliminar categoría'; setTimeout(() => this.error = '', 3000); }
  }

  onStoreLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.[0]) return;
    const file = input.files[0];
    if (file.size > 3 * 1024 * 1024) {
      this.error = 'El logo no debe superar 3 MB';
      setTimeout(() => this.error = '', 3000);
      return;
    }
    this.storeLogoFile = file;
    const reader = new FileReader();
    reader.onload = e => { this.storeLogoPreview = e.target!.result as string; };
    reader.readAsDataURL(file);
  }

  async saveStoreLogo(): Promise<void> {
    if (!this.storeLogoFile || !this.selectedFlow) return;
    this.savingLogo = true;
    try {
      const orgId = this.firebaseService.getOrgId();
      const ext = this.storeLogoFile.name.split('.').pop() || 'jpg';
      const path = `organizations/${orgId}/store-logos/${this.selectedFlow.id}.${ext}`;
      const url = await this.firebaseService.uploadFileByPath(this.storeLogoFile, path);
      await this.firebaseService.updateFlow(this.selectedFlow.id, { storeImage: url });
      this.selectedFlow.storeImage = url;
      this.storeLogoPreview = url;
      this.storeLogoFile = null;
      await this.firebaseService.syncPublicStore(this.selectedFlow.id);
      this.notice = 'Logo guardado';
      setTimeout(() => this.notice = '', 2000);
    } catch {
      this.error = 'Error al guardar el logo';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.savingLogo = false;
    }
  }

  onColorChange(): void { this.colorChanged = true; }

  darkenColor(hex: string, amount = 30): string {
    const n = parseInt(hex.replace('#',''), 16);
    const r = Math.max(0, (n >> 16) - amount);
    const g = Math.max(0, ((n >> 8) & 0xff) - amount);
    const b = Math.max(0, (n & 0xff) - amount);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }

  async saveStoreColor(): Promise<void> {
    if (!this.selectedFlow) return;
    this.savingColor = true;
    try {
      await this.firebaseService.updateFlow(this.selectedFlow.id, { storeColor: this.storeColor });
      this.selectedFlow.storeColor = this.storeColor;
      await this.firebaseService.syncPublicStore(this.selectedFlow.id);
      this.colorChanged = false;
      this.notice = 'Color guardado';
      setTimeout(() => this.notice = '', 2000);
    } catch {
      this.error = 'Error al guardar el color';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.savingColor = false;
    }
  }

  async removeStoreLogo(): Promise<void> {
    if (!this.selectedFlow) return;
    await this.firebaseService.updateFlow(this.selectedFlow.id, { storeImage: '' });
    this.selectedFlow.storeImage = '';
    this.storeLogoPreview = '';
    this.storeLogoFile = null;
    this.firebaseService.syncPublicStore(this.selectedFlow.id).catch(() => {});
  }

  getStoreUrl(flow: any): string {
    const orgId = this.firebaseService.getOrgId();
    return `${window.location.origin}/tienda/${orgId}/${flow.id}`;
  }

  async copyUrl(flow: any): Promise<void> {
    await navigator.clipboard.writeText(this.getStoreUrl(flow));
    this.notice = 'URL copiada';
    setTimeout(() => this.notice = '', 2000);
  }
}
