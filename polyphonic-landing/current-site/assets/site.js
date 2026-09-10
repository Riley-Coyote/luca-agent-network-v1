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
  document.querySelectorAll('.grant-chip').forEach(btn=>btn.addEventListener('click',()=>{
    const row=Number(btn.dataset.row);
    grants[row]=!grants[row];btn.setAttribute('aria-checked',String(grants[row]));
    knowledge();
  }));
  const resolvePermission = allowed => {
    $('#permission-request').hidden = true;$('#permission-result').hidden=false;
    $('#permission-result p').textContent=allowed?'Allowed once. In this example, Codex adds the next step to the welcome screen.':'Request declined. Nothing changes. Codex can suggest another approach.';
    $('#reset-permission').focus({preventScroll:true});
  };
  $('#allow').addEventListener('click',()=>resolvePermission(true));$('#deny').addEventListener('click',()=>resolvePermission(false));
  $('#reset-permission').addEventListener('click',()=>{$('#permission-result').hidden=true;$('#permission-request').hidden=false;$('#allow').focus({preventScroll:true})});

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
})();
