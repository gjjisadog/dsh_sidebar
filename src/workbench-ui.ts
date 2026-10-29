export const workbenchStyles = `
#workbench {display:flex;width:100%;height:100%;min-height:0} #app {flex:1;min-width:0}
#workbenchNav {width:245px;flex-shrink:0;padding:12px;border-right:1px solid var(--vscode-widget-border);overflow:auto;background:var(--vscode-sideBar-background)}
#workbenchNav input,#workbenchNav select {width:100%;margin:6px 0;padding:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}
#workbenchNav button {display:block;text-align:left;width:100%;border:0;background:transparent;padding:7px;border-radius:5px;overflow:hidden;text-overflow:ellipsis}
#workbenchNav button:hover {background:var(--vscode-list-hoverBackground)}
#workbenchPreview {position:absolute;inset:38px 0 0;background:var(--vscode-editor-background);z-index:15;overflow:auto;padding:20px}
#workbenchPreview article {max-width:850px;margin:20px auto;padding:12px;border-bottom:1px solid var(--vscode-widget-border);overflow-wrap:anywhere}
#workbenchPreview pre {white-space:pre-wrap} #app {position:relative}
@media(max-width:650px){#workbenchNav{width:175px;padding:6px}}
`
export const workbenchNavigation = `<nav id="workbenchNav" aria-label="工程与历史"><strong>DSH 工作台</strong><button data-workbench="workbench-add-project">＋ 添加工程</button><input id="workbenchSearch" type="search" placeholder="搜索对话标题" aria-label="搜索对话标题"><select id="workbenchProject" aria-label="工程范围"><option value="">全部工程</option></select><div id="workbenchSessions"></div><button data-workbench="workbench-catalog">刷新历史</button><button data-workbench="workbench-source">关联 DSH 数据源</button><button data-workbench="workbench-clear-cache">清理历史缓存</button></nav>`

export const workbenchScript = `
let workbenchSaved = vscode.getState?.() || {};
let workbenchPreviewSession;
let workbenchPreviewRequest = 0;
let workbenchCatalog = {projects:[],sessions:[]};
let workbenchLocked = false;
const workbenchPersist = () => {
  workbenchSaved={...workbenchSaved,text:elements.prompt.value,sessionId:state && state.sessionId,scroll:elements.scroll.scrollTop,preview:workbenchPreviewSession,previewScroll:document.getElementById('workbenchPreview').scrollTop,query:document.getElementById('workbenchSearch')?.value||'',project:document.getElementById('workbenchProject')?.value||''};
  vscode.setState?.(workbenchSaved);vscode.postMessage({type:'workbench-view',view:workbenchSaved});
};
elements.prompt.addEventListener('input', () => {
  workbenchPersist();
  if (state) vscode.postMessage({type:'workbench-draft',sessionId:state.sessionId,text:elements.prompt.value});
});
elements.scroll.addEventListener('scroll', workbenchPersist);
document.getElementById('workbenchMode').addEventListener('click', () => {workbenchPersist();vscode.postMessage({type:'workbench-mode',text:elements.prompt.value});});
function workbenchShowLive() {workbenchPreviewRequest++;for(const pane of document.querySelectorAll('.composer-wrap,.conversation-pane'))pane.inert=false;document.getElementById('workbenchPreview').classList.add('hidden');workbenchPreviewSession=undefined;workbenchPersist();}
function workbenchRenderCatalog() {
  const list=document.getElementById('workbenchSessions'); if(!list)return;
  const query=document.getElementById('workbenchSearch').value.toLocaleLowerCase();
  const project=document.getElementById('workbenchProject').value;
  list.replaceChildren();
  const live=document.createElement('button');live.textContent='返回当前聊天';live.onclick=workbenchShowLive;list.append(live);
  for(const group of workbenchCatalog.projects) {
    if(project && project!==group.id)continue;
    const heading=document.createElement('h4');heading.textContent=group.name;heading.title=group.cwd;list.append(heading);
    for(const session of workbenchCatalog.sessions.filter(s=>s.projectId===group.id && s.title.toLocaleLowerCase().includes(query))) {
      const button=document.createElement('button');button.textContent=session.title;button.title=group.cwd+' · '+new Date(session.updatedAt).toLocaleString();
      button.onclick=()=>{workbenchPreviewSession=session;workbenchPersist();vscode.postMessage({type:'workbench-preview',requestId:++workbenchPreviewRequest,sourceId:session.sourceId,sessionId:session.sessionId});};list.append(button);
    }
  }
}
for(const button of document.querySelectorAll('[data-workbench]'))button.addEventListener('click',()=>vscode.postMessage({type:button.dataset.workbench}));
if(document.getElementById('workbenchSearch')) {
  document.getElementById('workbenchSearch').addEventListener('input',()=>{workbenchRenderCatalog();workbenchPersist();});
  document.getElementById('workbenchProject').addEventListener('change',()=>{workbenchRenderCatalog();workbenchPersist();});
}
window.addEventListener('message', event=>{
  const data=event.data;if(!data)return;
  if(data.type==='state' || data.type==='state-update') {
    const sid=data.type==='state'?data.state.sessionId:data.update.patch.sessionId;
    if(sid)vscode.postMessage({type:'workbench-restore',sessionId:sid});
  }
  if(data.type==='workbench-draft') {
    sessionDrafts.set(data.sessionId,data.text || '');
    elements.prompt.dataset.workbenchPending=String(data.pending===true);
    draftImagesBySession.set(data.sessionId,(data.images||[]).map(i=>({id:i.id,name:i.name,mediaType:i.mediaType})));
    if(state && state.sessionId===data.sessionId) {elements.prompt.value=data.text||'';draftImages=draftImagesBySession.get(data.sessionId);renderAttachments();resizePrompt();workbenchLocked=false;elements.prompt.dataset.workbenchLocked='false';}
    requestAnimationFrame(()=>{if(workbenchSaved.sessionId===data.sessionId)elements.scroll.scrollTop=workbenchSaved.scroll||0;});
  }
  if(data.type==='workbench-locked') {workbenchLocked=true;elements.prompt.dataset.workbenchLocked='true';elements.prompt.disabled=true;elements.send.disabled=true;elements.attach.disabled=true;elements.prompt.placeholder='草稿正在其他窗口编辑';}
  if(data.type==='workbench-view') {
    workbenchSaved=data.view||{};
    if(document.getElementById('workbenchSearch'))document.getElementById('workbenchSearch').value=workbenchSaved.query||'';
    if(workbenchSaved.preview){const p=workbenchSaved.preview;vscode.postMessage({type:'workbench-preview',requestId:++workbenchPreviewRequest,sourceId:p.sourceId,sessionId:p.sessionId});}
  }
  if(data.type==='workbench-live')workbenchShowLive();
  if(data.type==='workbench-catalog') {
    workbenchCatalog=data;
    const select=document.getElementById('workbenchProject');if(select){const old=select.value;select.replaceChildren(new Option('全部工程',''));for(const p of data.projects)select.append(new Option(p.name+' — '+p.cwd,p.id));select.value=old||workbenchSaved.project||'';workbenchRenderCatalog();}
  }
  if(data.type==='workbench-preview') {
    if(data.requestId !== undefined && data.requestId !== workbenchPreviewRequest)return;
    for(const pane of document.querySelectorAll('.composer-wrap,.conversation-pane'))pane.inert=true;
    workbenchPreviewSession=data.session;
    const preview=document.getElementById('workbenchPreview');preview.replaceChildren();preview.classList.remove('hidden');
    const title=document.createElement('h2');title.textContent=data.session.title;preview.append(title);
    const status=document.createElement('p');status.textContent=data.session.cwd+' · '+(data.error||'只读预览')+(data.updatedAt?' · '+new Date(data.updatedAt).toLocaleString():'');preview.append(status);
    const back=document.createElement('button');back.textContent='返回当前聊天';back.onclick=workbenchShowLive;preview.append(back);
    const resume=document.createElement('button');resume.textContent='在所属工程继续';resume.onclick=()=>vscode.postMessage({type:'workbench-resume',sourceId:data.session.sourceId,sessionId:data.session.sessionId});preview.append(resume);
    if(data.hasMore){const older=document.createElement('button');older.textContent='加载更早消息（缓存可能不完整）';older.onclick=()=>vscode.postMessage({type:'workbench-preview',requestId:++workbenchPreviewRequest,sourceId:data.session.sourceId,sessionId:data.session.sessionId,older:true});preview.append(older);}
    for(const message of data.messages||[]) {const article=document.createElement('article');const role=document.createElement('strong');role.textContent=message.role;const text=document.createElement('pre');text.textContent=message.text||message.title||'';article.append(role,text);for(const image of message.images||[]){const label=document.createElement('p');label.textContent=image.name||'附件';if(image.data && /^image\\/(png|jpeg|gif|webp)$/.test(image.mediaType)){const img=document.createElement('img');img.src='data:'+image.mediaType+';base64,'+image.data;img.style.maxWidth='100%';article.append(img);}else label.textContent+='（未缓存，需连接原数据源）';article.append(label);}preview.append(article);}
    preview.scrollTop=workbenchSaved.previewScroll||0;
  }
});
setTimeout(()=>vscode.postMessage({type:'workbench-catalog'}),0);
`
