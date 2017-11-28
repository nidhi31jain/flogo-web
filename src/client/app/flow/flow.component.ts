import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from 'ng2-translate/ng2-translate';

import * as _ from 'lodash';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/toPromise';

import { PostService } from '../core/services/post.service';
import { OperationalError } from '../core/services/error.service';

import {
  ERRORS as RUNNER_ERRORS,
  RUN_STATE_CODE as RUNNER_STATE,
  RUN_STATUS_CODE as RUNNER_STATUS,
  RunnerService,
  RunOptions,
  RunProgress,
  RunProgressStore,
  Step
} from './core/runner.service';

import { IFlogoFlowDiagram, IFlogoFlowDiagramTask, makeDefaultErrorTrigger } from '../core/models';

import {
  PUB_EVENTS as FLOGO_DIAGRAM_SUB_EVENTS,
  SUB_EVENTS as FLOGO_DIAGRAM_PUB_EVENTS
} from '../flogo.flows.detail.diagram/messages';
import {
  PUB_EVENTS as FLOGO_TRIGGERS_SUB_EVENTS,
  SUB_EVENTS as FLOGO_TRIGGERS_PUB_EVENTS
} from '../flogo.flows.detail.triggers/messages';
import {
  PUB_EVENTS as FLOGO_ADD_TASKS_SUB_EVENTS,
  SUB_EVENTS as FLOGO_ADD_TASKS_PUB_EVENTS
} from '../flogo.flows.detail.tasks/messages';
import { SUB_EVENTS as FLOGO_SELECT_TASKS_PUB_EVENTS } from '../flogo.flows.detail.tasks.detail/messages';
import {
  PUB_EVENTS as FLOGO_TASK_SUB_EVENTS,
  SUB_EVENTS as FLOGO_TASK_PUB_EVENTS
} from '../flogo.form-builder/messages';
import {
  PUB_EVENTS as FLOGO_TRANSFORM_SUB_EVENTS,
  SelectTaskData,
  SUB_EVENTS as FLOGO_TRANSFORM_PUB_EVENTS
} from '../flogo.transform/messages';
import {
  PUB_EVENTS as FLOGO_ERROR_PANEL_SUB_EVENTS,
  SUB_EVENTS as FLOGO_ERROR_PANEL_PUB_EVENTS
} from '../flogo.flows.detail.error-panel/messages';

import { RESTAPITriggersService } from '../core/services/restapi/v2/triggers-api.service';
import { AppsApiService } from '../core/services/restapi/v2/apps-api.service';
import { RESTAPIHandlersService } from '../core/services/restapi/v2/handlers-api.service';
import {
  FLOGO_FLOW_DIAGRAM_NODE_TYPE,
  FLOGO_PROFILE_TYPE,
  FLOGO_TASK_ATTRIBUTE_TYPE,
  FLOGO_TASK_TYPE
} from '../core/constants';
import {
  attributeTypeToString,
  flogoGenBranchID,
  flogoGenTriggerID,
  flogoIDDecode,
  flogoIDEncode,
  isMapperActivity,
  normalizeTaskName,
  notification,
  objectFromArray,
  updateBranchNodesRunStatus
} from '../shared/utils';

import { flogoFlowToJSON, triggerFlowToJSON } from '../flogo.flows.detail.diagram/models/flow.model';
import { FlogoModal } from '../core/services/modal.service';
import { HandlerInfo } from './core/models/models';
import { FlogoFlowService as FlowsService } from './core/flow.service';
import { FlogoProfileService } from '../core/services/profile.service';
import { IFlogoTrigger } from '../flogo.flows.detail.triggers-panel/components/triggers-panel.component';
import { FlogoFlowInputSchemaComponent } from './components/flow-input-schema.component';
import { FlowMetadataAttribute } from './core/models/flow-metadata-attribute';
import { FlowMetadata } from '../flogo.transform/models/flow-metadata';

export interface IPropsToUpdateFormBuilder {
  name: string;
}

interface TaskContext {
  isTrigger: boolean;
  isBranch: boolean;
  isTask: boolean;
  hasProcess: boolean;
  isDiagramEdited: boolean;
  app: any;
  currentTrigger: any;
  profileType: FLOGO_PROFILE_TYPE;
}

@Component({
  selector: 'flogo-flow',
  templateUrl: 'flow.component.html',
  styleUrls: ['flow.component.less']
})

export class FlowComponent implements OnInit, OnDestroy {
  @ViewChild('inputSchemaModal') defineInputSchema: FlogoFlowInputSchemaComponent;
  public flow: any;
  public flowId: string;
  public mainHandler: HandlerInfo;
  public errorHandler: HandlerInfo;
  public handlers: { [id: string]: HandlerInfo };
  public triggersList: IFlogoTrigger[];

  private runState = {
    // data
    currentProcessId: <string> null,
    processInstanceId: <string> null,
    // TODO: may need better implementation
    lastProcessInstanceFromBeginning: <any> null,
    steps: <Step[]> null,
  };

  _subscriptions: any[];
  _id: any;

  _isCurrentProcessDirty = true;
  _isDiagramEdited: boolean;
  flowName: string;
  backToAppHover: boolean;

  profileType: FLOGO_PROFILE_TYPE;
  PROFILE_TYPES: typeof FLOGO_PROFILE_TYPE = FLOGO_PROFILE_TYPE;

  public loading: boolean;
  public hasTrigger: boolean;
  public hasTask: boolean;
  public currentTrigger: any;
  public app: any;

  constructor(public translate: TranslateService,
              private _postService: PostService,
              private _flowService: FlowsService,
              private _restAPITriggersService: RESTAPITriggersService,
              private _restAPIHandlerService: RESTAPIHandlersService,
              private _restAPIAppsService: AppsApiService,
              private _runnerService: RunnerService,
              private _router: Router,
              private _flogoModal: FlogoModal,
              private profileService: FlogoProfileService,
              private _route: ActivatedRoute) {
    this._isDiagramEdited = false;

    this.loading = true;
    this.hasTrigger = true;
    this.hasTask = true;
    this.currentTrigger = null;
    this.app = null;
  }

  public ngOnInit() {
    this.flowId = this._route.snapshot.params['id'];
    this.backToAppHover = false;

    this._loadFlow(this.flowId)
      .then(() => {
        this.initSubscribe();
      });
  }

  get disableRunFlow() {
    return _.isEmpty(this.mainHandler && this.mainHandler.tasks);
  }

  private initSubscribe() {
    this._subscriptions = [];

    const subs = [
      _.assign({}, FLOGO_DIAGRAM_SUB_EVENTS.addTask, { callback: this._addTaskFromDiagram.bind(this) }),
      _.assign({}, FLOGO_DIAGRAM_SUB_EVENTS.addTrigger, { callback: this._addTriggerFromDiagram.bind(this) }),
      _.assign({}, FLOGO_DIAGRAM_SUB_EVENTS.selectTask, { callback: this._selectTaskFromDiagram.bind(this) }),
      _.assign({}, FLOGO_DIAGRAM_SUB_EVENTS.deleteTask, { callback: this._deleteTaskFromDiagram.bind(this) }),
      _.assign({}, FLOGO_DIAGRAM_SUB_EVENTS.addBranch, { callback: this._addBranchFromDiagram.bind(this) }),
      _.assign({}, FLOGO_DIAGRAM_SUB_EVENTS.selectBranch, { callback: this._selectBranchFromDiagram.bind(this) }),
      _.assign({}, FLOGO_DIAGRAM_SUB_EVENTS.selectTransform, { callback: this._selectTransformFromDiagram.bind(this) }),
      _.assign({}, FLOGO_DIAGRAM_SUB_EVENTS.selectTrigger, { callback: this._selectTriggerFromDiagram.bind(this) }),
      _.assign({}, FLOGO_TRIGGERS_SUB_EVENTS.addTrigger, { callback: this._addTriggerFromTriggers.bind(this) }),
      _.assign({}, FLOGO_ADD_TASKS_SUB_EVENTS.addTask, { callback: this._addTaskFromTasks.bind(this) }),
      _.assign({}, FLOGO_TASK_SUB_EVENTS.runFromThisTile, { callback: this._runFromThisTile.bind(this) }),
      _.assign({}, FLOGO_TASK_SUB_EVENTS.runFromTrigger, { callback: this._runFromTriggerinTile.bind(this) }),
      _.assign({}, FLOGO_TASK_SUB_EVENTS.setTaskWarnings, { callback: this._setTaskWarnings.bind(this) }),
      _.assign({}, FLOGO_TRANSFORM_SUB_EVENTS.saveTransform, { callback: this._saveTransformFromTransform.bind(this) }),
      _.assign({}, FLOGO_TRANSFORM_SUB_EVENTS.deleteTransform, { callback: this._deleteTransformFromTransform.bind(this) }),
      _.assign({}, FLOGO_TASK_SUB_EVENTS.taskDetailsChanged, { callback: this._taskDetailsChanged.bind(this) }),
      _.assign({}, FLOGO_TASK_SUB_EVENTS.changeTileDetail, { callback: this._changeTileDetail.bind(this) }),
      _.assign({}, FLOGO_ERROR_PANEL_SUB_EVENTS.openPanel, { callback: this._errorPanelStatusChanged.bind(this, true) }),
      _.assign({}, FLOGO_ERROR_PANEL_SUB_EVENTS.closePanel, { callback: this._errorPanelStatusChanged.bind(this, false) })
    ];

    _.each(
      subs, sub => {
        this._subscriptions.push(this._postService.subscribe(sub));
      }
    );
  }

  ngOnDestroy() {
    _.each(this._subscriptions, sub => {
        this._postService.unsubscribe(sub);
      }
    );
  }

  deleteFlow() {
    this.translate.get('FLOWS:CONFIRM_DELETE', { flowName: this.flow.name })
      .toPromise()
      .then(deleteMessage => this._flogoModal.confirmDelete(deleteMessage))
      .then((res) => {
        if (res) {
          let appPromise = null;
          appPromise = (this.app) ? Promise.resolve(this.app) : this._restAPIAppsService.getApp(this.flow.app.id);
          appPromise
            .then((app) => {
              const triggerDetails = this.getTriggerCurrentFlow(app, this.flow.id);
              return this._flowService.deleteFlow(this.flowId, triggerDetails ? triggerDetails.id : null);
            })
            .then(() => {
              this.navigateToApp();
            })
            .then(() => this.translate.get('FLOWS:SUCCESS-MESSAGE-FLOW-DELETED').toPromise())
            .then(message => notification(message, 'success', 3000))
            .catch(err => {
              console.error(err);
              this.translate.get('FLOWS:ERROR-MESSAGE-REMOVE-FLOW', err)
                .subscribe(message =>  notification(message, 'error'));
            });
        }
      });
  }

  public _updateFlow(flow: any) {
    this._isCurrentProcessDirty = true;

    function cleanPaths(paths: any) {
      _.each(_.keys(paths), key => {
        if (key !== 'root' && key !== 'nodes') {
          delete paths[key];
        }
      });
    }

    // processing this._flow to pure JSON object
    flow = _.cloneDeep(flow);
    cleanPaths(flow.paths);
    flow.schemas = _.get(this.handlers, 'root.schemas');

    if (flow.errorHandler && !_.isEmpty(flow.errorHandler.paths)) {
      cleanPaths(flow.errorHandler.paths);
    }

    return this._flowService.saveFlow(this.flowId, flow).then(rsp => {
      if (_.isEmpty(flow.items)) {
        this.hasTask = false;
      }
      console.groupCollapsed('Flow updated');
      console.log(rsp);
      console.groupEnd();
      return rsp;
    });

  }

  private _loadFlow(flowId: string) {
    this.loading = true;
    return this._flowService.getFlow(flowId)
      .then((res: any) => {
        const FLOW_HANDLER_TYPE_ROOT = 'root';
        const FLOW_HANDLER_TYPE_ERROR = 'errorHandler';
        this.flow = res.flow;
        this.flowName = this.flow.name;
        this.handlers = {
          [FLOW_HANDLER_TYPE_ROOT]: res.root,
          [FLOW_HANDLER_TYPE_ERROR]: res.errorHandler
        };

        this.mainHandler = this.handlers[FLOW_HANDLER_TYPE_ROOT];
        this.errorHandler = this.handlers[FLOW_HANDLER_TYPE_ERROR];
        if (_.isEmpty(this.mainHandler.tasks)) {
          this.hasTask = false;
        }

        this.triggersList = res.triggers;

        this.clearAllHandlersRunStatus();
        this.loading = false;
        this.profileService.initializeProfile(this.flow.app);
        this.profileType = this.profileService.currentApplicationProfile;
      });
  }

  private _getCurrentState(taskID: string) {
    const steps = this.runState.steps || [];
    let id: any = taskID;
    try { // try to decode the base64 encoded taskId to number
      id = flogoIDDecode(taskID);
    } catch (e) {
      console.warn(e);
    }
    // allow double equal check for legacy ids that were type number
    /* tslint:disable-next-line:triple-equals */
    return steps.find(step => id == step.taskId);
  }

  private _cleanSelectionStatus() {
    const allNodes = _.reduce(this.handlers, (nodesAccumulator, handle) => {
      return _.assign(
        nodesAccumulator,
        _.get(handle, 'diagram.nodesOfAddType', {}),
        _.get(handle, 'diagram.nodes', {})
      );
    }, {});
    _.forEach(allNodes, node => _.set(node, '__status.isSelected', false));

    this._postService.publish(FLOGO_DIAGRAM_PUB_EVENTS.render);
  }


  private _errorPanelStatusChanged(isOpened: boolean, data: any, envelope: any) {

    console.group('Close/open error panel from error panel');

    // clean selection status

    const allNodes = _.reduce(this.handlers, (nodesAccumulator, handle) => {
      return _.assign(nodesAccumulator,
        _.get(handle, 'diagram.nodesOfAddType', {}),
        _.get(handle, 'diagram.nodes',
          {})
      );
    }, {});
    _.forEach(allNodes, node => _.set(node, '__status.isSelected', false));

    this._postService.publish(FLOGO_DIAGRAM_PUB_EVENTS.render);

    // clean selection status
    this._cleanSelectionStatus();

    this._navigateFromModuleRoot();

    console.groupEnd();

  }

  private uniqueTaskName(taskName: string) {
    // TODO for performance pre-normalize and store task names?
    const newNormalizedName = normalizeTaskName(taskName);

    // All activities are gathered in one variable
    const allTasks = _.reduce(this.handlers, (all: any, current: any) => _.assign(all, current.tasks), {});

    // search for the greatest index in all the flow
    const greatestIndex = _.reduce(allTasks, (greatest: number, task: any) => {
      const currentNormalized = normalizeTaskName(task.name);
      let repeatIndex = 0;
      if (newNormalizedName === currentNormalized) {
        repeatIndex = 1;
      } else {
        const match = /^(.*)\-([0-9]+)$/.exec(currentNormalized); // some-name-{{integer}}
        if (match && match[1] === newNormalizedName) {
          repeatIndex = _.toInteger(match[2]);
        }
      }

      return repeatIndex > greatest ? repeatIndex : greatest;

    }, 0);

    return greatestIndex > 0 ? `${taskName} (${greatestIndex + 1})` : taskName;
  }

  private _getCurrentTaskContext(taskId: any, diagramId: string): TaskContext {
    const taskType = this.handlers[diagramId].tasks[taskId].type;
    return {
      isTrigger: taskType === FLOGO_TASK_TYPE.TASK_ROOT,
      isBranch: taskType === FLOGO_TASK_TYPE.TASK_BRANCH,
      isTask: taskType === FLOGO_TASK_TYPE.TASK,
      hasProcess: Boolean(this.runState.currentProcessId),
      isDiagramEdited: this._isDiagramEdited,
      app: null,
      currentTrigger: null,
      profileType: this.profileType
    };
  }

  /*-------------------------------*
   |       EXPORT AND IMPORT       |
   *-------------------------------*/

  private _exportTriggerAndFlow() {
    const flow = this._exportFlow();
    const trigger = this._exportTrigger();

    return Promise.all([trigger, flow]);
  }

  private _exportFlow() {
    return new Promise((resolve, reject) => {
      const jsonFlow = flogoFlowToJSON(this.flow);
      return resolve({ fileName: 'flow.json', data: jsonFlow.flow });
    });
  }

  private _exportTrigger() {
    return new Promise((resolve, reject) => {
      const jsonTrigger = triggerFlowToJSON(this.flow);
      resolve({ fileName: 'trigger.json', data: jsonTrigger });
    });
  }

  /**
   *
   * @param urlParts empty to navigate to module root
   * @returns {Promise<boolean>}
   * @private
   */
  private _navigateFromModuleRoot(urlParts = []) {
    return this._router.navigate(['/flows', this.flowId, ...urlParts]);
  }

  /*-------------------------------*
   |       DESIGN FLOW              |
   *-------------------------------*/

  public changeFlowDetail($event, property) {
    return new Promise((resolve, reject) => {
      this._updateFlow(this.flow).then((response: any) => {
        const message = this.translate.instant('CANVAS:SUCCESS-MESSAGE-UPDATE', { value: property });
        notification(message, 'success', 3000);
        resolve(response);
      }).catch((err) => {
        const message = this.translate.instant('CANVAS:ERROR-MESSAGE-UPDATE', { value: property });
        notification(message, 'error');
        reject(err);
      });
    });

  }

  public changeFlowDetailName(name, property) {
    if (name === this.flowName) {
      return Promise.resolve(true);
    }

    return this._flowService.listFlowsByName(this.flow.appId, name)
      .then((flows) => {
        const results = flows || [];
        if (!_.isEmpty(results)) {
          if (results[0].id === this.flowId) {
            return;
          }
          const message = this.translate.instant('CANVAS:FLOW-NAME-EXISTS', { value: name });
          this.flow.name = this.flowName;
          notification(message, 'error');
          return results;
        } else {
          this.flow.name = name;
          this._updateFlow(this.flow).then((response: any) => {
            const message = this.translate.instant('CANVAS:SUCCESS-MESSAGE-UPDATE', { value: property });
            this.flowName = this.flow.name;
            notification(message, 'success', 3000);
            return response;
          }).catch((err) => {
            const message = this.translate.instant('CANVAS:ERROR-MESSAGE-UPDATE', { value: property });
            notification(message, 'error');
            return Promise.reject(err);
          });
        }
      })
      .catch((err) => {
        const message = this.translate.instant('CANVAS:ERROR-MESSAGE-UPDATE', { value: property });
        notification(message, 'error');
        return Promise.reject(err);
      });
  }

  private _addTriggerFromDiagram(data: any, envelope: any) {
    console.group('Add trigger message from diagram');
    console.log(data);
    console.log(envelope);

    this._navigateFromModuleRoot(['trigger', 'add'])
      .then(
        () => {
          console.group('after navigation');

          this._postService.publish(
            _.assign(
              {}, FLOGO_TRIGGERS_PUB_EVENTS.addTrigger, {
                data: data
              }
            )
          );

          console.groupEnd();
        });

    console.groupEnd();
  }

  private getSettingsCurrentHandler() {
    let settings;
    let outputs;
    for (const key in this.flow.items) {
      if (this.flow.items[key].type === FLOGO_TASK_TYPE.TASK_ROOT) {
        settings = objectFromArray(this.flow.items[key].endpoint.settings, true);
        outputs = objectFromArray(this.flow.items[key].outputs, true);
      }
    }

    return { settings, outputs };
  }

  private _onActionTrigger(data: any, envelope: any) {

    if (data.action === 'trigger-copy') {
      const triggerSettings = _.pick(this.currentTrigger, ['name', 'description', 'ref', 'settings']);
      this._restAPITriggersService.createTrigger(this.app.id, triggerSettings)
        .then((createdTrigger) => {
          this.currentTrigger = createdTrigger;
          const settings = this.getSettingsCurrentHandler();
          return this._restAPIHandlerService.updateHandler(createdTrigger.id, this.flow.id, settings)
            .then((res) => {
              const message = this.translate.instant('CANVAS:COPIED-TRIGGER');
              notification(message, 'success', 3000);
              this._restAPIAppsService.getApp(this.flow.app.id)
                .then((app) => {
                  const updatedTriggerDetails = _.assign({}, this.currentTrigger);
                  updatedTriggerDetails.handlers.push(_.assign({}, _.pick(res, [
                    'actionId',
                    'createdAt',
                    'outputs',
                    'settings',
                    'updatedAt'
                  ])));
                  this.currentTrigger = updatedTriggerDetails;
                  this.app = app;
                  this._postService.publish(_.assign({}, FLOGO_SELECT_TASKS_PUB_EVENTS.updateTriggerTask, {
                    data: {
                      updatedApp: app,
                      updatedTrigger: updatedTriggerDetails
                    }
                  }));
                });
            });
        });
    }

  }

  private _addTriggerFromTriggers(data: any, envelope: any) {
    console.group('Add trigger message from trigger');

    console.log(data);
    console.log(envelope);

    // generate trigger id when adding the trigger;
    //  TODO replace the task ID generation function?
    const trigger = <IFlogoFlowDiagramTask> _.assign({}, data.trigger, { id: flogoGenTriggerID() });

    const diagramId = data.id;
    const handler = this.handlers[diagramId];

    if (handler === this.errorHandler) {
      trigger.id = this.profileService.generateTaskID(this._getAllTasks());
    }
    const tasks = handler.tasks || [];

    this.handlers['root']['schemas'] = this.handlers['root']['schemas'] || {};
    trigger.ref = trigger.ref || trigger['__schema'].ref;
    this.handlers['root']['schemas'][trigger.ref] = trigger;
    delete trigger['__schema'];
    tasks[trigger.id] = trigger;


    let resultCreateTrigger;
    const settings = objectFromArray(data.trigger.endpoint.settings, false);
    const outputs = objectFromArray(data.trigger.outputs, false);

    if (data.installType === 'installed') {
      const appId = this.flow.app.id;
      const triggerInfo: any = _.pick(data.trigger, ['name', 'ref', 'description']);
      triggerInfo.settings = objectFromArray(data.trigger.settings || [], false);

      resultCreateTrigger = this._restAPITriggersService.createTrigger(appId, triggerInfo)
        .then((triggerResult) => {
          const triggerId = triggerResult.id;
          return this._restAPIHandlerService.updateHandler(triggerId, this.flow.id, { settings, outputs });
        });
    } else {
      const triggerId = data.trigger.id;
      resultCreateTrigger = this._restAPIHandlerService.updateHandler(triggerId, this.flow.id, { settings, outputs });
    }

    resultCreateTrigger
      .then(() => this._loadFlow(this.flowId))
      .then(() => {
        this.hasTrigger = true;
        return this._navigateFromModuleRoot();
      })
      .then(
        () => {
          this._postService.publish(
            _.assign(
              {}, FLOGO_DIAGRAM_PUB_EVENTS.addTrigger, {
                data: {
                  id: data.id,
                  node: data.node,
                  task: trigger
                },
                done: (diagram: IFlogoFlowDiagram) => {
                  _.assign(handler.diagram, diagram);
                  this._updateFlow(this.flow);
                  this._isDiagramEdited = true;
                }
              }
            )
          );
        }
      );


    console.groupEnd();
  }

  private _addTaskFromDiagram(data: any, envelope: any) {
    console.group('Add task message from diagram');

    console.log(data);
    console.log(envelope);

    this._navigateFromModuleRoot(['task', 'add'])
      .then(
        () => {
          console.group('after navigation');

          data.appProfileType = this.profileType;

          this._postService.publish(
            _.assign(
              {}, FLOGO_ADD_TASKS_PUB_EVENTS.addTask, {
                data: data
              }
            )
          );

          console.groupEnd();
        });

    console.groupEnd();
  }

  private _addTaskFromTasks(data: any, envelope: any) {
    const diagramId: string = data.id;
    console.group('Add task message from task');

    console.log(data);
    console.log(envelope);

    const doRegisterTask = _registerTask.bind(this);

    if (this.handlers[diagramId] === this.errorHandler && _.isEmpty(this.errorHandler.tasks)) {
      const errorTrigger = makeDefaultErrorTrigger(this.profileService.generateTaskID(this._getAllTasks()));
      this.errorHandler.tasks[errorTrigger.id] = errorTrigger;

      this._postService.publish(
        _.assign(
          {}, FLOGO_DIAGRAM_PUB_EVENTS.addTask, {
            data: {
              node: null,
              task: errorTrigger,
              id: data.id
            },
            done: (diagram: IFlogoFlowDiagram) => {
              _.assign(this.handlers[diagramId].diagram, diagram);
              this._updateFlow(this.flow);
              this._isDiagramEdited = true;
              doRegisterTask();
            }
          }
        )
      );

    } else {
      doRegisterTask();
    }

    function _registerTask() {
      let task = data.task;
      const taskName = this.uniqueTaskName(data.task.name);
      // generate task id when adding the task
      task = <IFlogoFlowDiagramTask> _.assign({},
        task,
        {
          id: this.profileService.generateTaskID(this._getAllTasks(), task),
          name: taskName
        });

      const handler = this.handlers[diagramId];
      if (!handler.tasks) {
        handler.tasks = {};
      }
      handler.tasks[task.id] = task;

      const rootHandler = this.handlers.root;
      rootHandler.schemas = rootHandler.schemas || {};
      const schema = task.__schema;
      task.ref = task.ref || schema.ref;
      rootHandler.schemas[task.ref] = schema;
      this.flow.schemas = Object.assign({}, this.flow.schemas, rootHandler.schemas);
      delete task['__schema'];
      const isMapperTask = isMapperActivity(schema);

      this._navigateFromModuleRoot()
        .then(
          () => {
            this._postService.publish(
              _.assign(
                {}, FLOGO_DIAGRAM_PUB_EVENTS.addTask, {
                  data: {
                    node: data.node,
                    task: task,
                    id: data.id
                  },
                  // todo: remove, this is a temporal solution to prevent auto opening a new tile
                  skipTaskAutoSelection: isMapperTask,
                  done: (diagram: IFlogoFlowDiagram) => {
                    _.assign(this.handlers[diagramId].diagram, diagram);
                    this._updateFlow(this.flow);
                    this._isDiagramEdited = true;
                    this.hasTask = true;
                    if (isMapperTask) {
                      // todo: remove, this is a temporal solution to clear the diagram selection state
                      this._cleanSelectionStatus();
                    }
                  }
                }
              )
            );
          }
        );
    }

    console.groupEnd();

  }

  private getTriggerCurrentFlow(app, flowId) {
    let trigger: any = null;
    const triggersForCurrentApp = app.triggers.filter(t => t.appId === app.id);

    // todo: unnecessary, app.triggers.filter is true?
    if (triggersForCurrentApp) {
      triggersForCurrentApp.forEach((currentTrigger) => {
        const handlers = currentTrigger.handlers.find((handler) => {
          return handler.actionId === flowId;
        });

        if (handlers) {
          trigger = currentTrigger;
          return trigger;
        }
      });
    }
    return trigger;
  }


  private _selectTriggerFromDiagram(data: any, envelope: any) {
    const diagramId: string = data.id;
    console.group('Select trigger message from diagram');

    console.log(data);
    console.log(envelope);


    this._navigateFromModuleRoot(['task', data.node.taskID])
      .then(
        () => {
          console.group('after navigation');
          let appPromise = null;
          appPromise = (this.app) ? Promise.resolve(this.app) : this._restAPIAppsService.getApp(this.flow.app.id);

          appPromise
            .then((app) => {
              // Refresh task detail
              const currentStep = this._getCurrentState(data.node.taskID);
              const currentTask = this.handlers[diagramId].tasks[data.node.taskID];
              const context = this._getCurrentTaskContext(data.node.taskID, diagramId);

              if (!this.currentTrigger) {
                this.currentTrigger = this.getTriggerCurrentFlow(app, this.flow.id);
              }

              context.currentTrigger = this.currentTrigger;

              context.app = app;
              this.app = app;

              this._restAPIHandlerService.getHandler(this.currentTrigger.id, this.flow.id)
                .then((handler) => {
                  this._updateAttributesChanges(currentTask, handler.outputs, 'outputs');

                  this._postService.publish(
                    _.assign(
                      {}, FLOGO_SELECT_TASKS_PUB_EVENTS.selectTask, {
                        data: _.assign({}, data,
                          { task: currentTask },
                          { step: currentStep },
                          { context: context }
                        ),
                        done: () => {
                          // select task done
                          //  only need this publish if the trigger has been changed
                          this._postService.publish(
                            _.assign(
                              {}, FLOGO_DIAGRAM_PUB_EVENTS.selectTrigger, {
                                data: {
                                  node: data.node,
                                  task: currentTask, // this.handlers[diagramId].tasks[data.node.taskID],
                                  id: data.id
                                },
                                done: (diagram: IFlogoFlowDiagram) => {
                                  _.assign(this.handlers[diagramId].diagram, diagram);
                                  // this._updateFlow( this.flow ); // doesn't need to save if only selecting without any change
                                }
                              }
                            )
                          );

                        }
                      }
                    )
                  );

                });


              console.groupEnd();
            });


        }
      );


    console.groupEnd();
  }

  private _selectTaskFromDiagram(data: any, envelope: any) {
    const diagramId = data.id;

    console.group('Select task message from diagram');
    console.log(data);
    console.log(envelope);

    // Refresh task detail
    const currentStep = this._getCurrentState(data.node.taskID);
    const currentTask = _.cloneDeep(this.handlers[diagramId].tasks[data.node.taskID]);
    const context = this._getCurrentTaskContext(data.node.taskID, diagramId);

    const activitySchema = this.flow.schemas[currentTask.ref];
    const isMapperTask = isMapperActivity(activitySchema);
    if (isMapperTask) {
      return this._navigateFromModuleRoot()
      // because diagram forces "open" task event when adding a new one
        .then(() => this._selectTransformFromDiagram(data, envelope, true))
        .then(() => this._cleanSelectionStatus())
        .then(() => console.groupEnd());
    }
    this._navigateFromModuleRoot(['task', data.node.taskID])
      .then(
        () => {
          console.group('after navigation');
          this.openTaskDetail(diagramId, data, currentTask, currentStep, context);
          console.groupEnd();
        }
      );

    console.groupEnd();
  }

  private openTaskDetail(diagramId: string, data: any, currentTask: any, currentStep: Step, context: TaskContext) {
    this._postService.publish(
      _.assign(
        {}, FLOGO_SELECT_TASKS_PUB_EVENTS.selectTask, {
          data: _.assign({},
            data,
            { task: currentTask, step: currentStep, context }
          ),

          done: () => {
            // select task done
            this._postService.publish(
              _.assign(
                {}, FLOGO_DIAGRAM_PUB_EVENTS.selectTask, {
                  data: {
                    node: data.node,
                    task: this.handlers[diagramId].tasks[data.node.taskID],
                    id: diagramId
                  },
                  done: (diagram: IFlogoFlowDiagram) => {
                    _.assign(this.handlers[diagramId].diagram, diagram);
                    // this._updateFlow( this.flow ); // doesn't need to save if only selecting without any change
                  }
                }
              )
            );

          }
        }
      )
    );
  }

  private _changeTileDetail(data: {
    content: string;
    proper: string;
    taskId: any,
    id: string,
    tileType: string
  }, envelope: any) {
    if (data.tileType === 'activity') {
      const task = this.handlers[data.id].tasks[data.taskId];

      if (task) {
        if (data.proper === 'name') {
          task[data.proper] = this.uniqueTaskName(data.content);
        } else {
          task[data.proper] = data.content;
        }
        const updateObject = {};

        const propsToUpdateFormBuilder: IPropsToUpdateFormBuilder = <IPropsToUpdateFormBuilder> {};

        propsToUpdateFormBuilder.name = task.name;

        this._updateFlow(this.flow).then(() => {
          this._postService.publish(FLOGO_DIAGRAM_PUB_EVENTS.render);
          this._postService.publish(
            _.assign(
              {}, FLOGO_TASK_PUB_EVENTS.updatePropertiesToFormBuilder, {
                data: propsToUpdateFormBuilder
              }
            )
          );
        });

        if (task.type === FLOGO_TASK_TYPE.TASK_ROOT) {
          updateObject[data.proper] = task[data.proper];
          this._restAPITriggersService.updateTrigger(this.currentTrigger.id, updateObject);
        }


      }
    }
  }

  private _deleteTaskFromDiagram(data: any, envelope: any) {
    const diagramId: string = data.id;

    console.group('Delete task message from diagram');

    console.log(data);
    // data.id = this.flow._id;

    const task = this.handlers[diagramId].tasks[_.get(data, 'node.taskID', '')];
    const node = this.handlers[diagramId].diagram.nodes[_.get(data, 'node.id', '')];
    const _diagram = this.handlers[diagramId].diagram;

    // TODO
    //  refine confirmation
    //  delete trigger isn't hanlded
    if (task) {
      this._flogoModal.confirmDelete('Are you sure you want to delete this task?').then((res) => {
        if (res) {

          // clear details panel, if the selected activity is deleted
          // verify if should jump back to detail page before sending delete message
          let _shouldGoBack = false;
          const parsedURL = location.pathname.split('task/');
          if (parsedURL.length === 2 && _.isString(parsedURL[1])) {

            const currentTaskID = parsedURL[1];
            const deletingTaskID = _.get(data, 'node.taskID', '');

            // if the current task ID in the URL is the deleting task, or
            // if the deleting task has branches or itself is branch, and the current task is in one of the branches
            // navigate to the flow default view
            if (currentTaskID === deletingTaskID || // if the current task ID in the URL is the deleting task

              // if the deleting task has branches or itself is branch, and the current task is in one of the branches
              ((_.some(_.get(data, 'node.children', []), (nodeId: string) => {

                  // try to find children of NODE_BRANCH type
                  return _diagram.nodes[nodeId].type === FLOGO_FLOW_DIAGRAM_NODE_TYPE.NODE_BRANCH;

                }) || _.get(data, 'node.type') === FLOGO_FLOW_DIAGRAM_NODE_TYPE.NODE_BRANCH)
                && (function isTaskIsChildOf(taskID: string, parentNode: any, isInBranch = false): boolean {

                  // traversal the downstream task
                  const children = _.get(parentNode, 'children', []);

                  if (parentNode.type === FLOGO_FLOW_DIAGRAM_NODE_TYPE.NODE_BRANCH) {
                    isInBranch = true;
                  }

                  if (taskID === _.get(parentNode, 'taskID')) {
                    return isInBranch; // if in branch, then should go back, otherwise ignore
                  } else if (children.length === 0) { // no child
                    return false;
                  } else { // resursive call to the next level
                    return _.some(children, (childID: string) => {
                      return isTaskIsChildOf(taskID, _diagram.nodes[childID], isInBranch);
                    });
                  }

                }(currentTaskID, data.node)))) {
              _shouldGoBack = true;
            }
          }

          this._postService.publish(
            _.assign(
              {}, FLOGO_DIAGRAM_PUB_EVENTS.deleteTask, {
                data: {
                  node: data.node,
                  id: diagramId
                },
                done: (diagram: IFlogoFlowDiagram) => {
                  // TODO
                  //  NOTE that once delete branch, not only single task is removed
                  const tasks = this.handlers[diagramId].tasks;
                  delete tasks[_.get(data, 'node.taskID', '')];
                  const taskIds = Object.keys(tasks);
                  if ((diagramId === 'errorHandler') && (taskIds.length === 1 ) && (tasks[taskIds[0]].type === FLOGO_TASK_TYPE.TASK_ROOT)) {
                    this.flow.errorHandler = {
                      paths: {},
                      items: {}
                    };
                    const errorTasks = this.flow.errorHandler.items;
                    const errorDiagram = this.flow.errorHandler.paths = <IFlogoFlowDiagram>{
                      root: {},
                      nodes: {}
                    };
                    this.handlers[diagramId] = {
                      diagram: errorDiagram,
                      tasks: errorTasks
                    };
                    this.errorHandler = this.handlers[diagramId];
                  } else {
                    _.assign(this.handlers[diagramId].diagram, diagram);
                  }
                  this._updateFlow(this.flow);
                  this._isDiagramEdited = true;

                  if (_shouldGoBack) {
                    this._navigateFromModuleRoot();
                  }
                }
              }
            )
          );
        }
      }).catch((err) => {
        console.error(err);
      });
    }

    console.groupEnd();
  }

  private _addBranchFromDiagram(data: any, envelope: any) {
    const diagramId: string = data.id;

    console.group('Add branch message from diagram');
    console.log(data);

    // TODO
    //  remove this mock later
    //    here just creating a branch node with new branch info

    const branchInfo = {
      id: flogoGenBranchID(),
      type: FLOGO_TASK_TYPE.TASK_BRANCH,
      condition: 'true'
    };

    this.handlers[diagramId].tasks[branchInfo.id] = branchInfo;

    this._postService.publish(_.assign({}, FLOGO_DIAGRAM_PUB_EVENTS.addBranch, {
      data: {
        node: data.node,
        task: branchInfo,
        id: diagramId
      },
      done: (diagram: IFlogoFlowDiagram) => {
        _.assign(this.handlers[diagramId].diagram, diagram);
        this._updateFlow(this.flow);
      }
    }));

    console.groupEnd();
  }

  private _selectBranchFromDiagram(data: any, envelope: any) {
    const diagramId: string = data.id;
    console.group('Select branch message from diagram');

    console.log(data);

    // TODO
    //  reference to _selectTaskFromDiagram
    //  may need to route to some other URL?
    const currentStep = this._getCurrentState(data.node.taskID);
    const currentTask = _.assign({}, _.cloneDeep(this.handlers[diagramId].tasks[data.node.taskID]));
    const context = this._getCurrentTaskContext(data.node.taskID, diagramId);

    const selectedNode = data.node;
    const previousNodes = this.findPathToNode(this.handlers[diagramId].diagram.root.is, selectedNode.id, diagramId);
    previousNodes.pop(); // ignore last item as it is the very same selected node
    const previousTiles = this.mapNodesToTiles(previousNodes, this.handlers[diagramId]);


    this._navigateFromModuleRoot(['task', data.node.taskID])
      .then(
        () => {
          console.group('after navigation');

          this._postService.publish(
            _.assign(
              {}, FLOGO_SELECT_TASKS_PUB_EVENTS.selectTask, {
                data: _.assign({},
                  data,
                  { task: currentTask },
                  { step: currentStep },
                  {
                    context: _.assign(context, {
                      contextData: {
                        previousTiles: previousTiles
                      }
                    })
                  }
                ),

                done: () => {
                  // select task done
                  this._postService.publish(
                    _.assign(
                      {}, FLOGO_DIAGRAM_PUB_EVENTS.selectTask, {
                        data: {
                          node: data.node,
                          task: this.handlers[diagramId].tasks[data.node.taskID]
                        },
                        done: (diagram: IFlogoFlowDiagram) => {
                          _.assign(this.handlers[diagramId].diagram, diagram);
                          // this._updateFlow(this.flow);
                        }
                      }
                    )
                  );

                }
              }
            )
          );

          console.groupEnd();
        }
      );

    console.groupEnd();
  }

  private _taskDetailsChanged(data: any, envelope: any) {
    const diagramId = data.id;

    console.group('Save task details to flow');
    const task = this.handlers[diagramId].tasks[data.taskId];

    if (task.type === FLOGO_TASK_TYPE.TASK) { // TODO handle more activity task types in the future
      // set/unset the warnings in the tile
      _.set(task, '__props.warnings', data.warnings);

      const changedInputs = data.inputs || {};
      this._updateAttributesChanges(task, changedInputs, 'attributes.inputs');

    } else if (task.type === FLOGO_TASK_TYPE.TASK_ROOT) { // trigger
      let updatePromise: any = Promise.resolve(true);

      if (data.changedStructure === 'settings') {
        updatePromise = this._restAPITriggersService.updateTrigger(this.currentTrigger.id, { settings: data.settings });
      } else if (data.changedStructure === 'endpointSettings' || data.changedStructure === 'outputs') {
        updatePromise = this._restAPIHandlerService.updateHandler(this.currentTrigger.id, this.flow.id, {
          settings: data.endpointSettings,
          outputs: data.outputs
        });

      }

      updatePromise
        .then((res) => {
          this._updateAttributesChanges(task, data.settings, 'settings');
          this._updateAttributesChanges(task, data.endpointSettings, 'endpoint.settings');
          this._updateAttributesChanges(task, data.outputs, 'outputs');

          // ensure the persence of the internal properties
          task.__props = task.__props || {};

          // cache the outputs mock of a trigger, to be used as initial data when start/restart the flow.
          task.__props['outputs'] = _.map(_.get(task, 'outputs', []), (output: any) => {
            const newValue = data.outputs[output.name];

            // undefined is invalid default value, hence filter that out.
            if (output && !_.isUndefined(newValue)) {
              output.value = newValue;
            }

            return output;
          });
        });


    } else if (task.type === FLOGO_TASK_TYPE.TASK_BRANCH) { // branch
      task.condition = data.condition;
    }

    if (_.isFunction(envelope.done)) {
      envelope.done();
    }

    this._updateFlow(this.flow).then(() => {
      this._postService.publish(FLOGO_DIAGRAM_PUB_EVENTS.render);
    });

    console.groupEnd();
  }

  private _updateAttributesChanges(task: any, changedInputs: any, structure: any) {

    for (const name in changedInputs) {
      if (!changedInputs.hasOwnProperty(name)) {
        const attributes = _.get(task, structure, []);

        // todo: do not create function in loop
        attributes.forEach((input) => {
          if (input.name === name) {
            input['value'] = changedInputs[name];
          }
        });
      }
    }

  }

  private _setTaskWarnings(data: any, envelope: any) {
    const diagramId = data.id;

    const task = this.handlers[diagramId].tasks[data.taskId];

    if (task) {
      _.set(task, '__props.warnings', data.warnings);

      this._updateFlow(this.flow).then(() => {
        this._postService.publish(FLOGO_DIAGRAM_PUB_EVENTS.render);
      });
    }

  }

  private _getAllTasks() {
    return _.assign({}, this.handlers['root'].tasks, this.handlers['errorHandler'].tasks);
  }

  /*-------------------------------*
   |      RUN FLOW                 |
   *-------------------------------*/

  /* TODO: Need to deprecate this method as it is no longer needed*/
  private _runFromTriggerinTile(data: any, envelope: any) {
    const diagramId: string = data.id;
    const currentDiagram: any = this.handlers[diagramId];

    console.group('Run from Trigger');

    this._runFromRoot().then((res) => {
      const currentStep = this._getCurrentState(data.taskId);
      const currentTask = _.assign({}, _.cloneDeep(currentDiagram.tasks[data.taskId]));
      const context = this._getCurrentTaskContext(data.taskId, diagramId);

      this._postService.publish(
        _.assign(
          {}, FLOGO_SELECT_TASKS_PUB_EVENTS.selectTask, {
            data: _.assign({},
              data,
              { task: currentTask, step: currentStep, context }
            )
          }
        ));
    })
      .catch(
        (err: any) => {
          console.error(err);
          return err;
        }
      );

    console.groupEnd();
  }

  private _runFromRoot() {
    this._postService.publish(FLOGO_ERROR_PANEL_PUB_EVENTS.closePanel);

    this._isDiagramEdited = false;
    this.cleanDiagramRunState();
    this.markRootAsRan();

    // The initial data to start the process from trigger
    const initData = this.getInitDataForRoot();
    const runOptions: RunOptions = { attrsData: initData };
    const shouldUpdateFlow = this._isCurrentProcessDirty || !this.runState.currentProcessId;
    if (shouldUpdateFlow) {
      runOptions.useFlow = this.flow;
    } else {
      runOptions.useProcessId = this.runState.currentProcessId;
    }

    this.runState.steps = null;
    const runner = this._runnerService.runFromRoot(runOptions);

    runner.registered.subscribe(info => {
      this.runState.currentProcessId = info.processId;
      this.runState.processInstanceId = info.instanceId;
    }, _.noop); // TODO: remove when fixed https://github.com/ReactiveX/rxjs/issues/2180);

    return this.observeRunProgress(runner)
      .then((runState: RunProgress) => {
        this.runState.lastProcessInstanceFromBeginning = runState.lastInstance;
        return runState;
      })
      .catch(err => this.handleRunError(err));
  }


  // TODO
  //  to do proper restart process, need to select proper snapshot, hence
  //  the current implementation is only for the last start-from-beginning snapshot, i.e.
  //  the using this.runState.processInstanceId to restart
  private _runFromThisTile(data: any, envelope: any) {
    console.group('Run from this tile');

    const selectedTask = this.mainHandler.tasks[data.taskId];

    if (selectedTask.type === FLOGO_TASK_TYPE.TASK_ROOT) {
      this._runFromTriggerinTile(data, envelope);
      return;
    } else if (!this.runState.processInstanceId) {
      // run from other than the trigger (root task);
      // TODO
      console.warn('Cannot find proper step to restart from, skipping...');
      return;
    }

    const step = this._getStepNumberFromSteps(data.taskId);

    if (!step) {
      // TODO
      //  handling the case that trying to start from the middle of a path without run from the trigger for the first time.
      const task = this.mainHandler.tasks[data.taskId];
      console.error(`Cannot start from task ${task.name} (${task.id})`);
      return;
    }

    const attrs = _.get(selectedTask, 'attributes.inputs');
    const dataOfInterceptor = {
      tasks: [{
        id: flogoIDDecode(selectedTask.id),
        inputs: parseInput(attrs, data.inputs),
      }]
    };

    this.runState.steps = null;
    this.clearAllHandlersRunStatus();
    this._postService.publish(FLOGO_DIAGRAM_PUB_EVENTS.render);

    const runner = this._runnerService.rerun({
      useFlow: this.flow,
      interceptor: dataOfInterceptor,
      step: step,
      instanceId: this.runState.processInstanceId,
    });

    this.observeRunProgress(runner)
      .then(() => {
        const currentStep = this._getCurrentState(data.taskId);
        const currentTask = _.assign({}, _.cloneDeep(this.mainHandler.tasks[data.taskId]));
        const context = this._getCurrentTaskContext(data.taskId, 'root');

        this._postService.publish(_.assign({},
          FLOGO_SELECT_TASKS_PUB_EVENTS.selectTask,
          { data: _.assign({}, data, { context, task: currentTask, step: currentStep, }) })
        );

        if (_.isFunction(envelope.done)) {
          envelope.done();
        }

      })
      .catch(err => this.handleRunError(err));

    console.groupEnd();

    function parseInput(formAttrs: any, inputData: any) {
      if (!formAttrs) {
        return [];
      }
      return _.map(formAttrs, (input: any) => {
        // override the value;
        return _.assign(_.cloneDeep(input), {
          value: inputData[input['name']],
          type: attributeTypeToString(input['type'])
        });
      });
    }

  }

  // monitor the status of a process till it's done or up to the max trials
  private observeRunProgress(runner: RunProgressStore): Promise<RunProgress | void> {

    // TODO: remove noop when fixed https://github.com/ReactiveX/rxjs/issues/2180
    runner.processStatus
      .subscribe(processStatus => this.logRunStatus(processStatus), _.noop);

    // TODO: only on run from trigger?
    runner.registered.subscribe(info => {
      this._isCurrentProcessDirty = false;
    }, _.noop); // TODO: remove when fixed https://github.com/ReactiveX/rxjs/issues/2180);

    runner.steps
      .subscribe(steps => {
        if (steps) {
          this.runState.steps = steps;
          this.updateTaskRunStatus(steps, {});
        }
      }, _.noop); // TODO: remove when fixed https://github.com/ReactiveX/rxjs/issues/2180

    return runner.completed
      .do(state => {
        this.runState.steps = state.steps;
        const message = this.translate.instant('CANVAS:SUCCESS-MESSAGE-COMPLETED');
        notification(message, 'success', 3000);
      })
      .toPromise();

  }

  private logRunStatus(processStatus) {
    switch (processStatus.status) {
      case RUNNER_STATUS.NOT_STARTED:
        console.log(`[PROC STATE][${processStatus.trial}] Process has not started.`);
        break;
      case RUNNER_STATUS.ACTIVE:
        console.log(`[PROC STATE][${processStatus.trial}] Process is running...`);
        break;
      case RUNNER_STATUS.COMPLETED:
        console.log(`[PROC STATE][${processStatus.trial}] Process finished.`);
        break;
      case null:
        break;
      default:
        console.warn(`[PROC STATE][${processStatus.trial}] Unknown status.`);
    }
  }

  private cleanDiagramRunState() {
    // clear task status and render the diagram
    this.clearAllHandlersRunStatus();
    this._postService.publish(FLOGO_DIAGRAM_PUB_EVENTS.render);
  }

  private markRootAsRan() {
    const mainHandler = this.mainHandler;
    try { // rootTask should be in DONE status once the flow start
      const rootTask = mainHandler.tasks[mainHandler.diagram.nodes[mainHandler.diagram.root.is].taskID];
      rootTask.__status['hasRun'] = true;
      rootTask.__status['isRunning'] = false;
    } catch (e) {
      console.warn(e);
      console.warn('No root task/trigger is found.');
    }
  }

  private getInitDataForRoot(): { name: string; type: string; value: any }[] {
    const flowInput = _.get(this.flow, 'metadata.input');
    if (_.isEmpty(flowInput)) {
      return undefined;
    }
    // preprocessing initial data
    return _(flowInput)
      .filter((item: any) => {
        // filter empty values
        return !_.isNil(item.value);
      })
      .map((item: any) => {
        // converting the type of the initData from enum to string;
        const outItem = _.cloneDeep(item);
        outItem.type = attributeTypeToString(outItem.type);
        return outItem;
      })
      .value();
  }

  private handleRunError(error) {
    console.error(error);
    // todo: more specific error message?
    let message = null;
    if (error.isOperational) {
      const opError = <OperationalError> error;
      if (opError.name === RUNNER_ERRORS.PROCESS_NOT_COMPLETED) {
        // run error instance has status prop hence the casting to any
        message = (<any>opError).status === RUNNER_STATUS.CANCELLED ? 'CANVAS:RUN-ERROR:RUN-CANCELLED' : 'CANVAS:RUN-ERROR:RUN-FAILED';
      } else if (opError.name === RUNNER_ERRORS.MAX_TRIALS_REACHED) {
        message = 'CANVAS:RUN-ERROR:MAX-REACHED';
      }
    }

    message = message || 'CANVAS:ERROR-MESSAGE';
    notification(this.translate.instant(message), 'error');
    return error;
  }

  private clearAllHandlersRunStatus() {
    Object.keys(this.handlers).forEach(handlerId => {
      const tasks = this.handlers[handlerId].tasks;
      if (_.isEmpty(tasks)) {
        return;
      }
      _.forIn(tasks, (task: any, taskID: string) => {
        // clear errors
        task.__props = task.__props || {};
        task.__props.errors = [];

        // ensure the presence of __status
        task.__status = task.__status || {};
        task.__status.isRunning = false;
        task.__status.hasRun = false;

      });
    });
  }

  private updateTaskRunStatus(steps: Step[], rsp: any) {
    let isErrorHandlerTouched = false;
    const runTasksIDs = <string[]>[];
    const errors = <{
      [index: string]: {
        msg: string;
        time: string;
      }[];
    }>{};
    let isFlowDone = false;
    const runTasks = _.reduce(steps, (result: any, step: any) => {
      let taskID = step.taskId;

      if (taskID !== 'root' && taskID !== 1 && !_.isNil(taskID)) { // if not rootTask and not `null`

        taskID = flogoIDEncode('' + taskID);

        /****
         *  Exclude the tasks which are skipped by the engine while running the flow
         *  but their running task information is generated and maintained
         ****/
        const taskState = step.taskState || 0;
        if (taskState !== RUNNER_STATE.SKIPPED) {
          runTasksIDs.push(taskID);
        }
        const reAttrName = new RegExp(`^_A.${step.taskId}\\..*`, 'g');
        const reAttrErrMsg = new RegExp(`^\{Error.message}`, 'g');

        const taskInfo = _.reduce(_.get(step, 'flow.attributes', []),
          (currentTaskInfo: any, attr: any) => {
                    if (reAttrName.test(_.get(attr, 'name', ''))) {
                      currentTaskInfo[attr.name] = attr;
                    }

                    if (reAttrErrMsg.test(attr.name)) {
                      let errs = <any[]>_.get(errors, `${taskID}`);
                      const shouldOverride = _.isUndefined(errs);
                      errs = errs || [];

                      errs.push({
                        msg: attr.value,
                        time: new Date().toJSON()
                      });

                      if (shouldOverride) {
                        _.set(errors, `${taskID}`, errs);
                      }
                    }
                    return currentTaskInfo;
             }, {});

        result[taskID] = { attrs: taskInfo };
      } else if (_.isNull(taskID)) {
        isFlowDone = true;
      }

      return result;
    }, {});

    _.each(
      runTasksIDs, (runTaskID: string) => {
        let task = this.mainHandler.tasks[runTaskID];

        if (_.isEmpty(task)) {
          task = this.errorHandler.tasks[runTaskID];
          isErrorHandlerTouched = !!task;
        }

        if (task) {
          task.__status['hasRun'] = true;
          task.__status['isRunning'] = false;

          const errs = errors[runTaskID];
          if (!_.isUndefined(errs)) {
            _.set(task, '__props.errors', errs);
          }
        }
      }
    );

    _.set(rsp, '__status', {
      isFlowDone: isFlowDone,
      errors: errors,
      runTasks: runTasks,
      runTasksIDs: runTasksIDs
    });

    // update branch run status after apply the other status.
    updateBranchNodesRunStatus(this.mainHandler.diagram.nodes, this.mainHandler.tasks);
    updateBranchNodesRunStatus(this.errorHandler.diagram.nodes, this.errorHandler.tasks);

    if (isErrorHandlerTouched) {
      this._postService.publish(FLOGO_ERROR_PANEL_PUB_EVENTS.openPanel);
    }

    this._postService.publish(FLOGO_DIAGRAM_PUB_EVENTS.render);

    // when the flow is done on error, throw an error
    // the error is the response with `__status` provisioned.
    if (isFlowDone && !_.isEmpty(errors)) {
      throw rsp;
    }

    // TODO logging
    // console.log( _.cloneDeep( this.tasks ) );

    // TODO
    //  how to verify if a task is running?
    //    should be the next task downstream the last running task
    //    but need to find the node of that task in the diagram

  }

  // TODO
  //  get step index logic should be based on the selected snapshot,
  //  hence need to be refined in the future
  private _getStepNumberFromSteps(taskId: string) {
    let stepNumber = 0;
    // firstly try to get steps from the last process instance running from the beginning,
    // otherwise use some defauts
    const steps = _.get(this.runState.lastProcessInstanceFromBeginning, 'steps', this.runState.steps || []);
    taskId = flogoIDDecode(taskId); // decode the taskId

    steps.forEach((step: any, index: number) => {
      // allowing double equals for legacy ids that were of type number
      /* tslint:disable-next-line:triple-equals */
      if (step.taskId == taskId) {
        stepNumber = index + 1;
      }
    });

    return stepNumber;
  }

  /*-------------------------------*
   |      TRANSFORM                |
   *-------------------------------*/

  private _selectTransformFromDiagram(data: any, envelope: any, outputMapper?: boolean) {
    const diagramId = data.id;
    let scope: any[];

    const selectedNode = data.node;

    if (diagramId === 'errorHandler') {
      const allPathsMainFlow = this.getAllPaths(this.handlers['root'].diagram.nodes);
      const previousTilesMainFlow = this.mapNodesToTiles(allPathsMainFlow, this.handlers['root']);

      const previousNodesErrorFlow = this.findPathToNode(this.handlers['errorHandler'].diagram.root.is, selectedNode.id, 'errorHandler');
      previousNodesErrorFlow.pop(); // ignore last item as it is the very same selected node
      const previousTilesErrorFlow = this.mapNodesToTiles(previousNodesErrorFlow, this.handlers['errorHandler']);

      scope = previousTilesMainFlow.concat(previousTilesErrorFlow);
    } else {
      const previousNodes = this.findPathToNode(this.handlers[diagramId].diagram.root.is, selectedNode.id, diagramId);

      previousNodes.pop(); // ignore last item as it is the very same selected node
      scope = this.mapNodesToTiles(previousNodes, this.handlers[diagramId]);
    }

    const selectedTaskId = selectedNode.taskID;
    const selectedTile = _.cloneDeep(this.handlers[diagramId].tasks[selectedTaskId]);

    const metadata = <FlowMetadata>  _.defaultsDeep({
      type: 'metadata',
    }, this.flow.metadata, { input: [], output: [] });
    scope.push(metadata);

    let overridePropsToMap = null;
    let overrideMappings = null;
    let searchTitleKey;
    let transformTitle;
    if (outputMapper) {
      overridePropsToMap = metadata.output;
      overrideMappings = _.get(selectedTile.attributes.inputs, '[0].value', []);
      transformTitle = this.translate.instant('TRANSFORM:TITLE-OUTPUT-MAPPER', { taskName: selectedTile.title });
      searchTitleKey = 'TRANSFORM:FLOW-OUTPUTS';
    }

    this._postService.publish(
      _.assign(
        {}, FLOGO_TRANSFORM_PUB_EVENTS.selectActivity, {
          data: <SelectTaskData>{
            scope,
            overridePropsToMap,
            overrideMappings,
            tile: selectedTile,
            handlerId: diagramId,
            title: transformTitle,
            inputsSearchPlaceholderKey: searchTitleKey,
          }
        }
      ));

  }

  private _saveTransformFromTransform(data: any, envelope: any) {
    const diagramId = data.id;
    const tile = this.handlers[diagramId].tasks[data.tile.id];
    const activitySchema = this.flow.schemas[tile.ref];
    const isMapperTask = isMapperActivity(activitySchema);
    if (isMapperTask) {
      tile.attributes.inputs = [{
        name: 'mappings',
        type: FLOGO_TASK_ATTRIBUTE_TYPE.ARRAY,
        value: _.cloneDeep(data.inputMappings)
      }];
    } else {
      tile.inputMappings = _.cloneDeep(data.inputMappings);
    }

    this._updateFlow(this.flow).then(() => {
      this._postService.publish(FLOGO_DIAGRAM_PUB_EVENTS.render);
    });

  }

  private _deleteTransformFromTransform(data: any, envelope: any) {
    const diagramId: string = data.id;

    // data.tile.taskId
    const tile = this.handlers[diagramId].tasks[data.tile.id];
    delete tile.inputMappings;

    this._updateFlow(this.flow).then(() => {
      this._postService.publish(FLOGO_DIAGRAM_PUB_EVENTS.render);
    });

  }

  private getAllPaths(nodes: any) {
    return Object.keys(nodes);
  }

  /**
   * Finds a path from starting node to target node
   * Assumes we have a tree structure, meaning we have no cycles
   * @param {string} startNodeId
   * @param {string} targetNodeId
   * @returns string[] list of node ids
   */
  private findPathToNode(startNodeId: any, targetNodeId: any, diagramId: string) {
    const nodes = this.handlers[diagramId].diagram.nodes; // should be parameter?
    let queue = [[startNodeId]];

    while (queue.length > 0) {
      const path = queue.shift();
      const nodeId = path[path.length - 1];

      if (nodeId === targetNodeId) {
        return path;
      }

      const children = nodes[nodeId].children;
      if (children) {
        const paths = children.map(child => path.concat(child));
        queue = queue.concat(paths);
      }

    }

    return [];
  }

  private mapNodesToTiles(nodeIds: any[], from: HandlerInfo) {

    const isApplicableNodeType = _.includes.bind(null, [
      FLOGO_FLOW_DIAGRAM_NODE_TYPE.NODE,
      FLOGO_FLOW_DIAGRAM_NODE_TYPE.NODE_ROOT,
      FLOGO_FLOW_DIAGRAM_NODE_TYPE.NODE_ROOT_ERROR_NEW
    ]);

    return nodeIds
      .map(nodeId => {
        const node = from.diagram.nodes[nodeId];
        if (isApplicableNodeType(node.type)) {
          return from.tasks[node.taskID];
        } else {
          return null;
        }
      })
      .filter(task => !!task);
  }


  /*-------------------------------*
   |      APP NAVIGATION           |
   *-------------------------------*/

  public navigateToApp() {
    this._router.navigate(['/apps', this.flow.appId]);
  }

  public onMouseOverBackControl() {
    this.backToAppHover = true;
  }

  public onMouseOutBackControl() {
    this.backToAppHover = false;
  }

  public openInputSchemaModal() {
    this.defineInputSchema.openInputSchemaModel();
  }

  onRunFlow(modifiedInputs: FlowMetadataAttribute[]) {
    this.flow.metadata.input = modifiedInputs;
    const flowUpdatePromise = modifiedInputs.length ? this._updateFlow(this.flow) : Promise.resolve(this.flow);
    flowUpdatePromise.then(() => this._runFromRoot())
      .then(() => {
        const parsedURL = location.pathname.split('task/');
        if (parsedURL.length === 2 && _.isString(parsedURL[1])) {
          const taskId = parsedURL[1];
          const id = this.getDiagramId(taskId);
          if (id) {
            this._updateTaskOutputAfterRun({ id, taskId });
          }
        }
      });
  }

  private getDiagramId(taskId: string): string {
    let diagramId: string;
    if (this.handlers['root'].tasks[taskId]) {
      diagramId = 'root';
    } else if (this.handlers['errorHandler'].tasks[taskId]) {
      diagramId = 'errorHandler';
    }
    return diagramId;
  }

  private _updateTaskOutputAfterRun(data: {
    id: string,
    taskId: string
  }) {
    const diagramId: string = data.id;
    const currentDiagram: any = this.handlers[diagramId];
    const step = this._getCurrentState(data.taskId);
    const task = _.assign({}, _.cloneDeep(currentDiagram.tasks[data.taskId]));
    const context = this._getCurrentTaskContext(data.taskId, diagramId);

    this._postService.publish(
      _.assign(
        {}, FLOGO_SELECT_TASKS_PUB_EVENTS.selectTask, {
          data: _.assign({},
            data,
            { task, step, context }
          )
        }
      ));
  }

  public onFlowSchemaSave(newMetadata: FlowMetadata) {
    this.flow.metadata.input = this.mergeFlowInputMetadata(newMetadata.input);
    this.flow.metadata.output = newMetadata.output;

    const propCollectionToRegistry = (from) => new Map(<Array<[string, boolean]>>from.map((o: any) => [o.name, true]));

    const outputRegistry = propCollectionToRegistry(newMetadata.output);
    const inputRegistry = propCollectionToRegistry(newMetadata.input);
    this.cleanDanglingTaskOutputMappings(outputRegistry);

    this.cleanDanglingTriggerMappingsToFlow(inputRegistry);
    this._updateFlow(this.flow);
  }

  private mergeFlowInputMetadata(inputMetadata: FlowMetadataAttribute[]): FlowMetadataAttribute[] {
    return inputMetadata.map(input => {
      const existingInput = this.flow.metadata.input.find(i => i.name === input.name && i.type === input.type);
      if (existingInput) {
        input.value = existingInput.value;
      }
      return input;
    });
  }

  // when flow schema's input change we need to remove the trigger mappings that were referencing them
  private cleanDanglingTriggerMappingsToFlow(inputRegistry: Map<string, boolean>) {
    const isApplicableMapping = (mapping) => inputRegistry.has(mapping.mapTo);
    const handlersToUpdate = this.triggersList.reduce((result, trigger) => {
      const handlersToUpdateInTrigger = trigger.handlers
        .filter(handler => handler.actionId === this.flowId)
        .reduce(reduceToUpdatableHandlers, [])
        .map(handler => ({ handler, triggerId: trigger.id }));
      return result.concat(handlersToUpdateInTrigger);
    }, []);
    if (handlersToUpdate.length > 0) {
      return Promise.all(handlersToUpdate.map(({ handler, triggerId }) => {
        return this._restAPIHandlerService.updateHandler(triggerId, this.flowId, handler);
      }));
    }
    return Promise.resolve();

    function reduceToUpdatableHandlers(result, handler) {
      const actionInputMappings = _.get(handler, 'actionMappings.input', []);
      const applicableMappings = actionInputMappings.filter(isApplicableMapping);
      if (applicableMappings.length !== actionInputMappings.length) {
        handler.actionMappings.input = applicableMappings;
        result.push(handler);
      }
      return result;
    }
  }

  // when flow schema's output change we need to remove the task mappings that were referencing them
  private cleanDanglingTaskOutputMappings(outputRegistry: Map<string, boolean>) {
    const isMapperContribAndHasMapping = (task: IFlogoFlowDiagramTask) => {
      const schema = this.flow.schemas[task.ref];
      return isMapperActivity(schema) && task.inputMappings;
    };
    _.filter(this._getAllTasks(), isMapperContribAndHasMapping)
      .forEach((task: IFlogoFlowDiagramTask) => {
        task.inputMappings = task.inputMappings.filter(mapping => outputRegistry.has(mapping.mapTo));
      });
  }

}