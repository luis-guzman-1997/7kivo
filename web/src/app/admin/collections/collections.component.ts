import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

interface CollectionField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  refCollection?: string;
  options?: string[];
}

interface CollectionDef {
  id?: string;
  name: string;
  slug: string;
  description: string;
  displayField: string;
  fields: CollectionField[];
}

@Component({
  selector: 'app-collections',
  templateUrl: './collections.component.html',
  styleUrls: ['./collections.component.css']
})
export class CollectionsComponent implements OnInit {
  collections: CollectionDef[] = [];
  loading = true;
  saving = false;
  notice = '';
  error = '';

  view: 'list' | 'schema' | 'data' = 'list';
  currentCollection: CollectionDef = this.emptyCollection();
  activeTab: 'schema' | 'data' = 'schema';

  collectionData: any[] = [];
  dataLoading = false;
  showItemForm = false;
  editingItemId: string | null = null;
  itemForm: Record<string, any> = {};

  fieldTypes = [
    { value: 'text', label: 'Texto' },
    { value: 'number', label: 'Número' },
    { value: 'boolean', label: 'Sí/No' },
    { value: 'date', label: 'Fecha' },
    { value: 'list', label: 'Lista (valores separados)' },
    { value: 'select', label: 'Selección (opciones fijas)' },
    { value: 'reference', label: 'Referencia a otra colección' }
  ];

  constructor(private firebaseService: FirebaseService) {}

  async ngOnInit(): Promise<void> {
    await this.loadCollections();
  }

  emptyCollection(): CollectionDef {
    return { name: '', slug: '', description: '', displayField: '', fields: [] };
  }

  async loadCollections(): Promise<void> {
    this.loading = true;
    try {
      this.collections = await this.firebaseService.getCollectionDefs();
    } catch (err) {
      console.error('Error loading collections:', err);
      this.error = 'Error al cargar colecciones';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.loading = false;
    }
  }

  // ==================== LIST VIEW ====================

  openNewCollection(): void {
    this.currentCollection = this.emptyCollection();
    this.view = 'schema';
    this.activeTab = 'schema';
  }

  openCollection(col: CollectionDef): void {
    this.currentCollection = JSON.parse(JSON.stringify(col));
    this.view = 'schema';
    this.activeTab = 'schema';
    this.loadCollectionData();
  }

  backToList(): void {
    this.view = 'list';
    this.showItemForm = false;
    this.editingItemId = null;
  }

  generateSlug(): void {
    if (!this.currentCollection.id && this.currentCollection.name) {
      this.currentCollection.slug = this.currentCollection.name
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/(^_|_$)/g, '');
    }
  }

  // ==================== SCHEMA ====================

  addField(): void {
    this.currentCollection.fields.push({
      key: '', label: '', type: 'text', required: false
    });
  }

  removeField(index: number): void {
    this.currentCollection.fields.splice(index, 1);
  }

  moveFieldUp(index: number): void {
    if (index <= 0) return;
    const f = this.currentCollection.fields;
    [f[index - 1], f[index]] = [f[index], f[index - 1]];
  }

  moveFieldDown(index: number): void {
    if (index >= this.currentCollection.fields.length - 1) return;
    const f = this.currentCollection.fields;
    [f[index], f[index + 1]] = [f[index + 1], f[index]];
  }

  generateFieldKey(field: CollectionField): void {
    if (field.label && !field.key) {
      field.key = field.label
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/(^_|_$)/g, '');
    }
  }

  getOtherCollections(): CollectionDef[] {
    return this.collections.filter(c => c.slug !== this.currentCollection.slug);
  }

  async saveSchema(): Promise<void> {
    if (!this.currentCollection.name.trim()) {
      this.error = 'El nombre de la colección es requerido';
      setTimeout(() => this.error = '', 3000);
      return;
    }
    if (!this.currentCollection.slug.trim()) {
      this.error = 'El slug es requerido';
      setTimeout(() => this.error = '', 3000);
      return;
    }

    if (!this.currentCollection.displayField && this.currentCollection.fields.length > 0) {
      this.currentCollection.displayField = this.currentCollection.fields[0].key;
    }

    this.saving = true;
    try {
      const data: any = { ...this.currentCollection };
      const savedId = await this.firebaseService.saveCollectionDef(data);
      if (!this.currentCollection.id) {
        this.currentCollection.id = savedId;
      }
      this.notice = `Colección "${data.name}" guardada`;
      await this.loadCollections();
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al guardar colección';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  async deleteCollection(): Promise<void> {
    if (!this.currentCollection.id) return;
    if (!confirm(`¿Eliminar la colección "${this.currentCollection.name}" y su definición?\n\nNota: los datos guardados en "${this.currentCollection.slug}" NO se eliminarán automáticamente.`)) return;

    this.saving = true;
    try {
      await this.firebaseService.deleteCollectionDef(this.currentCollection.id);
      this.notice = `Colección "${this.currentCollection.name}" eliminada`;
      await this.loadCollections();
      this.backToList();
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al eliminar colección';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  // ==================== DATA MANAGEMENT ====================

  async loadCollectionData(): Promise<void> {
    if (!this.currentCollection.slug) return;
    this.dataLoading = true;
    try {
      this.collectionData = await this.firebaseService.getCollectionData(this.currentCollection.slug);
    } catch (err) {
      console.error('Error loading collection data:', err);
    } finally {
      this.dataLoading = false;
    }
  }

  openNewItem(): void {
    this.showItemForm = true;
    this.editingItemId = null;
    this.itemForm = {};
    for (const field of this.currentCollection.fields) {
      if (field.type === 'boolean') {
        this.itemForm[field.key] = false;
      } else if (field.type === 'number') {
        this.itemForm[field.key] = null;
      } else {
        this.itemForm[field.key] = '';
      }
    }
  }

  openEditItem(item: any): void {
    this.showItemForm = true;
    this.editingItemId = item.id;
    this.itemForm = {};
    for (const field of this.currentCollection.fields) {
      const val = item[field.key];
      if (field.type === 'list' && Array.isArray(val)) {
        this.itemForm[field.key] = val.join('\n');
      } else {
        this.itemForm[field.key] = val ?? (field.type === 'boolean' ? false : '');
      }
    }
  }

  cancelItemForm(): void {
    this.showItemForm = false;
    this.editingItemId = null;
  }

  async submitItem(): Promise<void> {
    this.saving = true;
    try {
      const data: Record<string, any> = {};
      for (const field of this.currentCollection.fields) {
        let val = this.itemForm[field.key];
        if (field.type === 'number' && val !== null && val !== '') {
          val = Number(val);
        } else if (field.type === 'boolean') {
          val = !!val;
        } else if (field.type === 'list' && typeof val === 'string') {
          val = val.split('\n').map((s: string) => s.trim()).filter((s: string) => s);
        }
        data[field.key] = val;
      }
      data['active'] = true;

      if (this.editingItemId) {
        await this.firebaseService.updateCollectionItem(this.currentCollection.slug, this.editingItemId, data);
        this.notice = 'Registro actualizado';
      } else {
        await this.firebaseService.addCollectionItem(this.currentCollection.slug, data);
        this.notice = 'Registro creado';
      }

      this.showItemForm = false;
      this.editingItemId = null;
      await this.loadCollectionData();
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al guardar registro';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  async deleteItem(item: any): Promise<void> {
    const displayVal = item[this.currentCollection.displayField] || item.id;
    if (!confirm(`¿Eliminar "${displayVal}"?`)) return;
    this.saving = true;
    try {
      await this.firebaseService.deleteCollectionItem(this.currentCollection.slug, item.id);
      this.notice = 'Registro eliminado';
      await this.loadCollectionData();
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al eliminar registro';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  getItemDisplay(item: any): string {
    const key = this.currentCollection.displayField || this.currentCollection.fields[0]?.key;
    return key ? (item[key] || item.id) : item.id;
  }

  getVisibleFields(): CollectionField[] {
    const fields = this.currentCollection.fields.slice(0, 5);
    const hasPhoneField = fields.some(f => f.key === 'phoneNumber');
    if (!hasPhoneField) {
      fields.push({ key: 'phoneNumber', label: 'WhatsApp', type: 'phone', required: false });
    }
    return fields;
  }

  getFieldValue(item: any, field: CollectionField): string {
    const val = item[field.key];
    if (val === undefined || val === null) return '-';
    if (field.type === 'boolean') return val ? 'Sí' : 'No';
    if (field.type === 'list' && Array.isArray(val)) return val.join(', ');
    return String(val);
  }

  getWhatsAppLink(phone: string): string {
    const cleaned = phone?.replace(/[^0-9]/g, '') || '';
    return `https://wa.me/${cleaned}`;
  }
}
