// Refreshes the automatic sections of README.md from the data behind
// jovian-explorer.github.io (assets/js/data.js and the monthly feed files).
// Each section sits between <!-- auto:NAME --> and <!-- /auto:NAME -->;
// everything outside those markers is edited by hand.
//
// Usage: node tools/update_readme.mjs            (fetches from GitHub)
//        SITE_DIR=../jovian-explorer.github.io node tools/update_readme.mjs

import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const RAW = "https://raw.githubusercontent.com/jovian-explorer/jovian-explorer.github.io/main/";
const SITE = "https://jovian-explorer.github.io/";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function read(file) {
  if (process.env.SITE_DIR) return fs.readFileSync(path.join(process.env.SITE_DIR, file), "utf8");
  const res = await fetch(RAW + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.text();
}

// Run the site's data files the way the browser does and collect window.*
const window = {};
const ctx = vm.createContext({ window });
for (const f of ["data", "feed-works", "feed-metrics", "feed-videos", "feed-articles"]) {
  vm.runInContext(await read(`assets/js/${f}.js`), ctx, { filename: f });
}
const outreach = await read("outreach.html");

const S = window.SITE;
const pubs = S.publications || [];
const confs = S.conferences || [];

// Same merge as assets/js/site.js: ORCID works missing from data.js are added.
const norm = (t) => String(t || "").toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "");
const PUBTYPE = { "journal-article": "journal", "book-chapter": "chapter", "conference-paper": "proceedings", "preprint": "preprint", "working-paper": "preprint", "report": "whitepaper" };
const TALK = { "conference-poster": "Poster", "conference-abstract": "Talk", "conference-presentation": "Talk", "lecture-speech": "Talk", "conference-output": "Talk" };
const seen = new Set();
pubs.forEach((p) => { if (p.doi) seen.add(p.doi.toLowerCase()); if (p.arxiv) seen.add(p.arxiv); seen.add(norm(p.title)); });
confs.forEach((c) => seen.add("talk:" + norm(c.title)));
const exclude = new Set((S.excludeWorks || []).map((x) => String(x).toLowerCase()));
for (const w of (window.WORKS || {}).items || []) {
  if (exclude.has((w.doi || "").toLowerCase()) || exclude.has((w.arxiv || "").toLowerCase())) continue;
  const arx = w.arxiv || ((w.doi || "").match(/^10\.48550\/arxiv\.(.+)$/) || [])[1];
  const ym = w.year ? w.year + (w.month ? "-" + String(w.month).padStart(2, "0") : "") : "";
  if (PUBTYPE[w.type]) {
    if ((w.doi && seen.has(w.doi)) || (arx && seen.has(arx)) || seen.has(norm(w.title))) continue;
    seen.add(norm(w.title));
    pubs.push({ role: /^Aggarwal,/.test(w.authors || "") ? "first" : "co", kind: PUBTYPE[w.type], year: w.year || "", month: w.month, title: w.title, venue: w.venue || "", doi: w.doi, url: w.url });
  } else if (TALK[w.type] && ym && !seen.has("talk:" + norm(w.title))) {
    confs.push({ date: ym, kind: TALK[w.type], event: w.venue || "Conference", place: "", title: w.title });
  }
}

const monthYear = (d) => { const [y, m] = String(d || "").split("-"); return m ? `${MONTHS[+m - 1]} ${y}` : y || ""; };
const fmt = (n) => Number(n).toLocaleString("en-US");
const esc = (s) => String(s || "").replace(/\|/g, "\\|").replace(/<[^>]+>/g, "");
const SHORT = {
  "Monthly Notices of the Royal Astronomical Society": "MNRAS",
  "The Astrophysical Journal": "ApJ",
  "The Astrophysical Journal Letters": "ApJL",
  "Journal of Geophysical Research: Planets": "JGR: Planets",
  "Journal of Geophysical Research: Space Weather": "JGR: Space Weather",
};
const venue = (v) => SHORT[v] || v;
const link = (p) => (p.doi ? `https://doi.org/${p.doi}` : p.url || `${SITE}publications.html`);

// ---- metrics
const M = window.METRICS || {};
// Same rule as the site: the Google Scholar count wins; data.js is only a fallback.
const citations = +M.citations || +(S.metrics || {}).citations || 0;
const hIndex = M.h_index || "";
const firstJournal = pubs.filter((p) => p.role === "first" && p.kind === "journal");
const firstAll = pubs.filter((p) => p.role === "first");
const outreachVideos = (outreach.match(/id="stat-videos">(\d+)/) || [])[1] || "";

const blocks = {};

blocks["scholar-badge"] =
  `<a href="https://scholar.google.com/citations?user=KO8MtmEAAAAJ"><img alt="Google Scholar: ${fmt(citations)} citations" src="https://img.shields.io/badge/Google_Scholar-${encodeURIComponent(fmt(citations))}_citations-1f4f7a?style=flat-square&logo=googlescholar&logoColor=white"></a>`;

const cell = (n, label) => `    <td align="center" width="16%"><h3>${n}</h3><sub>${label}</sub></td>`;
blocks.glance = [
  "<table>",
  "  <tr>",
  cell(fmt(citations), "citations"),
  cell(hIndex, "h-index"),
  cell(pubs.length, "publications"),
  cell(firstAll.length, "first-author papers"),
  cell(confs.length, "talks &amp; posters"),
  cell(outreachVideos, "outreach videos"),
  "  </tr>",
  "</table>",
].join("\n");

const byDate = (a, b) => (+b.year || 0) - (+a.year || 0) || (+b.month || 0) - (+a.month || 0);
blocks.papers = [...firstJournal]
  .sort(byDate)
  .slice(0, 6)
  .map((p) => `- **${p.title}**, *${venue(p.venue)}* (${p.year}). [doi](${link(p)})`)
  .join("\n");

blocks.talks = [
  "| When | Event | Where |",
  "|:--|:--|:--|",
  ...[...confs]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 6)
    .map((c) => {
      const icon = c.kind === "Poster" ? "🖼️" : "🎤";
      const award = c.award ? ` · *${c.award}*` : "";
      const place = (c.place || "").split(",").filter((s) => s.trim() !== "India").map((s) => s.trim()).slice(-2).join(", ");
      return `| ${monthYear(c.date)} | ${icon} ${esc(c.event)}${award} | ${esc(place)} |`;
    }),
].join("\n");

const videos = ((window.VIDEOS || {}).videos || []).filter((v) => v.id && !v.hidden).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
const articles = ((window.ARTICLES || {}).items || []).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
blocks.latest = [
  "| 📺 Latest videos | ✍️ Latest articles |",
  "|:--|:--|",
  ...Array.from({ length: Math.max(videos.length, articles.length) }, (_, i) => {
    const v = videos[i], a = articles[i];
    const vc = v ? `[${esc(v.title)}](https://www.youtube.com/watch?v=${v.id}) <sub>${monthYear(v.date.slice(0, 7))}</sub>` : "";
    const ac = a ? `[${esc(a.title)}](${a.url || a.link}) <sub>${monthYear(a.date.slice(0, 7))}</sub>` : "";
    return `| ${vc} | ${ac} |`;
  }),
].join("\n");

blocks.updated = `<sub>Numbers and lists refresh weekly from <a href="${SITE}">jovian-explorer.github.io</a>. Citations from Google Scholar, ${monthYear((M.updated || "").slice(0, 7))}.</sub>`;

// ---- write
const file = new URL("../README.md", import.meta.url);
let md = fs.readFileSync(file, "utf8");
for (const [name, body] of Object.entries(blocks)) {
  const re = new RegExp(`(<!-- auto:${name} -->)[\\s\\S]*?(<!-- /auto:${name} -->)`);
  if (!re.test(md)) throw new Error(`README.md has no auto:${name} markers`);
  md = md.replace(re, `$1\n${body}\n$2`);
}
fs.writeFileSync(file, md);
console.log(`README.md: ${fmt(citations)} citations, h ${hIndex}, ${pubs.length} publications, ${confs.length} talks`);
