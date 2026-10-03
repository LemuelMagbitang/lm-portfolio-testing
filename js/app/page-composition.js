/**
 * Portfolio application composition root.
 * Connects infrastructure services and independent page features.
 *
 * Feature modules own their behavior; this file owns only startup order and
 * explicit dependencies between them.
 */

import { mountProjects } from '../features/projects/index.js';
import { initNavigation } from '../features/navigation/index.js';
import { initProjectFilters } from '../features/project-filters/index.js';
import { initReviews } from '../features/reviews/index.js';
import { initAbout } from '../features/about/index.js';
import { initForms } from '../features/forms/index.js';
import { initSiteSettings } from '../features/settings/index.js';

import { initGallery } from '../features/gallery/index.js';
import { initHeroBannerV2 } from '../hero.js';
import { initLightbox } from '../lightbox.js';

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

  const filtersPromise = initProjectFilters({
    url: globalThis.FILTERS_URL,
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
    filtersPromise
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
      await initHeroBannerV2(hero, {
        mode: settings.heroTiming.loopMode,
        transition: settings.heroTiming.transitionStyle,
        crossfadeMs: settings.heroTiming.crossfadeMs,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl
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

  const filterFeature = await filtersPromise;

  try {
    await initLightbox({
      root,
      protectionEnabled: () => settings.protectionEnabled,
      ensureMediaBackgroundHelper,
      parseYouTubeUrl
    });
  } catch (error) {
    console.warn('Lightbox: initialization failed', error);
  }

  const projectGrid = root.getElementById('portfolioGrid');
  try {
    await initGallery({
      root,
      projectGrid,
      resolveAssetUrl: siteAssetUrl,
      ensureLottiePlayer,
      ensureMediaBackgroundHelper
    });
  } catch (error) {
    console.warn('Gallery: initialization failed', error);
  }

  return {
    settings,
    navigation,
    filters: filterFeature,
    reviews: reviewsFeature,
    about: aboutFeature,
    forms,
    destroy() {
      navigation.close();
      filterFeature.cleanup?.();
      reviewsFeature.cleanup?.();
      forms.cleanup?.();
    }
  };
}
