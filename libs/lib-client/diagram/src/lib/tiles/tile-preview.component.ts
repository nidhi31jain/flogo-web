import { Component, Input } from '@angular/core';
import { SvgRefFixerService } from '@flogo-web/lib-client/core';

@Component({
  selector: 'flogo-diagram-tile-preview',
  templateUrl: './tile-preview.component.html',
  styleUrls: ['./tile-task.component.less'],
})
export class TilePreviewComponent {
  @Input()
  title: string;
  @Input()
  id: string;

  constructor(private svgFixer: SvgRefFixerService) {}

  get bgFill() {
    return this.svgFixer.getFixedRef('url(#flogo-diagram-tile__bg)');
  }

  get shadow() {
    return this.svgFixer.getFixedRef('url(#flogo-diagram-tile__shadow--preview)');
  }
}
