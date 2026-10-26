import { Component, ChangeDetectionStrategy, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SavedRoku, TvType } from '../../services/saved-roku';
import { RokuConfigService, RokuDraft, SaveError, SaveResult } from '../../services/roku-config.service';
import { DiscoveredTv, TvService } from '../../services/tv.service';

@Component({
  selector: 'app-roku-card',
  imports: [FormsModule],
  templateUrl: './roku-card.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './roku-card.component.scss',
})
export class RokuCardComponent implements OnChanges, OnDestroy {
  @Input() roku: SavedRoku | null = null;
  @Input() active = false;
  @Input() unreachable = false;
  @Input() proxyAvailable = false;
  @Input() prefill: { ip: string; name: string } | null = null;

  @Output() use = new EventEmitter<string>();
  @Output() delete = new EventEmitter<string>();
  @Output() saved = new EventEmitter<SaveResult>();
  @Output() cancelled = new EventEmitter<void>();

  editing = false;
  confirmingDelete = false;
  saving = false;
  discovering = false;
  discovered: DiscoveredTv[] | null = null;
  error: SaveError | null = null;
  warning: string | null = null;
  draft: RokuDraft = { id: null, name: '', ip: '', tvType: 'none', tvIp: '' };
  private initialised = false;
  private sub?: Subscription;

  constructor(private config: RokuConfigService, private tv: TvService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialised) {
      this.initialised = true;
      if (!this.roku) this.startEdit();
      return;
    }
    if (changes['roku'] && !this.editing) this.resetDraft();
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  get tvLabel(): string {
    const tv = this.roku?.tv;
    return tv && tv.type !== 'none' ? `Panasonic Viera ${tv.ip ?? ''}`.trim() : 'No TV';
  }

  startEdit(): void {
    this.resetDraft();
    this.editing = true;
    this.confirmingDelete = false;
    this.error = null;
    this.warning = null;
  }

  cancel(): void {
    this.sub?.unsubscribe();
    this.resetDraft();
    this.editing = false;
    this.error = null;
    this.discovered = null;
    this.discovering = false;
    this.cancelled.emit();
  }

  onTypeChange(type: TvType): void {
    this.draft.tvType = type;
    this.discovered = null;
  }

  discoverTvs(): void {
    this.sub?.unsubscribe();
    this.discovering = true;
    this.discovered = null;
    this.sub = this.tv.discover(this.draft.tvType).subscribe({
      next: list => { this.discovered = list; this.discovering = false; },
      error: () => { this.discovered = []; this.discovering = false; },
    });
  }

  pickTv(tv: DiscoveredTv): void {
    this.draft.tvIp = tv.ip;
    this.discovered = null;
  }

  async submit(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.error = null;
    this.warning = null;
    try {
      const result = await this.config.save({ ...this.draft });
      this.editing = false;
      this.discovered = null;
      if (result.tvStatus === 'pairing-required') {
        this.warning = 'Pairing required (support coming in a future update)';
      }
      this.saved.emit(result);
    } catch (e: any) {
      this.error = e instanceof SaveError ? e : new SaveError('roku', e?.message ?? 'Save failed');
    } finally {
      this.saving = false;
    }
  }

  confirmDelete(): void {
    if (this.roku) this.delete.emit(this.roku.id);
    this.confirmingDelete = false;
  }

  private resetDraft(): void {
    if (this.roku) {
      this.draft = {
        id: this.roku.id,
        name: this.roku.name,
        ip: this.roku.ip,
        tvType: this.roku.tv.type,
        tvIp: this.roku.tv.ip ?? '',
      };
    } else {
      this.draft = { id: null, name: this.prefill?.name ?? '', ip: this.prefill?.ip ?? '', tvType: 'none', tvIp: '' };
    }
  }
}
