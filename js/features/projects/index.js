/**
 * Public API for the Projects feature.
 *
 * Consumers import from this module instead of reaching into implementation
 * files. Internal filenames can change without forcing application-wide edits.
 */

export { loadProjects } from './project-loader.js';
export { buildProjectCardElement } from './project-card.js';
export {
  buildMediaItemElement,
  findProjectMediaBackground,
  projectHas3D
} from './project-media.js';
