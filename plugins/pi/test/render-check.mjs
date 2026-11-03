// Render the yapping view outside pi (against the live relay) and check every
// line is exactly the terminal width. Prints the screen as plain text.
//
//   node plugins/pi/test/render-check.mjs [cols] [rows] [chat]
//
// Resolves pi's bundled modules from the global install (bun or npm).

import { execSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const piBin = realpathSync(execSync("command -v pi || which pi", { shell: "/bin/bash" }).toString().trim().split("\n").pop());
let root = dirname(piBin);
while (!existsSync(join(root, "node_modules", "@earendil-works", "pi-tui")) && root !== "/") root = dirname(root);
const nm = join(root, "node_modules");
const { createJiti } = await import(join(nm, "jiti", "lib", "jiti.mjs"));
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-tui": join(nm, "@earendil-works", "pi-tui"),
		"@earendil-works/pi-coding-agent": join(nm, "@earendil-works", "pi-coding-agent"),
		typebox: join(nm, "typebox"),
	},
});

const cols = Number(process.argv[2] || 160);
const rows = Number(process.argv[3] || 46);
const chat = process.argv[4];
const { YapClient, loadSim } = await jiti.import(join(here, "..", "client.ts"));
const { YapView } = await jiti.import(join(here, "..", "view.ts"));
const { visibleWidth } = await jiti.import("@earendil-works/pi-tui");

const sim = await loadSim();
const yap = new YapClient({ relay: process.env.YAP_RELAY || "http://localhost:7788", user: process.env.YAP_USER || "luqmaan", client: "pi" }, sim);
yap.state = await yap.snapshot();
yap.mode = "live";
yap.send = () => {}; // read-only check: never write to the relay
const tui = { terminal: { rows, columns: cols }, requestRender() {} };
const view = new YapView(tui, yap, { initialChat: chat, onClose() {} });
view.focused = true;
const lines = view.render(cols);
view.dispose();
let bad = 0;
lines.forEach((l, i) => {
	const w = visibleWidth(l);
	if (w !== cols) {
		bad++;
		console.error(`row ${i}: width ${w} != ${cols}`);
	}
});
const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b_[^\x07\x1b]*(\x07|\x1b\\)/g, ""));
console.log(plain.join("\n"));
console.error(`${lines.length} rows, ${bad} with wrong width`);
process.exit(bad ? 1 : 0);
