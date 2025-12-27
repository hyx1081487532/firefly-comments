export interface Env {
  COMMENTS_DB: D1Database;
  ADMIN_PASSWORD: string; // secret
}

const CORS_HEADERS = { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } as Record<string,string>;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });

function getPathParts(path: string) {
  return path.split('/').filter(Boolean);
}

function escapeHtml(str: string) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MAX_CONTENT = 2000;
const RATE_LIMIT_WINDOW_MINUTES = 2; // window
const RATE_LIMIT_MAX = 5; // max submissions per window per IP

function getClientIp(request: Request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0] ||
    'unknown'
  );
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const parts = getPathParts(url.pathname);

    // Simple CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-admin-password'
        }
      });
    }

    try {
      // Public comment APIs
      if (parts[0] === 'api' && parts[1] === 'comments') {
        if (request.method === 'GET') {
          // GET /api/comments?url=...
          const urlParam = url.searchParams.get('url');
          if (!urlParam) return json({ error: 'url required' }, 400);
          const limit = Math.min(100, Number(url.searchParams.get('limit') || '100'));
          const res = await env.COMMENTS_DB.prepare(
            `SELECT id, url, name, content, created_at FROM comments WHERE url = ? AND status = 'approved' ORDER BY created_at DESC LIMIT ?`
          ).bind(urlParam, limit).all();
          return json(res.results);
        }

        if (request.method === 'POST') {
          // Parse JSON with validation
          let body: any;
          try {
            if (!request.headers.get('content-type')?.includes('application/json')) {
              return json({ error: 'content-type must be application/json' }, 415);
            }
            body = await request.json();
          } catch (e) {
            return json({ error: 'invalid JSON body' }, 400);
          }

          const { url: commentUrl, name, email, content } = body || {};
          if (!commentUrl || !content) return json({ error: 'url and content required' }, 400);
          const text = String(content || '').trim();
          if (!text) return json({ error: 'content required' }, 400);
          if (text.length > MAX_CONTENT) return json({ error: 'content too long' }, 400);

          const n = name ? String(name).trim().slice(0, 100) : null;
          const em = email ? String(email).trim().slice(0, 254) : null;
          if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return json({ error: 'invalid email' }, 400);

          const ip = getClientIp(request);
          const ua = request.headers.get('User-Agent') || null;

          // Rate limiting by IP using D1 timestamps
          const rate = await env.COMMENTS_DB.prepare(
            `SELECT COUNT(*) as cnt FROM comments WHERE ip = ? AND created_at > datetime('now','-${RATE_LIMIT_WINDOW_MINUTES} minutes')`
          ).bind(ip).all();
          const cnt = rate.results && rate.results[0] && (rate.results[0] as any).cnt ? Number((rate.results[0] as any).cnt) : 0;
          if (cnt >= RATE_LIMIT_MAX) return json({ error: 'rate_limited' }, 429);

          const safe = escapeHtml(text);
          const stmt = await env.COMMENTS_DB.prepare(
            `INSERT INTO comments (url, name, email, content, ip, user_agent, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`
          ).bind(commentUrl, n, em, safe, ip, ua).run();
          return json({ ok: true, id: (stmt as any).lastInsertRowid });
        }
      }

      // Admin endpoints
      if (parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'comments') {
        // helper: mask password for safe logging
        function maskPwd(s?: string) {
          if (!s) return '(empty)';
          const str = String(s);
          if (str.length <= 4) return '*'.repeat(str.length);
          return str.slice(0,2) + '***' + str.slice(-1);
        }

        const rawHeader = request.headers.get('x-admin-password') || '';
        const rawQuery = url.searchParams.get('x-admin-password') || '';
        const adminPassword = (rawHeader || rawQuery || '').trim();
        const expected = (env.ADMIN_PASSWORD || '').trim();

        console.log(`[ADMIN AUTH] headerPresent=${!!rawHeader} queryPresent=${!!rawQuery} received="${maskPwd(adminPassword)}" expected="${maskPwd(expected)}"`);

        if (adminPassword !== expected) {
          console.log(`[ADMIN AUTH] auth failed - received="${maskPwd(adminPassword)}" expected="${maskPwd(expected)}"`);
          return json({ error: 'unauthorized' }, 403);
        }
        // GET /api/admin/comments -> list all comments (optional ?status=...)
        if (request.method === 'GET') {
          const status = url.searchParams.get('status');
          let res;
          if (status) {
            res = await env.COMMENTS_DB.prepare(`SELECT * FROM comments WHERE status = ? ORDER BY created_at DESC`).bind(status).all();
          } else {
            res = await env.COMMENTS_DB.prepare(`SELECT * FROM comments ORDER BY created_at DESC`).all();
          }
          return json(res.results);
        }

        // GET /api/admin/comments/export -> CSV export
        if (request.method === 'GET' && parts[3] === 'export') {
          const res = await env.COMMENTS_DB.prepare(`SELECT * FROM comments ORDER BY created_at DESC`).all();
          const rows = res.results || [];
          const csv = ['id,url,name,email,content,ip,user_agent,status,created_at']
            .concat(rows.map((r: any) => {
              const escape = (v: any) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
              return [r.id, r.url, r.name, r.email, r.content, r.ip, r.user_agent, r.status, r.created_at].map(escape).join(',');
            }))
            .join('\n');
          return new Response(csv, { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename=comments.csv' } });
        }

        // POST /api/admin/comments/:id/approve|reject|edit
        if (request.method === 'POST') {
          const id = parts[3];
          const action = parts[4];
          if (!id || !action) return json({ error: 'invalid path' }, 400);

          if (action === 'approve') {
            await env.COMMENTS_DB.prepare(`UPDATE comments SET status='approved' WHERE id = ?`).bind(id).run();
            return json({ ok: true });
          }

          if (action === 'reject') {
            await env.COMMENTS_DB.prepare(`UPDATE comments SET status='rejected' WHERE id = ?`).bind(id).run();
            return json({ ok: true });
          }

          if (action === 'edit') {
            let body: any;
            try { body = await request.json(); } catch (e) { return json({ error: 'invalid JSON' }, 400); }
            const content = body && body.content ? String(body.content).trim().slice(0, MAX_CONTENT) : null;
            const name = body && Object.prototype.hasOwnProperty.call(body, 'name') ? (body.name ? String(body.name).trim().slice(0,100) : null) : undefined;
            if (!content && name === undefined) return json({ error: 'nothing to update' }, 400);

            const sets: string[] = [];
            const binds: any[] = [];
            if (content) { sets.push('content = ?'); binds.push(escapeHtml(content)); }
            if (name !== undefined) { sets.push('name = ?'); binds.push(name); }
            binds.push(id);
            await env.COMMENTS_DB.prepare(`UPDATE comments SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
            return json({ ok: true });
          }

          return json({ error: 'unknown action' }, 400);
        }

        // DELETE /api/admin/comments/:id -> delete comment
        if (request.method === 'DELETE') {
          const id = parts[3];
          if (!id) return json({ error: 'invalid path' }, 400);
          await env.COMMENTS_DB.prepare(`DELETE FROM comments WHERE id = ?`).bind(id).run();
          return json({ ok: true });
        }
      }

      // Admin UI
      if (url.pathname === '/admin') {
        const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Firefly Comments Admin</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px}
    .c{border:1px solid #ddd;padding:8px;margin:8px 0}
    .meta{font-size:12px;color:#666}
    .actions{margin-top:8px}
    .btn{margin-right:6px}
    #toast{position:fixed;right:16px;bottom:16px;background:#333;color:#fff;padding:8px 12px;border-radius:6px;display:none}
  </style>
</head>
<body>
<h1>Firefly Comments Admin</h1>
<p>输入管理员密码以查看与审核评论</p>
<input id="pwd" type="password" placeholder="admin password" />
<button id="login">登录</button>
<button id="refresh" title="刷新列表">刷新</button>
<select id="status"><option value="">全部</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已拒绝</option></select>
<button id="export">导出 CSV</button>
<div id="app"></div>
<div id="toast"></div>

<!-- 简单的编辑模态 -->
<div id="modal" style="display:none;position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,0.4);align-items:center;justify-content:center">
  <div style="background:#fff;padding:16px;max-width:600px;margin:auto;border-radius:8px">
    <h3 id="modal-title">编辑评论</h3>
    <div><label>昵称<br/><input id="modal-name" style="width:100%"/></label></div>
    <div><label>内容<br/><textarea id="modal-content" style="width:100%;height:120px"></textarea></label></div>
    <div style="text-align:right;margin-top:8px">
      <button id="modal-cancel">取消</button>
      <button id="modal-save">保存</button>
    </div>
  </div>
</div>

<script>
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.style.display='block';setTimeout(()=>t.style.display='none',2500)}
console.log('admin script loaded');
async function fetchComments(pwd){
  const status = document.getElementById('status').value;
  const base = '/api/admin/comments' + (status?('?status='+status):'');
  const qp = (base.indexOf('?')>-1 ? '&' : '?') + 'x-admin-password=' + encodeURIComponent(pwd || '');
  const url = base + qp;

  const loginBtn = document.getElementById('login');
  loginBtn.disabled = true;
  loginBtn.textContent = '登录中...';
  showToast('登录中...');

  try {
    const r = await fetch(url, {headers:{'x-admin-password':pwd || ''}});
    if(!r.ok){
      const txt = await r.text().catch(()=> '');
      console.log('admin login failed', { status: r.status, body: txt });
      showToast('认证失败');
      alert('认证失败: ' + (txt || r.status));
      loginBtn.disabled = false;
      loginBtn.textContent = '登录';
      return;
    }

    const data = await r.json();
    console.log('admin login success', Array.isArray(data) ? data.length + ' items' : data);

    const app = document.getElementById('app');
    app.innerHTML = '';
    data.forEach(function(c){
      const el = document.createElement('div'); el.className='c';
      el.innerHTML = '<strong>#' + c.id + '</strong> <em>' + (c.name||'匿名') + '</em> <div>' + c.content + '</div><div class="meta">状态: ' + c.status + ' · ' + c.created_at + (c.ip?(' · IP:'+c.ip):'') + '</div>';

      const actions = document.createElement('div'); actions.className='actions';
      const approve = document.createElement('button'); approve.textContent='通过'; approve.className='btn'; approve.onclick = async function(){ await fetch('/api/admin/comments/' + c.id + '/approve',{method:'POST',headers:{'x-admin-password':pwd}}); fetchComments(pwd)};
      const reject = document.createElement('button'); reject.textContent='拒绝'; reject.className='btn'; reject.onclick = async function(){ await fetch('/api/admin/comments/' + c.id + '/reject',{method:'POST',headers:{'x-admin-password':pwd}}); fetchComments(pwd)};
      const edit = document.createElement('button'); edit.textContent='编辑'; edit.className='btn'; edit.onclick = function(){ openEditModal(c, pwd); };
      const del = document.createElement('button'); del.textContent='删除'; del.className='btn'; del.onclick = async function(){ if(!confirm('确认删除此评论？')) return; const dr = await fetch('/api/admin/comments/' + c.id,{method:'DELETE',headers:{'x-admin-password':pwd}}); if(dr.ok){ showToast('已删除'); fetchComments(pwd);} else { showToast('删除失败'); alert('删除失败'); } };

      actions.appendChild(approve); actions.appendChild(reject); actions.appendChild(edit); actions.appendChild(del);
      el.appendChild(actions);
      app.appendChild(el);
    })
  } catch (e) {
    showToast('网络错误');
    alert('网络错误: ' + (e && e.message ? e.message : e));
  } finally {
    loginBtn.disabled = false;
  }
}

function openEditModal(comment, pwd){
  document.getElementById('modal').style.display='flex';
  (document.getElementById('modal-name')).value = comment.name || '';
  (document.getElementById('modal-content')).value = comment.content || '';
  document.getElementById('modal-save').onclick = async ()=>{
    const newName = (document.getElementById('modal-name')).value;
    const newContent = (document.getElementById('modal-content')).value;
    const res = await fetch('/api/admin/comments/' + comment.id + '/edit',{method:'POST',headers:{'x-admin-password':pwd,'content-type':'application/json'},body:JSON.stringify({name:newName,content:newContent})});
    if(res.ok){ showToast('已保存'); document.getElementById('modal').style.display='none'; fetchComments(pwd) } else { alert('保存失败') }
  };
  document.getElementById('modal-cancel').onclick = ()=>{ document.getElementById('modal').style.display='none' };
}

document.getElementById('login').onclick = ()=>{const pwd=document.getElementById('pwd').value; fetchComments(pwd)}
document.getElementById('status').onchange = ()=>{const pwd=document.getElementById('pwd').value; fetchComments(pwd)}
document.getElementById('refresh').onclick = ()=>{const pwd=document.getElementById('pwd').value; fetchComments(pwd)}
document.getElementById('export').onclick = async ()=>{ const pwd=document.getElementById('pwd').value; if(!pwd){alert('请输入密码');return} const r=await fetch('/api/admin/comments/export',{headers:{'x-admin-password':pwd}}); if(!r.ok){alert('导出失败');return} const blob = await r.blob(); const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'comments.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); }
</script>
</body>
</html>
`;
        return new Response(html, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
      }

      // Serve embed script
      if (url.pathname === '/embed.js') {
        const js = `// Simple Firefly embed script — replace origin if needed\n(function(){\n  const ORIGIN = ''; // e.g. https://firefly-comments.example.workers.dev\n  async function init(){\n    const container = document.getElementById('firefly-comments');\n    if(!container) return;\n    const pageUrl = container.dataset.pageUrl || location.href;\n    const origin = ORIGIN || location.origin;\n\n    const render = async ()=>{\n      const res = await fetch(origin + '/api/comments?url=' + encodeURIComponent(pageUrl));\n      const comments = await res.json();\n      container.innerHTML = '';\n      const list = document.createElement('div');\n      comments.forEach(c=>{const d=document.createElement('div'); d.innerHTML = \`<strong>\${c.name||'匿名'}</strong><div>\${c.content}</div>\`; list.appendChild(d)});\n      container.appendChild(list);\n    };\n\n    const form = document.createElement('form');\n    form.innerHTML = \`<input name=name placeholder="昵称" /><br/><textarea name=content required placeholder="评论"></textarea><br/><button>提交评论</button>\`;\n    form.onsubmit = async (e)=>{e.preventDefault(); const fd = new FormData(form); await fetch(origin + '/api/comments', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({url:pageUrl, name: fd.get('name'), content: fd.get('content')})}); alert('提交成功，等待审核'); form.reset(); render(); };\n\n    container.appendChild(form);\n    render();\n  }\n  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();\n})();`;
        return new Response(js, { headers: { 'content-type': 'application/javascript' } });
      }

      return new Response('Not found', { status: 404 });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }
};