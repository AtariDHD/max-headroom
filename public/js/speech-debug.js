import {
  buildCleanWordTimeline,
  buildStutterSchedule,
  buildStutterScheduleFromAlignment,
  stripStutterForSpeech,
} from "./max-chat.js";

/** Enable with ?debug=speech — logs timing to the console (no audio recording). */
export function initSpeechDebug() {
  if (new URLSearchParams(location.search).get("debug") !== "speech") return;

  const logs = [];
  const api = {
    logs,
    log(type, data) {
      const entry = { t: performance.now(), type, ...data };
      logs.push(entry);
      console.log(`[max speech] ${type}`, data);
    },
    dump() {
      console.table(logs);
      return logs;
    },
    lastPlayback: null,
  };

  window.__maxSpeechDebug = api;
  console.info(
    "[max speech] Debug on. After Max speaks, run __maxSpeechDebug.dump() to inspect stutter timing."
  );

  return {
    onSpeakStart({ rawText, alignment, durationMs }) {
      const cleanText = stripStutterForSpeech(rawText);
      const stutters =
        buildStutterScheduleFromAlignment(rawText, alignment) ??
        buildStutterSchedule(rawText, durationMs);
      const spoken = alignment?.characters?.join("") ?? cleanText;
      const words = alignment
        ? buildCleanWordTimeline(
            cleanText,
            spoken,
            alignment.character_start_times_seconds,
            alignment.character_end_times_seconds
          )
        : [];

      api.lastPlayback = { rawText, cleanText, stutters, words, durationMs };
      api.log("speak-start", { cleanText, durationMs, stutterCount: stutters.length });
      if (words.length) console.table(words);
      if (stutters.length) console.table(stutters);
    },
  };
}
