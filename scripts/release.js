#!/usr/bin/env node
const { execSync } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');
const { join } = require('path');

const COMMIT_REGEX = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|hotfix|initial|dependencies|peerDependencies|devDependencies|metadata)(?:\(([^)]*)\))?:\s*(.+)$/;
const JIRA_BASE_URL = process.env.JIRA_BASE_URL || 'https://example.atlassian.net/browse/';

// DELETE THIS SECTION: Remove this constant and all test release functions when v1 goes to production
const isActiveTestRelease = true;

// Alias mapping: aliases map to their canonical commit types
const COMMIT_TYPE_ALIASES = {
  initial: 'feat',
  dependencies: 'fix',
  peerDependencies: 'fix',
  devDependencies: 'chore',
  metadata: 'fix',
};

// ============================================================================
// Common Functions (shared by both test and production releases)
// ============================================================================

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
}

function tagExists(tag) {
  try {
    run(`git rev-parse -q --verify refs/tags/${tag}`);
    return true;
  } catch (err) {
    return false;
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
  }

  return output.split('\n').map((line) => {
    const [hash, subject] = line.split('|', 2);
    const match = subject.match(COMMIT_REGEX);
    
    if (!match) {
      return null;
    }

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
  }

  const lines = commits.map((c) => {
    const jiraLink = c.ticket ? `${JIRA_BASE_URL}${c.ticket}` : null;

    if (jiraLink) {
      return `- [${c.raw}](${c.url}) - [JIRA](${jiraLink})`;
    }

    return `- [${c.raw}](${c.url})`;
  });
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

// ============================================================================
// DELETE THIS SECTION: Test Release Functions (remove when v1 goes to production)
// ============================================================================

function getLastTestTag() {
  try {
    const tags = run('git tag -l "test-v*" --sort=-version:refname');
    if (tags) {
      return tags.split('\n')[0];
    }
    return null;
  } catch (err) {
    return null;
  }
}

function nextAvailableTestVersion(baseVersion) {
  const cleanVersion = baseVersion.replace(/^test-v/, '');
  const [major, minor, patch] = cleanVersion.split('.').map(Number);
  
  for (let candidatePatch = patch; ; candidatePatch += 1) {
    const candidateTag = `test-v${major}.${minor}.${candidatePatch}`;
    if (!tagExists(candidateTag)) {
      return candidateTag;
    }
  }
}

function bumpTestVersion(current, hasHotfix) {
  const cleanVersion = current ? current.replace(/^test-v/, '') : '1.0.0';
  const [major, minor, patch] = cleanVersion.split('.').map(Number);
  
  if (hasHotfix) {
    return `test-v${major}.${minor}.${patch + 1}`;
  }
  return `test-v${major}.${minor + 1}.0`;
}

function createTestRelease() {
  const lastTag = getLastTestTag();
  const repoUrl = getRepoUrl();
  const commits = parseCommits(lastTag, repoUrl);

  if (commits.length === 0) {
    console.log('No commits found since last tag. Aborting.');
    process.exit(1);
  }

  const hasHotfix = commits.some((c) => c.type === 'hotfix');
  const defaultVersion = 'test-v1.0.0';
  const bumpedVersion = bumpTestVersion(lastTag || defaultVersion, hasHotfix);
  const nextVersion = nextAvailableTestVersion(bumpedVersion);
  const grouped = groupCommits(commits);
  const notesPath = writeReleaseNotes(nextVersion, grouped);

  console.log(`Release environment: test`);
  console.log(`Last tag: ${lastTag || 'none'}`);
  run(`git tag -a ${nextVersion} -m "Release ${nextVersion} (test)"`);
  console.log(`Created release notes: ${notesPath}`);
  console.log(`Tagged new version: ${nextVersion}`);
}

// ============================================================================
// Production Release Functions
// ============================================================================

function getLastProductionTag() {
  try {
    return run('git describe --tags --abbrev=0');
  } catch (err) {
    return null;
  }
}

function nextAvailableProductionVersion(baseVersion) {
  const cleanVersion = baseVersion.replace(/^v/, '');
  const [major, minor, patch] = cleanVersion.split('.').map(Number);
  
  for (let candidatePatch = patch; ; candidatePatch += 1) {
    const candidateTag = `v${major}.${minor}.${candidatePatch}`;
    if (!tagExists(candidateTag)) {
      return candidateTag;
    }
  }
}

function bumpProductionVersion(current, hasHotfix) {
  const cleanVersion = current ? current.replace(/^v/, '') : '1.0.0';
  const [major, minor, patch] = cleanVersion.split('.').map(Number);
  
  if (hasHotfix) {
    return `v${major}.${minor}.${patch + 1}`;
  }
  return `v${major}.${minor + 1}.0`;
}

function createProductionRelease() {
  const lastTag = getLastProductionTag();
  const repoUrl = getRepoUrl();
  const commits = parseCommits(lastTag, repoUrl);

  if (commits.length === 0) {
    console.log('No commits found since last tag. Aborting.');
    process.exit(1);
  }

  const hasHotfix = commits.some((c) => c.type === 'hotfix');
  const defaultVersion = 'v1.0.0';
  const bumpedVersion = bumpProductionVersion(lastTag || defaultVersion, hasHotfix);
  const nextVersion = nextAvailableProductionVersion(bumpedVersion);
  const grouped = groupCommits(commits);
  const notesPath = writeReleaseNotes(nextVersion, grouped);

  console.log(`Last tag: ${lastTag || 'none'}`);
  run(`git tag -a ${nextVersion} -m "Release ${nextVersion}"`);
  console.log(`Created release notes: ${notesPath}`);
  console.log(`Tagged new version: ${nextVersion}`);
}

// ============================================================================
// Main Function
// ============================================================================

function main() {
  // DELETE THIS: Remove this if-else and call createProductionRelease() directly when v1 goes to production
  if (isActiveTestRelease) {
    createTestRelease();
  } else {
    createProductionRelease();
  }
}

main();
