var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// dist/worker.js
var CORS_HEADERS = { "content-type": "application/json", "Access-Control-Allow-Origin": "*" };
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), { status, headers: CORS_HEADERS }), "json");
function getPathParts(path) {
  return path.split("/").filter(Boolean);
}
__name(getPathParts, "getPathParts");
function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
__name(escapeHtml, "escapeHtml");
var MAX_CONTENT = 2e3;
var RATE_LIMIT_WINDOW_MINUTES = 2;
var RATE_LIMIT_MAX = 5;
function getClientIp(request) {
  return request.headers.get("CF-Connecting-IP") || (request.headers.get("X-Forwarded-For") || "").split(",")[0] || "unknown";
}
__name(getClientIp, "getClientIp");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = getPathParts(url.pathname);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, x-admin-password"
        }
      });
    }
    try {
      if (parts[0] === "api" && parts[1] === "comments") {
        if (request.method === "GET") {
          const urlParam = url.searchParams.get("url");
          if (!urlParam)
            return json({ error: "url required" }, 400);
          const limit = Math.min(100, Number(url.searchParams.get("limit") || "100"));
          const res = await env.COMMENTS_DB.prepare(`SELECT id, url, name, content, created_at FROM comments WHERE url = ? AND status = 'approved' ORDER BY created_at DESC LIMIT ?`).bind(urlParam, limit).all();
          return json(res.results);
        }
        if (request.method === "POST") {
          let body;
          try {
            if (!request.headers.get("content-type")?.includes("application/json")) {
              return json({ error: "content-type must be application/json" }, 415);
            }
            body = await request.json();
          } catch (e) {
            return json({ error: "invalid JSON body" }, 400);
          }
          const { url: commentUrl, name, email, content } = body || {};
          if (!commentUrl || !content)
            return json({ error: "url and content required" }, 400);
          const text = String(content || "").trim();
          if (!text)
            return json({ error: "content required" }, 400);
          if (text.length > MAX_CONTENT)
            return json({ error: "content too long" }, 400);
          const n = name ? String(name).trim().slice(0, 100) : null;
          const em = email ? String(email).trim().slice(0, 254) : null;
          if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em))
            return json({ error: "invalid email" }, 400);
          const ip = getClientIp(request);
          const ua = request.headers.get("User-Agent") || null;
          const rate = await env.COMMENTS_DB.prepare(`SELECT COUNT(*) as cnt FROM comments WHERE ip = ? AND created_at > datetime('now','-${RATE_LIMIT_WINDOW_MINUTES} minutes')`).bind(ip).all();
          const cnt = rate.results && rate.results[0] && rate.results[0].cnt ? Number(rate.results[0].cnt) : 0;
          if (cnt >= RATE_LIMIT_MAX)
            return json({ error: "rate_limited" }, 429);
          const safe = escapeHtml(text);
          const stmt = await env.COMMENTS_DB.prepare(`INSERT INTO comments (url, name, email, content, ip, user_agent, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`).bind(commentUrl, n, em, safe, ip, ua).run();
          return json({ ok: true, id: stmt.lastInsertRowid });
        }
      }
      if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "comments") {
        let maskPwd2 = function(s) {
          if (!s)
            return "(empty)";
          const str = String(s);
          if (str.length <= 4)
            return "*".repeat(str.length);
          return str.slice(0, 2) + "***" + str.slice(-1);
        };
        var maskPwd = maskPwd2;
        __name(maskPwd2, "maskPwd");
        const rawHeader = request.headers.get("x-admin-password") || "";
        const rawQuery = url.searchParams.get("x-admin-password") || "";
        const adminPassword = (rawHeader || rawQuery || "").trim();
        const expected = (env.ADMIN_PASSWORD || "").trim();
        console.log(`[ADMIN AUTH] headerPresent=${!!rawHeader} queryPresent=${!!rawQuery} received="${maskPwd2(adminPassword)}" expected="${maskPwd2(expected)}"`);
        if (adminPassword !== expected) {
          console.log(`[ADMIN AUTH] auth failed - received="${maskPwd2(adminPassword)}" expected="${maskPwd2(expected)}"`);
          return json({ error: "unauthorized" }, 403);
        }
        if (request.method === "GET") {
          const status = url.searchParams.get("status");
          let res;
          if (status) {
            res = await env.COMMENTS_DB.prepare(`SELECT * FROM comments WHERE status = ? ORDER BY created_at DESC`).bind(status).all();
          } else {
            res = await env.COMMENTS_DB.prepare(`SELECT * FROM comments ORDER BY created_at DESC`).all();
          }
          return json(res.results);
        }
        if (request.method === "GET" && parts[3] === "export") {
          const res = await env.COMMENTS_DB.prepare(`SELECT * FROM comments ORDER BY created_at DESC`).all();
          const rows = res.results || [];
          const csv = ["id,url,name,email,content,ip,user_agent,status,created_at"].concat(rows.map((r) => {
            const escape = /* @__PURE__ */ __name((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"', "escape");
            return [r.id, r.url, r.name, r.email, r.content, r.ip, r.user_agent, r.status, r.created_at].map(escape).join(",");
          })).join("\n");
          return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=comments.csv" } });
        }
        if (request.method === "POST") {
          const id = parts[3];
          const action = parts[4];
          if (!id || !action)
            return json({ error: "invalid path" }, 400);
          if (action === "approve") {
            await env.COMMENTS_DB.prepare(`UPDATE comments SET status='approved' WHERE id = ?`).bind(id).run();
            return json({ ok: true });
          }
          if (action === "reject") {
            await env.COMMENTS_DB.prepare(`UPDATE comments SET status='rejected' WHERE id = ?`).bind(id).run();
            return json({ ok: true });
          }
          if (action === "edit") {
            let body;
            try {
              body = await request.json();
            } catch (e) {
              return json({ error: "invalid JSON" }, 400);
            }
            const content = body && body.content ? String(body.content).trim().slice(0, MAX_CONTENT) : null;
            const name = body && Object.prototype.hasOwnProperty.call(body, "name") ? body.name ? String(body.name).trim().slice(0, 100) : null : void 0;
            if (!content && name === void 0)
              return json({ error: "nothing to update" }, 400);
            const sets = [];
            const binds = [];
            if (content) {
              sets.push("content = ?");
              binds.push(escapeHtml(content));
            }
            if (name !== void 0) {
              sets.push("name = ?");
              binds.push(name);
            }
            binds.push(id);
            await env.COMMENTS_DB.prepare(`UPDATE comments SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
            return json({ ok: true });
          }
          return json({ error: "unknown action" }, 400);
        }
        if (request.method === "DELETE") {
          const id = parts[3];
          if (!id)
            return json({ error: "invalid path" }, 400);
          await env.COMMENTS_DB.prepare(`DELETE FROM comments WHERE id = ?`).bind(id).run();
          return json({ ok: true });
        }
      }
      if (url.pathname === "/admin") {
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
<p>\u8F93\u5165\u7BA1\u7406\u5458\u5BC6\u7801\u4EE5\u67E5\u770B\u4E0E\u5BA1\u6838\u8BC4\u8BBA</p>
<input id="pwd" type="password" placeholder="admin password" />
<button id="login">\u767B\u5F55</button>
<button id="refresh" title="\u5237\u65B0\u5217\u8868">\u5237\u65B0</button>
<select id="status"><option value="">\u5168\u90E8</option><option value="pending">\u5F85\u5BA1\u6838</option><option value="approved">\u5DF2\u901A\u8FC7</option><option value="rejected">\u5DF2\u62D2\u7EDD</option></select>
<button id="export">\u5BFC\u51FA CSV</button>
<div id="app"></div>
<div id="toast"></div>

<!-- \u7B80\u5355\u7684\u7F16\u8F91\u6A21\u6001 -->
<div id="modal" style="display:none;position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,0.4);align-items:center;justify-content:center">
  <div style="background:#fff;padding:16px;max-width:600px;margin:auto;border-radius:8px">
    <h3 id="modal-title">\u7F16\u8F91\u8BC4\u8BBA</h3>
    <div><label>\u6635\u79F0<br/><input id="modal-name" style="width:100%"/></label></div>
    <div><label>\u5185\u5BB9<br/><textarea id="modal-content" style="width:100%;height:120px"></textarea></label></div>
    <div style="text-align:right;margin-top:8px">
      <button id="modal-cancel">\u53D6\u6D88</button>
      <button id="modal-save">\u4FDD\u5B58</button>
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
  loginBtn.textContent = '\u767B\u5F55\u4E2D...';
  showToast('\u767B\u5F55\u4E2D...');

  try {
    const r = await fetch(url, {headers:{'x-admin-password':pwd || ''}});
    if(!r.ok){
      const txt = await r.text().catch(()=> '');
      showToast('\u8BA4\u8BC1\u5931\u8D25');
      alert('\u8BA4\u8BC1\u5931\u8D25: ' + (txt || r.status));
      loginBtn.disabled = false;
      loginBtn.textContent = '\u767B\u5F55';
      return;
    }

    const data = await r.json();
    document.getElementById('pwd').disabled = true;
    loginBtn.textContent = '\u767B\u51FA';
    loginBtn.disabled = false;
    loginBtn.onclick = function(){document.getElementById('pwd').disabled = false; document.getElementById('pwd').value=''; document.getElementById('login').textContent='\u767B\u5F55'; document.getElementById('login').onclick = ()=>{const pwd=document.getElementById('pwd').value; fetchComments(pwd)}; document.getElementById('app').innerHTML='';};

    const app = document.getElementById('app');
    app.innerHTML = '';
    data.forEach(function(c){
      const el = document.createElement('div'); el.className='c';
      el.innerHTML = '<strong>#' + c.id + '</strong> <em>' + (c.name||'\u533F\u540D') + '</em> <div>' + c.content + '</div><div class="meta">\u72B6\u6001: ' + c.status + ' \xB7 ' + c.created_at + (c.ip?(' \xB7 IP:'+c.ip):'') + '</div>';

      const actions = document.createElement('div'); actions.className='actions';
      const approve = document.createElement('button'); approve.textContent='\u901A\u8FC7'; approve.className='btn'; approve.onclick = async function(){ await fetch('/api/admin/comments/' + c.id + '/approve',{method:'POST',headers:{'x-admin-password':pwd}}); fetchComments(pwd)};
      const reject = document.createElement('button'); reject.textContent='\u62D2\u7EDD'; reject.className='btn'; reject.onclick = async function(){ await fetch('/api/admin/comments/' + c.id + '/reject',{method:'POST',headers:{'x-admin-password':pwd}}); fetchComments(pwd)};
      const edit = document.createElement('button'); edit.textContent='\u7F16\u8F91'; edit.className='btn'; edit.onclick = function(){ openEditModal(c, pwd); };
      const del = document.createElement('button'); del.textContent='\u5220\u9664'; del.className='btn'; del.onclick = async function(){ if(!confirm('\u786E\u8BA4\u5220\u9664\u6B64\u8BC4\u8BBA\uFF1F')) return; const dr = await fetch('/api/admin/comments/' + c.id,{method:'DELETE',headers:{'x-admin-password':pwd}}); if(dr.ok){ showToast('\u5DF2\u5220\u9664'); fetchComments(pwd);} else { showToast('\u5220\u9664\u5931\u8D25'); alert('\u5220\u9664\u5931\u8D25'); } };

      actions.appendChild(approve); actions.appendChild(reject); actions.appendChild(edit); actions.appendChild(del);
      el.appendChild(actions);
      app.appendChild(el);
    })
  } catch (e) {
    showToast('\u7F51\u7EDC\u9519\u8BEF');
    alert('\u7F51\u7EDC\u9519\u8BEF: ' + (e && e.message ? e.message : e));
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
    if(res.ok){ showToast('\u5DF2\u4FDD\u5B58'); document.getElementById('modal').style.display='none'; fetchComments(pwd) } else { alert('\u4FDD\u5B58\u5931\u8D25') }
  };
  document.getElementById('modal-cancel').onclick = ()=>{ document.getElementById('modal').style.display='none' };
}

document.getElementById('login').onclick = ()=>{const pwd=document.getElementById('pwd').value; fetchComments(pwd)}
document.getElementById('status').onchange = ()=>{const pwd=document.getElementById('pwd').value; fetchComments(pwd)}
document.getElementById('refresh').onclick = ()=>{const pwd=document.getElementById('pwd').value; fetchComments(pwd)}
document.getElementById('export').onclick = async ()=>{ const pwd=document.getElementById('pwd').value; if(!pwd){alert('\u8BF7\u8F93\u5165\u5BC6\u7801');return} const r=await fetch('/api/admin/comments/export',{headers:{'x-admin-password':pwd}}); if(!r.ok){alert('\u5BFC\u51FA\u5931\u8D25');return} const blob = await r.blob(); const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'comments.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); }
<\/script>
</body>
</html>
`;
        return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
      }
      if (url.pathname === "/embed.js") {
        const js = `// Simple Firefly embed script \u2014 replace origin if needed
(function(){
  const ORIGIN = ''; // e.g. https://firefly-comments.example.workers.dev
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
      comments.forEach(c=>{const d=document.createElement('div'); d.innerHTML = \`<strong>\${c.name||'\u533F\u540D'}</strong><div>\${c.content}</div>\`; list.appendChild(d)});
      container.appendChild(list);
    };

    const form = document.createElement('form');
    form.innerHTML = \`<input name=name placeholder="\u6635\u79F0" /><br/><textarea name=content required placeholder="\u8BC4\u8BBA"></textarea><br/><button>\u63D0\u4EA4\u8BC4\u8BBA</button>\`;
    form.onsubmit = async (e)=>{e.preventDefault(); const fd = new FormData(form); await fetch(origin + '/api/comments', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({url:pageUrl, name: fd.get('name'), content: fd.get('content')})}); alert('\u63D0\u4EA4\u6210\u529F\uFF0C\u7B49\u5F85\u5BA1\u6838'); form.reset(); render(); };

    container.appendChild(form);
    render();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();`;
        return new Response(js, { headers: { "content-type": "application/javascript" } });
      }
      return new Response("Not found", { status: 404 });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }
};

// node_modules/.pnpm/wrangler@4.56.0_@cloudflare+workers-types@4.20251219.0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/.pnpm/wrangler@4.56.0_@cloudflare+workers-types@4.20251219.0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-R2PCyG/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/.pnpm/wrangler@4.56.0_@cloudflare+workers-types@4.20251219.0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-R2PCyG/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
