import { Observable, ReplaySubject } from 'rxjs';
import { delay } from 'rxjs/operators';
import {
  Component,
  Inject,
  InjectionToken,
  OnInit,
  ElementRef,
  AfterViewInit,
  HostListener,
} from '@angular/core';
import { FocusTrapFactory } from '@angular/cdk/a11y';

import { FlogoInstallerComponent } from '@flogo-web/lib-client/contrib-installer';
import { ModalService } from '@flogo-web/lib-client/modal';

import { StageAddOptions, Activity } from './core/stage-add-options';
import { filterActivitiesBy } from './core/filter-activities-by';

export const STAGEADD_OPTIONS = new InjectionToken<StageAddOptions>(
  'flogo-stream-stage-add'
);

@Component({
  templateUrl: 'stage-add.component.html',
  styleUrls: ['stage-add.component.less'],
})
export class StageAddComponent implements OnInit, AfterViewInit {
  filteredActivities$: Observable<Activity[]>;
  filterText$: ReplaySubject<string>;
  isInstallOpen = false;

  constructor(
    @Inject(STAGEADD_OPTIONS) public control: StageAddOptions,
    private modalService: ModalService,
    private elementRef: ElementRef,
    private focusTrap: FocusTrapFactory
  ) {
    this.filterText$ = new ReplaySubject<string>(1);
  }

  ngAfterViewInit() {
    const focusTrap = this.focusTrap.create(this.elementRef.nativeElement);
    focusTrap.focusInitialElement();
  }

  ngOnInit() {
    this.filteredActivities$ = filterActivitiesBy(
      this.control.activities$,
      this.filterText$
    );
    this.filterText$.next('');
  }

  filterActivities(term: string) {
    this.filterText$.next(term);
  }

  selectActivity(ref: string) {
    this.control.selectActivity(ref);
  }

  handleInstallerWindow(state: boolean) {
    this.isInstallOpen = true;
    if (state) {
      this.modalService
        .openModal<void>(FlogoInstallerComponent)
        .detach.pipe(delay(100))
        .subscribe(() => {
          this.isInstallOpen = false;
          this.updateWindowState();
        });
    }
    this.updateWindowState();
  }

  @HostListener('keyup.escape')
  cancel() {
    this.control.cancel();
  }

  private updateWindowState() {
    this.control.updateActiveState(this.isInstallOpen);
  }
}
