const {
  aggregateEntries,
  getRoom,
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
  "いる",
  "ある",
  "ない",
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
  "利用者",
  "介護職",
].sort((a, b) => b.length - a.length);

function collectDomainTokens(source) {
  const occupied = new Array(source.length).fill(false);
  const tokens = [];

  for (const term of DOMAIN_TERMS) {
    let start = source.indexOf(term);

    while (start !== -1) {
      const end = start + term.length;
      const overlaps = occupied.slice(start, end).some(Boolean);

      if (!overlaps) {
        tokens.push(term);
        for (let index = start; index < end; index += 1) {
          occupied[index] = true;
        }
      }

      start = source.indexOf(term, start + 1);
    }
  }

  return tokens;
}

function isPartOfDomainToken(segment, domainTokens) {
  return domainTokens.some((token) => token !== segment && token.includes(segment));
}

function tokenizeText(text) {
  const source = String(text || "").trim();
  if (!source) {
    return [];
  }

  const domainTokens = collectDomainTokens(source);
  const segments =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? [...new Intl.Segmenter("ja", { granularity: "word" }).segment(source)]
          .filter((segment) => segment.isWordLike !== false)
          .map((segment) => segment.segment)
      : source.split(/[\s、。,.!?！？「」『』（）()[\]{}・:;]+/);

  const segmentTokens = segments
    .map((segment) => segment.trim().replace(/^[\s、。,.!?！？「」『』（）()[\]{}・:;]+|[\s、。,.!?！？「」『』（）()[\]{}・:;]+$/g, ""))
    .map((segment) => (/^[a-zA-Z0-9]+$/.test(segment) ? segment.toLowerCase() : segment))
    .filter((segment) => segment.length >= 2)
    .filter((segment) => !/^\d+$/.test(segment))
    .filter((segment) => !STOP_WORDS.has(segment))
    .filter((segment) => !isPartOfDomainToken(segment, domainTokens));

  return [...domainTokens, ...segmentTokens];
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

module.exports = async (req, res) => {
  try {
    const room = getRoom(req);
    const mode = normalizeMode(req.query.mode);

    if (req.method === "GET") {
      const entries = await listEntries(room);
      res.status(200).json({
        room,
        mode,
        words: mode === "tokens" ? aggregateTokens(entries) : aggregateEntries(entries),
      });
      return;
    }

    if (req.method === "POST") {
      const normalized = String(req.body?.word || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 120);

      if (!normalized) {
        res.status(400).json({ error: "Word is required." });
        return;
      }

      await insertEntry(room, normalized);
      const entries = await listEntries(room);
      res.status(200).json({
        ok: true,
        room,
        mode,
        words: mode === "tokens" ? aggregateTokens(entries) : aggregateEntries(entries),
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
