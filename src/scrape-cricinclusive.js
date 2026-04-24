#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_WAIT_MS = 8000;
const BLOCKED_RESOURCE_PATTERN =
  /googleads|doubleclick|googlesyndication|recaptcha|fundingchoices|gstatic|google\.com\/recaptcha/i;

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "cricinclusive-page";
}

function csvEscape(value) {
  const stringValue = value == null ? "" : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function toCsv(rows) {
  if (!rows.length) {
    return "";
  }

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ];

  return `${lines.join("\n")}\n`;
}

function tableRowsToObjects(headers, rows) {
  return rows.map((row) => {
    const entry = {};
    headers.forEach((header, index) => {
      const key = header || `column_${index + 1}`;
      entry[key] = row[index] ?? "";
    });
    return entry;
  });
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeCsv(filePath, rows) {
  await fs.writeFile(filePath, toCsv(rows), "utf8");
}

async function extractStaticData(page) {
  return page.evaluate(() => {
    const normalize = (value) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const tableNamesByIndex = [
      "royal_challengers_bengaluru_squad",
      "gujarat_titans_squad",
      "player_match_up",
      "player_stats",
      "player_last_match_current_selection",
    ];

    const tables = [...document.querySelectorAll("table")].map((table, index) => {
      const headers = [...table.querySelectorAll("thead th, tr th")]
        .map((cell) => normalize(cell.innerText || cell.textContent))
        .filter(Boolean);
      const rows = [...table.querySelectorAll("tbody tr, tr")]
        .map((row) =>
          [...row.querySelectorAll("td")].map((cell) =>
            normalize(cell.innerText || cell.textContent),
          ),
        )
        .filter((row) => row.length);

      return {
        index,
        name: tableNamesByIndex[index] || `table_${index}`,
        headers,
        rows,
      };
    });

    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .map((heading, index) => ({
        index,
        tag: heading.tagName.toLowerCase(),
        text: normalize(heading.innerText || heading.textContent),
      }))
      .filter((heading) => heading.text);

    const selects = [...document.querySelectorAll("select")].map((select, index) => ({
      index,
      id: select.id || "",
      value: select.value || "",
      options: [...select.options].map((option) => ({
        text: normalize(option.textContent),
        value: option.value,
      })),
    }));

    return {
      title: document.title,
      bodyText: normalize(document.body.innerText || document.body.textContent),
      headings,
      selects,
      tables,
    };
  });
}

async function extractPlayerLastMatches(page) {
  const playerSelect = page.locator("select").nth(6);
  const table = page.locator("table").nth(4);

  const options = await playerSelect.locator("option").evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        text: String(node.textContent || "").replace(/\s+/g, " ").trim(),
        value: node.value,
      }))
      .filter((option) => option.value && option.value !== "download"),
  );

  const headers = await table
    .locator("thead th, tr th")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
    );

  const allRows = [];

  for (const option of options) {
    await playerSelect.selectOption(option.value);
    await page.waitForTimeout(500);

    const rows = await table.locator("tbody tr").evaluateAll((nodes) =>
      nodes.map((row) =>
        [...row.querySelectorAll("td")].map((cell) =>
          String(cell.textContent || "").replace(/\s+/g, " ").trim(),
        ),
      ),
    );

    for (const row of tableRowsToObjects(headers, rows)) {
      allRows.push({
        selected_player: option.value,
        ...row,
      });
    }
  }

  return {
    headers: ["selected_player", ...headers],
    rows: allRows,
    players: options.map((option) => option.value),
  };
}

async function scrapePage(url, outputRoot) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 2200 },
  });

  await page.route(BLOCKED_RESOURCE_PATTERN, (route) => route.abort()).catch(() => {});

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(DEFAULT_WAIT_MS);

  const staticData = await extractStaticData(page);
  const pageHtml = await page.content();
  const playerLastMatches = await extractPlayerLastMatches(page);

  await browser.close();

  const tableObjects = {};
  for (const table of staticData.tables) {
    tableObjects[table.name] = tableRowsToObjects(table.headers, table.rows);
  }

  const scrapedAt = new Date().toISOString();
  const pageSlug = slugify(
    `${staticData.headings[0]?.text || staticData.title}-${new URL(url).pathname.split("/").pop()}`,
  );
  const outputDir = path.join(outputRoot, pageSlug);
  await ensureDir(outputDir);

  const snapshot = {
    url,
    scrapedAt,
    title: staticData.title,
    headings: staticData.headings,
    selects: staticData.selects,
    tables: staticData.tables,
    playerLastMatches,
    rawText: staticData.bodyText,
  };

  await writeJson(path.join(outputDir, "page_snapshot.json"), snapshot);
  await fs.writeFile(path.join(outputDir, "page_snapshot.html"), pageHtml, "utf8");
  await fs.writeFile(path.join(outputDir, "page_text.txt"), `${staticData.bodyText}\n`, "utf8");

  for (const [name, rows] of Object.entries(tableObjects)) {
    await writeJson(path.join(outputDir, `${name}.json`), rows);
    await writeCsv(path.join(outputDir, `${name}.csv`), rows);
  }

  await writeJson(
    path.join(outputDir, "player_last_match_all_players.json"),
    playerLastMatches.rows,
  );
  await writeCsv(
    path.join(outputDir, "player_last_match_all_players.csv"),
    playerLastMatches.rows,
  );

  return {
    outputDir,
    pageSlug,
    title: staticData.title,
    tables: staticData.tables.map((table) => ({
      name: table.name,
      rowCount: table.rows.length,
    })),
    playerLastMatchRows: playerLastMatches.rows.length,
    playerCount: playerLastMatches.players.length,
  };
}

async function main() {
  const url = process.argv[2];
  const outputRoot = path.resolve(process.argv[3] || "output");

  if (!url) {
    console.error("Usage: node src/scrape-cricinclusive.js <url> [output-dir]");
    process.exit(1);
  }

  const result = await scrapePage(url, outputRoot);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
