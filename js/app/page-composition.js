/**
 * Portfolio application composition root.
 * Connects infrastructure services and independent page features.
 *
 * Feature modules own their behavior; this file owns only startup order and
 * explicit dependencies between them.
 */

import { mountProjects } from '../features/projects/index.js';
import { initNavigation } from '../features/navigation/index.js';
import { initReviews } from '../features/reviews/index.js';
import { initAbout } from '../features/about/index.js';
import { initForms } from '../features/forms/index.js';
import { initSiteSettings } from '../features/settings/index.js';

import { initGallery } from '../features/gallery/index.js';
import { initHeroBannerV2 } from '../features/hero/index.js';
import { initLightbox } from '../features/lightbox/index.js';
import { mountModelViewer } from '../model-viewer.js';

export async function createPortfolioApp({
  root = globalThis.document,
  runtime,
  cms
} = {}) {
  if (!root || !runtime || !cms) throw new Error('Portfolio app dependencies are incomplete.');

  const {
    getSiteRootUrl,
    siteAssetUrl,
    ensureLottiePlayer,
    ensureMediaBackgroundHelper
  } = runtime;

  const {
    loadCmsJson,
    parseYouTubeUrl
  } = cms;

  const settingsPromise = initSiteSettings({
    url: globalThis.SETTINGS_URL,
    root,
    loadJson: loadCmsJson,
    resolveAssetUrl: siteAssetUrl,
    getSiteRootUrl
  });

  const navigation = initNavigation({ root });

  const projectsPromise = globalThis.PROJECTS_URL
    ? mountProjects({ url: globalThis.PROJECTS_URL })
    : Promise.resolve(false);

  const reviewsPromise = initReviews({
    url: globalThis.REVIEWS_URL,
    root,
    loadJson: loadCmsJson,
    resolveAssetUrl: siteAssetUrl
  });

  const aboutPromise = initAbout({
    url: globalThis.ABOUT_URL,
    root,
    loadJson: loadCmsJson,
    resolveAssetUrl: siteAssetUrl
  });

  const forms = initForms({ root });

  const [settingsFeature] = await Promise.all([
    settingsPromise,
    projectsPromise,
    reviewsPromise,
    aboutPromise,
  ]);

  const settings = settingsFeature.getState();

  // Settings can resolve before CMS-backed cards are mounted. Re-apply the
  // current DOM-dependent settings after all page content exists.
  settingsFeature.applyDom();

  if (
    root.querySelector('.project-media-list .media-item[data-lottie], .project-thumb-media[lottie-player]')
  ) {
    await ensureLottiePlayer();
  }

  const hero = root.querySelector('.hero');
  if (hero) {
    try {
      await initHeroBannerV2({
        mode: settings.heroTiming.loopMode,
        transition: settings.heroTiming.transitionStyle,
        crossfadeMs: settings.heroTiming.crossfadeMs,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl,
        getSiteRootUrl,
        ensureLottiePlayer,
        ensureMediaBackgroundHelper,
        parseYouTubeUrl,
        prefersReducedMotion: runtime.prefersReducedMotion
      });
    } catch (error) {
      console.warn('Hero: initialization failed', error);
    }
  }

  forms.setProjectEnabled(settings.formsEnabled.project);
  forms.setReviewEnabled(settings.formsEnabled.review);

  const reviewsFeature = await reviewsPromise;
  reviewsFeature.setVisible(settings.showReviews);

  const aboutFeature = await aboutPromise;
  aboutFeature.setSoftwareLogosVisible(settings.showSoftwareLogos);

  let galleryFeature;

  try {
    galleryFeature = await initGallery({
      root,
      projectGrid: root.getElementById('portfolioGrid'),
      filterUrl: globalThis.FILTERS_URL,
      loadJson: loadCmsJson,
      resolveAssetUrl: siteAssetUrl,
      ensureLottiePlayer,
      ensureMediaBackgroundHelper
    });
  } catch (error) {
    console.warn('Gallery: initialization failed', error);
  }

  try {
    await initLightbox({
      root,
      protectionEnabled: () => settings.protectionEnabled,
      ensureMediaBackgroundHelper,
      parseYouTubeUrl,
      resolveAssetUrl: siteAssetUrl,
      mountModelViewer,
      getActiveCards: () => galleryFeature?.getActiveCards?.() || Array.from(root.querySelectorAll('.project-card'))
    });
  } catch (error) {
    console.warn('Lightbox: initialization failed', error);
  }

  return {
    settings,
    navigation,
    gallery: galleryFeature,
    reviews: reviewsFeature,
    about: aboutFeature,
    forms,
    destroy() {
      navigation.close();
      reviewsFeature.cleanup?.();
      forms.cleanup?.();
    }
  };
}
