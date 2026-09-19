// [36] One item per verified source to create. Rejected candidates never reach this node and never
// reach the database — the only trace they leave is a line in the report.
const d = $input.first().json;
const rows = d.source_rows || [];

if (rows.length === 0) {
  // Nothing passed, but the branch must continue: the checkbox still has to be cleared, or discovery
  // would fire again in fifteen minutes, and again, and again.
  return [{ json: { nothing_to_create: true } }];
}

return rows.map((r) => ({ json: r }));
