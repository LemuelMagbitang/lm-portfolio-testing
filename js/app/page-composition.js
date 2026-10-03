/**
 * Portfolio application composition root.
 * Connects infrastructure services and independent page features.
 *
 * Feature modules own their behavior; this file owns only startup order and
 * explicit dependencies between them.
 */

import { mountProjects, getProjectForCard, getProjects } from '../features/projects/index.js';
import { initNavigation } from '../features/navigation/index.js';
import { initReviews } from '../features/reviews/index.js';
import { initAbout } from '../features/about/index.js?v=20261003-12';
import { initForms } from '../features/forms/index.js';
import { initSiteSettings } from '../features/settings/index.js';

import { initGallery } from '../features/gallery/index.js';
import { initHeroBannerV2 } from '../features/hero/index.js?v=20261003-12';
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

  let lightboxFeature = null;
  let pendingProjectOpen = null;

  const projectsPromise = config.urls.projects
    ? mountProjects({
        url: config.urls.projects,
        documentRef: root,
        getGrid: () => root.getElementById('portfolioGrid'),
        onCardActivate: details => {
          if (lightboxFeature?.openCard) {
            lightboxFeature.openCard(details.card, {
              initialMediaIndex: details.initialMediaIndex
            });
          } else {
            pendingProjectOpen = details;
          }
        }
      })
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

  const projectModels = getProjects();
  if (projectModels.some(project => project?.capabilities?.hasLottie)) {
    await ensureLottiePlayer();
  }

  const hero = root.querySelector('.hero-section, #heroBanner, #heroBannerAbout');
  let heroFeature = null;
  if (hero) {
    try {
      heroFeature = await initHeroBannerV2({
        heroLoopUrl: config.urls.heroLoop,
        heroMessagesUrl: config.urls.heroMessages,
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
        getProjects,
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

  try {
    lightboxFeature = await initLightbox({
      root,
      protectionEnabled: () => settings.protectionEnabled,
      ensureMediaBackgroundHelper,
      applyMediaBackground,
      parseYouTubeUrl,
      resolveAssetUrl: siteAssetUrl,
      mountModelViewer,
      getActiveCards: () => galleryFeature?.getActiveCards?.() || Array.from(root.querySelectorAll('.project-card')),
      getProjectForCard
    });
  } catch (error) {
    console.warn('Lightbox: initialization failed', error);
  }

  if (lightboxFeature?.openCard && pendingProjectOpen) {
    const pending = pendingProjectOpen;
    pendingProjectOpen = null;
    lightboxFeature.openCard(pending.card, {
      initialMediaIndex: pending.initialMediaIndex
    });
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
      navigation.destroy?.();
      reviewsFeature.cleanup?.();
      forms.cleanup?.();
    }
  };
}
