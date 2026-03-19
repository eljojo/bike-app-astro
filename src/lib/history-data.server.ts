import { parseCommitMessage, formatDetail } from './history-format';
import { parseAuthorEmail } from './git/commit-author';

export interface RecentCommit {
  username: string;
  headline: string;
  detail: string;
  editorUrl: string | null;
  contentType: string | null;
  date: string;
}

export interface CommitGroup {
  username: string;
  commits: RecentCommit[];
}

/** Transform raw git commits into display-ready objects. */
export function toRecentCommits(
  commits: Array<{ message: string; author: { name: string; email: string }; date: string }>,
  city: string,
): RecentCommit[] {
  return commits.map(c => {
    const parsed = parseCommitMessage(c.message, city);
    const authorParsed = parseAuthorEmail(c.author.email);
    return {
      username: authorParsed?.username ?? c.author.name,
      headline: parsed.headline,
      detail: formatDetail(parsed.detail),
      editorUrl: parsed.editorUrl,
      contentType: parsed.contentType,
      date: c.date,
    };
  });
}

/** Group consecutive commits by the same author. */
export function groupConsecutiveByAuthor(commits: RecentCommit[]): CommitGroup[] {
  const groups: CommitGroup[] = [];
  for (const c of commits) {
    const last = groups[groups.length - 1];
    if (last && last.username === c.username) {
      last.commits.push(c);
    } else {
      groups.push({ username: c.username, commits: [c] });
    }
  }
  return groups;
}
