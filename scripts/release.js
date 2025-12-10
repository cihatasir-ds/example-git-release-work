#!/usr/bin/env node
const { execSync } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');
const { join } = require('path');

const COMMIT_REGEX = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|hotfix|initial|dependencies|peerDependencies|devDependencies|metadata)(?:\(([^)]*)\))?:\s*(.+)$/;

// Alias mapping: aliases map to their canonical commit types
const COMMIT_TYPE_ALIASES = {
  initial: 'feat',
  dependencies: 'fix',
  peerDependencies: 'fix',
  devDependencies: 'chore',
  metadata: 'fix',
};

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

function tagExists(tag) {
  try {
    run(`git rev-parse -q --verify refs/tags/${tag}`);
    return true;
  } catch (err) {
    return false;
  }
}

function nextAvailableVersion(baseVersion) {
  const [major, minor, patch] = baseVersion.replace(/^v/, '').split('.').map(Number);
  
  for (let candidatePatch = patch; ; candidatePatch += 1) {
    const candidateTag = `v${major}.${minor}.${candidatePatch}`;

    if (!tagExists(candidateTag)) {
      return candidateTag;
    }
  }
}

function getRepoUrl() {
  const remote = run('git config --get remote.origin.url');
  const sshMatch = remote.match(/^git@([^:]+):(.+)$/);

  if (sshMatch) {
    const [, host, path] = sshMatch;
    return `https://${host}/${path.replace(/\\.git$/, '')}`;
  }

  return remote.replace(/\\.git$/, '');
}

function parseCommits(fromTag, repoUrl) {
  const range = fromTag ? `${fromTag}..HEAD` : 'HEAD';
  const output = run(`git log ${range} --pretty=format:"%H|%s"`);

  if (!output) {
    return [];
  };

  return output.split('\n').map((line) => {
    const [hash, subject] = line.split('|', 2);
    const match = subject.match(COMMIT_REGEX);
    
    if (!match) {
      return null;
    };

    const [, type, scope, summary] = match;
    const canonicalType = COMMIT_TYPE_ALIASES[type] || type;
    const ticket = scope && /^[A-Za-z]+-\d+$/.test(scope) ? scope : null;
    const raw = scope ? `${type}(${scope}): ${summary}` : `${type}: ${summary}`;

    return {
      type: canonicalType,
      ticket,
      summary,
      scope,
      hash,
      url: `${repoUrl}/commit/${hash}`,
      raw,
    };
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
    return '';
  };

  const lines = commits.map((c) => `- [${c.raw}](${c.url})`);
  return `## ${title}\n${lines.join('\n')}\n`;
}

function writeReleaseNotes(version, grouped) {
  const today = new Date();
  const date = today.toISOString().slice(0, 10);
  const sections = [
    formatSection('✨ Features', grouped.feat),
    formatSection('🐛 Bug Fixes', grouped.fix),
    formatSection('🔥 Hotfixes', grouped.hotfix),
    formatSection('📚 Documentation', grouped.docs),
    formatSection('💎 Styles', grouped.style),
    formatSection('📦 Code Refactoring', grouped.refactor),
    formatSection('🚀 Performance Improvements', grouped.perf),
    formatSection('🚨 Tests', grouped.test),
    formatSection('🛠 Builds', grouped.build),
    formatSection('⚙️ Continuous Integrations', grouped.ci),
    formatSection('♻️ Chores', grouped.chore),
    formatSection('🗑 Reverts', grouped.revert),
  ].filter(Boolean);

  const content = [
    `# ${version} – ${date}`,
    '',
    ...sections,
  ].join('\n');

  const dir = join(process.cwd(), 'releases');
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, `${version}.md`);
  writeFileSync(filePath, content, 'utf8');
  
  return filePath;
}

function main() {
  const lastTag = getLastTag();
  const repoUrl = getRepoUrl();
  const commits = parseCommits(lastTag, repoUrl);

  if (commits.length === 0) {
    console.log('No commits found since last tag. Aborting.');
    process.exit(1);
  }

  const hasHotfix = commits.some((c) => c.type === 'hotfix');
  const bumpedVersion = bumpVersion(lastTag || 'v1.0.0', hasHotfix);
  const nextVersion = nextAvailableVersion(bumpedVersion);
  const grouped = groupCommits(commits);
  const notesPath = writeReleaseNotes(nextVersion, grouped);

  run(`git tag -a ${nextVersion} -m "Release ${nextVersion}"`);
  console.log(`Created release notes: ${notesPath}`);
  console.log(`Tagged new version: ${nextVersion}`);
}

main();
