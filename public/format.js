/* GFM rendering with a strict HTML sanitizer; no agent-provided HTML is trusted. */
'use strict';
const PocketFormat = (() => {
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const imageFile = p => /\.(png|jpe?g|gif|webp)$/i.test(p);
  function href(value, sessionId) {
    const v = String(value || '').trim();
    if (/^https?:\/\//i.test(v)) {
      try { const u = new URL(v); return ['http:','https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
    }
    if (/^\/(home|Users|root)\//.test(v) && !v.split('/').some(x => x.startsWith('.'))) {
      if (imageFile(v)) return '/api/file?path=' + encodeURIComponent(v);
      if (sessionId && /\.(pdf|csv|tsv|xlsx|docx|pptx|txt|md|html|json|zip)$/i.test(v)) return '/api/session/' + encodeURIComponent(sessionId) + '/artifact?path=' + encodeURIComponent(v);
    }
    return null;
  }
  function render(source, sessionId) {
    // Retain the existing convenience for a local image path on its own line.
    const text = String(source || '').replace(/^`?(\/(?:home|Users|root)\/[^\n`]+\.(?:png|jpe?g|gif|webp))`?$/gmi, '![](<$1>)');
    const parser = new marked.Marked({gfm:true,breaks:false,renderer:{
      html(token) { return escape(token.text); },
      link(token) {
        const url=href(token.href,sessionId), label=this.parser.parseInline(token.tokens);
        return url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
      },
      image(token) {
        const url=href(token.href,sessionId);
        if(!url || (!/^https?:/.test(url) && !url.startsWith('/api/file?')))return escape(token.text || 'Image');
        return `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer"><img class="genimg" src="${escape(url)}" alt="${escape(token.text || 'Image')}" loading="lazy" referrerpolicy="no-referrer"></a>`;
      },
    }});
    const clean=DOMPurify.sanitize(parser.parse(text),{
      ALLOWED_TAGS:['p','br','strong','em','del','s','a','img','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6','hr','table','thead','tbody','tr','th','td','input'],
      ALLOWED_ATTR:['href','target','rel','src','alt','loading','referrerpolicy','class','align','start','type','checked','disabled'],
      ALLOW_DATA_ATTR:false,
    });
    const tpl=document.createElement('template');tpl.innerHTML=clean;
    tpl.content.querySelectorAll('table').forEach(table=>{
      const wrap=document.createElement('div');wrap.className='report-table';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Report table; scroll horizontally for more columns');
      table.replaceWith(wrap);wrap.append(table);
      table.querySelectorAll('th').forEach(th=>th.setAttribute('scope','col'));
    });
    tpl.content.querySelectorAll('pre').forEach(pre=>{
      const wrap=document.createElement('div');wrap.className='codewrap';pre.replaceWith(wrap);
      const button=document.createElement('button');button.className='copybtn';button.dataset.copy='';button.textContent='Copy';button.setAttribute('aria-label','Copy code');wrap.append(button,pre);
    });
    tpl.content.querySelectorAll('input').forEach(el=>{if(el.type!=='checkbox')el.remove();else el.disabled=true;});
    return tpl.innerHTML;
  }
  return {render,href};
})();
