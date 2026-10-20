'use strict';

// GitHub integration: lets meeting participants browse issues, pull requests and
// commits of linked repositories, share them into the chat and create issues.
// Only repositories listed in GITHUB_REPOS are reachable, so a GITHUB_TOKEN with
// access to private repos never exposes anything that was not linked on purpose.

const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN || '';
const REPOS = (process.env.GITHUB_REPOS || 'wannousibraheem67comjeni/TitanEarthfall')
  .split(',').map((r) => r.trim()).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r));

const cache = new Map(); // url -> { at, data }
const CACHE_MS = 30 * 1000;

function resolveRepo(repo) {
  const want = String(repo || '').toLowerCase();
  const found = REPOS.find((r) => r.toLowerCase() === want);
  if (!found) throw new Error('هذا المستودع غير مربوط بالتطبيق');
  return found;
}

async function gh(path, { method = 'GET', body } = {}) {
  const url = API + path;
  if (method === 'GET') {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  }
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'go-meet' };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const msg = res.status === 403 || res.status === 429 ? 'تم تجاوز حد طلبات GitHub، أضف GITHUB_TOKEN'
      : res.status === 404 ? 'غير موجود أو لا توجد صلاحية' : `GitHub ${res.status}`;
    throw new Error(msg);
  }
  const data = await res.json();
  if (method === 'GET') cache.set(url, { at: Date.now(), data });
  else cache.clear();
  return data;
}

function issueCard(repo, i) {
  const isPr = !!i.pull_request;
  return {
    type: isPr ? 'pull' : 'issue', repo, number: i.number, title: i.title, url: i.html_url,
    state: isPr && i.pull_request.merged_at ? 'merged' : i.state, draft: !!i.draft,
    author: i.user?.login || '', comments: i.comments || 0, updatedAt: i.updated_at,
    labels: (i.labels || []).map((l) => ({ name: l.name, color: l.color })).slice(0, 4),
  };
}

function commitCard(repo, c) {
  return {
    type: 'commit', repo, sha: c.sha, title: (c.commit?.message || '').split('\n')[0], url: c.html_url,
    author: c.author?.login || c.commit?.author?.name || '', updatedAt: c.commit?.author?.date,
  };
}

async function list(repo, kind) {
  const r = resolveRepo(repo);
  if (kind === 'commits') {
    return (await gh(`/repos/${r}/commits?per_page=30`)).map((c) => commitCard(r, c));
  }
  if (kind === 'pulls') {
    const pulls = await gh(`/repos/${r}/pulls?state=all&per_page=30&sort=updated&direction=desc`);
    return pulls.map((p) => issueCard(r, { ...p, pull_request: { merged_at: p.merged_at }, comments: 0 }));
  }
  const issues = await gh(`/repos/${r}/issues?state=all&per_page=30&sort=updated`);
  return issues.filter((i) => !i.pull_request).map((i) => issueCard(r, i));
}

// Builds the card from GitHub itself so shared chat cards can't be forged.
async function card(repo, { type, number, sha }) {
  const r = resolveRepo(repo);
  if (type === 'commit') {
    if (!/^[0-9a-f]{7,40}$/i.test(String(sha))) throw new Error('commit غير صالح');
    return commitCard(r, await gh(`/repos/${r}/commits/${sha}`));
  }
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) throw new Error('رقم غير صالح');
  return issueCard(r, await gh(`/repos/${r}/issues/${n}`));
}

async function createIssue(repo, title, body) {
  const r = resolveRepo(repo);
  if (!TOKEN) throw new Error('إنشاء Issue يحتاج GITHUB_TOKEN على الخادم');
  return issueCard(r, await gh(`/repos/${r}/issues`, { method: 'POST', body: { title, body } }));
}

module.exports = { repos: () => [...REPOS], canWrite: () => !!TOKEN, list, card, createIssue };
