/**
 * Simple test script for local worker dev server
 * Usage:
 *   ADMIN_PASSWORD=yourpwd node tests/test_api.js
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const ADMIN = process.env.ADMIN_PASSWORD;

async function postComment(){
  const res = await fetch(BASE + '/api/comments', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({ url: 'http://local/test-post', name: 'test', content: 'hello from test ' + Date.now() })
  });
  console.log('post status', res.status);
  console.log(await res.json());
}

async function listPending(){
  const res = await fetch(BASE + '/api/admin/comments?status=pending', {
    headers: {'x-admin-password': ADMIN}
  });
  console.log('pending status', res.status);
  return await res.json();
}

async function approve(id){
  const res = await fetch(BASE + '/api/admin/comments/' + id + '/approve', { method: 'POST', headers:{'x-admin-password':ADMIN} });
  console.log('approve', id, res.status, await res.json());
}

async function run(){
  if(!ADMIN){
    console.error('Please set ADMIN_PASSWORD env var. Example: ADMIN_PASSWORD=xxx node tests/test_api.js');
    process.exit(1);
  }
  await postComment();
  // wait a moment
  await new Promise(r=>setTimeout(r, 500));
  const pending = await listPending();
  console.log('pending list length', pending.length);
  if(pending.length>0){
    const id = pending[0].id;
    await approve(id);
  }
}

run().catch(e=>{console.error(e); process.exit(2)});
