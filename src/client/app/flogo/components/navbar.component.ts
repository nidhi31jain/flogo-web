import {Component} from 'angular2/core';
import {ROUTER_DIRECTIVES} from 'angular2/router';

@Component({
  selector: 'flogo-navbar',
  moduleId: module.id,
  templateUrl: './navbar.tpl.html',
  styleUrls: ['./navbar.component.css'],
  directives: [ROUTER_DIRECTIVES]
})

export class FlogoNavbarComponent{

}