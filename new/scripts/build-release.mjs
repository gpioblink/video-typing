import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const repoDir = resolve(projectDir, '..');
const outputDir = resolve(projectDir, '.output', 'chrome-mv3');
const distDir = resolve(projectDir, 'dist');
const metadataPath = resolve(distDir, 'release-metadata.json');
const timezone = process.env.VIDEO_TYPING_RELEASE_TIMEZONE || 'Asia/Tokyo';
const buildTime = process.env.VIDEO_TYPING_BUILD_TIME || new Date().toISOString();
const commitSha = (process.env.GITHUB_SHA || resolveGitSha()).trim();
const shortSha = commitSha.slice(0, 7);
const buildDate = formatDateInTimeZone(new Date(buildTime), timezone);
const releaseVersion = `v${buildDate}-${shortSha}`;
const manifestVersion = makeManifestVersion(buildDate, shortSha);
const assetName = `video-typing-${releaseVersion}.zip`;
const assetPath = resolve(distDir, assetName);

run('npm', ['run', 'build'], {
  cwd: projectDir,
  env: {
    ...process.env,
    VIDEO_TYPING_BUILD_ID: releaseVersion,
    VIDEO_TYPING_BUILD_TIME: buildTime,
    VIDEO_TYPING_MANIFEST_VERSION: manifestVersion,
    VIDEO_TYPING_RELEASE_VERSION: releaseVersion,
  },
});

mkdirSync(distDir, { recursive: true });
rmSync(assetPath, { force: true });
run('zip', ['-qr', assetPath, '.'], { cwd: outputDir });

const metadata = {
  assetName,
  assetPath,
  buildTime,
  commitSha,
  manifestVersion,
  releaseName: releaseVersion,
  shortSha,
  tag: releaseVersion,
  timezone,
};

writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify(metadata, null, 2));

function resolveGitSha() {
  const gitDir = resolve(repoDir, '.git');
  const head = readFileSync(resolve(gitDir, 'HEAD'), 'utf8').trim();

  if (!head.startsWith('ref: ')) {
    return head;
  }

  const refPath = head.slice(5);

  try {
    return readFileSync(resolve(gitDir, refPath), 'utf8').trim();
  } catch {
    const packedRefs = readFileSync(resolve(gitDir, 'packed-refs'), 'utf8');
    const matchedLine = packedRefs
      .split('\n')
      .find((line) => line && !line.startsWith('#') && !line.startsWith('^') && line.endsWith(` ${refPath}`));

    if (!matchedLine) {
      throw new Error(`Could not resolve git ref: ${refPath}`);
    }

    return matchedLine.split(' ')[0];
  }
}

function formatDateInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}`;
}

function makeManifestVersion(buildDateValue, shortShaValue) {
  const year = Number(buildDateValue.slice(0, 4));
  const month = Number(buildDateValue.slice(4, 6));
  const day = Number(buildDateValue.slice(6, 8));
  const hashSegment = parseInt(shortShaValue.slice(0, 4), 16);

  return `${year}.${month}.${day}.${hashSegment}`;
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
