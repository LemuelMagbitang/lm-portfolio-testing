/**
 * Public API for the Projects feature.
 *
 * Other application code should import from this module instead of reaching
 * into project implementation files. This gives the feature freedom to
 * reorganize its internals without changing its consumers.
 */

export { loadProjects } from './project-loader.js';
export { buildProjectCard } from './project-card.js';
export {
  buildMediaItem,
  findMediaBackground,
  projectHas3D,
  add3DAvailabilityIndicator
} from './project-media.js';
