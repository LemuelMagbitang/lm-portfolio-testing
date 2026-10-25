/**
 * Portfolio application composition root.
 * Connects infrastructure services and independent page features.
 *
 * Feature modules own their behavior; this file owns only startup order and
 * explicit dependencies between them.
 */

import { initNavigation } from '../features/navigation/index.js?v=20261019-02';
import { initAbout, preloadAboutAssets } from '../features/about/index.js?v=20261024-01';
import { initForms } from '../features/forms/index.js?v=20261012-02';
import { initSiteSettings } from '../features/settings/index.js?v=20261021-02';

import { initHeroBannerV2 } from '../features/hero/index.js?v=20261025-07';
import { initFooterAnimation } from '../features/footer/index.js?v=20261023-02';
import { applyMediaBackground } from '../infrastructure/media-background/loader.js?v=20261023-01';
import { resolveCuratedView, resolveCuratedViewSlug } from '../features/curated-views/index.js?v=20261011-01';

function applyCuratedViewPresentation(root, resolution) {
  const body = root?.body;
  root?.getElementById?.('curatedViewHeading')?.remove();
  root?.getElementById?.('curatedViewEmpty')?.remove();
  body?.classList?.remove('is-curated-view', 'is-curated-view-empty');
  if (body?.dataset) delete body.dataset.curatedViewSlug;
  if (!resolution?.view) return;

  const view = resolution.view;
  body?.classList?.add('is-curated-view');
  if (body?.dataset) body.dataset.curatedViewSlug = String(view.slug || '');

  const heading = root.createElement('section');
  heading.id = 'curatedViewHeading';
  heading.className = 'curated-view-heading';
  heading.setAttribute('aria-label', 'Curated portfolio');
  const copy = root.createElement('div');
  copy.className = 'curated-view-heading-copy';
  const title = root.createElement('h1');
  title.textContent = String(view.name || 'Curated Portfolio');
  copy.append(title);

  const exit = root.createElement('a');
  exit.className = 'curated-view-exit';
  const windowRef = root.defaultView || globalThis.window;
  exit.href = String(windowRef?.location?.pathname || '/') + String(windowRef?.location?.search || '');
  const exitIcon = root.createElement('i');
  exitIcon.className = 'fa-solid fa-arrow-left';
  exitIcon.setAttribute('aria-hidden', 'true');
  exit.append(exitIcon, root.createTextNode('View full portfolio'));
  exit.setAttribute('aria-label', 'Leave this curated portfolio and view all projects');
  heading.append(copy, exit);

  const filters = root.querySelector('.filter-tabs');
  if (filters?.insertAdjacentElement) filters.insertAdjacentElement('afterend', heading);
  else root.querySelector('.portfolio-wrapper')?.prepend(heading);

  if (!Array.isArray(resolution.projects) || resolution.projects.length === 0) {
    body?.classList?.add('is-curated-view-empty');
    const empty = root.createElement('p');
    empty.id = 'curatedViewEmpty';
    empty.className = 'curated-view-empty';
    empty.textContent = 'No available projects have been added to this curated portfolio yet.';
    heading.insertAdjacentElement('afterend', empty);
  }
}

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
    import('../infrastructure/three/model-viewer.js?v=20261024-02')
  );

  const mountModelViewer = async (...args) => {
    const module = await loadModelViewerModule();
    return module.mountModelViewer(...args);
  };

  let activeCuratedViewSlug = '';
  let lightboxFeature = null;
  let galleryFeatureRef = null;
  let pendingProjectOpen = null;
  let mainProjectModels = [];

  const currentHash = String(root.defaultView?.location?.hash || '').toLowerCase();
  const initialContactNavigation = currentHash === '#contact-start' || currentHash === '#contact-section';
  const hasProjectGallery = !!root.getElementById('portfolioGrid');
  const hasProjectArtworkFeature = Boolean(
    root.querySelector('.hero-section, #heroBanner, #heroBannerAbout') ||
    root.getElementById('footerAnimation')
  );
  const shouldLoadProjectModels = hasProjectGallery || hasProjectArtworkFeature;

  // The Projects, Gallery, and Lightbox graphs exist only for the Work grid.
  // Load their public APIs in parallel on Works; About keeps the shared app
  // shell but skips the project card/media implementation entirely.
  const projectsModulePromise = hasProjectGallery
    ? import('../features/projects/index.js?v=20261025-07')
    : Promise.resolve(null);
  const projectNormalizerModulePromise = shouldLoadProjectModels
    ? import('../data/project-normalizer.js?v=20261025-07')
    : Promise.resolve(null);
  const galleryModulePromise = hasProjectGallery
    ? import('../features/gallery/index.js?v=20261024-02').catch(error => {
        console.warn('Gallery module failed to load:', error);
        return null;
      })
    : Promise.resolve(null);
  const lightboxModulePromise = hasProjectGallery
    ? import('../features/lightbox/index.js?v=20261025-07').catch(error => {
        console.warn('Lightbox module failed to load:', error);
        return null;
      })
    : Promise.resolve(null);

  let projectsFeatureModule = null;
  const getProjectForCard = card => projectsFeatureModule?.getProjectForCard?.(card) || null;
  const getProjects = () => projectsFeatureModule?.getProjects?.() || [];
  const getCardForProject = projectId => projectsFeatureModule?.getCardForProject?.(projectId) || null;
  const destroyProjects = () => projectsFeatureModule?.destroyProjects?.();

  const curatedViewsPromise = loadCmsJson('data/curated-views.json', [], { resolveUrl: siteAssetUrl })
    .then(raw => {
      const views = Array.isArray(raw) ? raw : [];
      activeCuratedViewSlug = resolveCuratedViewSlug(currentHash, views);
      return views;
    })
    .catch(error => {
      console.warn('Curated Views: registry could not be loaded.', error);
      activeCuratedViewSlug = '';
      return [];
    });
  const navigation = initNavigation({ root, getCuratedViewSlug: () => activeCuratedViewSlug });

  const settingsPromise = initSiteSettings({
    url: config.urls.settings,
    root,
    loadJson: loadCmsJson,
    resolveAssetUrl: siteAssetUrl,
    getSiteRootUrl
  });

  const mainProjectsPayloadPromise = shouldLoadProjectModels && config.urls.projects
    ? loadCmsJson(config.urls.projects, null, { resolveUrl: siteAssetUrl })
    : Promise.resolve(null);
  const projectModelsPromise = shouldLoadProjectModels && config.urls.projects
    ? Promise.all([mainProjectsPayloadPromise, projectNormalizerModulePromise])
        .then(([payload, projectNormalizer]) => {
          if (!projectNormalizer?.normalizeProjects) {
            throw new Error('Project normalizer did not expose normalizeProjects().');
          }
          mainProjectModels = projectNormalizer.normalizeProjects(payload);
          return mainProjectModels;
        })
        .catch(error => {
          console.warn('Project model warm-up failed:', error);
          mainProjectModels = [];
          return mainProjectModels;
        })
    : Promise.resolve([]);
  const projectsPromise = hasProjectGallery && config.urls.projects
    ? Promise.all([
        mainProjectsPayloadPromise,
        curatedViewsPromise,
        projectsModulePromise,
        projectModelsPromise
      ]).then(([mainPayload, views, projectsModule, normalizedMainProjects]) => {
        if (!projectsModule?.mountProjects) {
          throw new Error('Projects feature module did not expose its required public API.');
        }
        projectsFeatureModule = projectsModule;
        mainProjectModels = normalizedMainProjects;
        const curatedResolution = resolveCuratedView({ hash: currentHash, views, mainProjects: mainPayload });
        const projectPayload = curatedResolution ? curatedResolution.projects : mainPayload;
        activeCuratedViewSlug = curatedResolution?.view?.slug || '';
        applyCuratedViewPresentation(root, curatedResolution);
        return projectsModule.mountProjects({
          url: config.urls.projects,
          projectData: projectPayload,
          loadJson: loadCmsJson,
          resolveAssetUrl: siteAssetUrl,
          documentRef: root,
          getGrid: () => root.getElementById('portfolioGrid'),
          applyMediaBackground,
          ensureLottiePlayer,
          waitForThumbnailReadiness: !initialContactNavigation,
          onCardActivate: details => {
            if (lightboxFeature?.openCard) {
              const activationInput = details.event?.type === 'keydown' ||
                (details.event?.type === 'click' && Number(details.event.detail) === 0)
                ? 'keyboard'
                : (details.event ? 'pointer' : 'keyboard');
              lightboxFeature.openCard(details.card, {
                initialMediaIndex: details.initialMediaIndex,
                activationInput
              });
            } else {
              pendingProjectOpen = details;
            }
          }
        });
      })
    : curatedViewsPromise.then(views => {
        activeCuratedViewSlug = resolveCuratedViewSlug(currentHash, views);
        return false;
      });

  const reviewsPromise = settingsPromise.then(async settingsFeature => {
    const currentSettings = settingsFeature.getState();
    const section = root.querySelector('.reviews-section');
    if (!currentSettings.showReviews) {
      if (section) section.style.display = 'none';
      return null;
    }

    try {
      const module = await import('../features/reviews/index.js');
      if (typeof module?.initReviews !== 'function') {
        throw new Error('Reviews module did not expose initReviews().');
      }
      return await module.initReviews({
        url: config.urls.reviews,
        root,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl,
        visible: true
      });
    } catch (error) {
      console.warn('Reviews: initialization failed', error);
      if (section) section.style.display = 'none';
      return null;
    }
  });

  const isAboutPage = Boolean(root.body?.classList.contains('about-page'));
  const aboutDataPromise = isAboutPage && config.urls.about
    ? loadCmsJson(config.urls.about, null, { resolveUrl: siteAssetUrl })
        .catch(error => {
          console.warn('About data load failed:', error);
          return null;
        })
    : Promise.resolve(undefined);

  const aboutPromise = isAboutPage
    ? aboutDataPromise.then(data => initAbout({
        url: config.urls.about,
        root,
        data,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl
      }))
    : initAbout({
        url: config.urls.about,
        root,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl
      });

  // Start About asset warm-up as soon as the data endpoint is known. The
  // browser can populate its HTTP/image cache while the branded loading gate
  // and the rest of the composed features initialize.
  const aboutAssetPreloadPromise = (isAboutPage
    ? aboutDataPromise.then(data => preloadAboutAssets({
        url: config.urls.about,
        data,
        root,
        documentRef: root,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl
      }))
    : preloadAboutAssets({
        url: config.urls.about,
        root,
        documentRef: root,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl
      })
  ).catch(error => {
    console.warn('About asset preload failed:', error);
    return { total: 0, ready: 0 };
  });

  const forms = initForms({ root });

  // Settings and project data are the minimum dependencies needed to
  // start media warm-up. Reviews/About/Gallery/Hero continue in parallel so
  // the branded loading screen can overlap their work instead of putting media
  // behind the entire feature-initialization queue.
  const [settingsFeature] = await Promise.all([
    settingsPromise,
    projectsPromise,
    projectModelsPromise
  ]);

  const settings = settingsFeature.getState();
  settingsFeature.applyDom();

  // Keep optional sounds/haptics out of the default route graph.
  let interactionFeedback = null;
  if (settings.interactionFeedback?.enabled === true &&
      (settings.interactionFeedback.soundEnabled || settings.interactionFeedback.hapticsEnabled)) {
    try {
      const feedback = await import('../features/interaction-feedback/index.js?v=20261018-03');
      interactionFeedback = feedback.initInteractionFeedback({
        root, settings: settings.interactionFeedback, resolveAssetUrl: siteAssetUrl
      });
    } catch (error) {
      console.warn('Interaction feedback: feature could not initialize.', error);
    }
  }

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
  if (hasProjectGallery) {
    try {
      const lightboxModule = await lightboxModulePromise;
      if (typeof lightboxModule?.initLightbox === 'function') {
        lightboxFeature = await lightboxModule.initLightbox({
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
      }
    } catch (error) {
      console.warn('Lightbox: initialization failed', error);
    }
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
  // Project-card Lottie thumbnails load the player only as they approach the viewport.


  const heroPromise = hero
    ? initHeroBannerV2({
        heroLoopUrl: config.urls.heroLoop,
        heroMessagesUrl: config.urls.heroMessages,
        projectsUrl: config.urls.projects,
        loopMode: settings.heroTiming.loopMode,
        transitionStyle: settings.heroTiming.transitionStyle,
        crossfadeMs: settings.heroTiming.crossfadeMs,
        messageFadeMs: settings.heroTiming.fadeMs,
        showHeroMessage: settings.showHeroMessage,
        showFooterMessage: settings.showFooterMessage,
        defaultVideoPoster: settings.defaultVideoPoster,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl,
        getSiteRootUrl,
        ensureLottiePlayer,
        ensureMediaBackgroundHelper,
        applyMediaBackground,
        parseYouTubeUrl,
        getProjects: () => mainProjectModels.slice(),
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
        projects: mainProjectModels.length ? mainProjectModels : null,
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

  const galleryPromise = hasProjectGallery
    ? galleryModulePromise.then(module => {
        if (typeof module?.initGallery !== 'function') return null;
        return module.initGallery({
          root,
          projectGrid: root.getElementById('portfolioGrid'),
          filterUrl: config.urls.filters,
          loadJson: loadCmsJson,
          resolveAssetUrl: siteAssetUrl,
          ensureLottiePlayer,
          ensureMediaBackgroundHelper,
          getProjects,
          getCardForProject
        });
      }).catch(error => {
        console.warn('Gallery: initialization failed', error);
        return null;
      })
    : Promise.resolve(null);

  let heroFeature = null;
  let footerFeature = null;
  let reviewsFeature = null;
  let aboutFeature = null;
  let galleryFeature = null;
  let deferredMediaDestroyed = false;

  if (root.body?.classList.contains('about-page')) {
    // About's hero/footer animations and profile/software content are visible
    // above or within the first page view. Resolve them under the branded gate
    // so their player scripts and local data are not first requested after it
    // disappears. Reviews remain optional because they are hidden on this page.
    const visibleReviewsPromise = settings.showReviews
      ? reviewsPromise.then(feature => {
          feature?.setVisible?.(true);
          return feature;
        })
      : Promise.resolve(null);

    [heroFeature, footerFeature, galleryFeature, aboutFeature, reviewsFeature] = await Promise.all([
      heroPromise,
      footerPromise,
      galleryPromise,
      aboutPromise.then(feature => {
        feature.setSoftwareLogosVisible(settings.showSoftwareLogos);
        return feature;
      }),
      visibleReviewsPromise
    ]);
  } else {
    [heroFeature, footerFeature, reviewsFeature, aboutFeature, galleryFeature] = await Promise.all([
      heroPromise,
      footerPromise,
      reviewsPromise.then(feature => {
        feature?.setVisible?.(settings.showReviews);
        return feature;
      }),
      aboutPromise.then(feature => {
        feature.setSoftwareLogosVisible(settings.showSoftwareLogos);
        return feature;
      }),
      galleryPromise
    ]);
  }

  // The Gallery owns the active-card contract. Assign it as soon as the
  // Gallery finishes initialization so the already-created Lightbox switches
  // from its safe DOM fallback to filtered project navigation.
  galleryFeatureRef = galleryFeature;

  const ABOUT_PAGE_PREFETCH_TIMEOUT_MS = 5000;
  const aboutPagePrefetchPromise = !isAboutPage
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

  // Wait for all local project media before removing the branded loading
  // screen. A Contact hash changes the final scroll target, not which assets
  // are warmed. Each individual preload has its own timeout/error handling.
  // Profile and software-logo preloads are opportunistic. initAbout already
  // renders text and visible fallback frames from CMS data; never keep the
  // first-paint transition open while optional images load from local or remote
  // sources. The warm-up continues in the background below.
  await projectMediaPreloadPromise;

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
    interactionFeedback,
    destroy() {
      deferredMediaDestroyed = true;
      lightboxFeature?.destroy?.();
      heroFeature?.destroy?.();
      footerFeature?.destroy?.();
      galleryFeatureRef = null;
      galleryFeature?.destroy?.();
      destroyProjects();
      navigation.destroy?.();
      interactionFeedback?.destroy?.();
      reviewsFeature?.cleanup?.();
      aboutFeature?.cleanup?.();
      forms.cleanup?.();
    }
  };
}