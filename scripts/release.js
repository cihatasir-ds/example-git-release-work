#!/usr/bin/env node
const { execSync } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');
const { join } = require('path');

const COMMIT_REGEX = /^(feat|fix|hotfix|chore|refactor)\(([A-Za-z]+-\d+)\):\s*(.+)$/;

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
}

function getLastTag() {
  try {
    return run('git describe --tags --abbrev=0');
  } catch (err) {
    return null;
  }
}

function parseCommits(fromTag) {
  const range = fromTag ? `${fromTag}..HEAD` : 'HEAD';
  const output = run(`git log ${range} --pretty=format:%s`);
  if (!output) return [];

  return output.split('\n').map((line) => {
    const match = line.match(COMMIT_REGEX);
    if (!match) return null;
    const [, type, ticket, summary] = match;
    return { type, ticket, summary, raw: line };
  }).filter(Boolean);
}

function bumpVersion(current, hasHotfix) {
  const [major, minor, patch] = current.replace(/^v/, '').split('.').map(Number);
  if (hasHotfix) {
    return `v${major}.${minor}.${patch + 1}`;
  }
  return `v${major}.${minor + 1}.0`;
}

function groupCommits(commits) {
  return commits.reduce((acc, commit) => {
    acc[commit.type] = acc[commit.type] || [];
    acc[commit.type].push(commit);
    return acc;
  }, {});
}

function formatSection(title, commits) {
  if (!commits || commits.length === 0) {
    return `## ${title}\n- (none)\n`;
  }

  const lines = commits.map((c) => `- ${c.raw} – ${c.summary}`);
  return `## ${title}\n${lines.join('\n')}\n`;
}

function writeReleaseNotes(version, grouped) {
  const today = new Date();
  const date = today.toISOString().slice(0, 10);
  const content = [
    `# ${version} – ${date}`,
    '',
    formatSection('🚀 Features', grouped.feat),
    formatSection('🐛 Fixes', grouped.fix),
    formatSection('🔥 Hotfixes', grouped.hotfix),
    formatSection('🛠 Chores / Refactors', [...(grouped.chore || []), ...(grouped.refactor || [])]),
  ].join('\n');

  const dir = join(process.cwd(), 'releases');
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, `${version}.md`);
  writeFileSync(filePath, content, 'utf8');
  
  return filePath;
}

function main() {
  const lastTag = getLastTag();
  const commits = parseCommits(lastTag);

  if (commits.length === 0) {
    console.log('No commits found since last tag. Aborting.');
    process.exit(1);
  }

  const hasHotfix = commits.some((c) => c.type === 'hotfix');
  const nextVersion = bumpVersion(lastTag || 'v1.0.0', hasHotfix);
  const grouped = groupCommits(commits);
  const notesPath = writeReleaseNotes(nextVersion, grouped);

  run(`git tag -a ${nextVersion} -m "Release ${nextVersion}"`);
  console.log(`Created release notes: ${notesPath}`);
  console.log(`Tagged new version: ${nextVersion}`);
}

main();
