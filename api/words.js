const {
  getRoom,
  getRoomState,
  insertEntry,
  listEntries,
  normalizeMode,
} = require("./_supabase");

const STOP_WORDS = new Set([
  "こと",
  "これ",
  "それ",
  "あれ",
  "ため",
  "よう",
  "さん",
  "です",
  "ます",
  "した",
  "して",
  "する",
  "なる",
  "いる",
  "ある",
  "ない",
  "しない",
  "たい",
  "れる",
  "られる",
  "せる",
  "させる",
  "できる",
  "すく",
  "やすい",
  "やすく",
  "ほしい",
  "ください",
  "とても",
  "すごく",
  "そして",
  "また",
  "今日",
  "自分",
  "思う",
  "思い",
]);

const DOMAIN_TERMS = [
  "アルゼンチン",
  "イングランド",
  "ポルトガル",
  "リオネル・メッシ",
  "地域包括ケア推進",
  "安全な職場環境",
  "利用者本位",
  "社会的評価",
  "職場環境",
  "人手不足",
  "記録作業",
  "事務作業",
  "処遇改善",
  "家族支援",
  "多職種連携",
  "地域包括ケア",
  "資格取得",
  "夜勤負担",
  "人員配置",
  "介護業界",
  "介護ロボット",
  "テクノロジー",
  "エムバペ",
  "ブラジル",
  "フランス",
  "スペイン",
  "ドイツ",
  "日本",
  "釜本",
  "本田圭佑",
  "利用者",
  "介護職",
  "安心",
  "職場",
].sort((a, b) => b.length - a.length);

function collectDomainMatches(source) {
  const occupied = new Array(source.length).fill(false);
  const tokens = [];
  const ranges = [];

  for (const term of DOMAIN_TERMS) {
    let start = source.indexOf(term);

    while (start !== -1) {
      const end = start + term.length;
      const overlaps = occupied.slice(start, end).some(Boolean);

      if (!overlaps) {
        tokens.push(term);
        ranges.push({ start, end });
        for (let index = start; index < end; index += 1) {
          occupied[index] = true;
        }
      }

      start = source.indexOf(term, start + 1);
    }
  }

  return { tokens, ranges };
}

function overlapsDomainMatch(item, domainMatches) {
  if (item.index < 0) {
    return domainMatches.tokens.some((token) => token !== item.segment && token.includes(item.segment));
  }

  const start = item.index;
  const end = start + item.segment.length;
  return domainMatches.ranges.some((range) => start < range.end && end > range.start);
}

function isTwoCharacterHiragana(segment) {
  return /^[ぁ-ゖ]{2}$/.test(segment);
}

function tokenizeText(text) {
  const source = String(text || "").trim();
  if (!source) {
    return [];
  }

  const domainMatches = collectDomainMatches(source);
  const segments =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? [...new Intl.Segmenter("ja", { granularity: "word" }).segment(source)]
          .filter((segment) => segment.isWordLike !== false)
          .map((segment) => ({ segment: segment.segment, index: segment.index }))
      : source
          .split(/[\s、。,.!?！？「」『』（）()[\]{}・:;]+/)
          .map((segment) => ({ segment, index: -1 }));

  const segmentTokens = segments
    .map((item) => ({
      ...item,
      segment: item.segment.trim().replace(/^[\s、。,.!?！？「」『』（）()[\]{}・:;]+|[\s、。,.!?！？「」『』（）()[\]{}・:;]+$/g, ""),
    }))
    .map((item) => ({
      ...item,
      segment: /^[a-zA-Z0-9]+$/.test(item.segment) ? item.segment.toLowerCase() : item.segment,
    }))
    .filter((item) => item.segment.length >= 2)
    .filter((item) => !/^\d+$/.test(item.segment))
    .filter((item) => !STOP_WORDS.has(item.segment))
    .filter((item) => !isTwoCharacterHiragana(item.segment))
    .filter((item) => !overlapsDomainMatch(item, domainMatches))
    .map((item) => item.segment);

  return [...domainMatches.tokens, ...segmentTokens];
}

function aggregateTokens(entries) {
  const counts = new Map();

  for (const entry of entries) {
    for (const token of tokenizeText(entry.word)) {
      const current = counts.get(token) || 0;
      counts.set(token, current + 1);
    }
  }

  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "ja"));
}

function listRawWords(entries) {
  return entries.map((entry) => ({
    word: entry.word,
    count: 1,
  }));
}

module.exports = async (req, res) => {
  try {
    const room = getRoom(req);
    const mode = normalizeMode(req.query.mode);

    if (req.method === "GET") {
      const state = await getRoomState(room);
      const entries = await listEntries(room, { since: state.resetAt });
      res.status(200).json({
        room,
        mode,
        words: mode === "tokens" ? aggregateTokens(entries) : listRawWords(entries),
      });
      return;
    }

    if (req.method === "POST") {
      const state = await getRoomState(room);
      if (state.accepting === false) {
        res.status(403).json({ error: "This room is not accepting submissions." });
        return;
      }

      const normalized = String(req.body?.word || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 30);

      if (!normalized) {
        res.status(400).json({ error: "Word is required." });
        return;
      }

      await insertEntry(room, normalized);
      const entries = await listEntries(room, { since: state.resetAt });
      res.status(200).json({
        ok: true,
        room,
        mode,
        words: mode === "tokens" ? aggregateTokens(entries) : listRawWords(entries),
      });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: "Request failed.",
      detail: error.message,
    });
  }
};
