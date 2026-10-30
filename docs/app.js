// Shared helpers for the Cypress lead assignment pages. No build step; plain browser JavaScript.
(function () {
  var API_BASE = 'https://n8n.profitpad.com/webhook/cypress-webtools';
  var PORTAL_ID = '22691627';

  function api(method, path, body) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(API_BASE + '/' + path, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: 'Unexpected answer from the server.' }; }
        if (!res.ok) {
          var err = new Error(data.error || ('Request failed (' + res.status + ')'));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso, opts) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    return fmtDate(iso, { month: 'short', day: 'numeric' }) + ', ' + fmtTime(iso);
  }
  function ago(iso) {
    if (!iso) return 'never';
    var s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return fmtDateTime(iso);
  }

  // YYYY-MM-DD in the viewer's own time zone
  function dayString(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function parseDay(s) {
    var p = s.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function addDays(s, n) {
    var d = parseDay(s);
    d.setDate(d.getDate() + n);
    return dayString(d);
  }
  function timeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto'; } catch (e) { return 'America/Toronto'; }
  }

  function contactUrl(id) {
    return 'https://app.hubspot.com/contacts/' + PORTAL_ID + '/record/0-1/' + encodeURIComponent(id);
  }

  // ── rotation (mirrors the rr-assign Plan node) ──────────────────────────
  function isAway(rep, now) {
    var until = rep.away_until ? Date.parse(rep.away_until) : 0;
    var from = rep.away_from ? Date.parse(rep.away_from) : 0;
    return until > now && (!from || from <= now);
  }
  function awayLater(rep, now) {
    return rep.away_from && Date.parse(rep.away_from) > now && rep.away_until && Date.parse(rep.away_until) > now;
  }
  function isPaused(settings, now) {
    return !!(settings && settings.paused && (!settings.paused_until || Date.parse(settings.paused_until) > now));
  }
  function rotation(reps) {
    return reps.filter(function (r) { return r.enabled; })
      .sort(function (a, b) { return a.position - b.position || a.id - b.id; });
  }
  function nextUp(reps, settings) {
    var rot = rotation(reps);
    if (!rot.length) return null;
    var now = Date.now();
    var start = -1;
    for (var i = 0; i < rot.length; i++) if (rot[i].id === settings.last_rep_id) start = i;
    if (start < 0 && settings.last_position != null) {
      var next = -1;
      for (var j = 0; j < rot.length; j++) if (next < 0 && rot[j].position > settings.last_position) next = j;
      start = next >= 0 ? next - 1 : rot.length - 1;
    }
    for (var step = 1; step <= rot.length; step++) {
      var rep = rot[(start + step + rot.length) % rot.length];
      if (!isAway(rep, now)) return rep;
    }
    return null;
  }

  // ── owners (names for ids), cached for the session ─────────────────────
  var ownersPromise = null;
  function owners() {
    if (!ownersPromise) {
      var cached = null;
      try { cached = JSON.parse(sessionStorage.getItem('cw_owners') || 'null'); } catch (e) { cached = null; }
      if (cached && cached.at > Date.now() - 10 * 60 * 1000) {
        ownersPromise = Promise.resolve(cached.owners);
      } else {
        ownersPromise = api('GET', 'owners').then(function (d) {
          try { sessionStorage.setItem('cw_owners', JSON.stringify({ at: Date.now(), owners: d.owners })); } catch (e) { /* private mode */ }
          return d.owners;
        }).catch(function (e) { ownersPromise = null; throw e; });
      }
    }
    return ownersPromise;
  }
  function ownerNamer(ownerList, reps) {
    var byId = {}, byUser = {};
    (ownerList || []).forEach(function (o) { byId[o.id] = o.name; if (o.userId) byUser[o.userId] = o.name; });
    (reps || []).forEach(function (r) { if (!byId[r.hs_owner_id]) byId[r.hs_owner_id] = r.name; });
    return {
      owner: function (id) { return id ? (byId[id] || ('Owner ' + id)) : 'No owner'; },
      user: function (id) { return id ? (byUser[id] || ('User ' + id)) : ''; },
    };
  }

  // how an owner change happened, from HubSpot's property history
  function sourceText(o, namer) {
    var label = o.source_label || '';
    var id = o.source_id || '';
    var who = o.changed_by_user_id ? namer.user(o.changed_by_user_id) : '';
    var hint = (label + ' ' + id).toLowerCase();
    if (hint.indexOf('calendly') >= 0) return 'Calendly' + (who ? ' (' + who + ')' : '');
    switch (o.source_type) {
      case 'CRM_UI': return who ? who + ' in HubSpot' : 'Someone in HubSpot';
      case 'INTEGRATION': return (label || 'An integration') + (id && !label ? ' (app ' + id + ')' : '');
      case 'AUTOMATION_PLATFORM': return 'A HubSpot workflow' + (label ? ' (' + label + ')' : '');
      case 'API': return 'The API' + (label ? ' (' + label + ')' : id ? ' (' + id + ')' : '');
      case 'IMPORT': return 'An import';
      case 'MEETINGS': return 'HubSpot meetings' + (who ? ' (' + who + ')' : '');
      case 'SALES': return 'HubSpot Sales' + (who ? ' (' + who + ')' : '');
      default:
        return [o.source_type ? o.source_type.toLowerCase().replace(/_/g, ' ') : 'Unknown source', label, who].filter(Boolean).join(', ');
    }
  }

  var toastTimer = null;
  function toast(msg, bad) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast' + (bad ? ' bad' : ''); }, bad ? 5000 : 2500);
  }

  window.CW = {
    api: api, esc: esc, fmtDate: fmtDate, fmtTime: fmtTime, fmtDateTime: fmtDateTime, ago: ago,
    dayString: dayString, parseDay: parseDay, addDays: addDays, timeZone: timeZone, contactUrl: contactUrl,
    isAway: isAway, awayLater: awayLater, isPaused: isPaused, rotation: rotation, nextUp: nextUp,
    owners: owners, ownerNamer: ownerNamer, sourceText: sourceText, toast: toast,
  };
})();
