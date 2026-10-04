/**
 * Portfolio application composition root.
 * Connects infrastructure services and independent page features.
 *
 * Feature modules own their behavior; this file owns only startup order and
 * explicit dependencies between them.
 */

import { mountProjects, getProjectForCard, getProjects, getCardForProject } from '../features/projects/index.js?v=20261004-04';
import { initNavigation } from '../features/navigation/index.js';
import { initReviews } from '../features/reviews/index.js';
import { initAbout, preloadAboutAssets } from '../features/about/index.js?v=20261004-15';
import { initForms } from '../features/forms/index.js';
import { initSiteSettings } from '../features/settings/index.js';

import { initGallery } from '../features/gallery/index.js?v=20261004-04';
import { initHeroBannerV2 } from '../features/hero/index.js?v=20261004-04';
import { initLightbox } from '../features/lightbox/index.js?v=20261004-18';
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
  const loadModelViewerModule = async () => (
    import('../infrastructure/three/model-viewer.js?v=20261004-07')
  );

  const mountModelViewer = async (...args) => {
    const module = await loadModelViewerModule();
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

  const hasProjectGallery = !!root.getElementById('portfolioGrid');
  const projectsPromise = hasProjectGallery && config.urls.projects
    ? mountProjects({
        url: config.urls.projects,
        documentRef: root,
        getGrid: () => root.getElementById('portfolioGrid'),
        applyMediaBackground,
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
  // The data dependencies above are now complete. Initialize independent
  // presentation/features concurrently so Hero startup cannot block the
  // gallery or Lightbox from becoming interactive.
  settingsFeature.applyDom();

  const projectModels = getProjects();
  if (projectModels.some(project => project?.capabilities?.hasLottie)) {
    await ensureLottiePlayer();
  }

  const hasModelMedia = projectModels.some(project => project?.capabilities?.hasModel);
  const preloadModelModule = hasModelMedia
    ? async () => {
        const module = await loadModelViewerModule();
        const formats = projectModels.flatMap(project =>
          (Array.isArray(project?.media) ? project.media : [])
            .filter(item => String(item?.type || '').toLowerCase() === 'model')
            .map(item => String(item?.src || '').split('?')[0].split('#')[0].split('.').pop() || '')
        );
        await module.preloadModelViewerModules?.(formats);
        return true;
      }
    : null;

  const hero = root.querySelector('.hero-section, #heroBanner, #heroBannerAbout');

  const heroPromise = hero
    ? initHeroBannerV2({
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
      }).catch(error => {
        console.warn('Hero: initialization failed', error);
        return null;
      })
    : Promise.resolve(null);

  forms.setProjectEnabled(settings.formsEnabled.project);
  forms.setReviewEnabled(settings.formsEnabled.review);

  const galleryPromise = initGallery({
    root,
    projectGrid: root.getElementById('portfolioGrid'),
    filterUrl: config.urls.filters,
    loadJson: loadCmsJson,
    resolveAssetUrl: siteAssetUrl,
    ensureLottiePlayer,
    ensureMediaBackgroundHelper,
    getProjects,
    getCardForProject
  }).catch(error => {
    console.warn('Gallery: initialization failed', error);
    return null;
  });

  const [heroFeature, reviewsFeature, aboutFeature, galleryFeature] = await Promise.all([
    heroPromise,
    reviewsPromise.then(feature => {
      feature.setVisible(settings.showReviews);
      return feature;
    }),
    aboutPromise.then(feature => {
      feature.setSoftwareLogosVisible(settings.showSoftwareLogos);
      return feature;
    }),
    galleryPromise
  ]);

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

  const ABOUT_PAGE_PREFETCH_TIMEOUT_MS = 5000;
  const aboutPagePrefetchPromise = !root.body?.classList.contains('about-page')
    ? Promise.resolve().then(() => {
        const aboutPageUrl = siteAssetUrl('about/');
        if (!aboutPageUrl || typeof globalThis.fetch !== 'function') return false;

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        let timer = null;
        if (controller && typeof root.defaultView?.setTimeout === 'function') {
          timer = root.defaultView.setTimeout(
            () => controller.abort(),
            ABOUT_PAGE_PREFETCH_TIMEOUT_MS
          );
        }

        return globalThis.fetch(aboutPageUrl, {
          method: 'GET',
          credentials: 'omit',
          cache: 'force-cache',
          signal: controller?.signal
        })
          .then(response => response.ok)
          .catch(() => false)
          .finally(() => {
            if (timer !== null) root.defaultView.clearTimeout(timer);
          });
      })
    : Promise.resolve(true);

  const aboutAssetPreloadPromise = !root.body?.classList.contains('about-page')
    ? preloadAboutAssets({
        url: config.urls.about,
        root,
        documentRef: root,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl
      })
    : Promise.resolve({ total: 0, ready: 0 });

  // Warm the Lightbox media cache in the background. Opening the site must
  // never wait for every project asset to download before the Lightbox itself
  // becomes interactive; the first opened media item still loads eagerly from
  // the Lightbox renderer when needed.
  const projectMediaPreloadPromise = lightboxFeature?.preloadProjectsMedia
    ? lightboxFeature.preloadProjectsMedia(projectModels, {
        preloadModelModule
      }).catch(error => {
        console.warn('Lightbox media preload failed:', error);
        return { total: 0, ready: 0 };
      })
    : Promise.resolve({ total: 0, ready: 0 });

  void projectMediaPreloadPromise;

  await Promise.all([
    aboutPagePrefetchPromise,
    aboutAssetPreloadPromise
  ]);

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
