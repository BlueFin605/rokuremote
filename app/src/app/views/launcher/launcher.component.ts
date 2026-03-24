import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Router } from '@angular/router';
import { RokuService, RokuApp } from '../../services/roku.service';

@Component({
  selector: 'app-launcher',
  imports: [FormsModule, DragDropModule],
  templateUrl: './launcher.component.html',
  styleUrl: './launcher.component.scss'
})
export class LauncherComponent implements OnInit {
  private static readonly ORDER_KEY = 'roku-app-order';

  apps: RokuApp[] = [];
  filteredApps: RokuApp[] = [];
  activeAppId: string | null = null;
  searchQuery = '';
  loading = true;
  editing = false;
  error: { type: string; message: string } | null = null;

  constructor(
    private roku: RokuService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadApps();
  }

  loadApps(): void {
    this.loading = true;
    this.error = null;

    this.roku.getApps().subscribe({
      next: (apps) => {
        this.apps = this.applyCustomOrder(apps);
        this.filterApps();
        this.loading = false;
        this.loadActiveApp();
      },
      error: (err) => {
        this.loading = false;
        this.error = err;
      },
    });
  }

  filterApps(): void {
    const q = this.searchQuery.toLowerCase().trim();
    this.filteredApps = q
      ? this.apps.filter(app => app.name.toLowerCase().includes(q))
      : [...this.apps];
  }

  launch(app: RokuApp): void {
    if (this.editing) return;

    this.roku.launchApp(app.id).subscribe({
      next: () => {
        this.activeAppId = app.id;
      },
      error: (err) => {
        this.error = err;
      },
    });
  }

  toggleEdit(): void {
    this.editing = !this.editing;
    if (!this.editing) {
      this.saveOrder();
    }
  }

  drop(event: CdkDragDrop<RokuApp[]>): void {
    moveItemInArray(this.filteredApps, event.previousIndex, event.currentIndex);
    // Sync back to main list
    this.apps = [...this.filteredApps];
    this.saveOrder();
  }

  resetOrder(): void {
    localStorage.removeItem(LauncherComponent.ORDER_KEY);
    this.apps.sort((a, b) => a.name.localeCompare(b.name));
    this.filterApps();
  }

  onIconError(app: RokuApp): void {
    app.iconUrl = '';
  }

  goBack(): void {
    this.router.navigate(['/remote']);
  }

  private loadActiveApp(): void {
    this.roku.getActiveApp().subscribe(id => {
      this.activeAppId = id;
    });
  }

  private saveOrder(): void {
    const order = this.apps.map(a => a.id);
    localStorage.setItem(LauncherComponent.ORDER_KEY, JSON.stringify(order));
  }

  private applyCustomOrder(apps: RokuApp[]): RokuApp[] {
    const raw = localStorage.getItem(LauncherComponent.ORDER_KEY);
    if (!raw) return apps;

    try {
      const order: string[] = JSON.parse(raw);
      const appMap = new Map(apps.map(a => [a.id, a]));
      const ordered: RokuApp[] = [];

      // Add apps in saved order
      for (const id of order) {
        const app = appMap.get(id);
        if (app) {
          ordered.push(app);
          appMap.delete(id);
        }
      }

      // Append any new apps not in the saved order (alphabetically)
      const remaining = [...appMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      ordered.push(...remaining);

      return ordered;
    } catch {
      return apps;
    }
  }
}
