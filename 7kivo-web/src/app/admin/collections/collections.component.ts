import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';
import * as XLSX from 'xlsx';

interface CollectionField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  protected?: boolean;
  refCollection?: string;
  refDisplayField?: string;
  refValueField?: string;
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
  private originalFieldKeys: string[] = [];

  collectionData: any[] = [];
  dataLoading = false;
  showItemForm = false;
  editingItemId: string | null = null;
  itemForm: Record<string, any> = {};
  refCollectionData: Record<string, any[]> = {};

  // Filtros
  filterText = '';
  filters: Record<string, any> = {};
  filtersFrom: Record<string, any> = {};
  filtersTo: Record<string, any> = {};
  filteredData: any[] = [];
  showFilterPanel = false;
  showAdvancedFilters = false;

  // Columnas
  visibleFieldKeys: string[] = [];
  showColumnPanel = false;

  // Excel import
  showImportPanel = false;
  importMode: 'overwrite' | 'merge' = 'merge';
  importUniqueField = '';
  importRows: any[] = [];
  importHeaders: string[] = [];
  importColMap: Record<string, string> = {};
  importing = false;
  importPreviewCount = 0;
  importError = '';

  fieldTypes = [
    { value: 'text', label: 'Texto' },
    { value: 'number', label: 'Número' },
    { value: 'boolean', label: 'Sí/No' },
    { value: 'date', label: 'Fecha' },
    { value: 'list', label: 'Lista (valores separados)' },
    { value: 'select', label: 'Selección (opciones fijas)' },
    { value: 'reference', label: 'Referencia a otra colección' }
  ];

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService
  ) {}

  get canEditSchema(): boolean {
    const role = this.authService.userRole;
    return role === 'owner' || role === 'admin';
  }

  get canCreateCollection(): boolean {
    const limit = this.authService.getPlanLimits().collections;
    return this.collections.length < limit;
  }

  get collectionLimit(): number {
    return this.authService.getPlanLimits().collections;
  }

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
      this.error = 'Error al cargar bases de datos';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.loading = false;
    }
  }

  // ==================== LIST VIEW ====================

  openNewCollection(): void {
    this.currentCollection = this.emptyCollection();
    this.originalFieldKeys = [];
    this.view = 'schema';
    this.activeTab = 'schema';
  }

  openCollection(col: CollectionDef): void {
    this.currentCollection = JSON.parse(JSON.stringify(col));
    this.originalFieldKeys = (col.fields || []).map(f => f.key);
    this.view = 'schema';
    this.activeTab = 'data';
    this.initViewState(col.slug);
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
    if (this.currentCollection.fields[index]?.protected) {
      this.error = 'Este campo es requerido por el sistema y no puede eliminarse';
      setTimeout(() => this.error = '', 3000);
      return;
    }
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
    if (!field.label) return;

    const toKey = (s: string) => s
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_|_$)/g, '');

    const currentBase = toKey(field.label);
    if (!currentBase) return;

    // Detect if the key is still "in sync" with the auto-generated value so we
    // keep updating while the user types. Stop updating once they manually edit.
    // A key is considered auto-generated if it matches the current base, the
    // previous base (one char less), or a uniqueness-suffixed version (_2, _3…).
    const prevBase = toKey(field.label.slice(0, -1));
    const keyBase = (field.key || '').replace(/_\d+$/, '');
    const isTracking = field.type === 'reference'
      || !field.key
      || keyBase === currentBase
      || keyBase === prevBase;

    if (!isTracking) return;

    // Ensure uniqueness among sibling fields (excluding this field itself)
    const siblings = this.currentCollection.fields.filter(f => f !== field);
    const usedKeys = new Set(siblings.map(f => f.key));
    let candidate = currentBase;
    let counter = 2;
    while (usedKeys.has(candidate)) {
      candidate = `${currentBase}_${counter++}`;
    }
    field.key = candidate;
  }

  onFieldTypeChange(field: CollectionField): void {
    // When switching to reference, regenerate the key and clear ref-specific config
    if (field.type === 'reference') {
      this.generateFieldKey(field);
      field.refCollection = field.refCollection || '';
      field.refDisplayField = '';
      field.refValueField = '';
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

      // Detect removed fields and remove matching flow steps
      if (this.originalFieldKeys.length > 0 && data.slug) {
        const currentKeys = new Set(this.currentCollection.fields.map(f => f.key));
        const removedKeys = this.originalFieldKeys.filter(k => !currentKeys.has(k));
        if (removedKeys.length > 0) {
          await this.firebaseService.removeFlowStepsForFields(data.slug, removedKeys);
        }
      }
      this.originalFieldKeys = this.currentCollection.fields.map(f => f.key);

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
      await this.loadRefCollectionData();
      this.applyFilters();
    } catch (err) {
      console.error('Error loading collection data:', err);
    } finally {
      this.dataLoading = false;
    }
  }

  async openNewItem(): Promise<void> {
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
    await this.loadRefCollectionData();
  }

  async openEditItem(item: any): Promise<void> {
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
    await this.loadRefCollectionData();
  }

  async loadRefCollectionData(): Promise<void> {
    const refFields = this.currentCollection.fields.filter(f => f.type === 'reference' && f.refCollection);
    for (const field of refFields) {
      const slug = field.refCollection!;
      if (!this.refCollectionData[slug]) {
        try {
          this.refCollectionData[slug] = await this.firebaseService.getCollectionData(slug);
        } catch {
          this.refCollectionData[slug] = [];
        }
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
      // Si tiene evento de Google Calendar, marcarlo como cancelado antes de eliminar
      if (item.gcEventId) {
        try {
          const config = await this.firebaseService.getOrgConfig();
          const botApiUrl = config?.botApiUrl?.replace(/\/$/, '');
          if (botApiUrl) {
            await fetch(`${botApiUrl}/api/appointments/cancel-gcal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ gcEventId: item.gcEventId })
            });
          }
        } catch (_) {}
      }
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
    if (!this.visibleFieldKeys.length) {
      const defaults = this.currentCollection.fields.slice(0, 6);
      const hasPhone = defaults.some(f => f.key === 'phoneNumber');
      if (!hasPhone) {
        const phoneField = this.currentCollection.fields.find(f => f.key === 'phoneNumber');
        if (phoneField) defaults.push(phoneField);
        else defaults.push({ key: 'phoneNumber', label: 'WhatsApp', type: 'phone', required: false });
      }
      return defaults;
    }
    return this.currentCollection.fields.filter(f => this.visibleFieldKeys.includes(f.key));
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

  // ==================== VIEW STATE (FILTERS + COLUMNS) ====================

  initViewState(slug: string): void {
    try {
      const saved = localStorage.getItem(`col_view_${slug}`);
      if (saved) {
        const s = JSON.parse(saved);
        this.filterText = s.filterText || '';
        this.filters = s.filters || {};
        this.filtersFrom = s.filtersFrom || {};
        this.filtersTo = s.filtersTo || {};
        this.visibleFieldKeys = s.visibleFieldKeys || [];
      } else {
        this.filterText = '';
        this.filters = {};
        this.filtersFrom = {};
        this.filtersTo = {};
        this.visibleFieldKeys = [];
      }
    } catch { /* ignore */ }
  }

  saveViewState(): void {
    try {
      localStorage.setItem(`col_view_${this.currentCollection.slug}`, JSON.stringify({
        filterText: this.filterText,
        filters: this.filters,
        filtersFrom: this.filtersFrom,
        filtersTo: this.filtersTo,
        visibleFieldKeys: this.visibleFieldKeys
      }));
    } catch { /* ignore */ }
  }

  applyFilters(): void {
    let data = this.collectionData;

    if (this.filterText.trim()) {
      const q = this.filterText.toLowerCase();
      data = data.filter(item =>
        this.currentCollection.fields.some(f => {
          const v = String(this.getFieldDisplayValue(item, f)).toLowerCase();
          return v.includes(q);
        })
      );
    }

    for (const f of this.currentCollection.fields) {
      const fv = this.filters[f.key];
      const from = this.filtersFrom[f.key];
      const to = this.filtersTo[f.key];

      if (f.type === 'boolean' && fv) {
        data = data.filter(item =>
          fv === 'true' ? !!item[f.key] : !item[f.key]
        );
      } else if ((f.type === 'text' || f.type === 'list') && fv) {
        data = data.filter(item =>
          String(this.getFieldDisplayValue(item, f)).toLowerCase().includes(String(fv).toLowerCase())
        );
      } else if ((f.type === 'select' || f.type === 'reference') && fv) {
        data = data.filter(item => String(item[f.key] ?? '') === String(fv));
      } else if (f.type === 'number') {
        if (from !== null && from !== undefined && from !== '') {
          data = data.filter(item => Number(item[f.key]) >= Number(from));
        }
        if (to !== null && to !== undefined && to !== '') {
          data = data.filter(item => Number(item[f.key]) <= Number(to));
        }
      } else if (f.type === 'date') {
        if (from) data = data.filter(item => (item[f.key] || '') >= from);
        if (to)   data = data.filter(item => (item[f.key] || '') <= to);
      }
    }

    this.filteredData = data;
  }

  clearFilters(): void {
    this.filterText = '';
    this.filters = {};
    this.filtersFrom = {};
    this.filtersTo = {};
    this.applyFilters();
    this.saveViewState();
  }

  clearFilter(key: string): void {
    delete this.filters[key];
    delete this.filtersFrom[key];
    delete this.filtersTo[key];
    this.applyFilters();
    this.saveViewState();
  }

  get activeFilterCount(): number {
    let n = this.filterText.trim() ? 1 : 0;
    for (const k of Object.keys(this.filters)) {
      if (this.filters[k] !== null && this.filters[k] !== undefined && this.filters[k] !== '') n++;
    }
    for (const k of Object.keys(this.filtersFrom)) {
      if (this.filtersFrom[k] !== null && this.filtersFrom[k] !== undefined && this.filtersFrom[k] !== '') n++;
    }
    for (const k of Object.keys(this.filtersTo)) {
      if (this.filtersTo[k] !== null && this.filtersTo[k] !== undefined && this.filtersTo[k] !== '') n++;
    }
    return n;
  }

  toggleVisibleField(key: string): void {
    const idx = this.visibleFieldKeys.indexOf(key);
    if (idx >= 0) this.visibleFieldKeys.splice(idx, 1);
    else this.visibleFieldKeys.push(key);
    this.saveViewState();
  }

  isFieldVisible(key: string): boolean {
    if (!this.visibleFieldKeys.length) {
      return this.currentCollection.fields.slice(0, 6).some(f => f.key === key)
          || key === 'phoneNumber';
    }
    return this.visibleFieldKeys.includes(key);
  }

  getFieldDisplayValue(item: any, field: CollectionField): string {
    const val = item[field.key];
    if (val === undefined || val === null || val === '') return '-';
    if (field.type === 'boolean') return val ? 'Sí' : 'No';
    if (field.type === 'list' && Array.isArray(val)) return val.join(', ');
    if (field.type === 'reference' && field.refCollection) {
      const refItems = this.refCollectionData[field.refCollection] || [];
      const match = refItems.find((r: any) =>
        r.id === val || String(r[field.refValueField || 'id']) === String(val)
      );
      if (match) return this.getRefItemOptionLabel(match, field);
    }
    return String(val);
  }

  downloadData(): void {
    const fields = this.getVisibleFields().filter(f => f.type !== 'phone');
    const headers = ['#', ...fields.map(f => f.label || f.key)];
    const rows = this.filteredData.map((item, i) =>
      [i + 1, ...fields.map(f => this.getFieldDisplayValue(item, f))]
    );
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, this.currentCollection.name || 'Datos');
    XLSX.writeFile(wb, `${this.currentCollection.slug}_datos.xlsx`);
  }

  // ==================== REFERENCE FIELD HELPERS ====================

  getRefCollectionFields(slug: string): CollectionField[] {
    const col = this.collections.find(c => c.slug === slug);
    return col?.fields || [];
  }

  getRefItemOptionLabel(refItem: any, field: CollectionField): string {
    if (field.refDisplayField && refItem[field.refDisplayField] != null) {
      return String(refItem[field.refDisplayField]);
    }
    const refCol = this.collections.find(c => c.slug === field.refCollection);
    const dispKey = refCol?.displayField || refCol?.fields?.[0]?.key;
    if (dispKey && refItem[dispKey] != null) return String(refItem[dispKey]);
    return refItem.id || '(sin nombre)';
  }

  getRefItemOptionValue(refItem: any, field: CollectionField): string {
    if (field.refValueField && refItem[field.refValueField] != null) {
      return String(refItem[field.refValueField]);
    }
    return refItem.id || '';
  }

  // ==================== EXCEL IMPORT / EXPORT ====================

  downloadTemplate(): void {
    const headers = this.currentCollection.fields.map(f => f.label || f.key);
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, this.currentCollection.name || 'Datos');
    XLSX.writeFile(wb, `plantilla_${this.currentCollection.slug}.xlsx`);
  }

  onExcelFile(event: any): void {
    this.importError = '';
    const file: File = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (!rawRows || rawRows.length < 2) {
          this.importError = 'El archivo debe tener al menos una fila de encabezados y una de datos.';
          return;
        }
        this.importHeaders = (rawRows[0] as string[]).map(h => String(h || '').trim());
        this.importColMap = {};
        for (const header of this.importHeaders) {
          const match = this.currentCollection.fields.find(f =>
            f.label?.toLowerCase() === header.toLowerCase() ||
            f.key?.toLowerCase() === header.toLowerCase()
          );
          if (match) this.importColMap[header] = match.key;
        }
        this.importRows = rawRows.slice(1).map(row => {
          const obj: Record<string, any> = {};
          this.importHeaders.forEach((h, i) => {
            obj[h] = (row as any[])[i] ?? '';
          });
          return obj;
        }).filter(row => Object.values(row).some(v => v !== '' && v !== null && v !== undefined));
        this.importPreviewCount = this.importRows.length;
      } catch (err) {
        this.importError = 'Error al leer el archivo. Asegúrate de que sea un .xlsx válido.';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async importExcel(): Promise<void> {
    if (!this.importRows.length) return;
    if (this.importMode === 'merge' && this.importUniqueField) {
      const excelCol = Object.keys(this.importColMap).find(h => this.importColMap[h] === this.importUniqueField);
      if (excelCol) {
        const values = this.importRows.map(r => String(r[excelCol] ?? '').trim()).filter(v => v);
        const unique = new Set(values);
        if (unique.size !== values.length) {
          this.importError = `El campo "${this.importUniqueField}" tiene valores duplicados en el archivo. Corrígelo antes de importar.`;
          return;
        }
      }
    }
    const items = this.importRows.map(row => {
      const item: Record<string, any> = {};
      for (const [excelHeader, fieldKey] of Object.entries(this.importColMap)) {
        if (!fieldKey) continue;
        const schemaField = this.currentCollection.fields.find(f => f.key === fieldKey);
        let val = row[excelHeader];
        if (schemaField?.type === 'number') val = Number(val) || 0;
        else if (schemaField?.type === 'boolean') val = String(val).toLowerCase() === 'true' || val === 1;
        else val = String(val ?? '').trim();
        item[fieldKey] = val;
      }
      return item;
    });
    this.importing = true;
    try {
      const result = await this.firebaseService.batchWriteCollectionItems(
        this.currentCollection.slug, items, this.importMode,
        this.importMode === 'merge' ? this.importUniqueField : undefined
      );
      this.notice = `Importación completada: ${result.added} agregados, ${result.updated} actualizados.`;
      this.showImportPanel = false;
      this.importRows = [];
      await this.loadCollectionData();
      setTimeout(() => this.notice = '', 4000);
    } catch (err) {
      this.importError = 'Error al importar. Intenta de nuevo.';
    } finally {
      this.importing = false;
    }
  }
}
