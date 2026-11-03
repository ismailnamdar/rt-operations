const form=document.querySelector('form'),button=form.querySelector('button'),errorBox=document.querySelector('#error');
let submitting=false,configured=true;
fetch('/auth/config',{signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)throw Error('Configuration unavailable');return r.json();}).then(c=>{if(c.provider==='supabase'){configured=!!c.configured;document.querySelector('main > p').textContent=configured?'Sign in with your authorized Supabase account.':'Supabase Auth setup is pending. Configure the project URL and publishable key in Vercel.';button.disabled=submitting||!configured;}}).catch(()=>{errorBox.textContent='Unable to check sign-in availability. You can retry signing in.';});
form.onsubmit=async e=>{
 e.preventDefault();if(submitting||!configured)return;
 const f=new FormData(form);submitting=true;button.disabled=true;button.textContent='Signing in…';button.setAttribute('aria-busy','true');errorBox.textContent='';
 try{
  const res=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.get('email'),password:f.get('password')}),signal:AbortSignal.timeout(20000)});
  let d;try{d=await res.json();}catch{throw Error('The sign-in server returned an unexpected response. Please retry.');}
  if(!res.ok)throw Error(d.error||'Sign-in could not be completed. Please retry.');
  location.replace('/');
 }catch(error){errorBox.textContent=['TimeoutError','AbortError'].includes(error.name)?'Sign-in timed out while waiting for the server. Please retry. If this continues, SHUTTLE’s server/database connection needs attention.':error.message;}
 finally{submitting=false;button.disabled=!configured;button.textContent='Sign in';button.removeAttribute('aria-busy');}
};
