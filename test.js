const { spawn } = require('child_process');
const path = require('path');

const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname, stdio: ['ignore','pipe','pipe'] });
let log = '';
srv.stdout.on('data', d => log += d.toString());
srv.stderr.on('data', d => log += d.toString());

const base = 'http://localhost:3000';
function api(method, p, body, token){
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined })
    .then(r => r.json()).catch(e => ({ error: 'net:' + e.message }));
}

function waitPort(attempts){
  return new Promise((resolve)=>{
    const t = setInterval(async ()=>{
      try { await fetch(base+'/'); clearInterval(t); resolve(true); }
      catch(e){ if(--attempts<=0){ clearInterval(t); resolve(false); } }
    }, 500);
  });
}

(async ()=>{
  const up = await waitPort(15);
  if(!up){ console.log('SERVER NOT UP. LOG:\n' + log); process.exit(1); }

  const a = await api('POST','/api/register',{username:'player_one',email:'p1@test.com',password:'pass1234',gender:'male'});
  console.log('RegA:', a.user ? a.user.username+'/'+a.user.gender : 'FAIL '+JSON.stringify(a));

  const b = await api('POST','/api/register',{username:'player_two',password:'pass1234',gender:'female'});
  console.log('RegB:', b.user ? b.user.username+'/'+b.user.gender : 'FAIL '+JSON.stringify(b));

  const dupl = await api('POST','/api/register',{username:'player_one',password:'x',gender:'male'});
  console.log('Dup username error:', dupl.error);

  const g = await api('POST','/api/guest',{gender:'female'});
  console.log('Guest:', g.user ? g.user.username+' is_guest='+g.user.is_guest : 'FAIL '+JSON.stringify(g));

  const login = await api('POST','/api/login',{usernameOrEmail:'player_one',password:'pass1234'});
  console.log('Login:', login.user ? 'ok as '+login.user.username : 'FAIL '+JSON.stringify(login));

  const add = await api('POST','/api/friends/add',{friendUsername:'player_one'}, b.token);
  console.log('B adds A:', add.ok ? 'ok' : JSON.stringify(add));

  const fl = await api('GET','/api/friends',null, a.token);
  console.log('A friends:', fl.friends ? fl.friends.map(f=>f.username+':'+f.status).join(', ') : JSON.stringify(fl));

  const sr = await api('GET','/api/users/search?q=player',null, a.token);
  console.log('Search count:', sr.results ? sr.results.length : JSON.stringify(sr));

  const sc = await api('POST','/api/score',{total_score:15,games_won:3}, a.token);
  console.log('Score:', sc.total_score+' / '+sc.games_won);

  const me = await api('GET','/api/me',null, a.token);
  console.log('Me:', me.user ? me.user.username+' score='+me.score.total_score : JSON.stringify(me));

  srv.kill();
  console.log('DONE');
  process.exit(0);
})();
