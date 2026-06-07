import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SwUpdate } from '@angular/service-worker';
import { Subscription } from 'rxjs';
import { APP_VERSION, APP_BUILT_AT } from '../../../environments/version';

// Muestra la versión desplegada y su estado de actualización al pie del menú.
// "Al día" = no hay versión nueva detectada (el app component chequea cada 5 min
// y al volver a la pestaña; si aparece una nueva, se descarga y recarga sola).
@Component({
  selector: 'app-version-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="version-badge" [title]="'Compilada: ' + builtAt">
      <span class="vb-dot" [class.vb-updating]="updating"></span>
      <span>v{{ version }}</span>
      <span class="vb-status">{{ updating ? 'Actualizando…' : 'Al día' }}</span>
    </div>
  `,
  styles: [`
    .version-badge {
      display: flex; align-items: center; gap: 6px; justify-content: center;
      font-size: 0.68rem; color: #94a3b8; padding: 6px 0 2px;
      user-select: none;
    }
    .vb-dot {
      width: 7px; height: 7px; border-radius: 50%; background: #10b981;
      flex-shrink: 0;
    }
    .vb-dot.vb-updating { background: #f59e0b; animation: vb-pulse 1s infinite; }
    .vb-status { opacity: 0.8; }
    @keyframes vb-pulse { 50% { opacity: 0.3; } }
  `]
})
export class VersionBadgeComponent implements OnDestroy {
  version = APP_VERSION;
  builtAt = new Date(APP_BUILT_AT).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
  updating = false;
  private sub?: Subscription;

  constructor(swUpdate: SwUpdate) {
    if (swUpdate.isEnabled) {
      // VERSION_DETECTED = hay versión nueva descargándose; al estar lista (VERSION_READY)
      // el app component recarga la página automáticamente.
      this.sub = swUpdate.versionUpdates.subscribe(e => {
        if (e.type === 'VERSION_DETECTED') this.updating = true;
      });
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
