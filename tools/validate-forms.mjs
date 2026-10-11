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
    setAttribute(name, value) { values.set(name, String(value)); }
  };
}

const contactRail = makeContactElement();
const projectTab = makeContactElement({ 'data-contact-tab': 'project', 'aria-selected': 'true' });
const reviewTab = makeContactElement({ 'data-contact-tab': 'review', 'aria-selected': 'false' });
projectTab.parentElement = contactRail;
reviewTab.parentElement = contactRail;
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
assert.equal(reviewPanel.getAttribute('aria-hidden'), 'false', 'Desktop must expose the visible review panel to assistive technology');

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

mobileQuery.matches = false;
resizeHandlers.forEach(handler => handler());
assert.equal(projectPanel.getAttribute('aria-hidden'), 'false', 'Resizing back to desktop must expose both panels');
assert.equal(reviewPanel.getAttribute('aria-hidden'), 'false', 'Resizing back to desktop must expose both panels');
responsiveForms.cleanup();
assert.equal(resizeHandlers.size, 0, 'Contact accessibility resize listener must be cleaned up');

console.log('Contact form fallback and responsive accessibility behavior validated.');
