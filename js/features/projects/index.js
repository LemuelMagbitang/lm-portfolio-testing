/**
 * Public API for the Projects feature.
 *
 * Application code should enter the feature through mountProjects() instead
 * of reaching into card/media implementation files. Internal filenames can
 * change without forcing application-wide edits.
 */

export { mountProjects } from './browser-runtime.js?v=20261009-12';
export {
  loadProjects,
  getProjectForCard,
  getProjects,
  getCardForProject,
  destroyProjects
} from './project-loader.js?v=20261009-12';
