// 直接可嵌入的客户端脚本，替换 `ORIGIN` 为你的 Worker 部署域名
(function(){
  const ORIGIN = ''; // e.g. https://firefly-comments.yourdomain.workers.dev
  async function init(){
    const container = document.getElementById('firefly-comments');
    if(!container) return;
    const pageUrl = container.dataset.pageUrl || location.href;
    const origin = ORIGIN || location.origin;

    const render = async ()=>{
      const res = await fetch(origin + '/api/comments?url=' + encodeURIComponent(pageUrl));
      const comments = await res.json();
      container.innerHTML = '';
      const list = document.createElement('div');
      comments.forEach(c=>{const d=document.createElement('div'); d.innerHTML = `<strong>${c.name||'匿名'}</strong><div>${c.content}</div>`; list.appendChild(d)});
      container.appendChild(list);
    };

    const form = document.createElement('form');
    form.innerHTML = `<input name=name placeholder="昵称" /><br/><textarea name=content required placeholder="评论"></textarea><br/><button>提交评论</button>`;
    form.onsubmit = async (e)=>{e.preventDefault(); const fd = new FormData(form); await fetch(origin + '/api/comments', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({url:pageUrl, name: fd.get('name'), content: fd.get('content')})}); alert('提交成功，等待审核'); form.reset(); };

    container.appendChild(form);
    render();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();