// Replaces window.prompt/alert (unsupported or ugly in Electron) with in-app dialogs. Raw snippets between /*@@name ... @@*/ markers.
const fs = require('fs'); const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
const self = fs.readFileSync(__filename, 'utf8');
const snip = name => { const m = new RegExp('/\\*@@' + name + '\\n([\\s\\S]*?)\\n@@\\*/').exec(self); if (!m) throw new Error('snippet ' + name); return m[1]; };
let t = fs.readFileSync('public/app.js', 'utf8').replace(/\r\n/g, '\n');
const rep = (x, y) => { if (t.split(x).length !== 2) throw new Error('not unique: ' + x.slice(0, 90)); t = t.replace(x, () => y); };
const repRe = (re, y) => { if (!re.test(t)) throw new Error('regex not found: ' + re); t = t.replace(re, () => y); };

rep("async function openView(view){", snip('helpers') + "\nasync function openView(view){");
rep("  if(state.modal==='set-pin'){", snip('modals') + "\n  if(state.modal==='set-pin'){");
repRe(/  else if\(action==='set-worker-pin'\)\{[^\n]*\n/, snip('h-setpin') + "\n");
repRe(/  else if\(action==='reset-owner-password'\)\{[^\n]*\n/, snip('h-resetpw') + "\n");
repRe(/  else if\(action==='new-recovery-key'\)\{[^\n]*\n/, snip('h-recovery') + "\n");
repRe(/  else if\(action==='reset-owner-pin'\)\{[^\n]*\n/, snip('h-ownerpin') + "\n");
rep("window.alert(r.pin?'Code PIN de '+data.name+' : '+r.pin+'\\n\\nNotez-le et donnez-le à l’employé. Il ne sera plus affiché.':'Employé créé avec le code PIN que vous avez choisi.');",
    "await showNotice(r.pin?{title:'Code PIN de '+data.name,code:r.pin,text:'Notez-le et donnez-le à l’employé. Il ne sera plus affiché.'}:{title:'Employé créé',text:'Le code PIN que vous avez choisi est enregistré.'});");
rep("if(created.tempPin)window.alert('Code temporaire du propriétaire : '+created.tempPin+'\\n\\nNotez-le et donnez-le lui. Il devra choisir son propre code à sa première connexion. Ce code ne sera plus affiché.');",
    "if(created.tempPin)await showNotice({title:'Code temporaire du propriétaire',code:created.tempPin,text:'Notez-le et donnez-le lui. Il devra choisir son propre code à sa première connexion. Ce code ne sera plus affiché.'});");
// dialog plumbing: submit, cancel, notice ok, and closing (Esc / X / backdrop) must resolve the waiting promise
rep("    else if(form.id==='worker-form'){", "    else if(form.id==='ask-form'){const answer=String(data.value||'').trim();state.modal='';renderApp();resolveDialogs(answer);}\n    else if(form.id==='worker-form'){");
rep("  else if(action==='close-modal'){", "  else if(action==='ask-cancel'){state.modal='';renderApp();resolveDialogs(null);}\n  else if(action==='notice-ok'){state.modal='';renderApp();resolveDialogs(true);}\n  else if(action==='close-modal'){resolveDialogs(null);");
fs.writeFileSync('public/app.js', t);
console.log('patched');

/*@@helpers
// In-app dialogs. Electron has no window.prompt, so questions are asked with real modals that return a promise.
let dialogResolve=null;
function resolveDialogs(value){const r=dialogResolve;dialogResolve=null;if(r)r(value);}
function askInput(options){resolveDialogs(null);return new Promise(resolve=>{dialogResolve=resolve;state.ask=options;state.modal='ask';renderApp();setTimeout(()=>document.querySelector('#ask-input')?.focus(),60);});}
function showNotice(options){resolveDialogs(null);return new Promise(resolve=>{dialogResolve=resolve;state.notice=options;state.modal='notice';renderApp();});}
@@*/

/*@@modals
  if(state.modal==='ask'&&state.ask){const q=state.ask;return `<div class="modal-backdrop"><section class="modal"><header class="modal-head"><div><h2>${esc(q.title)}</h2><p>${esc(q.message||'')}</p></div><button class="modal-x" data-action="ask-cancel">×</button></header><form id="ask-form"><div class="modal-body"><div class="field"><label for="ask-input">${esc(q.label||'')}</label><input id="ask-input" name="value" ${q.secret?'type="password"':''} ${q.numeric?'inputmode="numeric" maxlength="6" pattern="[0-9]*"':''} autocomplete="off" ${q.required?'required':''} placeholder="${esc(q.placeholder||'')}"></div></div><footer class="modal-foot"><button type="button" class="button secondary" data-action="ask-cancel">Annuler</button><button type="submit" class="button primary">${esc(q.submit||'Valider')}</button></footer></form></section></div>`;}
  if(state.modal==='notice'&&state.notice){const n=state.notice;return `<div class="modal-backdrop"><section class="modal recovery-modal"><header class="modal-head"><div><h2>${esc(n.title)}</h2></div></header><div class="recovery-modal-body">${n.code?`<span class="eyebrow">AFFICHÉ UNE SEULE FOIS</span><div class="recovery-code-value" style="font-size:40px;letter-spacing:6px">${esc(n.code)}</div>`:''}<p>${esc(n.text||'')}</p></div><footer class="modal-foot"><button class="button primary" data-action="notice-ok">${n.code?'J’ai noté le code':'OK'}</button></footer></section></div>`;}
@@*/

/*@@h-setpin
  else if(action==='set-worker-pin'){const typed=await askInput({title:'Code PIN de l’employé',message:'Tapez 6 chiffres, ou laissez vide pour qu’un code soit généré automatiquement.',label:'Code PIN (6 chiffres)',numeric:true,placeholder:'vide = généré',submit:'Enregistrer'});if(typed!==null){try{const r=await api('/api/team/'+encodeURIComponent(actionButton.dataset.id)+'/pin',{method:'POST',body:JSON.stringify({pin:typed})});await openView('team');await showNotice(r.generated?{title:'Nouveau code PIN',code:r.pin,text:'Notez-le et donnez-le à l’employé. Il ne sera plus affiché.'}:{title:'Code PIN enregistré',text:'Le code que vous avez choisi est enregistré.'});}catch(error){toast(error.message);}}}
@@*/

/*@@h-resetpw
  else if(action==='reset-owner-password'){const pw=await askInput({title:'Mot de passe temporaire',message:'Pour une connexion avec mot de passe (ancien compte). Le propriétaire devra le changer.',label:'Mot de passe (10 caractères minimum)',secret:true,required:true,submit:'Enregistrer'});if(pw){try{await api('/api/team/'+encodeURIComponent(actionButton.dataset.id)+'/reset-password',{method:'POST',body:JSON.stringify({password:pw})});toast('Mot de passe temporaire défini.');}catch(error){toast(error.message);}}}
@@*/

/*@@h-recovery
  else if(action==='new-recovery-key'){const current=await askInput({title:'Nouvelle clé de récupération',message:'L’ancienne clé ne fonctionnera plus. Entrez votre code actuel pour confirmer.',label:'Votre code actuel (6 chiffres)',numeric:true,secret:true,required:true,submit:'Générer la clé'});if(current){try{const r=await api('/api/recovery-key',{method:'POST',body:JSON.stringify({currentPin:current})});state.recoveryKey=r.recoveryKey;state.modal='recovery-key';renderApp();}catch(error){toast(error.message);}}}
@@*/

/*@@h-ownerpin
  else if(action==='reset-owner-pin'){if(window.confirm('Donner un nouveau code temporaire à ce propriétaire ? Il sera déconnecté et devra choisir son propre code.')){try{const r=await api('/api/team/'+encodeURIComponent(actionButton.dataset.id)+'/pin',{method:'POST',body:JSON.stringify({})});await openView('team');await showNotice({title:'Code temporaire du propriétaire',code:r.pin,text:'Notez-le et donnez-le au propriétaire. Il ne sera plus affiché.'});}catch(error){toast(error.message);}}}
@@*/
