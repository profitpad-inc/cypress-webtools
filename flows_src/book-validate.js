// book: the universal booking link. Reads ?email= (or ?cid=, a HubSpot contact id) and passes them on base64-encoded.
const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const q = $input.first().json.query || {};
let email = String(q.email || q.e || '').trim().toLowerCase().slice(0, 200);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = '';
const cid = /^\d{1,20}$/.test(String(q.cid || '')) ? String(q.cid) : '';
return { "email": email, "cid": cid, "hasContact": !!(email || cid), "p": encode({ email }) };
