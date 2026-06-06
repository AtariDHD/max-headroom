import {
  buildStutterScheduleFromAlignment,
  buildWordScheduleFromAlignment,
  formatMaxMessage,
  stripStutterForSpeech,
} from "../public/js/max-chat.js";

const raw = process.argv[2] ?? "That's really great, g-g-g-great question!";
const clean = stripStutterForSpeech(raw);
const res = await fetch("http://localhost:3000/api/speech", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: clean }),
});
const data = await res.json();
const spoken = data.alignment.characters.join("");
const norm = data.normalized_alignment.characters.join("");

console.log("raw:", raw);
console.log("clean:", clean);
console.log("spoken===clean:", spoken === clean);
console.log("spoken:", spoken);
console.log("norm:", JSON.stringify(norm));

const pick = spoken === clean ? data.alignment : data.normalized_alignment;
const events = buildStutterScheduleFromAlignment(raw, pick);
console.log("stutter events:", events);

import { buildCleanWordTimeline } from "../public/js/max-chat.js";
const timeline = buildCleanWordTimeline(
  clean,
  spoken,
  pick.character_start_times_seconds,
  pick.character_end_times_seconds
);
console.log("\nword durations (s):");
for (const w of timeline) {
  console.log(`  "${w.word}"  start=${w.atSec?.toFixed(3)} end=${w.endSec?.toFixed(3)} dur=${(w.endSec - w.atSec).toFixed(3)}`);
}

console.log("\nword highlight schedule (display order):");
const wordSchedule = buildWordScheduleFromAlignment(raw, pick);
const displayWords = (formatMaxMessage(raw).match(/data-w="\d+">([^<]*)</g) || []).map((s) =>
  s.replace(/.*>([^<]*)<.*/, "$1")
);
let prev = -Infinity;
for (const ev of wordSchedule) {
  const flag = ev.atSec < prev ? "  <-- NON-MONOTONIC" : "";
  console.log(`  w${ev.wordIndex} "${displayWords[ev.wordIndex] ?? "?"}"  atSec=${ev.atSec?.toFixed(3)}${flag}`);
  prev = ev.atSec;
}
