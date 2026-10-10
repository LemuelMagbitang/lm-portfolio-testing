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

console.log('Contact form fallback behavior validated.');
