import { Component, OnInit, ElementRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FirebaseService } from '../services/firebase.service';

interface CartItem { product: any; qty: number; }

@Component({
  selector: 'app-catalog',
  templateUrl: './catalog.component.html',
  styleUrls: ['./catalog.component.css']
})
export class CatalogComponent implements OnInit {
  loading = true;
  orgId = '';
  flowId = '';
  orgName = '';
  orgLogo = '';
  storeImage = '';
  waPhone = '';
  botApiUrl = '';

  flow: any = null;
  products: any[] = [];
  webSteps: any[] = [];
  categories: string[] = [];

  cart: CartItem[] = [];
  checkoutMode = false;
  webFormData: Record<string, any> = {};
  activeCategory = '';
  sortMode: 'default' | 'priceAsc' | 'priceDesc' | 'nameAsc' = 'default';
  selectedPrice: 'all' | 'lt5' | '5to10' | 'gt10' = 'all';
  selectedBrands: string[] = [];

  submitting = false;
  orderCode = '';
  waLink = '';
  error = '';
  checkoutError = '';

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private firebaseService: FirebaseService,
    private el: ElementRef
  ) {}

  async ngOnInit(): Promise<void> {
    this.orgId  = this.route.snapshot.paramMap.get('orgId')  || '';
    this.flowId = this.route.snapshot.paramMap.get('flowId') || '';
    try {
      const [publicInfo, store] = await Promise.all([
        this.firebaseService.getPublicOrgInfo(this.orgId),
        this.firebaseService.getPublicStore(this.orgId, this.flowId),
      ]);

      this.orgName   = publicInfo?.orgName  || '';
      this.orgLogo   = publicInfo?.orgLogo  || '';
      this.botApiUrl = publicInfo?.botApiUrl || '';
      // waPhone from public/info takes priority over store doc (set by SA)
      if (publicInfo?.waPhone) this.waPhone = publicInfo.waPhone;

      if (!store) {
        this.error = 'Catálogo no encontrado o no está disponible.';
        return;
      }

      this.storeImage = store.storeImage || '';

      // Aplicar color de marca como variable CSS
      const color = store.storeColor || '#2e7d32';
      const dark  = this.darken(color, 25);
      this.el.nativeElement.style.setProperty('--cat-primary',      color);
      this.el.nativeElement.style.setProperty('--cat-primary-dark', dark);

      this.flow     = store;
      this.products = (store.products || []).filter((p: any) => p.disponible !== false);
      this.webSteps = store.webSteps || [];
      // public/info.waPhone (set by SA) takes priority; fall back to store doc
      if (!this.waPhone) this.waPhone = store.waPhone || '';

      const cats = [...new Set<string>(this.products.map((p: any) => p.categoria || 'General'))];
      this.categories = cats;
    } catch (e) {
      console.error(e);
      this.error = 'Error al cargar el catálogo.';
    } finally {
      this.loading = false;
    }
  }

  getByCategory(cat: string): any[] {
    const filtered = this.filteredProducts.filter(p => (p.categoria || 'General') === cat);
    if (this.sortMode === 'default') return filtered;

    return [...filtered].sort((a, b) => {
      const priceA = Number(a?.precio) || 0;
      const priceB = Number(b?.precio) || 0;
      const nameA = (a?.nombre || '').toString();
      const nameB = (b?.nombre || '').toString();

      switch (this.sortMode) {
        case 'priceAsc':
          return priceA - priceB;
        case 'priceDesc':
          return priceB - priceA;
        case 'nameAsc':
          return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
        default:
          return 0;
      }
    });
  }

  getQty(id: string): number {
    return this.cart.find(c => c.product.id === id)?.qty || 0;
  }

  addItem(product: any): void {
    const item = this.cart.find(c => c.product.id === product.id);
    item ? item.qty++ : this.cart.push({ product, qty: 1 });
  }

  removeItem(product: any): void {
    const idx = this.cart.findIndex(c => c.product.id === product.id);
    if (idx === -1) return;
    this.cart[idx].qty > 1 ? this.cart[idx].qty-- : this.cart.splice(idx, 1);
  }

  get cartTotal(): number {
    return this.cart.reduce((s, c) => s + c.product.precio * c.qty, 0);
  }

  get cartCount(): number {
    return this.cart.reduce((s, c) => s + c.qty, 0);
  }

  get visibleCategories(): string[] {
    const source = this.activeCategory
      ? this.categories.filter(c => c === this.activeCategory)
      : this.categories;
    return source.filter(c =>
      this.filteredProducts.some(p => (p.categoria || 'General') === c)
    );
  }

  get availableBrands(): string[] {
    return [...new Set(this.products.map((p: any) => (p?.marca || '').toString().trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }

  get filteredProducts(): any[] {
    return this.products.filter((p: any) => {
      const price = Number(p?.precio) || 0;
      const brand = (p?.marca || '').toString().trim();

      const matchPrice =
        this.selectedPrice === 'all' ||
        (this.selectedPrice === 'lt5' && price < 5) ||
        (this.selectedPrice === '5to10' && price >= 5 && price <= 10) ||
        (this.selectedPrice === 'gt10' && price > 10);

      const matchBrand = this.selectedBrands.length === 0 || this.selectedBrands.includes(brand);
      return matchPrice && matchBrand;
    });
  }

  toggleBrand(brand: string): void {
    if (this.selectedBrands.includes(brand)) {
      this.selectedBrands = this.selectedBrands.filter(b => b !== brand);
      return;
    }
    this.selectedBrands = [...this.selectedBrands, brand];
  }

  setCategory(cat: string): void {
    this.activeCategory = cat;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  startCheckout(): void {
    this.webFormData  = {};
    this.checkoutMode = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  backToCart(): void {
    this.checkoutMode  = false;
    this.checkoutError = '';
  }

  goBack(): void {
    this.error = '';
    this.checkoutMode = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private darken(hex: string, amount: number): string {
    const n = parseInt(hex.replace('#',''), 16);
    const r = Math.max(0, (n >> 16) - amount);
    const g = Math.max(0, ((n >> 8) & 0xff) - amount);
    const b = Math.max(0, (n & 0xff) - amount);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }

  resetOrder(): void {
    this.orderCode     = '';
    this.waLink        = '';
    this.cart          = [];
    this.checkoutMode  = false;
    this.webFormData   = {};
    this.checkoutError = '';
  }

  async submitOrder(): Promise<void> {
    console.log('[DEBUG] submitOrder iniciado');
    console.log('[DEBUG] orgId:', this.orgId, '| flowId:', this.flowId);
    console.log('[DEBUG] botApiUrl:', this.botApiUrl);
    console.log('[DEBUG] waPhone:', this.waPhone);
    console.log('[DEBUG] cart:', this.cart);
    console.log('[DEBUG] webFormData:', this.webFormData);

    this.submitting = true;
    this.checkoutError = '';
    try {
      const now     = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const rand    = Math.random().toString(36).slice(2, 6).toUpperCase();
      const code    = `PED-${dateStr}-${rand}`;

      const itemsText = this.cart.map(c => `${c.qty}x ${c.product.nombre}`).join(', ');
      const total     = this.cartTotal;
      const totalText = `$${total.toFixed(2)}`;
      const items     = this.cart.map(c => ({
        productId: c.product.id, name: c.product.nombre,
        price: c.product.precio, qty: c.qty,
      }));

      const orderData = {
        code, items, itemsText, total, totalText,
        flowId: this.flowId,
        webData: this.webFormData,
        orderDate: now.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        status: 'pending',
        clientPhone: null,
      };

      console.log('[DEBUG] orderData:', orderData);

      let saved = false;
      const apiUrl = (this.botApiUrl || '').replace(/\/$/, '');
      if (apiUrl) {
        console.log('[DEBUG] Intentando bot API:', `${apiUrl}/api/${this.orgId}/orders`);
        try {
          await this.http.post(`${apiUrl}/api/${this.orgId}/orders`, orderData).toPromise();
          saved = true;
          console.log('[DEBUG] Bot API OK ✓');
        } catch (botErr) {
          console.warn('[DEBUG] Bot API falló, usando Firebase fallback:', botErr);
        }
      } else {
        console.log('[DEBUG] botApiUrl vacío, usando Firebase directo');
      }

      if (!saved) {
        console.log('[DEBUG] Guardando en Firebase...');
        await this.firebaseService.saveOrderPublic(this.orgId, orderData);
        console.log('[DEBUG] Firebase OK ✓');
      }

      const msg = encodeURIComponent(`Mi pedido: ${code}\n${itemsText}\nTotal: ${totalText}`);
      const link = this.waPhone
        ? `https://wa.me/${this.waPhone}?text=${msg}`
        : `https://wa.me/?text=${msg}`;
      this.openWhatsAppAndClose(link);

    } catch (e: any) {
      console.error('[DEBUG] ERROR TOTAL en submitOrder:', e);
      const itemsText = this.cart.map(c => `${c.qty}x ${c.product.nombre}`).join(', ');
      const totalText = `$${this.cartTotal.toFixed(2)}`;
      if (this.waPhone) {
        const msg = encodeURIComponent(`Hola, me gustaría hacer el siguiente pedido:\n${itemsText}\nTotal: ${totalText}`);
        this.openWhatsAppAndClose(`https://wa.me/${this.waPhone}?text=${msg}`);
      } else {
        this.checkoutError = 'Error al enviar el pedido. Por favor intenta nuevamente.';
      }
    } finally {
      this.submitting = false;
    }
  }

  private openWhatsAppAndClose(url: string): void {
    this.waLink    = url;
    this.orderCode = 'WA';
    window.open(url, '_blank');
    setTimeout(() => window.close(), 300);
  }
}
