/* A deterministic, local product demonstration. No agent or account requests. */
(() => {
  const root = document.querySelector('#preview .app-frame');
  if (!root) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (s, parent = root) => parent.querySelector(s);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    chat:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z', group:'M7 3h14v12h-4v5l-5-5H7zM7 7H3v14l4-4h4', mic:'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8', smile:'M21 12a9 9 0 1 1-9-9M8 14s1.5 2 4 2 4-2 4-2M8 9h.01M16 9h.01M19 2v6M16 5h6', library:'M4 4v16M8 4v16M12 5l5 14M18 4l3 15', plus:'M12 5v14M5 12h14',
    agents:'M7 7h10v11H7zM12 3v4M3 10h4M17 10h4M10 11v2M14 11v2', activity:'M3 12h4l3-8 4 16 3-8h4',
    brain:'M12 4C8 1 5 4 6 7c-5 1-4 7-1 8-1 4 4 6 7 3V4zm0 0c4-3 7 0 6 3 5 1 4 7 1 8 1 4-4 6-7 3M7 8l3 2M17 8l-3 2',
    settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
    search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6', drawer:'M3 4h18v16H3zM15 4v16',
    pop:'M14 14h8v7h-8zM10 18H3V4h17v7', split:'M3 4h18v16H3zM3 9h18M10 9v11', close:'M6 6l12 12M18 6L6 18',
    expand:'M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6', arrow:'M12 19V5M6 11l6-6 6 6', file:'M5 3h9l5 5v13H5zM14 3v6h5',
    check:'M5 12l4 4L19 6', back:'M15 5l-7 7 7 7', next:'M9 5l7 7-7 7', chevron:'M9 6l6 6-6 6', link:'M9 15l6-6M8 17l-2 2a4 4 0 0 1-5-5l4-4M16 7l2-2a4 4 0 0 1 5 5l-4 4', pause:'M8 5v14M16 5v14', play:'M8 4l12 8-12 8z'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.chat}"/></svg>`;
  const action = (a, label, content, extra='') => `<button type="${a==='send'?'submit':'button'}" data-action="${a}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${content}</button>`;
  const ib = (a, label, name, extra='') => action(a,label,icon(name),`class="d-icon" ${extra}`);
  const providers = ['Claude Code','Codex','Kimi Code','Grok','Hermes','OpenClaw'];
  const providerFiles = {'Claude Code':'claude.png',Codex:'codex.png','Kimi Code':'kimi.svg',Grok:'grok.svg',Hermes:'hermes.png',OpenClaw:'openclaw.svg'};
  const providerMark = name => `<img class="d-brand" src="assets/polyphonic/${providerFiles[name]}" alt="" width="20" height="20">`;
  const runtimeData = {
    'Claude Code':['Welcome screen','Working with Kimi on a clearer first step.','Design','Kimi suggested a single prompt instead of three competing actions. Claude Code is applying that change.'],
    Codex:['Project sync','Keeping the project state consistent across windows.','Architecture','The shared state now updates both the main chat and the detached window. The saved walkthrough is available below.'],
    'Kimi Code':['A second design perspective','Reviewing the welcome screen with Claude Code.','Review','Keep the first screen simple: one invitation, then the next useful step. Put the longer explanation where people can choose to read it.'],
    Grok:['Launch wording','Checking whether the promise matches the experience.','Review','Lead with one home for your agents. Show the collaboration before explaining the infrastructure.'],
    Hermes:['Luca’s home runtime','Luca and Mira keep their native memory and tools.','Resident','Luca knows the project brief and your preference for small releases. Changing a runtime in this demo leaves that identity intact.'],
    OpenClaw:['Release notes','Ziggy is reviewing the Northstar release notes.','Resident','The walkthrough and welcome screen are included. Offline mobile support stays out of this first release.']
  };
  const sources = [
    ['Northstar brief.md','Project brief','One route from a note to a plan. Ship a small, useful first release. Keep offline mobile support for later.'],
    ['How I like to work','Remembered preference','Keep releases small. Show the tradeoffs, recommend one path, and ask before expanding the scope.'],
    ['Codex session · Sep 6','Saved conversation','The first walkthrough is implemented. The project state survives a restart. The remaining design question is the empty screen.'],
    ["Tuesday’s decisions",'Earlier conversation','We chose a single clear next step for the empty screen. Mira should review the scope before we ship.']
  ];
  const rooms = {
    'Launch': {members:'Luca · Mira',age:'2d',preview:'One clear next step. Keep the release small.',turns:[['Luca','Mira, can you check the welcome screen against the Northstar brief?'],['Mira','One prompt is enough. Keep the longer explanation for later.'],['Luca','Agreed. I’ll keep that decision with the project.']]},
    'Welcome screen': {members:'Luca · Mira',age:'4d',preview:'The first screen should feel like an invitation.',turns:[['Mira','The first screen should feel like an invitation. One place to begin, with room to explore.'],['Luca','Claude Code and Kimi are working through that direction. I’ll bring their review back here.']]},
    'Project sync': {members:'Luca · Ziggy',age:'1w',preview:'Keep the same project open across windows.',turns:[['Ziggy','The project needs to stay consistent when a conversation opens in another window.'],['Luca','Codex is checking that path. We’ll review the result here before calling it ready.']]}
  };
  /* WP-03 · the demo follows the app's own screens. Fixtures stay in the Northstar world. */
  const dms = ['Luca','Mira','Ziggy','Luca & Mira'];
  const isDm = name => dms.includes(name);
  const dmAge = {'Luca':'now','Ziggy':'2d','Luca & Mira':'1w'};
  const residents = [
    ['Luca','Hermes','Ready','wakes with the app'],
    ['Mira','Hermes','Ready',''],
    ['Ziggy','OpenClaw','Started',''],
    ['Iris','Claude Code','Running','Welcome screen'],
    ['Wren','Codex','Running','Project sync'],
    ['Otto','Kimi Code','Ready',''],
    ['Nia','Grok','Idle','']
  ];
  const residentOf = name => residents.find(r=>r[0]===name) || residents[0];
  const residentLine = r => [r[1],r[2],r[3]].filter(Boolean).join(' · ');
  const residentKey = {Luca:'7c41ba90…e2df',Mira:'2af80c15…91b7',Ziggy:'5e0d7742…ac30',Iris:'913bd6ea…40f5',Wren:'c60a12bd…7e88',Otto:'48fe9013…b2a1',Nia:'a17c53d0…6cb9'};
  const initials = name => name.split(/[\s&]+/).filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const agentDocs = [
    ['Soul','soul.md','you','Who they are — the persona as scenarios, what they value, what they refuse.','412 B · edited 2 h ago'],
    ['Convictions','convictions.md','agent','What they hold to. Earned over time; promoted from evidence, never guessed.',''],
    ['Self-model','self-model.md','agent','How they understand themselves, every line cited to something that happened.',''],
    ['User model','user-model.md','agent','You, as they have come to know you.',''],
    ['Lessons','lessons.md','agent','The mistake, the tell, the correction.',''],
    ['Instructions','instructions.md','you','How they operate — the same shape as the AGENTS.md their runtime already reads.','1.4 kB · edited 3 d ago']
  ];
  const connections = [
    ['Repositories','file','found','Found','Code, documentation, and working-tree changes from projects on this Mac.','3 found · 3 items available'],
    ['Codex','chat','current','Current','Your user-visible Codex conversations, associated with their projects locally.','1 connected · 412 searchable sections'],
    ['Claude Code','chat','current','Current','Your user-visible Claude Code conversations without hidden or tool content.','1 connected · 638 searchable sections'],
    ['Files','library','current','Current','Markdown and text snapshots you choose explicitly for durable reference.','2 files · Northstar brief.md, How I like to work']
  ];
  const brainScan = [
    ['2 h ago','Scanned 3 repositories on this Mac.'],
    ['Yesterday','Indexed 412 Codex sections and 638 Claude Code sections.'],
    ['Monday','Added Northstar brief.md and How I like to work.']
  ];
  const recent = [
    ['Luca','READY','Ready for a conversation','Luca'],
    ['Mira','READY','Ready for a conversation','Mira'],
    ['Ziggy','STARTED','Reviewed the demo script','Ziggy'],
    ['Otto','READY','Ready for a conversation',''],
    ['Nia','STOPPED','You can start this resident in Agents','']
  ];
  const workResident = {'Claude Code':'Iris',Codex:'Wren'};
  const workRoom = {'Claude Code':'Welcome screen',Codex:'Project sync'};
  const isProject = () => state.view==='Northstar'||!!rooms[state.view];
  function roomNavigator(){return `<aside class="d-project-rooms" aria-label="Northstar rooms"><header>${ib('sidebar','Open app navigation from project','drawer')}<small>PROJECT</small><h2>Northstar</h2><div class="d-project-meta"><p>4 connected sources</p>${ib('nav','New Northstar room','plus','data-view="New conversation"')}</div></header><label class="d-room-search">${icon('search')}<input type="search" placeholder="Search rooms" aria-label="Search Northstar rooms"></label><div class="d-room-options">${Object.entries(rooms).map(([n,r])=>action('nav',`Open ${n} room`,`${icon('group')}<span><strong>${n}</strong><small>${r.preview}</small></span><small class="d-room-age">${r.age}</small>`,`data-view="${n}" aria-current="${state.view===n?'page':'false'}"`)).join('')}</div><p class="d-room-empty" hidden>No rooms found.</p><footer>${action('brain','Open Northstar sources','Sources','class="d-inline"')}${action('note','Open Northstar project details','Project details','class="d-inline" data-note-at="rooms" data-note="Project details open in the desktop app. This demo keeps Northstar’s four sources in Brain."')}${noteLine('rooms')}</footer></aside>`;}
  const state = {view:'Luca',drawer:null,split:false,sidebar:false,expanded:false,runtime:'Hermes',progress:62,delegated:false,extra:[],history:['Luca'],cursor:0,touring:false,paused:document.documentElement.dataset.motion==='paused',agent:'Luca',agentFilter:'All',agentTab:'Documents',brainTab:'Connections',repos:'found',note:null,noteAt:null};
  const noteLine = where => state.note&&state.noteAt===where ? `<p class="d-live-note" role="status">${esc(state.note)}</p>` : '';
  let tourTimer, progressTimer, popout, expandedFocus;
  const drafts = new Map(), scrollPositions = new Map();
  const session = new URLSearchParams(location.search).get('session') || crypto.randomUUID();
  const channel = typeof BroadcastChannel==='function' ? new BroadcastChannel('polyphonic-demo-'+session) : null;
  const share = () => channel?.postMessage({type:'state',extra:state.extra,runtime:state.runtime,progress:state.progress,grants:grants()});
  const announce = text => {document.getElementById('demo-announcement').textContent=text};
  const grants = () => [...document.querySelectorAll('.grant-toggle[data-agent="luca"]')].map(e=>e.getAttribute('aria-checked')==='true');
  const contextText = () => {
    const g=grants();return g.some(Boolean) ? [g[0]?'The brief keeps us to one route from a note to a plan.':'',g[1]?'You prefer small releases, so I’m holding that scope.':'',g[2]?'Codex’s saved walkthrough is ready.':'',g[3]?'Tuesday’s decision was one clear next step.':''].filter(Boolean).join(' ') : 'Share a source in Brain and I can connect it to this project.';
  };
  function stopTour(){clearTimeout(tourTimer);state.touring=false;document.getElementById('replay-demo').textContent='Play guided tour';}
  function nav(view, record=true){
    if(record){state.history=state.history.slice(0,state.cursor+1);state.history.push(view);state.cursor++;}
    state.view=view;state.drawer=null;state.sidebar=false;state.note=null;state.noteAt=null;render();if(record){$('.d-primary').tabIndex=-1;$('.d-primary').focus({preventScroll:true});}announce(`${view} opened in the demo.`);
  }
  function sidebar(){
    return `<aside class="d-sidebar" aria-label="Demo navigation"><div class="d-window"><span class="d-lights" aria-hidden="true"><i></i><i></i><i></i></span>${ib('sidebar','Collapse sidebar','drawer')}${ib('back','Previous demo view','back',state.cursor===0?'disabled':'')}${ib('forward','Next demo view','next',state.cursor===state.history.length-1?'disabled':'')}</div>
      ${action('search','Search the demo',`${icon('search')}<span>Search everything</span><kbd>⌘K</kbd>`,'class="d-search"')}
      <nav class="d-nav" aria-label="App sections">${[['library','Library'],['plus','New conversation'],['agents','Agents'],['activity','Activity'],['brain','Brain'],['settings','Settings']].map(([i,n])=>action('nav',n,`${icon(i)}<span>${n}</span>`,`data-view="${n}" ${state.view===n?'aria-current="page"':''}`)).join('')}</nav>
      <div class="d-room-list"><div class="d-sidebar-label"><span>PROJECTS</span>${ib('nav','Browse projects','plus','data-view="Library"')}</div><div class="d-nav d-project-nav">${action('nav','Open Northstar project',`<i class="d-hash" aria-hidden="true">#</i><span>Northstar</span>`,`data-view="Northstar" ${isProject()?'aria-current="page"':''}`)}</div><div class="d-sidebar-label"><span>MESSAGES</span>${ib('nav','New direct conversation','plus','data-view="New conversation"')}</div><div class="d-nav">${dms.map(n=>action('nav',n,`${icon(n.includes('&')?'group':'chat')}<span>${n}</span>${n==='Mira'?'<i class="d-unread" aria-label="Unread messages"></i>':`<small>${dmAge[n]}</small>`}`,`data-view="${n}" ${state.view===n?'aria-current="page"':''}`)).join('')}</div>
      <div class="d-sidebar-label">RUNTIMES</div><div class="d-nav d-runtime-nav">${providers.map(n=>action('nav',n,`${providerMark(n)}<span>${n}</span><i class="d-online" aria-hidden="true"></i>`,`data-view="${n}" ${state.view===n?'aria-current="page"':''}`)).join('')}</div>
      </div><div class="d-person"><span class="d-owner-mark" aria-hidden="true">Y</span><div><span>You</span><small>Personal workspace</small></div></div></aside>`;
  }
  const toolbar = () => `<header class="d-header">${new URLSearchParams(location.search).get('demo')==='chat'&&state.view!=='Luca'?action('nav','Back to Luca',icon('back'),'class="d-pop-back" data-view="Luca"'):''}${ib('sidebar','Toggle app navigation','drawer','aria-expanded="'+state.sidebar+'"')}<div class="d-title"><strong>${esc(state.view)}</strong>${rooms[state.view]?`<span>Northstar · ${rooms[state.view].members}</span>`:''}</div><div class="d-tools">${ib('split','Toggle split view','split',`aria-pressed="${state.split}"`)}${ib('popout','Pop out chat','pop')}${ib('drawer','Toggle conversation drawer','drawer',`aria-expanded="${!!state.drawer}"`)}${ib('expand',state.expanded?'Close expanded demo':'Expand app demo',state.expanded?'close':'expand')}</div></header>`;
  function workCard(name){const pct=name==='Codex'?Math.min(100,state.progress+16):state.progress,who=workResident[name]||name;return action('nav',`Inspect ${who}’s work on ${name}`,`${providerMark(name)}<span><strong>${who}</strong><small>${workRoom[name]||runtimeData[name][0]} · ${name}</small><span class="d-meter" role="progressbar" aria-label="${who} demo progress" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></span></span><span class="d-work-status">${pct===100?'Ready to review':`${pct}%`}</span>${icon('chevron')}`,`class="d-work-card" data-view="${name}"`);}
  /* WP-12 — the work Luca is reporting on, as the app shows it: two saved runtime
     receipts and the memory line. The copy is the one the no-JS fallback in index.html
     has always carried; the anatomy, marks and ink are the frame's own work-card and
     context-link rules, so these read as app UI and not as page furniture. They carry
     no progress meter, which is why the progress ticker skips `.d-saved-work`. */
  const savedWork = {Codex:['Saved · 9:38','Walkthrough implemented'],'Claude Code':['Saved · 9:40','One next step to clarify']};
  const savedCard = name => action('nav',`Open ${name}’s saved work`,`${providerMark(name)}<span><strong>${name}</strong><small>${savedWork[name][1]}</small></span><span class="d-work-status">${savedWork[name][0]}</span>${icon('chevron')}`,`class="d-work-card d-saved-work" data-view="${name}"`);
  const memoryReceipt = () => action('brain','Open the sources behind this reply',`${icon('brain')}<span>From your brief, preferences, and Tuesday</span>${icon('chevron')}`,'class="d-context-link"');
  function chat(name='Luca',compact=false){
    const research=name==='Mira',group=name==='Luca & Mira',ziggy=name==='Ziggy';
    let content=ziggy ? `<div class="d-bubble">Anything left in the Northstar release notes?</div><div class="d-message"><b>Ziggy <small>9:38</small></b><p>The walkthrough and the welcome screen are in. Offline mobile support stays out of this first release.</p><p>I’ll keep the notes with the project so Luca can bring them into Launch.</p>${action('nav','Open the Project sync room',`${icon('group')} Project sync`,'class="d-inline" data-view="Project sync"')}</div>` : research ? `<div class="d-message"><b>Mira</b><p>I read the Northstar brief and the latest Codex walkthrough. One thing stands out: the empty screen needs a single clear next step.</p><p>I’ve shared that with Luca. The rest can stay small.</p>${action('source','Read the project brief',`${icon('file')} Northstar brief.md`,'class="d-inline" data-source="0"')}</div>` : group ? `<div class="d-bubble">Could you two check the scope before we ship?</div><div class="d-message"><b>Luca <small>9:44</small></b><p>Mira, can you check the welcome screen against the brief?</p></div><div class="d-message"><b>Mira <small>9:46</small></b><p>One prompt is enough. Claude Code and Kimi can refine it together; Codex can keep the project sync steady.</p></div><div class="d-message"><b>Luca</b><p>Agreed. I’ll keep the work connected and bring the decisions back here.</p></div>` : `<div class="d-bubble">Morning. How’s Northstar coming along?</div><div class="d-message"><b>Luca <small>9:41</small></b><p>We’re keeping the first release small, just as you asked. Here’s where everyone left off.</p><div class="d-work-list">${savedCard('Codex')}${savedCard('Claude Code')}</div><p>Mira has read the brief. Want her perspective before we decide what ships?</p>${memoryReceipt()}${action('consult','See Luca and Mira’s exchange',`${icon('group')}<span><strong>Luca · Mira</strong><small>Between agents</small></span><small>3 turns</small>`,'class="d-exchange"')}</div>`;
    if(rooms[name]){const r=rooms[name],[first,...rest]=r.members.split(' · ').reverse();
      content=`<div class="d-day"><span>Monday</span></div><div class="d-system">You <small>created this channel</small></div><div class="d-system">${first} <small>was added by You, along with ${rest.join(' and ')}</small></div>`+r.turns.map(([author,text])=>`<div class="d-message"><b>${author}</b><p>${text}</p></div>`).join('')+action('consult','See the exchange between these agents',`${icon('group')}<span><strong>${r.members}</strong><small>Between agents</small></span><small>${r.turns.length} turns</small>`,'class="d-exchange"');}
    content+=state.extra.filter(m=>(m.agent||'Luca')===name).map(m=>`<div class="d-bubble">${esc(m.q)}</div><div class="d-message d-arrival"><b>${esc(rooms[name]?'Luca':name)}</b><p>${esc(m.a)}</p></div>`).join('');
    return `<div class="d-chat-scroll" tabindex="0" aria-label="${esc(name)} conversation"><div class="d-transcript">${content}</div></div><div class="d-compose-wrap"><form class="d-composer" data-chat-form data-agent="${esc(name)}"><label class="sr-only" for="${compact?'compact-message-'+name.replaceAll(' ','-'):'demo-message'}">Message ${esc(name)} in the demo</label><input id="${compact?'compact-message-'+name.replaceAll(' ','-'):'demo-message'}" name="message" value="${esc(drafts.get(name)||'')}" autocomplete="off" placeholder="Message…" maxlength="500" required>${action('send','Send demo message',icon('arrow'),'class="d-send"')}</form><div class="d-compose-footer"><div class="d-composer-tools">${ib('source','Attach demo project context','plus','data-source="0"')}${ib('emoji','Insert a smile','smile')}${ib('voice','Preview voice message','mic')}</div></div></div>`;
  }
  function library(){return `<div class="d-page"><div class="d-page-heading"><span>Library</span><h2>A project, with its context.</h2><p>Northstar brings the brief, decisions, and connected conversations together.</p></div><div class="d-project"><span class="d-project-mark" aria-hidden="true">${icon('library')}</span><div><b>Northstar</b><p>A quieter place to turn a note into a plan.</p></div>${action('nav','Open Northstar with Luca','Continue with Luca →','class="d-small-button" data-view="Luca"')}</div><div class="d-list">${sources.map((s,i)=>action('source',`Open ${s[0]}`,`${icon(i===2?'chat':'file')}<span><strong>${s[0]}</strong><small>${s[1]}</small></span>${icon('chevron')}`,`data-source="${i}"`)).join('')}</div><div class="d-note">Saved sessions stay linked to their source. Opening one doesn’t start a new task.</div></div>`;}
  const connActions = {
    Repositories:()=>action('connect','Connect repositories','Connect repositories','class="d-pill-button d-filled" data-connect="repos"')+action('note','Add folder','Add folder','class="d-pill-button" data-note="Choosing a folder happens in the desktop app. This demo uses the Northstar fixtures."'),
    Codex:()=>action('source','Codex connection details','Details','class="d-pill-button" data-source="2"'),
    'Claude Code':()=>action('source','Claude Code connection details','Details','class="d-pill-button" data-source="3"'),
    Files:()=>action('note','Add files','Add files','class="d-pill-button" data-note="Adding a file happens in the desktop app. Northstar brief.md and How I like to work are already here."')
  };
  function brain(){
    const grid=connections.map(([title,glyph,status,word,copy,count])=>{const s=title==='Repositories'?state.repos:status,w=title==='Repositories'?(state.repos==='current'?'Current':'Found'):word,c=title==='Repositories'&&state.repos==='current'?'3 connected · 3 items available':count;
      return `<article class="d-conn-card"><span class="d-conn-tile" aria-hidden="true">${icon(glyph)}</span><p class="d-conn-status"><i class="d-dot d-dot-${s}" aria-hidden="true"></i>${w}</p><strong>${title}</strong><small>${copy}</small><code>${c}</code><div class="d-conn-actions">${connActions[title]()}</div></article>`;}).join('');
    const activityTab=`<div class="d-scan-list">${brainScan.map(([when,what])=>`<p><time>${when}</time><span>${what}</span></p>`).join('')}</div>`;
    return `<div class="d-page"><div class="d-page-heading d-brain-head"><div><h2>Brain</h2><p>Connect the work your residents should know. Luca keeps it current in the background.</p></div><span class="d-pill">Private and local</span></div>
      <div class="d-tabs d-tabs-rule" role="group" aria-label="Brain views">${['Connections','Activity'].map(t=>action('brain-tab',`Show Brain ${t.toLowerCase()}`,t,`data-brain-tab="${t}" aria-pressed="${state.brainTab===t}"`)).join('')}${action('note','Scan again','Scan again','class="d-inline d-scan" data-note="Scanned. Everything Luca can see is already current in this demo."')}</div>
      ${state.brainTab==='Connections'?`<div class="d-conn-grid">${grid}</div>`:activityTab}${noteLine('brain')}</div>`;
  }
  const agentFilters = {All:()=>true,Running:r=>r[2]==='Running'||r[2]==='Started',Attention:r=>r[2]==='Idle'};
  function agentColumn(){
    const shown=residents.filter(agentFilters[state.agentFilter]);
    return `<aside class="d-agent-column" aria-label="Agents"><header><h2>Agents</h2><div class="d-project-meta"><p>${residents.length} agents</p>${ib('note','New agent','plus','data-note-at="agentlist" data-note="Creating a resident happens in the desktop app. This demo keeps Northstar’s seven."')}</div></header><label class="d-room-search">${icon('search')}<input type="search" placeholder="Search agents" aria-label="Search agents"></label>
      <div class="d-chips" role="group" aria-label="Filter agents">${Object.keys(agentFilters).map(f=>action('agent-filter',`Show ${f.toLowerCase()} agents`,f,`data-filter="${f}" aria-pressed="${state.agentFilter===f}"`)).join('')}</div>
      <div class="d-runtime-strip"><small>${providers.length} runtimes connected</small><span>${providers.map(n=>providerMark(n)).join('')}</span></div>
      <div class="d-agent-rows">${shown.map(r=>action('agent',`Show ${r[0]}`,`<i class="d-glyph" aria-hidden="true">${initials(r[0])}</i><span><strong>${r[0]}</strong><small>${residentLine(r)}</small></span>${providerMark(r[1])}`,`class="d-agent-card" data-agent="${r[0]}" aria-current="${state.agent===r[0]?'true':'false'}"`)).join('')}</div>
      <p class="d-room-empty" ${shown.length?'hidden':''}>No agents match this filter.</p>
      <footer>${noteLine('agentlist')}${action('note','Open agent groups','Groups','class="d-inline" data-note-at="agentlist" data-note="Groups gather residents who work together. They are managed in the desktop app."')}${action('note','Open agent defaults','Defaults','class="d-inline" data-note-at="agentlist" data-note="Defaults set the runtime and model a new resident starts with. They are managed in the desktop app."')}</footer></aside>`;
  }
  function agents(){
    const r=residentOf(state.agent),name=r[0],tab=state.agentTab;
    const body=tab==='Documents'?`<div class="d-doc-list">${agentDocs.map(([label,file,who,copy,meta])=>action('note',`Open ${file}`,`<span class="d-doc-who">${who==='you'?'You write this':`${name} writes this`}</span><span class="d-doc-main"><strong>${label} <em>${file}</em></strong><small>${copy}</small></span><span class="d-doc-meta">${meta||'Not written yet'}</span>`,`class="d-doc-row" data-note="${esc(file)} is written and read in the desktop app. This demo shows the shape of ${esc(name)}’s folder."`)).join('')}</div>
      <div class="d-more-files"><small>MORE FILES</small>${action('note','New file',`${icon('plus')} New file`,'class="d-inline" data-note="New resident files are created in the desktop app."')}<p>Nothing else in the folder yet.</p><code>residents/${residentKey[name].slice(0,8)}</code></div>`
      :tab==='Notebook'?`<div class="d-tab-empty"><p>Nothing written this week.</p></div>`
      :`<div class="d-tab-empty"><p>${name}’s runtime and defaults are set in Settings.</p>${action('nav','Open Settings','Open Settings →','class="d-inline" data-view="Settings"')}</div>`;
    return `<div class="d-page d-agent-detail"><div class="d-agent-head"><i class="d-glyph d-glyph-lg" aria-hidden="true">${initials(name)}</i><div><h2>${name}</h2><p><i class="d-online" aria-hidden="true"></i> ${r[2]}</p><small>${r[1]} · demo · ${residentKey[name]}</small></div></div>
      <div class="d-agent-actions">${residentActions(name)}</div>
      <div class="d-tabs" role="group" aria-label="${name} detail">${['Documents','Notebook','Settings'].map(t=>action('agent-tab',`Show ${name} ${t.toLowerCase()}`,t,`data-tab="${t}" aria-pressed="${tab===t}"`)).join('')}</div>${body}${noteLine('agents')}</div>`;
  }
  function residentActions(name){
    const hasChat=isDm(name);
    return (hasChat?action('nav',`Message ${name}`,'Message',`class="d-pill-button" data-view="${name}"`):action('note',`Message ${name}`,'Message',`class="d-pill-button" data-note="${esc(name)} has no conversation in this demo. Luca, Mira and Ziggy do."`))
      +ib('nav',`Open ${name} in Activity`,'activity','data-view="Activity"')+ib('nav',`Open Brain`,'brain','data-view="Brain"')+ib('nav',`Open ${residentOf(name)[1]}`,'agents',`data-view="${residentOf(name)[1]}"`)
      +action('note','More resident actions','…','class="d-icon d-more" data-note="The rest of a resident’s actions live in the desktop app."');
  }
  function activity(){return `<div class="d-page"><div class="d-page-heading"><span>Your agents at work</span><h2>Activity</h2><p>See what your residents are doing and catch up on recent work. Open activity to follow along in the conversation.</p></div><div class="d-work-list">${workCard('Claude Code')}${workCard('Codex')}</div>
    <div class="d-recent"><small>RECENT</small>${recent.map(([name,status,line,view])=>`<div class="d-resident-row"><i class="d-glyph" aria-hidden="true">${initials(name)}</i><span><strong>${name}</strong><small>${line}</small></span>${providerMark(residentOf(name)[1])}<span class="d-status-pill">${status}</span>${view?action('nav',`Open the ${name} conversation`,'Open conversation ↗','class="d-inline"'+` data-view="${view}"`):action('note',`${name} has no conversation`,'No accessible conversation ↗','class="d-inline" data-note="'+esc(name)+' has no conversation in this demo. Luca, Mira and Ziggy do."')}</div>`).join('')}</div>${noteLine('activity')}</div>`;}
  function runtime(name){const d=runtimeData[name],isWork=name==='Codex'||name==='Claude Code';return `<div class="d-page"><div class="d-runtime-heading">${providerMark(name)}<h2>${name}</h2><span class="d-pill">Connected · demo</span></div><div class="d-page-heading"><h3>${d[0]}</h3><p>${d[1]}</p></div>${isWork?workCard(name):''}<div class="d-document"><span>${d[2]}</span><p>${d[3]}</p>${name==='Claude Code'?'<div class="d-code"><span>Welcome screen</span><b>What would you like to make room for?</b><small>One prompt. One clear next step.</small></div>':name==='Codex'?'<pre>✓ project state restored\n✓ detached chat stays in sync\n✓ saved walkthrough available</pre>':''}</div><div class="d-actions">${action('consult','Open the collaborators’ conversation','See the conversation','class="d-small-button"')}${action('prompt','Ask Luca to coordinate the next step','Ask Luca to coordinate →','class="d-inline" data-prompt="delegate"')}</div><div class="d-saved"><span>Saved history</span>${action('source','Read the saved Codex session','Codex session · Sep 6 →','class="d-inline" data-source="2"')}</div></div>`;}
  function settings(){return `<div class="d-page"><div class="d-page-heading"><span>Settings</span><h2>Your resident. Your runtime.</h2><p>Explore changing the connection while Luca’s identity and shared context stay in place.</p></div><div class="d-settings-row"><div><b>Luca’s runtime</b><small>Use the subscription you already have, where supported.</small></div><label><span class="sr-only">Luca runtime</span><select data-runtime>${providers.map(n=>`<option ${n===state.runtime?'selected':''}>${n}</option>`).join('')}</select></label></div><div class="d-settings-row"><div><b>Connection</b><small>Existing subscription · simulated connection</small></div><span class="d-pill">Ready</span></div><div class="d-settings-row"><div><b>Mnemos identity</b><small>Luca’s identity remains the same.</small></div>${icon('check')}</div><div class="d-settings-row"><div><b>Animation</b><small>${reduced.matches?'Following your system preference.':'Pause the page and demo activity.'}</small></div>${action('motion','Toggle demo motion',state.paused?'Resume':'Pause','class="d-small-button"'+(reduced.matches?' disabled':''))}</div><div class="d-note">This demo uses no credentials and doesn’t change a subscription.</div></div>`;}
  function newConversation(){return `<div class="d-page"><div class="d-page-heading"><span>New conversation</span><h2>Who’s on your mind?</h2><p>Start with one resident, or bring two into the room.</p></div><div class="d-list">${[['Luca','Your project companion'],['Mira','A second perspective'],['Ziggy','Release notes and scope'],['Luca & Mira','A shared conversation']].map(([n,d])=>action('nav',`Start with ${n}`,`${icon('chat')}<span><strong>${n}</strong><small>${d}</small></span>${icon('chevron')}`,`data-view="${n}"`)).join('')}</div></div>`;}
  function drawer(){
    if(!state.drawer)return '';
    let title='Conversation', content='';
    if(state.drawer.type==='source'){const s=sources[state.drawer.index];title=s[0];content=`<span class="d-kicker">${s[1]}</span><p>${s[2]}</p><div class="d-note">Northstar · saved context</div>${action('brain','Manage this source in Brain','Manage access in Brain →','class="d-inline"')}`;}
    else if(state.drawer.type==='search'){title='Search everything';content='<label class="sr-only" for="demo-search">Search demo content</label><input id="demo-search" class="d-search-input" placeholder="Search Northstar, agents, decisions…" autocomplete="off"><div id="demo-search-results"></div>';}
    else{
      const view=state.view,people=rooms[view]?rooms[view].members.split(' · '):view==='Luca & Mira'?['Luca','Mira']:isDm(view)?[view]:['Luca','Mira'];
      const kind=rooms[view]?['PROJECT ROOM','Northstar · '+view]:view==='Luca & Mira'?['GROUP MESSAGE','Group']:isDm(view)?['DIRECT MESSAGE','DM']:['CONVERSATION','DM'];
      const section=(label,body)=>`<section class="d-drawer-section"><small>${label}</small>${body}</section>`;
      content=`<div class="d-drawer-tabs" aria-label="Conversation views">${['Conversation',...people].map(n=>action('drawer-member',`Show ${n} details`,n,`data-member="${n}" aria-pressed="${(state.drawer.member||'Conversation')===n}"`)).join('')}</div>`
        +section(kind[0],`<p>${kind[1]}</p>`)
        +section('AT A GLANCE',`<dl class="d-glance">${[['Present','2'],['Agents',String(people.filter(n=>n!=='You').length)],['Files','4'],['Exchanges','3']].map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`)
        +section('AGENTS',people.map(n=>action('nav',`Open ${n}`,`${providerMark(residentOf(n)[1])}<span><strong>${n}</strong><small>${residentOf(n)[1]} · Notebook available</small></span><em>↗</em>`,`class="d-drawer-row" data-view="${isDm(n)?n:'Luca'}"`)).join(''))
        +section('PEOPLE',`<div class="d-drawer-row d-drawer-person"><i class="d-glyph" aria-hidden="true">Y</i><span><strong>You</strong><small>Owner</small></span></div>`)
        +section('WORKING CONTEXT',`<p>No shared workspace attached</p><small>Attach a project so everyone here reads the same sources.</small>`)
        +section('BETWEEN AGENTS',`<div class="d-exchange-heading">Luca · Mira <small>Monday · 3 turns · visiting</small></div><div class="d-message"><b>Luca <small>9:44</small></b><p>Can you check the welcome screen against the Northstar brief?</p></div><div class="d-message"><b>Mira <small>9:46</small></b><p>Keep one clear next step. Claude Code and Kimi can refine it together without adding another feature.</p></div><div class="d-message"><b>Luca <small>9:46</small></b><p>That matches what you asked for on Tuesday. I’ll bring it back into our conversation.</p></div>${action('nav','Join the shared conversation','Join the conversation →','class="d-inline" data-view="Luca & Mira"')}`);
    }
    return `<aside class="d-drawer" aria-label="${esc(title)}"><header><strong>${esc(title)}</strong>${ib('close-drawer','Close drawer','close')}</header><div class="d-drawer-body">${content}</div>${state.drawer.type==='conversation'?`<footer class="d-drawer-foot">${action('note','Manage participants','Manage participants','class="d-inline" data-note="Participants are managed in the desktop app."')}${noteLine('drawer')}</footer>`:''}</aside>`;
  }
  function render(){
    root.querySelectorAll('[data-chat-form]').forEach(form=>drafts.set(form.dataset.agent,form.elements.message.value));
    const oldView=$('.d-title strong')?.textContent;
    if(oldView)scrollPositions.set(oldView,$('.d-chat-scroll,.d-page')?.scrollTop||0);
    const active=document.activeElement, focusedInput=root.contains(active)&&active.matches('input')?{id:active.id,start:active.selectionStart,end:active.selectionEnd}:null;
    root.classList.add('demo-app');root.classList.toggle('d-expanded',state.expanded);root.classList.toggle('d-nav-open',state.sidebar);
    root.innerHTML=`${sidebar()}<div class="d-workspace"><div class="d-panes ${isProject()?'is-project':''} ${state.view==='Agents'?'is-agents':''} ${rooms[state.view]?'has-room':''} ${state.drawer?'has-drawer':''} ${state.split?'has-split':''}">${isProject()?roomNavigator():''}${state.view==='Agents'?agentColumn():''}<section class="d-primary" aria-label="${esc(state.view)} demo view">${rooms[state.view]?action('nav','Back to Northstar rooms',`${icon('back')} Northstar`,'class="d-room-back" data-view="Northstar"'):''}${toolbar()}${rooms[state.view]||isDm(state.view)?chat(state.view):state.view==='Northstar'?'<div class="d-room-placeholder"><h2>Northstar</h2><p>Choose a room to join the conversation.</p></div>':['Library','Northstar'].includes(state.view)?library():state.view==='Brain'?brain():state.view==='Agents'?agents():state.view==='Activity'?activity():state.view==='Settings'?settings():state.view==='New conversation'?newConversation():runtime(state.view)}</section>${state.split?`<section class="d-secondary" aria-label="Mira split conversation"><header><b>Mira</b>${ib('split','Close split view','close')}</header>${chat('Mira',true)}</section>`:''}${drawer()}</div></div>`;
    const scroll=$('.d-chat-scroll,.d-page');if(scroll)scroll.scrollTop=scrollPositions.get(state.view)||0;
    root.querySelectorAll('[data-chat-form]').forEach(form=>form.elements.message.value=drafts.get(form.dataset.agent)||'');
    if(focusedInput&&document.getElementById(focusedInput.id)){const input=document.getElementById(focusedInput.id);input.focus({preventScroll:true});input.setSelectionRange(focusedInput.start,focusedInput.end);}
    if(state.drawer?.type==='search')search('');
  }
  function search(q){
    const items=[...['Luca','Mira','Ziggy','Library','Agents','Activity','Brain','Settings',...providers].map(n=>({name:n,view:n})),...sources.map((s,i)=>({name:s[0],index:i}))].filter(x=>x.name.toLowerCase().includes(q.toLowerCase()));
    $('#demo-search-results').innerHTML=items.length?items.map(x=>action(x.view?'nav':'source',`Open ${x.name}`,`${icon(x.view?'chat':'file')}<span>${esc(x.name)}</span>`,`${x.view?`data-view="${x.view}"`:`data-source="${x.index}"`} class="d-search-result"`)).join(''):'<p>No matches. Try “brief”, “Codex”, or “Brain”.</p>';
  }
  function respond(kind, question, agent=state.view){
    const speaker=rooms[agent]||isDm(agent)?agent:'Luca';
    stopTour();state.view=speaker;state.drawer=null;state.sidebar=false;
    const answers={update:`${state.progress===100?'The current changes are ready to review.':'Claude Code and Kimi are refining the welcome screen; Codex is checking project sync.'} The saved walkthrough is already in Library. Mira recommends keeping one clear next step.`,delegate:'I’ve opened a shared design conversation for Claude Code and Kimi, and a project-sync task for Codex. I’ll keep the decisions connected to the brief and bring their progress back here.',context:contextText(),consult:'Mira’s recommendation is one clear next step on the welcome screen. I’ve opened our exchange so you can see the reasoning.'};
    if(kind==='delegate'){state.delegated=true;state.progress=18;startProgress();}
    state.extra.push({agent:speaker,q:question||({update:'Give me an update on Northstar.',delegate:'Could Claude Code and Kimi refine the design, while Codex handles project sync?',context:'What context are you drawing on?',consult:'What does Mira think?'}[kind]),a:answers[kind]||'This is a local demo, so I can show the Northstar story rather than answer a new real-world request. Try asking for an update, shared context, or a collaboration plan.',work:kind==='delegate'});
    if(kind==='consult')state.drawer={type:'conversation'};
    render();share();$('.d-chat-scroll')?.scrollTo({top:100000,behavior:'instant'});announce(answers[kind]||'Try a Northstar demo prompt.');
  }
  const classify = q => /design|backend|architect|work on|delegat|plan|collaborat/i.test(q)?'delegate':/context|memory|remember|brief/i.test(q)?'context':/mira|research|perspective/i.test(q)?'consult':/updat|progress|happening|status|northstar/i.test(q)?'update':'other';
  function startProgress(){clearInterval(progressTimer);if(state.paused||document.hidden||new URLSearchParams(location.search).get('demo')==='chat')return;progressTimer=setInterval(()=>{
    const box=root.getBoundingClientRect();if(Math.min(innerHeight,box.bottom)-Math.max(0,box.top)<Math.min(350,box.height*.45))return;
    state.progress=Math.min(100,state.progress+7);share();
    root.querySelectorAll('.d-work-card:not(.d-saved-work)').forEach(card=>{const pct=card.dataset.view==='Codex'?Math.min(100,state.progress+16):state.progress;card.querySelector('.d-meter').setAttribute('aria-valuenow',pct);card.querySelector('.d-meter i').style.width=pct+'%';card.querySelector('.d-work-status').textContent=pct===100?'Ready to review':pct+'%'});
    if(state.progress===100){clearInterval(progressTimer);announce('Demo work is ready to review. Open a runtime to see the result.');}
  },1800);}
  function expanded(on){state.expanded=on;root.classList.toggle('d-expanded',on);document.body.classList.toggle('demo-open',on);document.querySelectorAll('.site-header,.hero,#preview ~ *, .footer,#preview>.product-caption').forEach(el=>el.inert=on);if(on){expandedFocus=document.activeElement;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Expanded Polyphonic app demo');}else{root.removeAttribute('role');root.removeAttribute('aria-modal');root.removeAttribute('aria-label');}render();if(on)$('[data-action=expand]').focus();else $('[data-action=expand]')?.focus();}
  function showPopout(){
    if(popout){popout.querySelector('input')?.focus();return;}
    const popName=rooms[state.view]||isDm(state.view)?state.view:'Luca';
    popout=document.createElement('dialog');popout.dataset.agent=popName;popout.className='d-popout';popout.setAttribute('aria-label','Detached '+popName+' chat');
    popout.innerHTML=`<header><span><strong>${esc(popName)}</strong><small>Detached chat · Northstar demo</small></span><button type="button" data-pop-window title="Open in a separate browser window" aria-label="Open chat in a separate window">${icon('pop')}</button><button type="button" data-pop-close aria-label="Close popped-out chat">${icon('close')}</button></header><div class="d-pop-content">${chat(popName,true)}</div>`;
    document.body.append(popout);popout.showModal();
    popout.querySelector('[data-pop-close]').onclick=()=>popout.close();
    popout.addEventListener('close',()=>{drafts.set(popout.dataset.agent,popout.querySelector('input')?.value||'');popout.remove();popout=null;$('[data-action=popout]')?.focus()});
    popout.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&b.dataset.action!=='send'){if(!['emoji','voice'].includes(b.dataset.action))popout.close();handle(b)}if(e.target.closest('[data-pop-window]')){const win=window.open(location.pathname+'?demo=chat&session='+encodeURIComponent(session)+'&agent='+encodeURIComponent(popName),'polyphonic-demo-chat','popup,width=520,height=700');if(win){popout.close();}else{announce('Your browser blocked the separate window. The detached chat is still open here.');}}});
    popout.querySelector('form').addEventListener('submit',e=>{e.preventDefault();const q=new FormData(e.target).get('message').trim();if(!q)return;e.target.elements.message.value='';drafts.delete(popout.dataset.agent);respond(classify(q),q,popout.dataset.agent);popout.querySelector('.d-pop-content').innerHTML=chat(popout.dataset.agent,true);wirePopupForm();});
  }
  function wirePopupForm(){popout.querySelector('.d-chat-scroll').scrollTop=100000;popout.querySelector('input').focus({preventScroll:true});popout.querySelector('form').onsubmit=e=>{e.preventDefault();const q=new FormData(e.target).get('message').trim();if(!q)return;e.target.elements.message.value='';drafts.delete(popout.dataset.agent);respond(classify(q),q,popout.dataset.agent);popout.querySelector('.d-pop-content').innerHTML=chat(popout.dataset.agent,true);wirePopupForm();};}
  function handle(b){
    const a=b.dataset.action;
    if(a!=='tour')stopTour();
    if(a==='nav')nav(b.dataset.view);
    else if(a==='back'||a==='forward'){state.cursor+=a==='back'?-1:1;nav(state.history[state.cursor],false);}
    else if(a==='sidebar'){state.sidebar=!state.sidebar;root.classList.toggle('d-nav-open',state.sidebar);const mobile=matchMedia('(max-width:860px)').matches;root.querySelectorAll('[data-action=sidebar]').forEach(button=>button.setAttribute('aria-expanded',String(mobile?state.sidebar:!state.sidebar)));const target=mobile?(state.sidebar?$('.d-search'):$('.d-header [data-action=sidebar]')):(state.sidebar?$('.d-header [data-action=sidebar]'):$('.d-window [data-action=sidebar]'));target?.focus({preventScroll:true});}
    else if(a==='drawer'||a==='consult'){state.drawer=a==='drawer'&&state.drawer?null:{type:'conversation'};state.split=false;render();if(state.drawer)$('[data-action=close-drawer]').focus();}
    else if(a==='drawer-member'){state.drawer.member=b.dataset.member;render();const member=state.drawer.member;if(member!=='Conversation')root.querySelectorAll('.d-drawer .d-message').forEach(e=>{e.hidden=!e.querySelector('b').textContent.startsWith(member)});$(`[data-member="${member}"]`).focus();}else if(a==='close-drawer'){state.drawer=null;render();$('[data-action=drawer]').focus();}
    else if(a==='split'){state.split=!state.split;state.drawer=null;render();$('[data-action=split]').focus();}
    else if(a==='expand')expanded(!state.expanded);
    else if(a==='popout')showPopout();
    else if(a==='brain')nav('Brain');
    else if(a==='runtime')nav('Settings');
    else if(a==='source'){state.drawer={type:'source',index:Number(b.dataset.source)};render();$('[data-action=close-drawer]').focus();}
    else if(a==='search'){state.drawer={type:'search'};render();$('#demo-search').focus();}
    else if(a==='agent'){state.agent=b.dataset.agent;state.agentTab='Documents';state.note=null;render();$(`.d-agent-card[data-agent="${b.dataset.agent}"]`)?.focus();}
    else if(a==='agent-filter'){state.agentFilter=b.dataset.filter;render();$(`[data-filter="${b.dataset.filter}"]`)?.focus();}
    else if(a==='agent-tab'){state.agentTab=b.dataset.tab;state.note=null;render();$(`[data-tab="${b.dataset.tab}"]`)?.focus();}
    else if(a==='brain-tab'){state.brainTab=b.dataset.brainTab;state.note=null;render();$(`[data-brain-tab="${b.dataset.brainTab}"]`)?.focus();}
    else if(a==='connect'){state.repos='current';state.note='3 repositories connected in this demo. Nothing on your Mac is read.';state.noteAt='brain';render();announce(state.note);$('[data-connect="repos"]')?.focus();}
    else if(a==='note'){state.note=b.dataset.note;state.noteAt=b.dataset.noteAt||(state.drawer?'drawer':state.view==='Brain'?'brain':state.view==='Activity'?'activity':'agents');render();announce(state.note);}
    else if(a==='emoji'){const input=b.closest('.d-compose-wrap').querySelector('input');input.value+=' ☺';input.focus();}else if(a==='voice'){announce('Voice messages are available in the desktop app. This website demo does not record audio.');b.title='Website demo — audio recording is not connected';let note=b.closest('.d-compose-wrap').querySelector('.d-voice-note');if(!note){note=document.createElement('small');note.className='d-voice-note';note.textContent='Audio recording is available in the desktop app.';b.closest('.d-compose-footer').append(note);}}else if(a==='prompt')respond(b.dataset.prompt);
    else if(a==='motion')document.getElementById('motion-toggle').click();
  }
  root.addEventListener('pointerdown',()=>{if(state.touring)stopTour()});
  root.addEventListener('keydown',()=>{if(state.touring)stopTour()});
  root.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(b&&!b.disabled&&b.dataset.action!=='send')handle(b)});
  root.addEventListener('input',e=>{if(e.target.matches('.d-room-search input')){const column=e.target.closest('aside'),q=e.target.value.toLowerCase();let count=0;column.querySelectorAll('.d-room-options button,.d-agent-rows button').forEach(b=>{b.hidden=!b.textContent.toLowerCase().includes(q);if(!b.hidden)count++});column.querySelector('.d-room-empty').hidden=count>0;}});
  root.addEventListener('submit',e=>{if(!e.target.matches('[data-chat-form]'))return;e.preventDefault();const q=new FormData(e.target).get('message').trim();if(q){const agent=e.target.dataset.agent;e.target.elements.message.value='';drafts.delete(agent);respond(classify(q),q,agent)}});
  root.addEventListener('input',e=>{if(e.target.id==='demo-search')search(e.target.value)});
  root.addEventListener('change',e=>{if(e.target.matches('[data-runtime]')){state.runtime=e.target.value;share();render();$('[data-runtime]').focus();announce(`Luca now uses ${state.runtime} in this demo. Identity and shared context stay the same.`)}});
  document.addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&(root.contains(document.activeElement)||state.expanded)){e.preventDefault();handle({dataset:{action:'search'}});}
    if(e.key==='Escape'&&!popout){if(state.drawer){state.drawer=null;render();$('[data-action=drawer]').focus();}else if(state.expanded)expanded(false);else{state.sidebar=false;root.classList.remove('d-nav-open');}}
    if(e.key==='Tab'&&state.expanded&&!popout){const focusables=[...root.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]')].filter(x=>x.getClientRects().length);const first=focusables[0],last=focusables.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
  });
  window.addEventListener('polyphonic:motion',e=>{state.paused=e.detail.paused;document.getElementById('replay-demo').disabled=state.paused;if(state.paused){stopTour();clearInterval(progressTimer)}else if(state.progress<100)startProgress();if(state.view==='Settings')render()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInterval(progressTimer);stopTour()}else if(state.progress<100)startProgress()});
  function tour(){if(state.touring){stopTour();return}state.touring=true;if(state.progress===100){state.progress=62;startProgress();}const stages=['Luca','Brain','Agents','Activity','Luca'];let i=0;const next=()=>{if(!state.touring)return;nav(stages[i],false);document.getElementById('replay-demo').textContent=`Stop tour · ${i+1} / ${stages.length}`;if(i===4){state.drawer={type:'conversation'};render();stopTour();return;}i++;tourTimer=setTimeout(next,5500)};next();}
  const live=document.createElement('span');live.id='demo-announcement';live.className='sr-only';live.setAttribute('role','status');root.after(live);
  render();startProgress();
  if(channel){channel.onmessage=({data})=>{if(data.type==='request'){share();return}if(data.type!=='state'||!Array.isArray(data.extra)||!providers.includes(data.runtime))return;let contextChanged=false;if(Array.isArray(data.grants)&&data.grants.length===4){document.querySelectorAll('.grant-toggle[data-agent="luca"]').forEach((btn,i)=>{if(typeof data.grants[i]==='boolean'&&(btn.getAttribute('aria-checked')==='true')!==data.grants[i]){btn.click();contextChanged=true}})}const changed=contextChanged||JSON.stringify(state.extra)!==JSON.stringify(data.extra)||state.runtime!==data.runtime;state.extra=data.extra;state.runtime=data.runtime;state.progress=data.progress;if(changed)render();else root.querySelectorAll('.d-work-card:not(.d-saved-work)').forEach(card=>{const pct=card.dataset.view==='Codex'?Math.min(100,state.progress+16):state.progress;card.querySelector('.d-meter').setAttribute('aria-valuenow',pct);card.querySelector('.d-meter i').style.width=pct+'%';card.querySelector('.d-work-status').textContent=pct===100?'Ready to review':pct+'%'});};channel.postMessage({type:'request'});}
  const integrations=document.createElement('div');integrations.className='hero-integrations';integrations.innerHTML='<p>Bring the agents you already know.</p><div>'+providers.map(n=>action('nav','Explore '+n,providerMark(n)+'<span>'+n+'</span>',`data-view="${n}"`)).join('')+'</div>';document.querySelector('.hero').append(integrations);integrations.addEventListener('click',e=>{const b=e.target.closest('button');if(b){stopTour();nav(b.dataset.view);root.scrollIntoView({behavior:state.paused?'instant':'smooth',block:'start'});root.tabIndex=-1;root.focus({preventScroll:true});}});
  const replay=document.getElementById('replay-demo');replay.textContent='Play guided tour';replay.disabled=state.paused;replay.addEventListener('click',()=>{if(state.paused){nav('Brain');announce('Animation is paused. Explore the sections at your own pace.');return}tour()});
  document.querySelector('.hero-actions .text-button').href='#preview';document.querySelector('.hero-actions .text-button').addEventListener('click',()=>{root.tabIndex=-1;root.focus({preventScroll:true})});
  if(new URLSearchParams(location.search).get('demo')==='chat'){
    document.documentElement.classList.add('d-chat-window');const agent=new URLSearchParams(location.search).get('agent');state.view=isDm(agent)?agent:'Luca';render();document.title=state.view+' — Polyphonic demo';
  }
  /* WP-11 · WP-12 — the app is alive, and the scene has its cards. Luca's opening reply
     performs itself while the frame is in view: a typing indicator, the first paragraph
     at 20ms a character, the two saved runtime receipts landing one after the other, the
     second paragraph, then the memory receipt, the between-agents card and Mira's rail
     row turning from `reading…` back to its unread mark on the same beat. The whole
     scene is a pure function of elapsed time modulo one period, diffed to a short key so
     the DOM is touched only when something actually changes; it loops until the frame
     leaves the viewport. The resting frame IS the finished scene, so the performance
     only ever takes things away and puts them back exactly. The first touch inside the
     frame ends it for the session; a paused page and reduced motion never start it. */
  const alive=(()=>{
    if(new URLSearchParams(location.search).get('demo')==='chat')return null;
    const preview=document.getElementById('preview');
    if(!preview||!('IntersectionObserver' in window))return null;
    /* The prototype's own constants. */
    const TYPE=20,LEAD=900,CARD1=4300,CARD2=4700,SECOND=5200,REVEAL=7700,PERIOD=12600;
    let armed=true,visible=false,scene=null,key='',raf=0,renders=0,frames=0,cycles=0;
    function pieces(){
      if(state.view!=='Luca'||state.drawer||state.split||state.expanded||state.extra.length)return null;
      const message=$('.d-transcript>.d-message'),scroller=$('.d-chat-scroll'),row=$('.d-sidebar .d-nav [data-view="Mira"]');
      if(!message||!scroller||!row)return null;
      const mira=row.querySelector('.d-unread');
      const lines=[...message.querySelectorAll(':scope>p')],
            work=[...message.querySelectorAll(':scope>.d-work-list>.d-work-card')],
            receipt=message.querySelector(':scope>.d-context-link'),
            card=message.querySelector(':scope>.d-exchange');
      if(!mira||lines.length<2||work.length<2||!receipt||!card)return null;
      const text=lines.map(line=>line.firstChild);
      if(text.some(node=>!node||node.nodeType!==3||!node.nodeValue.trim()))return null;
      return {message,scroller,row,mira,lines,text,late:[work[0],work[1],receipt,card]};
    }
    function begin(){
      const p=pieces();if(!p)return null;
      /* Heights are measured, not assumed, so blanking a paragraph cannot move the page. */
      const full=p.text.map(node=>node.nodeValue),held=p.lines.map(line=>line.getBoundingClientRect().height);
      p.lines.forEach((line,i)=>{line.style.minHeight=held[i]+'px'});
      const dots=document.createElement('span');dots.className='d-alive-typing';dots.setAttribute('aria-hidden','true');dots.innerHTML='<i></i><i></i><i></i>';
      const status=document.createElement('small');status.className='d-alive-status';status.textContent='reading…';
      p.message.setAttribute('aria-busy','true');
      return {...p,full,dots,status,marks:[LEAD,SECOND],gates:[CARD1,CARD2,REVEAL,REVEAL],rest:p.scroller.scrollTop};
    }
    const hide=el=>{el.classList.remove('d-alive-shown');el.classList.add('d-alive-veil','d-alive-rise')};
    const lift=el=>{el.classList.add('d-alive-shown')};
    function paint(elapsed){
      const s=scene,typing=elapsed<LEAD,answered=elapsed>=REVEAL;
      const counts=s.full.map((t,i)=>elapsed<=s.marks[i]?0:Math.min(t.length,Math.floor((elapsed-s.marks[i])/TYPE)));
      const shown=s.gates.map(at=>elapsed>=at);
      const mark=(typing?'t':'-')+counts.join('.')+shown.map(on=>on?'1':'0').join('');
      if(mark===key)return;
      key=mark;renders++;
      if(typing){if(!s.dots.isConnected)s.lines[0].append(s.dots)}else if(s.dots.isConnected)s.dots.remove();
      counts.forEach((n,i)=>{const want=n>=s.full[i].length?s.full[i]:s.full[i].slice(0,n);if(s.text[i].nodeValue!==want)s.text[i].nodeValue=want});
      s.late.forEach((el,i)=>{shown[i]?lift(el):hide(el)});
      if(answered){if(s.status.isConnected)s.status.remove();s.mira.classList.remove('d-alive-veil');lift(s.mira)}
      else{if(!s.status.isConnected)s.row.append(s.status);s.mira.classList.remove('d-alive-shown');s.mira.classList.add('d-alive-veil')}
    }
    function finish(disarm){
      if(disarm){armed=false;io.disconnect()}
      if(raf)cancelAnimationFrame(raf);raf=0;
      const done=scene;scene=null;key='';
      if(!done)return;
      if(done.dots.isConnected)done.dots.remove();
      if(done.status.isConnected)done.status.remove();
      done.text.forEach((node,i)=>{node.nodeValue=done.full[i]});
      done.lines.forEach(line=>line.removeAttribute('style'));
      done.late.forEach(el=>el.classList.remove('d-alive-veil','d-alive-rise','d-alive-shown'));
      done.mira.classList.remove('d-alive-veil','d-alive-shown');
      done.message.removeAttribute('aria-busy');
      if(done.scroller.scrollTop!==done.rest)done.scroller.scrollTo({top:done.rest,behavior:'instant'});
    }
    function start(){
      if(!armed||scene||state.paused||reduced.matches||document.hidden)return;
      const next=begin();if(!next)return;
      scene=next;key='';renders=0;frames=0;cycles=0;
      const t0=performance.now();
      const step=now=>{
        if(scene!==next)return;
        if(!next.message.isConnected){finish(true);return}
        frames++;
        const total=now-t0;cycles=Math.floor(total/PERIOD);
        paint(total%PERIOD);
        if(next.scroller.scrollTop!==next.rest)next.scroller.scrollTo({top:next.rest,behavior:'instant'});
        raf=requestAnimationFrame(step);
      };
      raf=requestAnimationFrame(step);
    }
    const io=new IntersectionObserver(entries=>{visible=entries[entries.length-1].isIntersecting;visible?start():finish(false)},{threshold:.35});
    ['pointerdown','keydown','click','input','change','submit'].forEach(type=>root.addEventListener(type,()=>{if(armed||scene)finish(true)},true));
    addEventListener('polyphonic:motion',()=>{if(state.paused)finish(false);else if(visible)start()});
    reduced.addEventListener('change',()=>{if(reduced.matches)finish(false);else if(visible)start()});
    /* A resize invalidates the measured heights: end the scene, re-measure, play on. */
    addEventListener('resize',()=>{finish(false);if(visible)start()},{passive:true});
    document.addEventListener('visibilitychange',()=>{document.hidden?finish(false):visible&&start()});
    /* Wait for the frame's own webfonts: the reserved paragraph heights are measured, so
       they have to be measured against the type the reader will actually see. */
    if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>io.observe(preview));else io.observe(preview);
    return {get armed(){return armed},get running(){return !!scene},get cost(){return {renders,frames,cycles}},period:PERIOD,stop:()=>finish(false),cancel:()=>finish(true)};
  })();
  window.PolyphonicDemo={navigate:nav,state,alive};
})();
