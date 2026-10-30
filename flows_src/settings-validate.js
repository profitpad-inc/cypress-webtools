// settings: checks the POST body (pause, resume, skip-if-owned) and passes it on base64-encoded.
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const fail = (statusCode, error) => ({ ok: false, statusCode, body: { error } });
const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

function validate(body) {
  const b = body && typeof body === 'object' ? body : {};
  const payload = {};
  if ('paused' in b) payload.paused = b.paused === true;
  if ('paused_until' in b) {
    if (b.paused_until === '' || b.paused_until === null) {
      payload.paused_until = '';
    } else {
      const t = Date.parse(b.paused_until);
      if (!Number.isFinite(t)) return fail(400, "That pause end date isn't a valid date.");
      payload.paused_until = new Date(t).toISOString();
    }
  }
  if ('pause_reason' in b) payload.pause_reason = clean(b.pause_reason);
  if ('skip_if_owned' in b) payload.skip_if_owned = b.skip_if_owned === true;
  if (!Object.keys(payload).length) return fail(400, 'Nothing to change.');
  return { ok: true, payload };
}

const result = validate($input.first().json.body);
if (!result.ok) return result;
return { "ok": true, "p": encode(result.payload) };
