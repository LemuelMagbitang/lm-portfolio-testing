/**
 * Portfolio application composition root.
 * Connects infrastructure services and independent page features.
 *
 * Feature modules own their behavior; this file owns only startup order and
 * explicit dependencies between them.
 */

import {
  mountProjects,
  getProjectForCard,
  getProjects,
  getCardForProject,
  destroyProjects
} from '../features/projects/index.js?v=20261006-02';
import { initNavigation } from '../features/navigation/index.js?v=20261007-03';
import { initReviews } from '../features/reviews/index.js';
import { initAbout, preloadAboutAssets } from '../features/about/index.js?v=20261004-15';
import { initForms } from '../features/forms/index.js';
import { initSiteSettings } from '../features/settings/index.js?v=20261006-01';

import { initGallery } from '../features/gallery/index.js?v=20261007-02';
import { initHeroBannerV2 } from '../features/hero/index.js?v=20261004-04';
import { initFooterAnimation } from '../features/footer/index.js?v=20261007-01';
import { initLightbox } from '../features/lightbox/index.js?v=20261007-02';
import { applyMediaBackground } from '../infrastructure/media-background/loader.js?v=20261005-06';

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

  // Three.js remains optional for pages without model media, but Works
  // explicitly warms the viewer module graph during startup when a project
  // contains 3D media so the first viewer open does not pay the module-load cost.
  const loadModelViewerModule = async () => (
    import('../infrastructure/three/model-viewer.js?v=20261005-09')
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
  let galleryFeatureRef = null;
  let pendingProjectOpen = null;

  const currentHash = String(root.defaultView?.location?.hash || '').toLowerCase();
  const initialContactNavigation = currentHash === '#contact-start' || currentHash === '#contact-section';
  const hasProjectGallery = !!root.getElementById('portfolioGrid');
  const projectsPromise = hasProjectGallery && config.urls.projects
    ? mountProjects({
        url: config.urls.projects,
        documentRef: root,
        getGrid: () => root.getElementById('portfolioGrid'),
        applyMediaBackground,
        waitForThumbnailReadiness: !initialContactNavigation,
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

  // Settings and project data are the minimum dependencies needed to
  // start media warm-up. Reviews/About/Gallery/Hero continue in parallel so
  // the branded loading screen can overlap their work instead of putting media
  // behind the entire feature-initialization queue.
  const [settingsFeature] = await Promise.all([
    settingsPromise,
    projectsPromise
  ]);

  const settings = settingsFeature.getState();
  settingsFeature.applyDom();

  const projectModels = getProjects();
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

  // Initialize the Lightbox before the remaining page features finish. It can
  // safely wait for the Gallery's active-card API at interaction time while
  // exposing its media renderer immediately for startup warm-up.
  try {
    lightboxFeature = await initLightbox({
      root,
      protectionEnabled: () => settings.protectionEnabled,
      ensureMediaBackgroundHelper,
      applyMediaBackground,
      parseYouTubeUrl,
      resolveAssetUrl: siteAssetUrl,
      mountModelViewer,
      getActiveCards: () =>
        galleryFeatureRef?.getActiveCards?.() ||
        Array.from(root.querySelectorAll('.project-card')),
      getProjectForCard
    });
  } catch (error) {
    console.warn('Lightbox: initialization failed', error);
  }

  // Start project-media warm-up as soon as project data and the Lightbox
  // renderer exist. This is deliberately before Hero/Gallery completion.
  const projectMediaPreloadPromise = lightboxFeature?.preloadProjectsMedia
    ? lightboxFeature.preloadProjectsMedia(projectModels, {
        preloadModelModule
      }).catch(error => {
        console.warn('Lightbox media preload failed:', error);
        return { total: 0, ready: 0 };
      })
    : Promise.resolve({ total: 0, ready: 0 });

  const hero = root.querySelector('.hero-section, #heroBanner, #heroBannerAbout');
  if (projectModels.some(project => project?.capabilities?.hasLottie)) {
    void Promise.resolve().then(() => ensureLottiePlayer()).catch(error => {
      console.warn('Lottie player warm-up failed:', error);
    });
  }

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

  const footerPromise = root.getElementById('footerAnimation')
    ? initFooterAnimation({
        root,
        footerLoopUrl: config.urls.footerLoop || 'data/footer-loop.json',
        heroLoopUrl: config.urls.heroLoop,
        projectsUrl: config.urls.projects,
        heroTiming: settings.heroTiming,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl,
        ensureLottiePlayer,
        prefersReducedMotion: runtime.prefersReducedMotion
      }).catch(error => {
        console.warn('Footer animation: initialization failed', error);
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

  const [heroFeature, footerFeature, reviewsFeature, aboutFeature, galleryFeature] = await Promise.all([
    heroPromise,
    footerPromise,
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

  // The Gallery owns the active-card contract. Assign it as soon as the
  // Gallery finishes initialization so the already-created Lightbox switches
  // from its safe DOM fallback to filtered project navigation.
  galleryFeatureRef = galleryFeature;

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

  // Project-media warm-up started as soon as its minimum dependencies were
  // available. The branded loading gate below only waits on its critical tier,
  // while the remaining secondary media continues in the background.
  const PROJECT_MEDIA_STARTUP_GATE_MS = 6000;
  let projectMediaGateTimer = null;
  const projectMediaGateTimeout = new Promise(resolve => {
    if (typeof root.defaultView?.setTimeout !== 'function') {
      resolve({ timeout: true });
      return;
    }
    projectMediaGateTimer = root.defaultView.setTimeout(
      () => resolve({ timeout: true }),
      PROJECT_MEDIA_STARTUP_GATE_MS
    );
  });

  // Hold the branded loading gate for the critical local-media tier, but never
  // indefinitely. The renderer continues its remaining background warm-up after
  // this ceiling, so a stalled asset cannot block the visitor from the page.
  if (!initialContactNavigation) {
    await Promise.race([
      projectMediaPreloadPromise,
      projectMediaGateTimeout
    ]);
  }
  if (projectMediaGateTimer !== null) {
    root.defaultView?.clearTimeout?.(projectMediaGateTimer);
  }

  // About-page prefetching and image/logo warm-up are non-critical navigation
  // optimizations. Run them in the background so they cannot delay the initial
  // page transition or Lightbox interactivity.
  void Promise.all([
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
    footer: footerFeature,
    lightbox: lightboxFeature,
    reviews: reviewsFeature,
    about: aboutFeature,
    forms,
    destroy() {
      lightboxFeature?.destroy?.();
      heroFeature?.destroy?.();
      footerFeature?.destroy?.();
      galleryFeatureRef = null;
      galleryFeature?.destroy?.();
      destroyProjects();
      navigation.destroy?.();
      reviewsFeature.cleanup?.();
      aboutFeature?.cleanup?.();
      forms.cleanup?.();
    }
  };
}