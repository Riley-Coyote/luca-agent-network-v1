/* Progressive enhancement: the complete story is already present in HTML. */
(() => {
  const $ = s => document.querySelector(s);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let manualPause = false;
  const applyMotion = () => {
    const paused = reduced.matches || manualPause;
    document.documentElement.dataset.motion = paused ? 'paused' : 'playing';
    const btn = $('#motion-toggle');
    btn.setAttribute('aria-pressed', String(paused));
    btn.setAttribute('aria-label', reduced.matches ? 'Reduced motion is enabled' : paused ? 'Resume page animation' : 'Pause page animation');
    btn.disabled = reduced.matches;
    btn.title = reduced.matches ? 'Following your reduced-motion preference' : paused ? 'Resume animation' : 'Pause animation';
    btn.querySelector('path').setAttribute('d', paused ? 'M9 5l10 7-10 7z' : 'M8 6v12M16 6v12');
    btn.querySelector('.sr-only').textContent = btn.getAttribute('aria-label');
    window.dispatchEvent(new CustomEvent('polyphonic:motion', {detail:{paused}}));
  };
  $('#motion-toggle').addEventListener('click', () => {manualPause = !manualPause; applyMotion()});
  reduced.addEventListener('change', applyMotion); applyMotion();
  // WP-04: one agent, four sources. The demonstration grants never touch a real account or agent.
  const grants = [true,true,true,true];
  const knowledge = () => {
    const has = i => grants[i]; const phrases=[];
    if(has(0)&&has(1))phrases.push('You wanted this release kept small, so I’ve held us to the brief: one route from a note to a plan');
    else if(has(0))phrases.push('The brief holds us to one route from a note to a plan');
    else if(has(1))phrases.push('You like releases small, so I’ve kept this one small');
    if(has(2))phrases.push('Codex finished the walkthrough overnight');
    if(has(3))phrases.push('Tuesday’s call stands: one clear next step for the empty screen');
    $('#luca-knows').textContent = phrases.length ? phrases.join('. ')+'.' : 'Morning. I don’t have anything on Northstar yet. What is it?';
  };
  // Each chip also carries .grant-toggle[data-agent="luca"]: assets/demo.js reads that selector
  // to mirror the grants into the app frame. Renaming it silently breaks the demo.
  // WP-13: the Doto count beside "Luca can see" follows the chips. It is decoration (aria-hidden): the
  // chips carry the state as switches, and Luca's reply is the words.
  const brainCount=$('#brain-count');
  const countGrants=()=>{if(brainCount)brainCount.textContent=String(grants.filter(Boolean).length)};
  document.querySelectorAll('.grant-chip').forEach(btn=>btn.addEventListener('click',()=>{
    const row=Number(btn.dataset.row);
    grants[row]=!grants[row];btn.setAttribute('aria-checked',String(grants[row]));
    knowledge();countGrants();
  }));
  // WP-13: the readout in the card's header states the request: PENDING, then ALLOWED or DENIED, and
  // PENDING again on reset. aria-hidden and never live; the result sentence is what gets announced.
  const permissionState=$('#permission-state');
  const setPermissionState=word=>{if(permissionState)permissionState.textContent=word};
  const resolvePermission = allowed => {
    $('#permission-request').hidden = true;$('#permission-result').hidden=false;
    $('#permission-result p').textContent=allowed?'Allowed once. In this example, Codex adds the next step to the welcome screen.':'Request declined. Nothing changes. Codex can suggest another approach.';
    setPermissionState(allowed?'ALLOWED':'DENIED');
    $('#reset-permission').focus({preventScroll:true});
  };
  $('#allow').addEventListener('click',()=>resolvePermission(true));$('#deny').addEventListener('click',()=>resolvePermission(false));
  $('#reset-permission').addEventListener('click',()=>{$('#permission-result').hidden=true;$('#permission-request').hidden=false;setPermissionState('PENDING');$('#allow').focus({preventScroll:true})});

  const form=$('#beta-form'), email=$('#email'), submit=$('#signup-submit'), note=$('#signup-note');
  const config=window.POLYPHONIC_CONFIG||{};let busy=false;
  if(config.signupEndpoint)note.textContent='Beta builds and news only. No unrelated email.';
  if(config.privacyUrl){const a=document.createElement('a');a.textContent='Privacy';a.href=config.privacyUrl;a.className='privacy-link';$('.creator').after(a)}
  email.addEventListener('input',()=>{email.removeAttribute('aria-invalid');if(!busy){submit.disabled=false;submit.textContent='Request the beta';}});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    if(!email.validity.valid || !email.value.trim()){
      email.setAttribute('aria-invalid','true');note.textContent='Please enter a valid email address.';email.focus();return;
    }
    if(!config.signupEndpoint){note.textContent='Beta requests aren’t open yet. Your email has not been sent or saved.';return}
    busy=true;submit.disabled=true;submit.textContent='Requesting…';form.setAttribute('aria-busy','true');note.textContent='Sending your request…';
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(config.signupEndpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({email:email.value.trim(),source:'polyphonic-beta',website:form.querySelector('#website')?.value||''}),signal:controller.signal});
      if(!response.ok)throw new Error(`Signup failed: ${response.status}`);
      const result=await response.json().catch(()=>({}));
      note.textContent=result.status==='already_subscribed'?'You’re already on the list. We’ll email your download link when a build is ready.':result.status==='confirmation_required'?'Check your inbox to confirm your email address.':'You’re on the list. We’ll email your download link when a build is ready.';submit.textContent='Requested';email.value='';submit.disabled=true;
    }catch{
      note.textContent='Your request couldn’t be confirmed. Please try again.';submit.textContent='Request the beta';submit.disabled=false;
    }finally{clearTimeout(timeout);busy=false;form.removeAttribute('aria-busy')}
  });
  // Animate a section once as it enters; content stays readable if JS never loads.
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(!entry.isIntersecting)return;
    if(!reduced.matches&&!manualPause)entry.target.classList.add('reveal-enter');
    observer.unobserve(entry.target);
  }),{threshold:.12});
  document.querySelectorAll('.feature-copy,.product-panel,.how-intro,.beta-inner').forEach(el=>observer.observe(el));

  /* WP-08: the loop has depth. One number per window — --d, its centre's distance from the
     viewport centre over half the viewport, clamped to [-1,1] — and assets/site.css turns that
     into perspective, shade and the top-edge light. d comes from the drift animation's own clock
     and the track's fixed pitch, so no frame reads layout; the pitch, the window width, the
     track's span and the band's resting left edge are measured once, and again on resize. The
     loop runs only while it can change anything: it stops when the band leaves the screen and
     when the drift is paused by hover, focus or the motion toggle — writing one last time so the
     frozen picture is exact. Desktop drift only; below 761px and under reduced motion the row is
     the flat scroller it has always been. */
  const band=$('.pw-band'), track=$('.pw-track');
  if(band&&track){
    const wins=[...track.querySelectorAll('.pw-window')], last=wins.map(()=>NaN);
    const wide=matchMedia('(min-width: 761px)');
    /* WP-14: the sign reads the loop. The window in the light, the one with the smallest |d|, is announced
       once per change as polyphonic:loop-centre {index, runtime} for assets/dot-display.js to name. The index
       is taken mod the seven, because the track's second half is the aria-hidden duplicate. A new window
       takes over only once it is the nearest and its |d| is under .5: at narrow desktop widths two windows
       can straddle the centre both beyond .5, and the one already named holds until one of them crosses.
       Nothing is announced while the loop is paused or off screen, because then it stops. A listener that
       arrives after the first announcement asks with polyphonic:loop-centre-request {reply} and is answered on
       that callback, so the announcement itself still happens once per change and never twice for one centre. */
    const seven=track.querySelectorAll('.pw-half:not(.pw-half-dup) .pw-window').length||wins.length;
    const runtimes=wins.map(w=>{const r=w.querySelector('.pw-runtime');return r?r.textContent.trim():''});
    let centre=-1;
    const current=()=>({index:centre,runtime:runtimes[centre]});
    const announce=i=>{if(i<0||i===centre)return;centre=i;dispatchEvent(new CustomEvent('polyphonic:loop-centre',{detail:current()}))};
    addEventListener('polyphonic:loop-centre-request',e=>{const reply=e.detail&&e.detail.reply;if(centre>=0&&typeof reply==='function')reply(current())});
    let anim=null, byRect=false, pitch=424, winW=400, span=2968, base=0;
    let rafId=0, grace=0, visible=true, active=false;
    const clock=()=>{ // the track's own translateX in px, read from the animation, never from layout
      if(!anim)return 0;
      const t=anim.currentTime, ms=t&&typeof t==='object'?t.value:t;
      const dur=anim.effect.getTiming().duration;
      if(ms==null||!dur)return 0;
      return -((ms%dur)/dur)*span;
    };
    const measure=()=>{
      const list=track.getAnimations?track.getAnimations():[];
      anim=list.find(a=>a.animationName==='pw-drift')||list[0]||null;
      byRect=!anim; // no animation to read: fall back to per-frame rects
      if(wins.length>1)pitch=wins[1].offsetLeft-wins[0].offsetLeft;
      winW=wins[0].offsetWidth; span=track.offsetWidth/2;
      // offsetLeft is layout, so the track's transform cannot corrupt this, and the band never moves.
      base=band.getBoundingClientRect().left+(wins[0].offsetLeft-band.offsetLeft);
    };
    const update=()=>{
      const half=innerWidth/2, t=clock();
      let near=-1, nd=.5; // WP-14: the nearest window, if one is under .5
      for(let i=0;i<wins.length;i++){
        const c=byRect?wins[i].getBoundingClientRect().left+winW/2:base+i*pitch+t+winW/2;
        let d=(c-half)/half; d=d<-1?-1:d>1?1:d;
        if(!(Math.abs(d-last[i])<5e-4)){last[i]=d;wins[i].style.setProperty('--d',d.toFixed(4))}
        const a=d<0?-d:d; if(a<nd){nd=a;near=i}
      }
      if(near>=0)announce(near%seven);
    };
    const paused=()=>anim?anim.playState==='paused':document.documentElement.dataset.motion==='paused';
    const depthFrame=()=>{
      rafId=0;update();if(grace>0)grace--;
      if(!active||!visible||(paused()&&!grace))return;
      rafId=requestAnimationFrame(depthFrame);
    };
    // A few frames of grace: hover and the toggle change play state through style, one frame late.
    const kick=()=>{grace=4;if(!rafId&&active&&visible)rafId=requestAnimationFrame(depthFrame)};
    const halt=()=>{if(rafId)cancelAnimationFrame(rafId);rafId=0};
    const sync=()=>{
      const on=wide.matches&&!reduced.matches&&wins.length>0;
      if(on===active)return;
      active=on;
      if(on){measure();kick()}
      else{halt();wins.forEach((el,i)=>{last[i]=NaN;el.style.removeProperty('--d')})}
    };
    new IntersectionObserver(es=>{visible=es[es.length-1].isIntersecting;visible?kick():halt()},{rootMargin:'120px'}).observe(band);
    addEventListener('resize',()=>{if(active){measure();kick()}},{passive:true});
    ['pointerenter','pointerleave','focusin','focusout'].forEach(e=>band.addEventListener(e,kick));
    addEventListener('polyphonic:motion',kick);
    wide.addEventListener('change',sync);reduced.addEventListener('change',sync);sync();
    /* WP-14: below 761px and under reduced motion the row is a snap scroller with no loop to read, so the sign
       follows the window nearest the scroller's centre once scrolling settles: on scrollend where the browser
       has it, else 120ms after the last scroll event, with one layout read per settle. */
    let following=false, settleTimer=0;
    const settle=()=>{
      clearTimeout(settleTimer);settleTimer=0;
      const box=band.getBoundingClientRect(), mid=box.left+band.clientLeft+band.clientWidth/2;
      let near=-1, nd=Infinity;
      for(let i=0;i<seven;i++){const r=wins[i].getBoundingClientRect();if(!r.width)continue;const a=Math.abs(r.left+r.width/2-mid);if(a<nd){nd=a;near=i}}
      announce(near);
    };
    const later=()=>{clearTimeout(settleTimer);settleTimer=setTimeout(settle,120)};
    const settleOn='onscrollend' in window?'scrollend':'scroll', onSettle=settleOn==='scrollend'?settle:later;
    const follow=()=>{
      const on=!(wide.matches&&!reduced.matches);
      if(on===following)return;
      following=on;
      if(on){band.addEventListener(settleOn,onSettle,{passive:true});settle()}
      else{band.removeEventListener(settleOn,onSettle);clearTimeout(settleTimer)}
    };
    addEventListener('resize',()=>{if(following)later()},{passive:true});
    wide.addEventListener('change',follow);reduced.addEventListener('change',follow);follow();
  }
})();
