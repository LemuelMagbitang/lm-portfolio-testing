/**
 * Full-screen artwork Inspect Mode controller.
 *
 * Owns the temporary artwork move, navigation, focus handling, gesture
 * handling, and scroll restoration used while a grouped artwork is inspected.
 * Media playback and foil behavior remain injected renderer capabilities.
 */
export function createArtworkInspectController({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  resetFoilMotionImmediately = () => {},
  pauseYouTubeFrame = () => {},
  pauseOtherPlayback = () => {},
  selectGroupedArtworkEntry = () => {}
} = {}) {
  let activeInspector = null;

  function createArtworkInspectPlaceholder(entry) {
    const placeholder=documentRef.createElement('div');
    placeholder.className='lightbox-inspect-placeholder';
    const entryStyle=windowRef?.getComputedStyle?.(entry);
    const layoutWidth=Number(entry.offsetWidth)||Number.parseFloat(entryStyle?.width)||entry.getBoundingClientRect?.().width||0;
    const layoutHeight=Number(entry.offsetHeight)||Number.parseFloat(entryStyle?.height)||entry.getBoundingClientRect?.().height||0;
    placeholder.style.boxSizing='border-box';
    if(layoutWidth>0)placeholder.style.width=layoutWidth+'px';
    if(layoutHeight>0)placeholder.style.height=layoutHeight+'px';
    if(entryStyle){
      placeholder.style.flex=entryStyle.flex;
      placeholder.style.order=entryStyle.order;
      placeholder.style.alignSelf=entryStyle.alignSelf;
      placeholder.style.justifySelf=entryStyle.justifySelf;
      placeholder.style.minWidth=entryStyle.minWidth;
      placeholder.style.maxWidth=entryStyle.maxWidth;
      placeholder.style.minHeight=entryStyle.minHeight;
      placeholder.style.maxHeight=entryStyle.maxHeight;
      placeholder.style.marginBlockStart=entryStyle.marginBlockStart;
      placeholder.style.marginBlockEnd=entryStyle.marginBlockEnd;
      placeholder.style.marginInlineStart=entryStyle.marginInlineStart;
      placeholder.style.marginInlineEnd=entryStyle.marginInlineEnd;
      placeholder.style.transform=entryStyle.transform;
      placeholder.style.transformOrigin=entryStyle.transformOrigin;
    }
    placeholder.setAttribute('aria-hidden','true');
    return placeholder;
  }

  function resetArtworkForInspection(entry) {
    const foilSurface=entry?.querySelector?.('.lightbox-holographic');
    if(foilSurface){
      foilSurface.classList.remove('is-flipped');
      foilSurface.setAttribute('aria-pressed','false');
      resetFoilMotionImmediately(foilSurface);
    }
    const faceLabel=entry?.querySelector?.('.lightbox-holographic-hint [data-holo-face-label]');
    if(faceLabel)faceLabel.textContent='FRONT';
  }

  function createInspectNavigationButton(direction) {
    const button=documentRef.createElement('button');
    const isPrevious=direction<0;
    button.type='button';
    button.className='lightbox-nav lightbox-inspect-nav '+(isPrevious?'lightbox-inspect-prev':'lightbox-inspect-next');
    button.setAttribute('aria-label',isPrevious?'Previous artwork':'Next artwork');
    button.innerHTML='<i class="fa-solid '+(isPrevious?'fa-chevron-left':'fa-chevron-right')+'" aria-hidden="true"></i>';
    return button;
  }

  function animateInspectBoundary(active, direction) {
    if(!active?.frame||prefersReducedInspectMotion()||typeof active.frame.animate!=='function')return;
    try{active.openAnimation?.cancel?.();}catch(_){}
    try{active.edgeAnimation?.cancel?.();}catch(_){}
    try{active.navigationAnimation?.cancel?.();}catch(_){}
    active.openAnimation=null;
    active.navigationAnimation=null;
    const offset=direction>0?-8:8;
    active.edgeAnimation=active.frame.animate([
      {transform:'translate3d(0,0,0)'},
      {transform:'translate3d('+offset+'px,0,0)'},
      {transform:'translate3d('+(-offset*.25)+'px,0,0)'},
      {transform:'translate3d(0,0,0)'}
    ],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});
  }

  function navigateArtworkInspect(direction) {
    const active=activeInspector;
    const delta=direction<0?-1:1;
    if(!active||active.isClosing||!active.groupEntries?.length)return;
    const nextIndex=active.currentIndex+delta;
    if(nextIndex<0||nextIndex>=active.groupEntries.length){
      animateInspectBoundary(active,delta);
      return;
    }
    const nextEntry=active.groupEntries[nextIndex];
    if(!nextEntry||nextEntry===active.entry||nextEntry.parentElement!==active.groupItems)return;

    try{active.openAnimation?.cancel?.();}catch(_){}
    try{active.edgeAnimation?.cancel?.();}catch(_){}
    try{active.navigationAnimation?.cancel?.();}catch(_){}
    active.openAnimation=null;
    active.edgeAnimation=null;
    active.navigationAnimation=null;

    const previousEntry=active.entry;
    if(!active.placeholder?.parentNode)return;
    previousEntry.querySelectorAll('video,mux-player').forEach(media=>{try{media.pause?.();}catch(_){}});
    previousEntry.querySelectorAll('iframe[data-lm-youtube]').forEach(pauseYouTubeFrame);
    resetArtworkForInspection(previousEntry);
    if(active.foilHint&&active.foilHintPlaceholder?.parentNode){
      active.foilHintPlaceholder.replaceWith(active.foilHint);
    }
    active.placeholder.replaceWith(previousEntry);

    const nextPlaceholder=createArtworkInspectPlaceholder(nextEntry);
    active.groupItems.insertBefore(nextPlaceholder,nextEntry);
    const nextHint=nextEntry.querySelector('.lightbox-holographic-hint');
    let nextHintPlaceholder=null;
    if(nextHint?.parentNode){
      nextHintPlaceholder=documentRef.createElement('span');
      nextHintPlaceholder.className='lightbox-inspect-hint-placeholder';
      nextHintPlaceholder.hidden=true;
      nextHintPlaceholder.setAttribute('aria-hidden','true');
      nextHint.parentNode.insertBefore(nextHintPlaceholder,nextHint);
    }

    resetArtworkForInspection(nextEntry);
    active.frame.replaceChildren(nextEntry);
    if(nextHint)active.footer.insertBefore(nextHint,active.description);
    const caption=String(nextEntry.querySelector('.media-caption')?.textContent||'').trim();
    active.description.textContent=caption;
    active.description.hidden=!caption;
    active.entry=nextEntry;
    active.placeholder=nextPlaceholder;
    active.foilHint=nextHint||null;
    active.foilHintPlaceholder=nextHintPlaceholder;
    active.foilSurface=nextEntry.querySelector('.lightbox-holographic');
    active.focusTarget=nextEntry;
    active.currentIndex=nextIndex;
    selectGroupedArtworkEntry(nextEntry,active.groupSection);

    pauseOtherPlayback(active.container,nextEntry.querySelector('video, mux-player, iframe[data-lm-youtube]'));

    if(!prefersReducedInspectMotion()&&typeof active.frame.animate==='function'){
      const offset=delta>0?14:-14;
      try{
        active.navigationAnimation=active.frame.animate([
          {opacity:.82,transform:'translate3d('+offset+'px,0,0)'},
          {opacity:1,transform:'translate3d(0,0,0)'}
        ],{duration:240,easing:'cubic-bezier(.16,1,.3,1)'});
      }catch(_){}
    }
  }

  function buildInspectTransform(fromRect, toRect) {
    const from=fromRect||{},to=toRect||{};
    const fw=Number(from.width)||0,fh=Number(from.height)||0,tw=Number(to.width)||0,th=Number(to.height)||0;
    if(!(fw>0&&fh>0&&tw>0&&th>0))return 'translate3d(0,0,0) scale(1,1)';
    const fx=(Number(from.left)||0)+fw/2,fy=(Number(from.top)||0)+fh/2;
    const tx=(Number(to.left)||0)+tw/2,ty=(Number(to.top)||0)+th/2;
    return 'translate3d('+(fx-tx).toFixed(2)+'px,'+(fy-ty).toFixed(2)+'px,0) scale('+(fw/tw).toFixed(4)+','+(fh/th).toFixed(4)+')';
  }
  function prefersReducedInspectMotion() {
    return Boolean(windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  }
  function closeArtworkInspect(options = {}) {
    const active=activeInspector;
    if(!active||active.isClosing)return;
    const immediate=options===true||options?.immediate===true;

    // Inspect Mode is a temporary magnified view, not a persistent flip state.
    // Return grouped artwork to FRONT whenever Inspect is exited via Back,
    // Escape, or the backdrop.
    const foilSurface=active.entry?.querySelector('.lightbox-holographic');
    if(foilSurface){
      foilSurface.classList.remove('is-flipped');
      foilSurface.setAttribute('aria-pressed','false');
    }
    const faceLabel=active.foilHint?.querySelector('[data-holo-face-label]');
    if(faceLabel)faceLabel.textContent='FRONT';

    const finishClose=()=>{
      if(activeInspector!==active)return;
      activeInspector=null;
      active.overlay.removeEventListener('click',active.onBackdropClick);
      active.overlay.removeEventListener('keydown',active.onKeyDown);
      active.overlay.removeEventListener('pointerdown',active.onInspectPointerDown);
      active.overlay.removeEventListener('pointermove',active.onInspectPointerMove);
      active.overlay.removeEventListener('pointerup',active.onInspectPointerUp);
      active.overlay.removeEventListener('pointercancel',active.onInspectPointerCancel);
      active.previousButton?.removeEventListener('click',active.onPreviousClick);
      active.nextButton?.removeEventListener('click',active.onNextClick);
      try{active.openAnimation?.cancel?.();}catch(_){}
      try{active.overlayAnimation?.cancel?.();}catch(_){}
      try{active.navigationAnimation?.cancel?.();}catch(_){}
      try{active.edgeAnimation?.cancel?.();}catch(_){}
      if(active.placeholder?.parentNode)active.placeholder.replaceWith(active.entry);
      if(active.foilHintPlaceholder?.parentNode&&active.foilHint)active.foilHintPlaceholder.replaceWith(active.foilHint);
      active.overlay.remove();
      documentRef.documentElement?.classList?.remove('lm-artwork-inspect-open');
      documentRef.body?.classList?.remove('lm-artwork-inspect-open');
      // The group item and its placeholder are back in the Lightbox now.
      // Restore the caller's anchoring policy immediately, then reassert the
      // captured scroll offset through the next two layout frames so browser
      // anchoring cannot leave the viewer at a different position.
      active.restoreLightboxScroll?.();
      active.restoreLightboxOverflowAnchor?.();
      windowRef.requestAnimationFrame(()=>{
        active.restoreLightboxScroll?.();
        windowRef.requestAnimationFrame(()=>active.restoreLightboxScroll?.());
      });

      // Keyboard closure returns focus to the originating group item. Avoid a
      // persistent card-sized ring at that handoff, but restore normal focus
      // indication as soon as the user navigates or interacts again.
      const focusTarget=active.focusTarget;
      if(options?.viaKeyboard&&focusTarget?.classList?.contains('is-grouped-artwork-interactive')){
        focusTarget.classList.add('is-inspect-focus-return');
        const clearFocusReturn=()=>{
          focusTarget.classList.remove('is-inspect-focus-return');
          focusTarget.removeEventListener('keydown',clearFocusReturn,true);
          focusTarget.removeEventListener('pointerdown',clearFocusReturn,true);
          focusTarget.removeEventListener('focusout',clearFocusReturn);
        };
        focusTarget.addEventListener('keydown',clearFocusReturn,true);
        focusTarget.addEventListener('pointerdown',clearFocusReturn,true);
        focusTarget.addEventListener('focusout',clearFocusReturn,{once:true});
      }
      try{focusTarget?.focus?.({preventScroll:true});}
      catch(_){try{focusTarget?.focus?.();}catch(__){}}
    };
    if(!immediate&&!prefersReducedInspectMotion()&&typeof active.frame?.animate==='function'&&active.placeholder?.isConnected){
      const currentRect=active.frame.getBoundingClientRect?.(),returnRect=active.placeholder.getBoundingClientRect?.();
      if(currentRect?.width>0&&returnRect?.width>0){
        active.isClosing=true;
        try{
          try{active.openAnimation?.cancel?.();}catch(_){}
          active.overlay.classList.add('is-closing');
          try{active.overlayAnimation=active.overlay.animate([{opacity:1},{opacity:0}],{duration:300,easing:'cubic-bezier(.4,0,1,1)',fill:'both'});}catch(_){}
          const animation=active.frame.animate([
            {transform:'translate3d(0,0,0) scale(1,1)'},
            {transform:buildInspectTransform(returnRect,currentRect)}
          ],{duration:300,easing:'cubic-bezier(.4,0,1,1)',fill:'both'});
          active.closeAnimation=animation;
          animation.onfinish=finishClose;
          animation.oncancel=finishClose;
          return;
        }catch(_){}
      }
    }
    finishClose();
  }
  function openArtworkInspect(container, entry, project, focusTarget) {
    if(!entry?.parentNode||!container)return;
    if(activeInspector)closeArtworkInspect({immediate:true});
    const foilSurface=entry.querySelector('.lightbox-holographic');
    // A pointer pose from the gallery must not carry into the full-screen
    // Inspector or contaminate the opening FLIP geometry. Start face-on.
    if(foilSurface)resetFoilMotionImmediately(foilSurface);
    const parent=entry.parentNode,originRect=entry.getBoundingClientRect?.();
    const groupItems=parent;
    const groupSection=entry.closest?.('.lightbox-artwork-group')||parent.closest?.('.lightbox-artwork-group');
    const groupEntries=Array.from(groupItems.children||[]).filter(node=>node.classList?.contains('lightbox-media-item'));
    const currentIndex=groupEntries.indexOf(entry);
    const lightbox=container.closest?.('#lightbox')||documentRef.getElementById('lightbox');
    const lightboxScrollTop=Number(lightbox?.scrollTop)||0;
    // Moving a grouped item into the body-level Inspect overlay changes the
    // Lightbox subtree. Disable anchoring before the first DOM mutation so the
    // browser cannot compensate for that move by shifting the Lightbox scroll.
    const previousLightboxOverflowAnchor=lightbox?.style?.overflowAnchor??'';
    if(lightbox)lightbox.style.overflowAnchor='none';
    const restoreLightboxScroll=()=>{if(lightbox&&lightbox.isConnected)lightbox.scrollTop=lightboxScrollTop;};
    const restoreLightboxOverflowAnchor=()=>{
      if(lightbox&&lightbox.isConnected)lightbox.style.overflowAnchor=previousLightboxOverflowAnchor;
    };
    const foilHint=entry.querySelector('.lightbox-holographic-hint');
    let foilHintPlaceholder=null;
    if(foilHint?.parentNode){
      foilHintPlaceholder=documentRef.createElement('span');
      foilHintPlaceholder.className='lightbox-inspect-hint-placeholder';
      foilHintPlaceholder.hidden=true;
      foilHintPlaceholder.setAttribute('aria-hidden','true');
      foilHint.parentNode.insertBefore(foilHintPlaceholder,foilHint);
    }
    const placeholder=createArtworkInspectPlaceholder(entry);
    parent.insertBefore(placeholder,entry);

    const overlay=documentRef.createElement('div');
    overlay.className='lightbox-inspect-mode';
    overlay.dataset.inspectMode='true';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-label','Inspect artwork in '+String(project.title||'this project'));
    const panel=documentRef.createElement('div');
    panel.className='lightbox-inspect-panel';
    const stage=documentRef.createElement('div');
    stage.className='lightbox-inspect-stage';
    const frame=documentRef.createElement('div');
    frame.className='lightbox-inspect-frame';
    frame.appendChild(entry);

    const footer=documentRef.createElement('div');
    footer.className='lightbox-inspect-footer';
    const caption=String(entry.querySelector('.media-caption')?.textContent||'').trim();
    const description=documentRef.createElement('p');
    description.className='lightbox-inspect-description';
    // A grouped artwork owns its own caption. Do not fall back to project title
    // or project description, and do not repeat the same caption in two fields.
    description.textContent=caption;
    description.hidden=!caption;
    const back=documentRef.createElement('button');
    back.type='button';
    back.className='model-viewer-back lightbox-inspect-back';
    back.innerHTML='<i class="fa-solid fa-arrow-left" aria-hidden="true"></i>';
    back.setAttribute('aria-label','Close Inspect Mode and return to the artwork group');
    back.addEventListener('click',event=>closeArtworkInspect({viaKeyboard:event.detail===0}));
    const previousButton=groupEntries.length>1?createInspectNavigationButton(-1):null;
    const nextButton=groupEntries.length>1?createInspectNavigationButton(1):null;
    const onPreviousClick=event=>{event.preventDefault();event.stopPropagation();navigateArtworkInspect(-1);};
    const onNextClick=event=>{event.preventDefault();event.stopPropagation();navigateArtworkInspect(1);};
    previousButton?.addEventListener('click',onPreviousClick);
    nextButton?.addEventListener('click',onNextClick);
    stage.appendChild(frame);
    if(foilHint)footer.appendChild(foilHint);
    footer.append(description,back);
    panel.append(stage,footer);
    overlay.appendChild(panel);
    if(previousButton&&nextButton)overlay.append(previousButton,nextButton);
    let inspectSwipeStart=null;
    const inspectSwipeDisabledTarget=target=>Boolean(target?.closest?.('button,a,input,select,textarea,video,mux-player,iframe,.model-viewer-shell,.lightbox-inspect-footer'));
    const onInspectPointerDown=event=>{
      if(!windowRef?.matchMedia?.('(max-width:767px)')?.matches||event.pointerType==='mouse'||event.isPrimary===false)return;
      if(inspectSwipeDisabledTarget(event.target)||!event.target?.closest?.('.lightbox-inspect-stage'))return;
      inspectSwipeStart={x:Number(event.clientX)||0,y:Number(event.clientY)||0,pointerId:event.pointerId};
    };
    const onInspectPointerMove=event=>{
      if(!inspectSwipeStart||event.pointerId!==inspectSwipeStart.pointerId)return;
      const dx=(Number(event.clientX)||0)-inspectSwipeStart.x;
      const dy=(Number(event.clientY)||0)-inspectSwipeStart.y;
      if(Math.abs(dy)>=16&&Math.abs(dy)>Math.abs(dx)*1.2)inspectSwipeStart=null;
    };
    const onInspectPointerUp=event=>{
      if(!inspectSwipeStart||event.pointerType==='mouse'||event.isPrimary===false)return;
      if(event.pointerId!==undefined&&event.pointerId!==inspectSwipeStart.pointerId)return;
      const start=inspectSwipeStart;
      inspectSwipeStart=null;
      const dx=(Number(event.clientX)||0)-start.x;
      const dy=(Number(event.clientY)||0)-start.y;
      if(Math.abs(dx)<52||Math.abs(dx)<=Math.abs(dy)*1.25)return;
      event.preventDefault();
      const swipedEntry=activeInspector?.entry;
      if(swipedEntry){
        const suppressSwipeClick=clickEvent=>{
          documentRef.removeEventListener('click',suppressSwipeClick,true);
          if(clickEvent.detail>0&&swipedEntry.contains?.(clickEvent.target)){
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            clickEvent.stopImmediatePropagation();
          }
        };
        documentRef.addEventListener('click',suppressSwipeClick,true);
        windowRef?.setTimeout?.(()=>documentRef.removeEventListener('click',suppressSwipeClick,true),0);
      }
      navigateArtworkInspect(dx<0?1:-1);
    };
    const onInspectPointerCancel=event=>{
      if(!inspectSwipeStart)return;
      if(event.pointerId!==undefined&&event.pointerId!==inspectSwipeStart.pointerId)return;
      inspectSwipeStart=null;
    };
    overlay.addEventListener('pointerdown',onInspectPointerDown,{passive:true});
    overlay.addEventListener('pointermove',onInspectPointerMove,{passive:true});
    overlay.addEventListener('pointerup',onInspectPointerUp);
    overlay.addEventListener('pointercancel',onInspectPointerCancel);
    const onBackdropClick=event=>{if(event.target===overlay)closeArtworkInspect();};
    const onKeyDown=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeArtworkInspect({viaKeyboard:true});return;}
      if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
        // Keep native seek/selection keys available to embedded media controls.
        if(event.target?.closest?.('video,mux-player,iframe,input,textarea,select,[role="slider"],[part~="range"]'))return;
        event.preventDefault();
        event.stopPropagation();
        navigateArtworkInspect(event.key==='ArrowLeft'?-1:1);
        return;
      }
      if(event.key!=='Tab')return;
      event.stopPropagation();
      const focusables=Array.from(overlay.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]'))
        .filter(node=>!node.closest('[hidden],[inert]')&&node.getClientRects().length>0&&windowRef.getComputedStyle(node).visibility!=='hidden');
      if(!focusables.length){event.preventDefault();back.focus();return;}
      const first=focusables[0],last=focusables[focusables.length-1];
      if(event.shiftKey&&documentRef.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&documentRef.activeElement===last){event.preventDefault();first.focus();}
    };
    overlay.addEventListener('click',onBackdropClick);
    overlay.addEventListener('keydown',onKeyDown);
    const active={container,entry,placeholder,foilHint,foilHintPlaceholder,foilSurface,overlay,frame,footer,description,back,previousButton,nextButton,groupItems,groupSection,groupEntries,currentIndex,lightbox,lightboxScrollTop,restoreLightboxScroll,restoreLightboxOverflowAnchor,focusTarget:focusTarget||back,onBackdropClick,onKeyDown,onPreviousClick,onNextClick,onInspectPointerDown,onInspectPointerMove,onInspectPointerUp,onInspectPointerCancel,openAnimation:null,overlayAnimation:null,closeAnimation:null,navigationAnimation:null,edgeAnimation:null,isClosing:false};
    activeInspector=active;
    documentRef.documentElement?.classList?.add('lm-artwork-inspect-open');
    documentRef.body?.classList?.add('lm-artwork-inspect-open');
    documentRef.body.appendChild(overlay);
    restoreLightboxScroll();
    windowRef.requestAnimationFrame(()=>{restoreLightboxScroll();windowRef.requestAnimationFrame(restoreLightboxScroll);});
    try{back.focus({preventScroll:true});}catch(_){back.focus?.();}
    const animateOpen=()=>{
      if(activeInspector!==active||prefersReducedInspectMotion())return;
      const targetRect=frame.getBoundingClientRect?.();
      if(!(originRect?.width>0&&targetRect?.width>0)||typeof frame.animate!=='function')return;
      try{
        try{
          active.overlayAnimation=overlay.animate([{opacity:0},{opacity:1}],{duration:360,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'});
          active.overlayAnimation.onfinish=()=>{try{active.overlayAnimation?.cancel?.();}catch(_){}active.overlayAnimation=null;};
        }catch(_){}
        const animation=frame.animate([
          {transform:buildInspectTransform(originRect,targetRect)},
          {transform:'translate3d(0,0,0) scale(1,1)'}
        ],{duration:460,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'});
        active.openAnimation=animation;
        animation.onfinish=()=>{if(activeInspector!==active)return;try{animation.cancel();}catch(_){}active.openAnimation=null;};
      }catch(_){}
    };
    if(typeof windowRef?.requestAnimationFrame==='function')windowRef.requestAnimationFrame(animateOpen);
    else animateOpen();
  }

  return {
    open: openArtworkInspect,
    close: closeArtworkInspect,
    isActive() {
      return Boolean(activeInspector);
    },
    isInspectingEntry(entry) {
      return activeInspector?.entry === entry;
    },
    closeForContainer(container, options = {}) {
      if (activeInspector?.container === container) closeArtworkInspect(options);
    }
  };
}
