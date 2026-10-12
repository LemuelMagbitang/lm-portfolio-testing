import assert from 'node:assert/strict';
import { initForms } from '../js/features/forms/index.js';

function makeEmailButton(href) {
  const handlers = new Map();

  return {
    style: { display: '' },
    getAttribute(name) {
      return name === 'href' ? href : null;
    },
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    click() {
      for (const handler of handlers.get('click') || []) handler();
    }
  };
}

const projectHref = 'mailto:artist@example.com?subject=New%20Project%20Inquiry';
const reviewHref = 'mailto:artist@example.com?subject=Portfolio%20Review';
const elements = {
  projectForm: { style: { display: '' } },
  projectEmailBtn: makeEmailButton(projectHref),
  reviewForm: { style: { display: '' } },
  reviewEmailBtn: makeEmailButton(reviewHref)
};
const root = {
  defaultView: { location: { href: '' } },
  getElementById(id) {
    return elements[id] || null;
  },
  querySelectorAll() {
    return [];
  }
};

const forms = initForms({ root, projectEnabled: false, reviewEnabled: false });

assert.equal(elements.projectForm.style.display, 'none');
assert.equal(elements.reviewForm.style.display, 'none');
assert.equal(elements.projectEmailBtn.style.display, '');
assert.equal(elements.reviewEmailBtn.style.display, '');

elements.projectEmailBtn.click();
assert.equal(root.defaultView.location.href, projectHref, 'Project fallback must keep the project-inquiry subject');

root.defaultView.location.href = '';
elements.reviewEmailBtn.click();
assert.equal(root.defaultView.location.href, reviewHref, 'Review fallback must keep the review subject, not use the first mailto link');

forms.setProjectEnabled(true);
forms.setReviewEnabled(true);
assert.equal(elements.projectForm.style.display, '');
assert.equal(elements.reviewForm.style.display, '');
assert.equal(elements.projectEmailBtn.style.display, 'none');
assert.equal(elements.reviewEmailBtn.style.display, 'none');

forms.cleanup();
root.defaultView.location.href = '';
elements.reviewEmailBtn.click();
assert.equal(root.defaultView.location.href, '', 'Cleanup must remove the review fallback listener');


function makeContactElement(attributes = {}, active = false) {
  const values = new Map(Object.entries(attributes));
  const classes = new Set(active ? ['is-contact-active'] : []);
  const listeners = new Map();
  return {
    parentElement: null,
    bounds: null,
    getBoundingClientRect() { return this.bounds || { left: 0, right: 0 }; },
    get id() { return values.get('id') || ''; },
    tabIndex: 0,
    focused: false,
    focus() { this.focused = true; },
    classList: {
      contains(name) { return classes.has(name); },
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      }
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    click() {
      for (const handler of listeners.get('click') || []) handler();
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) handler(event);
    },
    getAttribute(name) { return values.has(name) ? values.get(name) : null; },
    setAttribute(name, value) { values.set(name, String(value)); },
    removeAttribute(name) { values.delete(name); }
  };
}

const contactRail = makeContactElement();
const projectTab = makeContactElement({ id: 'contactTabProject', 'data-contact-tab': 'project', 'aria-selected': 'true' });
const reviewTab = makeContactElement({ id: 'contactTabReview', 'data-contact-tab': 'review', 'aria-selected': 'false' });
projectTab.parentElement = contactRail;
reviewTab.parentElement = contactRail;
projectTab.bounds = { left: 0, right: 150 };
reviewTab.bounds = { left: 150, right: 300 };
const projectPanel = makeContactElement({ 'data-contact-panel': 'project' }, true);
const reviewPanel = makeContactElement({ 'data-contact-panel': 'review' });
const contactTabs = [projectTab, reviewTab];
const contactPanels = [projectPanel, reviewPanel];
const mobileQuery = { matches: false };
const resizeHandlers = new Set();
const contactWindow = {
  matchMedia(query) {
    return query === '(max-width: 767px)' ? mobileQuery : { matches: false };
  },
  addEventListener(type, handler) {
    if (type === 'resize') resizeHandlers.add(handler);
  },
  removeEventListener(type, handler) {
    if (type === 'resize') resizeHandlers.delete(handler);
  }
};
const contactGrid = { style: {}, getBoundingClientRect() { return { height: 100 }; } };
const contactRoot = {
  defaultView: contactWindow,
  getElementById() { return null; },
  querySelectorAll(selector) {
    if (selector === '.contact-mobile-tab') return contactTabs;
    if (selector === '[data-contact-panel]') return contactPanels;
    return [];
  },
  querySelector(selector) {
    return selector === '#contact-section .contact-grid' ? contactGrid : null;
  }
};

const responsiveForms = initForms({ root: contactRoot });
assert.equal(projectPanel.getAttribute('aria-hidden'), 'false', 'Desktop must expose the project panel to assistive technology');
assert.equal(reviewPanel.getAttribute('aria-hidden'), 'false', 'Desktop must expose the review panel to assistive technology');
assert.equal(projectPanel.getAttribute('role'), null, 'Desktop contact sections must not act as tabpanels when the tablist is hidden');
assert.equal(reviewPanel.getAttribute('role'), null, 'Desktop contact sections must remain standalone sections');
assert.equal(projectPanel.getAttribute('aria-labelledby'), null);
assert.equal(reviewPanel.getAttribute('aria-labelledby'), null);

reviewTab.click();
assert.equal(projectPanel.getAttribute('aria-hidden'), 'false', 'Both desktop panels must remain accessible after tab state changes');
assert.equal(reviewPanel.getAttribute('aria-hidden'), 'false', 'The visible desktop review panel must remain accessible');

let arrowDefaultPrevented = false;
reviewTab.dispatch('keydown', { key: 'ArrowRight', preventDefault() { arrowDefaultPrevented = true; } });
assert.equal(arrowDefaultPrevented, true, 'Horizontal tab arrow keys must prevent page scrolling');
assert.equal(projectTab.getAttribute('aria-selected'), 'true', 'ArrowRight from the last tab must wrap to the first tab');
assert.equal(reviewTab.getAttribute('aria-selected'), 'false');
assert.equal(projectTab.tabIndex, 0);
assert.equal(projectTab.focused, true, 'Arrow navigation must move focus to the newly active tab');

projectTab.dispatch('keydown', { key: 'End', preventDefault() {} });
assert.equal(reviewTab.getAttribute('aria-selected'), 'true', 'End must activate the final contact tab');
assert.equal(reviewTab.focused, true);

reviewTab.dispatch('keydown', { key: 'Home', preventDefault() {} });
assert.equal(projectTab.getAttribute('aria-selected'), 'true', 'Home must activate the first contact tab');
assert.equal(projectTab.focused, true);

mobileQuery.matches = true;
resizeHandlers.forEach(handler => handler());
assert.equal(projectPanel.getAttribute('aria-hidden'), 'false', 'Active mobile panel must remain accessible after returning Home');
assert.equal(reviewPanel.getAttribute('aria-hidden'), 'true', 'Inactive mobile panel must be hidden from the accessibility tree');
assert.equal(projectPanel.getAttribute('role'), 'tabpanel', 'Mobile contact panels must expose tabpanel semantics');
assert.equal(reviewPanel.getAttribute('role'), 'tabpanel');
assert.equal(projectPanel.getAttribute('aria-labelledby'), 'contactTabProject', 'Each panel must be labelled by its controlling tab');
assert.equal(reviewPanel.getAttribute('aria-labelledby'), 'contactTabReview');

// Press on one tab, then drag across the rail: the tab under the finger wins.
contactRail.dispatch('pointerdown', {
  target: projectTab, pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, clientX: 70, clientY: 12
});
contactRail.dispatch('pointermove', {
  pointerId: 41, pointerType: 'touch', clientX: 190, clientY: 14
});
assert.equal(reviewTab.getAttribute('aria-selected'), 'true', 'Dragging onto the review tab must activate it before release');
assert.equal(contactRail.getAttribute('data-active'), 'review', 'The active pill indicator must follow the dragged tab');
contactRail.dispatch('pointerup', {
  pointerId: 41, pointerType: 'touch', clientX: 190, clientY: 14
});

let dragClickPrevented = false;
let dragClickStopped = false;
contactRail.dispatch('click', {
  preventDefault() { dragClickPrevented = true; },
  stopImmediatePropagation() { dragClickStopped = true; }
});
assert.equal(dragClickPrevented, true, 'A drag-generated click must not undo the selected tab');
assert.equal(dragClickStopped, true, 'A drag-generated click must not reach the tab click handler');

// Reverse drag returns to the first tab by position, not by gesture direction alone.
contactRail.dispatch('pointerdown', {
  target: reviewTab, pointerId: 42, pointerType: 'touch', isPrimary: true, button: 0, clientX: 220, clientY: 12
});
contactRail.dispatch('pointermove', {
  pointerId: 42, pointerType: 'touch', clientX: 90, clientY: 14
});
assert.equal(projectTab.getAttribute('aria-selected'), 'true', 'Dragging back over the project tab must select it');
contactRail.dispatch('pointerup', {
  pointerId: 42, pointerType: 'touch', clientX: 90, clientY: 14
});
contactRail.dispatch('click', { preventDefault() {}, stopImmediatePropagation() {} });

// Vertical-dominant movement is left to native scrolling and does not change tabs.
contactRail.dispatch('pointerdown', {
  target: projectTab, pointerId: 43, pointerType: 'touch', isPrimary: true, button: 0, clientX: 70, clientY: 10
});
contactRail.dispatch('pointermove', {
  pointerId: 43, pointerType: 'touch', clientX: 75, clientY: 65
});
contactRail.dispatch('pointerup', {
  pointerId: 43, pointerType: 'touch', clientX: 75, clientY: 65
});
assert.equal(projectTab.getAttribute('aria-selected'), 'true', 'Vertical movement must not change contact tabs');

// Cancelled gestures must not select another tab.
contactRail.dispatch('pointerdown', {
  target: projectTab, pointerId: 44, pointerType: 'touch', isPrimary: true, button: 0, clientX: 70, clientY: 12
});
contactRail.dispatch('pointercancel', { pointerId: 44, pointerType: 'touch' });
contactRail.dispatch('pointermove', {
  pointerId: 44, pointerType: 'touch', clientX: 200, clientY: 12
});
assert.equal(projectTab.getAttribute('aria-selected'), 'true', 'Cancelled touch gestures must not change contact tabs');

// A stationary press is still a tap and does not get swallowed as a drag.
reviewTab.click();
assert.equal(reviewTab.getAttribute('aria-selected'), 'true', 'Normal tab taps must remain functional');

mobileQuery.matches = false;
resizeHandlers.forEach(handler => handler());
assert.equal(projectPanel.getAttribute('aria-hidden'), 'false', 'Resizing back to desktop must expose both panels');
assert.equal(reviewPanel.getAttribute('aria-hidden'), 'false', 'Resizing back to desktop must expose both panels');
assert.equal(projectPanel.getAttribute('role'), null, 'Desktop panels must return to standalone section semantics');
assert.equal(reviewPanel.getAttribute('role'), null);
assert.equal(projectPanel.getAttribute('aria-labelledby'), null);
assert.equal(reviewPanel.getAttribute('aria-labelledby'), null);
responsiveForms.cleanup();
assert.equal(resizeHandlers.size, 0, 'Contact accessibility resize listener must be cleaned up');

// Cleanup must remove all drag listeners too.
mobileQuery.matches = true;
contactRail.dispatch('pointerdown', {
  target: projectTab, pointerId: 45, pointerType: 'touch', isPrimary: true, button: 0, clientX: 70, clientY: 12
});
contactRail.dispatch('pointermove', {
  pointerId: 45, pointerType: 'touch', clientX: 200, clientY: 12
});
assert.equal(reviewTab.getAttribute('aria-selected'), 'true', 'Cleanup must remove the Contact drag listeners without changing the selected tab');
console.log('Contact form fallback, responsive accessibility, and touch-drag behavior validated.');
