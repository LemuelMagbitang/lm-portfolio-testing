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
import { applyMediaBackground } from '../infrastructure/media-background/loader.js';

export async function createPortfolioApp({
  root = globalThis.document,
  runtime,
  cms,
  config
} = {}) {
  if (!root || !runtime || !cms || !config?.urls) throw new Error('Portfolio app dependencies are incomplete.');

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

  // Three.js is optional infrastructure: do not make it part of the initial
  // module graph. Lightbox requests the viewer only when a 3D asset is opened.
  const mountModelViewer = async (...args) => {
    const module = await import('../infrastructure/three/model-viewer.js');
    return module.mountModelViewer(...args);
  };

  const settingsPromise = initSiteSettings({
    url: config.urls.settings,
    root,
    loadJson: loadCmsJson,
    resolveAssetUrl: siteAssetUrl,
    getSiteRootUrl
  });

  const navigation = initNavigation({ root });

  const projectsPromise = config.urls.projects
    ? mountProjects({ url: config.urls.projects, documentRef: root, getGrid: () => root.getElementById('portfolioGrid') })
    : Promise.resolve(false);

  const reviewsPromise = initReviews({
    url: config.urls.reviews,
    root,
    loadJson: loadCmsJson,
    resolveAssetUrl: siteAssetUrl
  });

  const aboutPromise = initAbout({
    url: config.urls.about,
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
  let heroFeature = null;
  if (hero) {
    try {
      heroFeature = await initHeroBannerV2({
        heroLoopUrl: config.urls.heroLoop,
        projectsUrl: config.urls.projects,
        loopMode: settings.heroTiming.loopMode,
        transitionStyle: settings.heroTiming.transitionStyle,
        crossfadeMs: settings.heroTiming.crossfadeMs,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl,
        getSiteRootUrl,
        ensureLottiePlayer,
        ensureMediaBackgroundHelper,
        applyMediaBackground,
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
      filterUrl: config.urls.filters,
      loadJson: loadCmsJson,
      resolveAssetUrl: siteAssetUrl,
      ensureLottiePlayer,
      ensureMediaBackgroundHelper
    });
  } catch (error) {
    console.warn('Gallery: initialization failed', error);
  }

  let lightboxFeature = null;
  try {
    lightboxFeature = await initLightbox({
      root,
      protectionEnabled: () => settings.protectionEnabled,
      ensureMediaBackgroundHelper,
      applyMediaBackground,
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
    hero: heroFeature,
    lightbox: lightboxFeature,
    reviews: reviewsFeature,
    about: aboutFeature,
    forms,
    destroy() {
      lightboxFeature?.destroy?.();
      heroFeature?.destroy?.();
      galleryFeature?.destroy?.();
      navigation.close();
      reviewsFeature.cleanup?.();
      forms.cleanup?.();
    }
  };
}
