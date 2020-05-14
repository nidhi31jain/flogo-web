import { Component } from '@angular/core';

@Component({
  selector: 'flogo-diagram-tile-placeholder',
  template: `
    <svg
      xmlns:xlink="http://www.w3.org/1999/xlink"
      xmlns="http://www.w3.org/2000/svg"
      width="128"
      height="60"
      viewBox="0 0 128 62"
    >
      <g class="tile" fill="none" fill-rule="evenodd" transform="translate(2 1)">
        <path
          class="tile__stroke"
          d="M117.27 60H0l11.264-29.92L0 0h117.371L128 30.376z"
        />
      </g>
    </svg>
  `,
})
export class TilePlaceholderComponent {}
