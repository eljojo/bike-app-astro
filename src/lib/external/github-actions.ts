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
  workflowFile?: string;
}): Promise<WorkflowRunsResponse> {
  const { token, owner, repo, workflowFile = 'production.yml' } = opts;
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/actions`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };

  let latestRun: WorkflowRun | null = null;
  let latestSuccessfulRun: WorkflowRun | null = null;

  const latestRes = await fetch(
    `${baseUrl}/workflows/${workflowFile}/runs?per_page=1`,
    { headers },
  );

  if (latestRes.ok) {
    const data = await latestRes.json() as { workflow_runs?: WorkflowRun[] };
    if (data.workflow_runs?.length) {
      latestRun = data.workflow_runs[0];
    }
  }

  const successRes = await fetch(
    `${baseUrl}/workflows/${workflowFile}/runs?status=success&per_page=1`,
    { headers },
  );

  if (successRes.ok) {
    const data = await successRes.json() as { workflow_runs?: WorkflowRun[] };
    if (data.workflow_runs?.length) {
      latestSuccessfulRun = data.workflow_runs[0];
    }
  }

  return { latestRun, latestSuccessfulRun };
}
