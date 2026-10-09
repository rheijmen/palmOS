/// <reference path="../pb_data/types.d.ts" />

// Agendus sync: one "records" collection holds every synced item (appointments,
// tasks, contacts, memos, categories, preferences) as JSON, one row per item per
// user. Each user can only see and change their own rows. Accounts are created by
// the server owner in the dashboard; public sign-up is switched off.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    // Only superusers create accounts ("me and a few people").
    users.createRule = null;
    users.listRule = "id = @request.auth.id";
    users.viewRule = "id = @request.auth.id";
    users.updateRule = "id = @request.auth.id";
    users.deleteRule = null;
    app.save(users);

    const own = "@request.auth.id != '' && user = @request.auth.id";
    const records = new Collection({
      type: "base",
      name: "records",
      listRule: own,
      viewRule: own,
      // On create and update the row must belong to the signed-in user.
      createRule: "@request.auth.id != '' && @request.body.user = @request.auth.id",
      updateRule: own + " && (@request.body.user:isset = false || @request.body.user = @request.auth.id)",
      deleteRule: own,
      fields: [
        { name: "user", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
        // events | tasks | contacts | memos | categories | settings
        { name: "kind", type: "text", required: true, max: 20 },
        // the item's id in the app
        { name: "rid", type: "text", required: true, max: 64 },
        { name: "data", type: "json", maxSize: 2000000 },
        { name: "deleted", type: "bool" },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_records_item ON records (user, kind, rid)",
        "CREATE INDEX idx_records_changes ON records (user, updated)",
      ],
    });
    app.save(records);

    const settings = app.settings();
    settings.meta.appName = "Agendus Sync";
    // The app uploads changes in batches.
    settings.batch.enabled = true;
    settings.batch.maxRequests = 100;
    // Nightly backup at 03:00, keep two weeks.
    settings.backups.cron = "0 3 * * *";
    settings.backups.cronMaxKeep = 14;
    // Protection against password guessing and floods. The default per-record
    // "create" limit (20 per 5s) would block a first sync, which uploads a whole
    // agenda in batches, so that one is raised.
    settings.rateLimits.enabled = true;
    for (const rule of settings.rateLimits.rules) {
      if (rule.label === "*:create") {
        rule.duration = 60;
        rule.maxRequests = 5000;
      }
    }
    app.save(settings);
  },
  (app) => {
    const records = app.findCollectionByNameOrId("records");
    app.delete(records);
  }
);
