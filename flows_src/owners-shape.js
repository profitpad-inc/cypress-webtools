// owners: HubSpot owners for the "add rep" search and for showing names in the report.
const items = $input.all().map((item) => item.json);
const failed = items.find((j) => j.error);
if (failed) {
  return { "statusCode": 502, "body": { "error": 'HubSpot owners could not be read: ' + String(failed.error?.message || failed.error).slice(0, 200) } };
}
const list = items.flatMap((j) => (Array.isArray(j.results) ? j.results : [j]));
const owners = list
  .filter((o) => o && o.id && !o.archived)
  .map((o) => ({
    id: String(o.id),
    userId: o.userId ? String(o.userId) : '',
    name: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || String(o.id),
    email: o.email || '',
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
return { "statusCode": 200, "body": { "owners": owners } };
