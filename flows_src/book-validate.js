// book: the universal booking link. Reads ?email= (or ?cid=, a HubSpot contact id) and passes them on base64-encoded.
const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const q = $input.first().json.query || {};
// '+' in a query string means a space, so czbecher+1@gmail.com arrives as "czbecher 1@gmail.com"; emails can't hold
// spaces, so turn inner spaces back into '+'
let email = String(q.email || q.e || '').trim().replace(/ /g, '+').toLowerCase().slice(0, 200);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = '';
const cid = /^\d{1,20}$/.test(String(q.cid || '')) ? String(q.cid) : '';
// names from the link (?firstname=&lastname=, also firstName / lastName), passed on to the scheduler
const name = (...keys) => {
  const v = keys.map((k) => q[k]).find((x) => x != null && String(x).trim() !== '');
  const s = String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 100);
  return s.includes('{{') ? '' : s; // an unfilled HubSpot token isn't a name
};
const firstname = name('firstname', 'firstName', 'first_name');
const lastname = name('lastname', 'lastName', 'last_name');
return { "email": email, "cid": cid, "firstname": firstname, "lastname": lastname, "hasContact": !!(email || cid), "p": encode({ email }) };
