'use strict';

var flowPage = {
  flowTitle: {
    get: function () {
      return element(by.css('.flogo-flow-detail-name'));
    }
  },
  addTriggerButton: {
    get: function () {
      return element(by.css('[data-flogo-node-type="node_root_new"]'));
    }
  },
  addActivityButton: {
    get: function () {
      return element(by.css('[data-flogo-node-type="node_add"]'));
    }
  },
  newTrigger: {
    openPanel: function () {
      return flowPage.addTriggerButton
        .get()
        .click()
        .then(function () {
          return flowPage.newTrigger.waitLoaded();
        });
    },
    waitLoaded: waitLoaded.bind(null, '.flogo-flows-detail-triggers__list__item'),
    selectByName: selectListElementByName.bind(null, '.flogo-flows-detail-triggers__list__item')
  },
  newActivity: {
    openPanel: function () {
      flowPage.addActivityButton.get()
        .click()
        .then(function () {
          return flowPage.newActivity.waitLoaded();
        });
    },
    waitLoaded: waitLoaded.bind(null, '.flogo-common-edit-panel__tiles-list-tile'),
    selectByName: selectListElementByName.bind(null, '.flogo-common-edit-panel__tiles-list-tile')
  },
  activityPanel: {
    title: {
      replaceText: function (text) {
        // because it is a conteneditable it will not behave as regular input
        browser.executeScript(function () {
          //noinspection JSUnresolvedVariable
          var range = document.createRange();
          //noinspection JSUnresolvedVariable
          range.selectNode(document.body.querySelector('.flogo-common-edit-panel__head-title').firstChild);
          //noinspection JSUnresolvedVariable
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return sel;
        });
        browser.actions().sendKeys(protractor.Key.BACK_SPACE).sendKeys(text).perform();
      }
    },
    textInput: function (label) {
      return findFieldContainer('flogo-form-builder-fields-textbox', label)
        .element(by.css('input.form-control'));
    },
    textArea: function (label) {
      return findFieldContainer('flogo-form-builder-fields-textarea', label)
        .element(by.css('textarea.form-control'));
    },
    booleanInput: function (label, boolVal) {
      return findFieldContainer('flogo-form-builder-fields-radio', label)
      // we cannot click directly the radio inputs since they're not visible
        .element(by.css(`input[type="radio"][value="${boolVal ? 'true' : 'false'}"] + label`));
    },
    saveButton: {
      get() {
        return element(by.css('.flogo-form-builder-buttons-save'))
      }
    }
  },
  tasks: {
    getTitles: function(taskNodes) {
      return taskNodes.map(node => node.element(by.css('.flogo-flows-detail-diagram-node-detail-title')).getText());
    },
    getOfType: function(types) {
      types = types || [];
      return element.all(by.css('.flogo-flows-detail-diagram-node'))
        .filter(element => element.getAttribute('data-flogo-node-type').then(attrVal => types.indexOf(attrVal) > -1));
    }
  }
};
module.exports = flowPage;

function waitLoaded(selector) {
  var one = element(by.css(selector));
  return browser.wait(protractor.ExpectedConditions.presenceOf(one));
}

function selectListElementByName(elementSelector, name) {
  return element.all(by.css(elementSelector))
    .filter(elem => elem.getText().then(text => text == name))
    .first();
}

function findFieldContainer(type, label) {
  return element
    .all(by.css(type))
    .filter(elem => elem.element(by.css('.flogo-fields-header-field label:nth-child(1)')).getText().then(text => text == label))
    .first();
}



