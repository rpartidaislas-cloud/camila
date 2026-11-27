import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const src = fs.readFileSync(new URL("../supabase/functions/lana-inbox/index.ts", import.meta.url), "utf8");
const bundle = fs.readFileSync(new URL("../docs/bundles/lana-inbox.single-file.ts", import.meta.url), "utf8");

test("la lista de chats marca can_operate desde SMYL cuando LANA no lo manda, después de filtrar por acceso", () => {
  const filter = src.indexOf("if (!visible.has(id) ||");
  const mark = src.indexOf('if (typeof conversation.can_operate !== "boolean") conversation.can_operate = true;');
  assert.ok(filter > 0 && mark > filter, "debe marcarse solo tras el filtro de acceso");
  assert.match(bundle, /typeof conversation\.can_operate !== "boolean"/);
});
