// rep / settings: answers with the fresh state, or the error from saving.
const saved = $('Save').first().json;
const loaded = $input.first().json;
if (saved.error) {
  return { "statusCode": 500, "body": { "error": 'Could not save: ' + String(saved.error?.message || saved.error).slice(0, 200) } };
}
const action = $('Validate').first().json.action;
if (action === 'add' && Number(saved.added) === 0) {
  return { "statusCode": 409, "body": { "error": 'That owner is already in the list.', ...(loaded.body || {}) } };
}
if (!loaded.body) {
  return { "statusCode": 500, "body": { "error": 'Saved, but the new state could not be read.' } };
}
return { "statusCode": 200, "body": loaded.body };
