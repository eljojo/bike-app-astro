/**
 * Vendor-isolated wrapper for GitHub Actions API.
 * Only file that touches the GitHub Actions REST API.
 */

interface WorkflowRun {
  id: number;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting';
  conclusion: 'success' | 'failure' | 'cancelled' | null;
  created_at: string;
  updated_at: string;
}

interface WorkflowRunsResponse {
  latestRun: WorkflowRun | null;
  latestSuccessfulRun: WorkflowRun | null;
}

export async function getDeployWorkflowRuns(opts: {
  token: string;
  owner: string;
  repo: string;
  workflowFiles: string[];
}): Promise<WorkflowRunsResponse> {
  const { token, owner, repo, workflowFiles } = opts;
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/actions`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'whereto-bike',
  };

  let latestRun: WorkflowRun | null = null;
  let latestSuccessfulRun: WorkflowRun | null = null;

  // Check all workflow files, keep the most recent run from each category
  await Promise.all(workflowFiles.map(async (workflowFile) => {
    const latestRes = await fetch(
      `${baseUrl}/workflows/${workflowFile}/runs?per_page=1`,
      { headers },
    );

    if (latestRes.ok) {
      const data = await latestRes.json() as { workflow_runs?: WorkflowRun[] };
      const run = data.workflow_runs?.[0];
      if (run && (!latestRun || new Date(run.created_at) > new Date(latestRun.created_at))) {
        latestRun = run;
      }
    }

    const successRes = await fetch(
      `${baseUrl}/workflows/${workflowFile}/runs?status=success&per_page=1`,
      { headers },
    );

    if (successRes.ok) {
      const data = await successRes.json() as { workflow_runs?: WorkflowRun[] };
      const run = data.workflow_runs?.[0];
      if (run && (!latestSuccessfulRun || new Date(run.updated_at) > new Date(latestSuccessfulRun.updated_at))) {
        latestSuccessfulRun = run;
      }
    }
  }));

  return { latestRun, latestSuccessfulRun };
}
