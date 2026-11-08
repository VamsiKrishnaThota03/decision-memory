/**
 * Extract what a pull request ADDS to dependency / infrastructure files from a
 * unified diff. These are where decisions like "no MongoDB" or "no Jenkins"
 * are actually broken, and checking only them keeps merge checks precise.
 */
const WATCHED_FILE = /(?:^|\/)(?:package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle|go\.mod|Gemfile|Cargo\.toml|composer\.json|\.csproj|packages\.config|Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose[^/]*\.ya?ml|[^/]+\.tf|Chart\.yaml|values[^/]*\.ya?ml|Jenkinsfile|\.gitlab-ci\.yml|bitbucket-pipelines\.yml|\.github\/workflows\/[^/]+\.ya?ml|serverless\.ya?ml|template\.ya?ml|cdk\.json)$/i;

/**
 * @param {string} diffText unified diff
 * @returns {{files: string[], addedLines: string[], newFiles: string[]}}
 */
export function addedDependencyLines(diffText, { maxLines = 2000 } = {}) {
  const files = [];
  const newFiles = [];
  const addedLines = [];
  let current = null;
  let watching = false;
  for (const line of String(diffText ?? '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/ b\/(.+)$/);
      current = m ? m[1] : null;
      watching = Boolean(current && WATCHED_FILE.test(current));
      if (watching) files.push(current);
      continue;
    }
    if (line.startsWith('new file mode') && current) newFiles.push(current);
    if (!watching || line.startsWith('+++')) continue;
    if (line.startsWith('+') && addedLines.length < maxLines) addedLines.push(line.slice(1).replace(/[{}"',:<>=[\]]/g, ' ').trim());
  }
  // A brand-new Jenkinsfile etc. is itself evidence ("add Jenkinsfile").
  for (const f of newFiles) if (WATCHED_FILE.test(f)) addedLines.push(`add ${f.split('/').pop()}`);
  return { files, newFiles, addedLines: addedLines.filter(Boolean) };
}
